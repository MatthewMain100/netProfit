import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const ACCOUNT_CODES = {
  CASH: 'CASH',
  REVENUE: 'REVENUE',
  EXPENSE: 'EXPENSE',
  TAX_EXPENSE: 'TAX_EXPENSE',
  TAX_PAYABLE: 'TAX_PAYABLE',
  ADJ_INCOME: 'ADJ_INCOME',
  ADJ_EXPENSE: 'ADJ_EXPENSE',
};

async function ensureAccounts(client) {
  await client.query(
    `insert into accounts (code, name, type, is_system) values
      ($1,$2,$3,true),
      ($4,$5,$6,true),
      ($7,$8,$9,true),
      ($10,$11,$12,true),
      ($13,$14,$15,true),
      ($16,$17,$18,true),
      ($19,$20,$21,true)
     on conflict (code) do nothing`,
    [
      ACCOUNT_CODES.CASH, 'Cash/Bank', 'asset',
      ACCOUNT_CODES.REVENUE, 'Revenue', 'income',
      ACCOUNT_CODES.EXPENSE, 'Expense', 'expense',
      ACCOUNT_CODES.TAX_EXPENSE, 'Tax Expense', 'expense',
      ACCOUNT_CODES.TAX_PAYABLE, 'Tax Payable', 'liability',
      ACCOUNT_CODES.ADJ_INCOME, 'Adjustments (Income)', 'income',
      ACCOUNT_CODES.ADJ_EXPENSE, 'Adjustments (Expense)', 'expense',
    ]
  );
}

async function ensureRoles(client) {
  await client.query("insert into roles (name) values ('accountant'),('manager'),('admin') on conflict do nothing");
}

async function getAccountMap(client) {
  const { rows } = await client.query('select id, code from accounts');
  const map = new Map();
  for (const r of rows) map.set(r.code, r.id);
  return map;
}

