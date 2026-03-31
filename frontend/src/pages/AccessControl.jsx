import { useEffect, useState } from 'react';
import { api } from '../api';

const emptyPolicy = {
  name: '',
  subject: 'user',
  action: 'read',
  resource: 'operations',
  effect: 'allow',
  conditions: '{"allowed_project_ids": []}',
};

export default function AccessControl() {
  const [policies, setPolicies] = useState([]);
  const [form, setForm] = useState(emptyPolicy);
  const [testForm, setTestForm] = useState({ as_user_id: '', action: 'read', resource: 'operations', input: '{}' });
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const data = await api.policies();
    setPolicies(data || []);
  }

  useEffect(() => {
    load().catch(err => setError(err.message || 'Ошибка загрузки политик'));
  }, []);

  async function createPolicy() {
    try {
      setError('');
      const payload = {
        name: form.name,
        subject: form.subject,
        action: form.action,
        resource: form.resource,
        effect: form.effect,
        conditions: JSON.parse(form.conditions || '{}'),
        bindings: [],
      };
      await api.createPolicy(payload);
      setForm(emptyPolicy);
      await load();
    } catch (err) {
      setError(err.message || 'Ошибка создания политики');
    }
  }

  async function runTest() {
    try {
      const payload = {
        as_user_id: Number(testForm.as_user_id),
        action: testForm.action,
        resource: testForm.resource,
        input: JSON.parse(testForm.input || '{}'),
      };
      const result = await api.testPolicyUser(payload);
      setTestResult(result);
    } catch (err) {
      setError(err.message || 'Ошибка теста policy');
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Access Control</h1>
          <p>ABAC политики и тестирование доступа "как пользователь"</p>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="grid">
        <section className="panel">
          <h2>Создать policy</h2>
          <div className="form-grid">
            <label>
              Name
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </label>
            <label>
              Subject
              <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} />
            </label>
            <label>
              Action
              <input value={form.action} onChange={e => setForm({ ...form, action: e.target.value })} />
            </label>
            <label>
              Resource
              <input value={form.resource} onChange={e => setForm({ ...form, resource: e.target.value })} />
            </label>
            <label>
              Effect
              <select value={form.effect} onChange={e => setForm({ ...form, effect: e.target.value })}>
                <option value="allow">allow</option>
                <option value="deny">deny</option>
              </select>
            </label>
            <label className="span-2">
              Conditions JSON
              <textarea rows={5} value={form.conditions} onChange={e => setForm({ ...form, conditions: e.target.value })} />
            </label>
            <div className="span-2">
              <button onClick={createPolicy}>Create</button>
            </div>
          </div>
        </section>

        <section className="panel">
          <h2>Тестовый режим</h2>
          <div className="form-grid">
            <label>
              As User ID
              <input value={testForm.as_user_id} onChange={e => setTestForm({ ...testForm, as_user_id: e.target.value })} />
            </label>
            <label>
              Action
              <input value={testForm.action} onChange={e => setTestForm({ ...testForm, action: e.target.value })} />
            </label>
            <label>
              Resource
              <input value={testForm.resource} onChange={e => setTestForm({ ...testForm, resource: e.target.value })} />
            </label>
            <label className="span-2">
              Input JSON
              <textarea rows={5} value={testForm.input} onChange={e => setTestForm({ ...testForm, input: e.target.value })} />
            </label>
            <div className="span-2">
              <button onClick={runTest}>Run Test</button>
            </div>
          </div>

          {testResult ? <pre>{JSON.stringify(testResult, null, 2)}</pre> : null}
        </section>
      </section>

      <section className="panel">
        <h2>Policies</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Action</th>
              <th>Resource</th>
              <th>Effect</th>
              <th>Conditions</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!policies.length ? (
              <tr><td colSpan="7">Политики не созданы</td></tr>
            ) : policies.map(p => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.name}</td>
                <td>{p.action}</td>
                <td>{p.resource}</td>
                <td>{p.effect}</td>
                <td><pre>{JSON.stringify(p.conditions, null, 2)}</pre></td>
                <td>
                  <button className="ghost danger" onClick={async () => {
                    await api.deletePolicy(p.id);
                    await load();
                  }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
