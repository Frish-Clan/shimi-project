/**
 * Multi-Country Instability Comparison
 *
 * Methodology (U:C:S:I) per attached specification:
 *   U — Unrest:      civil disorder & protests              weight 30%
 *   C — Conflict:    armed conflict intensity               weight 35%
 *   S — Security:    military flights/vessels over territory weight 20%
 *   I — Information: news velocity & focal point correlation weight 15%
 *   + Hotspot proximity boost (strategic locations)         up to +15 pts
 *
 * Data: GDELT DOC 2.0 (180-day timelines, 4 category queries)
 *       World Bank PV.EST (annual, used as C baseline anchor)
 */

import { cacheGet, cacheSet } from './utils/cache.js';

// ── Methodology constants ────────────────────────────────────────────────────
const W = { U: 0.30, C: 0.35, S: 0.20, I: 0.15 };

// Max hotspot proximity boost per ISO2 code
const HOTSPOT = {
  PS: 15, IL: 14, UA: 14, SY: 13, IR: 13, AF: 13, KP: 13,
  IQ: 12, YE: 11, SD: 11, LB: 12, RU: 11, MM: 10, LY: 9,
  ML: 8,  NE: 8,  BF: 8,  SO: 9,  PK: 10, ET: 7,
};

// Chart colours (one per selected country)
const PALETTE = ['#22d3a5', '#ef4444', '#3b82f6', '#f97316', '#a855f7', '#eab308', '#06b6d4', '#ec4899'];

// ── Module state ─────────────────────────────────────────────────────────────
// These are mutable references — initCompare() updates them at runtime.
// The window reads them lazily so it always sees the latest data even if
// it was opened before the data finished loading.
const _state = { countryIndex: null, pvScores: {} };

let _chart    = null;
let _selected = [];  // [{ iso2, name, flag, color }]
let _scores   = {};  // iso2 -> { U[], C[], S[], I[], composite[] }

// Convenience accessors
const idx = () => _state.countryIndex;

// ── Public API ───────────────────────────────────────────────────────────────

export function initCompare(countryIndex, pvScores) {
  _state.countryIndex = countryIndex;
  _state.pvScores     = pvScores;
}

export function openCompareWindow() {
  const existing = document.getElementById('win-compare');
  if (existing) {
    existing.style.display = '';
    existing.style.zIndex  = 900;
    return;
  }
  buildWindow();
}

// ── Window DOM ───────────────────────────────────────────────────────────────

