let currentDistance = 500;

// CARTO Basemaps API Key
const CARTO_API_KEY = 'cb1_3z6j_1_74eb2f698e009c6d3c8fdc94';

// Identical finish line coordinate for both 200m and 500m (NWSC timing pontoon)
const COURSE_FINISH = { lat: 52.94125, lon: -1.09440 };
const START_500M = { lat: 52.9438, lon: -1.0884 };
const START_200M = { lat: 52.9421, lon: -1.0921 };

// Separate storage pools to avoid 200m and 500m data crossover
const uploadedRaces = {
  200: [],
  500: []
};

let map, mapLayers = {}, startMarker, charts = {};
const raceColorPalette = ['#38bdf8', '#f59e0b', '#ec4899', '#10b981', '#a855f7', '#fb923c', '#06b6d4', '#f43f5e', '#84cc16', '#eab308'];
let colorIdx = 0;

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseGPX(xmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");
  const trkpts = xml.querySelectorAll("trkpt");
  const pts = [];

  trkpts.forEach(pt => {
    const lat = parseFloat(pt.getAttribute("lat"));
    const lon = parseFloat(pt.getAttribute("lon"));
    const timeStr = pt.querySelector("time")?.textContent;
    const time = timeStr ? new Date(timeStr).getTime() : 0;
    const hrNode = pt.querySelector("hr");
    const hr = hrNode ? parseInt(hrNode.textContent) : null;
    if (!isNaN(lat) && !isNaN(lon)) {
      pts.push({ lat, lon, time, hr });
    }
  });
  return pts;
}

// Unified auto-detection: Anchors on the exact same finish point for both 200m and 500m
function extractRaceSegment(points, targetDist) {
  if (points.length < 5) return [];

  const n = points.length;

  // 1. Locate the true finish point at the SW timing tower
  let finishIdx = n - 1;
  let minFinishDist = Infinity;
  const searchStart = Math.max(0, Math.floor(n * 0.35));

  for (let i = searchStart; i < n; i++) {
    const d = haversine(points[i].lat, points[i].lon, COURSE_FINISH.lat, COURSE_FINISH.lon);
    if (d < minFinishDist) {
      minFinishDist = d;
      finishIdx = i;
    }
  }

  // Backtrack if watch was left recording while stationary post-finish
  while (finishIdx > 1) {
    const dt = (points[finishIdx].time - points[finishIdx - 1].time) / 1000;
    const dist = haversine(points[finishIdx - 1].lat, points[finishIdx - 1].lon, points[finishIdx].lat, points[finishIdx].lon);
    const speed = dt > 0 ? (dist / dt) * 3.6 : 0;
    if (speed < 5.0 && finishIdx > n * 0.5) {
      finishIdx--;
    } else {
      break;
    }
  }

  // 2. Measure cumulative distance backwards from finish to isolate target distance
  let distsFromStart = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    distsFromStart[i] = distsFromStart[i - 1] + haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }

  const totalDistAtFinish = distsFromStart[finishIdx];
  let startIdx = 0;
  for (let i = finishIdx; i >= 0; i--) {
    if (totalDistAtFinish - distsFromStart[i] >= targetDist) {
      startIdx = i;
      break;
    }
  }

  const raw = points.slice(startIdx, finishIdx + 1);
  if (raw.length < 2) return [];

  let trimmed = [];
  let runningDist = 0;
  const t0 = raw[0].time;

  for (let i = 0; i < raw.length; i++) {
    if (i > 0) {
      runningDist += haversine(raw[i - 1].lat, raw[i - 1].lon, raw[i].lat, raw[i].lon);
    }
    const dt = i > 0 ? (raw[i].time - raw[i - 1].time) / 1000 : 1;
    const dSeg = i > 0 ? haversine(raw[i - 1].lat, raw[i - 1].lon, raw[i].lat, raw[i].lon) : 0;
    const v_ms = (i > 0 && dt > 0) ? (dSeg / dt) : 2.8;
    const v_kmh = v_ms * 3.6;

    trimmed.push({
      lat: raw[i].lat,
      lon: raw[i].lon,
      elapsedTime: (raw[i].time - t0) / 1000,
      rawDist: runningDist,
      speed_kmh: v_kmh,
      speed_ms: v_ms,
      hr: raw[i].hr || 135
    });
  }

  // Linear interpolation to normalize distance strictly 0 -> targetDist
  const finalDist = trimmed[trimmed.length - 1].rawDist || targetDist;
  trimmed.forEach(pt => {
    pt.dist = (pt.rawDist / finalDist) * targetDist;
  });

  // Cadence Model (200m Sprint vs 500m Endurance)
  for (let i = 0; i < trimmed.length; i++) {
    const d = trimmed[i].dist;
    const v = trimmed[i].speed_ms;
    const hr = trimmed[i].hr;
    let baseCadence = 85;

    if (targetDist === 200) {
      if (d < 40) {
        baseCadence = 104 + ((1 - d / 40) * 12);
      } else if (d >= 40 && d < 140) {
        baseCadence = 90 + (v * 2.0);
      } else {
        baseCadence = 96 + (((d - 140) / 60) * 14);
      }
    } else {
      if (d < 60) {
        baseCadence = 96 + ((1 - d / 60) * 16);
      } else if (d >= 60 && d < 380) {
        baseCadence = 76 + (v * 2.2);
      } else {
        baseCadence = 84 + (((d - 380) / 120) * 18);
      }
    }

    const hrBump = hr > 150 ? (hr - 150) * 0.12 : 0;
    trimmed[i].cadence = Math.round(Math.min(120, Math.max(72, baseCadence + hrBump)));
    trimmed[i].pace_sec = v > 0.4 ? Math.min(220, Math.round(500 / v)) : 170;
  }

  return trimmed;
}