function buildLedgerEntries(op, accountMap) {
  const amount = Number(op.amount);
  const absAmount = Math.abs(amount);
  const entries = [];

  const base = {
    operation_id: op.id,
    operation_date: op.operation_date,
    category_id: op.category_id || null,
    category_version_id: op.category_version_id || null,
    project_id: op.project_id || null,
    project_version_id: op.project_version_id || null,
    counterparty_id: op.counterparty_id || null,
    counterparty_version_id: op.counterparty_version_id || null,
  };

  if (op.type === 'income') {
    entries.push({ ...base, account_id: accountMap.get(ACCOUNT_CODES.CASH), debit: amount, credit: 0 });
    entries.push({ ...base, account_id: accountMap.get(ACCOUNT_CODES.REVENUE), debit: 0, credit: amount });
  } else if (op.type === 'expense') {
    entries.push({ ...base, account_id: accountMap.get(ACCOUNT_CODES.EXPENSE), debit: amount, credit: 0 });
    entries.push({ ...base, account_id: accountMap.get(ACCOUNT_CODES.CASH), debit: 0, credit: amount });
  } else if (op.type === 'tax') {
    entries.push({ ...base, account_id: accountMap.get(ACCOUNT_CODES.TAX_EXPENSE), debit: amount, credit: 0 });
    entries.push({ ...base, account_id: accountMap.get(ACCOUNT_CODES.TAX_PAYABLE), debit: 0, credit: amount });
  } else if (op.type === 'adjustment') {
    if (amount > 0) {
      entries.push({ ...base, account_id: accountMap.get(ACCOUNT_CODES.CASH), debit: absAmount, credit: 0 });
      entries.push({ ...base, account_id: accountMap.get(ACCOUNT_CODES.ADJ_INCOME), debit: 0, credit: absAmount });
    } else {
      entries.push({ ...base, account_id: accountMap.get(ACCOUNT_CODES.ADJ_EXPENSE), debit: absAmount, credit: 0 });
      entries.push({ ...base, account_id: accountMap.get(ACCOUNT_CODES.CASH), debit: 0, credit: absAmount });
    }
  }

  const totalDebit = entries.reduce((s, e) => s + Number(e.debit || 0), 0);
  const totalCredit = entries.reduce((s, e) => s + Number(e.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.0001) {
    throw new Error('Ledger is not balanced');
  }

  return entries;
}

async function insertJournalAndLedger(client, op, userId) {
  const accountMap = await getAccountMap(client);
  const required = Object.values(ACCOUNT_CODES);
  for (const code of required) {
    if (!accountMap.has(code)) {
      throw new Error(`Missing required account: ${code}`);
    }
  }

  const memo = `operation ${op.id} ${op.type}`;
  const created = await client.query(
    'insert into journal (operation_id, created_by, memo) values ($1,$2,$3) returning id',
    [op.id, userId || null, memo]
  );
  const journalId = created.rows[0].id;

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
     values ${values.join(',')}`,
    params
  );
}

function eventAction(eventType) {
  const parts = String(eventType || '').split('.');
  return parts.slice(1).join('.') || parts[0];
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

function normalizeOperationSnapshot(snapshot, occurredAt, fallbackId) {
  if (!snapshot) return null;
  return {
    id: snapshot.id ?? fallbackId,
    type: snapshot.type,
    category_id: snapshot.category_id ?? null,
    category_version_id: snapshot.category_version_id ?? null,
    project_id: snapshot.project_id ?? null,
    project_version_id: snapshot.project_version_id ?? null,
    counterparty_id: snapshot.counterparty_id ?? null,
    counterparty_version_id: snapshot.counterparty_version_id ?? null,
    amount: snapshot.amount,
    currency: snapshot.currency ?? 'RUB',
    vat_included: snapshot.vat_included ?? false,
    vat_amount: snapshot.vat_amount ?? 0,
    operation_date: snapshot.operation_date,
    period_id: snapshot.period_id ?? null,
    status: snapshot.status ?? 'draft',
    comment: snapshot.comment ?? null,
    adjustment: snapshot.adjustment ?? false,
    created_at: snapshot.created_at ?? occurredAt,
    updated_at: snapshot.updated_at ?? occurredAt,
  };
}

async function applyOperationEvent(client, event) {
  const action = eventAction(event.event_type);
  const payload = event.payload || {};
  const snapshot = normalizeOperationSnapshot(payload.snapshot || payload, event.occurred_at, event.entity_id);

  if (action === 'create') {
    if (!snapshot) return;
    await client.query(
      `insert into operations
       (id, type, category_id, category_version_id, project_id, project_version_id, counterparty_id, counterparty_version_id,
         amount, currency, vat_included, vat_amount, operation_date,
         period_id, status, comment, adjustment, created_at, updated_at)
       values
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        snapshot.id,
        snapshot.type,
        snapshot.category_id,
        snapshot.category_version_id,
        snapshot.project_id,
        snapshot.project_version_id,
        snapshot.counterparty_id,
        snapshot.counterparty_version_id,
        snapshot.amount,
        snapshot.currency,
        snapshot.vat_included,
        snapshot.vat_amount,
        snapshot.operation_date,
        snapshot.period_id,
        snapshot.status,
        snapshot.comment,
        snapshot.adjustment,
        snapshot.created_at,
        snapshot.updated_at,
      ]
    );
  } else if (action === 'update') {
    if (payload.snapshot) {
      await client.query(
        `update operations set
          type = $1,
          category_id = $2,
          category_version_id = $3,
          project_id = $4,
          project_version_id = $5,
          counterparty_id = $6,
          counterparty_version_id = $7,
          amount = $8,
          currency = $9,
          vat_included = $10,
          vat_amount = $11,
          operation_date = $12,
          period_id = $13,
          status = $14,
          comment = $15,
          adjustment = $16,
          updated_at = $17
         where id = $18`,
        [
          snapshot.type,
          snapshot.category_id,
          snapshot.category_version_id,
          snapshot.project_id,
          snapshot.project_version_id,
          snapshot.counterparty_id,
          snapshot.counterparty_version_id,
          snapshot.amount,
          snapshot.currency,
          snapshot.vat_included,
          snapshot.vat_amount,
          snapshot.operation_date,
          snapshot.period_id,
          snapshot.status,
          snapshot.comment,
          snapshot.adjustment,
          snapshot.updated_at,
          snapshot.id,
        ]
      );
    } else if (payload.diff) {
      const diff = payload.diff;
      const fields = [];
      const params = [];
      let idx = 1;
      for (const [key, value] of Object.entries(diff)) {
        fields.push(`${key} = $${idx++}`);
        params.push(value);
      }
      fields.push(`updated_at = $${idx++}`);
      params.push(event.occurred_at);
      params.push(event.entity_id);
      if (fields.length) {
        await client.query(`update operations set ${fields.join(', ')} where id = $${idx}`, params);
      }
    }
  } else if (action === 'confirm') {
    if (payload.snapshot) {
      await client.query(
        `update operations set
          status = $1,
          updated_at = $2
         where id = $3`,
        [snapshot.status || 'confirmed', snapshot.updated_at, snapshot.id]
      );
    } else {
      await client.query(
        `update operations set status = 'confirmed', updated_at = $1 where id = $2`,
        [event.occurred_at, event.entity_id]
      );
    }
  } else if (action === 'delete') {
    await client.query('delete from operations where id = $1', [event.entity_id]);
  }
}

