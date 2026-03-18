-- 00_restore_demo_from_sources.sql
-- creates schema and loads demo data from source SQL files
﻿create table if not exists roles (
  id serial primary key,
  name text not null unique
);

create table if not exists users (
  id serial primary key,
  email text not null unique,
  password_hash text not null,
  role_id int references roles(id),
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id serial primary key,
  name text not null unique,
  status text not null default 'active'
);

create table if not exists categories (
  id serial primary key,
  name text not null,
  type text not null check (type in ('income','expense','tax')),
  parent_id int references categories(id)
);

create table if not exists counterparties (
  id serial primary key,
  name text not null,
  inn text,
  type text
);

create table if not exists category_versions (
  id serial primary key,
  category_id int not null references categories(id) on delete cascade,
  name text not null,
  type text not null check (type in ('income','expense','tax')),
  parent_id int references categories(id),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  is_current boolean not null default true
);

create unique index if not exists uq_category_versions_current on category_versions(category_id) where is_current;

create table if not exists project_versions (
  id serial primary key,
  project_id int not null references projects(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  is_current boolean not null default true
);

create unique index if not exists uq_project_versions_current on project_versions(project_id) where is_current;

create table if not exists counterparty_versions (
  id serial primary key,
  counterparty_id int not null references counterparties(id) on delete cascade,
  name text not null,
  inn text,
  type text,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  is_current boolean not null default true
);

create unique index if not exists uq_counterparty_versions_current on counterparty_versions(counterparty_id) where is_current;

create table if not exists periods (
  id serial primary key,
  start_date date not null,
  end_date date not null,
  status text not null default 'open'
);

create table if not exists operations (
  id serial primary key,
  type text not null check (type in ('income','expense','tax','adjustment')),
  category_id int references categories(id),
  project_id int references projects(id),
  counterparty_id int references counterparties(id),
  amount numeric(14,2) not null,
  currency text not null default 'RUB',
  vat_included boolean not null default false,
  vat_amount numeric(14,2) not null default 0,
  operation_date date not null,
  period_id int references periods(id),
  status text not null default 'draft' check (status in ('draft','confirmed')),
  comment text,
  adjustment boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table operations
  add column if not exists category_version_id int references category_versions(id);
alter table operations
  add column if not exists project_version_id int references project_versions(id);
alter table operations
  add column if not exists counterparty_version_id int references counterparty_versions(id);

create or replace function prevent_ops_in_closed_periods() returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    if exists (
      select 1 from periods
      where status = 'closed'
        and new.operation_date >= start_date
        and new.operation_date <= end_date
    ) then
      raise exception 'operation date is in a closed period';
    end if;
    return new;
  elsif (tg_op = 'UPDATE') then
    if exists (
      select 1 from periods
      where status = 'closed'
        and old.operation_date >= start_date
        and old.operation_date <= end_date
    ) then
      raise exception 'operation is in a closed period';
    end if;
    if exists (
      select 1 from periods
      where status = 'closed'
        and new.operation_date >= start_date
        and new.operation_date <= end_date
    ) then
      raise exception 'operation date is in a closed period';
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if exists (
      select 1 from periods
      where status = 'closed'
        and old.operation_date >= start_date
        and old.operation_date <= end_date
    ) then
      raise exception 'operation is in a closed period';
    end if;
    return old;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_prevent_ops_in_closed_periods on operations;
create trigger trg_prevent_ops_in_closed_periods
before insert or update or delete on operations
for each row execute function prevent_ops_in_closed_periods();

create table if not exists accounts (
  id serial primary key,
  code text not null unique,
  name text not null,
  type text not null check (type in ('asset','liability','equity','income','expense')),
  is_system boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists journal (
  id serial primary key,
  operation_id int not null references operations(id) on delete cascade,
  created_by int references users(id),
  created_at timestamptz not null default now(),
  memo text,
  unique (operation_id)
);

create table if not exists ledger_entries (
  id serial primary key,
  journal_id int not null references journal(id) on delete cascade,
  operation_id int not null references operations(id) on delete cascade,
  account_id int not null references accounts(id),
  debit numeric(14,2) not null default 0,
  credit numeric(14,2) not null default 0,
  operation_date date not null,
  category_id int references categories(id),
  project_id int references projects(id),
  counterparty_id int references counterparties(id),
  created_at timestamptz not null default now(),
  check (debit >= 0 and credit >= 0),
  check (debit + credit > 0),
  check (debit = 0 or credit = 0)
);

alter table ledger_entries
  add column if not exists category_version_id int references category_versions(id);
alter table ledger_entries
  add column if not exists project_version_id int references project_versions(id);
alter table ledger_entries
  add column if not exists counterparty_version_id int references counterparty_versions(id);

create index if not exists idx_ledger_entries_operation_date on ledger_entries(operation_date);
create index if not exists idx_ledger_entries_account on ledger_entries(account_id);
create index if not exists idx_ledger_entries_category on ledger_entries(category_id);
create index if not exists idx_ledger_entries_project on ledger_entries(project_id);

drop table if exists report_profit_monthly;
drop table if exists report_expense_structure;
drop table if exists report_project_profit;

create table if not exists report_profit_monthly (
  month date primary key,
  net_profit numeric(14,2) not null default 0
);

create table if not exists report_expense_structure (
  month date not null,
  category_version_id int,
  total numeric(14,2) not null default 0,
  primary key (month, category_version_id)
);

create table if not exists report_project_profit (
  month date not null,
  project_version_id int,
  profit numeric(14,2) not null default 0,
  primary key (month, project_version_id)
);

create index if not exists idx_report_expense_structure_month on report_expense_structure(month);
create index if not exists idx_report_project_profit_month on report_project_profit(month);

insert into category_versions (category_id, name, type, parent_id, valid_from, valid_to, is_current)
select c.id, c.name, c.type, c.parent_id, now(), null, true
from categories c
where not exists (
  select 1 from category_versions cv where cv.category_id = c.id and cv.is_current = true
);

insert into project_versions (project_id, name, status, valid_from, valid_to, is_current)
select p.id, p.name, p.status, now(), null, true
from projects p
where not exists (
  select 1 from project_versions pv where pv.project_id = p.id and pv.is_current = true
);

insert into counterparty_versions (counterparty_id, name, inn, type, valid_from, valid_to, is_current)
select cp.id, cp.name, cp.inn, cp.type, now(), null, true
from counterparties cp
where not exists (
  select 1 from counterparty_versions cv where cv.counterparty_id = cp.id and cv.is_current = true
);

update operations o
set category_version_id = cv.id
from category_versions cv
where o.category_id = cv.category_id and cv.is_current = true and o.category_version_id is null;

update operations o
set project_version_id = pv.id
from project_versions pv
where o.project_id = pv.project_id and pv.is_current = true and o.project_version_id is null;

update operations o
set counterparty_version_id = cv.id
from counterparty_versions cv
where o.counterparty_id = cv.counterparty_id and cv.is_current = true and o.counterparty_version_id is null;

update ledger_entries le
set category_version_id = cv.id
from category_versions cv
where le.category_id = cv.category_id and cv.is_current = true and le.category_version_id is null;

update ledger_entries le
set project_version_id = pv.id
from project_versions pv
where le.project_id = pv.project_id and pv.is_current = true and le.project_version_id is null;

update ledger_entries le
set counterparty_version_id = cv.id
from counterparty_versions cv
where le.counterparty_id = cv.counterparty_id and cv.is_current = true and le.counterparty_version_id is null;

create table if not exists profit_snapshots (
  id serial primary key,
  period_id int not null references periods(id),
  gross_profit numeric(14,2) not null,
  tax_total numeric(14,2) not null,
  net_profit numeric(14,2) not null,
  created_at timestamptz not null default now(),
  created_by int references users(id)
);

create table if not exists audit_logs (
  id serial primary key,
  entity text not null,
  entity_id int not null,
  action text not null,
  user_id int references users(id),
  timestamp timestamptz not null default now(),
  diff jsonb
);

create table if not exists domain_events (
  id bigserial primary key,
  event_type text not null,
  entity text not null,
  entity_id int,
  actor_id int references users(id),
  occurred_at timestamptz not null default now(),
  payload jsonb
);

create index if not exists idx_domain_events_entity on domain_events(entity, entity_id);
create index if not exists idx_domain_events_time on domain_events(occurred_at);


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


﻿insert into roles (name) values ('accountant'), ('manager'), ('admin') on conflict do nothing;

insert into accounts (code, name, type, is_system) values
  ('CASH', 'Cash/Bank', 'asset', true),
  ('REVENUE', 'Revenue', 'income', true),
  ('EXPENSE', 'Expense', 'expense', true),
  ('TAX_EXPENSE', 'Tax Expense', 'expense', true),
  ('TAX_PAYABLE', 'Tax Payable', 'liability', true),
  ('ADJ_INCOME', 'Adjustments (Income)', 'income', true),
  ('ADJ_EXPENSE', 'Adjustments (Expense)', 'expense', true)
on conflict (code) do nothing;


insert into projects (name) values ('Проект A'), ('Проект B') on conflict do nothing;

insert into categories (name, type) values
  ('Продажи', 'income'),
  ('Материалы', 'expense'),
  ('Зарплата', 'expense'),
  ('Налоги', 'tax')
on conflict do nothing;

insert into operations (type, category_id, project_id, amount, operation_date, status)
values
  ('income', 1, 1, 120000, '2025-12-15', 'confirmed'),
  ('expense', 2, 1, 40000, '2025-12-18', 'confirmed'),
  ('expense', 3, 1, 25000, '2025-12-20', 'confirmed'),
  ('tax', 4, 1, 8000, '2025-12-25', 'confirmed'),
  ('income', 1, 2, 90000, '2026-01-10', 'confirmed'),
  ('expense', 2, 2, 30000, '2026-01-12', 'confirmed'),
  ('tax', 4, 2, 6000, '2026-01-20', 'confirmed');


﻿-- seed_fake.sql: bulk demo data
-- 1) ensure catalogs
insert into categories (name, type) values
  ('Продажи B2B','income'),
  ('Продажи B2C','income'),
  ('Сервис','income'),
  ('Материалы','expense'),
  ('Маркетинг','expense'),
  ('Логистика','expense'),
  ('Зарплата','expense'),
  ('Налоги','tax')
on conflict do nothing;

insert into projects (name, status) values
  ('Проект Север','active'),
  ('Проект Восток','active'),
  ('Проект Запад','active'),
  ('Проект Центр','active'),
  ('Проект Экспорт','active')
on conflict do nothing;

insert into counterparties (name, inn, type) values
  ('ООО Альфа','7701000001','company'),
  ('ООО Бета','7701000002','company'),
  ('ООО Гамма','7701000003','company'),
  ('ИП Дельта',null,'person'),
  ('ЗАО Омега','7701000004','company')
on conflict do nothing;

-- 2) ensure versions for existing catalogs
insert into category_versions (category_id, name, type, parent_id, valid_from, valid_to, is_current)
select c.id, c.name, c.type, c.parent_id, now(), null, true
from categories c
where not exists (select 1 from category_versions cv where cv.category_id = c.id and cv.is_current = true);

insert into project_versions (project_id, name, status, valid_from, valid_to, is_current)
select p.id, p.name, p.status, now(), null, true
from projects p
where not exists (select 1 from project_versions pv where pv.project_id = p.id and pv.is_current = true);

insert into counterparty_versions (counterparty_id, name, inn, type, valid_from, valid_to, is_current)
select cp.id, cp.name, cp.inn, cp.type, now(), null, true
from counterparties cp
where not exists (select 1 from counterparty_versions cv where cv.counterparty_id = cp.id and cv.is_current = true);

-- 3) bulk operations
insert into operations (
  type,
  amount,
  category_id,
  category_version_id,
  project_id,
  project_version_id,
  counterparty_id,
  counterparty_version_id,
  currency,
  vat_included,
  vat_amount,
  operation_date,
  status,
  comment,
  adjustment
)
select
  op_type,
  op_amount,
  cv.category_id,
  cv.id,
  pv.project_id,
  pv.id,
  cpv.counterparty_id,
  cpv.id,
  'RUB',
  (random() < 0.35),
  round((random() * 5000)::numeric, 2),
  op_date,
  op_status,
  concat('auto seed #', gs),
  (op_type = 'adjustment')
