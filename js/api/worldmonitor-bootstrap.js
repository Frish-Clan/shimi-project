/**
 * Worldmonitor Bootstrap API — single endpoint that returns ALL live data
 * Endpoint: /api/bootstrap
 *
 * Contains: CII scores, unrest events, Iran events, UCDP events,
 *           wildfires, weather alerts, temporal anomalies, news digest, etc.
 */
import { cacheGet, cacheSet } from '../utils/cache.js';

const PROXY_BASE = 'http://localhost:8001/api?endpoint=';
const CACHE_TTL  = 10 * 60 * 1000; // 10 min — data is near real-time

let _bootstrapCache = null;

/**
 * Fetch the entire bootstrap payload (cached for 10 min)
 */
export async function getBootstrapData() {
  const cached = cacheGet('wm_bootstrap', CACHE_TTL);
  if (cached) { _bootstrapCache = cached; return cached; }

  try {
    const res = await fetch(`${PROXY_BASE}/api/bootstrap`);
    if (!res.ok) throw new Error(`Bootstrap ${res.status}`);
    const json = await res.json();
    const data = json.data || json;
    _bootstrapCache = data;
    cacheSet('wm_bootstrap', data);
    return data;
  } catch (e) {
    console.warn('Bootstrap fetch failed:', e.message);
    return _bootstrapCache || {};
  }
}

/**
 * Get CII scores for all countries from bootstrap data
 * Returns: { IR: { combinedScore, staticBaseline, dynamicScore, trend, components }, ... }
 */
export function parseCIIScores(data) {
  const scores = {};
  const ciiList = data?.riskScores?.ciiScores || [];
  for (const entry of ciiList) {
    const iso2 = entry.region;
    if (!iso2) continue;
    scores[iso2] = {
      composite:    entry.combinedScore ?? 0,
      baseline:     entry.staticBaseline ?? 0,
      dynamic:      entry.dynamicScore ?? 0,
      trend:        entry.trend || '',
      components:   entry.components || {},
      computedAt:   entry.computedAt || 0,
    };
  }
  return scores;
}

/**
 * Get country-specific intelligence from bootstrap data
 * @param {object} data - full bootstrap payload
 * @param {string} iso2 - ISO2 country code
 * @param {number[]} latlng - [lat, lng] from restcountries (optional)
 */
export function getCountryIntel(data, iso2, latlng = null) {
  const cii     = parseCIIScores(data)[iso2] || null;
  const iranEvt = iso2 === 'IR' ? (data?.iranEvents?.events || []) : [];

  const [cLat, cLng] = latlng || [0, 0];
  const hasLatLng = latlng && (cLat !== 0 || cLng !== 0);

  // Filter unrest events by country field or lat/lng proximity (~5°)
  const unrestAll = data?.unrestEvents?.events || [];
  const unrestHere = unrestAll.filter(e => {
    if (e.country === iso2 || e.countryCode === iso2 || e.region === iso2) return true;
    if (hasLatLng && e.lat != null && e.lng != null) {
      return Math.abs(e.lat - cLat) < 5 && Math.abs(e.lng - cLng) < 5;
    }
    return false;
  });

  // UCDP events for this country
  const ucdpAll  = data?.ucdpEvents?.events || [];
  const ucdpHere = ucdpAll.filter(e =>
    e.country === iso2 || e.countryCode === iso2 || e.region === iso2
  );

  // Wildfires near this country — filter by lat/lng proximity (~4°)
  const wildfiresAll = data?.wildfires?.fireDetections || [];
  const wildfiresHere = hasLatLng
    ? wildfiresAll.filter(f => {
        const fLat = f.latitude ?? f.lat ?? null;
        const fLng = f.longitude ?? f.lng ?? null;
        if (fLat == null || fLng == null) return false;
        return Math.abs(fLat - cLat) < 4 && Math.abs(fLng - cLng) < 4;
      })
    : [];

  // Cyber threats for this country (has `country` ISO2 field)
  const cyberAll  = data?.cyberThreats?.threats || [];
  const cyberHere = cyberAll.filter(t => t.country === iso2);
  const cyberCritical = cyberHere.filter(t => t.severity?.includes('CRITICAL')).length;
  const cyberHigh     = cyberHere.filter(t => t.severity?.includes('HIGH')).length;
  const cyberMedium   = cyberHere.filter(t => t.severity?.includes('MEDIUM')).length;
  // Supplemental cyber boost (mirrors worldmonitor's getSupplementalSignalBoost)
  const cyberBoost = Math.min(12, cyberCritical * 3 + cyberHigh * 1.8 + cyberMedium * 0.9);

  // Internet outages for this country
  const outagesAll  = data?.outages?.outages || [];
  const outagesHere = outagesAll.filter(o => {
    if (!o.country && !o.region) return false;
    const oc = (o.country || '').toLowerCase();
    return oc.includes(iso2.toLowerCase());
  });
  const outageTotal  = outagesHere.filter(o => o.severity?.includes('TOTAL')).length;
  const outageMajor  = outagesHere.filter(o => o.severity?.includes('MAJOR')).length;
  const outagePartial = outagesHere.filter(o => o.severity?.includes('PARTIAL')).length;
  const outageBoost  = Math.min(50, outageTotal * 30 + outageMajor * 15 + outagePartial * 5);

  // Temporal anomalies for this country/region
  const temporalAll  = data?.temporalAnomalies?.anomalies || [];
  const temporalHere = temporalAll.filter(a => {
    const r = (a.region || '').trim();
    return r === iso2 || r.toLowerCase() === 'global';
  });
  const temporalCritical = temporalHere.filter(a => a.severity === 'critical').length;
  const temporalBoost    = Math.min(6, temporalCritical * 2 + temporalHere.length * 0.75);

  // News digest
  const newsFeed = data?.insights?.topStories || [];

  // Weather alerts
  const weather = data?.weatherAlerts?.alerts || [];

  return {
    cii,
    iranEvents:    iranEvt,
    unrestEvents:  unrestHere,
    ucdpEvents:    ucdpHere,
    ucdpTotal:     ucdpAll.length,
    wildfires:     wildfiresHere,
    wildfiresCount: wildfiresHere.length,
    newsFeed,
    weather,
    // Supplemental signal boosts (pre-computed, mirrors worldmonitor formula)
    cyberBoost,
    outageBoost,
    temporalBoost,
    cyberCount: cyberHere.length,
    outageCount: outagesHere.length,
  };
}

/**
 * Fetch country intelligence brief from worldmonitor
 */
export async function getCountryBrief(iso2) {
  const cached = cacheGet(`wm_brief_${iso2}`, 30 * 60 * 1000);
  if (cached) return cached;

  try {
    const res = await fetch(`${PROXY_BASE}/api/intelligence/v1/get-country-intel-brief?country=${iso2}`);
    if (!res.ok) return { brief: '' };
    const json = await res.json();
    cacheSet(`wm_brief_${iso2}`, json);
    return json;
  } catch {
    return { brief: '' };
  }
}

/**
 * Get news feed digest
 */
export async function getNewsFeed() {
  const cached = cacheGet('wm_news_feed', 10 * 60 * 1000);
  if (cached) return cached;

  try {
    const res = await fetch(`${PROXY_BASE}/api/news/v1/list-feed-digest`);
    if (!res.ok) return { categories: {} };
    const json = await res.json();
    cacheSet('wm_news_feed', json);
    return json;
  } catch {
    return { categories: {} };
  }
}
