import { runScenarioSpec } from '../engine/calculationEngine.js';

function monthToDate(month) {
  const d = new Date(`${month}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15)).toISOString().slice(0, 10);
}

async function getCurrentProjectVersionId(query, projectId) {
  const { rows } = await query(
    'select id from project_versions where project_id = $1 and is_current = true limit 1',
    [projectId]
  );
  return rows[0]?.id || null;
}

export function registerScenarioRoutes({ app, requireAuth, requireFeature, query, logAudit }) {
  app.get('/scenarios', requireAuth, requireFeature('planning'), async (req, res) => {
    const { rows } = await query('select * from scenarios where created_by = $1 order by id desc', [req.user.id]);
    res.json(rows);
  });

  app.post('/scenarios', requireAuth, requireFeature('planning'), async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const spec = req.body?.spec || {};
    if (!name) return res.status(400).json({ error: 'name required' });

    const { rows } = await query(
      `insert into scenarios (name, spec, created_by)
       values ($1,$2::jsonb,$3)
       returning *`,
      [name, JSON.stringify(spec), req.user.id]
    );
    await logAudit('scenarios', rows[0].id, 'create', req.user.id, { snapshot: rows[0] });
    res.status(201).json(rows[0]);
  });

  app.patch('/scenarios/:id', requireAuth, requireFeature('planning'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const updates = [];
    const params = [];

    if (req.body?.name) {
      params.push(String(req.body.name));
      updates.push(`name = $${params.length}`);
    }
    if (req.body?.spec) {
      params.push(JSON.stringify(req.body.spec));
      updates.push(`spec = $${params.length}::jsonb`);
    }

    if (!updates.length) return res.status(400).json({ error: 'no fields' });

    params.push(req.user.id);
    params.push(id);
    const { rows } = await query(
      `update scenarios
       set ${updates.join(', ')}, updated_at = now()
       where created_by = $${params.length - 1} and id = $${params.length}
       returning *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    await logAudit('scenarios', id, 'update', req.user.id, { snapshot: rows[0], diff: req.body });
    res.json(rows[0]);
  });

  app.delete('/scenarios/:id', requireAuth, requireFeature('planning'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const result = await query('delete from scenarios where id = $1 and created_by = $2', [id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'not found' });
    await logAudit('scenarios', id, 'delete', req.user.id, null);
    res.json({ ok: true });
  });

  app.post('/scenarios/run', requireAuth, requireFeature('planning'), async (req, res) => {
    const spec = req.body || {};
    const rows = await runScenarioSpec(spec);
    res.json({ rows });
  });

  app.post('/scenarios/:id/apply', requireAuth, requireFeature('planning'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const { rows } = await query('select * from scenarios where id = $1 and created_by = $2', [id, req.user.id]);
    const scenario = rows[0];
    if (!scenario) return res.status(404).json({ error: 'not found' });

    const projectId = req.body?.project_id ? Number(req.body.project_id) : null;
    const projectVersionId = projectId ? await getCurrentProjectVersionId(query, projectId) : null;
    const comment = String(req.body?.comment || `scenario:${id}`);

    const scenarioRows = await runScenarioSpec(scenario.spec || {});
    const deltas = scenarioRows
      .map(r => ({ month: r.month, delta: Number(r.scenario_net_profit) - Number(r.net_profit) }))
      .filter(r => Math.abs(r.delta) > 0.001);

    const inserted = [];
    for (const d of deltas) {
      const operationDate = monthToDate(d.month);
      const op = await query(
        `insert into operations
          (type, amount, category_id, category_version_id, project_id, project_version_id, counterparty_id, counterparty_version_id,
           currency, vat_included, vat_amount, operation_date, status, comment, adjustment, created_by)
         values
          ('adjustment', $1, null, null, $2, $3, null, null, 'RUB', false, 0, $4, 'draft', $5, true, $6)
         returning *`,
        [d.delta, projectId, projectVersionId, operationDate, comment, req.user.id]
      );
      inserted.push(op.rows[0]);
      await logAudit('operations', op.rows[0].id, 'create', req.user.id, { snapshot: op.rows[0] });
    }

    await logAudit('scenarios', id, 'apply', req.user.id, { inserted_operations: inserted.map(i => i.id) });
    res.json({ inserted: inserted.length, operation_ids: inserted.map(i => i.id) });
  });
}
