import { recalculateQualityIssues } from '../engine/qualityEngine.js';

export function registerQualityRoutes({ app, requireAuth, requireRole, requireFeature, query, logAudit }) {
  app.get('/quality/issues', requireAuth, requireFeature('quality'), async (req, res) => {
    const status = req.query.status || 'open';
    const severity = req.query.severity;

    const params = [];
    const where = [];

    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (severity) {
      params.push(severity);
      where.push(`severity = $${params.length}`);
    }

    const whereSql = where.length ? `where ${where.join(' and ')}` : '';
    const { rows } = await query(
      `select *
       from quality_issues
       ${whereSql}
       order by created_at desc
       limit 1000`,
      params
    );
    res.json(rows);
  });

  app.post('/quality/recalculate', requireRole(['admin', 'accountant']), requireFeature('quality'), async (req, res) => {
    const result = await recalculateQualityIssues();
    await logAudit('quality_issues', 0, 'recalculate', req.user.id, result);
    res.json({ ok: true, ...result });
  });

  app.patch('/quality/issues/:id', requireRole(['admin', 'accountant']), requireFeature('quality'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const nextStatus = String(req.body?.status || 'open');
    if (!['open', 'resolved', 'ignored'].includes(nextStatus)) {
      return res.status(400).json({ error: 'invalid status' });
    }

    const { rows } = await query(
      `update quality_issues
       set status = $1, updated_at = now()
       where id = $2
       returning *`,
      [nextStatus, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });

    await query(
      `insert into quality_issue_events (quality_issue_id, action, actor_id, payload)
       values ($1, $2, $3, $4::jsonb)`,
      [id, 'status_change', req.user.id, JSON.stringify({ status: nextStatus })]
    );
    await logAudit('quality_issues', id, 'update', req.user.id, { status: nextStatus });
    res.json(rows[0]);
  });
}
