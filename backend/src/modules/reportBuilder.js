const ALLOWED_FIELDS = {
  date: 'operation_date',
  type: 'type',
  category: 'category_id',
  project: 'project_id',
  counterparty: 'counterparty_id',
  amount: 'amount',
  status: 'status',
};

const ALLOWED_METRICS = {
  sum_amount: 'sum(amount) as sum_amount',
  avg_amount: 'avg(amount) as avg_amount',
  min_amount: 'min(amount) as min_amount',
  max_amount: 'max(amount) as max_amount',
  count: 'count(*) as count',
};

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function assertAllowedField(key) {
  if (!ALLOWED_FIELDS[key]) {
    throw new Error(`invalid field: ${key}`);
  }
  return ALLOWED_FIELDS[key];
}

export function buildReportSQL(spec = {}) {
  const dimensions = normalizeArray(spec.dimensions || spec.groupBy);
  const metrics = normalizeArray(spec.metrics);
  const filters = normalizeArray(spec.filters);
  const sort = normalizeArray(spec.sort);
  const limit = Math.min(Math.max(Number(spec.limit || 200), 1), 1000);

  const selectParts = [];
  const groupExprs = [];

  for (const key of dimensions) {
    const column = assertAllowedField(key);
    selectParts.push(`${column} as ${key}`);
    groupExprs.push(column);
  }

  if (metrics.length) {
    for (const m of metrics) {
      if (!ALLOWED_METRICS[m]) throw new Error(`invalid metric: ${m}`);
      selectParts.push(ALLOWED_METRICS[m]);
    }
  } else {
    selectParts.push(ALLOWED_METRICS.count);
  }

  const where = [`status = 'confirmed'`];
  const params = [];

  if (spec.from) {
    params.push(spec.from);
    where.push(`operation_date >= $${params.length}`);
  }
  if (spec.to) {
    params.push(spec.to);
    where.push(`operation_date <= $${params.length}`);
  }

  for (const f of filters) {
    const column = assertAllowedField(f.field);
    const op = String(f.op || 'eq');

    if (op === 'eq') {
      params.push(f.value);
      where.push(`${column} = $${params.length}`);
    } else if (op === 'neq') {
      params.push(f.value);
      where.push(`${column} <> $${params.length}`);
    } else if (op === 'gte') {
      params.push(f.value);
      where.push(`${column} >= $${params.length}`);
    } else if (op === 'lte') {
      params.push(f.value);
      where.push(`${column} <= $${params.length}`);
    } else if (op === 'in') {
      const values = Array.isArray(f.value) ? f.value : [];
      if (!values.length) continue;
      const placeholders = values.map(v => {
        params.push(v);
        return `$${params.length}`;
      });
      where.push(`${column} in (${placeholders.join(',')})`);
    } else if (op === 'between') {
      if (!Array.isArray(f.value) || f.value.length !== 2) {
        throw new Error(`invalid between filter for field: ${f.field}`);
      }
      params.push(f.value[0]);
      const p1 = `$${params.length}`;
      params.push(f.value[1]);
      const p2 = `$${params.length}`;
      where.push(`${column} between ${p1} and ${p2}`);
    } else {
      throw new Error(`invalid filter op: ${op}`);
    }
  }

  const groupBySql = groupExprs.length ? `group by ${groupExprs.join(', ')}` : '';

  let orderBySql = '';
  if (sort.length) {
    const clauses = [];
    for (const s of sort) {
      const dir = String(s.dir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
      const key = s.field;
      if (ALLOWED_FIELDS[key]) {
        clauses.push(`${ALLOWED_FIELDS[key]} ${dir}`);
      } else if (metrics.includes(key) || key === 'count') {
        clauses.push(`${key} ${dir}`);
      }
    }
    if (clauses.length) {
      orderBySql = `order by ${clauses.join(', ')}`;
    }
  }

  if (!orderBySql && dimensions.length) {
    orderBySql = `order by ${dimensions.map(k => ALLOWED_FIELDS[k]).join(', ')}`;
  }

  params.push(limit);
  const sql = `
    select ${selectParts.join(', ')}
    from operations
    where ${where.join(' and ')}
    ${groupBySql}
    ${orderBySql}
    limit $${params.length}
  `;

  return { sql, params };
}

export function registerReportBuilderRoutes({ app, requireAuth, requireFeature, query }) {
  app.post('/reports/run', requireAuth, requireFeature('report_builder'), async (req, res) => {
    try {
      const spec = req.body || {};
      const run = await query(
        `insert into report_runs (spec, started_by, status)
         values ($1::jsonb, $2, 'running')
         returning id`,
        [JSON.stringify(spec), req.user.id]
      );

      const { sql, params } = buildReportSQL(spec);
      const result = await query(sql, params);

      await query(
        `update report_runs
         set status = 'completed', row_count = $1, completed_at = now()
         where id = $2`,
        [result.rows.length, run.rows[0].id]
      );

      const columns = result.rows.length ? Object.keys(result.rows[0]) : [];
      res.json({ columns, rows: result.rows, meta: { rowCount: result.rows.length, runId: run.rows[0].id } });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/reports/templates', requireAuth, requireFeature('report_builder'), async (req, res) => {
    const { rows } = await query(
      `select id, name, spec, created_by, created_at, updated_at
       from report_templates
       where created_by = $1
       order by id desc`,
      [req.user.id]
    );
    res.json(rows);
  });

  app.post('/reports/templates', requireAuth, requireFeature('report_builder'), async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const spec = req.body?.spec || {};
    if (!name) return res.status(400).json({ error: 'name required' });

    // Validate spec by attempting SQL build.
    buildReportSQL(spec);

    const { rows } = await query(
      `insert into report_templates (name, spec, created_by)
       values ($1,$2::jsonb,$3)
       returning *`,
      [name, JSON.stringify(spec), req.user.id]
    );
    res.status(201).json(rows[0]);
  });

  app.patch('/reports/templates/:id', requireAuth, requireFeature('report_builder'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const fields = [];
    const params = [];
    if (req.body?.name) {
      params.push(String(req.body.name));
      fields.push(`name = $${params.length}`);
    }
    if (req.body?.spec) {
      buildReportSQL(req.body.spec);
      params.push(JSON.stringify(req.body.spec));
      fields.push(`spec = $${params.length}::jsonb`);
    }
    if (!fields.length) return res.status(400).json({ error: 'no fields' });

    params.push(req.user.id);
    params.push(id);
    const { rows } = await query(
      `update report_templates
       set ${fields.join(', ')}, updated_at = now()
       where created_by = $${params.length - 1} and id = $${params.length}
       returning *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  });

  app.delete('/reports/templates/:id', requireAuth, requireFeature('report_builder'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
    const result = await query('delete from report_templates where id = $1 and created_by = $2', [id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  app.post('/reports/templates/:id/run', requireAuth, requireFeature('report_builder'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const { rows } = await query('select * from report_templates where id = $1 and created_by = $2', [id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });

    const spec = rows[0].spec || {};
    const { sql, params } = buildReportSQL(spec);
    const result = await query(sql, params);
    res.json({ columns: result.rows.length ? Object.keys(result.rows[0]) : [], rows: result.rows, meta: { templateId: id } });
  });
}
