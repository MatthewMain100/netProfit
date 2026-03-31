function money(value) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export default function KpiTiles({ kpi }) {
  const items = [
    { key: 'net_profit', label: 'Net Profit', value: money(kpi?.net_profit) },
    { key: 'cash_in', label: 'Cash In', value: money(kpi?.cash_in) },
    { key: 'cash_out', label: 'Cash Out', value: money(kpi?.cash_out) },
    { key: 'tax', label: 'Tax', value: money(kpi?.tax) },
    { key: 'vat', label: 'VAT', value: money(kpi?.vat) },
    { key: 'margin', label: 'Margin', value: `${Number(kpi?.margin || 0).toFixed(1)}%` },
  ];

  return (
    <section className="cards">
      {items.map(item => (
        <div key={item.key} className="card">
          <h3>{item.label}</h3>
          <div className="value">{item.value}</div>
        </div>
      ))}
    </section>
  );
}
