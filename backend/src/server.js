import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { parse as parseCsv } from 'csv-parse/sync';
import { query, getClient } from './db.js';
import { ensureFeatureFlags, isFeatureEnabled, requireFeature } from './infra/flags.js';
import { publishFollowUpJobs } from './infra/publisher.js';
import { registerFeatureFlagRoutes } from './modules/featureFlags.js';
import { registerFinanceCenterRoutes } from './modules/financeCenter.js';
import { registerReportBuilderRoutes } from './modules/reportBuilder.js';
import { registerOperationsV2Routes } from './modules/operationsV2.js';
import { registerPeriodWizardRoutes } from './modules/periodWizard.js';
import { registerScenarioRoutes } from './modules/scenarios.js';
import { registerQualityRoutes } from './modules/quality.js';
import { registerImportV2Routes } from './modules/importV2.js';
import { registerAccessControlRoutes } from './modules/accessControl.js';
import { registerAttachmentRoutes } from './modules/attachments.js';
import { registerUiPrefsRoutes } from './modules/uiPrefs.js';
import { withCache } from './infra/cache.js';
import {
  ACCOUNT_CODES,
  ensureAccounts,
  getAccountMap,
  buildLedgerEntries,
  rebuildReportsForRange,
  monthStart,
  calcPeriodSnapshot,
} from './engine/profitEngine.js';
import { buildPrecloseChecks } from './engine/calculationEngine.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? null : 'dev-secret');
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production');
}

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const ALLOWED_TYPES = new Set(['income', 'expense', 'tax', 'adjustment']);
const ALLOWED_STATUSES = new Set(['draft', 'confirmed']);
const ALLOWED_CATEGORY_TYPES = new Set(['income', 'expense', 'tax']);
const ALLOWED_PROJECT_STATUSES = new Set(['active', 'archived']);
const ALLOWED_USER_STATUSES = new Set(['active', 'disabled']);

const corsOriginRaw = process.env.CORS_ORIGIN;
let corsOrigin = ['http://localhost:5173'];
if (corsOriginRaw) {
  corsOrigin = corsOriginRaw.split(',').map(v => v.trim()).filter(Boolean);
}
const corsOptions = corsOrigin.length === 1 && corsOrigin[0] === '*'
  ? { origin: '*' }
  : { origin: corsOrigin };
app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '10mb' }));
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

function parseDate(value, fallback) {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString().slice(0, 10);
}

