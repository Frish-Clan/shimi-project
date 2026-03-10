import { riskColor, stabilityColor, stabilityFillColor } from '../utils/colorScale.js';

let map = null;
let geojsonLayer = null;
let eqLayerGroup = null;

export function initMap(containerId) {
  map = L.map(containerId, { zoomControl: true, scrollWheelZoom: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);
  map.setView([20, 0], 2);
  eqLayerGroup = L.layerGroup().addTo(map);
  return map;
}

export async function loadChoropleth(countryIndex, pvScores, onCountryClick) {
  let topo;
  try {
    topo = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(r => r.json());
  } catch (e) {
    console.error('Failed to load world atlas:', e);
    return;
  }

  const geojson = topojson.feature(topo, topo.objects.countries);

  // Build numeric (padded 3-digit string) -> iso2 and iso3 maps
  const numericToIso2 = {};
  const numericToIso3 = {};
  for (const [iso2, c] of Object.entries(countryIndex.byIso2)) {
    if (c.ccn3) {
      numericToIso2[c.ccn3] = iso2;
      numericToIso3[c.ccn3] = c.cca3;
    }
  }

  if (geojsonLayer) geojsonLayer.remove();

  geojsonLayer = L.geoJSON(geojson, {
    style: feature => {
      const numId = String(feature.id).padStart(3, '0');
      const iso3 = numericToIso3[numId];
      const pvData = iso3 ? pvScores[iso3] : null;
      return {
        fillColor: stabilityFillColor(pvData ? pvData.value : null),
        weight: 0.5,
        opacity: 0.8,
        color: '#4b5563',
        fillOpacity: 0.75,
      };
    },
    onEachFeature: (feature, layer) => {
      const numId = String(feature.id).padStart(3, '0');
      const iso2 = numericToIso2[numId];
      const iso3 = numericToIso3[numId];
      const pvData = iso3 ? pvScores[iso3] : null;
      const countryData = iso2 ? countryIndex.byIso2[iso2] : null;

      layer.on({
        mouseover: e => {
          e.target.setStyle({ weight: 2, opacity: 1, fillOpacity: 0.9 });
          const name = countryData?.name?.common || 'Unknown';
          const score = pvData ? pvData.value.toFixed(2) : 'N/A';
          const year = pvData ? pvData.date : '';
          e.target.bindTooltip(
            `<b>${name}</b><br>Stability: ${score}${year ? ` (${year})` : ''}`,
            { sticky: true, className: 'custom-tooltip' }
          ).openTooltip();
        },
        mouseout: e => { geojsonLayer.resetStyle(e.target); },
        click: () => { if (iso2) onCountryClick(iso2); },
      });
    },
  }).addTo(map);
}

export function addEarthquakeMarkers(earthquakes) {
  eqLayerGroup.clearLayers();
  const alertColors = { green: '#22c55e', yellow: '#eab308', orange: '#f97316', red: '#ef4444' };
  for (const eq of earthquakes) {
    const color = alertColors[eq.alert] || '#6b7280';
    L.circleMarker([eq.lat, eq.lng], {
      radius: Math.max(5, eq.mag * 3.5),
      fillColor: color,
      color: '#fff',
      weight: 1.5,
      opacity: 0.9,
      fillOpacity: 0.8,
    })
      .bindTooltip(`<b>M${eq.mag}</b><br>${eq.place}<br>${eq.time.toLocaleDateString()}`, { className: 'custom-tooltip' })
      .addTo(eqLayerGroup);
  }
}

export function renderCountryList(countries, pvScores, riskScores, onCountryClick, selectedIso2 = null) {
  const container = document.getElementById('country-list');
  if (!container) return;

  const filtered = countries.filter(c => c.cca2 && c.name?.common);
  const sorted = [...filtered].sort((a, b) => (riskScores[b.cca2] || 0) - (riskScores[a.cca2] || 0));

  container.innerHTML = sorted.map(c => {
    const risk = riskScores[c.cca2] || 0;
    const color = riskColor(risk);
    const flag = c.flags?.emoji || '🏳';
    const isSelected = c.cca2 === selectedIso2;
    return `
      <div class="country-item${isSelected ? ' selected' : ''}" data-iso2="${c.cca2}">
        <span class="country-flag">${flag}</span>
        <div class="country-info">
          <span class="country-name">${c.name.common}</span>
          <span class="country-region">${c.subregion || c.region || ''}</span>
        </div>
        <div class="country-status">
          <span class="status-dot" style="background:${color}"></span>
          <span class="risk-score">${Math.round(risk)}</span>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.country-item').forEach(el => {
    el.addEventListener('click', () => { if (el.dataset.iso2) onCountryClick(el.dataset.iso2); });
  });
}

export function filterCountryList(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.country-item').forEach(el => {
    const name = el.querySelector('.country-name')?.textContent?.toLowerCase() || '';
    el.style.display = name.includes(q) ? '' : 'none';
  });
}

export function highlightCountry(iso2) {
  document.querySelectorAll('.country-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.iso2 === iso2);
  });
  // Scroll selected into view
  const selected = document.querySelector(`.country-item[data-iso2="${iso2}"]`);
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}
