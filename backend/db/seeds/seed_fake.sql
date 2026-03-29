-- seed_fake.sql: bulk demo data
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