function isISODate(value) {
  if (!value || typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function parseLimitOffset(query) {
  const limitRaw = Number(query.limit);
  const offsetRaw = Number(query.offset);
  const limitSafe = Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT;
  const offsetSafe = Number.isFinite(offsetRaw) ? offsetRaw : 0;
  const limit = Math.min(Math.max(limitSafe, 1), MAX_LIMIT);
  const offset = Math.max(offsetSafe, 0);
  return { limit, offset };
}

function validateAmount(type, amount) {
  if (!Number.isFinite(amount)) return false;
  if (type === 'adjustment') return amount !== 0;
  return amount > 0;
}

async function getCurrentCategoryVersionId(client, categoryId) {
  const { rows } = await client.query(
    'select id from category_versions where category_id = $1 and is_current = true',
    [categoryId]
  );
  return rows[0]?.id || null;
}

async function getCurrentProjectVersionId(client, projectId) {
  const { rows } = await client.query(
    'select id from project_versions where project_id = $1 and is_current = true',
    [projectId]
  );
  return rows[0]?.id || null;
}

async function getCurrentCounterpartyVersionId(client, counterpartyId) {
  const { rows } = await client.query(
    'select id from counterparty_versions where counterparty_id = $1 and is_current = true',
    [counterpartyId]
  );
  return rows[0]?.id || null;
}

async function upsertJournalAndLedger(client, op, userId) {
  const accountMap = await getAccountMap(client);
  const required = Object.values(ACCOUNT_CODES);
  for (const code of required) {
    if (!accountMap.has(code)) {
      throw new Error(`Missing required account: ${code}`);
    }
  }

  const existingJournal = await client.query('select id from journal where operation_id = $1', [op.id]);
  let journalId = existingJournal.rows[0]?.id;
  if (!journalId) {
    const memo = `operation ${op.id} ${op.type}`;
    const created = await client.query(
      'insert into journal (operation_id, created_by, memo) values ($1,$2,$3) returning id',
      [op.id, userId || null, memo]
    );
    journalId = created.rows[0].id;
  } else {
    await client.query('delete from ledger_entries where journal_id = $1', [journalId]);
  }

  const entries = buildLedgerEntries(op, accountMap);
  if (!entries.length) return;
  const totalDebit = entries.reduce((s, e) => s + Number(e.debit || 0), 0);
  const totalCredit = entries.reduce((s, e) => s + Number(e.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.0001) {
    throw new Error('Ledger is not balanced');
  }

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
     values ${values.join(',')}`,
    params
  );

  await rebuildReportsForRange(client, op.operation_date, op.operation_date);
}

async function backfillLedgerForConfirmedOps() {
  const client = await getClient();
  try {
    await client.query('begin');
    const { rows } = await client.query(
      `select o.*
       from operations o
       left join journal j on j.operation_id = o.id
       where o.status = 'confirmed' and j.id is null`
    );
    for (const op of rows) {
      await upsertJournalAndLedger(client, op, null);
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

function authOptional(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    req.user = null;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

function sanitizePayload(payload) {
  if (!payload) return payload;
  try {
    const clone = JSON.parse(JSON.stringify(payload));
    if (clone.password) delete clone.password;
    if (clone.password_hash) delete clone.password_hash;
    if (clone.snapshot && clone.snapshot.password_hash) delete clone.snapshot.password_hash;
    return clone;
  } catch {
    return payload;
  }
}

async function logAudit(entity, entityId, action, userId, payload, client = null) {
  const runner = client || { query };
  const eventType = `${entity}.${action}`;
  const jsonPayload = payload ? JSON.stringify(payload) : null;
  const auditPayload = sanitizePayload(payload);
  const auditJson = auditPayload ? JSON.stringify(auditPayload) : null;
  await runner.query(
    `insert into domain_events (event_type, entity, entity_id, actor_id, payload)
     values ($1,$2,$3,$4,$5)`,
    [eventType, entity, entityId || null, userId || null, jsonPayload]
  );
  await runner.query(
    `insert into audit_logs (entity, entity_id, action, user_id, diff)
     values ($1,$2,$3,$4,$5)`,
    [entity, entityId, action, userId || null, auditJson]
  );

  // Publish async side-effects for read-models/quality/cache invalidation.
  const safePayload = sanitizePayload(payload);
  setTimeout(() => {
    publishFollowUpJobs({ entity, action, payload: safePayload }).catch(err => {
      console.warn(`[publisher] ${entity}.${action} failed: ${err.message}`);
    });
  }, 1000);
}

async function ensureRoles() {
  await query("insert into roles (name) values ('accountant'),('manager'),('admin') on conflict do nothing");
}

async function ensureAdmin() {
  await ensureRoles();
  const email = process.env.ADMIN_EMAIL || 'admin@local';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = await bcrypt.hash(password, 10);
  const role = await query("select id from roles where name='admin'");
  const roleId = role.rows[0].id;
  const existing = await query('select id from users where email = $1 limit 1', [email]);
  if (existing.rows[0]) {
    if (process.env.NODE_ENV !== 'production') {
      await query(
        'update users set password_hash = $1, role_id = $2, status = $3 where id = $4',
        [hash, roleId, 'active', existing.rows[0].id]
      );
    }
    return;
  }

  await query(
    'insert into users (email, password_hash, role_id) values ($1,$2,$3)',
    [email, hash, roleId]
  );
}

async function resolveUserClaims(userId, role) {
  const claims = {
    tenant_id: 1,
    allowed_project_ids: [],
    mask_pii: false,
    rls_enforced: false,
  };

  let rows = [];
  try {
    const result = await query(
      `select p.conditions
       from policies p
       left join policy_bindings b on b.policy_id = p.id
       where p.resource = 'operations'
         and (b.user_id = $1 or b.role = $2 or b.id is null)`,
      [userId, role]
    );
    rows = result.rows;
  } catch (err) {
    if (err.code === '42P01') {
      return claims;
    }
    throw err;
  }

  for (const row of rows) {
    const conditions = row.conditions || {};
    if (Array.isArray(conditions.allowed_project_ids)) {
      for (const id of conditions.allowed_project_ids) {
        if (Number.isInteger(id) && !claims.allowed_project_ids.includes(id)) {
          claims.allowed_project_ids.push(id);
        }
      }
      claims.rls_enforced = true;
    }
    if (conditions.mask_pii === true) {
      claims.mask_pii = true;
    }
  }

  return claims;
}

async function isAttachmentRequired(op) {
  let rows = [];
  try {
    const result = await query(
      `select p.conditions
       from policies p
       left join policy_bindings b on b.policy_id = p.id
       where p.action = 'confirm'
         and p.resource = 'operations'
         and p.effect = 'allow'
         and (b.id is null or b.role is not null or b.user_id is not null)`,
      []
    );
    rows = result.rows;
  } catch (err) {
    if (err.code === '42P01') return false;
    throw err;
  }

  for (const row of rows) {
    const c = row.conditions || {};
    if (c.require_attachment !== true) continue;
    if (Array.isArray(c.types) && c.types.length && !c.types.includes(op.type)) continue;
    if (typeof c.minAmount === 'number' && Math.abs(Number(op.amount || 0)) < c.minAmount) continue;
    return true;
  }
  return false;
}

app.use(authOptional);

app.get('/health', async (_req, res) => {
  res.json({ ok: true });
});

app.get('/integrations/status', requireAuth, async (_req, res) => {
  res.json({
    sources: [
      { name: 'CSV Import', status: 'active' },
      { name: '1C Integration', status: 'not_connected' },
      { name: 'Bank Feed', status: 'not_connected' },
    ],
  });
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const { rows } = await query(
    `select u.id, u.email, r.name as role, u.password_hash
     from users u join roles r on r.id = u.role_id
     where u.email = $1`,
    [email]
  );

  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  const claims = await resolveUserClaims(user.id, user.role);
  const tokenPayload = { id: user.id, role: user.role, email: user.email, ...claims };
  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, ...claims } });
});

app.get('/auth/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

app.get('/users', requireRole(['admin']), async (_req, res) => {
  const { limit, offset } = parseLimitOffset(_req.query);
  const { rows } = await query(
    `select u.id, u.email, r.name as role, u.status, u.created_at
     from users u join roles r on r.id = u.role_id
     order by u.id desc
     limit $1 offset $2`,
    [limit, offset]
  );
  res.json(rows);
});

app.post('/users', requireRole(['admin']), async (req, res) => {
  const { email, password, role = 'manager' } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const roleRow = await query('select id from roles where name = $1', [role]);
  if (!roleRow.rows[0]) return res.status(400).json({ error: 'invalid role' });
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    'insert into users (email, password_hash, role_id) values ($1,$2,$3) returning id',
    [email, hash, roleRow.rows[0].id]
  );
  const userRow = await query(
    `select u.id, u.email, u.password_hash, u.status, u.created_at, r.name as role
     from users u join roles r on r.id = u.role_id
     where u.id = $1`,
    [rows[0].id]
  );
  const snapshot = userRow.rows[0];
  await logAudit('users', snapshot.id, 'create', req.user.id, { snapshot });
  res.status(201).json({ id: snapshot.id, email: snapshot.email });
});

app.patch('/users/:id', requireRole(['admin']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  const { role, status, password } = req.body || {};

  const updates = [];
  const params = [];
  if (role) {
    const roleRow = await query('select id from roles where name = $1', [role]);
    if (!roleRow.rows[0]) return res.status(400).json({ error: 'invalid role' });
    params.push(roleRow.rows[0].id);
    updates.push(`role_id = $${params.length}`);
  }
  if (status) {
    if (!ALLOWED_USER_STATUSES.has(status)) return res.status(400).json({ error: 'invalid status' });
    params.push(status);
    updates.push(`status = $${params.length}`);
  }
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    params.push(hash);
    updates.push(`password_hash = $${params.length}`);
  }

  if (!updates.length) return res.status(400).json({ error: 'no fields to update' });
  params.push(id);
  const sql = `update users set ${updates.join(', ')} where id = $${params.length} returning id, email`;
  const { rows } = await query(sql, params);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  const userRow = await query(
    `select u.id, u.email, u.password_hash, u.status, u.created_at, r.name as role
     from users u join roles r on r.id = u.role_id
     where u.id = $1`,
    [id]
  );
  const snapshot = userRow.rows[0];
  await logAudit('users', id, 'update', req.user.id, { diff: req.body, snapshot });
  res.json(rows[0]);
});

app.get('/categories', requireAuth, async (_req, res) => {
  const { limit, offset } = parseLimitOffset(_req.query);
  const { rows } = await query(
    `select c.*, cv.id as version_id
     from categories c
     left join category_versions cv on cv.category_id = c.id and cv.is_current = true
     order by c.id desc
     limit $1 offset $2`,
    [limit, offset]
  );
  res.json(rows);
});

app.post('/categories', requireRole(['admin', 'accountant']), async (req, res) => {
  const { name, type, parent_id = null } = req.body || {};
  if (!name || !type) return res.status(400).json({ error: 'name and type required' });
  if (!ALLOWED_CATEGORY_TYPES.has(type)) return res.status(400).json({ error: 'invalid type' });
  const client = await getClient();
  try {
    await client.query('begin');
    const { rows } = await client.query(
      'insert into categories (name, type, parent_id) values ($1,$2,$3) returning *',
      [name, type, parent_id]
    );
    const version = await client.query(
      'insert into category_versions (category_id, name, type, parent_id) values ($1,$2,$3,$4) returning *',
      [rows[0].id, rows[0].name, rows[0].type, rows[0].parent_id]
    );
    await logAudit('categories', rows[0].id, 'create', req.user.id, { snapshot: rows[0], version: version.rows[0] }, client);
    await client.query('commit');
    res.status(201).json({ ...rows[0], version_id: version.rows[0].id });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
});

app.patch('/categories/:id', requireRole(['admin', 'accountant']), async (req, res) => {
  const id = Number(req.params.id);
  const { name, type } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  if (!name && !type) return res.status(400).json({ error: 'name or type required' });
  if (type && !ALLOWED_CATEGORY_TYPES.has(type)) return res.status(400).json({ error: 'invalid type' });
  const client = await getClient();
  try {
    await client.query('begin');
    const current = await client.query('select * from categories where id = $1', [id]);
    if (!current.rows[0]) {
      await client.query('rollback');
      return res.status(404).json({ error: 'not found' });
    }
    const next = {
      name: name ?? current.rows[0].name,
      type: type ?? current.rows[0].type,
      parent_id: current.rows[0].parent_id,
    };

    const updates = [];
    const params = [];
    if (name) { params.push(name); updates.push(`name = $${params.length}`); }
    if (type) { params.push(type); updates.push(`type = $${params.length}`); }
    params.push(id);
    const { rows } = await client.query(`update categories set ${updates.join(', ')} where id = $${params.length} returning *`, params);
    if (!rows[0]) {
      await client.query('rollback');
      return res.status(404).json({ error: 'not found' });
    }

    await client.query(
      'update category_versions set is_current = false, valid_to = now() where category_id = $1 and is_current = true',
      [id]
    );
    const version = await client.query(
      'insert into category_versions (category_id, name, type, parent_id) values ($1,$2,$3,$4) returning *',
      [id, next.name, next.type, next.parent_id]
    );

    await logAudit('categories', id, 'update', req.user.id, { diff: req.body, snapshot: rows[0], version: version.rows[0] }, client);
    await client.query('commit');
    res.json({ ...rows[0], version_id: version.rows[0].id });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
});

app.delete('/categories/:id', requireRole(['admin', 'accountant']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    await query('delete from categories where id = $1', [id]);
    await logAudit('categories', id, 'delete', req.user.id, null);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: 'cannot delete category in use' });
  }
});

app.get('/projects', requireAuth, async (_req, res) => {
  const { limit, offset } = parseLimitOffset(_req.query);
  const { rows } = await query(
    `select p.*, pv.id as version_id
     from projects p
     left join project_versions pv on pv.project_id = p.id and pv.is_current = true
     order by p.id desc
     limit $1 offset $2`,
    [limit, offset]
  );
  res.json(rows);
});

app.post('/projects', requireRole(['admin', 'accountant']), async (req, res) => {
  const { name, status = 'active' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  if (status && !ALLOWED_PROJECT_STATUSES.has(status)) return res.status(400).json({ error: 'invalid status' });
  const client = await getClient();
  try {
    await client.query('begin');
    const { rows } = await client.query(
      'insert into projects (name, status) values ($1,$2) returning *',
      [name, status]
    );
    const version = await client.query(
      'insert into project_versions (project_id, name, status) values ($1,$2,$3) returning *',
      [rows[0].id, rows[0].name, rows[0].status]
    );
    await logAudit('projects', rows[0].id, 'create', req.user.id, { snapshot: rows[0], version: version.rows[0] }, client);
    await client.query('commit');
    res.status(201).json({ ...rows[0], version_id: version.rows[0].id });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
});

app.patch('/projects/:id', requireRole(['admin', 'accountant']), async (req, res) => {
  const id = Number(req.params.id);
  const { name, status } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  if (!name && !status) return res.status(400).json({ error: 'name or status required' });
  if (status && !ALLOWED_PROJECT_STATUSES.has(status)) return res.status(400).json({ error: 'invalid status' });
  const client = await getClient();
  try {
    await client.query('begin');
    const current = await client.query('select * from projects where id = $1', [id]);
    if (!current.rows[0]) {
      await client.query('rollback');
      return res.status(404).json({ error: 'not found' });
    }
    const next = {
      name: name ?? current.rows[0].name,
      status: status ?? current.rows[0].status,
    };

    const updates = [];
    const params = [];
    if (name) { params.push(name); updates.push(`name = $${params.length}`); }
    if (status) { params.push(status); updates.push(`status = $${params.length}`); }
    params.push(id);
    const { rows } = await client.query(`update projects set ${updates.join(', ')} where id = $${params.length} returning *`, params);
    if (!rows[0]) {
      await client.query('rollback');
      return res.status(404).json({ error: 'not found' });
    }

    await client.query(
      'update project_versions set is_current = false, valid_to = now() where project_id = $1 and is_current = true',
      [id]
    );
    const version = await client.query(
      'insert into project_versions (project_id, name, status) values ($1,$2,$3) returning *',
      [id, next.name, next.status]
    );

    await logAudit('projects', id, 'update', req.user.id, { diff: req.body, snapshot: rows[0], version: version.rows[0] }, client);
    await client.query('commit');
    res.json({ ...rows[0], version_id: version.rows[0].id });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
});

app.delete('/projects/:id', requireRole(['admin', 'accountant']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    await query('delete from projects where id = $1', [id]);
    await logAudit('projects', id, 'delete', req.user.id, null);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: 'cannot delete project in use' });
  }
});

app.get('/counterparties', requireAuth, async (_req, res) => {
  const { limit, offset } = parseLimitOffset(_req.query);
  const { rows } = await query(
    `select cp.*, cv.id as version_id
     from counterparties cp
     left join counterparty_versions cv on cv.counterparty_id = cp.id and cv.is_current = true
     order by cp.id desc
     limit $1 offset $2`,
    [limit, offset]
  );
  res.json(rows);
});

app.post('/counterparties', requireRole(['admin', 'accountant']), async (req, res) => {
  const { name, inn = null, type = null } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const client = await getClient();
  try {
    await client.query('begin');
    const { rows } = await client.query(
      'insert into counterparties (name, inn, type) values ($1,$2,$3) returning *',
      [name, inn, type]
    );
    const version = await client.query(
      'insert into counterparty_versions (counterparty_id, name, inn, type) values ($1,$2,$3,$4) returning *',
      [rows[0].id, rows[0].name, rows[0].inn, rows[0].type]
    );
    await logAudit('counterparties', rows[0].id, 'create', req.user.id, { snapshot: rows[0], version: version.rows[0] }, client);
    await client.query('commit');
    res.status(201).json({ ...rows[0], version_id: version.rows[0].id });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
});

app.patch('/counterparties/:id', requireRole(['admin', 'accountant']), async (req, res) => {
  const id = Number(req.params.id);
  const { name, inn, type } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  if (!name && !inn && !type) return res.status(400).json({ error: 'name, inn or type required' });
  const client = await getClient();
  try {
    await client.query('begin');
    const current = await client.query('select * from counterparties where id = $1', [id]);
    if (!current.rows[0]) {
      await client.query('rollback');
      return res.status(404).json({ error: 'not found' });
    }
    const next = {
      name: name ?? current.rows[0].name,
      inn: inn ?? current.rows[0].inn,
      type: type ?? current.rows[0].type,
    };

    const updates = [];
    const params = [];
    if (name) { params.push(name); updates.push(`name = $${params.length}`); }
    if (inn) { params.push(inn); updates.push(`inn = $${params.length}`); }
    if (type) { params.push(type); updates.push(`type = $${params.length}`); }
    params.push(id);
    const { rows } = await client.query(`update counterparties set ${updates.join(', ')} where id = $${params.length} returning *`, params);
    if (!rows[0]) {
      await client.query('rollback');
      return res.status(404).json({ error: 'not found' });
    }

    await client.query(
      'update counterparty_versions set is_current = false, valid_to = now() where counterparty_id = $1 and is_current = true',
      [id]
    );
    const version = await client.query(
      'insert into counterparty_versions (counterparty_id, name, inn, type) values ($1,$2,$3,$4) returning *',
      [id, next.name, next.inn, next.type]
    );

    await logAudit('counterparties', id, 'update', req.user.id, { diff: req.body, snapshot: rows[0], version: version.rows[0] }, client);
    await client.query('commit');
    res.json({ ...rows[0], version_id: version.rows[0].id });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
});

app.delete('/counterparties/:id', requireRole(['admin', 'accountant']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    await query('delete from counterparties where id = $1', [id]);
    await logAudit('counterparties', id, 'delete', req.user.id, null);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: 'cannot delete counterparty in use' });
  }
});

app.get('/operations', requireAuth, async (req, res) => {
  if (req.query.from && !isISODate(req.query.from)) return res.status(400).json({ error: 'invalid from date' });
  if (req.query.to && !isISODate(req.query.to)) return res.status(400).json({ error: 'invalid to date' });
  const from = parseDate(req.query.from, '1900-01-01');
  const to = parseDate(req.query.to, '2999-12-31');
  const type = req.query.type;
  const status = req.query.status;
  const { limit, offset } = parseLimitOffset(req.query);

  const filters = ['operation_date >= $1', 'operation_date <= $2'];
  const params = [from, to];
  if (type) {
    if (!ALLOWED_TYPES.has(type)) return res.status(400).json({ error: 'invalid type' });
    params.push(type);
    filters.push(`type = $${params.length}`);
  }
  if (status) {
    if (!ALLOWED_STATUSES.has(status)) return res.status(400).json({ error: 'invalid status' });
    params.push(status);
    filters.push(`status = $${params.length}`);
  }

  const sql = `select o.*,
    cv.name as category_name,
    pv.name as project_name,
    cpv.name as counterparty_name
    from operations o
    left join category_versions cv on cv.id = o.category_version_id
    left join project_versions pv on pv.id = o.project_version_id
    left join counterparty_versions cpv on cpv.id = o.counterparty_version_id
    where ${filters.join(' and ')}
    order by operation_date desc, id desc
    limit $${params.length + 1} offset $${params.length + 2}`;
  const { rows } = await query(sql, [...params, limit, offset]);
  res.json(rows);
});

app.post('/operations', requireRole(['admin', 'accountant']), async (req, res) => {
  const {
    type,
    amount,
    category_id,
    project_id,
    counterparty_id,
    currency = 'RUB',
    vat_included = false,
    vat_amount = 0,
    operation_date,
    status = 'draft',
    comment = null,
    adjustment = false,
  } = req.body || {};

  if (!type || amount == null || !operation_date) {
    return res.status(400).json({ error: 'type, amount, operation_date are required' });
  }
  if (!ALLOWED_TYPES.has(type)) return res.status(400).json({ error: 'invalid type' });
  if (!validateAmount(type, Number(amount))) return res.status(400).json({ error: 'invalid amount' });
  if (!isISODate(operation_date)) return res.status(400).json({ error: 'invalid operation_date' });
  if (status && !ALLOWED_STATUSES.has(status)) return res.status(400).json({ error: 'invalid status' });
  const client = await getClient();
  try {
    await client.query('begin');
    const categoryVersionId = category_id ? await getCurrentCategoryVersionId(client, category_id) : null;
    const projectVersionId = project_id ? await getCurrentProjectVersionId(client, project_id) : null;
    const counterpartyVersionId = counterparty_id ? await getCurrentCounterpartyVersionId(client, counterparty_id) : null;

    const { rows } = await client.query(
      `insert into operations
        (type, amount, category_id, category_version_id, project_id, project_version_id, counterparty_id, counterparty_version_id,
         currency, vat_included, vat_amount, operation_date, status, comment, adjustment, created_by)
       values
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       returning *`,
      [
        type,
        amount,
        category_id,
        categoryVersionId,
        project_id,
        projectVersionId,
        counterparty_id,
        counterpartyVersionId,
        currency,
        vat_included,
        vat_amount,
        operation_date,
        status,
        comment,
        adjustment,
        req.user.id,
      ]
    );

    if (rows[0].status === 'confirmed') {
      await upsertJournalAndLedger(client, rows[0], req.user.id);
    }
    await logAudit('operations', rows[0].id, 'create', req.user.id, { snapshot: rows[0] }, client);
    await client.query('commit');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
});

app.patch('/operations/:id', requireRole(['admin', 'accountant']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

  const fields = [
    'type',
    'amount',
    'category_id',
    'project_id',
    'counterparty_id',
    'currency',
    'vat_included',
    'vat_amount',
    'operation_date',
    'status',
    'comment',
    'adjustment',
  ];

  const client = await getClient();
  try {
    await client.query('begin');
    const updates = [];
    const params = [];
    let existingType = null;
    const existingRow = await client.query('select * from operations where id = $1', [id]);
    if (!existingRow.rows[0]) {
      await client.query('rollback');
      return res.status(404).json({ error: 'not found' });
    }
    const prevOp = existingRow.rows[0];
    if ('amount' in req.body && !('type' in req.body)) {
      existingType = prevOp.type;
    }
    for (const field of fields) {
      if (field in req.body) {
        if (field === 'type' && !ALLOWED_TYPES.has(req.body[field])) {
          await client.query('rollback');
          return res.status(400).json({ error: 'invalid type' });
        }
        if (field === 'status' && !ALLOWED_STATUSES.has(req.body[field])) {
          await client.query('rollback');
          return res.status(400).json({ error: 'invalid status' });
        }
        if (field === 'operation_date' && !isISODate(req.body[field])) {
          await client.query('rollback');
          return res.status(400).json({ error: 'invalid operation_date' });
        }
        if (field === 'amount') {
          const amount = Number(req.body[field]);
          const typeToCheck = req.body.type || existingType || 'income';
          if (!validateAmount(typeToCheck, amount)) {
            await client.query('rollback');
            return res.status(400).json({ error: 'invalid amount' });
          }
        }
        params.push(req.body[field]);
        updates.push(`${field} = $${params.length}`);
      }
    }

    if ('category_id' in req.body) {
      const cvId = req.body.category_id ? await getCurrentCategoryVersionId(client, req.body.category_id) : null;
      params.push(cvId);
      updates.push(`category_version_id = $${params.length}`);
    }
    if ('project_id' in req.body) {
      const pvId = req.body.project_id ? await getCurrentProjectVersionId(client, req.body.project_id) : null;
      params.push(pvId);
      updates.push(`project_version_id = $${params.length}`);
    }
    if ('counterparty_id' in req.body) {
      const cvId = req.body.counterparty_id ? await getCurrentCounterpartyVersionId(client, req.body.counterparty_id) : null;
      params.push(cvId);
      updates.push(`counterparty_version_id = $${params.length}`);
    }

    if (!updates.length) {
      await client.query('rollback');
      return res.status(400).json({ error: 'no fields to update' });
    }

    params.push(id);
    const sql = `update operations set ${updates.join(', ')}, updated_at = now() where id = $${params.length} returning *`;
    const { rows } = await client.query(sql, params);
    if (!rows[0]) {
      await client.query('rollback');
      return res.status(404).json({ error: 'not found' });
    }

    if (rows[0].status === 'confirmed') {
      await upsertJournalAndLedger(client, rows[0], req.user.id);
      if (prevOp.operation_date !== rows[0].operation_date) {
        await rebuildReportsForRange(client, prevOp.operation_date, prevOp.operation_date);
      }
    } else if (prevOp.status === 'confirmed' && rows[0].status !== 'confirmed') {
      await client.query('delete from journal where operation_id = $1', [rows[0].id]);
      await rebuildReportsForRange(client, prevOp.operation_date, prevOp.operation_date);
    }

    await logAudit('operations', rows[0].id, 'update', req.user.id, { diff: req.body, snapshot: rows[0] }, client);
    await client.query('commit');
    res.json(rows[0]);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
});

app.delete('/operations/:id', requireRole(['admin', 'accountant']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  const client = await getClient();
  try {
    await client.query('begin');
    const opRow = await client.query('select * from operations where id = $1 for update', [id]);
    if (!opRow.rows[0]) {
      await client.query('rollback');
      return res.status(404).json({ error: 'not found' });
    }
    const op = opRow.rows[0];
    await client.query('delete from operations where id = $1', [id]);
    if (op.status === 'confirmed') {
      await rebuildReportsForRange(client, op.operation_date, op.operation_date);
    }
    await logAudit('operations', id, 'delete', req.user.id, { snapshot: op }, client);
    await client.query('commit');
    res.json({ ok: true });
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
});

app.post('/operations/:id/confirm', requireRole(['admin', 'accountant']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

  const client = await getClient();
  try {
    await client.query('begin');
    const opRow = await client.query('select * from operations where id = $1 for update', [id]);
    if (!opRow.rows[0]) {
      await client.query('rollback');
      return res.status(404).json({ error: 'not found' });
    }
    let op = opRow.rows[0];
    const wasConfirmed = op.status === 'confirmed';

    const attachmentRequired = await isAttachmentRequired(op);
    if (attachmentRequired) {
      try {
        const att = await client.query(
          `select count(*)::int as cnt
           from attachments
           where entity = 'operations' and entity_id = $1`,
          [id]
        );
        if (Number(att.rows[0]?.cnt || 0) === 0) {
          await client.query('rollback');
          return res.status(400).json({ error: 'attachment required before confirmation' });
        }
      } catch (err) {
        if (err.code !== '42P01') {
          throw err;
        }
      }
    }

    if (!wasConfirmed) {
      const updated = await client.query(
        'update operations set status = $1, updated_at = now() where id = $2 returning *',
        ['confirmed', id]
      );
      op = updated.rows[0];
    }

    await upsertJournalAndLedger(client, op, req.user.id);

    if (!wasConfirmed) {
      await logAudit('operations', op.id, 'confirm', req.user.id, { status: 'confirmed', snapshot: op }, client);
    }
    await client.query('commit');
    res.json(op);
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
});

app.post('/imports/csv', requireRole(['admin', 'accountant']), async (req, res) => {
  const csvText = req.body;
  if (!csvText || typeof csvText !== 'string') return res.status(400).json({ error: 'CSV body required' });

  const records = parseCsv(csvText, { columns: true, skip_empty_lines: true, trim: true });
  const client = await getClient();
  const results = { inserted: 0, errors: [] };

  try {
    await client.query('begin');

    for (let i = 0; i < records.length; i += 1) {
      const row = records[i];
      try {
        const type = row.type;
        const amount = Number(row.amount);
        const operation_date = row.date;
        if (!type || Number.isNaN(amount) || !operation_date) throw new Error('invalid required fields');
        if (!ALLOWED_TYPES.has(type)) throw new Error('invalid type');
        if (!validateAmount(type, amount)) throw new Error('invalid amount');
        if (!isISODate(operation_date)) throw new Error('invalid date');

        const categoryType = type === 'tax' ? 'tax' : (type === 'income' ? 'income' : 'expense');
        const category = await ensureCatalog(client, 'categories', row.category, categoryType, req.user.id);
        const project = await ensureCatalog(client, 'projects', row.project, null, req.user.id);
        const counterparty = await ensureCatalog(client, 'counterparties', row.counterparty, null, req.user.id);

        const status = row.status || 'draft';
    if (!ALLOWED_STATUSES.has(status)) throw new Error('invalid status');
        const vat_included = String(row.vat_included).toLowerCase() === 'true';
        const vat_amount = Number(row.vat_amount || 0);
        const comment = row.comment || null;

        const insertResult = await client.query(
          `insert into operations
            (type, amount, category_id, category_version_id, project_id, project_version_id, counterparty_id, counterparty_version_id,
             vat_included, vat_amount, operation_date, status, comment, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
            vat_included,
            vat_amount,
            operation_date,
            status,
            comment,
            req.user.id,
          ]
        );
        await logAudit('operations', insertResult.rows[0].id, 'create', req.user.id, { snapshot: insertResult.rows[0] }, client);
        if (status === 'confirmed') {
          const op = insertResult.rows[0];
          if (op) {
            await upsertJournalAndLedger(client, op, req.user.id);
          }
        }
        results.inserted += 1;
      } catch (err) {
        results.errors.push({ row: i + 1, error: err.message });
      }
    }

    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }

  await logAudit('imports', 0, 'csv', req.user.id, results);
  res.json(results);
});

