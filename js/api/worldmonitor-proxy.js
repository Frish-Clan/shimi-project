import { cacheGet, cacheSet } from '../utils/cache.js';

// Try to fetch through a CORS proxy as a workaround
const PROXY_URL = 'https://cors-anywhere.herokuapp.com/';
const BASE_URL = 'https://api.worldmonitor.app/api';

export async function getCountryInstabilityIndex() {
  const cached = cacheGet('worldmonitor_cii');
  if (cached) return cached;
  
  try {
    // Try direct fetch first
    const res = await fetch(`${BASE_URL}/intelligence/v1/list-country-instability`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (res.ok) {
      const data = await res.json();
      cacheSet('worldmonitor_cii', data, 3600); // Cache for 1 hour
      return data;
    }
  } catch (error) {
    console.warn('Direct fetch failed, trying proxy...', error);
    
    // Fallback to CORS proxy
    try {
      const proxyRes = await fetch(`${PROXY_URL}${BASE_URL}/intelligence/v1/list-country-instability`);
      if (proxyRes.ok) {
        const data = await proxyRes.json();
        cacheSet('worldmonitor_cii', data, 3600);
        return data;
      }
    } catch (proxyError) {
      console.warn('Proxy fetch also failed:', proxyError);
    }
  }
  
  // Return empty object on failure
  return {};
}

export async function getClimateAnomalies() {
  const cached = cacheGet('worldmonitor_climate');
  if (cached) return cached;
  
  try {
    const res = await fetch(`${BASE_URL}/climate/v1/list-climate-anomalies`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (res.ok) {
      const data = await res.json();
      cacheSet('worldmonitor_climate', data, 3600);
      return data;
    }
  } catch (error) {
    console.warn('Failed to fetch climate data:', error);
  }
  
  return [];
}

export function parseCountryInstability(data) {
  if (!data || typeof data !== 'object') return {};
  const scores = {};
  for (const [country, score] of Object.entries(data)) {
    scores[country] = score;
  }
  return scores;
}

export function parseClimateAnomalies(data) {
  if (!Array.isArray(data)) return [];
  return data.map(item => ({
    region: item.region || '',
    temperature: item.temperature || 0,
    precipitation: item.precipitation || 0,
    severity: item.severity || 'normal',
  }));
}