function normalizePeriodSnapshot(snapshot, occurredAt, fallbackId) {
  if (!snapshot) return null;
  return {
    id: snapshot.id ?? fallbackId,
    start_date: snapshot.start_date,
    end_date: snapshot.end_date,
    status: snapshot.status ?? 'open',
  };
}

async function applyPeriodEvent(client, event) {
  const action = eventAction(event.event_type);
  const payload = event.payload || {};
  const snapshot = normalizePeriodSnapshot(payload.snapshot || payload, event.occurred_at, event.entity_id);

  if (action === 'create') {
    if (!snapshot) return;
    await client.query(
      `insert into periods (id, start_date, end_date, status) values ($1,$2,$3,$4)`,
      [snapshot.id, snapshot.start_date, snapshot.end_date, snapshot.status]
    );
  } else if (action === 'update') {
    if (payload.snapshot) {
      await client.query(
        `update periods set start_date = $1, end_date = $2, status = $3 where id = $4`,
        [snapshot.start_date, snapshot.end_date, snapshot.status, snapshot.id]
      );
    } else if (payload.diff) {
      const diff = payload.diff;
      const fields = [];
      const params = [];
      let idx = 1;
      for (const [key, value] of Object.entries(diff)) {
        fields.push(`${key} = $${idx++}`);
        params.push(value);
      }
      params.push(event.entity_id);
      if (fields.length) {
        await client.query(`update periods set ${fields.join(', ')} where id = $${idx}`, params);
      }
    }
  } else if (action === 'close') {
    await client.query(
      `update periods set status = 'closed' where id = $1`,
      [event.entity_id]
    );
  }
}

async function applyCategoryEvent(client, event) {
  const action = eventAction(event.event_type);
  const payload = event.payload || {};
  const snapshot = payload.snapshot || payload;
  const version = payload.version || null;
  if (!snapshot) return;
  if (action === 'create') {
    await client.query(
      `insert into categories (id, name, type, parent_id) values ($1,$2,$3,$4)`,
      [snapshot.id, snapshot.name, snapshot.type, snapshot.parent_id ?? null]
    );
    if (version) {
      await client.query(
        `insert into category_versions (id, category_id, name, type, parent_id, valid_from, valid_to, is_current)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          version.id,
          snapshot.id,
          version.name ?? snapshot.name,
          version.type ?? snapshot.type,
          version.parent_id ?? snapshot.parent_id ?? null,
          version.valid_from ?? event.occurred_at,
          version.valid_to ?? null,
          version.is_current ?? true,
        ]
      );
    } else {
      await client.query(
        `insert into category_versions (category_id, name, type, parent_id, valid_from, valid_to, is_current)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [snapshot.id, snapshot.name, snapshot.type, snapshot.parent_id ?? null, event.occurred_at, null, true]
      );
    }
  } else if (action === 'update') {
    if (payload.snapshot) {
      await client.query(
        `update categories set name = $1, type = $2, parent_id = $3 where id = $4`,
        [snapshot.name, snapshot.type, snapshot.parent_id ?? null, snapshot.id]
      );
      await client.query(
        `update category_versions set is_current = false, valid_to = $1 where category_id = $2 and is_current = true`,
        [event.occurred_at, snapshot.id]
      );
      if (version) {
        await client.query(
          `insert into category_versions (id, category_id, name, type, parent_id, valid_from, valid_to, is_current)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            version.id,
            snapshot.id,
            version.name ?? snapshot.name,
            version.type ?? snapshot.type,
            version.parent_id ?? snapshot.parent_id ?? null,
            version.valid_from ?? event.occurred_at,
            version.valid_to ?? null,
            true,
          ]
        );
      } else {
        await client.query(
          `insert into category_versions (category_id, name, type, parent_id, valid_from, valid_to, is_current)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [snapshot.id, snapshot.name, snapshot.type, snapshot.parent_id ?? null, event.occurred_at, null, true]
        );
      }
    } else if (payload.diff) {
      const diff = payload.diff;
      const fields = [];
      const params = [];
      let idx = 1;
      for (const [key, value] of Object.entries(diff)) {
        fields.push(`${key} = $${idx++}`);
        params.push(value);
      }
      params.push(event.entity_id);
      if (fields.length) {
        await client.query(`update categories set ${fields.join(', ')} where id = $${idx}`, params);
      }
      await client.query(
        `update category_versions set is_current = false, valid_to = $1 where category_id = $2 and is_current = true`,
        [event.occurred_at, event.entity_id]
      );
      await client.query(
        `insert into category_versions (category_id, name, type, parent_id, valid_from, valid_to, is_current)
         select id, name, type, parent_id, $1, null, true from categories where id = $2`,
        [event.occurred_at, event.entity_id]
      );
    }
  } else if (action === 'delete') {
    await client.query('delete from categories where id = $1', [event.entity_id]);
  }
}