function buildWindow() {
  const el = document.createElement('div');
  el.id        = 'win-compare';
  el.className = 'win compare-win';
  el.style.cssText = 'left:120px;top:60px;width:680px;height:500px;z-index:900;';

  el.innerHTML = `
    <div class="win-titlebar compare-titlebar">
      <span class="win-icon">📊</span>
      <span class="win-title">Country Instability Comparison — 6-Month Trend</span>
      <div class="win-controls">
        <button class="win-btn" id="cmp-min-btn" title="Minimize">−</button>
        <button class="win-btn win-btn-close" id="cmp-close-btn" title="Close">✕</button>
      </div>
    </div>

    <!-- Methodology bar -->
    <div class="cmp-method-bar">
      <span class="cmp-method-title">METHODOLOGY</span>
      <span class="cmp-formula">U:C:S:I</span>
      <span class="cmp-m-item"><span class="cmp-u">U</span> Unrest (30%)</span>
      <span class="cmp-m-item"><span class="cmp-c">C</span> Conflict (35%)</span>
      <span class="cmp-m-item"><span class="cmp-s">S</span> Security (20%)</span>
      <span class="cmp-m-item"><span class="cmp-i">I</span> Information (15%)</span>
      <span class="cmp-m-item cmp-boost">⊕ Hotspot boost</span>
    </div>

    <!-- Country selector -->
    <div class="cmp-selector">
      <div class="cmp-search-wrap">
        <input id="cmp-search" class="cmp-search" type="text" placeholder="Add country to compare…" autocomplete="off">
        <div id="cmp-dropdown" class="cmp-dropdown" style="display:none"></div>
      </div>
      <div id="cmp-chips" class="cmp-chips">
        <span class="cmp-hint">Select up to 6 countries</span>
      </div>
    </div>

    <!-- Chart area -->
    <div class="cmp-chart-area">
      <div id="cmp-empty" class="cmp-empty">Add countries above to compare instability trends</div>
      <canvas id="cmp-canvas" style="display:none"></canvas>
    </div>

    <!-- Score breakdown table -->
    <div id="cmp-breakdown" class="cmp-breakdown" style="display:none">
      <table class="cmp-table" id="cmp-breakdown-table"></table>
    </div>

    <!-- Resize handles -->
    <div class="win-resize win-resize-n"  data-dir="n"></div>
    <div class="win-resize win-resize-s"  data-dir="s"></div>
    <div class="win-resize win-resize-e"  data-dir="e"></div>
    <div class="win-resize win-resize-w"  data-dir="w"></div>
    <div class="win-resize win-resize-ne" data-dir="ne"></div>
    <div class="win-resize win-resize-nw" data-dir="nw"></div>
    <div class="win-resize win-resize-se" data-dir="se"></div>
    <div class="win-resize win-resize-sw" data-dir="sw"></div>`;

  document.getElementById('windows-layer').appendChild(el);

  // Wire controls
  el.querySelector('#cmp-close-btn').addEventListener('click', () => { el.style.display = 'none'; });
  el.querySelector('#cmp-min-btn').addEventListener('click', () => toggleMinimize(el));
  el.addEventListener('mousedown', () => { el.style.zIndex = 900; });

  setupWindowDrag(el);
  setupWindowResize(el);
  setupSearch(el);
}

function toggleMinimize(el) {
  const body = el.querySelector('.cmp-method-bar, .cmp-selector, .cmp-chart-area, .cmp-breakdown');
  const hidden = el.style.height === 'auto';
  if (hidden) {
    el.style.height = el._savedH || '500px';
    el.querySelectorAll('.cmp-method-bar, .cmp-selector, .cmp-chart-area, .cmp-breakdown').forEach(n => n.style.display = '');
    el.querySelector('#cmp-min-btn').textContent = '−';
  } else {
    el._savedH = el.style.height;
    el.querySelectorAll('.cmp-method-bar, .cmp-selector, .cmp-chart-area, .cmp-breakdown').forEach(n => n.style.display = 'none');
    el.style.height = 'auto';
    el.querySelector('#cmp-min-btn').textContent = '□';
  }
}

// ── Search / country selection ────────────────────────────────────────────────

function setupSearch(el) {
  const input    = el.querySelector('#cmp-search');
  const dropdown = el.querySelector('#cmp-dropdown');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 1) { dropdown.style.display = 'none'; return; }

    const countries = Object.values(idx()?.byIso2 || {});
    const matches = countries
      .filter(c => c.name?.common?.toLowerCase().includes(q))
      .filter(c => !_selected.find(s => s.iso2 === c.cca2))
      .slice(0, 8);

    if (!matches.length) { dropdown.style.display = 'none'; return; }

    dropdown.innerHTML = matches.map(c => `
      <div class="cmp-drop-item" data-iso2="${c.cca2}">
        <span>${c.flags?.emoji || '🏳'}</span>
        <span>${c.name.common}</span>
        <span class="cmp-drop-region">${c.region || ''}</span>
      </div>`).join('');

    dropdown.style.display = '';
    dropdown.querySelectorAll('.cmp-drop-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        addCountry(item.dataset.iso2);
        input.value = '';
        dropdown.style.display = 'none';
      });
    });
  });

  input.addEventListener('blur', () => setTimeout(() => { dropdown.style.display = 'none'; }, 150));
  input.addEventListener('focus', () => { if (input.value) input.dispatchEvent(new Event('input')); });
}

