/**
 * Conflict/news timeline data — via WorldMonitor APIs
 *
 * Replaces direct GDELT calls. Uses:
 *   - /api/intelligence/v1/search-gdelt-documents  (article headlines)
 *   - /api/unrest/v1/list-unrest-events            (timeline — events grouped by day)
 *   - /api/conflict/v1/list-acled-events           (conflict timeline)
 *
 * All data flows through WorldMonitor, not directly from api.gdeltproject.org.
 */
import { cacheGet, cacheSet } from '../utils/cache.js';

const PROXY_BASE  = 'http://localhost:8001/api?endpoint=';
const CACHE_TTL   = 20 * 60 * 1000; // 20 min

// ── Helpers ──────────────────────────────────────────────────────────────────

async function wmFetch(endpoint, cacheKey, ttl = CACHE_TTL) {
  const cached = cacheGet(cacheKey, ttl);
  if (cached) return cached;
  try {
    const res = await fetch(`${PROXY_BASE}${endpoint}`);
    if (!res.ok) throw new Error(`WM ${res.status}`);
    const json = await res.json();
    const data = json.data || json;
    cacheSet(cacheKey, data);
    return data;
  } catch (e) {
    console.warn(`WorldMonitor fetch ${endpoint} failed:`, e.message);
    return null;
  }
}

/** Unix timestamp for N days ago */
function daysAgo(n) {
  return Math.floor((Date.now() - n * 86400000) / 1000);
}

/** Group events (occurredAt is milliseconds from WM) into a daily count series */
function eventsToDailyTimeline(events, days) {
  const buckets = {};
  const now = Date.now();
  // Initialise every day in the window to 0
  for (let i = days; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    buckets[key] = 0;
  }
  for (const e of events || []) {
    const ts = e.occurredAt || 0;   // WM returns ms already — no * 1000
    const key = new Date(ts).toISOString().slice(0, 10);
    if (key in buckets) buckets[key]++;
  }
  return Object.entries(buckets)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date: date.replace(/-/g, ''), value: count }));
}

// ── Public API (same signatures as old gdelt.js) ─────────────────────────────

/**
 * Global conflict timeline — uses WorldMonitor unrest events (global, 30 days).
 */
export async function getGlobalConflictTimeline(timespan = '30d') {
  const days = parseInt(timespan) || 30;
  const start = daysAgo(days);
  const ep = `/api/unrest/v1/list-unrest-events?start=${start}&page_size=200`;
  const data = await wmFetch(ep, `wm_global_timeline_${timespan}`);
  return data;
}

/**
 * Country conflict timeline — fetches global feed and filters client-side by country name.
 * WM API ignores the `country` param; events carry a `country` name string field.
 */
export async function getCountryConflictTimeline(countryName, timespan = '30d') {
  const days = parseInt(timespan) || 30;
  const start = daysAgo(days);
  const ep = `/api/unrest/v1/list-unrest-events?start=${start}&page_size=200`;
  const data = await wmFetch(ep, `wm_global_unrest_${timespan}`);
  if (!data) return null;
  const events = (data.events || data.clusters || []).filter(e => e.country === countryName);
  return { events };
}

/**
 * Country headlines — via WorldMonitor GDELT document search.
 */
export async function getCountryHeadlines(countryName, maxrecords = 5) {
  const q = encodeURIComponent(`"${countryName}" conflict instability`);
  const ep = `/api/intelligence/v1/search-gdelt-documents?query=${q}&max_records=${maxrecords}&timespan=7d`;
  const data = await wmFetch(ep, `wm_headlines_${countryName}`);
  // Return in the same shape the old gdelt.js returned for artlist mode
  return { articles: data?.articles || [] };
}

/**
 * Country category timeline — uses WorldMonitor unrest events (protest/military/natural).
 * Returns events for parseTimeline() to consume.
 */
// Maps category label → WM eventType prefix
const CATEGORY_TYPE = {
  protest:  'UNREST_EVENT_TYPE_PROTEST',
  military: 'UNREST_EVENT_TYPE_MILITARY',
  natural:  'UNREST_EVENT_TYPE_NATURAL',
};

export async function getCountryCategoryTimeline(countryName, category, timespan = '7d') {
  const days = parseInt(timespan) || 7;
  const start = daysAgo(days);
  const ep = `/api/unrest/v1/list-unrest-events?start=${start}&page_size=200`;
  const data = await wmFetch(ep, `wm_global_unrest_${timespan}`);
  if (!data) return null;
  const typeFilter = CATEGORY_TYPE[category];
  const events = (data.events || data.clusters || []).filter(e =>
    e.country === countryName && (!typeFilter || e.eventType === typeFilter)
  );
  return { events };
}

/**
 * Parse WorldMonitor unrest/conflict event list into a daily timeline series.
 * Replaces GDELT's parseTimeline() — same output shape: [{ date, value }]
 */
export function parseTimeline(wmData, days = 30) {
  if (!wmData) return [];
  // WorldMonitor response: { events: [...] } or legacy GDELT { timeline: [...] }
  if (wmData.timeline?.[0]?.data) {
    // Legacy GDELT shape (shouldn't happen now, but safe fallback)
    return wmData.timeline[0].data.map(p => ({ date: p.date, value: p.value || 0 }));
  }
  const events = wmData.events || wmData.clusters || [];
  return eventsToDailyTimeline(events, days);
}
