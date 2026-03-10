/**
 * NASA FIRMS (Fire Information for Resource Management System)
 * Active fire / thermal anomaly data from satellite (VIIRS, MODIS)
 *
 * Open summary CSV endpoint — no API key needed for country-level counts.
 * For detailed data, set FIRMS_MAP_KEY in js/config.js
 */
import { cacheGet, cacheSet } from '../utils/cache.js';
import { proxied } from '../utils/proxy.js';

// ISO2 → ISO3 for FIRMS country endpoint
const ISO2_TO_ISO3 = {
  AF:'AFG',AL:'ALB',DZ:'DZA',AO:'AGO',AR:'ARG',AM:'ARM',AU:'AUS',AT:'AUT',
  AZ:'AZE',BH:'BHR',BD:'BGD',BY:'BLR',BE:'BEL',BJ:'BEN',BO:'BOL',BA:'BIH',
  BR:'BRA',BG:'BGR',BF:'BFA',BI:'BDI',KH:'KHM',CM:'CMR',CA:'CAN',CF:'CAF',
  TD:'TCD',CL:'CHL',CN:'CHN',CO:'COL',CG:'COG',CD:'COD',CR:'CRI',CI:'CIV',
  HR:'HRV',CU:'CUB',CY:'CYP',CZ:'CZE',DK:'DNK',DJ:'DJI',DO:'DOM',EC:'ECU',
  EG:'EGY',SV:'SLV',ER:'ERI',EE:'EST',ET:'ETH',FI:'FIN',FR:'FRA',GA:'GAB',
  GE:'GEO',DE:'DEU',GH:'GHA',GR:'GRC',GT:'GTM',GN:'GIN',GW:'GNB',HT:'HTI',
  HN:'HND',HU:'HUN',IN:'IND',ID:'IDN',IR:'IRN',IQ:'IRQ',IE:'IRL',IL:'ISR',
  IT:'ITA',JM:'JAM',JP:'JPN',JO:'JOR',KZ:'KAZ',KE:'KEN',KP:'PRK',KR:'KOR',
  KW:'KWT',KG:'KGZ',LA:'LAO',LV:'LVA',LB:'LBN',LS:'LSO',LR:'LBR',LY:'LBY',
  LT:'LTU',MG:'MDG',MW:'MWI',MY:'MYS',ML:'MLI',MR:'MRT',MX:'MEX',MD:'MDA',
  MN:'MNG',ME:'MNE',MA:'MAR',MZ:'MOZ',MM:'MMR',NA:'NAM',NP:'NPL',NL:'NLD',
  NZ:'NZL',NI:'NIC',NE:'NER',NG:'NGA',NO:'NOR',OM:'OMN',PK:'PAK',PS:'PSE',
  PA:'PAN',PG:'PNG',PY:'PRY',PE:'PER',PH:'PHL',PL:'POL',PT:'PRT',QA:'QAT',
  RO:'ROU',RU:'RUS',RW:'RWA',SA:'SAU',SN:'SEN',RS:'SRB',SL:'SLE',SG:'SGP',
  SK:'SVK',SI:'SVN',SO:'SOM',ZA:'ZAF',SS:'SSD',ES:'ESP',LK:'LKA',SD:'SDN',
  SR:'SUR',SY:'SYR',TW:'TWN',TJ:'TJK',TZ:'TZA',TH:'THA',TL:'TLS',TG:'TGO',
  TT:'TTO',TN:'TUN',TR:'TUR',TM:'TKM',UG:'UGA',UA:'UKR',AE:'ARE',GB:'GBR',
  US:'USA',UY:'URY',UZ:'UZB',VE:'VEN',VN:'VNM',YE:'YEM',ZM:'ZMB',ZW:'ZWE',
};

/**
 * Fetch active fire count for a country (last 24h)
 * Uses the open FIRMS country summary — no key needed.
 */
export async function getActiveFires(iso2) {
  const iso3 = ISO2_TO_ISO3[iso2];
  if (!iso3) return { count: 0, avgBrightness: 0, maxFRP: 0 };

  const cacheKey = `firms_fires_${iso2}`;
  const cached = cacheGet(cacheKey, 2 * 60 * 60 * 1000); // 2h cache
  if (cached) return cached;

  try {
    // FIRMS open country CSV — VIIRS sensor, 24h window
    // Format: country_id,latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight
    const url = `https://firms.modaps.eosdis.nasa.gov/api/country/csv/FIRMS_API_KEY/VIIRS_SNPP_NRT/${iso3}/1`;
    const res = await fetch(proxied(url));

    if (!res.ok) {
      // Fallback: try the open active-fire summary endpoint
      return await getFiresFromSummary(iso3);
    }

    const text = await res.text();
    const lines = text.trim().split('\n').slice(1); // skip header
    if (!lines.length || lines[0].includes('Error')) {
      return await getFiresFromSummary(iso3);
    }

    let totalFRP = 0, maxFRP = 0, totalBrightness = 0;
    for (const line of lines) {
      const cols = line.split(',');
      const frp = parseFloat(cols[12]) || 0;
      const brightness = parseFloat(cols[3]) || 0;
      totalFRP += frp;
      if (frp > maxFRP) maxFRP = frp;
      totalBrightness += brightness;
    }

    const result = {
      count: lines.length,
      avgBrightness: lines.length ? Math.round(totalBrightness / lines.length) : 0,
      maxFRP: Math.round(maxFRP),
      totalFRP: Math.round(totalFRP),
    };
    cacheSet(cacheKey, result);
    return result;
  } catch (e) {
    console.warn('FIRMS fetch failed:', e.message);
    return await getFiresFromSummary(iso3);
  }
}

/**
 * Fallback: estimate from FIRMS global summary page
 */
async function getFiresFromSummary(iso3) {
  try {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/countries/?source=VIIRS_SNPP_NRT&day_range=1`;
    const res = await fetch(proxied(url));
    if (!res.ok) return { count: 0, avgBrightness: 0, maxFRP: 0 };
    const data = await res.json();

    // data is array of { country_id, count } or object keyed by country
    let count = 0;
    if (Array.isArray(data)) {
      const entry = data.find(d => d.country_id === iso3 || d.abreviation === iso3);
      count = entry?.count || entry?.fire_count || 0;
    } else if (data[iso3]) {
      count = data[iso3]?.count || data[iso3] || 0;
    }

    return { count, avgBrightness: 0, maxFRP: 0 };
  } catch {
    return { count: 0, avgBrightness: 0, maxFRP: 0 };
  }
}