async function ensureCatalog(client, table, name, type, userId) {
  if (!name) return null;
  if (table === 'categories') {
    const found = await client.query('select id from categories where name = $1 and type = $2', [name, type]);
    if (found.rows[0]) {
      const versionId = await getCurrentCategoryVersionId(client, found.rows[0].id);
      return { id: found.rows[0].id, version_id: versionId };
    }
    const created = await client.query('insert into categories (name, type) values ($1,$2) returning *', [name, type]);
    const version = await client.query(
      'insert into category_versions (category_id, name, type, parent_id) values ($1,$2,$3,$4) returning *',
      [created.rows[0].id, created.rows[0].name, created.rows[0].type, created.rows[0].parent_id]
    );
    await logAudit(
      'categories',
      created.rows[0].id,
      'create',
      userId,
      { snapshot: created.rows[0], version: version.rows[0] },
      client
    );
    return { id: created.rows[0].id, version_id: version.rows[0].id };
  }
  const found = await client.query(`select id from ${table} where name = $1`, [name]);
  if (found.rows[0]) {
    if (table === 'projects') {
      const versionId = await getCurrentProjectVersionId(client, found.rows[0].id);
      return { id: found.rows[0].id, version_id: versionId };
    }
    if (table === 'counterparties') {
      const versionId = await getCurrentCounterpartyVersionId(client, found.rows[0].id);
      return { id: found.rows[0].id, version_id: versionId };
    }
    return { id: found.rows[0].id, version_id: null };
  }
  const created = await client.query(`insert into ${table} (name) values ($1) returning *`, [name]);
  if (table === 'projects') {
    const version = await client.query(
      'insert into project_versions (project_id, name, status) values ($1,$2,$3) returning *',
      [created.rows[0].id, created.rows[0].name, created.rows[0].status]
    );
    await logAudit(
      'projects',
      created.rows[0].id,
      'create',
      userId,
      { snapshot: created.rows[0], version: version.rows[0] },
      client
    );
    return { id: created.rows[0].id, version_id: version.rows[0].id };
  }
  if (table === 'counterparties') {
    const version = await client.query(
      'insert into counterparty_versions (counterparty_id, name, inn, type) values ($1,$2,$3,$4) returning *',
      [created.rows[0].id, created.rows[0].name, created.rows[0].inn, created.rows[0].type]
    );
    await logAudit(
      'counterparties',
      created.rows[0].id,
      'create',
      userId,
      { snapshot: created.rows[0], version: version.rows[0] },
      client
    );
    return { id: created.rows[0].id, version_id: version.rows[0].id };
  }
  await logAudit(table, created.rows[0].id, 'create', userId, { snapshot: created.rows[0] }, client);
  return { id: created.rows[0].id, version_id: null };
}

