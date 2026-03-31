import dotenv from 'dotenv';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { parse as parseCsv } from 'csv-parse/sync';
import { getClient, query } from './db.js';
import { ensureAccounts, getAccountMap, buildLedgerEntries, rebuildReportsForRange } from './engine/profitEngine.js';
import { recalculateQualityIssues } from './engine/qualityEngine.js';
import { ensureCategory, ensureCounterparty, ensureProject } from './services/catalogService.js';
import { importBatchJobSchema, validatePayload } from './infra/jobSchemas.js';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const connection = { connection: { url: REDIS_URL } };
const REDIS_REQUIRED = (() => {
  const raw = String(process.env.REDIS_REQUIRED || 'true').trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'no');
})();

const ALLOWED_TYPES = new Set(['income', 'expense', 'tax', 'adjustment']);
const ALLOWED_STATUSES = new Set(['draft', 'confirmed']);

async function canConnectRedis(url) {
  const redis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  redis.on('error', () => {
    // Suppress low-level connection spam; we handle availability explicitly.
  });
  try {
    await redis.connect();
    await redis.ping();
    return true;
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

function parseRows(csvText) {
  return parseCsv(csvText, { columns: true, skip_empty_lines: true, trim: true });
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

async function insertLedger(client, op, actorId) {
  const accountMap = await getAccountMap(client);
  const existing = await client.query('select id from journal where operation_id = $1', [op.id]);
  let journalId = existing.rows[0]?.id;

  if (!journalId) {
    const created = await client.query(
      'insert into journal (operation_id, created_by, memo) values ($1,$2,$3) returning id',
      [op.id, actorId, `import operation ${op.id}`]
    );
    journalId = created.rows[0].id;
  } else {
    await client.query('delete from ledger_entries where journal_id = $1', [journalId]);
  }

  const entries = buildLedgerEntries(op, accountMap);
  if (!entries.length) return;

  const values = [];
  const params = [];
  let idx = 1;
  for (const e of entries) {
    values.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
    params.push(
      journalId,
      e.operation_id,
      e.account_id,
      e.debit,
      e.credit,
      e.operation_date,
      e.category_id,
      e.category_version_id,
      e.project_id,
      e.project_version_id,
      e.counterparty_id,
      e.counterparty_version_id
    );
  }

  await client.query(
    `insert into ledger_entries
      (journal_id, operation_id, account_id, debit, credit, operation_date, category_id, category_version_id, project_id, project_version_id, counterparty_id, counterparty_version_id)
     values ${values.join(', ')}`,
    params
  );
}

async function processImportBatch(job) {
  const { batchId, actorId } = validatePayload(importBatchJobSchema, job.data);
  const client = await getClient();

  try {
    await client.query('begin');
    await ensureAccounts(client);
    await client.query("update import_batches set status = 'running', updated_at = now() where id = $1", [batchId]);

    const batch = await client.query('select * from import_batches where id = $1 for update', [batchId]);
    if (!batch.rows[0]) {
      throw new Error(`batch not found: ${batchId}`);
    }

    const mapping = batch.rows[0].mapping || {};
    const rows = await client.query(
      `select id, row_no, raw
       from import_rows
       where batch_id = $1
       order by row_no`,
      [batchId]
    );

    let inserted = 0;
    let errors = 0;

    for (const row of rows.rows) {
      const raw = row.raw || {};
      const dateKey = mapping.date || 'date';
      const typeKey = mapping.type || 'type';
      const amountKey = mapping.amount || 'amount';
      const categoryKey = mapping.category || 'category';
      const projectKey = mapping.project || 'project';
      const counterpartyKey = mapping.counterparty || 'counterparty';
      const statusKey = mapping.status || 'status';
      const vatIncludedKey = mapping.vat_included || 'vat_included';
      const vatAmountKey = mapping.vat_amount || 'vat_amount';
      const commentKey = mapping.comment || 'comment';

      const type = String(raw[typeKey] || '').trim();
      const amount = Number(raw[amountKey]);
      const operationDate = String(raw[dateKey] || '').trim();
      const status = String(raw[statusKey] || 'draft').trim();

      try {
        if (!ALLOWED_TYPES.has(type)) throw new Error('invalid type');
        if (!Number.isFinite(amount) || amount === 0) throw new Error('invalid amount');
        if (!isIsoDate(operationDate)) throw new Error('invalid date');
        if (!ALLOWED_STATUSES.has(status)) throw new Error('invalid status');

        const categoryType = type === 'tax' ? 'tax' : type === 'income' ? 'income' : 'expense';
        const category = await ensureCategory(client, raw[categoryKey], categoryType);
        const project = await ensureProject(client, raw[projectKey]);
        const counterparty = await ensureCounterparty(client, raw[counterpartyKey]);

        const created = await client.query(
          `insert into operations
            (type, amount, category_id, category_version_id, project_id, project_version_id, counterparty_id, counterparty_version_id,
             currency, vat_included, vat_amount, operation_date, status, comment, adjustment, created_by)
           values
            ($1,$2,$3,$4,$5,$6,$7,$8,'RUB',$9,$10,$11,$12,$13,$14,$15)
           returning *`,
          [
            type,
            amount,
            category?.id || null,
            category?.version_id || null,
            project?.id || null,
            project?.version_id || null,
            counterparty?.id || null,
            counterparty?.version_id || null,
            String(raw[vatIncludedKey]).toLowerCase() === 'true',
            Number(raw[vatAmountKey] || 0),
            operationDate,
            status,
            raw[commentKey] || null,
            type === 'adjustment',
            actorId || null,
          ]
        );

        const op = created.rows[0];

        if (status === 'confirmed') {
          await insertLedger(client, op, actorId || null);
          await rebuildReportsForRange(client, op.operation_date, op.operation_date);
        }

        await client.query(
          `update import_rows
           set status = 'inserted', operation_id = $1
           where id = $2`,
          [op.id, row.id]
        );

        inserted += 1;
      } catch (err) {
        errors += 1;
        await client.query(
          `update import_rows
           set status = 'error'
           where id = $1`,
          [row.id]
        );
        await client.query(
          `insert into import_errors (batch_id, row_no, message, payload)
           values ($1,$2,$3,$4::jsonb)`,
          [batchId, row.row_no, err.message, JSON.stringify(raw)]
        );
      }
    }

    await client.query(
      `update import_batches
       set status = 'completed',
           inserted_rows = $2,
           error_rows = $3,
           updated_at = now(),
           completed_at = now()
       where id = $1`,
      [batchId, inserted, errors]
    );

    await client.query('commit');

    await query(
      `insert into domain_events (event_type, entity, entity_id, actor_id, payload)
       values ('imports.completed', 'imports', $1, $2, $3::jsonb)`,
      [batchId, actorId || null, JSON.stringify({ inserted, errors })]
    );

    await recalculateQualityIssues();
    await query('select refresh_mv_kpi_monthly()');

    return { inserted, errors };
  } catch (err) {
    await client.query('rollback');
    await query(
      `update import_batches
       set status = 'failed',
           error = $2,
           updated_at = now()
       where id = $1`,
      [batchId, err.message]
    );
    throw err;
  } finally {
    client.release();
  }
}

async function refreshKpi() {
  await query('select refresh_mv_kpi_monthly()');
  return { ok: true };
}

async function recalcQuality() {
  return recalculateQualityIssues();
}

function registerWorker(queueName, handler) {
  const worker = new Worker(queueName, handler, connection);
  worker.on('completed', job => {
    console.log(`[worker:${queueName}] completed job ${job.id}`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[worker:${queueName}] failed job ${job?.id}: ${err.message}`);
  });
  worker.on('error', err => {
    console.error(`[worker:${queueName}] error: ${err.message}`);
  });
  return worker;
}

const workers = [];
const redisAvailable = await canConnectRedis(REDIS_URL);

if (!redisAvailable) {
  const message = `[worker] Redis unavailable at ${REDIS_URL}.`;
  if (REDIS_REQUIRED) {
    throw new Error(`${message} Set REDIS_URL correctly or start Redis.`);
  }
  console.warn(`${message} Workers are disabled because REDIS_REQUIRED=false.`);
  process.exit(0);
}

workers.push(registerWorker('imports', processImportBatch));
workers.push(registerWorker('reports', refreshKpi));
workers.push(registerWorker('quality', recalcQuality));
workers.push(registerWorker('projections', async () => ({ ok: true })));

console.log('Workers started.');

process.on('SIGINT', async () => {
  await Promise.all(workers.map(w => w.close()));
  process.exit(0);
});
