import { evaluatePolicy } from '../infra/abac.js';

export function registerAccessControlRoutes({ app, requireRole, requireFeature, query, logAudit }) {
  app.get('/access/policies', requireRole(['admin']), requireFeature('abac_rls'), async (_req, res) => {
    const { rows } = await query(
      `select p.*, coalesce(json_agg(json_build_object('id', b.id, 'user_id', b.user_id, 'role', b.role))
                 filter (where b.id is not null), '[]'::json) as bindings
       from policies p
       left join policy_bindings b on b.policy_id = p.id
       group by p.id
       order by p.id desc`
    );
    res.json(rows);
  });

  app.post('/access/policies', requireRole(['admin']), requireFeature('abac_rls'), async (req, res) => {
    const { name, subject, action, resource, effect = 'allow', conditions = {}, bindings = [] } = req.body || {};
    if (!name || !subject || !action || !resource) {
      return res.status(400).json({ error: 'name, subject, action, resource required' });
    }

    const created = await query(
      `insert into policies (name, subject, action, resource, effect, conditions, created_by)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7)
       returning *`,
      [name, subject, action, resource, effect, JSON.stringify(conditions), req.user.id]
    );
    const policy = created.rows[0];

    for (const b of Array.isArray(bindings) ? bindings : []) {
      await query(
        `insert into policy_bindings (policy_id, user_id, role)
         values ($1,$2,$3)`,
        [policy.id, b.user_id || null, b.role || null]
      );
    }

    await logAudit('policies', policy.id, 'create', req.user.id, { snapshot: policy, bindings });
    res.status(201).json(policy);
  });

  app.patch('/access/policies/:id', requireRole(['admin']), requireFeature('abac_rls'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const updates = [];
    const params = [];

    for (const key of ['name', 'subject', 'action', 'resource', 'effect']) {
      if (req.body?.[key] != null) {
        params.push(req.body[key]);
        updates.push(`${key} = $${params.length}`);
      }
    }
    if (req.body?.conditions != null) {
      params.push(JSON.stringify(req.body.conditions));
      updates.push(`conditions = $${params.length}::jsonb`);
    }

    if (!updates.length && !Array.isArray(req.body?.bindings)) {
      return res.status(400).json({ error: 'no fields' });
    }

    let policyRow = null;
    if (updates.length) {
      params.push(id);
      const updated = await query(
        `update policies set ${updates.join(', ')}, updated_at = now() where id = $${params.length} returning *`,
        params
      );
      policyRow = updated.rows[0];
      if (!policyRow) return res.status(404).json({ error: 'not found' });
    } else {
      const cur = await query('select * from policies where id = $1', [id]);
      policyRow = cur.rows[0];
      if (!policyRow) return res.status(404).json({ error: 'not found' });
    }

    if (Array.isArray(req.body?.bindings)) {
      await query('delete from policy_bindings where policy_id = $1', [id]);
      for (const b of req.body.bindings) {
        await query(
          `insert into policy_bindings (policy_id, user_id, role)
           values ($1,$2,$3)`,
          [id, b.user_id || null, b.role || null]
        );
      }
    }

    await logAudit('policies', id, 'update', req.user.id, { diff: req.body, snapshot: policyRow });
    res.json(policyRow);
  });

  app.delete('/access/policies/:id', requireRole(['admin']), requireFeature('abac_rls'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const result = await query('delete from policies where id = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'not found' });
    await logAudit('policies', id, 'delete', req.user.id, null);
    res.json({ ok: true });
  });

  app.post('/access/test-user', requireRole(['admin']), requireFeature('abac_rls'), async (req, res) => {
    const asUserId = Number(req.body?.as_user_id);
    const action = String(req.body?.action || 'read');
    const resourceName = String(req.body?.resource || 'operations');
    const input = req.body?.input || {};

    if (!Number.isInteger(asUserId)) return res.status(400).json({ error: 'as_user_id required' });

    const userRes = await query(
      `select u.id, u.email, r.name as role
       from users u
       join roles r on r.id = u.role_id
       where u.id = $1`,
      [asUserId]
    );
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'user not found' });

    const evalResult = await evaluatePolicy(user, action, resourceName, input);

    await query(
      `insert into policy_tests (tested_by, as_user_id, action, resource, input, result)
       values ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [req.user.id, asUserId, action, resourceName, JSON.stringify(input), JSON.stringify(evalResult)]
    );

    res.json({ as_user: user, result: evalResult });
  });
}