function addCountry(iso2) {
  if (_selected.length >= 6) return;
  if (_selected.find(s => s.iso2 === iso2)) return;

  const country = idx()?.byIso2[iso2];
  if (!country) return;

  const entry = {
    iso2,
    name:  country.name?.common || iso2,
    flag:  country.flags?.emoji || '🏳',
    color: PALETTE[_selected.length % PALETTE.length],
  };
  _selected.push(entry);
  renderChips();
  fetchAndRender(iso2);
}

function removeCountry(iso2) {
  _selected = _selected.filter(s => s.iso2 !== iso2);
  delete _scores[iso2];
  renderChips();
  renderChart();
}

function renderChips() {
  const el = document.getElementById('cmp-chips');
  if (!el) return;

  if (_selected.length === 0) {
    el.innerHTML = '<span class="cmp-hint">Select up to 6 countries</span>';
    return;
  }

  el.innerHTML = _selected.map(s => `
    <span class="cmp-chip" style="border-color:${s.color};color:${s.color}">
      ${s.flag} ${s.name}
      <button class="cmp-chip-rm" data-iso2="${s.iso2}">✕</button>
    </span>`).join('');

  el.querySelectorAll('.cmp-chip-rm').forEach(btn => {
    btn.addEventListener('click', () => removeCountry(btn.dataset.iso2));
  });
}

// ── Data fetching & scoring ───────────────────────────────────────────────────

async function fetchAndRender(iso2) {
  const country  = idx()?.byIso2[iso2];
  const name     = country?.name?.common || iso2;
  const pvEntry  = _state.pvScores[country?.cca3];
  const pvVal    = pvEntry?.value ?? 0; // -2.5 to +2.5

  const GDELT = 'https://api.gdeltproject.org/api/v2/doc/doc';

  const queries = {
    U: `protest demonstration unrest "${name}"`,
    C: `conflict attack war strike "${name}"`,
    S: `military troops vessel aircraft "${name}"`,
    I: `"${name}"`,
  };

  // Fetch all 4 GDELT category timelines in parallel (180d = ~6 months)
  const results = {};
  await Promise.allSettled(
    Object.entries(queries).map(async ([key, query]) => {
      const url = `${GDELT}?query=${encodeURIComponent(query)}&mode=timelinevolinfo&format=json&timespan=180d`;
      let data = cacheGet(url);
      if (!data) {
        try {
          const res = await fetch(url);
          if (res.ok) { data = await res.json(); cacheSet(url, data); }
        } catch {}
      }
      const timeline = data?.timeline?.[0]?.data || [];
      results[key] = toBuckets(timeline, 6);
    })
  );

  // World Bank PV.EST as C baseline anchor: inverts [-2.5,2.5] → [0,1]
  const pvFactor = (pvVal * -1 + 2.5) / 5; // 0 = very stable, 1 = very unstable

  const U  = normalize(results.U || new Array(6).fill(0));
  const C  = results.C ? normalize(results.C).map((v, i) => clamp(v * 0.65 + pvFactor * 35)) : new Array(6).fill(pvFactor * 100);
  const S  = normalize(results.S || new Array(6).fill(0));
  const I  = normalize(results.I || new Array(6).fill(0));

  // Composite = weighted sum + hotspot boost
  const boost     = HOTSPOT[iso2] || 0;
  const composite = U.map((u, i) =>
    clamp(Math.round(u * W.U + C[i] * W.C + S[i] * W.S + I[i] * W.I + boost))
  );

  _scores[iso2] = { U, C, S, I, composite, boost };
  renderChart();
  renderBreakdown();
}

