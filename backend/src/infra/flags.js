import { query } from '../db.js';

const defaults = [
  'finance_center',
  'report_builder',
  'ops_v2',
  'period_wizard',
  'planning',
  'quality',
  'import_v2',
  'abac_rls',
  'attachments',
  'director_mode',
];

export async function ensureFeatureFlags() {
  await query(`
    create table if not exists feature_flags (
      key text primary key,
      enabled boolean not null default false,
      rollout jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    )
  `);

  for (const key of defaults) {
    await query(
      'insert into feature_flags (key, enabled, rollout) values ($1, true, $2::jsonb) on conflict (key) do nothing',
      [key, '{}']
    );
  }
}

export async function isFeatureEnabled(key) {
  const { rows } = await query('select enabled from feature_flags where key = $1', [key]);
  return Boolean(rows[0]?.enabled);
}

export function requireFeature(flagKey) {
  return async (_req, res, next) => {
    try {
      const enabled = await isFeatureEnabled(flagKey);
      if (!enabled) {
        return res.status(404).json({ error: `feature_disabled:${flagKey}` });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

export async function allFeatureFlags() {
  const { rows } = await query('select key, enabled, rollout, updated_at from feature_flags order by key');
  return rows;
}

export async function setFeatureFlag(key, enabled, rollout = {}) {
  const { rows } = await query(
    `insert into feature_flags (key, enabled, rollout, updated_at)
     values ($1,$2,$3::jsonb, now())
     on conflict (key) do update set
       enabled = excluded.enabled,
       rollout = excluded.rollout,
       updated_at = now()
     returning key, enabled, rollout, updated_at`,
    [key, enabled, JSON.stringify(rollout || {})]
  );
  return rows[0];
}