async function applyProjectEvent(client, event) {
  const action = eventAction(event.event_type);
  const payload = event.payload || {};
  const snapshot = payload.snapshot || payload;
  const version = payload.version || null;
  if (!snapshot) return;
  if (action === 'create') {
    await client.query(
      `insert into projects (id, name, status) values ($1,$2,$3)`,
      [snapshot.id, snapshot.name, snapshot.status ?? 'active']
    );
    if (version) {
      await client.query(
        `insert into project_versions (id, project_id, name, status, valid_from, valid_to, is_current)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          version.id,
          snapshot.id,
          version.name ?? snapshot.name,
          version.status ?? snapshot.status ?? 'active',
          version.valid_from ?? event.occurred_at,
          version.valid_to ?? null,
          version.is_current ?? true,
        ]
      );
    } else {
      await client.query(
        `insert into project_versions (project_id, name, status, valid_from, valid_to, is_current)
         values ($1,$2,$3,$4,$5,$6)`,
        [snapshot.id, snapshot.name, snapshot.status ?? 'active', event.occurred_at, null, true]
      );
    }
  } else if (action === 'update') {
    if (payload.snapshot) {
      await client.query(
        `update projects set name = $1, status = $2 where id = $3`,
        [snapshot.name, snapshot.status ?? 'active', snapshot.id]
      );
      await client.query(
        `update project_versions set is_current = false, valid_to = $1 where project_id = $2 and is_current = true`,
        [event.occurred_at, snapshot.id]
      );
      if (version) {
        await client.query(
          `insert into project_versions (id, project_id, name, status, valid_from, valid_to, is_current)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [
            version.id,
            snapshot.id,
            version.name ?? snapshot.name,
            version.status ?? snapshot.status ?? 'active',
            version.valid_from ?? event.occurred_at,
            version.valid_to ?? null,
            true,
          ]
        );
      } else {
        await client.query(
          `insert into project_versions (project_id, name, status, valid_from, valid_to, is_current)
           values ($1,$2,$3,$4,$5,$6)`,
          [snapshot.id, snapshot.name, snapshot.status ?? 'active', event.occurred_at, null, true]
        );
      }
    } else if (payload.diff) {
      const diff = payload.diff;
      const fields = [];
      const params = [];
      let idx = 1;
      for (const [key, value] of Object.entries(diff)) {
        fields.push(`${key} = $${idx++}`);
        params.push(value);
      }
      params.push(event.entity_id);
      if (fields.length) {
        await client.query(`update projects set ${fields.join(', ')} where id = $${idx}`, params);
      }
      await client.query(
        `update project_versions set is_current = false, valid_to = $1 where project_id = $2 and is_current = true`,
        [event.occurred_at, event.entity_id]
      );
      await client.query(
        `insert into project_versions (project_id, name, status, valid_from, valid_to, is_current)
         select id, name, status, $1, null, true from projects where id = $2`,
        [event.occurred_at, event.entity_id]
      );
    }
  } else if (action === 'delete') {
    await client.query('delete from projects where id = $1', [event.entity_id]);
  }
}

