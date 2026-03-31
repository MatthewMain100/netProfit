import { useEffect, useState } from 'react';
import { api } from '../api';

function money(value) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export default function Planning() {
  const [spec, setSpec] = useState({ monthFrom: '2025-01-01', expenseMultiplier: 1.1, incomeDelta: 0, taxMultiplier: 1 });
  const [rows, setRows] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [name, setName] = useState('Новый сценарий');
  const [error, setError] = useState('');

  async function load() {
    const data = await api.scenarios();
    setScenarios(data);
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function run() {
    try {
      const res = await api.runScenario(spec);
      setRows(res.rows || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Ошибка расчета сценария');
    }
  }

  async function save() {
    await api.createScenario({ name, spec });
    await load();
  }

  async function apply(scenarioId) {
    const projectId = prompt('ID проекта для корректировок (опционально)') || '';
    const result = await api.applyScenario(scenarioId, {
      project_id: projectId ? Number(projectId) : null,
      comment: `Scenario apply #${scenarioId}`,
    });
    alert(`Создано корректировок: ${result.inserted}`);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Planning / What-If</h1>
          <p>Сценарный анализ и генерация корректировок</p>
        </div>
        <div className="panel-actions">
          <button className="ghost" onClick={save}>Save Scenario</button>
          <button onClick={run}>Run Scenario</button>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="panel">
        <h2>Параметры сценария</h2>
        <div className="toolbar">
          <label>
            Название
            <input value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label>
            Month From
            <input type="date" value={spec.monthFrom} onChange={e => setSpec({ ...spec, monthFrom: e.target.value })} />
          </label>
          <label>
            Expense Multiplier
            <input type="number" step="0.01" value={spec.expenseMultiplier} onChange={e => setSpec({ ...spec, expenseMultiplier: Number(e.target.value) })} />
          </label>
          <label>
            Income Delta
            <input type="number" step="1000" value={spec.incomeDelta} onChange={e => setSpec({ ...spec, incomeDelta: Number(e.target.value) })} />
          </label>
          <label>
            Tax Multiplier
            <input type="number" step="0.01" value={spec.taxMultiplier} onChange={e => setSpec({ ...spec, taxMultiplier: Number(e.target.value) })} />
          </label>
        </div>
      </section>

      <section className="grid">
        <section className="panel">
          <h2>Факт vs Сценарий</h2>
          <table>
            <thead>
              <tr>
                <th>Месяц</th>
                <th>Факт Net</th>
                <th>Scenario Net</th>
                <th>Delta</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan="4">Нет данных</td></tr>
              ) : rows.map(row => (
                <tr key={row.month}>
                  <td>{row.month}</td>
                  <td>{money(row.net_profit)}</td>
                  <td>{money(row.scenario_net_profit)}</td>
                  <td>{money(Number(row.scenario_net_profit) - Number(row.net_profit))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Сохраненные сценарии</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Создан</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {scenarios.length === 0 ? (
                <tr><td colSpan="4">Сценариев нет</td></tr>
              ) : scenarios.map(s => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>{s.name}</td>
                  <td>{new Date(s.created_at).toLocaleString('ru-RU')}</td>
                  <td>
                    <button className="ghost" onClick={() => setSpec(s.spec || spec)}>Load</button>
                    <button className="ghost" onClick={() => apply(s.id)}>Применить</button>
                    <button className="ghost danger" onClick={async () => {
                      await api.deleteScenario(s.id);
                      await load();
                    }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </section>
    </div>
  );
}
