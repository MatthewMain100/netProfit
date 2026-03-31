import { clearCacheByPrefix } from './cache.js';
import { enqueue, QUEUES } from './queue.js';
import { refreshKpiJobSchema, qualityJobSchema, validatePayload } from './jobSchemas.js';

export async function publishFollowUpJobs(event) {
  const { entity, action, payload } = event;

  if (entity === 'operations' && ['confirm', 'update', 'create', 'delete'].includes(action)) {
    clearCacheByPrefix('dashboard:finance-center:');
    clearCacheByPrefix('reports:');
    const refreshPayload = validatePayload(refreshKpiJobSchema, {
      operationDate: payload?.snapshot?.operation_date || payload?.operation_date || null,
      reason: `${entity}.${action}`,
    });
    await enqueue(QUEUES.REPORTS, 'refresh-kpi', refreshPayload);

    const qualityPayload = validatePayload(qualityJobSchema, {
      entity,
      entityId: payload?.snapshot?.id || null,
      reason: `${entity}.${action}`,
    });
    await enqueue(QUEUES.QUALITY, 'recalculate-entity', qualityPayload);
  }

  if (entity === 'imports' && ['csv', 'completed', 'start'].includes(action)) {
    clearCacheByPrefix('dashboard:finance-center:');
    clearCacheByPrefix('reports:');
    const qualityPayload = validatePayload(qualityJobSchema, { reason: `${entity}.${action}` });
    await enqueue(QUEUES.QUALITY, 'recalculate-all', qualityPayload);
  }

  if (entity === 'periods' && ['close', 'update', 'create'].includes(action)) {
    clearCacheByPrefix('dashboard:finance-center:');
  }
}
