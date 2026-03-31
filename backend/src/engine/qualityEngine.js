import { query } from '../db.js';

function issueFingerprint(issue) {
  return `${issue.issue_key}:${issue.entity}:${issue.entity_id}`;
}

export async function recalculateQualityIssues() {
  const largeRule = await query('select value from calculation_rules where key = $1 and enabled = true', ['alert_large_operation']);
  const threshold = Number(largeRule.rows[0]?.value?.threshold || 500000);

  const issues = [];

  const largeOps = await query(
    `select id, amount, type, operation_date
     from operations
     where status = 'confirmed' and abs(amount) >= $1`,
    [threshold]
  );
  for (const row of largeOps.rows) {
    issues.push({
      issue_key: 'large_operation',
      severity: 'warn',
      entity: 'operations',
      entity_id: row.id,
      details: {
        threshold,
        amount: Number(row.amount),
        type: row.type,
        operation_date: row.operation_date,
      },
    });
  }

  const vatMismatch = await query(
    `select id, vat_included, vat_amount, amount
     from operations
     where status = 'confirmed' and vat_included = true and coalesce(vat_amount, 0) = 0`
  );
  for (const row of vatMismatch.rows) {
    issues.push({
      issue_key: 'vat_without_amount',
      severity: 'warn',
      entity: 'operations',
      entity_id: row.id,
      details: {
        vat_included: row.vat_included,
        vat_amount: Number(row.vat_amount || 0),
        amount: Number(row.amount || 0),
      },
    });
  }

  const noInn = await query(
    `select distinct o.id as operation_id, c.id as counterparty_id, c.name
     from operations o
     join counterparties c on c.id = o.counterparty_id
     where o.status = 'confirmed' and (c.inn is null or length(trim(c.inn)) = 0)`
  );
  for (const row of noInn.rows) {
    issues.push({
      issue_key: 'counterparty_without_inn',
      severity: 'info',
      entity: 'operations',
      entity_id: row.operation_id,
      details: {
        counterparty_id: row.counterparty_id,
        counterparty_name: row.name,
      },
    });
  }

  await query('delete from quality_issues where status = $1', ['open']);
  for (const issue of issues) {
    await query(
      `insert into quality_issues (issue_key, severity, entity, entity_id, details, status)
       values ($1,$2,$3,$4,$5::jsonb,'open')`,
      [issue.issue_key, issue.severity, issue.entity, issue.entity_id, JSON.stringify(issue.details)]
    );
  }

  return {
    inserted: issues.length,
    fingerprints: issues.map(issueFingerprint),
  };
}
