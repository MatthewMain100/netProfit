import { Queue } from 'bullmq';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const queueNames = ['imports', 'reports', 'projections', 'quality'];
const queues = new Map();
let redisUnavailable = false;
let warnedUnavailable = false;

function isRedisRequired() {
  const raw = String(process.env.REDIS_REQUIRED || 'true').trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'no');
}

function redisConnection() {
  return {
    connection: {
      url: REDIS_URL,
      connectTimeout: 1500,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    },
  };
}

function buildQueue(name) {
  if (!queues.has(name)) {
    const q = new Queue(name, redisConnection());
    q.on('error', err => {
      if (isRedisRequired()) {
        console.error(`[queue:${name}] ${err.message}`);
      }
    });
    queues.set(name, q);
  }
  return queues.get(name);
}

export function getQueue(name) {
  if (!queueNames.includes(name)) {
    throw new Error(`Unknown queue: ${name}`);
  }
  return buildQueue(name);
}

export async function enqueue(name, jobName, payload, opts = {}) {
  if (redisUnavailable && !isRedisRequired()) {
    return null;
  }

  try {
    const queue = getQueue(name);
    const job = await queue.add(jobName, payload, {
      removeOnComplete: 100,
      removeOnFail: 100,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1500 },
      ...opts,
    });
    return job.id;
  } catch (err) {
    if (!isRedisRequired()) {
      redisUnavailable = true;
      if (!warnedUnavailable) {
        console.warn(`[queue] Redis unavailable (${REDIS_URL}); async jobs are disabled.`);
        warnedUnavailable = true;
      }
      return null;
    }
    throw err;
  }
}

export async function closeQueues() {
  await Promise.all(Array.from(queues.values()).map(q => q.close()));
}

export const QUEUES = {
  IMPORTS: 'imports',
  REPORTS: 'reports',
  PROJECTIONS: 'projections',
  QUALITY: 'quality',
};
