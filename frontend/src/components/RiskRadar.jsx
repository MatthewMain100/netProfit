export default function RiskRadar({ items }) {
  return (
    <section className="panel">
      <h2>Health Radar</h2>
      {items?.length ? (
        <table>
          <thead>
            <tr>
              <th>Показатель</th>
              <th>Значение</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.key}>
                <td>{item.text}</td>
                <td>{item.value}</td>
                <td>
                  <span className={`badge ${item.severity === 'warn' ? 'warning' : 'success'}`}>
                    {item.severity === 'warn' ? 'WARN' : 'OK'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty">Риски не найдены</div>
      )}
    </section>
  );
}