// Aggregate raw GDELT daily timeline into N monthly buckets
function toBuckets(data, n) {
  if (!data.length) return new Array(n).fill(0);
  const size = Math.max(1, Math.ceil(data.length / n));
  const out  = [];
  for (let i = 0; i < n; i++) {
    const slice = data.slice(i * size, (i + 1) * size);
    const avg   = slice.length ? slice.reduce((s, d) => s + (d.value || 0), 0) / slice.length : 0;
    out.push(avg);
  }
  // Pad if GDELT returned fewer points than expected
  while (out.length < n) out.push(out[out.length - 1] || 0);
  return out;
}

// Normalize bucket array to 0-100, preserving relative shape
function normalize(arr) {
  const max = Math.max(...arr, 0.001);
  return arr.map(v => clamp(Math.round((v / max) * 100)));
}

function clamp(v) { return Math.max(0, Math.min(100, v)); }

// ── Chart rendering ───────────────────────────────────────────────────────────

function monthLabels() {
  const out = [], now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }));
  }
  return out;
}

function renderChart() {
  const canvas  = document.getElementById('cmp-canvas');
  const emptyEl = document.getElementById('cmp-empty');
  if (!canvas) return;

  if (_selected.length === 0 || Object.keys(_scores).length === 0) {
    canvas.style.display  = 'none';
    if (emptyEl) emptyEl.style.display = '';
    if (_chart) { _chart.destroy(); _chart = null; }
    return;
  }

  canvas.style.display  = '';
  if (emptyEl) emptyEl.style.display = 'none';

  const labels   = monthLabels();
  const datasets = _selected
    .filter(s => _scores[s.iso2])
    .map(s => ({
      label:           `${s.flag} ${s.name}`,
      data:            _scores[s.iso2].composite,
      borderColor:     s.color,
      backgroundColor: s.color + '18',
      pointBackgroundColor: s.color,
      pointBorderColor: '#0a0a0a',
      pointBorderWidth: 2,
      pointRadius:      5,
      pointHoverRadius: 7,
      borderWidth:      2.5,
      tension:          0.35,
      fill:             true,
    }));

  if (_chart) { _chart.destroy(); _chart = null; }

  _chart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction:         { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align:    'start',
          labels: {
            color:      '#d4d4d4',
            font:       { family: 'JetBrains Mono', size: 10 },
            boxWidth:   12,
            boxHeight:  3,
            padding:    14,
            usePointStyle: true,
            pointStyle:    'line',
          },
        },
        tooltip: {
          backgroundColor: '#141414',
          borderColor:     '#2a2a2a',
          borderWidth:     1,
          titleColor:      '#888',
          bodyColor:       '#d4d4d4',
          titleFont:       { family: 'JetBrains Mono', size: 9 },
          bodyFont:        { family: 'JetBrains Mono', size: 10 },
          callbacks: {
            title: items => items[0].label,
            afterBody: items => {
              const lines = [];
              items.forEach(item => {
                const iso2 = _selected.find(s => `${s.flag} ${s.name}` === item.dataset.label)?.iso2;
                if (!iso2 || !_scores[iso2]) return;
                const mi = item.dataIndex;
                const sc = _scores[iso2];
                lines.push(`  U:${sc.U[mi]} C:${sc.C[mi]} S:${sc.S[mi]} I:${sc.I[mi]}${sc.boost ? ` +${sc.boost}` : ''}`);
              });
              return lines;
            },
          },
        },
      },
      scales: {
        x: {
          grid:  { color: '#1e1e1e' },
          ticks: { color: '#666', font: { family: 'JetBrains Mono', size: 9 } },
        },
        y: {
          min: 0, max: 100,
          grid: { color: ctx => ctx.tick.value % 20 === 0 ? '#2a2a2a' : '#161616' },
          ticks: {
            color:     '#666',
            font:      { family: 'JetBrains Mono', size: 9 },
            stepSize:  20,
            callback:  v => v,
          },
          title: { display: true, text: 'Instability Index', color: '#444', font: { family: 'JetBrains Mono', size: 9 } },
        },
      },
    },
  });
}

