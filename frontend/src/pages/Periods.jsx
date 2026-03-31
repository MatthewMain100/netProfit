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
      data: { labels, datasets: [{ label: 'Чистая прибыль', data: values, backgroundColor: '#1f1f1f' }] },
      options: { responsive: true, plugins: { legend: { display: false } } },
    });
    return () => chartRef.current?.destroy();
  }, [labels, values, canvasRef]);

  return <canvas ref={canvasRef} height="160" />;
}

export default function Periods() {
  const [periods, setPeriods] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [ops, setOps] = useState([]);
  const [form, setForm] = useState({ start_date: '', end_date: '' });
  const [series, setSeries] = useState({ start_date: '', count: 3, unit: 'month' });
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [edit, setEdit] = useState(null);
  const chartRef = useRef(null);

  async function load() {
    setError('');
    try {
      const [p, s, opsData] = await Promise.all([
        api.periods(),
        api.snapshots(),
        api.operations('?from=1900-01-01&to=2999-12-31'),
      ]);
      setPeriods(p);
      setSnapshots(s);
      setOps(opsData);
    } catch (err) {
      setError(err.message || 'Ошибка загрузки');
    }
  }

  useEffect(() => { load(); }, []);

  function overlaps(start, end) {
    const s = new Date(start);
    const e = new Date(end);
    return periods.some(p => {
      const ps = new Date(p.start_date);
      const pe = new Date(p.end_date);
      return s <= pe && e >= ps;
    });
  }

  async function createPeriod(e) {
    e.preventDefault();
    if (overlaps(form.start_date, form.end_date)) {
      setError('Период пересекается с существующим');
      return;
    }
    await api.createPeriod(form);
    setForm({ start_date: '', end_date: '' });
    await load();
  }

  async function closePeriod(id) {
    await api.closePeriod(id);
    await load();
  }

  function createCurrentMonth() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    setForm({
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
    });
  }

  async function generateSeries() {
    if (!series.start_date || !series.count) return;
    let cursor = new Date(series.start_date);
    for (let i = 0; i < Number(series.count); i += 1) {
      let start = new Date(cursor);
      let end = new Date(cursor);
      if (series.unit === 'week') {
        end.setDate(end.getDate() + 6);
      } else if (series.unit === 'quarter') {
        end = new Date(start.getFullYear(), start.getMonth() + 3, 0);
      } else {
        end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      }
      await api.createPeriod({
        start_date: start.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
      });

      if (series.unit === 'week') cursor.setDate(cursor.getDate() + 7);
      else if (series.unit === 'quarter') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 3, 1);
      else cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    await load();
  }

  async function saveEdit() {
    if (!edit) return;
    await api.updatePeriod(edit.id, { start_date: edit.start_date, end_date: edit.end_date });
    setEdit(null);
    await load();
  }

  function exportSnapshots() {
    const csv = toCsv(snapshots);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'snapshots.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportChart() {
    if (!chartRef.current) return;
    const url = chartRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'periods_chart.png';
    a.click();
  }

  const stats = useMemo(() => {
    const open = periods.filter(p => p.status === 'open').length;
    const closed = periods.filter(p => p.status === 'closed').length;
    const drafts = ops.filter(o => o.status === 'draft').length;
    return { open, closed, drafts, total: periods.length };
  }, [periods, ops]);

  const selectedOps = useMemo(() => {
    if (!selected) return [];
    const s = new Date(selected.start_date);
    const e = new Date(selected.end_date);
    return ops.filter(o => {
      const d = new Date(o.operation_date);
      return d >= s && d <= e;
    });
  }, [selected, ops]);

  const chartLabels = snapshots.map(s => `${s.start_date}`);
  const chartValues = snapshots.map(s => Number(s.net_profit));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Периоды</h1>
          <p>Закрытие периодов и фиксация прибыли</p>
        </div>
        <div className="panel-actions">
          <button className="ghost" onClick={exportSnapshots}>Экспорт снимков</button>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="stats-grid">
        <div className="stat-card"><div className="stat-label">Всего периодов</div><div className="stat-value">{stats.total}</div></div>
        <div className="stat-card"><div className="stat-label">Открыто</div><div className="stat-value">{stats.open}</div></div>
        <div className="stat-card"><div className="stat-label">Закрыто</div><div className="stat-value">{stats.closed}</div></div>
        <div className="stat-card"><div className="stat-label">Черновиков</div><div className="stat-value">{stats.drafts}</div></div>
      </section>

      <section className="grid">
        <div className="panel">
          <div className="panel-header">
            <h2>График прибыли по периодам</h2>
            <button className="ghost" onClick={exportChart}>PNG</button>
          </div>
          <ChartBar labels={chartLabels} values={chartValues} canvasRef={chartRef} />
        </div>
        <div className="panel">
          <h2>Серия периодов</h2>
          <div className="form-inline">
            <input type="date" value={series.start_date} onChange={e => setSeries({ ...series, start_date: e.target.value })} />
            <input type="number" value={series.count} onChange={e => setSeries({ ...series, count: e.target.value })} />
            <select value={series.unit} onChange={e => setSeries({ ...series, unit: e.target.value })}>
              <option value="week">Недели</option>
              <option value="month">Месяцы</option>
              <option value="quarter">Кварталы</option>
            </select>
            <button className="ghost" onClick={generateSeries}>Создать серию</button>
          </div>
        </div>
      </section>

      <section className="split">
        <div className="panel">
          <h2>Создать период</h2>
          <form className="form-inline" onSubmit={createPeriod}>
            <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
            <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
            <button>Создать</button>
            <button type="button" className="ghost" onClick={createCurrentMonth}>Текущий месяц</button>
          </form>
          <div className="callout">
            Перед закрытием убедитесь, что все операции подтверждены.
          </div>
        </div>
        <aside className="side-panel">
          <h2>Детали периода</h2>
          {selected ? (
            <div className="summary">
              <div>{selected.start_date} → {selected.end_date}</div>
              <div>Статус: {selected.status}</div>
              <div>Операций: {selectedOps.length}</div>
              <div>Черновики: {selectedOps.filter(o => o.status === 'draft').length}</div>
            </div>
          ) : (
            <div className="muted">Выберите период в таблице</div>
          )}
        </aside>
      </section>

      {edit ? (
        <section className="panel">
          <h2>Редактирование периода #{edit.id}</h2>
          <div className="form-inline">
            <input type="date" value={edit.start_date} onChange={e => setEdit({ ...edit, start_date: e.target.value })} />
            <input type="date" value={edit.end_date} onChange={e => setEdit({ ...edit, end_date: e.target.value })} />
            <button onClick={saveEdit}>Сохранить</button>
            <button className="ghost" onClick={() => setEdit(null)}>Отмена</button>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>Список периодов</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Начало</th>
              <th>Конец</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {periods.length === 0 ? (
              <tr><td colSpan="5">Нет данных</td></tr>
            ) : (
              periods.map(p => (
                <tr key={p.id} onClick={() => setSelected(p)}>
                  <td>{p.id}</td>
                  <td>{p.start_date}</td>
                  <td>{p.end_date}</td>
                  <td><span className={`badge ${p.status === 'closed' ? 'success' : 'warning'}`}>{p.status}</span></td>
                  <td>
                    {p.status !== 'closed' ? (
                      <button className="ghost" onClick={() => closePeriod(p.id)}>Закрыть</button>
                    ) : (
                      <button className="ghost" disabled>Открыть</button>
                    )}
                    <button className="ghost" onClick={() => setEdit({ id: p.id, start_date: p.start_date, end_date: p.end_date })}>Изменить</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Снимки прибыли</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Период</th>
              <th>Валовая</th>
              <th>Налоги</th>
              <th>Чистая</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.length === 0 ? (
              <tr><td colSpan="5">Нет данных</td></tr>
            ) : (
              snapshots.map(s => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>{s.start_date} → {s.end_date}</td>
                  <td>{s.gross_profit}</td>
                  <td>{s.tax_total}</td>
                  <td>{s.net_profit}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}