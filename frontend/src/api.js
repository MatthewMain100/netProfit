const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

function getToken() {
  return localStorage.getItem('token');
}

export function setToken(token) {
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!(options.body instanceof FormData) && options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const json = JSON.parse(text);
      message = json.error || text;
    } catch {
      // ignore
    }
    throw new Error(message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request('/auth/me'),
  health: () => request('/health'),
  integrations: () => request('/integrations/status'),
  operations: (params = '') => request(`/operations${params}`),
  createOperation: (data) => request('/operations', { method: 'POST', body: JSON.stringify(data) }),
  updateOperation: (id, data) => request(`/operations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteOperation: (id) => request(`/operations/${id}`, { method: 'DELETE' }),
  confirmOperation: (id) => request(`/operations/${id}/confirm`, { method: 'POST' }),
  profit: (from, to) => request(`/profit?from=${from}&to=${to}`),
  dynamics: (from, to) => request(`/reports/dynamics?from=${from}&to=${to}`),
  structure: (from, to) => request(`/reports/structure?from=${from}&to=${to}`),
  projectsReport: (from, to) => request(`/reports/projects?from=${from}&to=${to}`),
  categories: () => request('/categories'),
  createCategory: (data) => request('/categories', { method: 'POST', body: JSON.stringify(data) }),
  updateCategory: (id, data) => request(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCategory: (id) => request(`/categories/${id}`, { method: 'DELETE' }),
  projects: () => request('/projects'),
  createProject: (data) => request('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id, data) => request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
  counterparties: () => request('/counterparties'),
  createCounterparty: (data) => request('/counterparties', { method: 'POST', body: JSON.stringify(data) }),
  updateCounterparty: (id, data) => request(`/counterparties/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCounterparty: (id) => request(`/counterparties/${id}`, { method: 'DELETE' }),
  periods: () => request('/periods'),
  createPeriod: (data) => request('/periods', { method: 'POST', body: JSON.stringify(data) }),
  updatePeriod: (id, data) => request(`/periods/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  closePeriod: (id) => request(`/periods/${id}/close`, { method: 'POST' }),
  snapshots: () => request('/snapshots'),
  audit: () => request('/audit?limit=200'),
  users: () => request('/users'),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  importCsv: (csvText) => request('/imports/csv', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: csvText }),
  featureFlags: () => request('/feature-flags'),
  setFeatureFlag: (key, data) => request(`/feature-flags/${key}`, { method: 'PATCH', body: JSON.stringify(data) }),
  financeCenter: (months = 24) => request(`/dashboard/finance-center?months=${months}`),
  runReport: (spec) => request('/reports/run', { method: 'POST', body: JSON.stringify(spec) }),
  reportTemplates: () => request('/reports/templates'),
  createReportTemplate: (payload) => request('/reports/templates', { method: 'POST', body: JSON.stringify(payload) }),
  updateReportTemplate: (id, payload) => request(`/reports/templates/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteReportTemplate: (id) => request(`/reports/templates/${id}`, { method: 'DELETE' }),
  runReportTemplate: (id) => request(`/reports/templates/${id}/run`, { method: 'POST' }),
  operationsV2: (params = '') => request(`/operations/v2${params}`),
  operationViews: () => request('/operations/views'),
  createOperationView: (payload) => request('/operations/views', { method: 'POST', body: JSON.stringify(payload) }),
  updateOperationView: (id, payload) => request(`/operations/views/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteOperationView: (id) => request(`/operations/views/${id}`, { method: 'DELETE' }),
  periodPrecheck: (id) => request(`/periods/${id}/precheck`, { method: 'POST' }),
  periodChecks: (id) => request(`/periods/${id}/precheck`),
  periodProtocol: (id, format = 'html') => request(`/periods/${id}/protocol?format=${format}`),
  scenarios: () => request('/scenarios'),
  createScenario: (payload) => request('/scenarios', { method: 'POST', body: JSON.stringify(payload) }),
  updateScenario: (id, payload) => request(`/scenarios/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteScenario: (id) => request(`/scenarios/${id}`, { method: 'DELETE' }),
  runScenario: (spec) => request('/scenarios/run', { method: 'POST', body: JSON.stringify(spec) }),
  applyScenario: (id, payload) => request(`/scenarios/${id}/apply`, { method: 'POST', body: JSON.stringify(payload) }),
  qualityIssues: (params = '') => request(`/quality/issues${params}`),
  recalculateQuality: () => request('/quality/recalculate', { method: 'POST' }),
  updateQualityIssue: (id, payload) => request(`/quality/issues/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  importPreview: (csvText) => request('/imports/preview', { method: 'POST', body: JSON.stringify({ csvText }) }),
  importStart: (payload) => request('/imports/start', { method: 'POST', body: JSON.stringify(payload) }),
  importStatus: (id) => request(`/imports/${id}/status`),
  importReport: (id) => request(`/imports/${id}/report`),
  policies: () => request('/access/policies'),
  createPolicy: (payload) => request('/access/policies', { method: 'POST', body: JSON.stringify(payload) }),
  updatePolicy: (id, payload) => request(`/access/policies/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deletePolicy: (id) => request(`/access/policies/${id}`, { method: 'DELETE' }),
  testPolicyUser: (payload) => request('/access/test-user', { method: 'POST', body: JSON.stringify(payload) }),
  uploadAttachment: async (formData) => request('/attachments/upload', { method: 'POST', body: formData }),
  operationAttachments: (operationId) => request(`/operations/${operationId}/attachments`),
  signAttachment: (id) => request(`/attachments/${id}/sign`),
  deleteAttachment: (id) => request(`/attachments/${id}`, { method: 'DELETE' }),
  uiPrefs: () => request('/ui/prefs'),
  updateUiPrefs: (prefs) => request('/ui/prefs', { method: 'PATCH', body: JSON.stringify({ prefs }) }),
};