function initMap() {
  map = L.map('map', { zoomControl: true }).setView([52.9430, -1.0915], 15);
  
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  startMarker = L.circleMarker([START_500M.lat, START_500M.lon], {
    color: '#10b981', fillColor: '#10b981', radius: 6, fillOpacity: 0.9
  }).addTo(map).bindPopup('<b>Start Line</b>');

  L.circleMarker([COURSE_FINISH.lat, COURSE_FINISH.lon], {
    color: '#ef4444', fillColor: '#ef4444', radius: 6, fillOpacity: 0.9
  }).addTo(map).bindPopup('<b>Finish Line (Timing Tower)</b>');
}

function initCharts() {
  const commonCfg = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
      tooltip: {
        backgroundColor: '#020617',
        titleColor: '#f8fafc',
        bodyColor: '#cbd5e1',
        borderColor: '#334155',
        borderWidth: 1
      }
    },
    scales: {
      x: {
        type: 'linear',
        min: 0,
        max: currentDistance,
        title: { display: true, text: 'Distance (m)', color: '#64748b' },
        grid: { color: '#1e293b' },
        ticks: { color: '#94a3b8', stepSize: currentDistance === 200 ? 50 : 100 }
      },
      y: { grid: { color: '#1e293b' }, ticks: { color: '#94a3b8' } }
    }
  };

  charts.speed = new Chart(document.getElementById('speedChart'), {
    type: 'line', data: { datasets: [] },
    options: { ...commonCfg, scales: { ...commonCfg.scales, y: { ...commonCfg.scales.y, title: { display: true, text: 'km/h', color: '#64748b' } } } }
  });

  charts.hr = new Chart(document.getElementById('hrChart'), {
    type: 'line', data: { datasets: [] },
    options: { ...commonCfg, scales: { ...commonCfg.scales, y: { ...commonCfg.scales.y, title: { display: true, text: 'BPM', color: '#64748b' } } } }
  });

  charts.pace = new Chart(document.getElementById('paceChart'), {
    type: 'line', data: { datasets: [] },
    options: { ...commonCfg, scales: { ...commonCfg.scales, y: { ...commonCfg.scales.y, reverse: true, title: { display: true, text: 's / 500m Pace', color: '#64748b' } } } }
  });

  charts.cadence = new Chart(document.getElementById('cadenceChart'), {
    type: 'line', data: { datasets: [] },
    options: { ...commonCfg, scales: { ...commonCfg.scales, y: { ...commonCfg.scales.y, min: 65, max: 125, title: { display: true, text: 'Estimated SPM', color: '#64748b' } } } }
  });
}

function renderSplitsHeader() {
  const thead = document.getElementById('splitsTableHeader');
  if (currentDistance === 200) {
    thead.innerHTML = `
      <tr>
        <th class="p-2">Race</th>
        <th class="p-2 text-right">0-50m</th>
        <th class="p-2 text-right">50-100m</th>
        <th class="p-2 text-right">100-150m</th>
        <th class="p-2 text-right">150-200m</th>
        <th class="p-2 text-right font-bold text-white">Total</th>
      </tr>`;
  } else {
    thead.innerHTML = `
      <tr>
        <th class="p-2">Race</th>
        <th class="p-2 text-right">0-100m</th>
        <th class="p-2 text-right">100-200m</th>
        <th class="p-2 text-right">200-300m</th>
        <th class="p-2 text-right">300-400m</th>
        <th class="p-2 text-right">400-500m</th>
        <th class="p-2 text-right font-bold text-white">Total</th>
      </tr>`;
  }
}

function calculateSplits(pts, dist) {
  const marks = dist === 200 ? [50, 100, 150, 200] : [100, 200, 300, 400, 500];
  const splits = [];
  let prevTime = 0;
  marks.forEach(m => {
    const found = pts.find(p => p.dist >= m) || pts[pts.length - 1];
    splits.push((found.elapsedTime - prevTime).toFixed(1));
    prevTime = found.elapsedTime;
  });
  return splits;
}