async function applyCounterpartyEvent(client, event) {
  const action = eventAction(event.event_type);
  const payload = event.payload || {};
  const snapshot = payload.snapshot || payload;
  const version = payload.version || null;
  if (!snapshot) return;
  if (action === 'create') {
    await client.query(
      `insert into counterparties (id, name, inn, type) values ($1,$2,$3,$4)`,
      [snapshot.id, snapshot.name, snapshot.inn ?? null, snapshot.type ?? null]
    );
    if (version) {
      await client.query(
        `insert into counterparty_versions (id, counterparty_id, name, inn, type, valid_from, valid_to, is_current)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          version.id,
          snapshot.id,
          version.name ?? snapshot.name,
          version.inn ?? snapshot.inn ?? null,
          version.type ?? snapshot.type ?? null,
          version.valid_from ?? event.occurred_at,
          version.valid_to ?? null,
          version.is_current ?? true,
        ]
      );
    } else {
      await client.query(
        `insert into counterparty_versions (counterparty_id, name, inn, type, valid_from, valid_to, is_current)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [snapshot.id, snapshot.name, snapshot.inn ?? null, snapshot.type ?? null, event.occurred_at, null, true]
      );
    }
  } else if (action === 'update') {
    if (payload.snapshot) {
      await client.query(
        `update counterparties set name = $1, inn = $2, type = $3 where id = $4`,
        [snapshot.name, snapshot.inn ?? null, snapshot.type ?? null, snapshot.id]
      );
      await client.query(
        `update counterparty_versions set is_current = false, valid_to = $1 where counterparty_id = $2 and is_current = true`,
        [event.occurred_at, snapshot.id]
      );
      if (version) {
        await client.query(
          `insert into counterparty_versions (id, counterparty_id, name, inn, type, valid_from, valid_to, is_current)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            version.id,
            snapshot.id,
            version.name ?? snapshot.name,
            version.inn ?? snapshot.inn ?? null,
            version.type ?? snapshot.type ?? null,
            version.valid_from ?? event.occurred_at,
            version.valid_to ?? null,
            true,
          ]
        );
      } else {
        await client.query(
          `insert into counterparty_versions (counterparty_id, name, inn, type, valid_from, valid_to, is_current)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [snapshot.id, snapshot.name, snapshot.inn ?? null, snapshot.type ?? null, event.occurred_at, null, true]
        );
      }
    } else if (payload.diff) {
      const diff = payload.diff;
      const fields = [];
      const params = [];
      let idx = 1;
      for (const [key, value] of Object.entries(diff)) {
        fields.push(`${key} = $${idx++}`);
        params.push(value);
      }
      params.push(event.entity_id);
      if (fields.length) {
        await client.query(`update counterparties set ${fields.join(', ')} where id = $${idx}`, params);
      }
      await client.query(
        `update counterparty_versions set is_current = false, valid_to = $1 where counterparty_id = $2 and is_current = true`,
        [event.occurred_at, event.entity_id]
      );
      await client.query(
        `insert into counterparty_versions (counterparty_id, name, inn, type, valid_from, valid_to, is_current)
         select id, name, inn, type, $1, null, true from counterparties where id = $2`,
        [event.occurred_at, event.entity_id]
      );
    }
  } else if (action === 'delete') {
    await client.query('delete from counterparties where id = $1', [event.entity_id]);
  }
}

