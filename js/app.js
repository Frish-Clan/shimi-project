import { getAllCountries, buildCountryIndex } from './api/restcountries.js';
import { getAllCountryIndicator, getCountryAllGovernance, getCountryMeta } from './api/worldbank.js';
import { getGlobalConflictTimeline, getCountryConflictTimeline, getCountryHeadlines, getCountryCategoryTimeline, parseTimeline } from './api/gdelt.js';
import { getEarthquakes, parseEarthquakes } from './api/usgs.js';
import { getBootstrapData, parseCIIScores, getCountryIntel } from './api/worldmonitor-bootstrap.js';
import { getGpsJamData, filterGpsJamForCountry } from './api/gpsjam.js';
import { getAdvisories, getAdvisoryBoost } from './api/advisories.js';
import { normalize } from './utils/normalize.js';
import { initMap, loadChoropleth, addEarthquakeMarkers, renderCountryList, filterCountryList, highlightCountry } from './panels/globalSituation.js';
import { renderInstabilityPanel } from './panels/instability.js';
import { renderRiskOverview } from './panels/riskOverview.js';
import { renderDefaultCharts, renderDynamicCharts } from './panels/dynamicChart.js';
import { initCompare } from './compare.js';

const state = {
  countryIndex: null,
  pvScores: {},
  riskScores: {},
  earthquakes: [],
  selectedIso2: null,
  wbMeta: {},
  allCountries: [],
  climateAnomalies: [],
  ciiScores: {},
  bootstrapData: null,   // worldmonitor live bootstrap data
  gpsJamHexes: [],       // GPS jamming hex grid (global)
  advisories: {},        // travel advisories by ISO2
};

function setStatus(msg) {
  const el = document.getElementById('app-status');
  if (el) el.textContent = msg;
}

function computeRiskScores(countries, pvScores, earthquakes) {
  const pvValues = Object.values(pvScores).map(d => d.value).filter(v => v !== null);
  const pvMin = Math.min(...pvValues);
  const pvMax = Math.max(...pvValues);
  const pvRange = pvMax - pvMin || 1;

  const scores = {};
  for (const c of countries) {
    if (!c.cca2 || !c.cca3) continue;
    const pvData = pvScores[c.cca3];
    const pvScore = pvData ? pvData.value : 0;
    const pvRisk = normalize(pvMax - pvScore, 0, pvRange) * 0.75;
    const [lat, lng] = c.latlng || [0, 0];
    const quakes = earthquakes.filter(q => Math.abs(q.lat - lat) < 20 && Math.abs(q.lng - lng) < 20);
    const seismicRisk = Math.min(1, quakes.length / 3) * 0.25;
    scores[c.cca2] = Math.round((pvRisk + seismicRisk) * 100);
  }
  return scores;
}

export async function selectCountry(iso2) {
  if (!iso2 || !state.countryIndex) return;
  state.selectedIso2 = iso2;
  highlightCountry(iso2);

  const country = state.countryIndex.byIso2[iso2];
  if (!country) return;

  const panel2Loading = document.getElementById('panel2-loading');
  const panel4Loading = document.getElementById('panel4-loading');
  if (panel2Loading) panel2Loading.style.display = 'flex';
  if (panel4Loading) panel4Loading.style.display = 'flex';

  const countryName = country.name?.common || '';

  try {
    // Fetch WB governance + GDELT timelines in parallel
    const [govResult, timelineResult, headlinesResult, protestResult, militaryResult, naturalResult] = await Promise.allSettled([
      getCountryAllGovernance(iso2),
      getCountryConflictTimeline(countryName, '30d'),
      getCountryHeadlines(countryName, 10),
      getCountryCategoryTimeline(countryName, 'protest', '7d'),
      getCountryCategoryTimeline(countryName, 'military', '7d'),
      getCountryCategoryTimeline(countryName, 'natural', '7d'),
    ]);

    const govData         = govResult.status       === 'fulfilled' ? govResult.value                        : {};
    const timelineData    = timelineResult.status   === 'fulfilled' ? parseTimeline(timelineResult.value)    : [];
    const headlines       = headlinesResult.status  === 'fulfilled' ? (headlinesResult.value?.articles || []) : [];
    const protestTL       = protestResult.status    === 'fulfilled' ? parseTimeline(protestResult.value)     : [];
    const militaryTL      = militaryResult.status   === 'fulfilled' ? parseTimeline(militaryResult.value)    : [];
    const naturalTL       = naturalResult.status    === 'fulfilled' ? parseTimeline(naturalResult.value)     : [];
    const conflictTL7d    = timelineData.slice(-7);

    const pvScore = state.pvScores[country.cca3]?.value ?? null;

    // Get real-time intelligence from worldmonitor bootstrap data
    const wmIntel = state.bootstrapData ? getCountryIntel(state.bootstrapData, iso2, country.latlng) : null;

    // GPS jamming near this country
    const gpsJam = filterGpsJamForCountry(state.gpsJamHexes, country.latlng);

    // Travel advisory for this country
    const advisory = state.advisories[iso2] || null;
    const { boost: advisoryBoost, floor: advisoryFloor } = getAdvisoryBoost(advisory);

    renderInstabilityPanel({
      country,
      wbMeta: state.wbMeta[iso2] || {},
      pvScore,
      govData,
      timelineData,
      protestTimeline:   protestTL,
      conflictTimeline7d: conflictTL7d,
      naturalTimeline:   naturalTL,
      militaryTimeline:  militaryTL,
      headlines,
      riskScore:    state.riskScores[iso2] || 0,
      ciiScore:     state.ciiScores[iso2]  ?? null,
      earthquakes:  state.earthquakes,
      wmIntel,         // worldmonitor real-time intel (events, wildfires, UCDP, etc.)
      gpsJam,          // { highCount, mediumCount, total }
      advisory,        // { level, sources }
      advisoryBoost,   // numeric score boost
      advisoryFloor,   // minimum composite floor
    });

    renderDynamicCharts({
      country,
      govData,
      timelineData,
      earthquakes: state.earthquakes,
    });
  } catch (e) {
    console.error('Country load error:', e);
  } finally {
    if (panel2Loading) panel2Loading.style.display = 'none';
    if (panel4Loading) panel4Loading.style.display = 'none';
  }
}

