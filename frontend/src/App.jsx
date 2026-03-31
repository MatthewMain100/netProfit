import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, setToken } from './api';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Operations from './pages/Operations.jsx';
import ImportPage from './pages/Import.jsx';
import Catalogs from './pages/Catalogs.jsx';
import Periods from './pages/Periods.jsx';
import Audit from './pages/Audit.jsx';
import Users from './pages/Users.jsx';
import FinanceCenter from './pages/FinanceCenter.jsx';
import ReportBuilder from './pages/ReportBuilder.jsx';
import OperationsV2 from './pages/OperationsV2.jsx';
import PeriodWizard from './pages/PeriodWizard.jsx';
import Planning from './pages/Planning.jsx';
import DataQuality from './pages/DataQuality.jsx';
import AccessControl from './pages/AccessControl.jsx';

const DEFAULT_FLAGS = {
  finance_center: false,
  report_builder: false,
  ops_v2: false,
  period_wizard: false,
  planning: false,
  quality: false,
  import_v2: false,
  abac_rls: false,
  attachments: false,
  director_mode: false,
};

function navItem(to, label) {
  return { to, label };
}

function Layout({ user, flags, prefs, onLogout, onPrefsChange }) {
  const mode = prefs.mode || (user.role === 'accountant' ? 'accountant' : 'director');
  const nav = useMemo(() => {
    const items = [
      navItem('/', flags.finance_center ? 'Finance Center' : 'Dashboard'),
      navItem(flags.ops_v2 ? '/operations-v2' : '/operations', 'Операции'),
      navItem('/import', 'Импорт'),
      navItem('/catalogs', 'Справочники'),
      navItem(flags.period_wizard ? '/period-wizard' : '/periods', 'Периоды'),
      navItem('/audit', 'Аудит'),
    ];

    if (flags.report_builder) items.push(navItem('/reports/builder', 'Report Builder'));
    if (flags.planning) items.push(navItem('/planning', 'Planning'));
    if (flags.quality) items.push(navItem('/quality', 'Data Quality'));
    if (user.role === 'admin') items.push(navItem('/users', 'Пользователи'));
    if (user.role === 'admin' && flags.abac_rls) items.push(navItem('/access-control', 'Access Control'));

    return items;
  }, [flags, user.role]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">Net Profit 2.0</div>
        <nav>
          {nav.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}>{item.label}</NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user">{user.email} · {user.role}</div>
          <div className="form-inline">
            <select value={prefs.mode || mode} onChange={e => onPrefsChange({ ...prefs, mode: e.target.value })}>
              <option value="director">Director Mode</option>
              <option value="accountant">Accountant Mode</option>
            </select>
            <select value={prefs.theme || 'sand'} onChange={e => onPrefsChange({ ...prefs, theme: e.target.value })}>
              <option value="sand">Sand</option>
              <option value="graphite">Graphite</option>
              <option value="slate">Slate</option>
            </select>
            <select value={prefs.density || 'comfortable'} onChange={e => onPrefsChange({ ...prefs, density: e.target.value })}>
              <option value="comfortable">Comfort</option>
              <option value="compact">Compact</option>
            </select>
            <select value={prefs.accent || 'coal'} onChange={e => onPrefsChange({ ...prefs, accent: e.target.value })}>
              <option value="coal">Coal</option>
              <option value="bronze">Bronze</option>
              <option value="olive">Olive</option>
            </select>
          </div>
          <button className="ghost" onClick={onLogout}>Выйти</button>
        </div>
      </aside>

      <main className="content" data-mode={mode}>
        <Routes>
          <Route path="/" element={flags.finance_center ? <FinanceCenter /> : <Dashboard />} />
          <Route path="/finance-center" element={<FinanceCenter />} />
          <Route path="/dashboard-legacy" element={<Dashboard />} />
          <Route path="/operations" element={<Operations />} />
          <Route path="/operations-v2" element={<OperationsV2 />} />
          <Route path="/reports/builder" element={<ReportBuilder />} />
          <Route path="/period-wizard" element={<PeriodWizard />} />
          <Route path="/planning" element={<Planning />} />
          <Route path="/quality" element={<DataQuality />} />
          <Route path="/access-control" element={user.role === 'admin' ? <AccessControl /> : <Navigate to="/" replace />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/catalogs" element={<Catalogs />} />
          <Route path="/periods" element={<Periods />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/users" element={user.role === 'admin' ? <Users /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [flags, setFlags] = useState(DEFAULT_FLAGS);
  const [prefs, setPrefs] = useState({
    mode: 'director',
    theme: localStorage.getItem('theme') || 'sand',
    density: localStorage.getItem('density') || 'comfortable',
    accent: localStorage.getItem('accent') || 'coal',
  });

  useEffect(() => {
    api.me()
      .then(async res => {
        setUser(res.user);
        try {
          const [prefsData, flagsData] = await Promise.all([
            api.uiPrefs().catch(() => null),
            api.featureFlags().catch(() => []),
          ]);

          if (prefsData?.prefs) {
            setPrefs(prev => ({ ...prev, ...prefsData.prefs }));
          }

          if (Array.isArray(flagsData)) {
            const next = { ...DEFAULT_FLAGS };
            for (const row of flagsData) {
              next[row.key] = Boolean(row.enabled);
            }
            setFlags(next);
          }
        } catch {
          // Keep defaults.
        }
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme || 'sand';
    document.documentElement.dataset.density = prefs.density || 'comfortable';
    document.documentElement.dataset.accent = prefs.accent || 'coal';

    localStorage.setItem('theme', prefs.theme || 'sand');
    localStorage.setItem('density', prefs.density || 'comfortable');
    localStorage.setItem('accent', prefs.accent || 'coal');
  }, [prefs]);

  function handleLogout() {
    setToken(null);
    setUser(null);
  }

  async function handlePrefsChange(nextPrefs) {
    setPrefs(nextPrefs);
    try {
      await api.updateUiPrefs(nextPrefs);
    } catch {
      // Keep local preferences even if backend is unavailable.
    }
  }

  if (loading) {
    return <div className="page"><div className="panel">Загрузка...</div></div>;
  }

  return (
    <BrowserRouter>
      {user ? (
        <Layout
          user={user}
          flags={flags}
          prefs={prefs}
          onLogout={handleLogout}
          onPrefsChange={handlePrefsChange}
        />
      ) : (
        <Login onLogin={setUser} />
      )}
    </BrowserRouter>
  );
}