function renderActiveDistanceView() {
  document.getElementById('metricCards').innerHTML = '';
  document.getElementById('splitsTableBody').innerHTML = '';
  document.getElementById('raceToggles').innerHTML = '';
  Object.values(mapLayers).forEach(l => map.removeLayer(l));
  mapLayers = {};

  const startCoord = currentDistance === 200 ? START_200M : START_500M;
  startMarker.setLatLng([startCoord.lat, startCoord.lon]);
  startMarker.setPopupContent(`<b>${currentDistance}m Start Line</b>`);
  document.getElementById('mapVectorBadge').textContent = `${currentDistance}m Lane Vector (NE → SW)`;
  document.getElementById('paceChartTitle').textContent = `Split Pace (Seconds per ${currentDistance}m)`;
  document.getElementById('uploadBtnText').textContent = `📂 Load ${currentDistance}m GPX (Max 10)`;

  Object.values(charts).forEach(c => {
    c.data.datasets = [];
    c.options.scales.x.max = currentDistance;
    c.options.scales.x.ticks.stepSize = currentDistance === 200 ? 50 : 100;
  });

  renderSplitsHeader();

  if (currentDistance === 200) {
    document.getElementById('strategyTitle').textContent = "200m Sprint Dynamics:";
    document.getElementById('strategyText').textContent = "Focuses on explosive start blocks (0-50m), holding peak boat speed through the middle 100m, and resisting lactic fade in the final 50m.";
  } else {
    document.getElementById('strategyTitle').textContent = "500m Race Strategy:";
    document.getElementById('strategyText').textContent = "Compares initial start burst, boat glide efficiency across the 200m–400m cruise phase, and the 400m finish kick.";
  }

  const activeList = uploadedRaces[currentDistance];
  activeList.forEach(item => {
    addRaceToDashboard(item.name, item.trimmed, item.color);
  });
}

function addRaceToDashboard(name, pts, color) {
  if (!pts || pts.length === 0) return;
  const raceId = 'race_' + Math.random().toString(36).substr(2, 9);

  const latlngs = pts.map(p => [p.lat, p.lon]);
  const layer = L.polyline(latlngs, { color: color, weight: 4, opacity: 0.9 }).addTo(map);
  mapLayers[raceId] = layer;
  map.fitBounds(layer.getBounds(), { padding: [25, 25] });

  const speedPts = pts.map(p => ({ x: Math.round(p.dist), y: parseFloat(p.speed_kmh.toFixed(2)) }));
  const hrPts = pts.filter(p => p.hr).map(p => ({ x: Math.round(p.dist), y: p.hr }));
  const pacePts = pts.map(p => ({ x: Math.round(p.dist), y: Math.round(p.pace_sec) }));
  const cadPts = pts.map(p => ({ x: Math.round(p.dist), y: p.cadence }));

  const dsBase = {
    id: raceId,
    label: name,
    borderColor: color,
    backgroundColor: color,
    pointRadius: 0,
    tension: 0.35,
    borderWidth: 2
  };

  charts.speed.data.datasets.push({ ...dsBase, data: speedPts });
  charts.hr.data.datasets.push({ ...dsBase, data: hrPts });
  charts.pace.data.datasets.push({ ...dsBase, data: pacePts });
  charts.cadence.data.datasets.push({ ...dsBase, data: cadPts });

  Object.values(charts).forEach(c => c.update());

  const totalTime = pts[pts.length - 1].elapsedTime;
  const avgSpeed = (pts.reduce((a, b) => a + b.speed_kmh, 0) / pts.length).toFixed(1);
  const maxSpeed = Math.max(...pts.map(p => p.speed_kmh)).toFixed(1);
  const maxHr = Math.max(...pts.map(p => p.hr || 0));

  const card = document.createElement('div');
  card.className = "bg-slate-900/90 p-4 rounded-xl border border-slate-800 shadow-xl relative overflow-hidden";
  card.innerHTML = `
    <div class="absolute top-0 left-0 w-1.5 h-full" style="background:${color}"></div>
    <div class="flex justify-between items-start">
      <span class="text-xs font-semibold uppercase tracking-wider text-slate-400 truncate max-w-[150px]">${name}</span>
      <span class="text-xs font-bold px-2 py-0.5 rounded" style="color:${color}; background:${color}18">${currentDistance}M</span>
    </div>
    <div class="mt-2 flex items-baseline gap-2">
      <span class="text-2xl font-black text-white">${Math.floor(totalTime / 60)}:${(totalTime % 60).toFixed(1).padStart(4, '0')}</span>
      <span class="text-xs text-slate-400">official run</span>
    </div>
    <div class="mt-3 grid grid-cols-2 gap-2 text-xs border-t border-slate-800 pt-2 text-slate-300">
      <div>Avg: <span class="font-semibold text-white">${avgSpeed} km/h</span></div>
      <div>Max: <span class="font-semibold text-white">${maxSpeed} km/h</span></div>
      <div class="col-span-2">Peak HR: <span class="font-semibold text-white">${maxHr > 0 ? maxHr + ' bpm' : 'N/A'}</span></div>
    </div>
  `;
  document.getElementById('metricCards').appendChild(card);

  const splits = calculateSplits(pts, currentDistance);
  const tr = document.createElement('tr');
  tr.className = "hover:bg-slate-800/50 transition";
  let splitCols = splits.map(s => `<td class="p-2 text-right">${s}s</td>`).join('');
  tr.innerHTML = `
    <td class="p-2 font-medium flex items-center gap-1.5">
      <span class="w-2.5 h-2.5 rounded-full inline-block" style="background:${color}"></span>
      <span class="truncate max-w-[120px]">${name}</span>
    </td>
    ${splitCols}
    <td class="p-2 text-right font-bold text-white">${totalTime.toFixed(1)}s</td>
  `;
  document.getElementById('splitsTableBody').appendChild(tr);

  const toggle = document.createElement('label');
  toggle.className = "flex items-center gap-1.5 text-xs bg-slate-900 hover:bg-slate-800 px-2.5 py-1.5 rounded-lg border border-slate-800 cursor-pointer transition select-none";
  toggle.innerHTML = `
    <input type="checkbox" checked class="rounded border-slate-700 text-sky-500 focus:ring-0" />
    <span class="w-2 h-2 rounded-full" style="background:${color}"></span>
    <span>${name}</span>
  `;
  toggle.querySelector('input').addEventListener('change', (e) => {
    const visible = e.target.checked;
    if (visible) map.addLayer(mapLayers[raceId]);
    else map.removeLayer(mapLayers[raceId]);

    Object.values(charts).forEach(c => {
      const target = c.data.datasets.find(d => d.id === raceId);
      if (target) target.hidden = !visible;
      c.update();
    });
  });
  document.getElementById('raceToggles').appendChild(toggle);
}

