const charts = {};

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

const darkScales = {
  y: { grid: { color: '#2d3748' }, ticks: { color: '#9ca3af' } },
  x: { grid: { color: '#2d3748' }, ticks: { color: '#9ca3af', maxRotation: 45 } },
};

const darkPlugins = {
  legend: { labels: { color: '#e5e7eb', font: { size: 11 } } },
};

function parseDate(raw) {
  // GDELT dates come as "20240312120000" or ISO string
  if (!raw) return new Date();
  const s = String(raw);
  if (s.length >= 8 && /^\d+$/.test(s)) {
    return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
  }
  return new Date(raw);
}

export function renderDefaultCharts(globalTimelineData) {
  document.getElementById('chart-panel-title').textContent = 'Global Conflict Trends';

  destroyChart('chart-conflict');
  const ctx = document.getElementById('chart-conflict')?.getContext('2d');
  if (ctx) {
    const labels = globalTimelineData.map(d => {
      const dt = parseDate(d.date);
      return `${dt.getMonth() + 1}/${dt.getDate()}`;
    });
    charts['chart-conflict'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Global Conflict Volume',
          data: globalTimelineData.map(d => d.value),
          backgroundColor: 'rgba(239,68,68,0.55)',
          borderColor: '#ef4444',
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: darkPlugins,
        scales: darkScales,
      },
    });
  }

  // Clear other charts
  ['chart-stability', 'chart-radar', 'chart-seismic'].forEach(id => {
    destroyChart(id);
    const el = document.getElementById(id);
    if (el) {
      const ctx2 = el.getContext('2d');
      ctx2.clearRect(0, 0, el.width, el.height);
    }
  });

  // Show placeholder text on empty charts
  const placeholders = {
    'chart-stability': 'Select a country to view political stability trend',
    'chart-radar': 'Select a country to view governance radar',
    'chart-seismic': 'Select a country to view seismic activity',
  };
  for (const [id, msg] of Object.entries(placeholders)) {
    const card = document.getElementById(id)?.closest('.chart-card');
    if (card) {
      let ph = card.querySelector('.chart-placeholder');
      if (!ph) {
        ph = document.createElement('div');
        ph.className = 'chart-placeholder';
        card.querySelector('.chart-container').appendChild(ph);
      }
      ph.textContent = msg;
      ph.style.display = '';
    }
  }
}

export function renderDynamicCharts({ country, govData, timelineData, earthquakes }) {
  const name = country.name?.common || '';
  document.getElementById('chart-panel-title').textContent = `${name} — Geopolitical Analysis`;

  // Hide all placeholders
  document.querySelectorAll('.chart-placeholder').forEach(el => { el.style.display = 'none'; });

  renderConflictChart(timelineData, name);
  renderStabilityChart(govData.pvEst || []);
  renderRadarChart(govData);
  renderSeismicChart(earthquakes, country.latlng || [0, 0]);
}

function renderConflictChart(timelineData, countryName) {
  destroyChart('chart-conflict');
  const ctx = document.getElementById('chart-conflict')?.getContext('2d');
  if (!ctx) return;

  if (!timelineData.length) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    showChartMsg('chart-conflict', 'No GDELT conflict data available');
    return;
  }

  const labels = timelineData.map(d => {
    const dt = parseDate(d.date);
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  });

  const maxVal = Math.max(...timelineData.map(d => d.value), 1);

  charts['chart-conflict'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: `Conflict News Volume — ${countryName}`,
        data: timelineData.map(d => d.value),
        backgroundColor: timelineData.map(d => {
          const v = d.value / maxVal;
          if (v > 0.75) return 'rgba(239,68,68,0.75)';
          if (v > 0.5) return 'rgba(249,115,22,0.75)';
          if (v > 0.25) return 'rgba(234,179,8,0.75)';
          return 'rgba(59,130,246,0.65)';
        }),
        borderWidth: 0,
        borderRadius: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        ...darkPlugins,
        tooltip: { callbacks: { label: item => `Volume: ${item.raw.toFixed(2)}` } },
      },
      scales: darkScales,
    },
  });
}

function renderStabilityChart(pvHistory) {
  destroyChart('chart-stability');
  const ctx = document.getElementById('chart-stability')?.getContext('2d');
  if (!ctx) return;

  if (!pvHistory.length) { showChartMsg('chart-stability', 'No World Bank stability data available'); return; }

  charts['chart-stability'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: pvHistory.map(d => d.year),
      datasets: [{
        label: 'Political Stability (PV.EST)',
        data: pvHistory.map(d => d.value),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: 5,
        pointBackgroundColor: pvHistory.map(d => d.value >= 0 ? '#22c55e' : '#ef4444'),
        pointBorderColor: '#1e2130',
        pointBorderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: darkPlugins,
      scales: {
        y: {
          min: -2.5, max: 2.5,
          grid: {
            color: ctx2 => ctx2.tick.value === 0 ? '#6b7280' : '#2d3748',
          },
          ticks: { color: '#9ca3af' },
        },
        x: { grid: { color: '#2d3748' }, ticks: { color: '#9ca3af' } },
      },
    },
  });
}

