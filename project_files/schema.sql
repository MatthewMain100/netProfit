create table if not exists roles (
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
