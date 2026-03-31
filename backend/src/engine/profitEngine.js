export const ACCOUNT_CODES = {
  CASH: 'CASH',
  REVENUE: 'REVENUE',
  EXPENSE: 'EXPENSE',
  TAX_EXPENSE: 'TAX_EXPENSE',
  TAX_PAYABLE: 'TAX_PAYABLE',
  ADJ_INCOME: 'ADJ_INCOME',
  ADJ_EXPENSE: 'ADJ_EXPENSE',
};

export function monthStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export function monthRange(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const months = [];
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cur <= endMonth) {
    months.push(cur.toISOString().slice(0, 10));
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return months;
}

export async function ensureAccounts(client) {
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

export async function getAccountMap(client) {
  const { rows } = await client.query('select id, code from accounts');
  const map = new Map();
  for (const r of rows) map.set(r.code, r.id);
  return map;
}

export function buildLedgerEntries(op, accountMap) {
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

export async function rebuildReportsForRange(client, from, to) {
  const months = monthRange(from, to);
  if (!months.length) return;

  await client.query('delete from report_profit_monthly where month = any($1)', [months]);
  await client.query('delete from report_expense_structure where month = any($1)', [months]);
  await client.query('delete from report_project_profit where month = any($1)', [months]);

  for (const m of months) {
    const start = m;
    const endDate = new Date(`${m}T00:00:00Z`);
    const nextMonth = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 1));
    const end = new Date(nextMonth.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

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
         where le.operation_date >= $1 and le.operation_date <= $2
         group by 1
       ) s`,
      [start, end]
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
         and le.operation_date >= $1 and le.operation_date <= $2
       group by 1, 2`,
      [start, end]
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
       where le.operation_date >= $1 and le.operation_date <= $2
       group by 1, 2`,
      [start, end]
    );
  }
}

export async function calcPeriodSnapshot(client, startDate, endDate) {
  const { rows } = await client.query(
    `select
      coalesce(sum(case when a.type = 'income' then (le.credit - le.debit) else 0 end),0) as income,
      coalesce(sum(case when a.type = 'expense' and a.code != $3 then (le.debit - le.credit) else 0 end),0) as expense,
      coalesce(sum(case when a.code = $3 then (le.debit - le.credit) else 0 end),0) as tax
    from ledger_entries le
    join accounts a on a.id = le.account_id
    where le.operation_date >= $1 and le.operation_date <= $2`,
    [startDate, endDate, ACCOUNT_CODES.TAX_EXPENSE]
  );
  const income = Number(rows[0].income);
  const expense = Number(rows[0].expense);
  const tax = Number(rows[0].tax);
  const gross = income - expense;
  const net = gross - tax;
  return { income, expense, tax, gross, net };
}
