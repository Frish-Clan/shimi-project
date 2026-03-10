import { riskColor, stabilityColor } from '../utils/colorScale.js';

let tableData = [];
let sortColumn = 'risk';
let sortDir = 'desc';
let _onCountryClick = null;

export function renderRiskOverview(countries, countryIndex, pvScores, riskScores, earthquakes, wbMeta, ciiScores, climateAnomalies, onCountryClick) {
  _onCountryClick = onCountryClick;

  tableData = countries
    .filter(c => c.cca2 && c.cca3)
    .map(c => {
      const pvData = pvScores[c.cca3];
      const wb = wbMeta[c.cca2] || {};
      const [lat, lng] = c.latlng || [0, 0];
      const quakeCount = earthquakes.filter(q =>
        Math.abs(q.lat - lat) < 15 && Math.abs(q.lng - lng) < 15
      ).length;
      return {
        iso2: c.cca2,
        name: c.name?.common || 'Unknown',
        flag: c.flags?.emoji || '🏳',
        region: wb.region || c.region || '',
        pvScore: pvData?.value ?? null,
        pvDate: pvData?.date || '',
        quakeCount,
        risk: riskScores[c.cca2] || 0,
        cii: ciiScores[c.cca2] || null,
        population: c.population || 0,
      };
    });

  renderSummary();
  renderTable();
}

function renderSummary() {
  const critical = tableData.filter(d => d.risk >= 70).length;
  const high = tableData.filter(d => d.risk >= 50 && d.risk < 70).length;
  const elevated = tableData.filter(d => d.risk >= 30 && d.risk < 50).length;
  const stable = tableData.filter(d => d.risk < 30).length;
  const el = document.getElementById('risk-summary');
  if (el) el.innerHTML = `
    <div class="summary-stats">
      <span class="stat critical">${critical} Critical</span>
      <span class="stat high">${high} High</span>
      <span class="stat elevated">${elevated} Elevated</span>
      <span class="stat stable">${stable} Stable</span>
      <span class="stat total">${tableData.length} Countries</span>
    </div>`;
}

function renderTable() {
  const container = document.getElementById('risk-table-container');
  if (!container) return;

  const sorted = [...tableData].sort((a, b) => {
    let va = a[sortColumn], vb = b[sortColumn];
    if (va === null) va = sortDir === 'asc' ? Infinity : -Infinity;
    if (vb === null) vb = sortDir === 'asc' ? Infinity : -Infinity;
    if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const sortIndicator = col => sortColumn === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  container.innerHTML = `
    <table class="risk-table">
      <thead>
        <tr>
          <th class="sortable" data-col="name">Country${sortIndicator('name')}</th>
          <th class="sortable" data-col="region">Region${sortIndicator('region')}</th>
          <th class="sortable" data-col="pvScore">Stability${sortIndicator('pvScore')}</th>
          <th class="sortable" data-col="quakeCount">Seismic${sortIndicator('quakeCount')}</th>
          <th class="sortable" data-col="cii">Instability Index${sortIndicator('cii')}</th>
          <th class="sortable" data-col="risk">Risk Score${sortIndicator('risk')}</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(row => `
          <tr class="risk-row" data-iso2="${row.iso2}">
            <td><span class="flag-emoji">${row.flag}</span><span class="country-name-cell">${row.name}</span></td>
            <td><span class="region-badge">${row.region}</span></td>
            <td>${row.pvScore !== null
              ? `<span class="pv-score" style="color:${stabilityColor(row.pvScore)}">${row.pvScore.toFixed(2)}</span><span class="pv-year">${row.pvDate}</span>`
              : '<span class="no-data">N/A</span>'}</td>
            <td>${row.quakeCount > 0
              ? `<span class="quake-count">${row.quakeCount}</span>`
              : '<span class="no-data">—</span>'}</td>
            <td>${row.cii !== null
              ? `<span class="cii-score">${row.cii}</span>`
              : '<span class="no-data">N/A</span>'}</td>
            <td>
              <div class="risk-score-cell">
                <div class="risk-bar-track"><div class="risk-bar" style="width:${row.risk}%;background:${riskColor(row.risk)}"></div></div>
                <span class="risk-value" style="color:${riskColor(row.risk)}">${Math.round(row.risk)}</span>
              </div>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  container.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortColumn === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = col;
        sortDir = (col === 'name' || col === 'region') ? 'asc' : 'desc';
      }
      renderTable();
    });
  });

  container.querySelectorAll('.risk-row').forEach(row => {
    row.addEventListener('click', () => { if (_onCountryClick && row.dataset.iso2) _onCountryClick(row.dataset.iso2); });
  });
}