app.get('/profit', requireAuth, async (req, res) => {
  if (req.query.from && !isISODate(req.query.from)) return res.status(400).json({ error: 'invalid from date' });
  if (req.query.to && !isISODate(req.query.to)) return res.status(400).json({ error: 'invalid to date' });
  const from = parseDate(req.query.from, '1900-01-01');
  const to = parseDate(req.query.to, '2999-12-31');
  const fromMonth = monthStart(from);
  const toMonth = monthStart(to);
  const payload = await withCache(`reports:profit:${fromMonth}:${toMonth}`, 45, async () => {
    const { rows } = await query(
      `select coalesce(sum(net_profit), 0) as net_profit
       from report_profit_monthly
       where month >= $1 and month <= $2`,
      [fromMonth, toMonth]
    );
    return { from, to, net_profit: Number(rows[0].net_profit) };
  });
  res.json(payload);
});

app.get('/reports/dynamics', requireAuth, async (req, res) => {
  if (req.query.from && !isISODate(req.query.from)) return res.status(400).json({ error: 'invalid from date' });
  if (req.query.to && !isISODate(req.query.to)) return res.status(400).json({ error: 'invalid to date' });
  const from = parseDate(req.query.from, '1900-01-01');
  const to = parseDate(req.query.to, '2999-12-31');
  const fromMonth = monthStart(from);
  const toMonth = monthStart(to);
  const payload = await withCache(`reports:dynamics:${fromMonth}:${toMonth}`, 45, async () => {
    const { rows } = await query(
      `select to_char(month, 'YYYY-MM') as month, net_profit
       from report_profit_monthly
       where month >= $1 and month <= $2
       order by month`,
      [fromMonth, toMonth]
    );
    return { from, to, rows: rows.map(r => ({ month: r.month, net_profit: Number(r.net_profit) })) };
  });
  res.json(payload);
});

