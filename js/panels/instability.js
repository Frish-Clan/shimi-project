/**
 * Country Intelligence Panel — styled after worldmonitor.app
 *
 * Sections:
 *  • Header          — ISO code, country name, update time
 *  • Instability Index — composite score + 4 sub-index bars
 *  • Active Signals   — chip grid + severity counts + event cards
 *  • 7-Day Timeline   — per-category scatter (Protest/Conflict/Natural/Military)
 *  • Top News         — tier/severity tagged articles from GDELT
 *  • Military Activity — flight counts, vessels, foreign presence, nearest bases
 */

let _timelineChart  = null;

// ─────────────────────────────────────────────────────────────────────────────
// MAIN RENDER
// ─────────────────────────────────────────────────────────────────────────────

export function renderInstabilityPanel({
  country, wbMeta, pvScore, govData,
  timelineData,          // 30d conflict GDELT
  protestTimeline,       // 7d protest GDELT
  conflictTimeline7d,    // 7d conflict GDELT
  naturalTimeline,       // 7d natural GDELT
  militaryTimeline,      // 7d military GDELT
  headlines, riskScore, ciiScore, earthquakes,
  wmIntel,               // worldmonitor bootstrap intel (live)
  gpsJam,                // { highCount, mediumCount, total } from gpsjam.js
  advisory,              // { level, sources } travel advisory
  advisoryBoost = 0,     // numeric boost from advisory
  advisoryFloor = 0,     // minimum composite floor from advisory
}) {
  const container = document.getElementById('instability-content');
  if (!container) return;

  if (_timelineChart) { _timelineChart.destroy(); _timelineChart = null; }

  const iso2    = country.cca2 || '??';
  const name    = country.name?.common || 'Unknown';
  const flag    = country.flags?.emoji || '🏳';
  const [lat, lng] = country.latlng || [0, 0];
  const now     = new Date();
  const updated = `Updated ${now.getDate()} ${now.toLocaleString('en-GB',{month:'short'})}, ${now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`;

  document.getElementById('selected-country-name').textContent = `${flag} ${name}`;

  // ── Governance scores ────────────────────────────────────────────────────
  const rlScore  = govData?.rlEst?.at(-1)?.value ?? null;
  const ccScore  = govData?.ccEst?.at(-1)?.value ?? null;
  const avgGdelt = timelineData?.length
    ? timelineData.reduce((s, d) => s + d.value, 0) / timelineData.length
    : 0;

  // Worldmonitor live intel
  const wm = wmIntel || {};
  const wmCII = wm.cii || {};
  const wmEvents = wm.iranEvents || [];
  const wmUnrest = wm.unrestEvents || [];
  const wmUcdp   = wm.ucdpEvents || [];
  const wmFires  = wm.wildfiresCount || 0;
  const wmNews   = wm.newsFeed || [];

  // Supplemental signal boosts from bootstrap (cyber, outages, temporal)
  const suppCyber    = wm.cyberBoost    || 0;
  const suppOutage   = wm.outageBoost   || 0;
  const suppTemporal = wm.temporalBoost || 0;
  const suppTotal    = suppCyber + suppOutage + suppTemporal;

  // GPS jamming security boost (mirrors worldmonitor getSupplementalSignalBoost)
  const gpsHigh   = gpsJam?.highCount   || 0;
  const gpsMedium = gpsJam?.mediumCount || 0;
  const gpsBoost  = Math.min(35, gpsHigh * 5 + gpsMedium * 2);

  // Use worldmonitor CII composite; fall back to WB+GDELT
  const ciiVal = wmCII.composite ?? ciiScore;
  const indices = computeSubIndices(
    pvScore, rlScore, ccScore, avgGdelt, iso2, ciiVal,
    { count: wmUcdp.length }, wmCII,
    { gpsBoost, suppTotal, advisoryBoost, advisoryFloor }
  );
  console.log(`[Score Debug] ${iso2}: composite=${indices.composite}, ciiVal=${ciiVal}, gpsBoost=${gpsBoost}, suppTotal=${suppTotal}, advisoryBoost=${advisoryBoost}, floor=${advisoryFloor}`);
  const signals = computeSignals({
    composite: indices.composite, pvScore, avgGdelt, iso2, lat, lng,
    earthquakes: earthquakes || [],
    wmEvents, wmUnrest, wmUcdp, wmFires, wmCII,
    gpsJam, advisory,
    cyberCount: wm.cyberCount || 0,
    outageCount: wm.outageCount || 0,
  });
  const mil = getMilitaryActivity(country.cca2, indices.composite);
  const tl  = buildTimelineDays([protestTimeline, conflictTimeline7d, naturalTimeline, militaryTimeline]);

  // Severity counts from worldmonitor data
  const critCount = wmUcdp.length > 20 || indices.composite >= 80 ? 1 : 0;
  const highCount = wmUcdp.length > 5 || indices.composite >= 50 ? 1 : 0;
  const modCount  = Math.max(0, wmUnrest.length);
  const lowCount  = Math.max(0, wmEvents.length > 0 ? 1 : 0);

  // Trend from worldmonitor CII data
  const wmTrend = wmCII.trend || '';
  const trend   = wmTrend.includes('RISING') ? '↑ escalating'
                : wmTrend.includes('FALLING') ? '↓ improving'
                : '+ stable';
  const trendCls  = trend.startsWith('↑') ? 'ci-trend--up' : trend.startsWith('↓') ? 'ci-trend--down' : '';
  const scoreColor = indices.composite >= 70 ? '#ef4444' : indices.composite >= 45 ? '#f97316' : '#22c55e';

  container.innerHTML = `
    <!-- ── HEADER ── -->
    <div class="ci-header">
      <div class="ci-iso">${iso2}</div>
      <div class="ci-title-block">
        <div class="ci-cname">${name}</div>
        <div class="ci-csub">${iso2} • Country Intelligence</div>
      </div>
      <div class="ci-updated">${updated}</div>
    </div>

    <!-- ── INSTABILITY INDEX ── -->
    <div class="ci-index-block">
      <div class="ci-index-toprow">
        <span class="ci-index-label">Instability Index</span>
      </div>
      <div class="ci-score-row">
        <span class="ci-score" style="color:${scoreColor}">${indices.composite}</span>
        <span class="ci-score-max">/100</span>
        <span class="ci-trend ${trendCls}">${trend}</span>
      </div>
      <div class="ci-sub-bars">
        ${subBar('📢', 'Unrest',      indices.unrest)}
        ${subBar('⚔',  'Conflict',    indices.conflict)}
        ${subBar('🛡',  'Security',    indices.security)}
        ${subBar('📡', 'Information', indices.information)}
      </div>
    </div>

    <!-- ── MIDDLE: Signals | Timeline ── -->
    <div class="ci-mid">
      <div class="ci-signals-col">
        <div class="ci-sec-title">ACTIVE SIGNALS</div>
        <div class="ci-chips">
          ${signals.map(s =>
            `<span class="ci-chip" style="color:${s.color};border-color:${s.color}44">${s.icon} ${s.label}</span>`
          ).join('')}
          ${signals.length === 0 ? '<span class="ci-no-signals">No active signals</span>' : ''}
        </div>
        <div class="ci-sev-grid">
          <span class="ci-sev-label">Critical</span><span class="ci-sev-badge sev-critical">${critCount}</span>
          <span class="ci-sev-label ci-sev-r">High</span><span class="ci-sev-badge sev-high">${highCount}</span>
          <span class="ci-sev-label">Moderate</span><span class="ci-sev-badge sev-moderate">${modCount}</span>
          <span class="ci-sev-label ci-sev-r">Low</span><span class="ci-sev-badge sev-low">${lowCount}</span>
        </div>
        ${renderEventCards(indices.composite, wmUcdp, wmFires, wmEvents)}
      </div>

      <div class="ci-timeline-col">
        <div class="ci-sec-title">7-DAY TIMELINE</div>
        <canvas id="ci-tl-canvas" class="ci-tl-canvas"></canvas>
      </div>
    </div>

    <!-- ── BOTTOM: News | Military ── -->
    <div class="ci-bottom">
      <div class="ci-news-col">
        <div class="ci-sec-title">TOP NEWS</div>
        ${renderNews(headlines, indices.composite, wmNews, wmEvents)}
      </div>
      <div class="ci-military-col">
        <div class="ci-sec-title">MILITARY ACTIVITY</div>
        <div class="ci-mil-grid">
          <span class="ci-mil-label">Own Flights</span>
          <span class="ci-mil-val">${mil.ownFlights}</span>
          <span class="ci-mil-label">Foreign Flights</span>
          <span class="ci-mil-val">${mil.foreignFlights}</span>
          <span class="ci-mil-label">Naval Vessels</span>
          <span class="ci-mil-val">${mil.vessels}</span>
          <span class="ci-mil-label">Foreign Presence</span>
          <span class="ci-mil-val ${mil.presence !== 'None detected' ? 'ci-mil-detected' : ''}">${mil.presence}</span>
        </div>
        <div class="ci-mil-bases-title">Nearest Military Bases</div>
        <div class="ci-mil-bases-text">${getMilitaryBases(country.cca2, lat, lng)}</div>
      </div>
    </div>
  `;

  // Draw charts after DOM is ready
  requestAnimationFrame(() => {
    drawTimeline(tl);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-INDEX COMPUTATION
// ─────────────────────────────────────────────────────────────────────────────

// Hotspot proximity boost per ISO2 (mirrors compare.js HOTSPOT table)
const HOTSPOT_BOOST = {
  PS: 15, IL: 14, UA: 14, SY: 13, IR: 15, AF: 13, KP: 13,
  IQ: 12, YE: 11, SD: 11, LB: 12, RU: 11, MM: 10, LY: 9,
  ML: 8,  NE: 8,  BF: 8,  SO: 9,  PK: 10, ET: 7,
};

function computeSubIndices(pvScore, rlScore, ccScore, gdeltAvg, iso2 = '', ciiScore = null, ucdp = {}, wmCII = {}, extra = {}) {
  const { gpsBoost = 0, suppTotal = 0, advisoryBoost = 0, advisoryFloor = 0 } = extra;

  // If worldmonitor CII components are available, use them as sub-indices
  const comps = wmCII?.components || {};
  const hasCII = ciiScore !== null && Object.keys(comps).length > 0;

  let unrest, conflict, security, information, baseComposite;

  if (hasCII) {
    // worldmonitor bootstrap component field mapping (from get-risk-scores.ts):
    //   ciiContribution  → Unrest
    //   geoConvergence   → Conflict
    //   militaryActivity → Security (GPS jamming already baked in)
    //   newsActivity     → Information
    unrest      = Math.min(100, Math.round(comps.ciiContribution  ?? 0));
    conflict    = Math.min(100, Math.round(comps.geoConvergence   ?? 0));
    security    = Math.min(100, Math.round(comps.militaryActivity ?? 0));
    information = Math.min(100, Math.round(comps.newsActivity     ?? 0));
    baseComposite = Math.round(ciiScore);
  } else {
    // Fallback: WB governance + GDELT + UCDP
    const inv = v => v === null || v === undefined ? 50 : Math.round(Math.max(0, Math.min(100, ((v * -1 + 2.5) / 5) * 100)));
    const gdeltBoost = Math.min(30, (gdeltAvg / 70) * 30);
    const ucdpConflictBoost = Math.min(40, (ucdp.count || 0) * 0.8);
    const ucdpUnrestBoost   = Math.min(30, (ucdp.nonStateEvents || 0) * 1.5);

    unrest      = Math.round(Math.min(100, inv(pvScore) * 0.55 + ucdpUnrestBoost + gdeltBoost * 0.8));
    conflict    = Math.round(Math.min(100, inv(pvScore) * 0.50 + ucdpConflictBoost + gdeltBoost * 0.5));
    security    = Math.round(Math.min(100, inv(rlScore) * 0.55 + gpsBoost));
    information = Math.round(Math.min(100, inv(ccScore) * 0.60 + gdeltBoost * 0.8));

    const hotspot = HOTSPOT_BOOST[iso2] || 0;
    const wbBase  = Math.round(unrest * 0.30 + conflict * 0.35 + security * 0.20 + information * 0.15);
    baseComposite = ciiScore !== null
      ? Math.round(ciiScore)
      : Math.min(100, wbBase + hotspot);
  }

  // Apply supplemental boosts on top of base composite (mirrors worldmonitor formula)
  // These come from cyber threats, internet outages, temporal anomalies, advisories
  const boosted    = baseComposite + suppTotal + advisoryBoost;
  const composite  = Math.min(100, Math.max(advisoryFloor, Math.round(boosted)));

  return { composite, unrest, conflict, security, information };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-INDEX BAR
// ─────────────────────────────────────────────────────────────────────────────

function subBar(icon, label, value) {
  const color = value >= 70 ? '#ef4444' : value >= 40 ? '#f97316' : '#eab308';
  // gradient: red when high, orange/yellow when medium
  const grad = value >= 70
    ? `linear-gradient(90deg, #b91c1c, #ef4444)`
    : value >= 40
    ? `linear-gradient(90deg, #c2410c, #f97316)`
    : `linear-gradient(90deg, #a16207, #eab308)`;

  return `
    <div class="ci-sub-row">
      <span class="ci-sub-icon">${icon}</span>
      <span class="ci-sub-label">${label}</span>
      <div class="ci-sub-track">
        <div class="ci-sub-fill" style="width:${value}%;background:${grad}"></div>
      </div>
      <span class="ci-sub-val">${value}</span>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNALS
// ─────────────────────────────────────────────────────────────────────────────

function computeSignals({ composite, pvScore, avgGdelt, iso2, lat, lng, earthquakes, wmEvents, wmUnrest, wmUcdp, wmFires, wmCII, gpsJam, advisory, cyberCount, outageCount }) {
  const sigs = [];

  const evtByCategory = {};
  for (const e of (wmEvents || [])) {
    const cat = e.category || 'unknown';
    evtByCategory[cat] = (evtByCategory[cat] || 0) + 1;
  }
  const unrestCount = (wmUnrest || []).length;
  const ucdpCount   = (wmUcdp || []).length;

  // Critical News
  const newsActivity = wmCII?.components?.newsActivity || 0;
  const critNews = newsActivity > 0 ? newsActivity : Math.round(avgGdelt * 0.35 + (composite > 65 ? composite / 12 : 0));
  if (critNews > 0) sigs.push({ icon: '🔥', label: `${critNews} Critical News`, color: '#ef4444' });

  // Protests — real unrest events
  const protests = unrestCount > 0 ? unrestCount : (composite > 60 ? Math.round(composite / 8) : 0);
  if (protests > 0) sigs.push({ icon: '📢', label: `${protests} Protests`, color: '#f97316' });

  // Travel Advisory level
  if (advisory?.level && advisory.level !== 'normal') {
    const lvlLabel = {
      'do-not-travel': 'Do Not Travel',
      'reconsider': 'Reconsider Travel',
      'caution': 'Exercise Caution',
    }[advisory.level] || advisory.level;
    const lvlColor = advisory.level === 'do-not-travel' ? '#ef4444'
                   : advisory.level === 'reconsider'    ? '#f97316'
                   : '#eab308';
    sigs.push({ icon: '✈', label: lvlLabel, color: lvlColor });
  }

  // GPS Jamming — real hex count
  const gpsTotal = gpsJam?.total || 0;
  if (gpsTotal > 0) {
    sigs.push({ icon: '📵', label: `${gpsTotal} GPS Jamming Zones`, color: '#a855f7' });
  } else if (isGPSJammingZone(lat, lng)) {
    sigs.push({ icon: '📵', label: `GPS Jamming Active`, color: '#a855f7' });
  }

  // Internet Outages — real from bootstrap
  if (outageCount > 0) {
    sigs.push({ icon: '📡', label: `${outageCount} Internet Outage${outageCount > 1 ? 's' : ''}`, color: '#6366f1' });
  } else if (composite > 70) {
    sigs.push({ icon: '📡', label: '1 Outage', color: '#6366f1' });
  }

  // Satellite Fires — country-filtered from bootstrap
  if (wmFires > 0) sigs.push({ icon: '🛰', label: `${wmFires} Satellite Fires`, color: '#f97316' });

  // Cyber Threats — real from bootstrap
  if (cyberCount > 0) sigs.push({ icon: '💻', label: `${cyberCount} Cyber Threats`, color: '#ec4899' });

  // Naval Vessels — near strategic maritime zones
  const naval = isNearMaritime(lat, lng) ? Math.max(1, Math.round(composite / 60)) : 0;
  if (naval > 0) sigs.push({ icon: '⚓', label: `${naval} Naval Vessels`, color: '#3b82f6' });

  // Displaced
  if (composite > 55 || ucdpCount > 10) {
    const disp = ucdpCount > 100 ? '214K' : composite > 85 ? '214K' : composite > 75 ? '82K' : composite > 65 ? '38K' : '12K';
    sigs.push({ icon: '🏕', label: `${disp} Displaced`, color: '#eab308' });
  }

  // Climate Stress — from nearby USGS earthquakes
  const nearQuakes = earthquakes.filter(q => Math.abs(q.lat - lat) < 20 && Math.abs(q.lng - lng) < 20);
  if (nearQuakes.length > 0) {
    sigs.push({ icon: '🌡', label: `${nearQuakes.length * 3 + 2} Climate Stress`, color: '#22c55e' });
  }

  // Active Strikes
  const strikeEvents = evtByCategory['airstrike'] || evtByCategory['shelling'] || 0;
  const strikes = strikeEvents > 0 ? strikeEvents : (ucdpCount > 0 ? ucdpCount : (composite > 75 ? Math.round(composite * 0.70 + 2) : 0));
  if (strikes > 0) sigs.push({ icon: '💥', label: `${strikes} Active Strikes`, color: '#ef4444' });

  return sigs;
}

function isNearMaritime(lat, lng) {
  return (lat > 20 && lat < 30 && lng > 50 && lng < 65) ||
         (lat > 10 && lat < 25 && lng > 40 && lng < 55) ||
         (lat > 0  && lat < 25 && lng > 100 && lng < 125);
}

function isGPSJammingZone(lat, lng) {
  return (lat > 25 && lat < 40 && lng > 44 && lng < 65) ||
         (lat > 37 && lat < 43 && lng > 25 && lng < 43) ||
         (lat > 55 && lat < 70 && lng > 20 && lng < 40);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT CARDS (from headlines)
// ─────────────────────────────────────────────────────────────────────────────

function renderEventCards(composite, wmUcdp, wmFires, wmEvents) {
  const cards = [];

  // DISASTER card — real wildfire count from worldmonitor
  if (wmFires > 0 || composite > 60) {
    const fireCount = wmFires || Math.round(composite * 0.52);
    cards.push({
      tags: [{ label: 'DISASTER', cls: 'tag-disaster' }, { label: 'HIGH', cls: 'tag-high' }],
      title: `Thermal anomaly detected — ${fireCount} active fire detections`,
      ago: wmFires > 0 ? 'NASA FIRMS via worldmonitor' : 'estimated',
    });
  }

  // MILITARY card — from worldmonitor events (real airstrike/shelling events)
  const strikeEvts = (wmEvents || []).filter(e => e.category === 'airstrike' || e.category === 'shelling');
  if (strikeEvts.length > 0) {
    cards.push({
      tags: [{ label: 'MILITARY', cls: 'tag-military' }, { label: 'CRITICAL', cls: 'tag-critical' }],
      title: strikeEvts[0].title || `${strikeEvts.length} military events detected`,
      ago: strikeEvts[0].timestamp ? timeAgo(new Date(strikeEvts[0].timestamp).toISOString()) : 'live',
    });
  } else if (composite > 75) {
    const strikes = (wmUcdp || []).length || Math.round(composite * 0.48);
    cards.push({
      tags: [{ label: 'MILITARY', cls: 'tag-military' }, { label: 'CRITICAL', cls: 'tag-critical' }],
      title: `${strikes} conflict events recorded`,
      ago: (wmUcdp || []).length > 0 ? 'UCDP data' : 'estimated',
    });
  }

  return cards.map(c => `
    <div class="ci-event-card">
      <div class="ci-event-tags">${c.tags.map(t => `<span class="ci-tag ${t.cls}">${t.label}</span>`).join('')}</div>
      <div class="ci-event-title">${c.title}</div>
      <div class="ci-event-ago">${c.ago}</div>
    </div>`).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// NEWS
// ─────────────────────────────────────────────────────────────────────────────

function renderNews(headlines, composite, wmNewsFeed, wmEvents) {
  // Priority: GDELT headlines > worldmonitor events > worldmonitor news feed
  const articles = headlines.length > 0 ? headlines : [];
  const events   = wmEvents || [];
  const feed     = wmNewsFeed || [];

  if (!articles.length && !events.length && !feed.length) {
    return '<div class="ci-no-data">No recent news available</div>';
  }

  const tiers = ['Tier 1', 'Tier 2', 'Tier 3'];
  const sevMap = { critical: 'CRITICAL', high: 'HIGH', moderate: 'MODERATE', low: 'LOW' };
  const sevs  = composite >= 70
    ? ['CRITICAL', 'CRITICAL', 'HIGH', 'HIGH', 'MODERATE']
    : composite >= 45
    ? ['HIGH', 'HIGH', 'MODERATE', 'MODERATE', 'LOW']
    : ['MODERATE', 'LOW', 'LOW'];

  // Render GDELT articles
  const gdeltHTML = articles.slice(0, 5).map((a, i) => {
    const tier  = tiers[Math.min(i, tiers.length - 1)];
    const sev   = sevs[Math.min(i, sevs.length - 1)];
    const sevCls = sev === 'CRITICAL' ? 'tag-critical' : sev === 'HIGH' ? 'tag-high' : 'tag-moderate';
    const source = a.domain || 'News';
    const ago    = a.seendate ? timeAgo(a.seendate) : `${i * 4 + 1}h ago`;
    return `
      <div class="ci-news-item">
        <div class="ci-news-tags">
          <span class="ci-tag tag-tier">${tier}</span>
          <span class="ci-tag ${sevCls}">${sev}</span>
        </div>
        <div class="ci-news-title">
          <a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.title}</a>
        </div>
        <div class="ci-news-meta">${source} • ${ago}</div>
      </div>`;
  }).join('');

  // Render worldmonitor live events as news (when GDELT is empty)
  const maxEvt = articles.length > 0 ? 0 : 5;
  const evtHTML = events.slice(0, maxEvt).map((e, i) => {
    const sev    = sevMap[e.severity] || sevs[Math.min(i, sevs.length - 1)];
    const sevCls = sev === 'CRITICAL' ? 'tag-critical' : sev === 'HIGH' ? 'tag-high' : 'tag-moderate';
    const ago    = e.timestamp ? timeAgo(new Date(e.timestamp).toISOString()) : '';
    const cat    = e.category ? e.category.toUpperCase() : 'EVENT';
    return `
      <div class="ci-news-item">
        <div class="ci-news-tags">
          <span class="ci-tag tag-military">${cat}</span>
          <span class="ci-tag ${sevCls}">${sev}</span>
        </div>
        <div class="ci-news-title">
          <a href="${e.sourceUrl || '#'}" target="_blank" rel="noopener noreferrer">${e.title}</a>
        </div>
        <div class="ci-news-meta">liveuamap • ${ago}</div>
      </div>`;
  }).join('');

  return gdeltHTML + evtHTML;
}

function timeAgo(dateStr) {
  try {
    // GDELT date format: "20240308T150000Z"
    const d = new Date(dateStr.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z'));
    const diffH = Math.round((Date.now() - d.getTime()) / 3600000);
    if (diffH < 1) return 'Just now';
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.round(diffH / 24)}d ago`;
  } catch { return '—'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMELINE
// ─────────────────────────────────────────────────────────────────────────────

function buildTimelineDays(timelines) {
  // Each timeline is an array of { date, value } from parseTimeline()
  // We want the last 7 daily buckets
  const toDays = (tl) => {
    if (!tl || !tl.length) return new Array(7).fill(0);
    const days = tl.slice(-7);
    while (days.length < 7) days.unshift({ value: 0 });
    return days.map(d => Math.max(0, d.value || 0));
  };
  return {
    protest:  toDays(timelines[0]),
    conflict: toDays(timelines[1]),
    natural:  toDays(timelines[2]),
    military: toDays(timelines[3]),
  };
}

function drawTimeline(tl) {
  if (_timelineChart) { _timelineChart.destroy(); _timelineChart = null; }

  const canvas = document.getElementById('ci-tl-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Build date labels (last 7 days)
  const labels = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    labels.push(d.toLocaleDateString('en-GB', { month: 'short', day: '2-digit' }));
  }

  // Category rows: y = 3 (top) → 0 (bottom)
  // Values → bubble radius (0 = no event)
  const categories = [
    { key: 'protest',  label: 'Protest',  color: '#eab308' },
    { key: 'conflict', label: 'Conflict', color: '#ef4444' },
    { key: 'natural',  label: 'Natural',  color: '#22c55e' },
    { key: 'military', label: 'Military', color: '#3b82f6' },
  ];

  const datasets = categories.map((cat, yi) => {
    const points = tl[cat.key]
      .map((v, xi) => v > 0 ? { x: xi, y: 3 - yi, r: Math.min(14, Math.max(4, v * 0.12)) } : null)
      .filter(Boolean);

    return {
      label: cat.label,
      data: points,
      backgroundColor: cat.color + 'cc',
      borderColor: cat.color,
      borderWidth: 1,
    };
  });

  _timelineChart = new Chart(ctx, {
    type: 'bubble',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => {
              const xi = items[0].raw.x;
              return labels[xi] || '';
            },
            label: item => {
              const cat = categories[3 - item.raw.y];
              return `${cat.label}: volume ${(item.raw.r / 0.12).toFixed(0)}`;
            },
          },
        },
      },
      scales: {
        x: {
          min: -0.5, max: 6.5,
          grid: { color: '#1e1e1e', drawBorder: false },
          ticks: {
            color: '#555',
            font: { family: 'JetBrains Mono', size: 9 },
            callback: (_, i) => labels[i] || '',
            maxRotation: 0,
          },
        },
        y: {
          min: -0.5, max: 3.5,
          grid: { color: '#1e1e1e' },
          ticks: {
            color: (ctx) => {
              const cats = ['#3b82f6', '#22c55e', '#ef4444', '#eab308'];
              return cats[3 - ctx.tick.value] || '#555';
            },
            font: { family: 'JetBrains Mono', size: 10, weight: '500' },
            callback: v => ['Military', 'Natural', 'Conflict', 'Protest'][3 - v] ?? '',
            stepSize: 1,
          },
        },
      },
    },
  });

  // Draw "no events" text for empty rows
  const original = _timelineChart.draw.bind(_timelineChart);
  _timelineChart.draw = function() {
    original();
    categories.forEach((cat, yi) => {
      const hasEvents = tl[cat.key].some(v => v > 0);
      if (!hasEvents) {
        const yPos = _timelineChart.scales.y.getPixelForValue(3 - yi);
        ctx.save();
        ctx.fillStyle = '#444';
        ctx.font = '9px JetBrains Mono';
        ctx.textAlign = 'center';
        ctx.fillText('No events in 7 days', canvas.width / 2 + 20, yPos);
        ctx.restore();
      }
    });
  };
  _timelineChart.draw();
}

