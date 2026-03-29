import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function ensureMeta(client) {
  await client.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function listMigrations() {
  const migrationsDir = path.resolve(process.cwd(), 'db', 'migrations');
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.sql'))
    .map(e => e.name)
    .sort();
}

async function getApplied(client) {
  const { rows } = await client.query('select id from schema_migrations');
  return new Set(rows.map(r => r.id));
}

async function applyMigration(client, id) {
  const filePath = path.resolve(process.cwd(), 'db', 'migrations', id);
  const sql = await fs.readFile(filePath, 'utf8');
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('insert into schema_migrations (id) values ($1)', [id]);
    await client.query('commit');
    console.log(`Applied: ${id}`);
  } catch (err) {
    await client.query('rollback');
    throw new Error(`Migration failed (${id}): ${err.message}`);
  }
}

async function main() {
  const client = await pool.connect();
  try {
    await ensureMeta(client);
    const all = await listMigrations();
    const applied = await getApplied(client);
    const pending = all.filter(id => !applied.has(id));

    if (!pending.length) {
      console.log('No pending migrations.');
      return;
    }

    for (const id of pending) {
      await applyMigration(client, id);
    }

    console.log(`Done. Applied ${pending.length} migration(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exitCode = 1;
});
