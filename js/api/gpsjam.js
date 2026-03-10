/**
 * GPS Jamming data from worldmonitor /api/gpsjam endpoint
 * H3 hex grid of GPS jamming levels (high/medium)
 */
import { cacheGet, cacheSet } from '../utils/cache.js';

const CACHE_TTL = 15 * 60 * 1000; // 15 min

let _gpsData = null;

/**
 * Fetch global GPS jamming hex data (cached)
 */
export async function getGpsJamData() {
  const cached = cacheGet('gpsjam_global', CACHE_TTL);
  if (cached) { _gpsData = cached; return cached; }

  try {
    const res = await fetch('http://localhost:8001/api?endpoint=/api/gpsjam');
    if (!res.ok) throw new Error(`gpsjam ${res.status}`);
    const json = await res.json();
    const hexes = json.hexes || [];
    _gpsData = hexes;
    cacheSet('gpsjam_global', hexes);
    return hexes;
  } catch (e) {
    console.warn('GPS jam fetch failed:', e.message);
    return _gpsData || [];
  }
}

/**
 * Count GPS jamming hexes near a country's lat/lng
 * @param {number[]} latlng - [lat, lng]
 * @param {number[]} hexes - global hex array
 * @returns {{ highCount, mediumCount, total }}
 */
export function filterGpsJamForCountry(hexes, latlng, radius = 4) {
  if (!latlng || !hexes?.length) return { highCount: 0, mediumCount: 0, total: 0 };
  const [cLat, cLng] = latlng;
  let highCount = 0, mediumCount = 0;
  for (const h of hexes) {
    if (Math.abs(h.lat - cLat) < radius && Math.abs(h.lon - cLng) < radius) {
      if (h.level === 'high') highCount++;
      else mediumCount++;
    }
  }
  return { highCount, mediumCount, total: highCount + mediumCount };
}
