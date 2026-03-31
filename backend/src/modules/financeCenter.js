import { withCache } from '../infra/cache.js';

function asNum(v) {
  return Number(v || 0);
}

export function registerFinanceCenterRoutes({ app, requireAuth, requireFeature, query }) {
  app.get('/dashboard/finance-center', requireAuth, requireFeature('finance_center'), async (req, res) => {
    const monthsLimit = Math.min(Math.max(Number(req.query.months || 24), 1), 36);
    const cacheKey = `dashboard:finance-center:${monthsLimit}`;

    const payload = await withCache(cacheKey, 45, async () => {
      const monthsRes = await query(
        `select month, income, expense, tax, net_profit, op_count
         from mv_kpi_monthly
         order by month desc
         limit $1`,
        [monthsLimit]
      );

      const months = monthsRes.rows.map(r => ({
        month: String(r.month).slice(0, 10),
        income: asNum(r.income),
        expense: asNum(r.expense),
        tax: asNum(r.tax),
        net_profit: asNum(r.net_profit),
        op_count: Number(r.op_count || 0),
      }));

      const kpi = months.reduce(
        (acc, row) => {
          acc.net_profit += row.net_profit;
          acc.cash_in += row.income;
          acc.cash_out += row.expense;
          acc.tax += row.tax;
          return acc;
        },
        { net_profit: 0, cash_in: 0, cash_out: 0, tax: 0, vat: 0, margin: 0 }
      );
      kpi.margin = kpi.cash_in > 0 ? (kpi.net_profit / kpi.cash_in) * 100 : 0;

      const [openPeriods, drafts, allOps, openIssues, vatMismatch, topProjects, topCounterparties] = await Promise.all([
        query(`select count(*)::int as cnt from periods where status = 'open'`),
        query(`select count(*)::int as cnt from operations where status = 'draft'`),
        query(`select count(*)::int as cnt from operations`),
        query(`select count(*)::int as cnt from quality_issues where status = 'open'`),
        query(`select count(*)::int as cnt from operations where status = 'confirmed' and vat_included = true and coalesce(vat_amount, 0) = 0`),
        query(
          `select coalesce(pv.name, 'Без проекта') as project, sum(r.profit) as profit
           from report_project_profit r
           left join project_versions pv on pv.id = r.project_version_id
           where r.month >= (date_trunc('month', now())::date - interval '12 month')
           group by 1
           order by profit desc
           limit 5`
        ),
        query(
          `select coalesce(cpv.name, 'Без контрагента') as counterparty, sum(o.amount) as total
           from operations o
           left join counterparty_versions cpv on cpv.id = o.counterparty_version_id
           where o.status = 'confirmed' and o.type in ('expense', 'tax')
           group by 1
           order by total desc
           limit 5`
        ),
      ]);

      const totalOps = Number(allOps.rows[0]?.cnt || 0);
      const draftOps = Number(drafts.rows[0]?.cnt || 0);

      const healthRadar = [
        {
          key: 'open_periods',
          severity: Number(openPeriods.rows[0]?.cnt || 0) > 1 ? 'warn' : 'info',
          value: Number(openPeriods.rows[0]?.cnt || 0),
          text: 'Незакрытые периоды',
        },
        {
          key: 'draft_ratio',
          severity: totalOps > 0 && draftOps / totalOps > 0.2 ? 'warn' : 'info',
          value: totalOps > 0 ? Number(((draftOps / totalOps) * 100).toFixed(2)) : 0,
          text: 'Доля draft операций, %',
        },
        {
          key: 'quality_open',
          severity: Number(openIssues.rows[0]?.cnt || 0) > 20 ? 'warn' : 'info',
          value: Number(openIssues.rows[0]?.cnt || 0),
          text: 'Открытые quality issues',
        },
        {
          key: 'vat_mismatch',
          severity: Number(vatMismatch.rows[0]?.cnt || 0) > 0 ? 'warn' : 'info',
          value: Number(vatMismatch.rows[0]?.cnt || 0),
          text: 'Несостыковки VAT',
        },
      ];

      return {
        kpi,
        healthRadar,
        months,
        topProjects: topProjects.rows.map(r => ({ project: r.project, profit: asNum(r.profit) })),
        topCounterparties: topCounterparties.rows.map(r => ({ counterparty: r.counterparty, total: asNum(r.total) })),
      };
    });

    res.json(payload);
  });
}
