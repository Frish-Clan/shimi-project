/**
 * Travel Advisories — public government RSS feeds
 * Sources: US State Dept, UK FCDO, Australia Safetravel, NZ Safetravel
 *
 * Advisory levels (US model):
 *   Level 1 — Normal Precautions   → 'normal'
 *   Level 2 — Exercise Caution     → 'caution'
 *   Level 3 — Reconsider Travel    → 'reconsider'
 *   Level 4 — Do Not Travel        → 'do-not-travel'
 */
import { cacheGet, cacheSet } from '../utils/cache.js';

/**
 * Advisory feeds are public government data (US State Dept, UK FCDO).
 * Fetched via the local proxy (/proxy?url=...) to handle CORS.
 * WorldMonitor does not expose a travel-advisory API endpoint.
 */
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2h
const PROXY    = 'http://localhost:8001/proxy?url=';

// Advisory level rank for comparison
const LEVEL_RANK = { 'do-not-travel': 4, 'reconsider': 3, 'caution': 2, 'normal': 1 };

// US State Dept country name → ISO2 overrides for special cases
const NAME_TO_ISO2 = {
  'burma': 'MM', 'myanmar': 'MM', 'burma (myanmar)': 'MM',
  'north korea': 'KP', 'south korea': 'KR',
  'russia': 'RU', 'iran': 'IR', 'china': 'CN',
  'taiwan': 'TW', 'hong kong': 'HK',
  'israel, the west bank and gaza': 'IL',
  'israel': 'IL', 'west bank': 'PS', 'gaza': 'PS',
  'south sudan': 'SS', 'central african republic': 'CF',
  'united arab emirates': 'AE', 'saudi arabia': 'SA',
  'democratic republic of the congo': 'CD', 'republic of the congo': 'CG',
  'czech republic': 'CZ', 'czechia': 'CZ',
  'new zealand': 'NZ', 'united kingdom': 'GB',
  'trinidad and tobago': 'TT', 'antigua and barbuda': 'AG',
  'saint kitts and nevis': 'KN', 'saint lucia': 'LC',
  'saint vincent and the grenadines': 'VC',
  'bosnia and herzegovina': 'BA', 'north macedonia': 'MK',
  'timor-leste': 'TL', 'east timor': 'TL',
  'eswatini': 'SZ', 'swaziland': 'SZ',
};

function nameToIso2(name) {
  const lower = name.trim().toLowerCase();
  if (NAME_TO_ISO2[lower]) return NAME_TO_ISO2[lower];
  // Try first word match for common cases
  return null;
}

function parseUsLevel(title) {
  if (/Level 4|Do Not Travel/i.test(title)) return 'do-not-travel';
  if (/Level 3|Reconsider/i.test(title)) return 'reconsider';
  if (/Level 2|Exercise.*Caution|Increased Caution/i.test(title)) return 'caution';
  return 'normal';
}

function parseUsAdvisories(xml) {
  const result = {};
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const item of items) {
    const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
    if (!titleMatch) continue;
    const title = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    // Format: "Country Name - Level X: Description"
    const dashIdx = title.indexOf(' - Level');
    if (dashIdx < 0) continue;
    const countryName = title.substring(0, dashIdx).trim();
    const level = parseUsLevel(title);
    const iso2 = nameToIso2(countryName);
    if (iso2) {
      const current = result[iso2];
      if (!current || LEVEL_RANK[level] > LEVEL_RANK[current.level]) {
        result[iso2] = { level, source: 'US', name: countryName };
      }
    }
  }
  return result;
}

function parseUkAdvisories(xml) {
  const result = {};
  // UK FCDO uses atom feed with entry titles like "Foreign travel advice for France"
  // and categories for risk level — simpler: just note they have an entry = at least caution
  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
  for (const entry of entries) {
    const titleMatch = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    if (!titleMatch) continue;
    const title = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const m = title.match(/for (.+)$/i);
    if (!m) continue;
    const iso2 = nameToIso2(m[1]);
    if (iso2 && !result[iso2]) {
      result[iso2] = { level: 'caution', source: 'UK' };
    }
  }
  return result;
}

/**
 * Fetch and parse advisory feeds, return map: { iso2 → { level, sources } }
 */
export async function getAdvisories() {
  const cached = cacheGet('advisories_all', CACHE_TTL);
  if (cached) return cached;

  const advisories = {}; // iso2 → { level, sources: Set }

  function merge(parsed, sourceLabel) {
    for (const [iso2, data] of Object.entries(parsed)) {
      if (!advisories[iso2]) {
        advisories[iso2] = { level: data.level, sources: new Set([sourceLabel]) };
      } else {
        advisories[iso2].sources.add(sourceLabel);
        if (LEVEL_RANK[data.level] > LEVEL_RANK[advisories[iso2].level]) {
          advisories[iso2].level = data.level;
        }
      }
    }
  }

  // Fetch all feeds in parallel
  const feeds = [
    {
      url: 'https://travel.state.gov/_res/rss/TAsTWs.xml',
      parse: parseUsAdvisories,
      label: 'US',
    },
    {
      url: 'https://www.gov.uk/foreign-travel-advice.atom',
      parse: parseUkAdvisories,
      label: 'UK',
    },
  ];

  await Promise.allSettled(feeds.map(async ({ url, parse, label }) => {
    try {
      const res = await fetch(PROXY + encodeURIComponent(url));
      if (!res.ok) return;
      const xml = await res.text();
      merge(parse(xml), label);
    } catch (e) {
      console.warn(`Advisory ${label} fetch failed:`, e.message);
    }
  }));

  // Serialize Sets to arrays for caching
  const serializable = {};
  for (const [iso2, data] of Object.entries(advisories)) {
    serializable[iso2] = { level: data.level, sources: [...data.sources] };
  }
  cacheSet('advisories_all', serializable);
  return serializable;
}

/**
 * Compute advisory boost and floor for a country
 * Mirrors worldmonitor's getAdvisoryBoost + getAdvisoryFloor
 */
export function getAdvisoryBoost(advisory) {
  if (!advisory?.level) return { boost: 0, floor: 0 };
  let boost = 0;
  switch (advisory.level) {
    case 'do-not-travel': boost = 15; break;
    case 'reconsider':    boost = 10; break;
    case 'caution':       boost = 5;  break;
    default: return { boost: 0, floor: 0 };
  }
  const srcCount = (advisory.sources || []).length;
  if (srcCount >= 3) boost += 5;
  else if (srcCount >= 2) boost += 3;

  const floor = advisory.level === 'do-not-travel' ? 60
              : advisory.level === 'reconsider'    ? 50
              : 0;
  return { boost, floor };
}
