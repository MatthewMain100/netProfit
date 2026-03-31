export default function FilterPanel({ from, to, setFrom, setTo, limit, setLimit, metric, setMetric }) {
  return (
    <div className="panel">
      <h2>Filter Panel</h2>
      <div className="toolbar">
        <label>
          С
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </label>
        <label>
          По
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </label>
        <label>
          Метрика
          <select value={metric} onChange={e => setMetric(e.target.value)}>
            <option value="sum_amount">sum_amount</option>
            <option value="count">count</option>
            <option value="avg_amount">avg_amount</option>
          </select>
        </label>
        <label>
          Limit
          <input type="number" min="1" max="1000" value={limit} onChange={e => setLimit(e.target.value)} />
        </label>
      </div>
    </div>
  );
}
