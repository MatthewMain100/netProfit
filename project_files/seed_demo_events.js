import pg from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randAmount(type) {
  if (type === 'income') return Number((Math.random() * 120000 + 7000).toFixed(2));
  if (type === 'expense') return Number((Math.random() * 80000 + 2000).toFixed(2));
  if (type === 'tax') return Number((Math.random() * 25000 + 900).toFixed(2));
  const sign = Math.random() < 0.5 ? -1 : 1;
  return Number((sign * (Math.random() * 20000 + 500)).toFixed(2));
}

function randDate(from, to) {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const ms = randInt(fromMs, toMs);
  return new Date(ms).toISOString().slice(0, 10);
}

function plusDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toIsoMoment(dateStr, hour = 12, minute = 0) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

async function ensureAdminUser(client) {
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const adminHash = await bcrypt.hash(adminPassword, 10);
  const existing = await client.query(
    `select u.id, u.email, u.password_hash, u.status, u.created_at, r.name as role
     from users u join roles r on r.id = u.role_id
     where u.email = $1
     limit 1`,
    ['admin@local']
  );
  if (existing.rows[0]) {
    const role = await client.query("select id from roles where name = 'admin' limit 1");
    const updated = await client.query(
      `update users
       set password_hash = $1, role_id = $2, status = 'active'
       where id = $3
       returning id, email, password_hash, status, created_at`,
      [adminHash, role.rows[0].id, existing.rows[0].id]
    );
    return { ...updated.rows[0], role: 'admin' };
  }

  await client.query("insert into roles (name) values ('accountant'),('manager'),('admin') on conflict do nothing");
  const role = await client.query("select id from roles where name = 'admin' limit 1");
  const created = await client.query(
    `insert into users (email, password_hash, role_id, status)
     values ($1,$2,$3,$4)
     returning id, email, password_hash, status, created_at`,
    ['admin@local', adminHash, role.rows[0].id, 'active']
  );
  return { ...created.rows[0], role: 'admin' };
}

