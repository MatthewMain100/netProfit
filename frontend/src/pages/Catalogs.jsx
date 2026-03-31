import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => JSON.stringify(row[h] ?? '')).join(','));
  }
  return lines.join('\n');
}

export default function Catalogs() {
  const [categories, setCategories] = useState([]);
  const [projects, setProjects] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [ops, setOps] = useState([]);
  const [error, setError] = useState('');

  const [catForm, setCatForm] = useState({ name: '', type: 'expense' });
  const [projForm, setProjForm] = useState({ name: '' });
  const [cpForm, setCpForm] = useState({ name: '', inn: '' });
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [bulkCats, setBulkCats] = useState('');
  const [bulkProjects, setBulkProjects] = useState('');
  const [editingCat, setEditingCat] = useState(null);
  const [editingProject, setEditingProject] = useState(null);
  const [editingCp, setEditingCp] = useState(null);

  async function load() {
    setError('');
    try {
      const [cats, projs, cps, opsData] = await Promise.all([
        api.categories(),
        api.projects(),
        api.counterparties(),
        api.operations('?from=1900-01-01&to=2999-12-31'),
      ]);
      setCategories(cats);
      setProjects(projs);
      setCounterparties(cps);
      setOps(opsData);
    } catch (err) {
      setError(err.message || 'Ошибка загрузки');
    }
  }

  useEffect(() => { load(); }, []);

  async function createCategory(e) {
    e.preventDefault();
    await api.createCategory(catForm);
    setCatForm({ name: '', type: 'expense' });
    await load();
  }

  async function createProject(e) {
    e.preventDefault();
    await api.createProject(projForm);
    setProjForm({ name: '' });
    await load();
  }

  async function createCounterparty(e) {
    e.preventDefault();
    await api.createCounterparty(cpForm);
    setCpForm({ name: '', inn: '' });
    await load();
  }

  async function removeCategory(id) {
    if (!confirm('Удалить категорию?')) return;
    await api.deleteCategory(id);
    await load();
  }

  async function removeProject(id) {
    if (!confirm('Удалить проект?')) return;
    await api.deleteProject(id);
    await load();
  }

  async function removeCounterparty(id) {
    if (!confirm('Удалить контрагента?')) return;
    await api.deleteCounterparty(id);
    await load();
  }

  async function saveCategoryEdit(id, name, type) {
    await api.updateCategory(id, { name, type });
    setEditingCat(null);
    await load();
  }

  async function saveProjectEdit(id, name, status) {
    await api.updateProject(id, { name, status });
    setEditingProject(null);
    await load();
  }

  async function saveCpEdit(id, name, inn) {
    await api.updateCounterparty(id, { name, inn });
    setEditingCp(null);
    await load();
  }

  async function bulkCreateCats() {
    const lines = bulkCats.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      await api.createCategory({ name: line, type: catFilter || 'expense' });
    }
    setBulkCats('');
    await load();
  }

  async function bulkCreateProjects() {
    const lines = bulkProjects.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      await api.createProject({ name: line });
    }
    setBulkProjects('');
    await load();
  }

  function exportList(list, name) {
    const csv = toCsv(list);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filteredCats = useMemo(() => {
    const term = search.toLowerCase();
    return categories.filter(c =>
      (!catFilter || c.type === catFilter) && (!term || c.name.toLowerCase().includes(term))
    );
  }, [categories, search, catFilter]);

  const catUsage = useMemo(() => {
    const map = new Map();
    for (const op of ops) {
      if (!op.category_id) continue;
      map.set(op.category_id, (map.get(op.category_id) || 0) + 1);
    }
    return map;
  }, [ops]);

  const projectUsage = useMemo(() => {
    const map = new Map();
    for (const op of ops) {
      if (!op.project_id) continue;
      map.set(op.project_id, (map.get(op.project_id) || 0) + 1);
    }
    return map;
  }, [ops]);

  const cpUsage = useMemo(() => {
    const map = new Map();
    for (const op of ops) {
      if (!op.counterparty_id) continue;
      map.set(op.counterparty_id, (map.get(op.counterparty_id) || 0) + 1);
    }
    return map;
  }, [ops]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Справочники</h1>
          <p>Категории, проекты, контрагенты</p>
        </div>
        <div className="panel-actions">
          <input placeholder="Поиск" value={search} onChange={e => setSearch(e.target.value)} />
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option value="">Все типы</option>
            <option value="income">income</option>
            <option value="expense">expense</option>
            <option value="tax">tax</option>
          </select>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="stats-grid">
        <div className="stat-card"><div className="stat-label">Категорий</div><div className="stat-value">{categories.length}</div></div>
        <div className="stat-card"><div className="stat-label">Проектов</div><div className="stat-value">{projects.length}</div></div>
        <div className="stat-card"><div className="stat-label">Контрагентов</div><div className="stat-value">{counterparties.length}</div></div>
        <div className="stat-card"><div className="stat-label">Операций</div><div className="stat-value">{ops.length}</div></div>
      </section>

      <section className="grid">
        <div className="panel">
          <div className="panel-header">
            <h2>Категории</h2>
            <div className="panel-actions">
              <button className="ghost" onClick={() => exportList(categories, 'categories')}>Экспорт CSV</button>
            </div>
          </div>
          <form className="form-inline" onSubmit={createCategory}>
            <input placeholder="Название" value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} />
            <select value={catForm.type} onChange={e => setCatForm({ ...catForm, type: e.target.value })}>
              <option value="income">income</option>
              <option value="expense">expense</option>
              <option value="tax">tax</option>
            </select>
            <button>Добавить</button>
          </form>
          <div className="callout">
            Массовое добавление (по строкам):
            <textarea rows={4} value={bulkCats} onChange={e => setBulkCats(e.target.value)} />
            <button onClick={bulkCreateCats}>Загрузить</button>
          </div>
          <ul className="list">
            {filteredCats.map(c => (
              <li key={c.id} className="row">
                {editingCat?.id === c.id ? (
                  <>
                    <input value={editingCat.name} onChange={e => setEditingCat({ ...editingCat, name: e.target.value })} />
                    <select value={editingCat.type} onChange={e => setEditingCat({ ...editingCat, type: e.target.value })}>
                      <option value="income">income</option>
                      <option value="expense">expense</option>
                      <option value="tax">tax</option>
                    </select>
                    <button className="ghost" onClick={() => saveCategoryEdit(c.id, editingCat.name, editingCat.type)}>Сохранить</button>
                  </>
                ) : (
                  <>
                    <span>{c.name} · {c.type} · <span className="badge">исп. {catUsage.get(c.id) || 0}</span></span>
                    <div className="panel-actions">
                      <button className="ghost" onClick={() => setEditingCat({ id: c.id, name: c.name, type: c.type })}>Редактировать</button>
                      <button className="ghost danger" onClick={() => removeCategory(c.id)}>Удалить</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Проекты</h2>
            <div className="panel-actions">
              <button className="ghost" onClick={() => exportList(projects, 'projects')}>Экспорт CSV</button>
            </div>
          </div>
          <form className="form-inline" onSubmit={createProject}>
            <input placeholder="Название" value={projForm.name} onChange={e => setProjForm({ ...projForm, name: e.target.value })} />
            <button>Добавить</button>
          </form>
          <div className="callout">
            Массовое добавление проектов:
            <textarea rows={4} value={bulkProjects} onChange={e => setBulkProjects(e.target.value)} />
            <button onClick={bulkCreateProjects}>Загрузить</button>
          </div>
          <ul className="list">
            {projects.map(p => (
              <li key={p.id} className="row">
                {editingProject?.id === p.id ? (
                  <>
                    <input value={editingProject.name} onChange={e => setEditingProject({ ...editingProject, name: e.target.value })} />
                    <select value={editingProject.status} onChange={e => setEditingProject({ ...editingProject, status: e.target.value })}>
                      <option value="active">active</option>
                      <option value="archived">archived</option>
                    </select>
                    <button className="ghost" onClick={() => saveProjectEdit(p.id, editingProject.name, editingProject.status)}>Сохранить</button>
                  </>
                ) : (
                  <>
                    <span>{p.name} · {p.status} · <span className="badge">исп. {projectUsage.get(p.id) || 0}</span></span>
                    <div className="panel-actions">
                      <button className="ghost" onClick={() => setEditingProject({ id: p.id, name: p.name, status: p.status })}>Редактировать</button>
                      <button className="ghost danger" onClick={() => removeProject(p.id)}>Удалить</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Контрагенты</h2>
          <button className="ghost" onClick={() => exportList(counterparties, 'counterparties')}>Экспорт CSV</button>
        </div>
        <form className="form-inline" onSubmit={createCounterparty}>
          <input placeholder="Название" value={cpForm.name} onChange={e => setCpForm({ ...cpForm, name: e.target.value })} />
          <input placeholder="ИНН" value={cpForm.inn} onChange={e => setCpForm({ ...cpForm, inn: e.target.value })} />
          <button>Добавить</button>
        </form>
        <ul className="list">
          {counterparties.map(c => (
            <li key={c.id} className="row">
              {editingCp?.id === c.id ? (
                <>
                  <input value={editingCp.name} onChange={e => setEditingCp({ ...editingCp, name: e.target.value })} />
                  <input value={editingCp.inn} onChange={e => setEditingCp({ ...editingCp, inn: e.target.value })} />
                  <button className="ghost" onClick={() => saveCpEdit(c.id, editingCp.name, editingCp.inn)}>Сохранить</button>
                </>
              ) : (
                <>
                  <span>{c.name} {c.inn ? `· ${c.inn}` : ''} · <span className="badge">исп. {cpUsage.get(c.id) || 0}</span></span>
                  <div className="panel-actions">
                    <button className="ghost" onClick={() => setEditingCp({ id: c.id, name: c.name, inn: c.inn || '' })}>Редактировать</button>
                    <button className="ghost danger" onClick={() => removeCounterparty(c.id)}>Удалить</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}