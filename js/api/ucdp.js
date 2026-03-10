/**
 * UCDP (Uppsala Conflict Data Program) — free, no API key
 * Returns real armed conflict events (battles, explosions, violence against civilians)
 * https://ucdpapi.pcr.uu.se/api/
 */
import { cacheGet, cacheSet } from '../utils/cache.js';
import { proxied } from '../utils/proxy.js';

const BASE = 'https://ucdpapi.pcr.uu.se/api';

// ISO2 → ISO3166-1 numeric (UCDP uses numeric country codes)
const ISO2_TO_NUM = {
  AF:'004',AL:'008',DZ:'012',AO:'024',AR:'032',AM:'051',AU:'036',AT:'040',
  AZ:'031',BH:'048',BD:'050',BY:'112',BE:'056',BJ:'204',BO:'068',BA:'070',
  BW:'072',BR:'076',BN:'096',BG:'100',BF:'854',BI:'108',KH:'116',CM:'120',
  CA:'124',CF:'140',TD:'148',CL:'152',CN:'156',CO:'170',CG:'178',CD:'180',
  CR:'188',CI:'384',HR:'191',CU:'192',CY:'196',CZ:'203',DK:'208',DJ:'262',
  DO:'214',EC:'218',EG:'818',SV:'222',ER:'232',EE:'233',ET:'231',FI:'246',
  FR:'250',GA:'266',GE:'268',DE:'276',GH:'288',GR:'300',GT:'320',GN:'324',
  GW:'624',HT:'332',HN:'340',HU:'348',IN:'356',ID:'360',IR:'364',IQ:'368',
  IE:'372',IL:'376',IT:'380',JM:'388',JP:'392',JO:'400',KZ:'398',KE:'404',
  KP:'408',KR:'410',KW:'414',KG:'417',LA:'418',LV:'428',LB:'422',LS:'426',
  LR:'430',LY:'434',LT:'440',MG:'450',MW:'454',MY:'458',ML:'466',MR:'478',
  MX:'484',MD:'498',MN:'496',ME:'499',MA:'504',MZ:'508',MM:'104',NA:'516',
  NP:'524',NL:'528',NZ:'554',NI:'558',NE:'562',NG:'566',NO:'578',OM:'512',
  PK:'586',PS:'275',PA:'591',PG:'598',PY:'600',PE:'604',PH:'608',PL:'616',
  PT:'620',QA:'634',RO:'642',RU:'643',RW:'646',SA:'682',SN:'686',RS:'688',
  SL:'694',SG:'702',SK:'703',SI:'705',SO:'706',ZA:'710',SS:'728',ES:'724',
  LK:'144',SD:'729',SR:'740',SY:'760',TW:'158',TJ:'762',TZ:'834',TH:'764',
  TL:'626',TG:'768',TT:'780',TN:'788',TR:'792',TM:'795',UG:'800',UA:'804',
  AE:'784',GB:'826',US:'840',UY:'858',UZ:'860',VE:'862',VN:'704',YE:'887',
  ZM:'894',ZW:'716',
};

/**
 * Fetch conflict events for a country from UCDP GED (Georeferenced Event Dataset)
 * Returns recent events (current + previous year)
 */
export async function getConflictEvents(iso2) {
  const num = ISO2_TO_NUM[iso2];
  if (!num) return { events: [], count: 0, deaths: 0 };

  const year = new Date().getFullYear();
  const cacheKey = `ucdp_events_${iso2}_${year}`;
  const cached = cacheGet(cacheKey, 4 * 60 * 60 * 1000); // 4h cache
  if (cached) return cached;

  try {
    // Fetch current year + previous year events
    const url = `${BASE}/gedevents/24.1.1?country=${num}&year=${year},${year - 1}&pagesize=100`;
    const res = await fetch(proxied(url));
    if (!res.ok) throw new Error(`UCDP ${res.status}`);
    const data = await res.json();

    const events = (data.Result || []).map(e => ({
      id:        e.id,
      date:      e.date_start,
      type:      e.type_of_violence,   // 1=state-based, 2=non-state, 3=one-sided
      deaths:    (e.best || 0),
      lat:       e.latitude,
      lng:       e.longitude,
      source:    e.source_article,
      side_a:    e.side_a,
      side_b:    e.side_b,
    }));

    const result = {
      events,
      count:  events.length,
      deaths: events.reduce((s, e) => s + e.deaths, 0),
      battleEvents: events.filter(e => e.type === 1).length,
      nonStateEvents: events.filter(e => e.type === 2).length,
      oneSidedEvents: events.filter(e => e.type === 3).length,
    };

    cacheSet(cacheKey, result);
    return result;
  } catch (e) {
    console.warn('UCDP fetch failed:', e.message);
    return { events: [], count: 0, deaths: 0, battleEvents: 0, nonStateEvents: 0, oneSidedEvents: 0 };
  }
}
