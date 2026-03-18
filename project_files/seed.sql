insert into roles (name) values ('accountant'), ('manager'), ('admin') on conflict do nothing;

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