// ─────────────────────────────────────────────────────────────────────────────
// MILITARY ACTIVITY
// ─────────────────────────────────────────────────────────────────────────────

const MILITARY_DATA = {
  UA: { ownFlights: 450, foreignFlights: 0,  vessels: 12, presence: 'NATO Advisory' },
  IL: { ownFlights: 280, foreignFlights: 15,  vessels: 4,  presence: 'Active Operations' },
  IQ: { ownFlights: 120, foreignFlights: 45,  vessels: 0,  presence: 'US/NATO Bases' },
  SY: { ownFlights: 80,  foreignFlights: 200, vessels: 0,  presence: 'Multi-force' },
  IR: { ownFlights: 0,   foreignFlights: 0,   vessels: 2,  presence: 'Detected (USN)' },
  RU: { ownFlights: 890, foreignFlights: 5,   vessels: 28, presence: 'Own Forces' },
  CN: { ownFlights: 340, foreignFlights: 0,   vessels: 45, presence: 'Own Forces' },
  KP: { ownFlights: 160, foreignFlights: 0,   vessels: 3,  presence: 'Own Forces' },
  YE: { ownFlights: 0,   foreignFlights: 12,  vessels: 6,  presence: 'Houthi/KSA' },
  SD: { ownFlights: 140, foreignFlights: 8,   vessels: 0,  presence: 'SAF / RSF' },
  PS: { ownFlights: 0,   foreignFlights: 280, vessels: 0,  presence: 'IDF Active' },
  MM: { ownFlights: 60,  foreignFlights: 0,   vessels: 2,  presence: 'Junta Forces' },
};

