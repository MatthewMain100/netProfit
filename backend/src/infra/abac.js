import { query } from '../db.js';

function matchesConditions(conditions, context) {
  const c = conditions || {};
  const { resource, user } = context;

  if (Array.isArray(c.allowed_project_ids) && c.allowed_project_ids.length) {
    if (resource.project_id == null) return false;
    if (!c.allowed_project_ids.includes(resource.project_id)) return false;
  }

  if (c.owner_only === true) {
    if (!resource.created_by || Number(resource.created_by) !== Number(user.id)) return false;
  }

  if (typeof c.max_amount === 'number' && resource.amount != null) {
    if (Math.abs(Number(resource.amount)) > c.max_amount) return false;
  }

  if (typeof c.min_amount === 'number' && resource.amount != null) {
    if (Math.abs(Number(resource.amount)) < c.min_amount) return false;
  }

  if (c.period_from && resource.operation_date) {
    if (String(resource.operation_date) < String(c.period_from)) return false;
  }

  if (c.period_to && resource.operation_date) {
    if (String(resource.operation_date) > String(c.period_to)) return false;
  }

  return true;
}

export async function evaluatePolicy(user, action, resourceName, resource = {}) {
  const { rows } = await query(
    `select p.*
     from policies p
     left join policy_bindings b on b.policy_id = p.id
     where p.action = $1
       and p.resource = $2
       and (b.user_id = $3 or b.role = $4 or b.id is null)
     order by p.id asc`,
    [action, resourceName, user.id, user.role]
  );

  let hasAllow = false;
  for (const row of rows) {
    const conditions = row.conditions || {};
    if (!matchesConditions(conditions, { user, resource })) {
      continue;
    }

    if (row.effect === 'deny') {
      return { allowed: false, reason: `policy:${row.id}:deny` };
    }

    if (row.effect === 'allow') {
      hasAllow = true;
    }
  }

  return { allowed: hasAllow || rows.length === 0, reason: hasAllow ? 'policy:allow' : 'default' };
}

export async function applySessionRls(client, user) {
  if (!user) return;
  const projectIds = user.allowed_project_ids || [];
  await client.query(`select set_config('app.user_id', $1, true)`, [String(user.id)]);
  await client.query(`select set_config('app.allowed_project_ids', $1, true)`, [projectIds.join(',')]);
  await client.query(`select set_config('app.rls_enforced', $1, true)`, [user.rls_enforced ? 'on' : 'off']);
}