from generate_series(1, 360) as gs
cross join lateral (
  select
    case
      when r < 0.45 then 'income'
      when r < 0.80 then 'expense'
      when r < 0.92 then 'tax'
      else 'adjustment'
    end as op_type,
    case
      when r < 0.45 then round((random()*120000 + 5000)::numeric, 2)
      when r < 0.80 then round((random()*70000 + 2000)::numeric, 2)
      when r < 0.92 then round((random()*20000 + 500)::numeric, 2)
      else round(((random()*2 - 1) * (random()*15000 + 500))::numeric, 2)
    end as op_amount,
    (date '2024-01-01' + (random()*770)::int) as op_date,
    case when random() < 0.78 then 'confirmed' else 'draft' end as op_status,
    case
      when r < 0.45 then 'income'
      when r < 0.92 then 'expense'
      else 'expense'
    end as cat_type
  from (select random() as r) s
) v
cross join lateral (
  select cv.id, cv.category_id
  from category_versions cv
  join categories c on c.id = cv.category_id
  where cv.is_current = true and c.type = v.cat_type
  order by random()
  limit 1
) cv
cross join lateral (
  select pv.id, pv.project_id
  from project_versions pv
  where pv.is_current = true
  order by random()
  limit 1
) pv
cross join lateral (
  select cpv.id, cpv.counterparty_id
  from counterparty_versions cpv
  where cpv.is_current = true
  order by random()
  limit 1
) cpv;

