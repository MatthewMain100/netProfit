export function registerUiPrefsRoutes({ app, requireAuth, query }) {
  app.get('/ui/prefs', requireAuth, async (req, res) => {
    const { rows } = await query('select prefs, updated_at from ui_prefs where user_id = $1', [req.user.id]);
    if (!rows[0]) {
      return res.json({
        prefs: {
          mode: req.user.role === 'accountant' ? 'accountant' : 'director',
          theme: 'sand',
          density: 'comfortable',
          accent: 'coal',
        },
      });
    }
    res.json(rows[0]);
  });

  app.patch('/ui/prefs', requireAuth, async (req, res) => {
    const prefs = req.body?.prefs || req.body || {};
    const { rows } = await query(
      `insert into ui_prefs (user_id, prefs, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (user_id) do update
         set prefs = excluded.prefs,
             updated_at = now()
       returning prefs, updated_at`,
      [req.user.id, JSON.stringify(prefs)]
    );
    res.json(rows[0]);
  });
}
