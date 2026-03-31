import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import Chart from 'chart.js/auto';

function formatMoney(value) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatMonth(month) {
  const [y, m] = month.split('-');
  return `${m}.${y}`;
}

function getDefaultRange() {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 6);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function sumBy(list, predicate) {
  return list.reduce((acc, item) => acc + (predicate(item) ? Number(item.amount) : 0), 0);
}

function groupSum(list, keyFn, valueFn) {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!key) continue;
    const value = valueFn(item);
    map.set(key, (map.get(key) || 0) + value);
  }
  return Array.from(map.entries()).map(([key, value]) => ({ key, value }));
}

function shiftRange(from, to) {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const diff = toDate.getTime() - fromDate.getTime();
  const prevTo = new Date(fromDate.getTime() - 24 * 60 * 60 * 1000);
  const prevFrom = new Date(prevTo.getTime() - diff);
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  };
}

function downloadCanvas(canvas, name) {
  if (!canvas) return;
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

function GraphView({ nodes, links }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [start, setStart] = useState({ x: 0, y: 0 });
  if (!nodes.length) return <div className="empty">Нет данных</div>;
  const w = 420;
  const h = 220;
  const centerX = w / 2;
  const centerY = h / 2;
  const r = 70;

  function onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => Math.min(2, Math.max(0.6, z + delta)));
  }

  function onDown(e) {
    setDragging(true);
    setStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  }

  function onMove(e) {
    if (!dragging) return;
    setOffset({ x: e.clientX - start.x, y: e.clientY - start.y });
  }

  function onUp() {
    setDragging(false);
  }

  const positions = nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    return {
      ...n,
      x: centerX + r * Math.cos(angle),
      y: centerY + r * Math.sin(angle),
      delay: `${i * 0.15}s`,
    };
  });

  const nodeMap = new Map(positions.map(p => [p.id, p]));

  return (
    <div
      className={`graph-wrap ${dragging ? 'dragging' : ''}`}
      onWheel={onWheel}
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      onMouseLeave={onUp}
    >
      <svg
        width={w}
        height={h}
        className="graph"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
      >
        {links.map((l, idx) => {
          const a = nodeMap.get(l.source);
          const b = nodeMap.get(l.target);
          if (!a || !b) return null;
          return (
            <line key={idx} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          );
        })}
        {positions.map(p => (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={14} style={{ animationDelay: p.delay }} />
            <text x={p.x} y={p.y + 4}>{p.label}</text>
          </g>
        ))}
      </svg>
      <div className="muted">Масштаб: {Math.round(zoom * 100)}%</div>
    </div>
  );
}

function ChartLine({ labels, values, canvasRef }) {
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Чистая прибыль',
            data: values,
            borderColor: '#1f1f1f',
            backgroundColor: 'rgba(31,31,31,0.15)',
            fill: true,
            tension: 0.35,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: 'rgba(0,0,0,0.06)' } },
        },
      },
    });

    return () => chartRef.current?.destroy();
  }, [labels, values, canvasRef]);

  return <canvas ref={canvasRef} height="160" />;
}

function ChartDonut({ labels, values, canvasRef }) {
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: ['#1f1f1f', '#6c5b3b', '#9c7d4e', '#c2a66f', '#e2d1b3'],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        cutout: '60%',
        plugins: { legend: { position: 'bottom' } },
      },
    });

    return () => chartRef.current?.destroy();
  }, [labels, values, canvasRef]);

  return <canvas ref={canvasRef} height="160" />;
}

