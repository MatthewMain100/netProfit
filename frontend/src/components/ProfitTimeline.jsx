function money(value) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export default function ProfitTimeline({ months, onDrillDown }) {
  return (
    <section className="panel">
      <h2>Таймлайн прибыли</h2>
      <table>
        <thead>
          <tr>
            <th>Месяц</th>
            <th>Income</th>
            <th>Expense</th>
            <th>Tax</th>
            <th>Net Profit</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {!months?.length ? (
            <tr><td colSpan="6">Нет данных</td></tr>
          ) : months.map(row => (
            <tr key={row.month}>
              <td>{row.month}</td>
              <td>{money(row.income)}</td>
              <td>{money(row.expense)}</td>
              <td>{money(row.tax)}</td>
              <td>{money(row.net_profit)}</td>
              <td>
                <button className="ghost" onClick={() => onDrillDown?.(row.month)}>Drill-down</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
