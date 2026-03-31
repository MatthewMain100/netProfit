export async function getCurrentCategoryVersionId(client, categoryId) {
  const { rows } = await client.query(
    'select id from category_versions where category_id = $1 and is_current = true limit 1',
    [categoryId]
  );
  return rows[0]?.id || null;
}

export async function getCurrentProjectVersionId(client, projectId) {
  const { rows } = await client.query(
    'select id from project_versions where project_id = $1 and is_current = true limit 1',
    [projectId]
  );
  return rows[0]?.id || null;
}

export async function getCurrentCounterpartyVersionId(client, counterpartyId) {
  const { rows } = await client.query(
    'select id from counterparty_versions where counterparty_id = $1 and is_current = true limit 1',
    [counterpartyId]
  );
  return rows[0]?.id || null;
}

export async function ensureCategory(client, name, type) {
  if (!name) return null;
  const found = await client.query('select id from categories where name = $1 and type = $2', [name, type]);
  if (found.rows[0]) {
    return {
      id: found.rows[0].id,
      version_id: await getCurrentCategoryVersionId(client, found.rows[0].id),
    };
  }

  const created = await client.query(
    'insert into categories (name, type) values ($1, $2) returning *',
    [name, type]
  );
  const version = await client.query(
    'insert into category_versions (category_id, name, type, parent_id) values ($1,$2,$3,$4) returning id',
    [created.rows[0].id, created.rows[0].name, created.rows[0].type, created.rows[0].parent_id]
  );

  return { id: created.rows[0].id, version_id: version.rows[0].id };
}

export async function ensureProject(client, name) {
  if (!name) return null;
  const found = await client.query('select id from projects where name = $1', [name]);
  if (found.rows[0]) {
    return {
      id: found.rows[0].id,
      version_id: await getCurrentProjectVersionId(client, found.rows[0].id),
    };
  }

  const created = await client.query('insert into projects (name) values ($1) returning *', [name]);
  const version = await client.query(
    'insert into project_versions (project_id, name, status) values ($1,$2,$3) returning id',
    [created.rows[0].id, created.rows[0].name, created.rows[0].status]
  );
  return { id: created.rows[0].id, version_id: version.rows[0].id };
}

export async function ensureCounterparty(client, name) {
  if (!name) return null;
  const found = await client.query('select id from counterparties where name = $1', [name]);
  if (found.rows[0]) {
    return {
      id: found.rows[0].id,
      version_id: await getCurrentCounterpartyVersionId(client, found.rows[0].id),
    };
  }

  const created = await client.query('insert into counterparties (name) values ($1) returning *', [name]);
  const version = await client.query(
    'insert into counterparty_versions (counterparty_id, name, inn, type) values ($1,$2,$3,$4) returning id',
    [created.rows[0].id, created.rows[0].name, created.rows[0].inn, created.rows[0].type]
  );
  return { id: created.rows[0].id, version_id: version.rows[0].id };
}
