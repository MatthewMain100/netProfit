import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = path.resolve(__dirname, '..');
const APP_DIR = path.resolve(BACKEND_DIR, '..');
const ROOT_DIR = path.resolve(APP_DIR, '..');
const DATE_STAMP = '2026-03-18';
const OUT_DIR = path.join(ROOT_DIR, `db_submission_${DATE_STAMP}`);
const SQL_DIR = path.join(OUT_DIR, 'sql');
const FILES_DIR = path.join(OUT_DIR, 'project_files');
const DOCS_DIR = path.join(OUT_DIR, 'docs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SOURCE_FILES = [
  ['app/db/schema.sql', 'schema.sql'],
  ['app/db/seed.sql', 'seed.sql'],
  ['app/db/seed_fake.sql', 'seed_fake.sql'],
  ['app/backend/db/migrations/20260209_001_finance_platform_2.sql', '20260209_001_finance_platform_2.sql'],
  ['app/backend/src/db.js', 'db.js'],
  ['app/backend/scripts/migrate.js', 'migrate.js'],
  ['app/backend/scripts/migrate_status.js', 'migrate_status.js'],
  ['app/backend/scripts/rebuild_projections.js', 'rebuild_projections.js'],
  ['app/backend/scripts/seed_demo_events.js', 'seed_demo_events.js'],
  ['app/backend/.env.example', '.env.example'],
  ['app/docker-compose.yml', 'docker-compose.yml'],
  ['app/README.md', 'README.md'],
  ['app/run.ps1', 'run.ps1'],
  ['app/run.cmd', 'run.cmd'],
];

const DOC_FILES = [
  '2.4.4.1_Реляционные_отношения_по_проекту.docx',
  '2.4.4.2_Нормализация_полученных_отношений.docx',
  '2.4.4.3_Группы_пользователей_и_права_доступа.docx',
  '2.4.4.4_Создание_таблиц_в_базе_данных.docx',
  '2.4.4.5_Проектирование_наиболее_востребованных_запросов.docx',
  '2.4.4.6_Установка_индексов.docx',
  'normalized_schema_project.png',
];

const TABLE_ORDER = [
  'schema_migrations',
  'roles',
  'users',
  'projects',
  'categories',
  'counterparties',
  'category_versions',
  'project_versions',
  'counterparty_versions',
  'periods',
  'feature_flags',
  'calculation_rules',
  'operations',
  'accounts',
  'journal',
  'ledger_entries',
  'report_profit_monthly',
  'report_expense_structure',
  'report_project_profit',
  'report_templates',
  'report_runs',
  'operation_views',
  'period_close_checks',
  'profit_snapshots',
  'quality_issues',
  'quality_issue_events',
  'import_batches',
  'import_rows',
  'import_errors',
  'import_mappings',
  'scenarios',
  'policies',
  'policy_bindings',
  'policy_tests',
  'attachments',
  'ui_prefs',
  'audit_logs',
  'domain_events',
];