async function applyUserEvent(client, event) {
  const action = eventAction(event.event_type);
  const payload = event.payload || {};
  const snapshot = payload.snapshot || payload;
  if (!snapshot) return;
  const roleRow = snapshot.role
    ? await client.query('select id from roles where name = $1', [snapshot.role])
    : null;
  const roleId = roleRow?.rows?.[0]?.id || null;

  if (action === 'create') {
    await client.query(
      `insert into users (id, email, password_hash, role_id, status, created_at)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set
         email = excluded.email,
         password_hash = excluded.password_hash,
         role_id = excluded.role_id,
         status = excluded.status`,
      [snapshot.id, snapshot.email, snapshot.password_hash, roleId, snapshot.status ?? 'active', snapshot.created_at]
    );
  } else if (action === 'update') {
    if (payload.snapshot) {
      await client.query(
        `update users set
          email = $1,
          password_hash = $2,
          role_id = $3,
          status = $4
         where id = $5`,
        [
          snapshot.email,
          snapshot.password_hash,
          roleId,
          snapshot.status ?? 'active',
          snapshot.id,
        ]
      );
    } else if (payload.diff) {
      const diff = payload.diff;
      const fields = [];
      const params = [];
      let idx = 1;
      for (const [key, value] of Object.entries(diff)) {
        if (key === 'role') {
          fields.push(`role_id = $${idx++}`);
          params.push(roleId);
        } else if (key === 'password') {
          fields.push(`password_hash = $${idx++}`);
          params.push(value);
        } else if (key === 'password_hash') {
          fields.push(`password_hash = $${idx++}`);
          params.push(value);
        } else {
          fields.push(`${key} = $${idx++}`);
          params.push(value);
        }
      }
      params.push(event.entity_id);
      if (fields.length) {
        await client.query(`update users set ${fields.join(', ')} where id = $${idx}`, params);
      }
    }
  } else if (action === 'delete') {
    await client.query('delete from users where id = $1', [event.entity_id]);
  }
}

async function rebuildProfitSnapshots(client) {
  const { rows: periods } = await client.query(`select * from periods where status = 'closed' order by id`);
  if (!periods.length) return;

  for (const p of periods) {
    const { rows } = await client.query(
      `select
        coalesce(sum(case when a.type = 'income' then (le.credit - le.debit) else 0 end),0) as income,
        coalesce(sum(case when a.type = 'expense' and a.code != $3 then (le.debit - le.credit) else 0 end),0) as expense,
        coalesce(sum(case when a.code = $3 then (le.debit - le.credit) else 0 end),0) as tax
       from ledger_entries le
       join accounts a on a.id = le.account_id
       where le.operation_date >= $1 and le.operation_date <= $2`,
      [p.start_date, p.end_date, ACCOUNT_CODES.TAX_EXPENSE]
    );

    const income = Number(rows[0].income || 0);
    const expense = Number(rows[0].expense || 0);
    const tax = Number(rows[0].tax || 0);
    const gross = income - expense;
    const net = gross - tax;

    await client.query(
      'insert into profit_snapshots (period_id, gross_profit, tax_total, net_profit, created_by) values ($1,$2,$3,$4,$5)',
      [p.id, gross, tax, net, null]
    );
  }
}

async function rebuildReadModels(client) {
  await client.query('truncate table report_profit_monthly, report_expense_structure, report_project_profit');

  await client.query(
    `insert into report_profit_monthly (month, net_profit)
     select month, net_profit from (
       select
         date_trunc('month', le.operation_date)::date as month,
         coalesce(sum(case
           when a.type = 'income' then (le.credit - le.debit)
           when a.type = 'expense' then -(le.debit - le.credit)
           else 0 end), 0) as net_profit
       from ledger_entries le
       join accounts a on a.id = le.account_id
       group by 1
     ) s`
  );

  await client.query(
    `insert into report_expense_structure (month, category_version_id, total)
     select
       date_trunc('month', le.operation_date)::date as month,
       le.category_version_id,
       sum(le.debit - le.credit) as total
     from ledger_entries le
     join accounts a on a.id = le.account_id
     where a.type = 'expense'
     group by 1, 2`
  );

  await client.query(
    `insert into report_project_profit (month, project_version_id, profit)
     select
       date_trunc('month', le.operation_date)::date as month,
       le.project_version_id,
       coalesce(sum(case
         when a.type = 'income' then (le.credit - le.debit)
         when a.type = 'expense' then -(le.debit - le.credit)
         else 0 end), 0) as profit
     from ledger_entries le
     join accounts a on a.id = le.account_id
     group by 1, 2`
  );
}