app.get('/reports/structure', requireAuth, async (req, res) => {
  if (req.query.from && !isISODate(req.query.from)) return res.status(400).json({ error: 'invalid from date' });
  if (req.query.to && !isISODate(req.query.to)) return res.status(400).json({ error: 'invalid to date' });
  const from = parseDate(req.query.from, '1900-01-01');
  const to = parseDate(req.query.to, '2999-12-31');
  const fromMonth = monthStart(from);
  const toMonth = monthStart(to);
  const payload = await withCache(`reports:structure:${fromMonth}:${toMonth}`, 45, async () => {
    const { rows } = await query(
      `select coalesce(cv.name, 'No category') as category, sum(r.total) as total
       from report_expense_structure r
       left join category_versions cv on cv.id = r.category_version_id
       where r.month >= $1 and r.month <= $2
       group by 1
       order by total desc`,
      [fromMonth, toMonth]
    );
    return { from, to, rows: rows.map(r => ({ category: r.category, total: Number(r.total) })) };
  });
  res.json(payload);
});

app.get('/reports/projects', requireAuth, async (req, res) => {
  if (req.query.from && !isISODate(req.query.from)) return res.status(400).json({ error: 'invalid from date' });
  if (req.query.to && !isISODate(req.query.to)) return res.status(400).json({ error: 'invalid to date' });
  const from = parseDate(req.query.from, '1900-01-01');
  const to = parseDate(req.query.to, '2999-12-31');
  const fromMonth = monthStart(from);
  const toMonth = monthStart(to);
  const payload = await withCache(`reports:projects:${fromMonth}:${toMonth}`, 45, async () => {
    const { rows } = await query(
      `select coalesce(pv.name, 'No project') as project, sum(r.profit) as profit
       from report_project_profit r
       left join project_versions pv on pv.id = r.project_version_id
       where r.month >= $1 and r.month <= $2
       group by 1
       order by profit desc`,
      [fromMonth, toMonth]
    );
    return { from, to, rows: rows.map(r => ({ project: r.project, profit: Number(r.profit) })) };
  });
  res.json(payload);
});

