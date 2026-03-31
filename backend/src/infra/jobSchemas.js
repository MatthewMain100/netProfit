import { z } from 'zod';

export const importBatchJobSchema = z.object({
  batchId: z.number().int().positive(),
  actorId: z.number().int().positive().nullable().optional(),
});

export const refreshKpiJobSchema = z.object({
  operationDate: z.string().nullable().optional(),
  reason: z.string().min(1),
});

export const qualityJobSchema = z.object({
  entity: z.string().optional(),
  entityId: z.number().int().nullable().optional(),
  reason: z.string().min(1),
});

export function validatePayload(schema, payload) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new Error(result.error.issues.map(i => i.message).join(', '));
  }
  return result.data;
}