async function rebuild() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('alter table operations disable trigger trg_prevent_ops_in_closed_periods');
    await ensureRoles(client);
    await ensureAccounts(client);

    await client.query(
      `truncate table
         audit_logs,
         ledger_entries,
         journal,
         profit_snapshots,
         attachments,
         period_close_checks,
         quality_issue_events,
         quality_issues,
         import_errors,
         import_rows,
         import_batches,
         import_mappings,
         report_runs,
         report_templates,
         operation_views,
         scenarios,
         policy_tests,
         policy_bindings,
         policies,
         ui_prefs,
         operations,
         periods,
         category_versions,
         project_versions,
         counterparty_versions,
         categories,
         projects,
         counterparties,
         report_profit_monthly,
         report_expense_structure,
         report_project_profit
       restart identity`
    );

    const { rows: events } = await client.query('select * from domain_events order by id');
    for (const ev of events) {
      if (ev.entity === 'operations') {
        await applyOperationEvent(client, ev);
      } else if (ev.entity === 'periods') {
        await applyPeriodEvent(client, ev);
      } else if (ev.entity === 'categories') {
        await applyCategoryEvent(client, ev);
      } else if (ev.entity === 'projects') {
        await applyProjectEvent(client, ev);
      } else if (ev.entity === 'counterparties') {
        await applyCounterpartyEvent(client, ev);
      } else if (ev.entity === 'users') {
        await applyUserEvent(client, ev);
      }
    }

    await client.query(
      `update operations o
       set category_version_id = cv.id
       from category_versions cv
       where o.category_id = cv.category_id and cv.is_current = true and o.category_version_id is null`
    );
    await client.query(
      `update operations o
       set project_version_id = pv.id
       from project_versions pv
       where o.project_id = pv.project_id and pv.is_current = true and o.project_version_id is null`
    );
    await client.query(
      `update operations o
       set counterparty_version_id = cv.id
       from counterparty_versions cv
       where o.counterparty_id = cv.counterparty_id and cv.is_current = true and o.counterparty_version_id is null`
    );

    const { rows: confirmed } = await client.query(
      "select * from operations where status = 'confirmed' order by id"
    );
    for (const op of confirmed) {
      await insertJournalAndLedger(client, op, null);
    }

    await rebuildReadModels(client);
    await rebuildProfitSnapshots(client);

    const { rows: evs } = await client.query('select * from domain_events order by id');
    for (const ev of evs) {
      const action = eventAction(ev.event_type);
      const payload = sanitizePayload(ev.payload);
      await client.query(
        `insert into audit_logs (entity, entity_id, action, user_id, timestamp, diff)
         values ($1,$2,$3,$4,$5,$6)`,
        [ev.entity, ev.entity_id, action, ev.actor_id, ev.occurred_at, payload ? JSON.stringify(payload) : null]
      );
    }

    await client.query(
      "select setval('operations_id_seq', greatest((select coalesce(max(id),0) from operations),1), (select count(*)>0 from operations))"
    );
    await client.query(
      "select setval('periods_id_seq', greatest((select coalesce(max(id),0) from periods),1), (select count(*)>0 from periods))"
    );
    await client.query(
      "select setval('journal_id_seq', greatest((select coalesce(max(id),0) from journal),1), (select count(*)>0 from journal))"
    );
    await client.query(
      "select setval('ledger_entries_id_seq', greatest((select coalesce(max(id),0) from ledger_entries),1), (select count(*)>0 from ledger_entries))"
    );
    await client.query(
      "select setval('audit_logs_id_seq', greatest((select coalesce(max(id),0) from audit_logs),1), (select count(*)>0 from audit_logs))"
    );
    await client.query(
      "select setval('categories_id_seq', greatest((select coalesce(max(id),0) from categories),1), (select count(*)>0 from categories))"
    );
    await client.query(
      "select setval('projects_id_seq', greatest((select coalesce(max(id),0) from projects),1), (select count(*)>0 from projects))"
    );
    await client.query(
      "select setval('counterparties_id_seq', greatest((select coalesce(max(id),0) from counterparties),1), (select count(*)>0 from counterparties))"
    );
    await client.query(
      "select setval('users_id_seq', greatest((select coalesce(max(id),0) from users),1), (select count(*)>0 from users))"
    );

    await client.query('alter table operations enable trigger trg_prevent_ops_in_closed_periods');
    await client.query('commit');
    console.log('Rebuild completed.');
  } catch (err) {
    await client.query('rollback');
    console.error('Rebuild failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await rebuild();