app.get('/periods', requireAuth, async (_req, res) => {
  const { rows } = await query('select * from periods order by start_date desc');
  res.json(rows);
});

app.post('/periods', requireRole(['admin', 'accountant']), async (req, res) => {
  const { start_date, end_date } = req.body || {};
  if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date required' });
  if (!isISODate(start_date) || !isISODate(end_date)) return res.status(400).json({ error: 'invalid date' });
  if (start_date > end_date) return res.status(400).json({ error: 'start_date after end_date' });
  const { rows } = await query(
    'insert into periods (start_date, end_date) values ($1,$2) returning *',
    [start_date, end_date]
  );
  await logAudit('periods', rows[0].id, 'create', req.user.id, rows[0]);
  res.status(201).json(rows[0]);
});

app.patch('/periods/:id', requireRole(['admin', 'accountant']), async (req, res) => {
  const id = Number(req.params.id);
  const { start_date, end_date } = req.body || {};
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  if (!start_date && !end_date) return res.status(400).json({ error: 'start_date or end_date required' });
  if (start_date && !isISODate(start_date)) return res.status(400).json({ error: 'invalid start_date' });
  if (end_date && !isISODate(end_date)) return res.status(400).json({ error: 'invalid end_date' });
  if (start_date && end_date && start_date > end_date) return res.status(400).json({ error: 'start_date after end_date' });

  const updates = [];
  const params = [];
  if (start_date) { params.push(start_date); updates.push(`start_date = $${params.length}`); }
  if (end_date) { params.push(end_date); updates.push(`end_date = $${params.length}`); }
  params.push(id);
  const { rows } = await query(`update periods set ${updates.join(', ')} where id = $${params.length} returning *`, params);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await logAudit('periods', id, 'update', req.user.id, req.body);
  res.json(rows[0]);
});

