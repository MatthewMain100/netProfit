import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

function severityClass(value) {
  if (value === 'block') return 'danger';
  if (value === 'warn') return 'warning';
  return 'success';
}

export default function PeriodWizard() {
  const [periods, setPeriods] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [checks, setChecks] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const selected = useMemo(() => periods.find(p => p.id === selectedId) || null, [periods, selectedId]);

  async function load() {
    const data = await api.periods();
    setPeriods(data);
    if (!selectedId && data[0]) setSelectedId(data[0].id);
  }

  useEffect(() => {
    load().catch(err => setError(err.message || 'Ошибка загрузки периодов'));
  }, []);

  async function runPrecheck() {
    if (!selectedId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.periodPrecheck(selectedId);
      setChecks(res.checks || []);
    } catch (err) {
      setError(err.message || 'Ошибка precheck');
    } finally {
      setLoading(false);
    }
  }

  async function closePeriod() {
    if (!selectedId) return;
    try {
      await api.closePeriod(selectedId);
      await load();
      await runPrecheck();
    } catch (err) {
      setError(err.message || 'Ошибка закрытия периода');
    }
  }

  function openProtocol(format) {
    if (!selectedId) return;
    const token = localStorage.getItem('token');
    const url = `${import.meta.env.VITE_API_BASE || 'http://localhost:4000'}/periods/${selectedId}/protocol?format=${format}`;

    if (format === 'html') {
      fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.text())
        .then(html => {
          const win = window.open('', '_blank');
          win.document.write(html);
          win.document.close();
        });
    } else {
      fetch(url, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.blob())
        .then(blob => {
          const download = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = download;
          a.download = `period-${selectedId}-protocol.pdf`;
          a.click();
          window.URL.revokeObjectURL(download);
        });
    }
  }

  const blockers = checks.filter(c => c.severity === 'block').length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Period Close Wizard</h1>
          <p>Пошаговое закрытие периода с проверками и протоколом</p>
        </div>
        <div className="panel-actions">
          <button className="ghost" onClick={() => openProtocol('html')} disabled={!selectedId}>HTML протокол</button>
          <button className="ghost" onClick={() => openProtocol('pdf')} disabled={!selectedId}>PDF протокол</button>
          <button onClick={runPrecheck} disabled={!selectedId || loading}>{loading ? 'Проверка...' : 'Run Precheck'}</button>
          <button onClick={closePeriod} disabled={!selectedId || blockers > 0}>Закрыть период</button>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="grid">
        <section className="panel">
          <h2>Периоды</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Начало</th>
                <th>Конец</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {periods.map(p => (
                <tr key={p.id} onClick={() => setSelectedId(p.id)} style={{ cursor: 'pointer', background: p.id === selectedId ? '#f2ede1' : 'transparent' }}>
                  <td>{p.id}</td>
                  <td>{p.start_date}</td>
                  <td>{p.end_date}</td>
                  <td>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Результаты проверок</h2>
          <div className="toolbar">
            <span className="chip">BLOCK: {checks.filter(c => c.severity === 'block').length}</span>
            <span className="chip">WARN: {checks.filter(c => c.severity === 'warn').length}</span>
            <span className="chip">INFO: {checks.filter(c => c.severity === 'info').length}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Check</th>
                <th>Severity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {checks.length === 0 ? (
                <tr><td colSpan="3">Сначала выполните precheck</td></tr>
              ) : checks.map((c, idx) => (
                <tr key={idx}>
                  <td>{c.check_key}</td>
                  <td><span className={`badge ${severityClass(c.severity)}`}>{String(c.severity).toUpperCase()}</span></td>
                  <td><pre>{JSON.stringify(c.details, null, 2)}</pre></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </section>

      {selected ? (
        <section className="panel">
          <h2>Preview периода #{selected.id}</h2>
          <div className="summary">
            <div>Период: {selected.start_date} - {selected.end_date}</div>
            <div>Статус: {selected.status}</div>
            <div>Закрытие доступно: {blockers > 0 ? 'нет (есть BLOCK)' : 'да'}</div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
