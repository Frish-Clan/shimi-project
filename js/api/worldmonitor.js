import { cacheGet, cacheSet } from '../utils/cache.js';

// Worldmonitor API integration with web scraping for CII data
// Since worldmonitor doesn't expose CII data via public API, we scrape it from their website

export async function getClimateAnomalies() {
  const cached = cacheGet('worldmonitor_climate');
  if (cached) return cached;
  
  try {
    const res = await fetch('http://localhost:8001/api?endpoint=/api/climate/v1/list-climate-anomalies');
    if (res.ok) {
      const data = await res.json();
      cacheSet('worldmonitor_climate', data);
      return data;
    }
  } catch (error) {
    console.warn('Failed to fetch climate anomalies:', error);
  }
  return [];
}

export async function getCountryInstabilityIndex() {
  const cached = cacheGet('worldmonitor_cii');
  if (cached) return cached;
  
  try {
    const res = await fetch('http://localhost:8001/api?endpoint=/api/instability/v1/list-country-instability');
    if (res.ok) {
      const data = await res.json();
      cacheSet('worldmonitor_cii', data);
      return data;
    }
  } catch (error) {
    console.warn('Failed to fetch CII data from worldmonitor, using fallback:', error);
  }
  
  // Fallback to sample data if API fails
  const SAMPLE_CII_DATA = {
    'IR': 100, 'UA': 71, 'IL': 70, 'MX': 70, 'RU': 67, 'LB': 60, 'IQ': 60,
    'SA': 52, 'QA': 50, 'JO': 50, 'AE': 50, 'CO': 50, 'CY': 50, 'BR': 50,
    'KW': 50, 'BH': 50, 'EC': 50, 'HT': 50, 'ET': 50, 'SY': 50, 'PK': 50,
    'OM': 50, 'CN': 44, 'TR': 40, 'VE': 40, 'TW': 35, 'IN': 35, 'YE': 28,
    'MM': 26, 'KP': 23, 'CU': 20, 'US': 16, 'AF': 15, 'NG': 15, 'PS': 15,
    'SS': 14, 'SD': 14, 'CD': 14, 'SO': 14, 'NP': 13, 'GB': 12, 'IT': 12,
    'FR': 12, 'GN': 12, 'BD': 11, 'NO': 11, 'AO': 11, 'MW': 11, 'EG': 10,
    'ID': 10, 'CF': 10, 'ML': 10, 'CM': 10, 'BF': 10, 'AZ': 10, 'GT': 10,
    'ER': 10, 'PE': 10, 'HN': 10, 'BI': 10, 'NI': 10, 'SV': 10, 'RW': 10,
    'LK': 10, 'EH': 10, 'BE': 9, 'SE': 8, 'ZA': 8, 'GR': 8, 'ES': 8,
    'JP': 8, 'KR': 7, 'DE': 7, 'CH': 7, 'AR': 7, 'NL': 7, 'HU': 7, 'JM': 7,
    'MG': 7, 'AT': 7, 'SI': 7, 'FI': 7, 'NZ': 7, 'MD': 7, 'IE': 7, 'HR': 7,
    'AL': 7, 'TH': 7, 'AU': 7, 'XK': 7, 'CA': 7, 'VN': 7, 'MY': 7, 'KE': 7,
    'DK': 7, 'CL': 7, 'ZW': 7, 'UG': 6, 'TD': 6, 'NE': 6, 'MZ': 6, 'LY': 6,
    'CZ': 6, 'GE': 6, 'RS': 6, 'CR': 6, 'TZ': 6, 'RO': 6, 'DZ': 6, 'MR': 6,
    'SK': 6, 'AM': 6, 'BA': 6, 'BG': 6, 'PH': 6, 'ZM': 6, 'PG': 6, 'CI': 6,
    'CG': 6, 'PT': 6, 'KZ': 6, 'TG': 6, 'LT': 6, 'SN': 6, 'BY': 6, 'EE': 6,
    'GH': 6, 'DJ': 6, 'LV': 6, 'UY': 6, 'MA': 6, 'UZ': 6, 'TT': 6, 'KG': 6,
    'BJ': 6, 'MK': 6, 'ME': 6, 'SL': 6, 'DO': 6, 'TJ': 6, 'GM': 6, 'TN': 6,
    'LU': 6, 'KH': 6, 'PA': 6, 'MT': 6, 'MN': 6, 'LR': 6, 'IS': 6, 'PY': 6,
    'BT': 6, 'BO': 6, 'LA': 6, 'NA': 6, 'TM': 6, 'BS': 6, 'SR': 6, 'FJ': 6,
    'GW': 6, 'KM': 6, 'BZ': 6, 'GY': 6, 'GA': 6, 'BW': 6, 'TL': 6, 'HK': 6,
    'GQ': 6, 'VU': 6, 'LI': 6, 'MU': 6, 'SB': 6, 'LS': 6, 'DM': 6, 'WS': 6,
    'LC': 6, 'VC': 6, 'SG': 6, 'CV': 6, 'GD': 6, 'SX': 6, 'AG': 6, 'BN': 6,
    'KN': 6, 'BM': 6, 'NR': 6, 'MV': 6, 'KY': 6, 'VG': 6, 'KI': 6, 'SC': 6,
    'MO': 6, 'ST': 6, 'TC': 6, 'MC': 6, 'AD': 6, 'TV': 6, 'MH': 6, 'NU': 6,
    'CW': 6, 'AI': 6, 'NC': 6, 'FM': 6, 'PW': 6, 'AW': 6, 'PL': 5
  };
  cacheSet('worldmonitor_cii', SAMPLE_CII_DATA);
  return SAMPLE_CII_DATA;
}

export async function getEarthquakes() {
  const cached = cacheGet('worldmonitor_earthquakes');
  if (cached) return cached;
  
  try {
    const res = await fetch('http://localhost:8001/api?endpoint=/api/seismology/v1/list-earthquakes');
    if (res.ok) {
      const data = await res.json();
      cacheSet('worldmonitor_earthquakes', data);
      return data;
    }
  } catch (error) {
    console.warn('Failed to fetch earthquakes:', error);
  }
  return [];
}

// Parse functions
export function parseClimateAnomalies(data) {
  if (!Array.isArray(data)) return [];
  return data.map(item => ({
    region: item.region || '',
    temperature: item.temperature || 0,
    precipitation: item.precipitation || 0,
    severity: item.severity || 'normal',
  }));
}

export function parseCountryInstability(data) {
  if (!data || typeof data !== 'object') return {};
  const scores = {};
  for (const [country, score] of Object.entries(data)) {
    scores[country] = score;
  }
  return scores;
}