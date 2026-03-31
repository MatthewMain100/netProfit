import crypto from 'node:crypto';
import { parse as parseCsv } from 'csv-parse/sync';
import { enqueue, QUEUES } from '../infra/queue.js';
import { importBatchJobSchema, validatePayload } from '../infra/jobSchemas.js';

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function rowFingerprint(row) {
  const keys = ['date', 'type', 'amount', 'category', 'project', 'counterparty', 'comment'];
  const packed = keys.map(k => row[k] ?? '').join('|');
  return sha256(packed);
}

function readCsv(csvText) {
  return parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

export function registerImportV2Routes({ app, requireAuth, requireRole, requireFeature, query, logAudit }) {
  app.post('/imports/preview', requireRole(['admin', 'accountant']), requireFeature('import_v2'), async (req, res) => {
    const csvText = String(req.body?.csvText || req.body || '');
    if (!csvText.trim()) return res.status(400).json({ error: 'csvText required' });

    const rows = readCsv(csvText);
    const preview = rows.slice(0, 50);
    const headers = preview.length ? Object.keys(preview[0]) : [];
    res.json({ headers, totalRows: rows.length, preview });
  });

  app.post('/imports/start', requireRole(['admin', 'accountant']), requireFeature('import_v2'), async (req, res) => {
    const csvText = String(req.body?.csvText || req.body || '');
    const fileName = String(req.body?.fileName || 'upload.csv');
    const mapping = req.body?.mapping || {};

    if (!csvText.trim()) return res.status(400).json({ error: 'csvText required' });

    const fileHash = sha256(csvText);
    const exists = await query(
      `select * from import_batches
       where file_hash = $1 and created_by = $2 and status in ('queued', 'running', 'completed')
       order by id desc
       limit 1`,
      [fileHash, req.user.id]
    );
    if (exists.rows[0]) {
      return res.status(409).json({ error: 'duplicate import', batch: exists.rows[0] });
    }

    const records = readCsv(csvText);
    const created = await query(
      `insert into import_batches (file_name, file_hash, mapping, created_by, status, total_rows)
       values ($1,$2,$3::jsonb,$4,'queued',$5)
       returning *`,
      [fileName, fileHash, JSON.stringify(mapping), req.user.id, records.length]
    );
    const batch = created.rows[0];

    let rowNo = 1;
    for (const row of records) {
      await query(
        `insert into import_rows (batch_id, row_no, raw, fingerprint)
         values ($1,$2,$3::jsonb,$4)
         on conflict (batch_id, fingerprint) do nothing`,
        [batch.id, rowNo, JSON.stringify(row), rowFingerprint(row)]
      );
      rowNo += 1;
    }

    const jobPayload = validatePayload(importBatchJobSchema, {
      batchId: batch.id,
      actorId: req.user.id,
    });

    await enqueue(QUEUES.IMPORTS, 'process-batch', jobPayload, {
      jobId: `import-batch-${batch.id}`,
    });

    await logAudit('imports', batch.id, 'start', req.user.id, { batch_id: batch.id, total_rows: records.length });
    res.status(202).json({ batchId: batch.id, status: 'queued', totalRows: records.length });
  });

  app.get('/imports/:id/status', requireAuth, requireFeature('import_v2'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const { rows } = await query('select * from import_batches where id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  });

  app.get('/imports/:id/report', requireAuth, requireFeature('import_v2'), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

    const batch = await query('select * from import_batches where id = $1', [id]);
    if (!batch.rows[0]) return res.status(404).json({ error: 'not found' });

    const [errors, rows] = await Promise.all([
      query('select * from import_errors where batch_id = $1 order by id', [id]),
      query('select row_no, status, operation_id from import_rows where batch_id = $1 order by row_no', [id]),
    ]);

    res.json({ batch: batch.rows[0], errors: errors.rows, rows: rows.rows });
  });
}