app.post('/periods/:id/close', requireRole(['admin', 'accountant']), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });

  const period = await query('select * from periods where id = $1', [id]);
  if (!period.rows[0]) return res.status(404).json({ error: 'period not found' });
  const periodWizardEnabled = await isFeatureEnabled('period_wizard');

  if (periodWizardEnabled) {
    try {
      const checks = await buildPrecloseChecks(id);
      await query('delete from period_close_checks where period_id = $1', [id]);
      for (const c of checks) {
        await query(
          `insert into period_close_checks (period_id, check_key, severity, details)
           values ($1,$2,$3,$4::jsonb)`,
          [id, c.check_key, c.severity, JSON.stringify(c.details)]
        );
      }
      const blockers = checks.filter(c => c.severity === 'block');
      if (blockers.length) {
        return res.status(400).json({ error: 'period close blocked', checks });
      }
    } catch (err) {
      if (err.code !== '42P01') {
        throw err;
      }
    }
  }

  const p = period.rows[0];
  const client = await getClient();
  try {
    await client.query('begin');
    await client.query(
      'update operations set period_id = $1 where operation_date >= $2 and operation_date <= $3 and period_id is null',
      [id, p.start_date, p.end_date]
    );

    const snapshot = await calcPeriodSnapshot(client, p.start_date, p.end_date);
    const { income, expense, tax, gross, net } = snapshot;

    await client.query(
      'insert into profit_snapshots (period_id, gross_profit, tax_total, net_profit, created_by) values ($1,$2,$3,$4,$5)',
      [id, gross, tax, net, req.user.id]
    );

    await client.query('update periods set status = $1 where id = $2', ['closed', id]);
    await logAudit('periods', id, 'close', req.user.id, { status: 'closed', snapshot: { id, start_date: p.start_date, end_date: p.end_date } }, client);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }

  res.json({ ok: true });
});

