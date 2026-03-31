import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import Chart from 'chart.js/auto';

const types = ['income', 'expense', 'tax', 'adjustment'];

function formatMoney(value) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value || 0);
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => JSON.stringify(row[h] ?? '')).join(','));
  }
  return lines.join('\n');
}

function ChartBar({ labels, income, expense }) {
  const ref = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(ref.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Доходы', data: income, backgroundColor: '#1f1f1f' },
          { label: 'Расходы', data: expense, backgroundColor: '#9c7d4e' },
        ],
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } },
    });
    return () => chartRef.current?.destroy();
  }, [labels, income, expense]);

  return <canvas ref={ref} height="160" />;
}

function GraphView({ nodes, links }) {
  const [zoom, setZoom] = useState(1);
  const w = 420;
  const h = 220;
  if (!nodes.length) return <div className="empty">Нет данных</div>;

  function onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => Math.min(2, Math.max(0.6, z + delta)));
  }

  const centerX = w / 2;
  const centerY = h / 2;
  const r = 80;
  const positions = nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    return {
      ...n,
      x: centerX + r * Math.cos(angle),
      y: centerY + r * Math.sin(angle),
    };
  });

  const nodeMap = new Map(positions.map(p => [p.id, p]));

  return (
    <div className="graph-wrap" onWheel={onWheel}>
      <svg width={w} height={h} className="graph" style={{ transform: `scale(${zoom})` }}>
        {links.map((l, idx) => {
          const a = nodeMap.get(l.source);
          const b = nodeMap.get(l.target);
          if (!a || !b) return null;
          return <line key={idx} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
        {positions.map(p => (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={12} />
            <text x={p.x} y={p.y + 4}>{p.label}</text>
          </g>
        ))}
      </svg>
      <div className="muted">Масштаб: {Math.round(zoom * 100)}%</div>
    </div>
  );
}

export default function Operations() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState('');
  const [compact, setCompact] = useState(false);
  const [active, setActive] = useState(null);
  const [dateShift, setDateShift] = useState(0);
  const [setDate, setSetDate] = useState('');
  const [seriesStart, setSeriesStart] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(new Date().toISOString().slice(0, 7));
  const [form, setForm] = useState({
    type: 'income',
    amount: '',
    category_id: '',
    project_id: '',
    counterparty_id: '',
    operation_date: new Date().toISOString().slice(0, 10),
    status: 'draft',
    comment: '',
  });
  const [filters, setFilters] = useState({
    from: new Date(new Date().setMonth(new Date().getMonth() - 6)).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
    type: '',
    status: '',
  });
  const [categories, setCategories] = useState([]);
  const [projects, setProjects] = useState([]);
  const [counterparties, setCounterparties] = useState([]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ from: filters.from, to: filters.to });
      if (filters.type) params.set('type', filters.type);
      if (filters.status) params.set('status', filters.status);

      const [ops, cats, projs, cps] = await Promise.all([
        api.operations(`?${params.toString()}`),
        api.categories(),
        api.projects(),
        api.counterparties(),
      ]);
      setItems(ops);
      setCategories(cats);
      setProjects(projs);
      setCounterparties(cps);
      setSelected(new Set());
    } catch (err) {
      setError(err.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const payload = {
        ...form,
        amount: Number(form.amount),
        category_id: form.category_id ? Number(form.category_id) : null,
        project_id: form.project_id ? Number(form.project_id) : null,
        counterparty_id: form.counterparty_id ? Number(form.counterparty_id) : null,
      };
      if (editId) {
        await api.updateOperation(editId, payload);
      } else {
        await api.createOperation(payload);
      }
      setEditId(null);
      setForm({ ...form, amount: '', comment: '' });
      await load();
    } catch (err) {
      setError(err.message || 'Ошибка сохранения');
    }
  }

  function startEdit(op) {
    setEditId(op.id);
    setForm({
      type: op.type,
      amount: op.amount,
      category_id: op.category_id || '',
      project_id: op.project_id || '',
      counterparty_id: op.counterparty_id || '',
      operation_date: op.operation_date,
      status: op.status,
      comment: op.comment || '',
    });
  }

  function toggleSelect(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function confirmOne(id) {
    await api.confirmOperation(id);
    await load();
  }

  async function remove(id) {
    if (!confirm('Удалить операцию?')) return;
    await api.deleteOperation(id);
    await load();
  }

  async function bulkConfirm() {
    for (const id of selected) {
      await api.confirmOperation(id);
    }
    await load();
  }

  async function bulkDelete() {
    if (!confirm('Удалить выбранные операции?')) return;
    for (const id of selected) {
      await api.deleteOperation(id);
    }
    await load();
  }

  async function bulkShift() {
    const shift = Number(dateShift);
    if (!selected.size || Number.isNaN(shift)) return;
    const selectedItems = items.filter(i => selected.has(i.id));
    for (const op of selectedItems) {
      const d = new Date(op.operation_date);
      d.setDate(d.getDate() + shift);
      await api.updateOperation(op.id, { operation_date: d.toISOString().slice(0, 10) });
    }
    await load();
  }

  async function bulkSetDate() {
    if (!selected.size || !setDate) return;
    for (const id of selected) {
      await api.updateOperation(id, { operation_date: setDate });
    }
    await load();
  }

  async function applySeries() {
    if (!selected.size || !seriesStart) return;
    const sorted = items.filter(i => selected.has(i.id)).sort((a, b) => a.id - b.id);
    let d = new Date(seriesStart);
    for (const op of sorted) {
      await api.updateOperation(op.id, { operation_date: d.toISOString().slice(0, 10) });
      d.setDate(d.getDate() + 1);
    }
    await load();
  }

  function applyTemplate(type) {
    setForm({
      ...form,
      type,
      comment: type === 'expense' ? 'Операционные расходы' : 'Доход по реализации',
    });
  }

  function exportCsv() {
    const rows = filteredItems.map(op => ({
      id: op.id,
      date: op.operation_date,
      type: op.type,
      amount: op.amount,
      category: op.category_name,
      project: op.project_name,
      counterparty: op.counterparty_name,
      status: op.status,
      comment: op.comment,
    }));
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'operations.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter(op =>
      [op.comment, op.category_name, op.project_name, op.counterparty_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [items, search]);

  const total = filteredItems.length;
  const confirmed = filteredItems.filter(o => o.status === 'confirmed').length;
  const draft = filteredItems.filter(o => o.status === 'draft').length;
  const income = filteredItems.filter(o => o.type === 'income').reduce((s, o) => s + Number(o.amount), 0);
  const expense = filteredItems.filter(o => o.type === 'expense').reduce((s, o) => s + Number(o.amount), 0);

  const byMonth = useMemo(() => {
    const map = new Map();
    for (const op of filteredItems) {
      const key = op.operation_date.slice(0, 7);
      const item = map.get(key) || { income: 0, expense: 0 };
      if (op.type === 'income') item.income += Number(op.amount);
      if (op.type === 'expense') item.expense += Number(op.amount);
      map.set(key, item);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredItems]);

  const graphData = useMemo(() => {
    const nodes = [];
    const links = [];
    const opNodes = filteredItems.slice(0, 6);
    opNodes.forEach(op => {
      nodes.push({ id: `o:${op.id}`, label: `#${op.id}` });
      if (op.category_name) {
        nodes.push({ id: `c:${op.category_name}`, label: op.category_name.slice(0, 6) });
        links.push({ source: `o:${op.id}`, target: `c:${op.category_name}` });
      }
      if (op.project_name) {
        nodes.push({ id: `p:${op.project_name}`, label: op.project_name.slice(0, 6) });
        links.push({ source: `o:${op.id}`, target: `p:${op.project_name}` });
      }
    });
    const unique = new Map();
    nodes.forEach(n => { if (!unique.has(n.id)) unique.set(n.id, n); });
    return { nodes: Array.from(unique.values()).slice(0, 10), links: links.slice(0, 12) };
  }, [filteredItems]);

  const calendar = useMemo(() => {
    const [y, m] = calendarMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0);
    const days = [];
    for (let d = 1; d <= last.getDate(); d += 1) {
      const date = new Date(y, m - 1, d).toISOString().slice(0, 10);
      const ops = filteredItems.filter(o => o.operation_date === date);
      const sum = ops.reduce((s, o) => s + Number(o.amount), 0);
      days.push({ date, count: ops.length, sum });
    }
    return days;
  }, [calendarMonth, filteredItems]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Операции</h1>
          <p>Ввод и контроль доходов и расходов</p>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="stats-grid">
        <div className="stat-card"><div className="stat-label">Всего</div><div className="stat-value">{total}</div></div>
        <div className="stat-card"><div className="stat-label">Подтверждено</div><div className="stat-value">{confirmed}</div></div>
        <div className="stat-card"><div className="stat-label">Черновики</div><div className="stat-value">{draft}</div></div>
        <div className="stat-card"><div className="stat-label">Доходы</div><div className="stat-value">{formatMoney(income)}</div></div>
        <div className="stat-card"><div className="stat-label">Расходы</div><div className="stat-value">{formatMoney(expense)}</div></div>
      </section>

      <section className="panel">
        <h2>Фильтры и действия</h2>
        <div className="toolbar">
          <input type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} />
          <input type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} />
          <select value={filters.type} onChange={e => setFilters({ ...filters, type: e.target.value })}>
            <option value="">Все типы</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
            <option value="">Все статусы</option>
            <option value="draft">draft</option>
            <option value="confirmed">confirmed</option>
          </select>
          <input placeholder="Поиск..." value={search} onChange={e => setSearch(e.target.value)} />
          <button onClick={load}>Применить</button>
          <button className="ghost" onClick={exportCsv}>Экспорт CSV</button>
          <label className="chip">
            <input type="checkbox" checked={compact} onChange={e => setCompact(e.target.checked)} /> компактный вид
          </label>
        </div>
        <div className="toolbar" style={{ marginTop: 10 }}>
          <button onClick={() => applyTemplate('income')}>Шаблон дохода</button>
          <button onClick={() => applyTemplate('expense')}>Шаблон расхода</button>
          <button className="ghost" disabled={!selected.size} onClick={bulkConfirm}>Подтвердить выбранные</button>
          <button className="ghost danger" disabled={!selected.size} onClick={bulkDelete}>Удалить выбранные</button>
        </div>
        <div className="toolbar" style={{ marginTop: 10 }}>
          <input type="number" placeholder="Сдвиг дней" value={dateShift} onChange={e => setDateShift(e.target.value)} />
          <button className="ghost" disabled={!selected.size} onClick={bulkShift}>Сдвинуть даты</button>
          <input type="date" value={setDate} onChange={e => setSetDate(e.target.value)} />
          <button className="ghost" disabled={!selected.size} onClick={bulkSetDate}>Задать дату</button>
          <input type="date" value={seriesStart} onChange={e => setSeriesStart(e.target.value)} />
          <button className="ghost" disabled={!selected.size} onClick={applySeries}>Серия по дням</button>
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Доходы vs расходы (Chart.js)</h2>
          <ChartBar labels={byMonth.map(i => i[0])} income={byMonth.map(i => i[1].income)} expense={byMonth.map(i => i[1].expense)} />
        </div>
        <div className="panel">
          <h2>Граф операций</h2>
          <GraphView nodes={graphData.nodes} links={graphData.links} />
        </div>
      </section>

      <section className="panel">
        <h2>Календарь операций</h2>
        <div className="toolbar">
          <input type="month" value={calendarMonth} onChange={e => setCalendarMonth(e.target.value)} />
          <span className="muted">Клики по дню не редактируют операции, только обзор</span>
        </div>
        <div className="calendar-grid">
          {calendar.map(d => (
            <div key={d.date} className="calendar-cell">
              <div className="calendar-date">{d.date.slice(-2)}</div>
              <div className="calendar-count">{d.count} оп.</div>
              <div className="calendar-sum">{formatMoney(d.sum)}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="split">
        <section className="panel">
          <h2>{editId ? `Редактирование #${editId}` : 'Добавить операцию'}</h2>
          <form className="form-grid" onSubmit={handleSubmit}>
            <label>
              Тип
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                {types.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>
              Сумма
              <input value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
            </label>
            <label>
              Категория
              <select value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })}>
                <option value="">—</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>
              Проект
              <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })}>
                <option value="">—</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>
              Контрагент
              <select value={form.counterparty_id} onChange={e => setForm({ ...form, counterparty_id: e.target.value })}>
                <option value="">—</option>
                {counterparties.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>
              Дата
              <input type="date" value={form.operation_date} onChange={e => setForm({ ...form, operation_date: e.target.value })} />
            </label>
            <label>
              Статус
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option value="draft">draft</option>
                <option value="confirmed">confirmed</option>
              </select>
            </label>
            <label className="span-2">
              Комментарий
              <input value={form.comment} onChange={e => setForm({ ...form, comment: e.target.value })} />
            </label>
            <div className="span-2 form-inline">
              <button type="submit">{editId ? 'Сохранить' : 'Создать'}</button>
              {editId ? <button type="button" className="ghost" onClick={() => { setEditId(null); setForm({ ...form, amount: '', comment: '' }); }}>Отмена</button> : null}
            </div>
          </form>
        </section>

        <aside className="side-panel">
          <h2>Детали</h2>
          {active ? (
            <div className="summary">
              <div>ID: {active.id}</div>
              <div>Дата: {active.operation_date}</div>
              <div>Тип: {active.type}</div>
              <div>Сумма: {formatMoney(active.amount)}</div>
              <div>Категория: {active.category_name || '-'}</div>
              <div>Проект: {active.project_name || '-'}</div>
              <div>Контрагент: {active.counterparty_name || '-'}</div>
              <div>Статус: {active.status}</div>
            </div>
          ) : (
            <div className="muted">Выберите операцию в таблице</div>
          )}
        </aside>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Список операций</h2>
          <div className="muted">Выбрано: {selected.size}</div>
        </div>
        {loading ? <div className="empty">Загрузка…</div> : null}
        <table>
          <thead>
            <tr>
              <th></th>
              <th>ID</th>
              <th>Дата</th>
              <th>Тип</th>
              {!compact ? <th>Сумма</th> : null}
              {!compact ? <th>Категория</th> : null}
              {!compact ? <th>Проект</th> : null}
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.length === 0 ? (
              <tr><td colSpan="9">Нет данных</td></tr>
            ) : (
              filteredItems.map(op => (
                <tr key={op.id} onClick={() => setActive(op)}>
                  <td><input type="checkbox" checked={selected.has(op.id)} onChange={() => toggleSelect(op.id)} /></td>
                  <td>{op.id}</td>
                  <td>{op.operation_date}</td>
                  <td><span className="badge">{op.type}</span></td>
                  {!compact ? <td>{formatMoney(op.amount)}</td> : null}
                  {!compact ? <td>{op.category_name || '-'}</td> : null}
                  {!compact ? <td>{op.project_name || '-'}</td> : null}
                  <td>
                    <span className={`badge ${op.status === 'confirmed' ? 'success' : 'warning'}`}>{op.status}</span>
                  </td>
                  <td className="actions">
                    <button className="ghost" onClick={(e) => { e.stopPropagation(); startEdit(op); }}>Изменить</button>
                    {op.status !== 'confirmed' ? (
                      <button className="ghost" onClick={(e) => { e.stopPropagation(); confirmOne(op.id); }}>Подтвердить</button>
                    ) : null}
                    <button className="ghost danger" onClick={(e) => { e.stopPropagation(); remove(op.id); }}>Удалить</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
