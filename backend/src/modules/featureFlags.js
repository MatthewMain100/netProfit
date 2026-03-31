import { allFeatureFlags, setFeatureFlag } from '../infra/flags.js';

export function registerFeatureFlagRoutes({ app, requireAuth, requireRole }) {
  app.get('/feature-flags', requireAuth, async (_req, res) => {
    const rows = await allFeatureFlags();
    res.json(rows.map(r => ({ key: r.key, enabled: r.enabled, rollout: r.rollout, updated_at: r.updated_at })));
  });

  app.patch('/feature-flags/:key', requireRole(['admin']), async (req, res) => {
    const key = req.params.key;
    const enabled = Boolean(req.body?.enabled);
    const rollout = req.body?.rollout || {};
    const row = await setFeatureFlag(key, enabled, rollout);
    res.json(row);
  });
}
