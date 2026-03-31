import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import Chart from 'chart.js/auto';

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => JSON.stringify(row[h] ?? '')).join(','));
  }
  return lines.join('\n');
}

function ChartBar({ labels, values, canvasRef }) {
  const chartRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'События', data: values, backgroundColor: '#1f1f1f' }] },
      options: { responsive: true, plugins: { legend: { display: false } } },
    });
    return () => chartRef.current?.destroy();
  }, [labels, values, canvasRef]);

  return <canvas ref={canvasRef} height="160" />;
}

export default function Audit() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ entity: '', action: '', from: '', to: '' });
  const [search, setSearch] = useState('');
  const chartRef = useRef(null);

  async function load() {
    setError('');
    try {
      const data = await api.audit();
      setRows(data);
    } catch (err) {
      setError(err.message || 'Ошибка загрузки');
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return rows.filter(r => {
      if (filters.entity && r.entity !== filters.entity) return false;
      if (filters.action && r.action !== filters.action) return false;
      if (filters.from && new Date(r.timestamp) < new Date(filters.from)) return false;
      if (filters.to && new Date(r.timestamp) > new Date(filters.to)) return false;
      if (term) {
        const hay = `${r.entity} ${r.action} ${r.user_email || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [rows, filters, search]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const deletes = filtered.filter(r => r.action === 'delete').length;
    const users = new Set(filtered.map(r => r.user_email)).size;
    return { total, deletes, users };
  }, [filtered]);

  const topUsers = useMemo(() => {
    const map = new Map();
    for (const r of filtered) {
      const key = r.user_email || 'unknown';
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [filtered]);

  const actionCounts = useMemo(() => {
    const map = new Map();
    filtered.forEach(r => map.set(r.action, (map.get(r.action) || 0) + 1));
    return { labels: Array.from(map.keys()), values: Array.from(map.values()) };
  }, [filtered]);

  function exportCsv() {
    const csv = toCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportChart() {
    if (!chartRef.current) return;
    const url = chartRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit_chart.png';
    a.click();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Аудит</h1>
          <p>Журнал действий пользователей</p>
        </div>
        <div className="panel-actions">
          <button className="ghost" onClick={exportCsv}>Экспорт CSV</button>
          <button onClick={load}>Обновить</button>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="stats-grid">
        <div className="stat-card"><div className="stat-label">Событий</div><div className="stat-value">{stats.total}</div></div>
        <div className="stat-card"><div className="stat-label">Удалений</div><div className="stat-value">{stats.deletes}</div></div>
        <div className="stat-card"><div className="stat-label">Активных пользователей</div><div className="stat-value">{stats.users}</div></div>
        <div className="stat-card"><div className="stat-label">Фильтр</div><div className="stat-sub">{filters.entity || 'Все'}</div></div>
      </section>

      <section className="grid">
        <div className="panel">
          <div className="panel-header">
            <h2>График действий</h2>
            <button className="ghost" onClick={exportChart}>PNG</button>
          </div>
          <ChartBar labels={actionCounts.labels} values={actionCounts.values} canvasRef={chartRef} />
        </div>
        <div className="panel">
          <h2>Топ пользователей</h2>
          <ul className="list">
            {topUsers.map(u => <li key={u.name}>{u.name} · {u.count}</li>)}
          </ul>
        </div>
      </section>

      <section className="panel">
        <h2>Фильтры</h2>
        <div className="toolbar">
          <input placeholder="Поиск" value={search} onChange={e => setSearch(e.target.value)} />
          <input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} />
          <input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} />
          <select value={filters.entity} onChange={e => setFilters({ ...filters, entity: e.target.value })}>
            <option value="">Все сущности</option>
            {[...new Set(rows.map(r => r.entity))].map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <select value={filters.action} onChange={e => setFilters({ ...filters, action: e.target.value })}>
            <option value="">Все действия</option>
            {[...new Set(rows.map(r => r.action))].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </section>

      <section className="panel">
        <h2>События</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Сущность</th>
              <th>Действие</th>
              <th>Пользователь</th>
              <th>Дата</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan="5">Нет данных</td></tr>
            ) : (
              filtered.map(r => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.entity} #{r.entity_id}</td>
                  <td><span className={`badge ${r.action === 'delete' ? 'danger' : 'success'}`}>{r.action}</span></td>
                  <td>{r.user_email || '-'}</td>
                  <td>{new Date(r.timestamp).toLocaleString('ru-RU')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}