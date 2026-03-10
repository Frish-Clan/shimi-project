const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes

export function cacheGet(key, ttl = DEFAULT_TTL) {
  try {
    const item = sessionStorage.getItem(key);
    if (!item) return null;
    const { data, timestamp } = JSON.parse(item);
    if (Date.now() - timestamp > ttl) { sessionStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

export function cacheSet(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() })); }
  catch { /* storage full */ }
}