export default function Dashboard() {
  const defaults = useMemo(getDefaultRange, []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [netProfit, setNetProfit] = useState(0);
  const [prevNetProfit, setPrevNetProfit] = useState(0);
  const [dynamics, setDynamics] = useState([]);
  const [structure, setStructure] = useState([]);
  const [projects, setProjects] = useState([]);
  const [kpis, setKpis] = useState({ revenue: 0, expenses: 0, taxes: 0, gross: 0, net: 0, margin: 0 });
  const [alerts, setAlerts] = useState([]);
  const [activity, setActivity] = useState([]);
  const [topCounterparties, setTopCounterparties] = useState([]);
  const [periodInfo, setPeriodInfo] = useState(null);
  const [integrations, setIntegrations] = useState([]);
  const [opsSummary, setOpsSummary] = useState({ total: 0, confirmed: 0, draft: 0 });
  const [latestOps, setLatestOps] = useState([]);
  const [notes, setNotes] = useState(localStorage.getItem('dashboard_notes') || '');
  const [graph, setGraph] = useState({ nodes: [], links: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const lineRef = useRef(null);
  const donutRef = useRef(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const prevRange = shiftRange(from, to);
      const [profit, prevProfit, dyn, struct, proj, ops, periods, snapshots, integ] = await Promise.all([
        api.profit(from, to),
        api.profit(prevRange.from, prevRange.to),
        api.dynamics(from, to),
        api.structure(from, to),
        api.projectsReport(from, to),
        api.operations(`?from=${from}&to=${to}`),
        api.periods().catch(() => []),
        api.snapshots().catch(() => []),
        api.integrations().catch(() => ({ sources: [] })),
      ]);

      setNetProfit(profit.net_profit || 0);
      setPrevNetProfit(prevProfit.net_profit || 0);
      setDynamics(dyn.rows || []);
      setStructure(struct.rows || []);
      setProjects(proj.rows || []);
      setIntegrations(integ.sources || []);

      const revenue = sumBy(ops, o => o.type === 'income' && o.status === 'confirmed');
      const expenses = sumBy(ops, o => o.type === 'expense' && o.status === 'confirmed');
      const taxes = sumBy(ops, o => o.type === 'tax' && o.status === 'confirmed');
      const gross = revenue - expenses;
      const net = gross - taxes;
      const margin = revenue > 0 ? (net / revenue) * 100 : 0;
      setKpis({ revenue, expenses, taxes, gross, net, margin });

      const confirmed = ops.filter(o => o.status === 'confirmed').length;
      const draft = ops.filter(o => o.status === 'draft').length;
      setOpsSummary({ total: ops.length, confirmed, draft });
      setLatestOps(ops.slice(0, 5));

      const alertsList = [];
      if (expenses > revenue * 0.7) alertsList.push('Расходы превышают 70% выручки');
      if (net < 0) alertsList.push('Отрицательная чистая прибыль');
      if (taxes > revenue * 0.2) alertsList.push('Высокая налоговая нагрузка');
      if (draft > 10) alertsList.push('Много неподтвержденных операций');
      setAlerts(alertsList);

      const counterpartyTotals = groupSum(
        ops.filter(o => o.status === 'confirmed' && (o.type === 'expense' || o.type === 'tax')),
        o => o.counterparty_name || 'Без контрагента',
        o => Number(o.amount)
      )
        .sort((a, b) => b.value - a.value)
        .slice(0, 5)
        .map(i => ({ name: i.key, total: i.value }));
      setTopCounterparties(counterpartyTotals);

      const lastPeriod = periods[0] || null;
      const lastSnapshot = snapshots[0] || null;
      setPeriodInfo({ lastPeriod, lastSnapshot });

      const recent = await api.audit().catch(() => []);
      setActivity((recent || []).slice(0, 6));

      const nodes = [];
      const links = [];
      const catSet = new Set();
      const projSet = new Set();
      ops.filter(o => o.status === 'confirmed').slice(0, 10).forEach(op => {
        nodes.push({ id: `o:${op.id}`, label: `#${op.id}` });
        if (op.category_name && !catSet.has(op.category_name)) {
          catSet.add(op.category_name);
          nodes.push({ id: `c:${op.category_name}`, label: op.category_name.slice(0, 6) });
        }
        if (op.project_name && !projSet.has(op.project_name)) {
          projSet.add(op.project_name);
          nodes.push({ id: `p:${op.project_name}`, label: op.project_name.slice(0, 6) });
        }
        if (op.category_name) links.push({ source: `o:${op.id}`, target: `c:${op.category_name}` });
        if (op.project_name) links.push({ source: `o:${op.id}`, target: `p:${op.project_name}` });
      });
      setGraph({ nodes: nodes.slice(0, 12), links: links.slice(0, 16) });
    } catch (err) {
      setError(err.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { localStorage.setItem('dashboard_notes', notes); }, [notes]);

  const maxStructure = Math.max(1, ...structure.map(i => i.total));
  const completeness = opsSummary.total > 0 ? Math.round((opsSummary.confirmed / opsSummary.total) * 100) : 0;
  const delta = netProfit - prevNetProfit;
  const deltaSign = delta >= 0 ? '+' : '';

  const lineLabels = dynamics.map(d => formatMonth(d.month));
  const lineValues = dynamics.map(d => d.net_profit);
  const donutLabels = structure.slice(0, 5).map(s => s.category);
  const donutValues = structure.slice(0, 5).map(s => s.total);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Дашборд</h1>
          <p>Ключевая аналитика по чистой прибыли</p>
        </div>
        <div className="filters">
          <label>
            С
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </label>
          <label>
            По
            <input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </label>
          <button onClick={load} disabled={loading}>{loading ? 'Загрузка…' : 'Обновить'}</button>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="cards">
        <div className="card glow">
          <h3>Чистая прибыль</h3>
          <div className="value">{formatMoney(netProfit)}</div>
          <span>за период</span>
        </div>
        <div className="card">
          <h3>Сравнение</h3>
          <div className="value">{deltaSign}{formatMoney(delta)}</div>
          <span>к прошлому периоду</span>
        </div>
        <div className="card">
          <h3>Рентабельность</h3>
          <div className="value">{kpis.margin.toFixed(1)}%</div>
          <span>чистая маржа</span>
        </div>
        <div className="card">
          <h3>Выручка</h3>
          <div className="value">{formatMoney(kpis.revenue)}</div>
          <span>подтвержденные доходы</span>
        </div>
        <div className="card">
          <h3>Расходы</h3>
          <div className="value">{formatMoney(kpis.expenses)}</div>
          <span>подтвержденные расходы</span>
        </div>
        <div className="card">
          <h3>Налоги</h3>
          <div className="value">{formatMoney(kpis.taxes)}</div>
          <span>за период</span>
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <div className="panel-header">
            <h2>Сводка периода</h2>
            <div className="tabs">
              <span className="tab">6м</span>
              <span className="tab">12м</span>
              <span className="tab">24м</span>
            </div>
          </div>
          {periodInfo?.lastPeriod ? (
            <div className="summary">
              <div>Последний период: {periodInfo.lastPeriod.start_date} → {periodInfo.lastPeriod.end_date}</div>
              <div>Статус: {periodInfo.lastPeriod.status}</div>
              {periodInfo.lastSnapshot ? (
                <div>Снимок прибыли: {formatMoney(periodInfo.lastSnapshot.net_profit)}</div>
              ) : (
                <div>Снимок прибыли: нет</div>
              )}
            </div>
          ) : (
            <div className="empty">Периоды еще не созданы</div>
          )}
          <div className="callout" style={{ marginTop: 10 }}>
            Быстрые действия: <a href="/operations">операции</a>, <a href="/periods">периоды</a>, <a href="/import">импорт</a>
          </div>
        </div>
        <div className="panel">
          <h2>Риски и уведомления</h2>
          {alerts.length === 0 ? (
            <div className="empty">Рисков не обнаружено</div>
          ) : (
            <ul className="list">
              {alerts.map((a, idx) => <li key={idx}>{a}</li>)}
            </ul>
          )}
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Полнота данных</h2>
          <div className="summary">
            <div>Всего операций: {opsSummary.total}</div>
            <div>Подтверждено: {opsSummary.confirmed}</div>
            <div>Черновики: {opsSummary.draft}</div>
          </div>
          <div className="progress" style={{ marginTop: 8 }}>
            <div style={{ width: `${completeness}%` }} />
          </div>
          <div className="muted">{completeness}% подтверждено</div>
        </div>
        <div className="panel">
          <h2>Денежный поток</h2>
          <div className="bars">
            <div className="bar">
              <div className="bar-label">Выручка</div>
              <div className="bar-track"><div className="bar-fill" style={{ width: '100%' }} /></div>
              <div className="bar-value">{formatMoney(kpis.revenue)}</div>
            </div>
            <div className="bar">
              <div className="bar-label">Расходы</div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${kpis.revenue ? (kpis.expenses / kpis.revenue) * 100 : 0}%` }} /></div>
              <div className="bar-value">{formatMoney(kpis.expenses)}</div>
            </div>
            <div className="bar">
              <div className="bar-label">Налоги</div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${kpis.revenue ? (kpis.taxes / kpis.revenue) * 100 : 0}%` }} /></div>
              <div className="bar-value">{formatMoney(kpis.taxes)}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <div className="panel-header">
            <h2>Тренд (Chart.js)</h2>
            <button className="ghost" onClick={() => downloadCanvas(lineRef.current, 'trend.png')}>PNG</button>
          </div>
          <ChartLine labels={lineLabels} values={lineValues} canvasRef={lineRef} />
        </div>
        <div className="panel">
          <div className="panel-header">
            <h2>Структура расходов (Chart.js)</h2>
            <button className="ghost" onClick={() => downloadCanvas(donutRef.current, 'structure.png')}>PNG</button>
          </div>
          <ChartDonut labels={donutLabels} values={donutValues} canvasRef={donutRef} />
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Динамика прибыли</h2>
          <table>
            <thead>
              <tr>
                <th>Месяц</th>
                <th>Чистая прибыль</th>
              </tr>
            </thead>
            <tbody>
              {dynamics.length === 0 ? (
                <tr><td colSpan="2">Нет данных</td></tr>
              ) : (
                dynamics.map(row => (
                  <tr key={row.month}>
                    <td>{formatMonth(row.month)}</td>
                    <td>{formatMoney(row.net_profit)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Структура расходов</h2>
          <div className="bars">
            {structure.length === 0 ? (
              <div className="empty">Нет данных</div>
            ) : (
              structure.map(row => (
                <div className="bar" key={row.category}>
                  <div className="bar-label">{row.category}</div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(row.total / maxStructure) * 100}%` }} />
                  </div>
                  <div className="bar-value">{formatMoney(row.total)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Граф связей</h2>
          <GraphView nodes={graph.nodes} links={graph.links} />
          <div className="muted">Операции ↔ категории ↔ проекты</div>
        </div>
        <div className="panel">
          <h2>Топ контрагентов по расходам</h2>
          <div className="bars">
            {topCounterparties.length === 0 ? (
              <div className="empty">Нет данных</div>
            ) : (
              topCounterparties.map(row => (
                <div className="bar" key={row.name}>
                  <div className="bar-label">{row.name}</div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(row.total / Math.max(1, topCounterparties[0]?.total || 1)) * 100}%` }} />
                  </div>
                  <div className="bar-value">{formatMoney(row.total)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Интеграции</h2>
          <ul className="list">
            {integrations.map((i, idx) => (
              <li key={idx}>{i.name} · {i.status}</li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <h2>Последние операции</h2>
          <ul className="list">
            {latestOps.length === 0 ? (
              <li className="muted">Нет данных</li>
            ) : (
              latestOps.map(op => (
                <li key={op.id}>{op.operation_date} · {op.type} · {formatMoney(op.amount)}</li>
              ))
            )}
          </ul>
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Заметки</h2>
          <textarea rows={5} value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="muted">Локально в браузере</div>
        </div>
        <div className="panel">
          <h2>Недавняя активность</h2>
          {activity.length === 0 ? (
            <div className="empty">Нет записей аудита (доступно только админу)</div>
          ) : (
            <ul className="list">
              {activity.map(a => (
                <li key={a.id}>
                  {new Date(a.timestamp).toLocaleString('ru-RU')} · {a.action} · {a.entity} #{a.entity_id} · {a.user_email || '-'}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}