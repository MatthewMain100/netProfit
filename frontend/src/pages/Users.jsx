import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ email: '', password: '', role: 'manager' });
  const [search, setSearch] = useState('');
  const [bulk, setBulk] = useState('');
  const [selected, setSelected] = useState(null);

  async function load() {
    setError('');
    try {
      const [u, a] = await Promise.all([
        api.users(),
        api.audit().catch(() => []),
      ]);
      setUsers(u);
      setAudit(a);
    } catch (err) {
      setError(err.message || 'Ошибка загрузки');
    }
  }

  useEffect(() => { load(); }, []);

  async function createUser(e) {
    e.preventDefault();
    await api.createUser(form);
    setForm({ email: '', password: '', role: 'manager' });
    await load();
  }

  async function updateRole(id, role) {
    await api.updateUser(id, { role });
    await load();
  }

  async function updateStatus(id, status) {
    await api.updateUser(id, { status });
    await load();
  }

  async function resetPassword(id) {
    const pwd = prompt('Новый пароль');
    if (!pwd) return;
    await api.updateUser(id, { password: pwd });
    await load();
  }

  async function bulkCreate() {
    const lines = bulk.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const email of lines) {
      await api.createUser({ email, password: 'Temp123', role: 'manager' });
    }
    setBulk('');
    await load();
  }

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return users.filter(u => !term || u.email.toLowerCase().includes(term));
  }, [users, search]);

  const lastActivity = useMemo(() => {
    const map = new Map();
    for (const a of audit) {
      if (!a.user_email) continue;
      map.set(a.user_email, new Date(a.timestamp));
    }
    return map;
  }, [audit]);

  const stats = useMemo(() => {
    const total = users.length;
    const admins = users.filter(u => u.role === 'admin').length;
    const active = users.filter(u => u.status === 'active').length;
    return { total, admins, active };
  }, [users]);

  const roleDist = useMemo(() => {
    const map = new Map();
    for (const u of users) map.set(u.role, (map.get(u.role) || 0) + 1);
    return Array.from(map.entries()).map(([role, count]) => ({ role, count }));
  }, [users]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Пользователи</h1>
          <p>Управление доступом</p>
        </div>
        <div className="panel-actions">
          <input placeholder="Поиск" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="stats-grid">
        <div className="stat-card"><div className="stat-label">Всего</div><div className="stat-value">{stats.total}</div></div>
        <div className="stat-card"><div className="stat-label">Админы</div><div className="stat-value">{stats.admins}</div></div>
        <div className="stat-card"><div className="stat-label">Активные</div><div className="stat-value">{stats.active}</div></div>
        <div className="stat-card"><div className="stat-label">Роли</div><div className="stat-sub">{roleDist.map(r => `${r.role}:${r.count}`).join(' · ')}</div></div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Создать пользователя</h2>
          <form className="form-inline" onSubmit={createUser}>
            <input placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            <input placeholder="Пароль" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              <option value="manager">manager</option>
              <option value="accountant">accountant</option>
              <option value="admin">admin</option>
            </select>
            <button>Создать</button>
          </form>
          <div className="callout">
            Массовая регистрация (email по строкам). Пароль по умолчанию: Temp123
            <textarea rows={4} value={bulk} onChange={e => setBulk(e.target.value)} />
            <button onClick={bulkCreate}>Создать пользователей</button>
          </div>
        </div>

        <aside className="side-panel">
          <h2>Детали</h2>
          {selected ? (
            <div className="summary">
              <div>{selected.email}</div>
              <div>Роль: {selected.role}</div>
              <div>Статус: {selected.status}</div>
              <div>Последняя активность: {lastActivity.get(selected.email)?.toLocaleString('ru-RU') || 'нет данных'}</div>
            </div>
          ) : (
            <div className="muted">Выберите пользователя</div>
          )}
        </aside>
      </section>

      <section className="panel">
        <h2>Список пользователей</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Email</th>
              <th>Роль</th>
              <th>Статус</th>
              <th>Создан</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan="6">Нет данных</td></tr>
            ) : (
              filtered.map(u => (
                <tr key={u.id} onClick={() => setSelected(u)}>
                  <td>{u.id}</td>
                  <td>{u.email}</td>
                  <td>
                    <select value={u.role} onChange={e => updateRole(u.id, e.target.value)}>
                      <option value="manager">manager</option>
                      <option value="accountant">accountant</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    <select value={u.status} onChange={e => updateStatus(u.id, e.target.value)}>
                      <option value="active">active</option>
                      <option value="disabled">disabled</option>
                    </select>
                  </td>
                  <td>{new Date(u.created_at).toLocaleDateString('ru-RU')}</td>
                  <td>
                    <button className="ghost" onClick={() => resetPassword(u.id)}>Сброс пароля</button>
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