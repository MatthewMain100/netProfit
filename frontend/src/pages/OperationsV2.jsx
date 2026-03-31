import { useEffect, useMemo, useState } from 'react';
import { FixedSizeList as List } from 'react-window';
import { api } from '../api';

const ALL_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'operation_date', label: 'Дата' },
  { key: 'type', label: 'Тип' },
  { key: 'amount', label: 'Сумма' },
  { key: 'category_name', label: 'Категория' },
  { key: 'project_name', label: 'Проект' },
  { key: 'counterparty_name', label: 'Контрагент' },
  { key: 'status', label: 'Статус' },
  { key: 'comment', label: 'Комментарий' },
];

function money(value) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function renderCell(row, key) {
  if (key === 'amount') return money(row[key]);
  return row[key] == null ? '-' : String(row[key]);
}

export default function OperationsV2() {
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ search: '', statuses: '', types: '' });
  const [visibleColumns, setVisibleColumns] = useState(ALL_COLUMNS.map(c => c.key));
  const [showColumns, setShowColumns] = useState(false);
  const [groupBy, setGroupBy] = useState('none');
  const [views, setViews] = useState([]);
  const [selectedOp, setSelectedOp] = useState(null);
  const [attachments, setAttachments] = useState([]);

  const activeColumns = ALL_COLUMNS.filter(c => visibleColumns.includes(c.key));

  async function loadViews() {
    const data = await api.operationViews();
    setViews(data || []);
  }

  async function load(reset = false) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('limit', '80');
      if (!reset && nextCursor) params.set('cursor', nextCursor);
      if (filters.search) params.set('search', filters.search);
      if (filters.statuses) params.set('statuses', filters.statuses);
      if (filters.types) params.set('types', filters.types);

      const res = await api.operationsV2(`?${params.toString()}`);
      setItems(prev => (reset ? res.data : [...prev, ...res.data]));
      setNextCursor(res.nextCursor || null);
    } catch (err) {
      setError(err.message || 'Ошибка загрузки Operations V2');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
    loadViews().catch(() => {});
  }, []);

  const rows = useMemo(() => {
    if (groupBy === 'none') return items;

    const grouped = [];
    const map = new Map();
    const keyName = groupBy === 'category' ? 'category_name' : 'project_name';

    for (const item of items) {
      const key = item[keyName] || `Без ${groupBy === 'category' ? 'категории' : 'проекта'}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }

    for (const [group, list] of map.entries()) {
      grouped.push({ isGroup: true, group, count: list.length });
      for (const row of list) grouped.push(row);
    }

    return grouped;
  }, [items, groupBy]);

  const Row = ({ index, style }) => {
    const row = rows[index];
    if (row?.isGroup) {
      return (
        <div style={style} className="table-row group-row">
          <strong>{row.group}</strong> · {row.count} операций
        </div>
      );
    }

    return (
      <div style={style} className="table-row" onClick={() => setSelectedOp(row)}>
        {activeColumns.map(col => (
          <span key={`${row.id}-${col.key}`} className="table-cell">{renderCell(row, col.key)}</span>
        ))}
      </div>
    );
  };

  async function saveCurrentView() {
    const name = prompt('Название пресета');
    if (!name) return;
    const spec = { filters, visibleColumns, groupBy };
    await api.createOperationView({ name, spec, scope: 'private' });
    await loadViews();
  }

  function applyView(view) {
    const spec = view.spec || {};
    if (spec.filters) setFilters(spec.filters);
    if (Array.isArray(spec.visibleColumns)) setVisibleColumns(spec.visibleColumns);
    if (spec.groupBy) setGroupBy(spec.groupBy);
    load(true);
  }

  async function loadAttachments(operationId) {
    const data = await api.operationAttachments(operationId);
    setAttachments(data || []);
  }

  async function uploadAttachment(file) {
    if (!selectedOp || !file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('entity', 'operations');
    form.append('entity_id', String(selectedOp.id));
    await api.uploadAttachment(form);
    await loadAttachments(selectedOp.id);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Operations 2.0</h1>
          <p>BI-реестр с виртуализацией, пресетами и курсорной пагинацией</p>
        </div>
        <div className="panel-actions">
          <button className="ghost" onClick={() => setShowColumns(v => !v)}>Column Manager</button>
          <button className="ghost" onClick={saveCurrentView}>Save View</button>
          <button onClick={() => load(true)}>Обновить</button>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="panel">
        <div className="toolbar">
          <input
            placeholder="Поиск по комментарию"
            value={filters.search}
            onChange={e => setFilters({ ...filters, search: e.target.value })}
          />
          <input
            placeholder="Статусы: draft,confirmed"
            value={filters.statuses}
            onChange={e => setFilters({ ...filters, statuses: e.target.value })}
          />
          <input
            placeholder="Типы: income,expense"
            value={filters.types}
            onChange={e => setFilters({ ...filters, types: e.target.value })}
          />
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)}>
            <option value="none">Без группировки</option>
            <option value="category">Группировка по категории</option>
            <option value="project">Группировка по проекту</option>
          </select>
          <button onClick={() => load(true)}>Применить</button>
        </div>
      </section>

      {showColumns ? (
        <section className="panel">
          <h2>Column Manager</h2>
          <div className="toolbar">
            {ALL_COLUMNS.map(col => (
              <label key={col.key} className="chip">
                <input
                  type="checkbox"
                  checked={visibleColumns.includes(col.key)}
                  onChange={e => {
                    if (e.target.checked) {
                      setVisibleColumns(prev => [...prev, col.key]);
                    } else {
                      setVisibleColumns(prev => prev.filter(v => v !== col.key));
                    }
                  }}
                />
                {col.label}
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>Saved Views</h2>
        <div className="toolbar">
          {views.length === 0 ? <span className="muted">Пресетов нет</span> : views.map(view => (
            <button key={view.id} className="ghost" onClick={() => applyView(view)}>{view.name}</button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="table-header-row">
          {activeColumns.map(col => (
            <strong key={col.key} className="table-cell">{col.label}</strong>
          ))}
        </div>
        <List
          height={520}
          width={'100%'}
          itemCount={rows.length}
          itemSize={40}
        >
          {Row}
        </List>

        <div className="panel-actions" style={{ marginTop: 12 }}>
          {nextCursor ? (
            <button onClick={() => load(false)} disabled={loading}>{loading ? 'Загрузка...' : 'Load more'}</button>
          ) : (
            <span className="muted">Данных больше нет</span>
          )}
        </div>
      </section>

      {selectedOp ? (
        <section className="panel">
          <h2>Документы операции #{selectedOp.id}</h2>
          <div className="toolbar">
            <input type="file" onChange={e => uploadAttachment(e.target.files?.[0])} />
            <button className="ghost" onClick={() => loadAttachments(selectedOp.id)}>Обновить вложения</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Файл</th>
                <th>MIME</th>
                <th>Размер</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {attachments.length === 0 ? (
                <tr><td colSpan="5">Вложений нет</td></tr>
              ) : attachments.map(att => (
                <tr key={att.id}>
                  <td>{att.id}</td>
                  <td>{att.file_name}</td>
                  <td>{att.mime}</td>
                  <td>{att.file_size}</td>
                  <td>
                    <button className="ghost" onClick={async () => {
                      const signed = await api.signAttachment(att.id);
                      const token = localStorage.getItem('token');
                      const url = `${import.meta.env.VITE_API_BASE || 'http://localhost:4000'}${signed.url}`;
                      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
                      const blob = await resp.blob();
                      const href = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = href;
                      a.download = att.file_name;
                      a.click();
                      URL.revokeObjectURL(href);
                    }}>Download</button>
                    <button className="ghost danger" onClick={async () => {
                      await api.deleteAttachment(att.id);
                      await loadAttachments(selectedOp.id);
                    }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
