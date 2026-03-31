import { useEffect, useState } from 'react';
import { api } from '../api';

export default function DataQuality() {
  const [issues, setIssues] = useState([]);
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (severity) params.set('severity', severity);
      const data = await api.qualityIssues(`?${params.toString()}`);
      setIssues(data);
    } catch (err) {
      setError(err.message || 'Ошибка загрузки quality');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [status, severity]);

  async function recalc() {
    await api.recalculateQuality();
    await load();
  }

  async function resolveIssue(id, next) {
    await api.updateQualityIssue(id, { status: next });
    await load();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Data Quality</h1>
          <p>Аномалии данных и контроль качества</p>
        </div>
        <div className="panel-actions">
          <button className="ghost" onClick={recalc}>Пересчитать сейчас</button>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="panel">
        <div className="toolbar">
          <label>
            Status
            <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="open">open</option>
              <option value="resolved">resolved</option>
              <option value="ignored">ignored</option>
              <option value="">all</option>
            </select>
          </label>
          <label>
            Severity
            <select value={severity} onChange={e => setSeverity(e.target.value)}>
              <option value="">all</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="block">block</option>
            </select>
          </label>
          <span className="muted">Найдено: {issues.length}</span>
        </div>
      </section>

      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Issue</th>
              <th>Severity</th>
              <th>Entity</th>
              <th>Status</th>
              <th>Details</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!issues.length ? (
              <tr><td colSpan="7">{loading ? 'Загрузка...' : 'Нет аномалий'}</td></tr>
            ) : issues.map(issue => (
              <tr key={issue.id}>
                <td>{issue.id}</td>
                <td>{issue.issue_key}</td>
                <td><span className={`badge ${issue.severity === 'block' ? 'danger' : issue.severity === 'warn' ? 'warning' : 'success'}`}>{issue.severity}</span></td>
                <td>{issue.entity} #{issue.entity_id}</td>
                <td>{issue.status}</td>
                <td><pre>{JSON.stringify(issue.details, null, 2)}</pre></td>
                <td>
                  {issue.status !== 'resolved' ? <button className="ghost" onClick={() => resolveIssue(issue.id, 'resolved')}>Resolve</button> : null}
                  {issue.status !== 'ignored' ? <button className="ghost" onClick={() => resolveIssue(issue.id, 'ignored')}>Ignore</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
