import { useEffect, useState } from 'react';
import { api } from '../api';
import FieldPalette from '../components/FieldPalette.jsx';
import DropZone from '../components/DropZone.jsx';
import FilterPanel from '../components/FilterPanel.jsx';
import PreviewTable from '../components/PreviewTable.jsx';
import ChartPreview from '../components/ChartPreview.jsx';

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 6);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default function ReportBuilder() {
  const range = defaultRange();
  const [dimensions, setDimensions] = useState([]);
  const [metric, setMetric] = useState('sum_amount');
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [limit, setLimit] = useState(200);
  const [templateName, setTemplateName] = useState('');
  const [templates, setTemplates] = useState([]);
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [error, setError] = useState('');

  async function loadTemplates() {
    const data = await api.reportTemplates();
    setTemplates(data);
  }

  useEffect(() => {
    loadTemplates().catch(() => {});
  }, []);

  function addDimension(field) {
    setDimensions(prev => (prev.includes(field) ? prev : [...prev, field]));
  }

  function removeDimension(field) {
    setDimensions(prev => prev.filter(v => v !== field));
  }

  function buildSpec() {
    return {
      dimensions,
      metrics: [metric],
      from,
      to,
      limit: Number(limit),
      sort: dimensions.length ? [{ field: dimensions[0], dir: 'asc' }] : [{ field: metric, dir: 'desc' }],
    };
  }

  async function run() {
    setError('');
    try {
      const res = await api.runReport(buildSpec());
      setRows(res.rows || []);
      setColumns(res.columns || []);
    } catch (err) {
      setError(err.message || 'Ошибка выполнения отчета');
    }
  }

  async function saveTemplate() {
    setError('');
    try {
      if (!templateName.trim()) {
        setError('Укажите название шаблона');
        return;
      }
      await api.createReportTemplate({ name: templateName.trim(), spec: buildSpec() });
      setTemplateName('');
      await loadTemplates();
    } catch (err) {
      setError(err.message || 'Ошибка сохранения');
    }
  }

  async function runTemplate(template) {
    const res = await api.runReportTemplate(template.id);
    setRows(res.rows || []);
    setColumns(res.columns || []);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Report Builder</h1>
          <p>Drag & drop конструктор отчетов с сохранением шаблонов</p>
        </div>
        <div className="panel-actions">
          <button onClick={run}>Run</button>
          <input placeholder="Template name" value={templateName} onChange={e => setTemplateName(e.target.value)} />
          <button className="ghost" onClick={saveTemplate}>Save as Template</button>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="grid">
        <FieldPalette onDragStart={(e, field) => e.dataTransfer.setData('text/plain', field)} />
        <DropZone title="Group By" items={dimensions} onDrop={addDimension} onRemove={removeDimension} />
      </section>

      <FilterPanel
        from={from}
        to={to}
        setFrom={setFrom}
        setTo={setTo}
        limit={limit}
        setLimit={setLimit}
        metric={metric}
        setMetric={setMetric}
      />

      <section className="grid">
        <PreviewTable columns={columns} rows={rows} />
        <ChartPreview rows={rows} metric={metric} />
      </section>

      <section className="panel">
        <h2>Saved Templates</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Название</th>
              <th>Создан</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 ? (
              <tr><td colSpan="4">Шаблонов пока нет</td></tr>
            ) : templates.map(t => (
              <tr key={t.id}>
                <td>{t.id}</td>
                <td>{t.name}</td>
                <td>{new Date(t.created_at).toLocaleString('ru-RU')}</td>
                <td>
                  <button className="ghost" onClick={() => runTemplate(t)}>Run</button>
                  <button className="ghost danger" onClick={async () => {
                    await api.deleteReportTemplate(t.id);
                    await loadTemplates();
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
