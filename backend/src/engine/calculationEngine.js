import { query } from '../db.js';

export async function getRuleValue(key, fallback = {}) {
  const { rows } = await query('select value from calculation_rules where key = $1 and enabled = true', [key]);
  if (!rows[0]) return fallback;
  return rows[0].value || fallback;
}

export async function runScenarioSpec(spec) {
  const base = await query('select month, income, expense, tax, net_profit from mv_kpi_monthly order by month');
  const monthFrom = spec.monthFrom ? new Date(spec.monthFrom) : null;
  const expenseMultiplier = Number(spec.expenseMultiplier || 1);
  const incomeDelta = Number(spec.incomeDelta || 0);
  const taxMultiplier = Number(spec.taxMultiplier || 1);

  const rows = base.rows.map(r => {
    const monthDate = new Date(r.month);
    const affected = !monthFrom || monthDate >= monthFrom;
    const income = Number(r.income || 0) + (affected ? incomeDelta : 0);
    const expense = affected ? Number(r.expense || 0) * expenseMultiplier : Number(r.expense || 0);
    const tax = affected ? Number(r.tax || 0) * taxMultiplier : Number(r.tax || 0);
    const net = income - expense - tax;
    return {
      month: r.month,
      income: Number(r.income || 0),
      expense: Number(r.expense || 0),
      tax: Number(r.tax || 0),
      net_profit: Number(r.net_profit || 0),
      scenario_income: income,
      scenario_expense: expense,
      scenario_tax: tax,
      scenario_net_profit: net,
    };
  });

  return rows;
}

export async function buildPrecloseChecks(periodId) {
  const checks = [];

  const draft = await query(
    `select count(*)::int as cnt
     from operations
     where period_id = $1 and status = 'draft'`,
    [periodId]
  );
  if (draft.rows[0].cnt > 0) {
    checks.push({ check_key: 'draft_ops', severity: 'block', details: { count: draft.rows[0].cnt } });
  } else {
    checks.push({ check_key: 'draft_ops', severity: 'info', details: { count: 0 } });
  }

  const missingCategory = await query(
    `select count(*)::int as cnt
     from operations
     where period_id = $1 and status = 'confirmed' and category_id is null`,
    [periodId]
  );
  if (missingCategory.rows[0].cnt > 0) {
    checks.push({ check_key: 'missing_category', severity: 'warn', details: { count: missingCategory.rows[0].cnt } });
  }

  const negative = await query(
    `select count(*)::int as cnt
     from operations
     where period_id = $1 and status = 'confirmed' and type in ('income','expense','tax') and amount <= 0`,
    [periodId]
  );
  if (negative.rows[0].cnt > 0) {
    checks.push({ check_key: 'negative_amounts', severity: 'block', details: { count: negative.rows[0].cnt } });
  }

  const vatMismatch = await query(
    `select count(*)::int as cnt
     from operations
     where period_id = $1 and status = 'confirmed' and vat_included = true and coalesce(vat_amount, 0) = 0`,
    [periodId]
  );
  if (vatMismatch.rows[0].cnt > 0) {
    checks.push({ check_key: 'vat_mismatch', severity: 'warn', details: { count: vatMismatch.rows[0].cnt } });
  }

  return checks;
}

export function periodProtocolHtml({ period, checks, snapshot, comment }) {
  const rows = checks.map(c => `
    <tr>
      <td>${c.check_key}</td>
      <td>${c.severity.toUpperCase()}</td>
      <td><pre>${JSON.stringify(c.details, null, 2)}</pre></td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Протокол закрытия периода #${period.id}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #1f2937; }
    h1, h2 { margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
    .meta { margin: 8px 0; }
    pre { margin: 0; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h1>Протокол закрытия периода</h1>
  <div class="meta">Период: ${period.start_date} - ${period.end_date}</div>
  <div class="meta">Комментарий: ${comment || '-'}</div>
  <h2>Финансовый итог</h2>
  <div class="meta">Валовая прибыль: ${snapshot.gross}</div>
  <div class="meta">Налоги: ${snapshot.tax}</div>
  <div class="meta">Чистая прибыль: ${snapshot.net}</div>
  <h2>Результаты проверок</h2>
  <table>
    <thead>
      <tr><th>Проверка</th><th>Уровень</th><th>Детали</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}
