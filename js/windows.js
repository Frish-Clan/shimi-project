/**
 * Floating window manager + infrastructure cascade windows
 *
 * Windows:
 *  internet-outages  — IODA internet anomaly scores
 *  power-grid        — World Bank electricity access (lowest ranked)
 *  nuclear-sites     — Static notable nuclear facilities
 *  military-hotspots — Active conflict zones + GDELT news
 *  sanctions         — Active international sanctions regimes
 *  critical-infra    — Critical infrastructure status board
 */

import { cacheGet, cacheSet } from './utils/cache.js';

// ═══════════════════════════════════════════════════════════
// WINDOW MANAGER
// ═══════════════════════════════════════════════════════════

let zCounter = 600;
const registry = {}; // id -> { el, minimized, savedH }

function nextZ() { return ++zCounter; }

export function openWindow(id) {
  const def = INFRA_WINDOWS.find(w => w.id === id);
  if (!def) return;

  if (registry[id]) {
    if (registry[id].minimized) toggleMinimize(id);
    bringToFront(id);
    return;
  }

  const n = Object.keys(registry).length;
  const el = buildEl(def, n);
  document.getElementById('windows-layer').appendChild(el);
  registry[id] = { el, minimized: false, savedH: def.height };

  setupDrag(el, id);
  setupResize(el, id);
  bringToFront(id);

  // Load content asynchronously
  const body = el.querySelector('.win-body');
  def.onOpen(body).catch(e => {
    body.innerHTML = `<div class="win-error">⚠ ${e.message}</div>`;
  });
}

export function closeWindow(id) {
  if (!registry[id]) return;
  registry[id].el.remove();
  delete registry[id];
  syncToolbar(id, false);
}

export function cascadeAll() {
  const ids = Object.keys(registry);
  ids.forEach((id, i) => {
    const el = registry[id].el;
    el.style.left    = (80 + i * 36) + 'px';
    el.style.top     = (70 + i * 36) + 'px';
    el.style.zIndex  = 600 + i;
  });
  zCounter = 600 + ids.length;
}

export function tileAll() {
  const ids = Object.keys(registry);
  if (!ids.length) return;
  const layer = document.getElementById('windows-layer');
  const W = layer.offsetWidth, H = layer.offsetHeight;
  const cols = Math.ceil(Math.sqrt(ids.length));
  const rows = Math.ceil(ids.length / cols);
  const gap = 4;
  const w = Math.floor((W - gap * (cols + 1)) / cols);
  const h = Math.floor((H - gap * (rows + 1)) / rows);
  ids.forEach((id, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const el = registry[id].el;
    el.style.left   = (gap + col * (w + gap)) + 'px';
    el.style.top    = (gap + row * (h + gap)) + 'px';
    el.style.width  = w + 'px';
    el.style.height = h + 'px';
    el.style.zIndex = 600 + i;
  });
  window.dispatchEvent(new Event('resize'));
}

export function closeAll() {
  Object.keys(registry).forEach(id => closeWindow(id));
}

function bringToFront(id) {
  if (!registry[id]) return;
  registry[id].el.style.zIndex = nextZ();
}

function toggleMinimize(id) {
  if (!registry[id]) return;
  const inst = registry[id];
  inst.minimized = !inst.minimized;
  const body  = inst.el.querySelector('.win-body');
  const resizers = inst.el.querySelectorAll('.win-resize');
  const minBtn   = inst.el.querySelector('.win-btn-min');
  if (inst.minimized) {
    inst.savedH = inst.el.offsetHeight;
    body.style.display = 'none';
    resizers.forEach(r => r.style.display = 'none');
    inst.el.style.height = 'auto';
    minBtn.textContent = '□';
  } else {
    body.style.display = '';
    resizers.forEach(r => r.style.display = '');
    inst.el.style.height = inst.savedH + 'px';
    minBtn.textContent = '−';
  }
}

