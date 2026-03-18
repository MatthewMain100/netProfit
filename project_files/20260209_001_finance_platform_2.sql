create table if not exists schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

alter table operations
  add column if not exists created_by int references users(id);

alter table operations
  add column if not exists tenant_id int;

create index if not exists idx_operations_created_at_id on operations(created_at desc, id desc);
create index if not exists idx_operations_tenant_date on operations(tenant_id, operation_date);

create table if not exists feature_flags (
  key text primary key,
  enabled boolean not null default false,
  rollout jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into feature_flags (key, enabled, rollout)
values
  ('finance_center', true, '{}'::jsonb),
  ('report_builder', true, '{}'::jsonb),
  ('ops_v2', true, '{}'::jsonb),
  ('period_wizard', true, '{}'::jsonb),
  ('planning', true, '{}'::jsonb),
  ('quality', true, '{}'::jsonb),
  ('import_v2', true, '{}'::jsonb),
  ('abac_rls', true, '{}'::jsonb),
  ('attachments', true, '{}'::jsonb),
  ('director_mode', true, '{}'::jsonb)
on conflict (key) do nothing;

create table if not exists report_templates (
  id bigserial primary key,
  name text not null,
  spec jsonb not null,
  created_by bigint not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists report_runs (
  id bigserial primary key,
  template_id bigint references report_templates(id) on delete set null,
  spec jsonb not null,
  started_by bigint not null references users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'queued',
  row_count int,
  error text
);

create table if not exists operation_views (
  id bigserial primary key,
  name text not null,
  spec jsonb not null,
  created_by bigint not null references users(id),
  scope text not null default 'private' check (scope in ('private', 'role', 'global')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists period_close_checks (
  id bigserial primary key,
  period_id bigint not null references periods(id) on delete cascade,
  check_key text not null,
  severity text not null check (severity in ('info', 'warn', 'block')),
  details jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists calculation_rules (
  id bigserial primary key,
  key text not null unique,
  value jsonb not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into calculation_rules (key, value)
values
  ('vat_default_rate', '{"rate": 0.2}'::jsonb),
  ('alert_large_operation', '{"threshold": 500000}'::jsonb)
on conflict (key) do nothing;

create table if not exists scenarios (
  id bigserial primary key,
  name text not null,
  spec jsonb not null,
  created_by bigint not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists quality_issues (
  id bigserial primary key,
  issue_key text not null,
  severity text not null check (severity in ('info', 'warn', 'block')),
  entity text not null,
  entity_id bigint not null,
  details jsonb not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_quality_issues_status on quality_issues(status, severity);
create index if not exists idx_quality_issues_entity on quality_issues(entity, entity_id);

create table if not exists quality_issue_events (
  id bigserial primary key,
  quality_issue_id bigint not null references quality_issues(id) on delete cascade,
  action text not null,
  actor_id bigint references users(id),
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists import_batches (
  id bigserial primary key,
  file_name text,
  file_hash text not null,
  mapping jsonb,
  created_by bigint not null references users(id),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  total_rows int not null default 0,
  inserted_rows int not null default 0,
  error_rows int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists uq_import_batches_hash_user on import_batches(file_hash, created_by);

create table if not exists import_rows (
  id bigserial primary key,
  batch_id bigint not null references import_batches(id) on delete cascade,
  row_no int not null,
  raw jsonb not null,
  fingerprint text not null,
  status text not null default 'pending' check (status in ('pending', 'inserted', 'error', 'duplicate')),
  operation_id bigint references operations(id),
  created_at timestamptz not null default now(),
  unique (batch_id, fingerprint)
);

create table if not exists import_errors (
  id bigserial primary key,
  batch_id bigint not null references import_batches(id) on delete cascade,
  row_no int,
  field text,
  message text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists import_mappings (
  id bigserial primary key,
  name text not null,
  mapping jsonb not null,
  created_by bigint not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists policies (
  id bigserial primary key,
  name text not null,
  subject text not null,
  action text not null,
  resource text not null,
  effect text not null check (effect in ('allow', 'deny')),
  conditions jsonb not null default '{}'::jsonb,
  created_by bigint not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists policy_bindings (
  id bigserial primary key,
  policy_id bigint not null references policies(id) on delete cascade,
  user_id bigint references users(id),
  role text,
  created_at timestamptz not null default now(),
  check (user_id is not null or role is not null)
);

create table if not exists policy_tests (
  id bigserial primary key,
  tested_by bigint not null references users(id),
  as_user_id bigint not null references users(id),
  action text not null,
  resource text not null,
  input jsonb,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists attachments (
  id bigserial primary key,
  entity text not null,
  entity_id bigint not null,
  project_id bigint references projects(id),
  file_name text not null,
  mime text not null,
  storage_key text not null,
  file_size bigint not null,
  uploaded_by bigint not null references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_attachments_entity on attachments(entity, entity_id);
create index if not exists idx_attachments_project on attachments(project_id);

create table if not exists ui_prefs (
  user_id bigint primary key references users(id) on delete cascade,
  prefs jsonb not null,
  updated_at timestamptz not null default now()
);

create materialized view if not exists mv_kpi_monthly as
select
  date_trunc('month', operation_date)::date as month,
  sum(case when type = 'income' and status = 'confirmed' then amount else 0 end) as income,
  sum(case when type = 'expense' and status = 'confirmed' then amount else 0 end) as expense,
  sum(case when type = 'tax' and status = 'confirmed' then amount else 0 end) as tax,
  sum(case when type = 'income' and status = 'confirmed' then amount else 0 end) -
  sum(case when type = 'expense' and status = 'confirmed' then amount else 0 end) -
  sum(case when type = 'tax' and status = 'confirmed' then amount else 0 end) +
  sum(case when type = 'adjustment' and status = 'confirmed' then amount else 0 end) as net_profit,
  sum(case when status = 'confirmed' and type in ('income','expense','tax','adjustment') then 1 else 0 end)::int as op_count
from operations
group by 1;

create unique index if not exists idx_mv_kpi_monthly_month on mv_kpi_monthly(month);

create or replace function refresh_mv_kpi_monthly() returns void as $$
begin
  refresh materialized view concurrently mv_kpi_monthly;
exception when feature_not_supported then
  refresh materialized view mv_kpi_monthly;
end;
$$ language plpgsql;

create or replace function app_allowed_project_ids() returns int[]
language sql
stable
as $$
  select coalesce(string_to_array(nullif(current_setting('app.allowed_project_ids', true), ''), ',')::int[], '{}');
$$;

alter table operations enable row level security;
alter table attachments enable row level security;

drop policy if exists operations_rls_policy on operations;
create policy operations_rls_policy on operations
using (
  coalesce(current_setting('app.rls_enforced', true), 'off') <> 'on'
  or project_id is null
  or project_id = any(app_allowed_project_ids())
  or created_by = nullif(current_setting('app.user_id', true), '')::int
);

drop policy if exists attachments_rls_policy on attachments;
create policy attachments_rls_policy on attachments
using (
  coalesce(current_setting('app.rls_enforced', true), 'off') <> 'on'
  or project_id is null
  or project_id = any(app_allowed_project_ids())
  or uploaded_by = nullif(current_setting('app.user_id', true), '')::int
);