function renderRadarChart(govData) {
  destroyChart('chart-radar');
  const ctx = document.getElementById('chart-radar')?.getContext('2d');
  if (!ctx) return;

  const indicators = [
    { key: 'pvEst', label: 'Stability' },
    { key: 'geEst', label: 'Gov. Effectiveness' },
    { key: 'ccEst', label: 'Anti-Corruption' },
    { key: 'rlEst', label: 'Rule of Law' },
    { key: 'rqEst', label: 'Reg. Quality' },
  ];

  const hasData = indicators.some(ind => govData[ind.key]?.length > 0);
  if (!hasData) { showChartMsg('chart-radar', 'No governance indicator data available'); return; }

  const values = indicators.map(ind => {
    const history = govData[ind.key] || [];
    if (!history.length) return 50;
    const latest = history[history.length - 1].value;
    return Math.round(((latest + 2.5) / 5) * 100);
  });

  charts['chart-radar'] = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: indicators.map(i => i.label),
      datasets: [
        {
          label: 'Country',
          data: values,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.2)',
          pointBackgroundColor: '#3b82f6',
          pointBorderColor: '#1e2130',
          borderWidth: 2,
        },
        {
          label: 'World Avg (0)',
          data: [50, 50, 50, 50, 50],
          borderColor: '#4b5563',
          backgroundColor: 'rgba(75,85,99,0.08)',
          borderDash: [5, 5],
          pointBackgroundColor: '#4b5563',
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: darkPlugins,
      scales: {
        r: {
          min: 0, max: 100,
          grid: { color: '#2d3748' },
          angleLines: { color: '#374151' },
          pointLabels: { color: '#9ca3af', font: { size: 10 } },
          ticks: { display: false, stepSize: 25 },
        },
      },
    },
  });
}

function renderSeismicChart(earthquakes, [lat, lng]) {
  destroyChart('chart-seismic');
  const ctx = document.getElementById('chart-seismic')?.getContext('2d');
  if (!ctx) return;

  const nearby = earthquakes.filter(q =>
    Math.abs(q.lat - lat) < 20 && Math.abs(q.lng - lng) < 20
  );

  if (!nearby.length) {
    showChartMsg('chart-seismic', 'No significant seismic activity (7d) near this country');
    return;
  }

  const now = Date.now();
  const weekMs = 7 * 24 * 3600 * 1000;
  const alertColors = { green: '#22c55e', yellow: '#eab308', orange: '#f97316', red: '#ef4444' };

  charts['chart-seismic'] = new Chart(ctx, {
    type: 'bubble',
    data: {
      datasets: [{
        label: 'Earthquakes',
        data: nearby.map(q => ({
          x: Math.max(0, 7 - (now - q.time.getTime()) / (weekMs / 7)),
          y: q.mag,
          r: Math.max(4, q.mag * 3),
          _eq: q,
        })),
        backgroundColor: nearby.map(q => alertColors[q.alert] || '#6b7280'),
        borderColor: 'rgba(255,255,255,0.4)',
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: item => {
              const eq = item.raw._eq;
              return [`M${eq.mag} — ${eq.place}`, eq.time.toLocaleString()];
            },
          },
        },
      },
      scales: {
        x: {
          min: 0, max: 7,
          title: { display: true, text: 'Days ago', color: '#9ca3af' },
          grid: { color: '#2d3748' },
          ticks: { color: '#9ca3af', callback: v => `${(7 - v).toFixed(0)}d` },
        },
        y: {
          title: { display: true, text: 'Magnitude', color: '#9ca3af' },
          grid: { color: '#2d3748' },
          ticks: { color: '#9ca3af' },
        },
      },
    },
  });
}

function showChartMsg(canvasId, msg) {
  const card = document.getElementById(canvasId)?.closest('.chart-card');
  if (!card) return;
  let ph = card.querySelector('.chart-placeholder');
  if (!ph) {
    ph = document.createElement('div');
    ph.className = 'chart-placeholder';
    card.querySelector('.chart-container').appendChild(ph);
  }
  ph.textContent = msg;
  ph.style.display = '';
}
