const cache = new Map();

function now() {
  return Date.now();
}

export function getCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (item.expiresAt <= now()) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

export function setCache(key, value, ttlSeconds = 30) {
  cache.set(key, {
    value,
    expiresAt: now() + Math.max(1, ttlSeconds) * 1000,
  });
}

export function deleteCache(key) {
  cache.delete(key);
}

export function clearCacheByPrefix(prefix) {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

export function withCache(key, ttlSeconds, builder) {
  const cached = getCache(key);
  if (cached != null) return Promise.resolve(cached);
  return Promise.resolve(builder()).then(value => {
    setCache(key, value, ttlSeconds);
    return value;
  });
}
