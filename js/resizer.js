/**
 * Drag-to-resize handles for the GeoWatch layout.
 *
 * Handles:
 *   #resizer-left        — between left sidebar and map (horizontal)
 *   #resizer-right       — between map area and right sidebar (horizontal)
 *   #resizer-bottom      — between map and bottom strip (vertical)
 *   #resizer-bottom-mid  — between risk table and charts inside bottom strip (horizontal)
 *
 * Sizes are persisted in localStorage and restored on load.
 */

const STORAGE_KEY = 'geowatch-layout';
const MIN = { sidebar: 140, charts: 200, bottomStrip: 80, mapHeight: 120 };

// ── Persist / restore ────────────────────────────────────────────────────────

function saveLayout(key, value) {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    data[key] = value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function loadLayout() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

// ── Core drag helper ─────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} handle   - the drag handle element
 * @param {'h'|'v'}     axis     - 'h' = horizontal drag (changes widths), 'v' = vertical
 * @param {Function}    onDrag   - called with delta px on each mousemove
 * @param {Function}    [onDone] - called on mouseup
 */
function makeDraggable(handle, axis, onDrag, onDone) {
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;

    document.body.style.cursor = axis === 'h' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    // Dim map pointer events so Leaflet doesn't capture the drag
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.style.pointerEvents = 'none';

    function onMove(ev) {
      const delta = axis === 'h' ? ev.clientX - startX : ev.clientY - startY;
      onDrag(delta, ev);
    }

    function onUp(ev) {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (mapEl) mapEl.style.pointerEvents = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (onDone) onDone();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initResizers() {
  const saved = loadLayout();

  const sidebarLeft  = document.querySelector('.sidebar-left');
  const sidebarRight = document.querySelector('.sidebar-right');
  const bottomStrip  = document.querySelector('.bottom-strip');
  const panelRisk    = document.querySelector('.panel-risk');
  const mapEl        = document.getElementById('map');

  // Restore saved sizes
  if (saved.leftWidth)       sidebarLeft.style.width  = saved.leftWidth  + 'px';
  if (saved.rightWidth)      sidebarRight.style.width = saved.rightWidth + 'px';
  if (saved.bottomHeight)    bottomStrip.style.height = saved.bottomHeight + 'px';
  if (saved.riskWidth)       panelRisk.style.flex     = 'none', panelRisk.style.width = saved.riskWidth + 'px';

  // ── LEFT sidebar resizer ──────────────────────────────────────────────────
  const rLeft = document.getElementById('resizer-left');
  let leftBase = 0;
  makeDraggable(rLeft, 'h',
    delta => {
      const w = Math.max(MIN.sidebar, leftBase + delta);
      sidebarLeft.style.width = w + 'px';
    },
    () => saveLayout('leftWidth', sidebarLeft.offsetWidth)
  );
  rLeft.addEventListener('mousedown', () => { leftBase = sidebarLeft.offsetWidth; });

  // ── RIGHT sidebar resizer ─────────────────────────────────────────────────
  const rRight = document.getElementById('resizer-right');
  let rightBase = 0;
  makeDraggable(rRight, 'h',
    delta => {
      const w = Math.max(MIN.sidebar, rightBase - delta);
      sidebarRight.style.width = w + 'px';
    },
    () => saveLayout('rightWidth', sidebarRight.offsetWidth)
  );
  rRight.addEventListener('mousedown', () => { rightBase = sidebarRight.offsetWidth; });

  // ── BOTTOM STRIP vertical resizer ────────────────────────────────────────
  const rBottom = document.getElementById('resizer-bottom');
  let bottomBase = 0;
  makeDraggable(rBottom, 'v',
    delta => {
      const h = Math.max(MIN.bottomStrip, bottomBase - delta);
      bottomStrip.style.height = h + 'px';
      // Invalidate chart sizes after resize
      window.dispatchEvent(new Event('resize'));
    },
    () => saveLayout('bottomHeight', bottomStrip.offsetHeight)
  );
  rBottom.addEventListener('mousedown', () => { bottomBase = bottomStrip.offsetHeight; });

  // ── BOTTOM-MID: risk table | charts resizer ───────────────────────────────
  const rMid = document.getElementById('resizer-bottom-mid');
  let riskBase = 0;
  makeDraggable(rMid, 'h',
    delta => {
      const w = Math.max(MIN.charts, riskBase + delta);
      panelRisk.style.flex  = 'none';
      panelRisk.style.width = w + 'px';
      window.dispatchEvent(new Event('resize'));
    },
    () => saveLayout('riskWidth', panelRisk.offsetWidth)
  );
  rMid.addEventListener('mousedown', () => { riskBase = panelRisk.offsetWidth; });

  // Notify Leaflet on any resize so the map tiles redraw correctly
  const observer = new ResizeObserver(() => {
    window.dispatchEvent(new Event('resize'));
  });
  observer.observe(document.querySelector('.map-area'));
}