app.get('/snapshots', requireAuth, async (_req, res) => {
  const { rows } = await query(
    `select s.*, p.start_date, p.end_date
     from profit_snapshots s join periods p on p.id = s.period_id
     order by s.id desc`
  );
  res.json(rows);
});

app.get('/audit', requireRole(['admin']), async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  const { rows } = await query(
    `select a.*, u.email as user_email
     from audit_logs a left join users u on u.id = a.user_id
     order by a.id desc
     limit $1`,
    [limit]
  );
  res.json(rows);
});

app.get('/events', requireRole(['admin']), async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 200), 1000);
  const { rows } = await query(
    `select e.*, u.email as actor_email
     from domain_events e left join users u on u.id = e.actor_id
     order by e.id desc
     limit $1`,
    [limit]
  );
  res.json(rows);
});

registerFeatureFlagRoutes({ app, requireAuth, requireRole });
registerFinanceCenterRoutes({ app, requireAuth, requireFeature, query });
registerReportBuilderRoutes({ app, requireAuth, requireFeature, query });
registerOperationsV2Routes({ app, requireAuth, requireFeature, query });
registerPeriodWizardRoutes({ app, requireAuth, requireRole, requireFeature, query });
registerScenarioRoutes({ app, requireAuth, requireFeature, query, logAudit });
registerQualityRoutes({ app, requireAuth, requireRole, requireFeature, query, logAudit });
registerImportV2Routes({ app, requireAuth, requireRole, requireFeature, query, logAudit });
registerAccessControlRoutes({ app, requireRole, requireFeature, query, logAudit });
registerAttachmentRoutes({ app, requireAuth, requireRole, requireFeature, query, logAudit, jwtSecret: JWT_SECRET });
registerUiPrefsRoutes({ app, requireAuth, query });

await ensureAccounts({ query });
await ensureAdmin();
await ensureFeatureFlags();
await backfillLedgerForConfirmedOps();

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
