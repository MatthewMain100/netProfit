import { useEffect, useState } from 'react';
import { api } from '../api';
import KpiTiles from '../components/KpiTiles.jsx';
import RiskRadar from '../components/RiskRadar.jsx';
import ProfitTimeline from '../components/ProfitTimeline.jsx';

function money(value) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

export default function FinanceCenter() {
  const [data, setData] = useState(null);
  const [drillDown, setDrillDown] = useState({ month: null, rows: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await api.financeCenter(24);
      setData(response);
    } catch (err) {
      setError(err.message || 'Ошибка загрузки Finance Center');
    } finally {
      setLoading(false);
    }
  }

  async function handleDrillDown(month) {
    const range = monthBounds(month);
    const rows = await api.operations(`?from=${range.from}&to=${range.to}`);
    setDrillDown({ month, rows: rows.slice(0, 100) });
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Finance Center</h1>
          <p>Единый центр управления прибылью, рисками и динамикой</p>
        </div>
        <div className="panel-actions">
          <button onClick={load} disabled={loading}>{loading ? 'Обновление...' : 'Обновить'}</button>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}
      <KpiTiles kpi={data?.kpi || {}} />

      <section className="grid">
        <RiskRadar items={data?.healthRadar || []} />
        <section className="panel">
          <h2>Топ проектов</h2>
          <ul className="list">
            {(data?.topProjects || []).map(item => (
              <li key={item.project}>{item.project} · {money(item.profit)}</li>
            ))}
          </ul>
          <h2 style={{ marginTop: 16 }}>Топ контрагентов (расходы)</h2>
          <ul className="list">
            {(data?.topCounterparties || []).map(item => (
              <li key={item.counterparty}>{item.counterparty} · {money(item.total)}</li>
            ))}
          </ul>
        </section>
      </section>

      <ProfitTimeline months={data?.months || []} onDrillDown={handleDrillDown} />

      {drillDown.month ? (
        <section className="panel">
          <h2>Drill-down операций за {drillDown.month}</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Дата</th>
                <th>Тип</th>
                <th>Сумма</th>
                <th>Проект</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {drillDown.rows.length === 0 ? (
                <tr><td colSpan="6">Нет операций</td></tr>
              ) : drillDown.rows.map(op => (
                <tr key={op.id}>
                  <td>{op.id}</td>
                  <td>{op.operation_date}</td>
                  <td>{op.type}</td>
                  <td>{money(op.amount)}</td>
                  <td>{op.project_name || '-'}</td>
                  <td>{op.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