// ── Score breakdown table ─────────────────────────────────────────────────────

function renderBreakdown() {
  const wrap  = document.getElementById('cmp-breakdown');
  const table = document.getElementById('cmp-breakdown-table');
  if (!wrap || !table) return;

  const active = _selected.filter(s => _scores[s.iso2]);
  if (!active.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  // Latest month scores
  const last = (arr) => arr[arr.length - 1] ?? '—';

  table.innerHTML = `
    <thead>
      <tr>
        <th>Country</th>
        <th><span class="cmp-u">U</span> Unrest</th>
        <th><span class="cmp-c">C</span> Conflict</th>
        <th><span class="cmp-s">S</span> Security</th>
        <th><span class="cmp-i">I</span> Info</th>
        <th>⊕ Boost</th>
        <th>Composite</th>
      </tr>
    </thead>
    <tbody>
      ${active.map(s => {
        const sc = _scores[s.iso2];
        const comp = last(sc.composite);
        const color = comp >= 70 ? '#ef4444' : comp >= 45 ? '#f97316' : '#22c55e';
        return `
          <tr>
            <td><span style="color:${s.color}">${s.flag} ${s.name}</span></td>
            <td class="cmp-col-u">${last(sc.U)}</td>
            <td class="cmp-col-c">${last(sc.C)}</td>
            <td class="cmp-col-s">${last(sc.S)}</td>
            <td class="cmp-col-i">${last(sc.I)}</td>
            <td style="color:#888">+${sc.boost}</td>
            <td style="color:${color};font-weight:700">${comp}</td>
          </tr>`;
      }).join('')}
    </tbody>`;
}

// ── Drag & Resize (standalone, no dependency on windows.js internals) ─────────

function setupWindowDrag(el) {
  const tb = el.querySelector('.compare-titlebar');
  tb.addEventListener('mousedown', e => {
    if (e.target.classList.contains('win-btn')) return;
    e.preventDefault();
    const ox = e.clientX - el.offsetLeft, oy = e.clientY - el.offsetTop;
    document.body.style.cursor = 'move';
    const map = document.getElementById('map');
    if (map) map.style.pointerEvents = 'none';
    const move = ev => { el.style.left = Math.max(0, ev.clientX - ox) + 'px'; el.style.top = Math.max(0, ev.clientY - oy) + 'px'; };
    const up   = () => { document.body.style.cursor = ''; if (map) map.style.pointerEvents = ''; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup',   up);
  });
}

function setupWindowResize(el) {
  const MIN_W = 400, MIN_H = 180;
  el.querySelectorAll('.win-resize').forEach(h => {
    h.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const dir = h.dataset.dir;
      const sx = e.clientX, sy = e.clientY, sw = el.offsetWidth, sh = el.offsetHeight, sl = el.offsetLeft, st = el.offsetTop;
      const cursors = { n:'n-resize',s:'s-resize',e:'e-resize',w:'w-resize',ne:'ne-resize',nw:'nw-resize',se:'se-resize',sw:'sw-resize' };
      document.body.style.cursor = cursors[dir];
      const map = document.getElementById('map');
      if (map) map.style.pointerEvents = 'none';
      const move = ev => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (dir.includes('e')) el.style.width  = Math.max(MIN_W, sw + dx) + 'px';
        if (dir.includes('s')) el.style.height = Math.max(MIN_H, sh + dy) + 'px';
        if (dir.includes('w')) { const nw = Math.max(MIN_W, sw-dx); el.style.width=nw+'px'; el.style.left=(sl+sw-nw)+'px'; }
        if (dir.includes('n')) { const nh = Math.max(MIN_H, sh-dy); el.style.height=nh+'px'; el.style.top=(st+sh-nh)+'px'; }
        window.dispatchEvent(new Event('resize'));
      };
      const up = () => { document.body.style.cursor=''; if(map) map.style.pointerEvents=''; document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup',   up);
    });
  });
}
