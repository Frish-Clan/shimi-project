/**
 * Earthquake data — via WorldMonitor seismology API
 * Endpoint: /api/seismology/v1/list-earthquakes
 * All data flows through WorldMonitor, not directly from USGS.
 */
import { cacheGet, cacheSet } from '../utils/cache.js';

const PROXY_BASE = 'http://localhost:8001/api?endpoint=';
const CACHE_TTL  = 15 * 60 * 1000; // 15 min

export async function getEarthquakes() {
  const cached = cacheGet('wm_earthquakes', CACHE_TTL);
  if (cached) return cached;

  try {
    const res = await fetch(`${PROXY_BASE}/api/seismology/v1/list-earthquakes?min_magnitude=4.5&page_size=100`);
    if (!res.ok) throw new Error(`Seismology ${res.status}`);
    const json = await res.json();
    // Proxy may or may not wrap in {data: ...}
    const data = json.data || json;
    cacheSet('wm_earthquakes', data);
    return data;
  } catch (e) {
    console.warn('WorldMonitor seismology fetch failed:', e.message);
    return null;
  }
}

export function parseEarthquakes(wmData) {
  // WorldMonitor response shape: { earthquakes: [{id, place, magnitude, depthKm, location, occurredAt}] }
  const quakes = wmData?.earthquakes || [];
  return quakes.map(q => ({
    id:    q.id,
    mag:   q.magnitude,
    place: q.place,
    time:  new Date(q.occurredAt || 0),   // WM returns ms already
    alert: null,
    sig:   Math.round((q.magnitude || 0) * 100),
    lat:   q.location?.latitude  ?? q.location?.lat  ?? q.lat ?? 0,
    lng:   q.location?.longitude ?? q.location?.lng  ?? q.lon ?? q.lng ?? 0,
  }));
}