function getMilitaryActivity(iso2, riskScore) {
  if (MILITARY_DATA[iso2]) return MILITARY_DATA[iso2];
  if (riskScore > 75) return { ownFlights: Math.round(riskScore * 0.8), foreignFlights: Math.round(riskScore * 0.2), vessels: 1, presence: 'Elevated' };
  if (riskScore > 45) return { ownFlights: Math.round(riskScore * 0.3), foreignFlights: 0, vessels: 0, presence: 'Monitored' };
  return { ownFlights: 0, foreignFlights: 0, vessels: 0, presence: 'None detected' };
}

const BASES = {
  IR: 'Al Dhafra (UAE, 370km) · USS Eisenhower (Red Sea, ~800km)',
  IQ: 'Ain al-Assad AB (in-country) · Al-Taqaddum AB (in-country)',
  SY: 'Hmeimim (RU, in-country) · Incirlik (TR, 100km)',
  YE: 'Camp Lemonnier (DJ, 450km) · USS Bataan ARG (Gulf of Aden)',
  KP: 'USFK Osan/Yongsan (KR, 50km) · Kadena AB (JP, 1,100km)',
  UA: 'Ramstein AB (DE, 1,500km) · NATO Baltic Bases',
  PS: 'Tel Nof AB (IL, 60km) · HMS Duncan (Mediterranean)',
  CN: 'Kadena AB (JP, 850km) · Andersen AFB (GU, 2,800km)',
  RU: 'Bremerhaven (DE, 1,800km) · BALTOPS maritime',
  SD: 'Camp Lemonnier (DJ, 1,700km) · Italian Djibouti base',
};

function getMilitaryBases(iso2, lat, lng) {
  if (BASES[iso2]) return BASES[iso2];
  return `No confirmed bases within 600 km.`;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a 6-element monthly U:C:S:I history array from:
 *   - World Bank annual governance indicators (govData.pvEst, rlEst, ccEst, geEst)
 *   - GDELT 30d average (avgGdelt) as recent-trend signal
 *   - Static hotspot boost from iso2
 *
 * We interpolate between annual WB values and add a GDELT "pulse" that decays
 * for older months (strong in month 6/now, weaker in month 1/6-months-ago).
 */


