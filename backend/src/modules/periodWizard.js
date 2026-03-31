import PDFDocument from 'pdfkit';
import { buildPrecloseChecks, periodProtocolHtml } from '../engine/calculationEngine.js';
import { calcPeriodSnapshot } from '../engine/profitEngine.js';

async function persistChecks(query, periodId, checks) {
  await query('delete from period_close_checks where period_id = $1', [periodId]);
  for (const c of checks) {
    await query(
      `insert into period_close_checks (period_id, check_key, severity, details)
       values ($1,$2,$3,$4::jsonb)`,
      [periodId, c.check_key, c.severity, JSON.stringify(c.details)]
    );
  }
}

function createPdfBuffer({ period, checks, snapshot, comment }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', d => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text(`Протокол закрытия периода #${period.id}`);
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Период: ${period.start_date} - ${period.end_date}`);
    doc.text(`Комментарий: ${comment || '-'}`);
    doc.moveDown();
    doc.fontSize(13).text('Итоги');
    doc.fontSize(11).text(`Валовая прибыль: ${snapshot.gross}`);
    doc.text(`Налоги: ${snapshot.tax}`);
    doc.text(`Чистая прибыль: ${snapshot.net}`);
    doc.moveDown();
    doc.fontSize(13).text('Проверки');

    checks.forEach((c, idx) => {
      doc.fontSize(11).text(`${idx + 1}. ${c.check_key} [${String(c.severity).toUpperCase()}]`);
      doc.fontSize(10).text(JSON.stringify(c.details));
      doc.moveDown(0.5);
    });

    doc.end();
  });
}

export function registerPeriodWizardRoutes({ app, requireAuth, requireRole, requireFeature, query }) {
  app.post('/periods/:id/precheck', requireRole(['admin', 'accountant']), requireFeature('period_wizard'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const p = await query('select * from periods where id = $1', [id]);
    if (!p.rows[0]) return res.status(404).json({ error: 'period not found' });

    const checks = await buildPrecloseChecks(id);
    await persistChecks(query, id, checks);
    res.json({ checks });
  });

  app.get('/periods/:id/precheck', requireAuth, requireFeature('period_wizard'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const { rows } = await query(
      `select check_key, severity, details, created_at
       from period_close_checks
       where period_id = $1
       order by id asc`,
      [id]
    );
    res.json({ checks: rows });
  });

  app.get('/periods/:id/protocol', requireAuth, requireFeature('period_wizard'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const periodRes = await query('select * from periods where id = $1', [id]);
    const period = periodRes.rows[0];
    if (!period) return res.status(404).json({ error: 'period not found' });

    const checksRes = await query(
      `select check_key, severity, details
       from period_close_checks
       where period_id = $1
       order by id asc`,
      [id]
    );
    const checks = checksRes.rows;

    const snapshot = await calcPeriodSnapshot({ query }, period.start_date, period.end_date);
    const comment = String(req.query.comment || '');

    if (String(req.query.format || 'html') === 'pdf') {
      const pdf = await createPdfBuffer({ period, checks, snapshot, comment });
      res.setHeader('content-type', 'application/pdf');
      res.setHeader('content-disposition', `inline; filename="period-${id}-protocol.pdf"`);
      return res.end(pdf);
    }

    const html = periodProtocolHtml({ period, checks, snapshot, comment });
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.send(html);
  });
}
