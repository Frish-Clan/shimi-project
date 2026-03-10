/**
 * World Bank governance & country data — via WorldMonitor economic API
 * Endpoint: /api/economic/v1/list-world-bank-indicators
 * All data flows through WorldMonitor, not directly from api.worldbank.org.
 */
import { cacheGet, cacheSet } from '../utils/cache.js';

const PROXY_BASE = 'http://localhost:8001/api?endpoint=';
const CACHE_TTL  = 60 * 60 * 1000; // 1 hour — WB data changes infrequently

async function fetchWmWb(indicator, countryCode = '', pageSize = 300) {
  const cacheKey = `wm_wb_${indicator}_${countryCode}`;
  const cached = cacheGet(cacheKey, CACHE_TTL);
  if (cached) return cached;

  let url = `${PROXY_BASE}/api/economic/v1/list-world-bank-indicators?indicator_code=${indicator}&page_size=${pageSize}`;
  if (countryCode) url += `&country_code=${countryCode}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`WM WorldBank ${res.status}`);
    const json = await res.json();
    const data = json.data || json;
    cacheSet(cacheKey, data);
    return data;
  } catch (e) {
    console.warn(`WorldMonitor WB indicator ${indicator} fetch failed:`, e.message);
    return null;
  }
}

/**
 * Get latest value for an indicator for all countries.
 * Returns: { ISO3: { value, date } }
 */
export async function getAllCountryIndicator(indicator) {
  const data = await fetchWmWb(indicator);
  const rows = data?.data || [];
  const result = {};
  for (const item of rows) {
    const iso3 = item.countryCode;
    if (iso3 && item.value != null) {
      // Keep the most recent year if multiple entries for same country
      if (!result[iso3] || item.year > result[iso3].year) {
        result[iso3] = { value: item.value, date: String(item.year), year: item.year };
      }
    }
  }
  return result;
}

/**
 * Get multi-year history for one indicator for one country.
 * Returns: [{ year, value }]
 */
export async function getCountryIndicatorHistory(iso2, indicator, years = 5) {
  const data = await fetchWmWb(indicator, iso2, years * 2);
  const rows = data?.data || [];
  return rows
    .filter(d => d.value != null)
    .map(d => ({ year: String(d.year), value: d.value }))
    .sort((a, b) => a.year - b.year)
    .slice(-years);
}

/**
 * Get all key governance indicators for a country.
 */
export async function getCountryAllGovernance(iso2) {
  const indicators = ['PV.EST', 'GE.EST', 'CC.EST', 'RL.EST', 'RQ.EST'];
  const results = await Promise.allSettled(
    indicators.map(ind => getCountryIndicatorHistory(iso2, ind, 5))
  );
  return {
    pvEst: results[0].status === 'fulfilled' ? results[0].value : [],
    geEst: results[1].status === 'fulfilled' ? results[1].value : [],
    ccEst: results[2].status === 'fulfilled' ? results[2].value : [],
    rlEst: results[3].status === 'fulfilled' ? results[3].value : [],
    rqEst: results[4].status === 'fulfilled' ? results[4].value : [],
  };
}

/**
 * Get country metadata (name, capital, region, income level).
 * WorldMonitor WB endpoint doesn't return metadata directly — return empty
 * so the app falls back to restcountries.js for display metadata.
 */
export async function getCountryMeta() {
  // Country display metadata (flags, coordinates, ISO codes) is not available
  // through WorldMonitor's WB endpoint. This falls back gracefully to empty.
  return {};
}
