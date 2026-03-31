import { useMemo, useState } from 'react';
import { api } from '../api';

const REQUIRED = ['date', 'type', 'amount', 'category', 'project', 'counterparty', 'vat_included', 'vat_amount', 'status', 'comment'];

function parseCsvHeaders(text) {
  const line = String(text || '').split(/\r?\n/).find(Boolean);
  return line ? line.split(',').map(v => v.trim()) : [];
}

export default function ImportPage() {
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [batch, setBatch] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const localHeaders = useMemo(() => parseCsvHeaders(csvText), [csvText]);
  const activeHeaders = headers.length ? headers : localHeaders;

  async function loadPreview() {
    setLoading(true);
    setError('');
    try {
      const res = await api.importPreview(csvText);
      setHeaders(res.headers || []);
      setPreview(res.preview || []);
    } catch (err) {
      setError(err.message || 'Ошибка preview');
    } finally {
      setLoading(false);
    }
  }

  async function startImport() {
    setLoading(true);
    setError('');
    try {
      const res = await api.importStart({
        csvText,
        fileName: 'manual.csv',
        mapping,
      });
      setBatch(res);
      const poll = setInterval(async () => {
        const status = await api.importStatus(res.batchId);
        setBatch(status);
        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(poll);
          const rep = await api.importReport(res.batchId);
          setReport(rep);
        }
      }, 2000);
    } catch (err) {
      setError(err.message || 'Ошибка запуска импорта');
    } finally {
      setLoading(false);
    }
  }

  async function runLegacyImport() {
    setLoading(true);
    setError('');
    try {
      const res = await api.importCsv(csvText);
      setReport({ legacy: true, result: res });
    } catch (err) {
      setError(err.message || 'Ошибка legacy импорта');
    } finally {
      setLoading(false);
    }
  }

  function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.readAsText(file, 'utf-8');
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Import 2.0</h1>
          <p>Загрузка файла, mapping колонок, preview и отчет импорта</p>
        </div>
        <div className="panel-actions">
          <button className="ghost" onClick={runLegacyImport} disabled={loading}>Legacy import</button>
          <button className="ghost" onClick={loadPreview} disabled={loading}>Preview</button>
          <button onClick={startImport} disabled={loading}>Start Import</button>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="grid">
        <section className="panel">
          <h2>Файл и CSV</h2>
          <input type="file" accept=".csv,text/csv" onChange={onFileChange} />
          <textarea rows={14} value={csvText} onChange={e => setCsvText(e.target.value)} />
          <div className="muted">Строк: {csvText.split(/\r?\n/).filter(Boolean).length}</div>
        </section>

        <section className="panel">
          <h2>Column Mapping</h2>
          <table>
            <thead>
              <tr>
                <th>Системное поле</th>
                <th>Колонка CSV</th>
              </tr>
            </thead>
            <tbody>
              {REQUIRED.map(field => (
                <tr key={field}>
                  <td>{field}</td>
                  <td>
                    <select
                      value={mapping[field] || field}
                      onChange={e => setMapping({ ...mapping, [field]: e.target.value })}
                    >
                      <option value={field}>{field} (default)</option>
                      {activeHeaders.map(h => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </section>

      <section className="panel">
        <h2>Preview (первые 50 строк)</h2>
        <table>
          <thead>
            <tr>
              {activeHeaders.map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {preview.length === 0 ? (
              <tr><td colSpan={Math.max(activeHeaders.length, 1)}>Нет preview</td></tr>
            ) : preview.map((row, idx) => (
              <tr key={idx}>
                {activeHeaders.map(h => <td key={h}>{String(row[h] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Статус импорта</h2>
        {batch ? <pre>{JSON.stringify(batch, null, 2)}</pre> : <div className="empty">Импорт не запущен</div>}
      </section>

      <section className="panel">
        <h2>Import Report</h2>
        {report ? <pre>{JSON.stringify(report, null, 2)}</pre> : <div className="empty">Отчет появится после завершения</div>}
      </section>
    </div>
  );
}
