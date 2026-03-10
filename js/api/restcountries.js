import { cacheGet, cacheSet } from '../utils/cache.js';

const URL = 'https://restcountries.com/v3.1/all?fields=name,cca2,cca3,ccn3,region,subregion,population,latlng,flags,capital';

export async function getAllCountries() {
  const cached = cacheGet('restcountries_all');
  if (cached) return cached;
  const res = await fetch(URL);
  if (!res.ok) throw new Error('REST Countries API error');
  const data = await res.json();
  cacheSet('restcountries_all', data);
  return data;
}

export function buildCountryIndex(countries) {
  const byIso2 = {}, byIso3 = {}, byNumeric = {};
  for (const c of countries) {
    if (c.cca2) byIso2[c.cca2] = c;
    if (c.cca3) byIso3[c.cca3] = c;
    if (c.ccn3) byNumeric[c.ccn3] = c;
  }
  return { byIso2, byIso3, byNumeric };
}