async function insertEvent(client, event) {
  await client.query(
    `insert into domain_events (event_type, entity, entity_id, actor_id, occurred_at, payload)
     values ($1,$2,$3,$4,$5,$6)`,
    [
      event.event_type,
      event.entity,
      event.entity_id ?? null,
      event.actor_id ?? null,
      event.occurred_at,
      JSON.stringify(event.payload ?? null),
    ]
  );
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('truncate table domain_events restart identity');

    const admin = await ensureAdminUser(client);
    const actorId = admin.id;

    await insertEvent(client, {
      event_type: 'users.create',
      entity: 'users',
      entity_id: admin.id,
      actor_id: actorId,
      occurred_at: new Date('2024-01-01T09:00:00Z').toISOString(),
      payload: {
        snapshot: {
          id: admin.id,
          email: admin.email,
          password_hash: admin.password_hash,
          role: admin.role,
          status: admin.status,
          created_at: admin.created_at,
        },
      },
    });

    const categories = [
      { id: 1, name: 'Продажи B2B', type: 'income' },
      { id: 2, name: 'Продажи B2C', type: 'income' },
      { id: 3, name: 'Сервис', type: 'income' },
      { id: 4, name: 'Материалы', type: 'expense' },
      { id: 5, name: 'Маркетинг', type: 'expense' },
      { id: 6, name: 'Логистика', type: 'expense' },
      { id: 7, name: 'Зарплата', type: 'expense' },
      { id: 8, name: 'Налоги', type: 'tax' },
    ];

    const projects = [
      { id: 1, name: 'Проект Север', status: 'active' },
      { id: 2, name: 'Проект Восток', status: 'active' },
      { id: 3, name: 'Проект Запад', status: 'active' },
      { id: 4, name: 'Проект Центр', status: 'active' },
      { id: 5, name: 'Проект Экспорт', status: 'active' },
    ];

    const counterparties = [
      { id: 1, name: 'ООО Альфа', inn: '7701000001', type: 'company' },
      { id: 2, name: 'ООО Бета', inn: '7701000002', type: 'company' },
      { id: 3, name: 'ООО Гамма', inn: '7701000003', type: 'company' },
      { id: 4, name: 'ИП Дельта', inn: null, type: 'person' },
      { id: 5, name: 'ЗАО Омега', inn: '7701000004', type: 'company' },
    ];

    for (const c of categories) {
      await insertEvent(client, {
        event_type: 'categories.create',
        entity: 'categories',
        entity_id: c.id,
        actor_id: actorId,
        occurred_at: toIsoMoment('2024-01-02', 9, c.id),
        payload: { snapshot: c },
      });
    }

    for (const p of projects) {
      await insertEvent(client, {
        event_type: 'projects.create',
        entity: 'projects',
        entity_id: p.id,
        actor_id: actorId,
        occurred_at: toIsoMoment('2024-01-03', 9, p.id),
        payload: { snapshot: p },
      });
    }

    for (const cp of counterparties) {
      await insertEvent(client, {
        event_type: 'counterparties.create',
        entity: 'counterparties',
        entity_id: cp.id,
        actor_id: actorId,
        occurred_at: toIsoMoment('2024-01-04', 9, cp.id),
        payload: { snapshot: cp },
      });
    }

    const incomeCats = categories.filter(c => c.type === 'income').map(c => c.id);
    const expenseCats = categories.filter(c => c.type === 'expense').map(c => c.id);
    const taxCats = categories.filter(c => c.type === 'tax').map(c => c.id);

    const operations = [];
    for (let i = 1; i <= 360; i += 1) {
      const rnd = Math.random();
      const type = rnd < 0.45 ? 'income' : rnd < 0.82 ? 'expense' : rnd < 0.94 ? 'tax' : 'adjustment';
      const category_id = type === 'income' ? pick(incomeCats) : type === 'tax' ? pick(taxCats) : pick(expenseCats);
      const operation_date = randDate('2024-01-01', '2026-02-01');
      const status = Math.random() < 0.76 ? 'confirmed' : 'draft';
      const amount = randAmount(type);
      const op = {
        id: i,
        type,
        amount,
        category_id,
        project_id: pick(projects).id,
        counterparty_id: pick(counterparties).id,
        currency: 'RUB',
        vat_included: Math.random() < 0.35,
        vat_amount: Number((Math.random() * 7000).toFixed(2)),
        operation_date,
        period_id: null,
        status,
        comment: `auto demo #${i}`,
        adjustment: type === 'adjustment',
        created_at: toIsoMoment(operation_date, 11, i % 60),
        updated_at: toIsoMoment(operation_date, 11, i % 60),
      };
      operations.push(op);
      await insertEvent(client, {
        event_type: 'operations.create',
        entity: 'operations',
        entity_id: op.id,
        actor_id: actorId,
        occurred_at: op.created_at,
        payload: { snapshot: op },
      });
    }

    const draftOps = operations.filter(o => o.status === 'draft');
    for (let i = 0; i < Math.min(40, draftOps.length); i += 1) {
      const op = draftOps[i];
      op.status = 'confirmed';
      op.updated_at = toIsoMoment(plusDays(op.operation_date, randInt(1, 20)), 14, i % 60);
      await insertEvent(client, {
        event_type: 'operations.confirm',
        entity: 'operations',
        entity_id: op.id,
        actor_id: actorId,
        occurred_at: op.updated_at,
        payload: { status: 'confirmed', snapshot: { ...op } },
      });
    }

    for (let i = 0; i < 60; i += 1) {
      const op = pick(operations);
      const nextDate = plusDays(op.operation_date, randInt(-10, 20));
      const nextAmount = op.type === 'adjustment'
        ? Number(((Math.random() < 0.5 ? -1 : 1) * (Math.random() * 20000 + 300)).toFixed(2))
        : Number((op.amount * (0.8 + Math.random() * 0.4)).toFixed(2));
      op.operation_date = nextDate;
      op.amount = nextAmount;
      op.comment = `${op.comment} upd${i + 1}`;
      op.updated_at = toIsoMoment(nextDate, 15, i % 60);

      await insertEvent(client, {
        event_type: 'operations.update',
        entity: 'operations',
        entity_id: op.id,
        actor_id: actorId,
        occurred_at: op.updated_at,
        payload: {
          diff: {
            amount: op.amount,
            operation_date: op.operation_date,
            comment: op.comment,
          },
          snapshot: { ...op },
        },
      });
    }

    const periods = [];
    for (let i = 0; i < 12; i += 1) {
      const start = new Date(Date.UTC(2025, i, 1));
      const end = new Date(Date.UTC(2025, i + 1, 0));
      periods.push({
        id: i + 1,
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
        status: i < 8 ? 'closed' : 'open',
      });
    }

    for (const p of periods) {
      await insertEvent(client, {
        event_type: 'periods.create',
        entity: 'periods',
        entity_id: p.id,
        actor_id: actorId,
        occurred_at: toIsoMoment('2026-03-01', 10, p.id),
        payload: { snapshot: { ...p, status: 'open' } },
      });
      if (p.status === 'closed') {
        await insertEvent(client, {
          event_type: 'periods.close',
          entity: 'periods',
          entity_id: p.id,
          actor_id: actorId,
          occurred_at: toIsoMoment('2026-03-10', 16, p.id),
          payload: { status: 'closed', snapshot: p },
        });
      }
    }

    await client.query('commit');
    console.log('Demo events seeded.');
  } catch (err) {
    await client.query('rollback');
    console.error('Seeding failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await seed();
