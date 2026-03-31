function encodeCursor(row) {
  return `${new Date(row.created_at).toISOString()}|${row.id}`;
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  const [createdAt, id] = String(cursor).split('|');
  if (!createdAt || !id) return null;
  return { createdAt, id: Number(id) };
}

function parseListParam(value) {
  if (!value) return [];
  return String(value).split(',').map(v => v.trim()).filter(Boolean);
}

export function registerOperationsV2Routes({ app, requireAuth, requireFeature, query }) {
  app.get('/operations/v2', requireAuth, requireFeature('ops_v2'), async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const cursor = decodeCursor(req.query.cursor);
    const types = parseListParam(req.query.types);
    const statuses = parseListParam(req.query.statuses);

    const params = [];
    const where = [];

    if (req.query.from) {
      params.push(req.query.from);
      where.push(`o.operation_date >= $${params.length}`);
    }
    if (req.query.to) {
      params.push(req.query.to);
      where.push(`o.operation_date <= $${params.length}`);
    }
    if (types.length) {
      params.push(types);
      where.push(`o.type = any($${params.length})`);
    }
    if (statuses.length) {
      params.push(statuses);
      where.push(`o.status = any($${params.length})`);
    }
    if (req.query.project_id) {
      params.push(Number(req.query.project_id));
      where.push(`o.project_id = $${params.length}`);
    }
    if (req.query.category_id) {
      params.push(Number(req.query.category_id));
      where.push(`o.category_id = $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${String(req.query.search).trim()}%`);
      where.push(`coalesce(o.comment, '') ilike $${params.length}`);
    }

    if (cursor) {
      params.push(cursor.createdAt);
      params.push(cursor.id);
      where.push(`(o.created_at, o.id) < ($${params.length - 1}::timestamptz, $${params.length}::int)`);
    }

    const whereSql = where.length ? `where ${where.join(' and ')}` : '';
    params.push(limit + 1);

    const { rows } = await query(
      `select
         o.*,
         cv.name as category_name,
         pv.name as project_name,
         cpv.name as counterparty_name
       from operations o
       left join category_versions cv on cv.id = o.category_version_id
       left join project_versions pv on pv.id = o.project_version_id
       left join counterparty_versions cpv on cpv.id = o.counterparty_version_id
       ${whereSql}
       order by o.created_at desc, o.id desc
       limit $${params.length}`,
      params
    );

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    const approx = await query('select reltuples::bigint as estimate from pg_class where relname = $1', ['operations']);
    const totalApprox = Number(approx.rows[0]?.estimate || 0);

    res.json({
      data,
      nextCursor: hasMore ? encodeCursor(data[data.length - 1]) : null,
      totalApprox,
    });
  });

  app.get('/operations/views', requireAuth, requireFeature('ops_v2'), async (req, res) => {
    const { rows } = await query(
      `select *
       from operation_views
       where scope = 'global' or created_by = $1
       order by id desc`,
      [req.user.id]
    );
    res.json(rows);
  });

  app.post('/operations/views', requireAuth, requireFeature('ops_v2'), async (req, res) => {
    const { name, spec, scope = 'private' } = req.body || {};
    if (!name || !spec) return res.status(400).json({ error: 'name and spec required' });
    const { rows } = await query(
      `insert into operation_views (name, spec, created_by, scope)
       values ($1,$2::jsonb,$3,$4)
       returning *`,
      [name, JSON.stringify(spec), req.user.id, scope]
    );
    res.status(201).json(rows[0]);
  });

  app.patch('/operations/views/:id', requireAuth, requireFeature('ops_v2'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const updates = [];
    const params = [];

    if (req.body?.name) {
      params.push(req.body.name);
      updates.push(`name = $${params.length}`);
    }
    if (req.body?.spec) {
      params.push(JSON.stringify(req.body.spec));
      updates.push(`spec = $${params.length}::jsonb`);
    }
    if (req.body?.scope) {
      params.push(req.body.scope);
      updates.push(`scope = $${params.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'no fields' });

    params.push(req.user.id);
    params.push(id);
    const { rows } = await query(
      `update operation_views
       set ${updates.join(', ')}, updated_at = now()
       where created_by = $${params.length - 1} and id = $${params.length}
       returning *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  });

  app.delete('/operations/views/:id', requireAuth, requireFeature('ops_v2'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const result = await query('delete from operation_views where id = $1 and created_by = $2', [id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });
}
