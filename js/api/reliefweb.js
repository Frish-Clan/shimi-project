/**
 * ReliefWeb API — free, no API key required
 * Returns humanitarian crisis reports, displacement data, disaster alerts
 * https://api.reliefweb.int/v1/
 */
import { cacheGet, cacheSet } from '../utils/cache.js';

const BASE = 'https://api.reliefweb.int/v1';

// ISO2 → ISO3 mapping for ReliefWeb country filter
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
 * Fetch recent crisis reports for a country
 */
export async function getCrisisReports(iso2, limit = 10) {
  const iso3 = ISO2_TO_ISO3[iso2];
  if (!iso3) return { reports: [], count: 0 };

  const cacheKey = `reliefweb_reports_${iso2}`;
  const cached = cacheGet(cacheKey, 2 * 60 * 60 * 1000); // 2h cache
  if (cached) return cached;

  try {
    const url = `${BASE}/reports?appname=shimi-dashboard&filter[field]=country.iso3&filter[value]=${iso3}&limit=${limit}&sort[]=date:desc&fields[include][]=title&fields[include][]=date.created&fields[include][]=source.name&fields[include][]=url&fields[include][]=disaster_type.name`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ReliefWeb ${res.status}`);
    const data = await res.json();

    const reports = (data.data || []).map(r => ({
      title:   r.fields?.title || '',
      date:    r.fields?.date?.created || '',
      source:  r.fields?.source?.[0]?.name || 'ReliefWeb',
      url:     r.fields?.url || '',
      types:   (r.fields?.disaster_type || []).map(t => t.name),
    }));

    const result = { reports, count: data.totalCount || reports.length };
    cacheSet(cacheKey, result);
    return result;
  } catch (e) {
    console.warn('ReliefWeb fetch failed:', e.message);
    return { reports: [], count: 0 };
  }
}

/**
 * Fetch active disasters for a country
 */
export async function getActiveDisasters(iso2) {
  const iso3 = ISO2_TO_ISO3[iso2];
  if (!iso3) return { disasters: [], count: 0 };

  const cacheKey = `reliefweb_disasters_${iso2}`;
  const cached = cacheGet(cacheKey, 2 * 60 * 60 * 1000);
  if (cached) return cached;

  try {
    const url = `${BASE}/disasters?appname=shimi-dashboard&filter[field]=country.iso3&filter[value]=${iso3}&filter[field]=status&filter[value]=current&limit=10&sort[]=date:desc&fields[include][]=name&fields[include][]=date.created&fields[include][]=type.name&fields[include][]=glide&fields[include][]=status`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ReliefWeb disasters ${res.status}`);
    const data = await res.json();

    const disasters = (data.data || []).map(d => ({
      name:   d.fields?.name || '',
      date:   d.fields?.date?.created || '',
      type:   (d.fields?.type || []).map(t => t.name).join(', '),
      glide:  d.fields?.glide || '',
      status: d.fields?.status || '',
    }));

    const result = { disasters, count: data.totalCount || disasters.length };
    cacheSet(cacheKey, result);
    return result;
  } catch (e) {
    console.warn('ReliefWeb disasters fetch failed:', e.message);
    return { disasters: [], count: 0 };
  }
}