function switchDistance(newDist) {
  if (currentDistance === newDist) return;
  currentDistance = newDist;

  if (newDist === 500) {
    document.getElementById('btn500').className = "px-3 py-1 rounded-md transition bg-sky-600 text-white shadow";
    document.getElementById('btn200').className = "px-3 py-1 rounded-md transition text-slate-400 hover:text-white";
  } else {
    document.getElementById('btn200').className = "px-3 py-1 rounded-md transition bg-sky-600 text-white shadow";
    document.getElementById('btn500').className = "px-3 py-1 rounded-md transition text-slate-400 hover:text-white";
  }

  renderActiveDistanceView();

  if (uploadedRaces[currentDistance].length === 0) {
    setTimeout(() => {
      alert(`No ${currentDistance}m GPX files loaded yet. Please click "📂 Load ${currentDistance}m GPX" to select up to 10 races.`);
      document.getElementById('fileInput').click();
    }, 100);
  }
}

document.getElementById('btn500').addEventListener('click', () => switchDistance(500));
document.getElementById('btn200').addEventListener('click', () => switchDistance(200));

// File input handler with 10-file restriction
document.getElementById('fileInput').addEventListener('change', (e) => {
  const selectedFiles = Array.from(e.target.files);
  if (selectedFiles.length === 0) return;

  const currentPool = uploadedRaces[currentDistance];
  if (currentPool.length + selectedFiles.length > 10) {
    alert(`You can only load up to 10 files for ${currentDistance}m races. Currently loaded: ${currentPool.length}. Please select fewer files.`);
    e.target.value = '';
    return;
  }

  let loadedCount = 0;
  selectedFiles.forEach(file => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const rawPts = parseGPX(event.target.result);
      const trimmed = extractRaceSegment(rawPts, currentDistance);
      const col = raceColorPalette[colorIdx++ % raceColorPalette.length];
      const cleanName = file.name.replace('.gpx', '').replace(/2026 National Premier Mixd (500m|200m) - /g, '');

      currentPool.push({
        name: cleanName,
        rawPoints: rawPts,
        trimmed: trimmed,
        color: col
      });

      loadedCount++;
      if (loadedCount === selectedFiles.length) {
        renderActiveDistanceView();
      }
    };
    reader.readAsText(file);
  });

  e.target.value = '';
});

window.addEventListener('DOMContentLoaded', () => {
  initMap();
  initCharts();
  renderSplitsHeader();
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 200);
});

window.addEventListener('resize', () => {
  if (map) map.invalidateSize();
});