async function init() {
  initMap('map');
  setStatus('Loading country registry…');

  try {
    // Phase 1: country metadata
    const [countries, wbMeta] = await Promise.all([getAllCountries(), getCountryMeta()]);
    state.allCountries = countries;
    state.countryIndex = buildCountryIndex(countries);
    state.wbMeta = wbMeta;

    setStatus('Loading stability & risk data…');

    // Phase 2: governance data + worldmonitor bootstrap + GPS jam + advisories (in parallel)
    const [pvScores, eqGeoJson, globalTimeline, bootstrapResult, gpsJamResult, advisoriesResult] = await Promise.allSettled([
      getAllCountryIndicator('PV.EST'),
      getEarthquakes(),
      getGlobalConflictTimeline('30d'),
      getBootstrapData(),
      getGpsJamData(),
      getAdvisories(),
    ]);

    state.pvScores      = pvScores.status      === 'fulfilled' ? pvScores.value      : {};
    const eqData        = eqGeoJson.status     === 'fulfilled' ? eqGeoJson.value     : null;
    state.earthquakes   = parseEarthquakes(eqData);
    state.bootstrapData = bootstrapResult.status  === 'fulfilled' ? bootstrapResult.value  : null;
    state.gpsJamHexes   = gpsJamResult.status     === 'fulfilled' ? gpsJamResult.value     : [];
    state.advisories    = advisoriesResult.status  === 'fulfilled' ? advisoriesResult.value : {};

    // CII scores from worldmonitor bootstrap (live) — overrides old static fallback
    if (state.bootstrapData) {
      const liveCII = parseCIIScores(state.bootstrapData);
      state.ciiScores = {};
      for (const [iso2, data] of Object.entries(liveCII)) {
        state.ciiScores[iso2] = data.composite;
      }
    }

    state.riskScores = computeRiskScores(countries, state.pvScores, state.earthquakes);

    setStatus('Rendering dashboard…');

    await loadChoropleth(state.countryIndex, state.pvScores, selectCountry);
    addEarthquakeMarkers(state.earthquakes);
    renderCountryList(countries, state.pvScores, state.riskScores, selectCountry);
    const countEl = document.getElementById('country-count');
    if (countEl) countEl.textContent = `${countries.length} countries`;
    renderRiskOverview(countries, state.countryIndex, state.pvScores, state.riskScores, state.earthquakes, wbMeta, state.ciiScores, state.bootstrapData?.climateAnomalies?.anomalies || [], selectCountry);

    const globalTimelineData = parseTimeline(
      globalTimeline.status === 'fulfilled' ? globalTimeline.value : null
    );
    renderDefaultCharts(globalTimelineData);

    setStatus(`Last updated: ${new Date().toLocaleTimeString()}`);

    initCompare(state.countryIndex, state.pvScores);

    document.getElementById('country-search')?.addEventListener('input', e => filterCountryList(e.target.value));
    document.getElementById('refresh-btn')?.addEventListener('click', () => { sessionStorage.clear(); location.reload(); });

  } catch (e) {
    console.error('Dashboard init failed:', e);
    setStatus('Error loading data — click Refresh to retry');
  }
}

init();