function qident(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function qliteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function valueToSql(value, column) {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (Array.isArray(value)) {
    return `ARRAY[${value.map(item => valueToSql(item, { data_type: 'text', udt_name: 'text' })).join(', ')}]`;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  if (value instanceof Date) {
    const type = column.data_type.includes('timestamp') ? column.data_type : 'timestamp with time zone';
    return `${qliteral(value.toISOString())}::${type}`;
  }

  if (column.data_type === 'json' || column.data_type === 'jsonb' || typeof value === 'object') {
    return `${qliteral(JSON.stringify(value))}::${column.data_type === 'json' ? 'json' : 'jsonb'}`;
  }

  if (column.data_type === 'date') {
    return `${qliteral(value)}::date`;
  }

  if (column.data_type.includes('timestamp')) {
    return `${qliteral(value)}::${column.data_type}`;
  }

  if (
    column.data_type === 'integer' ||
    column.data_type === 'bigint' ||
    column.data_type === 'smallint' ||
    column.data_type === 'numeric' ||
    column.data_type === 'real' ||
    column.data_type === 'double precision'
  ) {
    return String(value);
  }

  return qliteral(value);
}

async function ensureCleanDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function copyFiles() {
  for (const [relativeSource, name] of SOURCE_FILES) {
    const source = path.join(ROOT_DIR, relativeSource);
    const target = path.join(FILES_DIR, name);
    await fs.copyFile(source, target);
  }

  for (const name of DOC_FILES) {
    const source = path.join(ROOT_DIR, name);
    try {
      await fs.copyFile(source, path.join(DOCS_DIR, name));
    } catch {
      // Skip optional artifacts that may be absent.
    }
  }
}

async function listUserTables(client) {
  const { rows } = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
    order by table_name
  `);
  return rows.map(row => row.table_name);
}

async function getColumns(client, table) {
  const { rows } = await client.query(
    `
      select
        column_name,
        data_type,
        udt_name,
        ordinal_position,
        column_default,
        is_identity
      from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
      order by ordinal_position
    `,
    [table]
  );
  return rows;
}

async function getRowCount(client, table) {
  const { rows } = await client.query(`select count(*)::bigint as cnt from public.${qident(table)}`);
  return Number(rows[0].cnt);
}

async function getPrimaryKeyColumns(client, table) {
  const { rows } = await client.query(
    `
      select kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.table_schema = kcu.table_schema
       and tc.table_name = kcu.table_name
      where tc.table_schema = 'public'
        and tc.table_name = $1
        and tc.constraint_type = 'PRIMARY KEY'
      order by kcu.ordinal_position
    `,
    [table]
  );
  return rows.map(row => row.column_name);
}

async function exportLiveData(client, orderedTables) {
  const lines = [];
  const rowCounts = [];

  lines.push('-- live_data_snapshot.sql');
  lines.push(`-- generated at ${new Date().toISOString()}`);
  lines.push('begin;');
  lines.push("set session_replication_role = replica;");
  lines.push('');
  lines.push(
    `truncate table ${orderedTables.map(table => `public.${qident(table)}`).join(', ')} restart identity cascade;`
  );
  lines.push('');

  for (const table of orderedTables) {
    const columns = await getColumns(client, table);
    const pkColumns = await getPrimaryKeyColumns(client, table);
    const orderClause = pkColumns.length
      ? ` order by ${pkColumns.map(col => qident(col)).join(', ')}`
      : '';
    const { rows } = await client.query(`select * from public.${qident(table)}${orderClause}`);
    rowCounts.push({ table, rows: rows.length });

    if (!rows.length) {
      lines.push(`-- table ${table}: 0 rows`);
      lines.push('');
      continue;
    }

    const colList = columns.map(col => qident(col.column_name)).join(', ');
    lines.push(`-- table ${table}: ${rows.length} rows`);

    for (const row of rows) {
      const values = columns
        .map(col => valueToSql(row[col.column_name], col))
        .join(', ');
      lines.push(`insert into public.${qident(table)} (${colList}) values (${values});`);
    }
    lines.push('');
  }

  lines.push('-- reset sequences');
  for (const table of orderedTables) {
    const columns = await getColumns(client, table);
    for (const col of columns) {
      const isSerial = col.is_identity === 'YES' || (col.column_default || '').includes('nextval(');
      if (!isSerial) {
        continue;
      }
      lines.push(
        `select setval(pg_get_serial_sequence('public.${table}', '${col.column_name}'), coalesce((select max(${qident(col.column_name)}) from public.${qident(table)}), 1), coalesce((select max(${qident(col.column_name)}) from public.${qident(table)}), null) is not null);`
      );
    }
  }
  lines.push('');
  lines.push('-- refresh materialized view after data import');
  lines.push('select refresh_mv_kpi_monthly();');
  lines.push("set session_replication_role = default;");
  lines.push('commit;');
  lines.push('');

  await fs.writeFile(path.join(SQL_DIR, '05_live_data_snapshot.sql'), lines.join('\n'), 'utf8');
  return rowCounts;
}

async function buildRestoreFiles() {
  const schema = await fs.readFile(path.join(ROOT_DIR, 'app', 'db', 'schema.sql'), 'utf8');
  const migration = await fs.readFile(
    path.join(ROOT_DIR, 'app', 'backend', 'db', 'migrations', '20260209_001_finance_platform_2.sql'),
    'utf8'
  );
  const seed = await fs.readFile(path.join(ROOT_DIR, 'app', 'db', 'seed.sql'), 'utf8');
  const seedFake = await fs.readFile(path.join(ROOT_DIR, 'app', 'db', 'seed_fake.sql'), 'utf8');
  const live = await fs.readFile(path.join(SQL_DIR, '05_live_data_snapshot.sql'), 'utf8');

  const demoRestore = [
    '-- 00_restore_demo_from_sources.sql',
    '-- creates schema and loads demo data from source SQL files',
    schema,
    '',
    migration,
    '',
    seed,
    '',
    seedFake,
    '',
  ].join('\n');

  const liveRestore = [
    '-- 00_restore_live_snapshot.sql',
    '-- creates schema and loads current live database snapshot',
    schema,
    '',
    migration,
    '',
    live,
    '',
  ].join('\n');

  await fs.writeFile(path.join(SQL_DIR, '00_restore_demo_from_sources.sql'), demoRestore, 'utf8');
  await fs.writeFile(path.join(SQL_DIR, '00_restore_live_snapshot.sql'), liveRestore, 'utf8');
}

async function writeReadme(rowCounts) {
  const countLines = rowCounts.map(item => `- ${item.table}: ${item.rows}`).join('\n');
  const text = `Комплект БД для сдачи

Содержимое
- sql/00_restore_live_snapshot.sql - полный SQL-файл для восстановления текущего состояния БД.
- sql/00_restore_demo_from_sources.sql - полный SQL-файл для восстановления демонстрационной БД из исходных файлов проекта.
- sql/05_live_data_snapshot.sql - логический снимок данных рабочей БД на момент сборки.
- project_files/ - исходные файлы проекта, относящиеся к БД.
- docs/ - подготовленные материалы пояснительной записки по разделам БД.

Источник подключения
- DATABASE_URL: ${process.env.DATABASE_URL}

Как восстановить БД
1. Создать пустую базу PostgreSQL с кодировкой UTF-8.
2. Выполнить один из файлов:
   - sql/00_restore_live_snapshot.sql - если нужен текущий рабочий снимок БД;
   - sql/00_restore_demo_from_sources.sql - если нужна демонстрационная БД, собираемая из schema.sql, migration и seed-файлов.
3. При необходимости запустить backend-скрипт rebuild_projections.js.

Файлы проекта по БД
- schema.sql
- 20260209_001_finance_platform_2.sql
- seed.sql
- seed_fake.sql
- db.js
- migrate.js
- migrate_status.js
- rebuild_projections.js
- seed_demo_events.js
- .env.example
- docker-compose.yml
- README.md
- run.ps1
- run.cmd

Снимок текущей БД
${countLines}
`;
  await fs.writeFile(path.join(OUT_DIR, 'README_DB_SUBMISSION.txt'), text, 'utf8');
}

async function writeManifest() {
  const lines = [];
  async function walk(dir, prefix = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = path.join(prefix, entry.name);
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        lines.push(`${rel}/`);
        await walk(full, rel);
      } else {
        const stat = await fs.stat(full);
        lines.push(`${rel} | ${stat.size} bytes`);
      }
    }
  }
  await walk(OUT_DIR);
  await fs.writeFile(path.join(OUT_DIR, 'MANIFEST.txt'), lines.join('\n'), 'utf8');
}

async function main() {
  await ensureCleanDir(OUT_DIR);
  await fs.mkdir(SQL_DIR, { recursive: true });
  await fs.mkdir(FILES_DIR, { recursive: true });
  await fs.mkdir(DOCS_DIR, { recursive: true });

  await copyFiles();

  const client = await pool.connect();
  try {
    const tables = await listUserTables(client);
    const orderedTables = [
      ...TABLE_ORDER.filter(table => tables.includes(table)),
      ...tables.filter(table => !TABLE_ORDER.includes(table)),
    ];

    const rowCounts = await exportLiveData(client, orderedTables);
    await buildRestoreFiles();
    await writeReadme(rowCounts);
    await writeManifest();

    console.log(`Prepared DB submission folder: ${OUT_DIR}`);
    for (const item of rowCounts) {
      console.log(`${item.table}: ${item.rows}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
