export default function PreviewTable({ columns, rows }) {
  return (
    <div className="panel">
      <h2>Preview Table</h2>
      <table>
        <thead>
          <tr>
            {columns.map(c => <th key={c}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {!rows.length ? (
            <tr><td colSpan={Math.max(columns.length, 1)}>Нет данных</td></tr>
          ) : rows.map((row, idx) => (
            <tr key={idx}>
              {columns.map(c => <td key={c}>{String(row[c] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
