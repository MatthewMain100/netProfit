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

async function main() {
  const client = await pool.connect();
  try {
    await ensureMeta(client);
    const all = await listMigrations();
    const { rows } = await client.query('select id, applied_at from schema_migrations order by applied_at');
    const applied = new Map(rows.map(r => [r.id, r.applied_at]));

    for (const id of all) {
      if (applied.has(id)) {
        console.log(`[applied] ${id} at ${new Date(applied.get(id)).toISOString()}`);
      } else {
        console.log(`[pending] ${id}`);
      }
    }

    if (!all.length) {
      console.log('No migration files found in db/migrations.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exitCode = 1;
});