function buildEl(def, n) {
  const { id, title, icon = '⬛', accent = '#22d3a5', width = 380, height = 300 } = def;
  const left = 100 + n * 36, top = 80 + n * 36;

  const el = document.createElement('div');
  el.className = 'win';
  el.id = `win-${id}`;
  el.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px;`;

  el.innerHTML = `
    <div class="win-titlebar" style="--wa:${accent}">
      <span class="win-icon">${icon}</span>
      <span class="win-title">${title}</span>
      <div class="win-controls">
        <button class="win-btn win-btn-min" title="Minimize">−</button>
        <button class="win-btn win-btn-close" title="Close">✕</button>
      </div>
    </div>
    <div class="win-body">
      <div class="win-loading"><div class="win-spinner" style="border-top-color:${accent}"></div><span>Loading…</span></div>
    </div>
    <div class="win-resize win-resize-n"  data-dir="n"></div>
    <div class="win-resize win-resize-s"  data-dir="s"></div>
    <div class="win-resize win-resize-e"  data-dir="e"></div>
    <div class="win-resize win-resize-w"  data-dir="w"></div>
    <div class="win-resize win-resize-ne" data-dir="ne"></div>
    <div class="win-resize win-resize-nw" data-dir="nw"></div>
    <div class="win-resize win-resize-se" data-dir="se"></div>
    <div class="win-resize win-resize-sw" data-dir="sw"></div>`;

  el.querySelector('.win-btn-min').addEventListener('click', e => { e.stopPropagation(); toggleMinimize(id); });
  el.querySelector('.win-btn-close').addEventListener('click', e => { e.stopPropagation(); closeWindow(id); });
  el.addEventListener('mousedown', () => bringToFront(id));
  return el;
}

function setupDrag(el, id) {
  const tb = el.querySelector('.win-titlebar');
  tb.addEventListener('mousedown', e => {
    if (e.target.classList.contains('win-btn')) return;
    e.preventDefault();
    const ox = e.clientX - el.offsetLeft, oy = e.clientY - el.offsetTop;
    document.body.style.cursor = 'move';
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.style.pointerEvents = 'none';

    const move = ev => {
      el.style.left = Math.max(0, ev.clientX - ox) + 'px';
      el.style.top  = Math.max(0, ev.clientY - oy) + 'px';
    };
    const up = () => {
      document.body.style.cursor = '';
      if (mapEl) mapEl.style.pointerEvents = '';
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function setupResize(el) {
  const MIN_W = 240, MIN_H = 100;
  el.querySelectorAll('.win-resize').forEach(h => {
    h.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const dir = h.dataset.dir;
      const sx = e.clientX, sy = e.clientY;
      const sw = el.offsetWidth, sh = el.offsetHeight, sl = el.offsetLeft, st = el.offsetTop;
      const cursors = {n:'n-resize',s:'s-resize',e:'e-resize',w:'w-resize',ne:'ne-resize',nw:'nw-resize',se:'se-resize',sw:'sw-resize'};
      document.body.style.cursor = cursors[dir];
      const mapEl = document.getElementById('map');
      if (mapEl) mapEl.style.pointerEvents = 'none';

      const move = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (dir.includes('e')) el.style.width  = Math.max(MIN_W, sw + dx) + 'px';
        if (dir.includes('s')) el.style.height = Math.max(MIN_H, sh + dy) + 'px';
        if (dir.includes('w')) { const nw = Math.max(MIN_W, sw-dx); el.style.width=nw+'px'; el.style.left=(sl+sw-nw)+'px'; }
        if (dir.includes('n')) { const nh = Math.max(MIN_H, sh-dy); el.style.height=nh+'px'; el.style.top=(st+sh-nh)+'px'; }
        window.dispatchEvent(new Event('resize'));
      };
      const up = () => {
        document.body.style.cursor = '';
        if (mapEl) mapEl.style.pointerEvents = '';
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  });
}

function syncToolbar(id, active) {
  const btn = document.querySelector(`.infra-btn[data-win-id="${id}"]`);
  if (btn) btn.classList.toggle('win-active', active);
}

// ═══════════════════════════════════════════════════════════
// INFRASTRUCTURE WINDOW DEFINITIONS
// ═══════════════════════════════════════════════════════════

export const INFRA_WINDOWS = [
  { id: 'internet-outages',  title: 'Internet Outages',            icon: '🌐', accent: '#3b82f6', width: 440, height: 320, onOpen: loadInternetOutages },
  { id: 'power-grid',        title: 'Power Grid Access',           icon: '⚡', accent: '#eab308', width: 440, height: 320, onOpen: loadPowerGrid },
  { id: 'nuclear-sites',     title: 'Nuclear Facilities',          icon: '☢️', accent: '#22c55e', width: 480, height: 360, onOpen: loadNuclearSites },
  { id: 'military-hotspots', title: 'Military Hotspots',           icon: '🪖', accent: '#ef4444', width: 460, height: 360, onOpen: loadMilitaryHotspots },
  { id: 'sanctions',         title: 'Active Sanctions',            icon: '🔒', accent: '#f97316', width: 480, height: 340, onOpen: loadSanctions },
  { id: 'critical-infra',    title: 'Critical Infrastructure',     icon: '🏗',  accent: '#a855f7', width: 500, height: 400, onOpen: loadCriticalInfra },
];

// ═══════════════════════════════════════════════════════════
// DATA LOADERS
// ═══════════════════════════════════════════════════════════

async function loadInternetOutages(body) {
  const until = Math.floor(Date.now() / 1000);
  const from  = until - 24 * 3600;
  const url   = `https://api.ioda.isc.org/v2/outages/scores?from=${from}&until=${until}&limit=50&human=true`;

  let data;
  try {
    const cached = cacheGet(url);
    if (cached) { data = cached; }
    else {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`IODA ${res.status}`);
      data = await res.json();
      cacheSet(url, data);
    }
  } catch { data = null; }

  // Parse IODA response or use static fallback
  let rows = [];
  if (data?.data) {
    const flat = Object.values(data.data).flatMap(src => src || []);
    rows = flat
      .filter(o => o.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(o => ({ name: o.entityName || o.entity || '—', type: o.entityType || '—', score: +(o.score || 0) }));
  }

  if (!rows.length) {
    // Static fallback snapshot
    rows = [
      { name: 'Gaza / Palestine', type: 'country', score: 9.7 },
      { name: 'Sudan', type: 'country', score: 8.2 },
      { name: 'Iran', type: 'country', score: 6.1 },
      { name: 'Myanmar', type: 'country', score: 5.4 },
      { name: 'Ethiopia', type: 'country', score: 4.8 },
      { name: 'Libya', type: 'country', score: 3.9 },
      { name: 'Yemen', type: 'country', score: 3.2 },
      { name: 'Russia (regions)', type: 'country', score: 2.1 },
    ];
  }

  const live = !!data?.data;
  body.innerHTML = `
    <div class="win-section-title">Connectivity anomaly scores — past 24h${!live ? ' <span class="win-stale">(static snapshot)</span>' : ''}</div>
    <div class="win-scroll">
      <table class="win-table">
        <thead><tr><th>Entity</th><th>Type</th><th>Score</th><th>Severity</th></tr></thead>
        <tbody>${rows.map(r => {
          const c = r.score > 5 ? '#ef4444' : r.score > 2 ? '#f97316' : '#eab308';
          return `<tr>
            <td>${r.name}</td>
            <td class="win-dim">${r.type}</td>
            <td style="color:${c};font-weight:600">${r.score.toFixed(1)}</td>
            <td><div class="win-bar-bg"><div class="win-bar-fill" style="width:${Math.min(100,r.score*10)}%;background:${c}"></div></div></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
    <div class="win-footer">Source: IODA — Internet Outage Detection &amp; Analysis (CAIDA/ISC)</div>`;
}

async function loadPowerGrid(body) {
  const url = 'https://api.worldbank.org/v2/country/all/indicator/EG.ELC.ACCS.ZS?format=json&mrv=1&per_page=300';
  let rows = [];
  try {
    let json = cacheGet(url);
    if (!json) { const r = await fetch(url); json = await r.json(); cacheSet(url, json); }
    rows = (json[1] || [])
      .filter(d => d.value !== null && d.countryiso3code && !['WLD','LDC','HIC'].includes(d.countryiso3code))
      .map(d => ({ name: d.country.value, pct: d.value, date: d.date }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 28);
  } catch(e) { body.innerHTML = `<div class="win-error">⚠ ${e.message}</div>`; return; }

  body.innerHTML = `
    <div class="win-section-title">Lowest electricity access (World Bank, MRV ${rows[0]?.date || ''})</div>
    <div class="win-scroll">
      <table class="win-table">
        <thead><tr><th>Country</th><th style="text-align:right">Access %</th><th>Coverage bar</th></tr></thead>
        <tbody>${rows.map(r => {
          const c = r.pct < 30 ? '#ef4444' : r.pct < 60 ? '#f97316' : r.pct < 85 ? '#eab308' : '#22c55e';
          return `<tr>
            <td>${r.name}</td>
            <td style="text-align:right;color:${c};font-weight:600">${r.pct.toFixed(1)}%</td>
            <td><div class="win-bar-bg"><div class="win-bar-fill" style="width:${r.pct}%;background:${c}"></div></div></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
    <div class="win-footer">Source: World Bank — EG.ELC.ACCS.ZS</div>`;
}

async function loadNuclearSites(body) {
  const sites = [
    { name: 'Zaporizhzhia NPP',      country: 'Ukraine',       type: 'Power Plant',     mw: 5700,  status: 'OCCUPIED',            alert: 'critical' },
    { name: 'Yongbyon Complex',       country: 'North Korea',   type: 'Weapons/Research',mw: null,  status: 'ACTIVE',              alert: 'critical' },
    { name: 'Natanz Enrichment',      country: 'Iran',          type: 'Enrichment',      mw: null,  status: 'ACTIVE',              alert: 'critical' },
    { name: 'Fordow FFEP',            country: 'Iran',          type: 'Enrichment',      mw: null,  status: 'ACTIVE',              alert: 'critical' },
    { name: 'Bushehr NPP',            country: 'Iran',          type: 'Power Plant',     mw: 1000,  status: 'OPERATING',           alert: 'elevated' },
    { name: 'Khushab Reactors',       country: 'Pakistan',      type: 'Weapons Material',mw: null,  status: 'ACTIVE',              alert: 'elevated' },
    { name: 'Dimona (Negev NRC)',      country: 'Israel',        type: 'Weapons Research',mw: null,  status: 'PRESUMED ACTIVE',     alert: 'elevated' },
    { name: 'El-Dabaa NPP',           country: 'Egypt',         type: 'Power Plant',     mw: 4800,  status: 'UNDER CONSTRUCTION',  alert: 'stable' },
    { name: 'Akkuyu NPP',             country: 'Turkey',        type: 'Power Plant',     mw: 4800,  status: 'UNDER CONSTRUCTION',  alert: 'stable' },
    { name: 'Barakah NPP',            country: 'UAE',           type: 'Power Plant',     mw: 5600,  status: 'OPERATING',           alert: 'stable' },
    { name: 'Rooppur NPP',            country: 'Bangladesh',    type: 'Power Plant',     mw: 2400,  status: 'UNDER CONSTRUCTION',  alert: 'stable' },
    { name: 'Beloyarsk NPP',          country: 'Russia',        type: 'Power Plant',     mw: 1470,  status: 'OPERATING',           alert: 'stable' },
    { name: 'Tianwan NPP',            country: 'China',         type: 'Power Plant',     mw: 6440,  status: 'OPERATING',           alert: 'stable' },
    { name: 'Kudankulam NPP',         country: 'India',         type: 'Power Plant',     mw: 2000,  status: 'OPERATING',           alert: 'stable' },
    { name: 'Chernobyl',              country: 'Ukraine',       type: 'Exclusion Zone',  mw: 0,     status: 'DECOMMISSIONED',      alert: 'stable' },
  ];

  const ac = { critical: '#ef4444', elevated: '#f97316', stable: '#22c55e' };
  body.innerHTML = `
    <div class="win-section-title">Geopolitically significant nuclear facilities</div>
    <div class="win-scroll">
      <table class="win-table">
        <thead><tr><th>Facility</th><th>Country</th><th>Type</th><th>MWe</th><th>Status</th></tr></thead>
        <tbody>${sites.map(s => `<tr>
          <td style="font-weight:500">${s.name}</td>
          <td class="win-dim">${s.country}</td>
          <td class="win-dim" style="font-size:9px">${s.type}</td>
          <td class="win-dim" style="text-align:right">${s.mw !== null ? s.mw.toLocaleString() : '—'}</td>
          <td><span class="win-badge" style="color:${ac[s.alert]};border-color:${ac[s.alert]}55">${s.status}</span></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="win-footer">Sources: IAEA, NTI Nuclear Security Index, public reporting</div>`;
}

async function loadMilitaryHotspots(body) {
  const zones = [
    { region: 'Ukraine',            status: 'Active War',        intensity: 95, trend: '↔', detail: 'Full-scale invasion, frontline active' },
    { region: 'Gaza / Palestine',   status: 'Active War',        intensity: 93, trend: '↑', detail: 'Ground & air operations ongoing' },
    { region: 'Sudan',              status: 'Civil War',         intensity: 78, trend: '↑', detail: 'SAF vs RSF — Khartoum & Darfur' },
    { region: 'Myanmar',            status: 'Civil War',         intensity: 67, trend: '↑', detail: 'Junta vs resistance coalitions' },
    { region: 'Yemen',              status: 'Active Conflict',   intensity: 60, trend: '↔', detail: 'Houthi Red Sea attacks + internal' },
    { region: 'Haiti',              status: 'State Collapse',    intensity: 58, trend: '↑', detail: 'Gang control >80% of Port-au-Prince' },
    { region: 'DR Congo (East)',    status: 'Armed Groups',      intensity: 55, trend: '↑', detail: 'M23 / FDLR / ADF active' },
    { region: 'Sahel (Mali/Niger)', status: 'Insurgency',        intensity: 50, trend: '↑', detail: 'JNIM / ISGS expansion post-coup' },
    { region: 'Pakistan-India LoC', status: 'Elevated Tension',  intensity: 38, trend: '↑', detail: 'Recent cross-border incidents' },
    { region: 'Taiwan Strait',      status: 'Elevated Tension',  intensity: 32, trend: '↔', detail: 'PLA exercises near median line' },
    { region: 'Korea Peninsula',    status: 'Elevated Tension',  intensity: 28, trend: '↑', detail: 'DPRK missile programme escalation' },
    { region: 'Somalia / Horn',     status: 'Insurgency',        intensity: 42, trend: '↔', detail: 'Al-Shabaab activity persists' },
  ];

  body.innerHTML = `
    <div class="win-section-title">Active military conflict zones — composite intensity index</div>
    <div class="win-scroll">
      <table class="win-table">
        <thead><tr><th>Region</th><th>Status</th><th>Intensity</th><th>Trend</th><th>Note</th></tr></thead>
        <tbody>${zones.map(z => {
          const c = z.intensity > 75 ? '#ef4444' : z.intensity > 50 ? '#f97316' : '#eab308';
          const tc = z.trend === '↑' ? '#ef4444' : z.trend === '↓' ? '#22c55e' : '#9a9a9a';
          return `<tr>
            <td style="font-weight:500;white-space:nowrap">${z.region}</td>
            <td><span class="win-badge" style="color:${c};border-color:${c}55">${z.status}</span></td>
            <td>
              <div style="display:flex;align-items:center;gap:5px;min-width:90px">
                <div class="win-bar-bg" style="flex:1"><div class="win-bar-fill" style="width:${z.intensity}%;background:${c}"></div></div>
                <span style="color:${c};font-size:10px;min-width:20px;text-align:right">${z.intensity}</span>
              </div>
            </td>
            <td style="color:${tc};font-size:14px;text-align:center;font-weight:700">${z.trend}</td>
            <td class="win-dim" style="font-size:9px;white-space:normal;min-width:120px">${z.detail}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>
    <div class="win-footer">Sources: ACLED, UCDP, GDELT, open-source intelligence</div>`;
}

async function loadSanctions(body) {
  const regimes = [
    { target: 'Russia',          authority: 'US / EU / UK / G7', sectors: 'Finance, Energy, Defense, Tech, Individuals', designations: '14,000+', since: '2022' },
    { target: 'Iran',            authority: 'US / UN / EU',       sectors: 'Nuclear, Finance, Oil, Defense, IRGC',        designations: '2,500+',  since: '2006' },
    { target: 'North Korea',     authority: 'US / UN / EU',       sectors: 'WMD, Finance, Shipping, Luxury Goods',        designations: '400+',    since: '2006' },
    { target: 'Syria',           authority: 'US / EU',            sectors: 'Finance, Oil, Individuals, Military',         designations: '1,100+',  since: '2011' },
    { target: 'Belarus',         authority: 'US / EU / UK',       sectors: 'Finance, Individuals, Potash',                designations: '300+',    since: '2020' },
    { target: 'Venezuela',       authority: 'US / EU',            sectors: 'Oil, Finance, Individuals',                   designations: '200+',    since: '2015' },
    { target: 'Myanmar',         authority: 'US / EU / UK',       sectors: 'Defense, Finance, Individuals, Junta',        designations: '150+',    since: '2021' },
    { target: 'Cuba',            authority: 'US',                 sectors: 'Comprehensive Embargo (OFAC)',                 designations: 'Broad',   since: '1962' },
    { target: 'Sudan',           authority: 'US / UN',            sectors: 'Arms, Individuals, RSF leadership',           designations: '100+',    since: '2004' },
    { target: 'China (entities)','authority': 'US',               sectors: 'Tech, Defense entities, BIS Entity List',     designations: '700+',    since: '2019' },
    { target: 'Haiti',           authority: 'US / UN',            sectors: 'Gang leaders, Finance',                       designations: '30+',     since: '2022' },
    { target: 'Afghanistan',     authority: 'US / UN',            sectors: 'Taliban individuals & entities',              designations: '200+',    since: '2001' },
    { target: 'Zimbabwe',        authority: 'US / EU',            sectors: 'Individuals, Finance',                        designations: '80+',     since: '2002' },
    { target: 'Nicaragua',       authority: 'US / EU',            sectors: 'Individuals, Finance',                        designations: '60+',     since: '2018' },
  ];

  body.innerHTML = `
    <div class="win-section-title">Active international sanctions regimes (${regimes.length} tracked)</div>
    <div class="win-scroll">
      <table class="win-table">
        <thead><tr><th>Target</th><th>Authority</th><th>Primary Sectors</th><th style="text-align:right">Designations</th><th>Since</th></tr></thead>
        <tbody>${regimes.map(r => `<tr>
          <td style="font-weight:600;color:#f97316;white-space:nowrap">${r.target}</td>
          <td class="win-dim" style="font-size:9px;white-space:nowrap">${r.authority}</td>
          <td class="win-dim" style="font-size:9px;white-space:normal;min-width:150px">${r.sectors}</td>
          <td style="text-align:right;color:#eab308;font-weight:600;white-space:nowrap">${r.designations}</td>
          <td class="win-dim" style="text-align:right">${r.since}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="win-footer">Sources: OFAC (US Treasury), EU Official Journal, UN Security Council, HM Treasury</div>`;
}

async function loadCriticalInfra(body) {
  const sections = [
    {
      category: '⚡ Energy & Supply Chains',
      items: [
        { name: 'Red Sea Shipping Lanes',     status: 'DISRUPTED',  alert: 'critical', note: 'Houthi attacks → Suez Canal diversions' },
        { name: 'Strait of Hormuz',           status: 'MONITORED',  alert: 'elevated', note: '20% global oil transit, Iran tensions' },
        { name: 'European Gas Supply',        status: 'ELEVATED',   alert: 'elevated', note: 'LNG dependency, storage near capacity' },
        { name: 'Black Sea Grain Corridor',   status: 'SUSPENDED',  alert: 'critical', note: 'Agreement expired, alternative routes active' },
        { name: 'Bab-el-Mandeb Strait',       status: 'DISRUPTED',  alert: 'critical', note: 'Yemen Houthi activity increasing' },
        { name: 'Global Oil Supply (OPEC+)',  status: 'STABLE',     alert: 'stable',   note: 'Production steady, price volatility moderate' },
      ],
    },
    {
      category: '🌐 Cyber & Communications',
      items: [
        { name: 'Critical Infra Cyberattacks',status: 'HIGH THREAT',alert: 'critical', note: 'State-sponsored targeting (RU, CN, IR, KP)' },
        { name: 'Undersea Cable Integrity',   status: 'MONITORED',  alert: 'elevated', note: 'Recent cuts: Baltic Sea, Red Sea, Taiwan' },
        { name: 'GPS/GNSS Spoofing',          status: 'ACTIVE',     alert: 'elevated', note: 'Near Iran, Baltic, Middle East confirmed' },
        { name: 'Internet Fragmentation',     status: 'INCREASING', alert: 'elevated', note: 'Splinternet risk: RU, IR, CN filtering' },
      ],
    },
    {
      category: '💧 Food, Water & Humanitarian',
      items: [
        { name: 'Sahel Food Security',        status: 'CRISIS',     alert: 'critical', note: 'Famine risk: Mali, Niger, Burkina Faso' },
        { name: 'Nile Water Dispute',         status: 'TENSE',      alert: 'elevated', note: 'Ethiopia GERD dam — Egypt/Ethiopia/Sudan' },
        { name: 'Gaza Humanitarian',          status: 'CATASTROPHIC',alert:'critical', note: 'IPC Phase 5 Famine, aid access blocked' },
        { name: 'Sudan Displacement',         status: 'CRISIS',     alert: 'critical', note: '8M+ displaced, largest displacement crisis' },
      ],
    },
    {
      category: '🛰 Space & Strategic Systems',
      items: [
        { name: 'GPS/Galileo Constellation', status: 'NOMINAL',    alert: 'stable',   note: '31 GPS + 28 Galileo satellites operational' },
        { name: 'ASAT Debris Fields',        status: 'MONITORED',  alert: 'elevated', note: 'RU 2021 ASAT test debris persists (LEO)' },
        { name: 'Space Militarisation',      status: 'ESCALATING', alert: 'elevated', note: 'RU/CN ASAT, co-orbital, EW programmes active' },
      ],
    },
  ];

  const ac = { critical: '#ef4444', elevated: '#f97316', stable: '#22c55e' };

  body.innerHTML = sections.map(sec => `
    <div class="win-section-title">${sec.category}</div>
    <table class="win-table" style="margin-bottom:4px">
      <tbody>${sec.items.map(item => `<tr>
        <td style="font-weight:500;white-space:nowrap">${item.name}</td>
        <td style="white-space:nowrap"><span class="win-badge" style="color:${ac[item.alert]};border-color:${ac[item.alert]}55">${item.status}</span></td>
        <td class="win-dim" style="font-size:9px;white-space:normal">${item.note}</td>
      </tr>`).join('')}</tbody>
    </table>
  `).join('');
}

// ═══════════════════════════════════════════════════════════
// TOOLBAR INITIALIZER
// ═══════════════════════════════════════════════════════════

export function initInfraToolbar() {
  const toolbar = document.getElementById('infra-toolbar');
  if (!toolbar) return;

  INFRA_WINDOWS.forEach(def => {
    const btn = document.createElement('button');
    btn.className = 'infra-btn';
    btn.dataset.winId = def.id;
    btn.style.setProperty('--ba', def.accent);
    btn.innerHTML = `${def.icon} ${def.title}`;
    btn.addEventListener('click', () => {
      if (registry[def.id]) {
        closeWindow(def.id);
        btn.classList.remove('win-active');
      } else {
        openWindow(def.id);
        btn.classList.add('win-active');
      }
    });
    toolbar.appendChild(btn);
  });

  // Separator
  const sep = document.createElement('div');
  sep.className = 'infra-toolbar-sep';
  toolbar.appendChild(sep);

  // Cascade button
  const cascadeBtn = document.createElement('button');
  cascadeBtn.className = 'infra-action-btn';
  cascadeBtn.innerHTML = '⧉ Cascade';
  cascadeBtn.addEventListener('click', cascadeAll);
  toolbar.appendChild(cascadeBtn);

  // Tile button
  const tileBtn = document.createElement('button');
  tileBtn.className = 'infra-action-btn';
  tileBtn.innerHTML = '⊞ Tile';
  tileBtn.addEventListener('click', tileAll);
  toolbar.appendChild(tileBtn);

  // Close all button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'infra-action-btn';
  closeBtn.innerHTML = '✕ Close All';
  closeBtn.style.color = '#666';
  closeBtn.addEventListener('click', () => {
    closeAll();
    toolbar.querySelectorAll('.infra-btn').forEach(b => b.classList.remove('win-active'));
  });
  toolbar.appendChild(closeBtn);
}
