/**
 * Dragon Boat Multiple GPX Analyser Engine
 * Compares multiple race recordings against a reference course (mroute_*.gpx)
 */

// CARTO Basemaps API Key
const CARTO_API_KEY = 'cb1_3z6j_1_74eb2f698e009c6d3c8fdc94';

// 10 Distinct Accessible Color Palette for Races
const RACE_COLORS = [
  '#38bdf8', // Sky Blue
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#10b981', // Emerald
  '#a855f7', // Purple
  '#fb923c', // Orange
  '#06b6d4', // Cyan
  '#f43f5e', // Rose
  '#84cc16', // Lime
  '#eab308', // Yellow
  '#6366f1', // Indigo
  '#14b8a6'  // Teal
];

// Built-in Default Reference Route 1 (Nottingham NWSC 500m)
const DEFAULT_NOTTINGHAM_500M_ROUTE = {
  id: "mroute_nottingham_500m",
  name: "Nottingham NWSC 500m",
  filename: "mroute_nottingham_500m.gpx",
  points: [
    { lat: 52.94380, lon: -1.08840, ele: 20.0 },
    { lat: 52.94329, lon: -1.08960, ele: 20.0 },
    { lat: 52.94278, lon: -1.09080, ele: 20.0 },
    { lat: 52.94227, lon: -1.09200, ele: 20.0 },
    { lat: 52.94176, lon: -1.09320, ele: 20.0 },
    { lat: 52.94125, lon: -1.09440, ele: 20.0 }
  ]
};

// Built-in Default Reference Route 2 (Nottingham NWSC 200m)
const DEFAULT_NOTTINGHAM_200M_ROUTE = {
  id: "mroute_nottingham_200m",
  name: "Nottingham NWSC 200m",
  filename: "mroute_nottingham_200m.gpx",
  points: [
    { lat: 52.94225, lon: -1.09200, ele: 20.0 },
    { lat: 52.94200, lon: -1.09260, ele: 20.0 },
    { lat: 52.94175, lon: -1.09320, ele: 20.0 },
    { lat: 52.94150, lon: -1.09380, ele: 20.0 },
    { lat: 52.94125, lon: -1.09440, ele: 20.0 }
  ]
};

// Built-in Default Reference Route 3 (Kingston Bridge to Island 500m)
const DEFAULT_KINGSTON_500M_ROUTE = {
  id: "mroute_kingston_500m",
  name: "Kingston Bridge to Island 500m",
  filename: "mroute_kingston_500m.gpx",
  points: [
    { lat: 51.414790, lon: -0.308230, ele: 5.04 },
    { lat: 51.415557, lon: -0.308020, ele: 4.82 },
    { lat: 51.416323, lon: -0.307810, ele: 4.92 },
    { lat: 51.417090, lon: -0.307600, ele: 5.14 },
    { lat: 51.417847, lon: -0.307267, ele: 4.82 },
    { lat: 51.418603, lon: -0.306933, ele: 5.01 },
    { lat: 51.419360, lon: -0.306600, ele: 4.78 }
  ]
};

// Global App State
let state = {
  routes: {},
  activeRouteId: null,
  activeRouteData: null,
  uploadedRaces: [], // Array of race objects: { id, filename, name, color, visible, rawPoints, processed }
  gateRadius: 35, // meters
  minRaceDistance: 150, // meters
  map: null,
  mapLayers: {},
  charts: {}
};

// Haversine distance in meters
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Format seconds into MM:SS.SS or SS.S
function formatTime(sec) {
  if (isNaN(sec) || sec === null || sec === undefined) return '--';
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2);
  return m > 0 ? `${m}:${s.padStart(5, '0')}` : `${s}s`;
}

// -------------------------------------------------------------
// Reference Route Management (Storage, Parsing, Auto-Discovery)
// -------------------------------------------------------------

function initRouteStorage() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem('workout_analyser_mroutes') || localStorage.getItem('race_analyser_mroutes'));
  } catch (e) {
    console.warn('Failed to read mroutes from localStorage', e);
  }

  if (!saved || typeof saved !== 'object' || Object.keys(saved).length === 0) {
    state.routes = {
      [DEFAULT_NOTTINGHAM_500M_ROUTE.id]: DEFAULT_NOTTINGHAM_500M_ROUTE,
      [DEFAULT_NOTTINGHAM_200M_ROUTE.id]: DEFAULT_NOTTINGHAM_200M_ROUTE,
      [DEFAULT_KINGSTON_500M_ROUTE.id]: DEFAULT_KINGSTON_500M_ROUTE
    };
    saveRoutesToStorage();
  } else {
    state.routes = saved;
    let changed = false;
    if (!state.routes[DEFAULT_NOTTINGHAM_500M_ROUTE.id]) {
      state.routes[DEFAULT_NOTTINGHAM_500M_ROUTE.id] = DEFAULT_NOTTINGHAM_500M_ROUTE;
      changed = true;
    }
    if (!state.routes[DEFAULT_NOTTINGHAM_200M_ROUTE.id]) {
      state.routes[DEFAULT_NOTTINGHAM_200M_ROUTE.id] = DEFAULT_NOTTINGHAM_200M_ROUTE;
      changed = true;
    }
    if (!state.routes[DEFAULT_KINGSTON_500M_ROUTE.id]) {
      state.routes[DEFAULT_KINGSTON_500M_ROUTE.id] = DEFAULT_KINGSTON_500M_ROUTE;
      changed = true;
    }
    if (changed) saveRoutesToStorage();
  }

  const activeId = localStorage.getItem('workout_analyser_active_mroute') || localStorage.getItem('race_analyser_active_mroute') || DEFAULT_NOTTINGHAM_500M_ROUTE.id;
  setActiveRoute(state.routes[activeId] ? activeId : DEFAULT_NOTTINGHAM_500M_ROUTE.id);
}

function saveRoutesToStorage() {
  try {
    localStorage.setItem('workout_analyser_mroutes', JSON.stringify(state.routes));
  } catch (e) {
    console.warn('Could not save mroutes to localStorage', e);
  }
}

// Automatically discovers and loads all mroute_*.gpx from ./routes/ directory
async function loadServerRoutes(notify = false) {
  const discoveredFilenames = new Set();

  // 1. Try to fetch routes/mroutes.json or routes/routes.json manifest
  try {
    const res = await fetch('routes/mroutes.json', { cache: 'no-cache' });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        list.forEach(f => {
          if (typeof f === 'string' && f.toLowerCase().startsWith('mroute_') && f.toLowerCase().endsWith('.gpx')) {
            discoveredFilenames.add(f);
          }
        });
      }
    }
  } catch (err) {
    console.debug('mroutes.json not directly accessible:', err);
  }

  // Fallback check routes/routes.json for any mroute_*.gpx
  try {
    const res2 = await fetch('routes/routes.json', { cache: 'no-cache' });
    if (res2.ok) {
      const list2 = await res2.json();
      if (Array.isArray(list2)) {
        list2.forEach(f => {
          if (typeof f === 'string' && f.toLowerCase().startsWith('mroute_') && f.toLowerCase().endsWith('.gpx')) {
            discoveredFilenames.add(f);
          }
        });
      }
    }
  } catch (e) {}

  // 2. Try fetching directory listing if server supports it
  try {
    const dirRes = await fetch('routes/', { cache: 'no-cache' });
    if (dirRes.ok) {
      const htmlText = await dirRes.text();
      const matches = htmlText.match(/href=["'](mroute_[^"'\s>]+\.gpx)["']/gi);
      if (matches) {
        matches.forEach(m => {
          const matchName = m.replace(/href=["']/i, '').replace(/["']$/i, '');
          if (matchName) discoveredFilenames.add(matchName);
        });
      }
    }
  } catch (e) {}

  // 3. Always include known default route filenames as baseline
  discoveredFilenames.add('mroute_nottingham_500m.gpx');
  discoveredFilenames.add('mroute_nottingham_200m.gpx');
  discoveredFilenames.add('mroute_kingston_500m.gpx');

  // 4. Fetch and parse each route GPX file
  let loadedCount = 0;
  for (const filename of discoveredFilenames) {
    try {
      const gpxRes = await fetch(`routes/${filename}`, { cache: 'no-cache' });
      if (gpxRes.ok) {
        const xmlText = await gpxRes.text();
        const parsed = parseRouteGPX(xmlText, filename);
        if (parsed && parsed.points && parsed.points.length >= 2) {
          state.routes[parsed.id] = parsed;
          loadedCount++;
        }
      }
    } catch (err) {
      console.debug(`Could not load route file routes/${filename}:`, err);
    }
  }

  if (loadedCount > 0) {
    saveRoutesToStorage();
    const currentActive = state.activeRouteId;
    if (!currentActive || !state.routes[currentActive]) {
      const firstId = Object.keys(state.routes)[0];
      setActiveRoute(firstId);
    } else {
      updateRouteUI();
    }
    if (notify) {
      showToast(`Loaded ${loadedCount} reference route(s) from server!`);
    }
  } else if (notify) {
    showToast("No additional routes found on server.");
  }
}

function setActiveRoute(routeId) {
  if (!state.routes[routeId]) return;
  state.activeRouteId = routeId;
  localStorage.setItem('workout_analyser_active_mroute', routeId);

  const rawRoute = state.routes[routeId];
  state.activeRouteData = processRouteGeometry(rawRoute);

  updateRouteUI();

  // If races are already uploaded, re-align and re-analyze all races against new route
  if (state.uploadedRaces.length > 0) {
    reanalyzeAllRaces();
  } else if (state.map) {
    renderReferenceRouteOnMap();
  }
}

// Precomputes geometry and cumulative distances along route polyline
function processRouteGeometry(route) {
  const pts = route.points;
  let cumDists = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
    total += d;
    cumDists.push(total);
  }

  const lats = pts.map(p => p.lat);
  const lons = pts.map(p => p.lon);

  return {
    ...route,
    totalDist: total,
    cumDists,
    startPoint: pts[0],
    endPoint: pts[pts.length - 1],
    bounds: [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)]
    ]
  };
}

// Project point onto polyline; returns alongDist (m from start) and crossDist (m from centerline)
function projectPointOnRoute(p, routePts, cumDists) {
  let minCrossDist = Infinity;
  let bestAlongDist = 0;
  const pts = routePts;
  const dists = cumDists;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const segLen = dists[i + 1] - dists[i];
    if (segLen <= 0.001) continue;

    const midLat = (a.lat + b.lat) / 2 * (Math.PI / 180);
    const mPerDegLat = 111132.95;
    const mPerDegLon = 111132.95 * Math.cos(midLat);

    const vx = (b.lon - a.lon) * mPerDegLon;
    const vy = (b.lat - a.lat) * mPerDegLat;
    const px = (p.lon - a.lon) * mPerDegLon;
    const py = (p.lat - a.lat) * mPerDegLat;

    const segLenSq = vx * vx + vy * vy;
    const t = (px * vx + py * vy) / segLenSq;

    if (i === 0 && t < 0) {
      const projX = t * vx;
      const projY = t * vy;
      const cross = Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));
      if (cross < minCrossDist) {
        minCrossDist = cross;
        bestAlongDist = t * segLen;
      }
    } else if (i === pts.length - 2 && t > 1) {
      const projX = t * vx;
      const projY = t * vy;
      const cross = Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));
      if (cross < minCrossDist) {
        minCrossDist = cross;
        bestAlongDist = dists[i] + t * segLen;
      }
    } else {
      const tClamped = Math.max(0, Math.min(1, t));
      const projX = tClamped * vx;
      const projY = tClamped * vy;
      const cross = Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));
      if (cross < minCrossDist) {
        minCrossDist = cross;
        bestAlongDist = dists[i] + tClamped * segLen;
      }
    }
  }

  return { alongDist: bestAlongDist, crossDist: minCrossDist };
}

// Parse GPX text for Reference Route (trk, rte, or wpt)
function parseRouteGPX(xmlText, filename = '') {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");

  let routeName = '';
  const metaName = xml.querySelector("metadata > name");
  const trkName = xml.querySelector("trk > name");
  const rteName = xml.querySelector("rte > name");

  if (metaName && metaName.textContent.trim()) {
    routeName = metaName.textContent.trim();
  } else if (trkName && trkName.textContent.trim()) {
    routeName = trkName.textContent.trim();
  } else if (rteName && rteName.textContent.trim()) {
    routeName = rteName.textContent.trim();
  } else if (filename) {
    routeName = filename
      .replace(/\.gpx$/i, '')
      .replace(/^[mr]route_/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  } else {
    routeName = "Custom Route " + new Date().toLocaleDateString();
  }

  let trkpts = Array.from(xml.querySelectorAll("trkpt"));
  if (trkpts.length === 0) {
    trkpts = Array.from(xml.querySelectorAll("rtept"));
  }

  const points = [];
  trkpts.forEach(pt => {
    const lat = parseFloat(pt.getAttribute("lat"));
    const lon = parseFloat(pt.getAttribute("lon"));
    const eleNode = pt.querySelector("ele");
    const ele = eleNode ? parseFloat(eleNode.textContent) : 0;
    if (!isNaN(lat) && !isNaN(lon)) {
      points.push({ lat, lon, ele });
    }
  });

  if (points.length < 2) {
    throw new Error("GPX file must contain at least 2 coordinate points");
  }

  const cleanBase = filename
    ? filename.replace(/\.gpx$/i, '').toLowerCase().replace(/^[mr]route_+/i, '').replace(/[^a-z0-9_]/g, '_')
    : Math.random().toString(36).substr(2, 9);
  const id = `mroute_${cleanBase}`;

  return {
    id,
    name: routeName,
    filename: filename || `${id}.gpx`,
    points
  };
}

// -------------------------------------------------------------
// Race GPX Parsing & Alignment Engine
// -------------------------------------------------------------

function parseRaceGPX(xmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");
  const trkpts = Array.from(xml.querySelectorAll("trkpt"));
  const pts = [];

  trkpts.forEach(pt => {
    const lat = parseFloat(pt.getAttribute("lat"));
    const lon = parseFloat(pt.getAttribute("lon"));
    const timeStr = pt.querySelector("time")?.textContent;
    const time = timeStr ? new Date(timeStr).getTime() : 0;
    const eleNode = pt.querySelector("ele");
    const ele = eleNode ? parseFloat(eleNode.textContent) : 0;

    // Heart rate & Cadence extensions (Garmin / Strava / Wahoo)
    let hr = null;
    let cadence = null;
    const hrNode = pt.querySelector("hr") || pt.querySelector("ns3\\:hr") || pt.querySelector("gpxtpx\\:hr");
    if (hrNode) hr = parseInt(hrNode.textContent);

    const cadNode = pt.querySelector("cad") || pt.querySelector("ns3\\:cad") || pt.querySelector("gpxtpx\\:cad");
    if (cadNode) cadence = parseInt(cadNode.textContent);

    if (!isNaN(lat) && !isNaN(lon)) {
      pts.push({ lat, lon, ele, time, hr, cadence });
    }
  });

  return pts;
}

// Aligns raw race GPS points against active reference route (Gate A to Gate B)
function alignRaceToCourse(rawPoints, routeData, gateRadius) {
  if (!rawPoints || rawPoints.length < 5) return null;
  const targetDist = routeData.totalDist;
  const gateA = routeData.startPoint;
  const gateB = routeData.endPoint;
  const n = rawPoints.length;

  // 1. Calculate distances to Gate A & Gate B and alongDist for all points
  const projected = rawPoints.map(p => {
    const proj = projectPointOnRoute(p, routeData.points, routeData.cumDists);
    const distToA = haversine(p.lat, p.lon, gateA.lat, gateA.lon);
    const distToB = haversine(p.lat, p.lon, gateB.lat, gateB.lon);
    return { ...p, ...proj, distToA, distToB };
  });

  // 2. Identify candidate finish crossing at Gate B
  // Search for the point closest to Gate B where boat has covered significant course distance
  let finishIdx = -1;
  let minFinishDist = Infinity;
  for (let i = Math.floor(n * 0.2); i < n; i++) {
    const p = projected[i];
    if (p.distToB < minFinishDist) {
      minFinishDist = p.distToB;
      finishIdx = i;
    }
  }

  // If closest to Gate B is still too far, check point where alongDist is closest to targetDist
  if (finishIdx === -1 || minFinishDist > gateRadius * 2.5) {
    let closestToL = Infinity;
    for (let i = Math.floor(n * 0.2); i < n; i++) {
      const diff = Math.abs(projected[i].alongDist - targetDist);
      if (diff < closestToL) {
        closestToL = diff;
        finishIdx = i;
      }
    }
  }

  if (finishIdx < 5) finishIdx = n - 1;

  // 3. Look backwards from finishIdx to locate start crossing at Gate A
  let startIdx = 0;
  let minStartDist = Infinity;
  const searchStartEnd = Math.max(1, finishIdx - 5);

  for (let i = 0; i <= searchStartEnd; i++) {
    const p = projected[i];
    if (p.distToA < minStartDist) {
      minStartDist = p.distToA;
      startIdx = i;
    }
  }

  // Ensure startIdx < finishIdx
  if (startIdx >= finishIdx) {
    startIdx = 0;
  }

  const raceSlice = projected.slice(startIdx, finishIdx + 1);
  if (raceSlice.length < 2) return null;

  // 4. Exact Timestamps & Durations
  const startTime = raceSlice[0].time;
  const finishTime = raceSlice[raceSlice.length - 1].time;
  let durationSec = (finishTime - startTime) / 1000;

  // Fallback if no valid timestamps: estimate from GPS points
  if (durationSec <= 1) {
    durationSec = raceSlice.length * 1.0;
  }

  // Calculate speed (km/h) for each point
  let speeds = [];
  let hrs = [];
  let cads = [];

  for (let i = 0; i < raceSlice.length; i++) {
    const cur = raceSlice[i];
    if (i > 0) {
      const prev = raceSlice[i - 1];
      const dt = (cur.time - prev.time) / 1000;
      const dd = haversine(prev.lat, prev.lon, cur.lat, cur.lon);
      const spd = dt > 0.1 ? (dd / dt) * 3.6 : (speeds[i - 1] || 0);
      speeds.push(Math.min(spd, 25.0)); // Cap speed anomalies
    } else {
      speeds.push(0);
    }
    if (cur.hr) hrs.push(cur.hr);
    if (cur.cadence) cads.push(cur.cadence);
  }

  const avgSpeedKmh = durationSec > 0 ? (targetDist / durationSec) * 3.6 : 0;
  const maxSpeedKmh = speeds.length > 0 ? Math.max(...speeds) : avgSpeedKmh;
  const avgHr = hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
  const maxHr = hrs.length > 0 ? Math.max(...hrs) : null;
  const avgCad = cads.length > 0 ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null;

  // 5. Calculate 5 Equal Checkpoint Splits across Course Distance (20%, 40%, 60%, 80%, 100%)
  const numCheckpoints = 5;
  const splitIntervalDist = targetDist / numCheckpoints;
  const splitTimes = [];
  let prevSplitElapsed = 0;

  for (let c = 1; c <= numCheckpoints; c++) {
    const targetCheckpointDist = c * splitIntervalDist;

    // Find point where alongDist reaches or exceeds targetCheckpointDist
    let crossIdx = raceSlice.findIndex(p => p.alongDist >= targetCheckpointDist);
    let checkpointElapsed = 0;

    if (crossIdx === -1) {
      // Linear proportional estimate if points ended slightly before
      checkpointElapsed = (targetCheckpointDist / targetDist) * durationSec;
    } else if (crossIdx === 0) {
      checkpointElapsed = 0;
    } else {
      const pPrev = raceSlice[crossIdx - 1];
      const pNext = raceSlice[crossIdx];
      const ratio = (targetCheckpointDist - pPrev.alongDist) / ((pNext.alongDist - pPrev.alongDist) || 1);
      const tPrev = (pPrev.time - startTime) / 1000;
      const tNext = (pNext.time - startTime) / 1000;
      checkpointElapsed = tPrev + Math.max(0, Math.min(1, ratio)) * (tNext - tPrev);
    }

    const intervalTime = Math.max(0.5, checkpointElapsed - prevSplitElapsed);
    splitTimes.push({
      checkpointDist: Math.round(targetCheckpointDist),
      elapsedTime: checkpointElapsed,
      intervalTime: intervalTime
    });
    prevSplitElapsed = checkpointElapsed;
  }

  // 6. Resample telemetry into 50 equidistant distance points for unified Chart overlays
  const sampleSteps = 50;
  const resampledDistance = [];
  const resampledSpeed = [];
  const resampledHr = [];
  const resampledPace = [];
  const resampledCad = [];

  for (let s = 0; s <= sampleSteps; s++) {
    const d = (s / sampleSteps) * targetDist;
    resampledDistance.push(Math.round(d));

    // Nearest point in raceSlice by alongDist
    let nearest = raceSlice[0];
    let minD = Infinity;
    let nIdx = 0;
    for (let j = 0; j < raceSlice.length; j++) {
      const diff = Math.abs(raceSlice[j].alongDist - d);
      if (diff < minD) {
        minD = diff;
        nearest = raceSlice[j];
        nIdx = j;
      }
    }

    const curSpeed = speeds[nIdx] || avgSpeedKmh;
    resampledSpeed.push(parseFloat(curSpeed.toFixed(1)));

    // Pace in sec per 500m: 500m / (speed in m/s) = 1800 / speed_kmh
    const paceSec = curSpeed > 1 ? Math.min(300, 1800 / curSpeed) : 300;
    resampledPace.push(parseFloat(paceSec.toFixed(1)));

    if (nearest.hr) resampledHr.push(nearest.hr);
    if (nearest.cadence) resampledCad.push(nearest.cadence);
  }

  return {
    startIdx,
    finishIdx,
    points: raceSlice,
    startTime,
    finishTime,
    durationSec,
    courseDist: targetDist,
    avgSpeedKmh,
    maxSpeedKmh,
    avgHr,
    maxHr,
    avgCad,
    splitTimes,
    telemetry: {
      distance: resampledDistance,
      speed: resampledSpeed,
      hr: resampledHr.length > 5 ? resampledHr : null,
      pace: resampledPace,
      cadence: resampledCad.length > 5 ? resampledCad : null
    }
  };
}

// Re-analyzes all uploaded races against the active reference route
function reanalyzeAllRaces() {
  if (!state.activeRouteData) return;

  state.uploadedRaces.forEach(race => {
    race.processed = alignRaceToCourse(race.rawPoints, state.activeRouteData, state.gateRadius);
  });

  // Filter out any race where alignment failed completely
  updateUI();
}

// -------------------------------------------------------------
// UI & Dashboard Rendering
// -------------------------------------------------------------

function updateUI() {
  const validRaces = state.uploadedRaces.filter(r => r.processed !== null);
  const hasRaces = validRaces.length > 0;

  document.getElementById('emptyStatePanel').classList.toggle('hidden', hasRaces);
  document.getElementById('splitsSummaryPanel').classList.toggle('hidden', !hasRaces);
  document.getElementById('dashboardTelemetry').classList.toggle('hidden', !hasRaces);

  if (hasRaces) {
    updateMetricCards(validRaces);
    renderSplitsTable(validRaces);
    renderRaceToggles(validRaces);
    renderCharts(validRaces);
  }

  renderMapTracks(validRaces);
}

function updateMetricCards(races) {
  const visible = races.filter(r => r.visible);
  if (visible.length === 0) return;

  // Winner (Fastest Time)
  const fastest = [...visible].sort((a, b) => a.processed.durationSec - b.processed.durationSec)[0];
  const avgTime = visible.reduce((sum, r) => sum + r.processed.durationSec, 0) / visible.length;
  const topSpeedRace = [...visible].sort((a, b) => b.processed.maxSpeedKmh - a.processed.maxSpeedKmh)[0];
  const topAvgSpeedRace = [...visible].sort((a, b) => b.processed.avgSpeedKmh - a.processed.avgSpeedKmh)[0];

  const hrRaces = visible.filter(r => r.processed.maxHr);
  const maxHrRace = hrRaces.length > 0 ? [...hrRaces].sort((a, b) => b.processed.maxHr - a.processed.maxHr)[0] : null;

  const container = document.getElementById('metricCards');
  container.innerHTML = `
    <!-- Card 1: Winner / Fastest -->
    <div class="bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-lg relative overflow-hidden">
      <div class="flex items-center justify-between">
        <span class="text-xs uppercase font-semibold text-slate-400">Winner / Fastest</span>
        <span class="text-xs bg-amber-950 text-amber-400 border border-amber-800/80 px-1.5 py-0.5 rounded font-medium">Rank 1</span>
      </div>
      <div class="mt-2 flex items-baseline gap-2">
        <span class="text-2xl font-black text-amber-400 font-mono">${formatTime(fastest.processed.durationSec)}</span>
        <span class="text-xs text-slate-400">${fastest.processed.avgSpeedKmh.toFixed(1)} km/h</span>
      </div>
      <div class="mt-1 text-xs text-slate-300 font-medium truncate flex items-center gap-1.5">
        <span class="w-2.5 h-2.5 rounded-full inline-block" style="background-color: ${fastest.color}"></span>
        <span class="truncate">${fastest.name}</span>
      </div>
    </div>

    <!-- Card 2: Average Time -->
    <div class="bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-lg">
      <div class="flex items-center justify-between">
        <span class="text-xs uppercase font-semibold text-slate-400">Field Average Time</span>
        <span class="text-xs text-sky-400 bg-sky-950 px-1.5 py-0.5 rounded border border-sky-800/60 font-medium">${visible.length} Boats</span>
      </div>
      <div class="mt-2 text-2xl font-black text-white font-mono">
        ${formatTime(avgTime)}
      </div>
      <div class="mt-1 text-xs text-slate-400">
        Course: <span class="font-semibold text-sky-400">${Math.round(state.activeRouteData?.totalDist || 0)}m</span>
      </div>
    </div>

    <!-- Card 3: Top Speed -->
    <div class="bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-lg">
      <div class="flex items-center justify-between">
        <span class="text-xs uppercase font-semibold text-slate-400">Peak Top Speed</span>
        <span class="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded font-medium">Sprint</span>
      </div>
      <div class="mt-2 text-2xl font-black text-emerald-400 font-mono">
        ${topSpeedRace.processed.maxSpeedKmh.toFixed(1)} <span class="text-xs text-slate-400 font-normal font-sans">km/h</span>
      </div>
      <div class="mt-1 text-xs text-slate-300 truncate">
        ${topSpeedRace.name}
      </div>
    </div>

    <!-- Card 4: Highest Avg Speed -->
    <div class="bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-lg">
      <div class="flex items-center justify-between">
        <span class="text-xs uppercase font-semibold text-slate-400">Highest Avg Pace</span>
        <span class="text-xs bg-sky-950 text-sky-400 border border-sky-800 px-1.5 py-0.5 rounded font-medium">Overall</span>
      </div>
      <div class="mt-2 text-2xl font-black text-sky-400 font-mono">
        ${topAvgSpeedRace.processed.avgSpeedKmh.toFixed(1)} <span class="text-xs text-slate-400 font-normal font-sans">km/h</span>
      </div>
      <div class="mt-1 text-xs text-slate-300 truncate">
        ${topAvgSpeedRace.name}
      </div>
    </div>

    <!-- Card 5: Max Heart Rate -->
    <div class="bg-slate-900/90 border border-slate-800 p-4 rounded-xl shadow-lg">
      <div class="flex items-center justify-between">
        <span class="text-xs uppercase font-semibold text-slate-400">Max Heart Rate</span>
        <span class="text-xs bg-rose-950 text-rose-400 border border-rose-800 px-1.5 py-0.5 rounded font-medium">BPM</span>
      </div>
      <div class="mt-2 text-2xl font-black text-rose-400 font-mono">
        ${maxHrRace ? `${maxHrRace.processed.maxHr} <span class="text-xs text-slate-400 font-normal font-sans">bpm</span>` : '--'}
      </div>
      <div class="mt-1 text-xs text-slate-300 truncate">
        ${maxHrRace ? maxHrRace.name : 'No HR data recorded'}
      </div>
    </div>
  `;
}

function renderSplitsTable(races) {
  // Sort races by total elapsed duration
  const sorted = [...races].sort((a, b) => a.processed.durationSec - b.processed.durationSec);
  const thead = document.getElementById('splitsHeader');
  const tbody = document.getElementById('splitsBody');

  const checkpoints = sorted[0].processed.splitTimes;
  const numSplits = checkpoints.length;

  // Find minimum split time for each interval to highlight fastest split in green
  const minIntervals = [];
  for (let c = 0; c < numSplits; c++) {
    const times = sorted.map(r => r.processed.splitTimes[c]?.intervalTime || Infinity);
    minIntervals.push(Math.min(...times));
  }

  // Header
  let headerHtml = `
    <tr>
      <th class="p-2.5 pl-3">Rank</th>
      <th class="p-2.5">Race / Boat</th>
  `;
  for (let c = 0; c < numSplits; c++) {
    const prevDist = c === 0 ? 0 : checkpoints[c - 1].checkpointDist;
    const curDist = checkpoints[c].checkpointDist;
    headerHtml += `<th class="p-2.5 text-center">${prevDist}-${curDist}m</th>`;
  }
  headerHtml += `
      <th class="p-2.5 text-right font-bold text-amber-400">Total Time</th>
      <th class="p-2.5 text-right">Avg Spd</th>
      <th class="p-2.5 text-right">Top Spd</th>
      <th class="p-2.5 text-right pr-3">Max HR</th>
    </tr>
  `;
  thead.innerHTML = headerHtml;

  // Body Rows
  let bodyHtml = '';
  sorted.forEach((r, idx) => {
    const isWinner = idx === 0;
    const p = r.processed;

    bodyHtml += `
      <tr class="hover:bg-slate-900/60 transition ${r.visible ? '' : 'opacity-40'}">
        <td class="p-2.5 pl-3 font-mono font-bold ${isWinner ? 'text-amber-400' : 'text-slate-400'}">
          ${idx + 1}
        </td>
        <td class="p-2.5">
          <div class="flex items-center gap-2 max-w-[160px] sm:max-w-xs">
            <span class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: ${r.color}"></span>
            <span class="font-semibold text-white truncate" title="${r.name}">${r.name}</span>
          </div>
        </td>
    `;

    // Interval Splits
    for (let c = 0; c < numSplits; c++) {
      const split = p.splitTimes[c];
      const isFastestSplit = split && Math.abs(split.intervalTime - minIntervals[c]) < 0.05;

      bodyHtml += `
        <td class="p-2.5 text-center font-mono text-xs">
          <span class="${isFastestSplit ? 'bg-emerald-950/80 text-emerald-400 font-bold px-1.5 py-0.5 rounded border border-emerald-800/60' : 'text-slate-300'}">
            ${split ? split.intervalTime.toFixed(1) + 's' : '--'}
          </span>
        </td>
      `;
    }

    // Totals
    bodyHtml += `
        <td class="p-2.5 text-right font-mono font-bold text-amber-400">
          ${formatTime(p.durationSec)}
        </td>
        <td class="p-2.5 text-right font-mono text-slate-300">
          ${p.avgSpeedKmh.toFixed(1)} km/h
        </td>
        <td class="p-2.5 text-right font-mono text-slate-300">
          ${p.maxSpeedKmh.toFixed(1)} km/h
        </td>
        <td class="p-2.5 text-right font-mono text-rose-400 pr-3">
          ${p.maxHr ? `${p.maxHr} bpm` : '--'}
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = bodyHtml;
}

function renderRaceToggles(races) {
  const container = document.getElementById('raceTogglesContainer');
  container.innerHTML = '';

  races.forEach((r, idx) => {
    const badge = document.createElement('label');
    badge.className = `cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition ${
      r.visible 
        ? 'bg-slate-900 border-slate-700 text-white shadow' 
        : 'bg-slate-950/60 border-slate-800 text-slate-500 line-through'
    }`;

    badge.innerHTML = `
      <input type="checkbox" ${r.visible ? 'checked' : ''} class="accent-sky-500 rounded cursor-pointer" />
      <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color: ${r.color}"></span>
      <span class="truncate max-w-[130px] sm:max-w-xs">${r.name}</span>
      <span class="text-[10px] text-amber-400/90 font-mono">${formatTime(r.processed.durationSec)}</span>
      <button data-remove="${r.id}" class="text-slate-500 hover:text-rose-400 ml-1 font-bold" title="Remove race">&times;</button>
    `;

    const checkbox = badge.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', (e) => {
      r.visible = e.target.checked;
      updateUI();
    });

    const removeBtn = badge.querySelector('[data-remove]');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.uploadedRaces = state.uploadedRaces.filter(x => x.id !== r.id);
      updateUI();
      showToast(`Removed race: ${r.name}`);
    });

    container.appendChild(badge);
  });
}

// -------------------------------------------------------------
// Leaflet Map Rendering
// -------------------------------------------------------------

function initMap() {
  const mapContainer = document.getElementById('map');
  if (!mapContainer) return;

  state.map = L.map('map', {
    zoomControl: true,
    attributionControl: true
  }).setView([52.9425, -1.0914], 15);

  L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`, {
    maxZoom: 19,
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
  }).addTo(state.map);

  state.mapLayers.tracksGroup = L.featureGroup().addTo(state.map);
  state.mapLayers.routeGroup = L.featureGroup().addTo(state.map);

  renderReferenceRouteOnMap();
}

function renderReferenceRouteOnMap() {
  if (!state.map || !state.activeRouteData) return;
  state.mapLayers.routeGroup.clearLayers();

  const route = state.activeRouteData;
  const latlngs = route.points.map(p => [p.lat, p.lon]);

  // Dashed Reference Polyline
  const polyline = L.polyline(latlngs, {
    color: '#38bdf8',
    weight: 4,
    dashArray: '6, 8',
    opacity: 0.9
  }).addTo(state.mapLayers.routeGroup);

  state.mapLayers.referencePolyline = polyline;

  // Gate A Marker (Green, Start)
  const gateAMarker = L.circleMarker([route.startPoint.lat, route.startPoint.lon], {
    radius: 9,
    fillColor: '#10b981',
    fillOpacity: 1,
    color: '#ffffff',
    weight: 2
  }).addTo(state.mapLayers.routeGroup);
  gateAMarker.bindTooltip(`<b>Gate A (Start Line)</b><br>${route.name}`, { direction: 'top' });

  // Gate B Marker (Red, Finish)
  const gateBMarker = L.circleMarker([route.endPoint.lat, route.endPoint.lon], {
    radius: 9,
    fillColor: '#f43f5e',
    fillOpacity: 1,
    color: '#ffffff',
    weight: 2
  }).addTo(state.mapLayers.routeGroup);
  gateBMarker.bindTooltip(`<b>Gate B (Finish Line)</b><br>${Math.round(route.totalDist)}m`, { direction: 'top' });

  try {
    state.map.fitBounds(polyline.getBounds(), { padding: [40, 40], maxZoom: 16 });
  } catch (e) {}
}

function renderMapTracks(races) {
  if (!state.map || !state.mapLayers.tracksGroup) return;
  state.mapLayers.tracksGroup.clearLayers();

  const visible = races.filter(r => r.visible);
  visible.forEach(r => {
    const latlngs = r.processed.points.map(p => [p.lat, p.lon]);
    const trackLine = L.polyline(latlngs, {
      color: r.color,
      weight: 3.5,
      opacity: 0.85
    }).addTo(state.mapLayers.tracksGroup);

    trackLine.bindPopup(`
      <div class="text-xs">
        <b style="color:${r.color}">${r.name}</b><br>
        Time: <b>${formatTime(r.processed.durationSec)}</b><br>
        Avg Speed: ${r.processed.avgSpeedKmh.toFixed(1)} km/h<br>
        Top Speed: ${r.processed.maxSpeedKmh.toFixed(1)} km/h
      </div>
    `);
  });

  if (visible.length > 0) {
    try {
      state.map.fitBounds(state.mapLayers.tracksGroup.getBounds(), { padding: [40, 40], maxZoom: 16 });
    } catch (e) {}
  } else {
    renderReferenceRouteOnMap();
  }
}

// -------------------------------------------------------------
// Chart.js Comparative Charts
// -------------------------------------------------------------

function initCharts() {
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false
    },
    plugins: {
      legend: {
        labels: {
          color: '#cbd5e1',
          font: { size: 11 },
          boxWidth: 12
        }
      },
      tooltip: {
        backgroundColor: '#0f172a',
        titleColor: '#38bdf8',
        bodyColor: '#e2e8f0',
        borderColor: '#334155',
        borderWidth: 1
      }
    },
    scales: {
      x: {
        grid: { color: '#1e293b' },
        ticks: {
          color: '#94a3b8',
          font: { size: 10 },
          callback: (val, idx) => `${val}m`
        },
        title: {
          display: true,
          text: 'Course Distance (meters)',
          color: '#64748b',
          font: { size: 11 }
        }
      },
      y: {
        grid: { color: '#1e293b' },
        ticks: { color: '#94a3b8', font: { size: 10 } }
      }
    }
  };

  // Speed Chart
  const ctxSpeed = document.getElementById('speedChart')?.getContext('2d');
  if (ctxSpeed) {
    state.charts.speed = new Chart(ctxSpeed, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        ...commonOptions,
        scales: {
          ...commonOptions.scales,
          y: {
            ...commonOptions.scales.y,
            title: { display: true, text: 'Boat Speed (km/h)', color: '#64748b' }
          }
        }
      }
    });
  }

  // Heart Rate Chart
  const ctxHr = document.getElementById('hrChart')?.getContext('2d');
  if (ctxHr) {
    state.charts.hr = new Chart(ctxHr, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        ...commonOptions,
        scales: {
          ...commonOptions.scales,
          y: {
            ...commonOptions.scales.y,
            title: { display: true, text: 'Heart Rate (BPM)', color: '#64748b' }
          }
        }
      }
    });
  }

  // Split Pace Chart
  const ctxPace = document.getElementById('paceChart')?.getContext('2d');
  if (ctxPace) {
    state.charts.pace = new Chart(ctxPace, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        ...commonOptions,
        scales: {
          ...commonOptions.scales,
          y: {
            ...commonOptions.scales.y,
            reverse: true, // Lower seconds = faster pace
            title: { display: true, text: 'Pace (Seconds per 500m)', color: '#64748b' }
          }
        }
      }
    });
  }

  // Cadence Chart
  const ctxCad = document.getElementById('cadenceChart')?.getContext('2d');
  if (ctxCad) {
    state.charts.cadence = new Chart(ctxCad, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        ...commonOptions,
        scales: {
          ...commonOptions.scales,
          y: {
            ...commonOptions.scales.y,
            title: { display: true, text: 'Stroke Rate (SPM)', color: '#64748b' }
          }
        }
      }
    });
  }
}

function renderCharts(races) {
  const visible = races.filter(r => r.visible);
  if (visible.length === 0) return;

  const labels = visible[0].processed.telemetry.distance;

  // 1. Speed Datasets
  if (state.charts.speed) {
    state.charts.speed.data.labels = labels;
    state.charts.speed.data.datasets = visible.map(r => ({
      label: r.name,
      data: r.processed.telemetry.speed,
      borderColor: r.color,
      backgroundColor: r.color + '20',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3
    }));
    state.charts.speed.update();
  }

  // 2. Heart Rate Datasets
  if (state.charts.hr) {
    state.charts.hr.data.labels = labels;
    state.charts.hr.data.datasets = visible
      .filter(r => r.processed.telemetry.hr !== null)
      .map(r => ({
        label: r.name,
        data: r.processed.telemetry.hr,
        borderColor: r.color,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3
      }));
    state.charts.hr.update();
  }

  // 3. Pace Datasets
  if (state.charts.pace) {
    state.charts.pace.data.labels = labels;
    state.charts.pace.data.datasets = visible.map(r => ({
      label: r.name,
      data: r.processed.telemetry.pace,
      borderColor: r.color,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3
    }));
    state.charts.pace.update();
  }

  // 4. Cadence Datasets
  if (state.charts.cadence) {
    state.charts.cadence.data.labels = labels;
    state.charts.cadence.data.datasets = visible
      .filter(r => r.processed.telemetry.cadence !== null)
      .map(r => ({
        label: r.name,
        data: r.processed.telemetry.cadence,
        borderColor: r.color,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3
      }));
    state.charts.cadence.update();
  }
}

// -------------------------------------------------------------
// Route UI & Drawer Management
// -------------------------------------------------------------

function updateRouteUI() {
  const route = state.activeRouteData;
  if (!route) return;

  // Dropdown
  const dropdown = document.getElementById('routeSelectDropdown');
  dropdown.innerHTML = '';
  Object.values(state.routes).forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = `${r.name}`;
    if (r.id === state.activeRouteId) opt.selected = true;
    dropdown.appendChild(opt);
  });

  // Banner
  document.getElementById('bannerRouteName').textContent = route.name;
  document.getElementById('bannerRouteDist').textContent = `${Math.round(route.totalDist)}m`;
  document.getElementById('bannerRouteEndpoints').textContent = 
    `Gate A (${route.startPoint.lat.toFixed(4)}, ${route.startPoint.lon.toFixed(4)}) ➔ Gate B (${route.endPoint.lat.toFixed(4)}, ${route.endPoint.lon.toFixed(4)})`;

  // Drawer
  document.getElementById('drawerRouteName').textContent = route.name;
  document.getElementById('drawerRouteDist').textContent = `${Math.round(route.totalDist)} m`;
  document.getElementById('drawerRoutePoints').textContent = `${route.points.length} pts`;
  document.getElementById('drawerGateA').textContent = `${route.startPoint.lat.toFixed(5)}, ${route.startPoint.lon.toFixed(5)}`;
  document.getElementById('drawerGateB').textContent = `${route.endPoint.lat.toFixed(5)}, ${route.endPoint.lon.toFixed(5)}`;

  renderRoutesLibrary();
}

function renderRoutesLibrary() {
  const container = document.getElementById('routesListContainer');
  const countBadge = document.getElementById('routeCountBadge');
  const routes = Object.values(state.routes);
  countBadge.textContent = `${routes.length} route${routes.length > 1 ? 's' : ''}`;
  container.innerHTML = '';

  routes.forEach(r => {
    const isActive = r.id === state.activeRouteId;
    const item = document.createElement('div');
    item.className = `p-3 rounded-lg border transition flex items-center justify-between gap-2 ${isActive ? 'bg-sky-950/40 border-sky-600/80' : 'bg-slate-900 border-slate-800 hover:border-slate-700'}`;

    const distEst = r.points && r.points.length > 1 ? Math.round(haversine(r.points[0].lat, r.points[0].lon, r.points[r.points.length - 1].lat, r.points[r.points.length - 1].lon)) : '--';

    const isDefault = [DEFAULT_NOTTINGHAM_500M_ROUTE.id, DEFAULT_NOTTINGHAM_200M_ROUTE.id, DEFAULT_KINGSTON_500M_ROUTE.id].includes(r.id);

    item.innerHTML = `
      <div class="truncate">
        <div class="font-semibold text-xs text-white truncate flex items-center gap-1.5">
          ${isActive ? '<span class="w-2 h-2 rounded-full bg-emerald-400"></span>' : ''}
          <span>${r.name}</span>
        </div>
        <div class="text-[11px] text-slate-400 mt-0.5 truncate">${r.filename || 'Custom GPX'} &bull; ~${distEst}m</div>
      </div>
      <div class="flex items-center gap-1.5 flex-shrink-0">
        ${!isActive ? `<button data-activate="${r.id}" class="bg-slate-800 hover:bg-slate-700 text-sky-400 px-2 py-1 rounded text-xs transition">Select</button>` : '<span class="text-xs text-emerald-400 font-semibold px-2">Active</span>'}
        ${!isDefault ? `<button data-delete="${r.id}" class="text-slate-500 hover:text-rose-400 p-1 rounded text-xs" title="Delete route">&times;</button>` : ''}
      </div>
    `;

    const selectBtn = item.querySelector('[data-activate]');
    if (selectBtn) {
      selectBtn.addEventListener('click', () => {
        setActiveRoute(r.id);
        showToast(`Switched active route to: ${r.name}`);
      });
    }

    const delBtn = item.querySelector('[data-delete]');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        if (confirm(`Remove route "${r.name}"?`)) {
          delete state.routes[r.id];
          saveRoutesToStorage();
          if (state.activeRouteId === r.id) {
            setActiveRoute(DEFAULT_NOTTINGHAM_500M_ROUTE.id);
          } else {
            updateRouteUI();
          }
          showToast(`Removed route: ${r.name}`);
        }
      });
    }

    container.appendChild(item);
  });
}

function toggleSettingsDrawer(open) {
  const drawer = document.getElementById('settingsDrawer');
  const backdrop = document.getElementById('settingsDrawerBackdrop');

  if (open) {
    drawer.classList.remove('invisible', 'translate-x-full');
    drawer.classList.add('translate-x-0');
    backdrop.classList.remove('hidden');
    setTimeout(() => backdrop.classList.remove('opacity-0'), 10);
  } else {
    drawer.classList.remove('translate-x-0');
    drawer.classList.add('translate-x-full');
    backdrop.classList.add('opacity-0');
    setTimeout(() => {
      drawer.classList.add('invisible');
      backdrop.classList.add('hidden');
      if (state.map) state.map.invalidateSize();
    }, 300);
  }
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `p-3 px-4 rounded-xl shadow-2xl text-xs font-semibold text-white flex items-center gap-2 border transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto ${type === 'error' ? 'bg-rose-950 border-rose-700' : 'bg-slate-900 border-sky-500/80 shadow-sky-500/10'}`;
  toast.innerHTML = `<span>${type === 'error' ? '⚠️' : '✅'}</span><span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// -------------------------------------------------------------
// File Handlers: Route Upload, Directory Scan, Race Uploads
// -------------------------------------------------------------

function handleRouteFiles(files) {
  const fileList = (files instanceof FileList || Array.isArray(files)) ? Array.from(files) : (files instanceof File ? [files] : []);
  const gpxFiles = fileList.filter(f => f.name.toLowerCase().endsWith('.gpx'));
  if (gpxFiles.length === 0) {
    alert("Please select valid reference route GPX file(s) (.gpx).");
    return;
  }

  let loadedCount = 0;
  let lastLoadedId = null;

  gpxFiles.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = parseRouteGPX(e.target.result, file.name);
        state.routes[parsed.id] = parsed;
        lastLoadedId = parsed.id;
        loadedCount++;
        saveRoutesToStorage();
        if (lastLoadedId) setActiveRoute(lastLoadedId);
        showToast(`Reference route loaded: ${parsed.name}`);
      } catch (err) {
        alert(`Error parsing ${file.name}: ${err.message}`);
      }
    };
    reader.readAsText(file);
  });
}

async function handleDirectoryScan(files) {
  const routeFiles = Array.from(files).filter(f => 
    f.name.toLowerCase().startsWith('mroute_') && f.name.toLowerCase().endsWith('.gpx')
  );

  if (routeFiles.length === 0) {
    alert("No files matching 'mroute_*.gpx' found in the selected folder.\nTip: Name reference files like 'mroute_nottingham_500m.gpx'.");
    return;
  }

  let loadedCount = 0;
  let lastLoadedId = null;

  for (const file of routeFiles) {
    const text = await file.text();
    try {
      const parsed = parseRouteGPX(text, file.name);
      state.routes[parsed.id] = parsed;
      lastLoadedId = parsed.id;
      loadedCount++;
    } catch (e) {
      console.warn(`Failed parsing ${file.name}`, e);
    }
  }

  saveRoutesToStorage();
  if (lastLoadedId) setActiveRoute(lastLoadedId);
  showToast(`Found and loaded ${loadedCount} reference route(s) from folder!`);
}

// Upload & Process Multiple Race GPX Files
async function handleRaceFiles(files) {
  const fileList = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.gpx'));
  if (fileList.length === 0) {
    alert("Please select valid race GPX files (.gpx).");
    return;
  }

  let added = 0;
  for (const file of fileList) {
    const text = await file.text();
    try {
      const rawPoints = parseRaceGPX(text);
      if (rawPoints.length < 5) {
        console.warn(`File ${file.name} has too few GPS points (< 5).`);
        continue;
      }

      const cleanName = file.name
        .replace(/\.gpx$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

      const color = RACE_COLORS[state.uploadedRaces.length % RACE_COLORS.length];
      const processed = alignRaceToCourse(rawPoints, state.activeRouteData, state.gateRadius);

      const raceObj = {
        id: 'race_' + Math.random().toString(36).substr(2, 9),
        filename: file.name,
        name: cleanName,
        color,
        visible: true,
        rawPoints,
        processed
      };

      state.uploadedRaces.push(raceObj);
      added++;
    } catch (err) {
      console.warn(`Failed reading race file ${file.name}:`, err);
    }
  }

  if (added > 0) {
    updateUI();
    showToast(`Loaded ${added} race file(s) successfully!`);
  } else {
    alert("Could not extract race data from selected files.");
  }
}

// Load Demo Sample Races (sample_data/sample_race_1.gpx and sample_race_2.gpx)
async function loadSampleRaces() {
  const sampleUrls = ['sample_data/sample_race_1.gpx', 'sample_data/sample_race_2.gpx'];
  const sampleNames = ['National Combined Mixed 500m', 'National Premier Mixed 500m - Minor Final'];

  let loaded = 0;
  for (let i = 0; i < sampleUrls.length; i++) {
    try {
      const res = await fetch(sampleUrls[i]);
      if (res.ok) {
        const text = await res.text();
        const rawPoints = parseRaceGPX(text);
        const color = RACE_COLORS[state.uploadedRaces.length % RACE_COLORS.length];
        const processed = alignRaceToCourse(rawPoints, state.activeRouteData, state.gateRadius);

        state.uploadedRaces.push({
          id: 'sample_race_' + (i + 1),
          filename: sampleUrls[i].split('/').pop(),
          name: sampleNames[i],
          color,
          visible: true,
          rawPoints,
          processed
        });
        loaded++;
      }
    } catch (e) {
      console.warn('Sample race load failed:', e);
    }
  }

  if (loaded > 0) {
    updateUI();
    showToast(`Loaded ${loaded} sample races for demo!`);
  } else {
    alert("Could not load sample files. Please upload your own .gpx files.");
  }
}

// Export CSV of all visible race splits and metrics
function exportCSV() {
  const visible = state.uploadedRaces.filter(r => r.visible && r.processed);
  if (visible.length === 0) {
    alert("No active races to export.");
    return;
  }

  const checkpoints = visible[0].processed.splitTimes;
  const splitHeaders = checkpoints.map((c, i) => {
    const prev = i === 0 ? 0 : checkpoints[i - 1].checkpointDist;
    return `Split ${prev}-${c.checkpointDist}m (s)`;
  });

  const headers = ['Rank', 'Race Name', 'Filename', ...splitHeaders, 'Total Time (s)', 'Formatted Time', 'Avg Speed (km/h)', 'Max Speed (km/h)', 'Avg HR (bpm)', 'Max HR (bpm)'];

  const sorted = [...visible].sort((a, b) => a.processed.durationSec - b.processed.durationSec);
  const rows = sorted.map((r, idx) => {
    const p = r.processed;
    const splitVals = p.splitTimes.map(s => s.intervalTime.toFixed(2));
    return [
      idx + 1,
      `"${r.name}"`,
      `"${r.filename}"`,
      ...splitVals,
      p.durationSec.toFixed(2),
      `"${formatTime(p.durationSec)}"`,
      p.avgSpeedKmh.toFixed(2),
      p.maxSpeedKmh.toFixed(2),
      p.avgHr || '',
      p.maxHr || ''
    ];
  });

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `race_comparison_${state.activeRouteData?.name || 'multi'}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// -------------------------------------------------------------
// Initialization & Event Listeners
// -------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  initRouteStorage();
  initMap();
  initCharts();
  loadServerRoutes(); // Auto-load reference routes starting with mroute_

  // Settings Drawer Toggle
  document.getElementById('openSettingsBtn').addEventListener('click', () => toggleSettingsDrawer(true));
  document.getElementById('btnManageRoutes').addEventListener('click', () => toggleSettingsDrawer(true));
  document.getElementById('closeSettingsBtn').addEventListener('click', () => toggleSettingsDrawer(false));
  document.getElementById('settingsDrawerBackdrop').addEventListener('click', () => toggleSettingsDrawer(false));

  // Sync / Reload routes from server button
  const btnReloadServerRoutes = document.getElementById('btnReloadServerRoutes');
  if (btnReloadServerRoutes) {
    btnReloadServerRoutes.addEventListener('click', () => loadServerRoutes(true));
  }

  // Route dropdown change
  document.getElementById('routeSelectDropdown').addEventListener('change', (e) => {
    setActiveRoute(e.target.value);
  });

  // Way 1: Upload Route GPX file(s)
  const dropzoneRoute = document.getElementById('dropzoneRoute');
  const routeFileInput = document.getElementById('routeFileInput');

  dropzoneRoute.addEventListener('click', () => routeFileInput.click());
  routeFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleRouteFiles(e.target.files);
    e.target.value = '';
  });

  // Drag and drop for route in drawer
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzoneRoute.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzoneRoute.classList.add('dropzone-active');
    }, false);
  });
  ['dragleave', 'drop'].forEach(eventName => {
    dropzoneRoute.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzoneRoute.classList.remove('dropzone-active');
    }, false);
  });
  dropzoneRoute.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt.files && dt.files.length > 0) handleRouteFiles(dt.files);
  });

  // Way 2: Scan local directory for mroute_*.gpx
  const btnScanFolder = document.getElementById('btnScanFolder');
  const folderInput = document.getElementById('folderInput');

  btnScanFolder.addEventListener('click', () => {
    if (window.showDirectoryPicker) {
      window.showDirectoryPicker().then(async dirHandle => {
        const foundFiles = [];
        async function scanDir(handle, depth = 0) {
          if (depth > 3) return;
          for await (const entry of handle.values()) {
            if (entry.kind === 'file') {
              if (entry.name.toLowerCase().startsWith('mroute_') && entry.name.toLowerCase().endsWith('.gpx')) {
                const file = await entry.getFile();
                foundFiles.push(file);
              }
            } else if (entry.kind === 'directory') {
              await scanDir(entry, depth + 1);
            }
          }
        }
        await scanDir(dirHandle, 0);
        if (foundFiles.length > 0) {
          handleDirectoryScan(foundFiles);
        } else {
          alert("No 'mroute_*.gpx' files found in selected directory or subdirectories.\nTip: Name reference files like 'mroute_nottingham_500m.gpx'.");
        }
      }).catch(err => {
        if (err.name !== 'AbortError') {
          folderInput.click();
        }
      });
    } else {
      folderInput.click();
    }
  });

  folderInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleDirectoryScan(e.target.files);
    e.target.value = '';
  });

  // Multiple Race File Inputs
  const racesFileInput = document.getElementById('racesFileInput');
  const emptyStateFileInput = document.getElementById('emptyStateFileInput');

  racesFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleRaceFiles(e.target.files);
    e.target.value = '';
  });

  emptyStateFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleRaceFiles(e.target.files);
    e.target.value = '';
  });

  // Drag and drop for main races files
  const racesDropzone = document.getElementById('racesDropzone');
  if (racesDropzone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      racesDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        racesDropzone.classList.add('border-sky-400', 'bg-sky-950/40');
      }, false);
    });
    ['dragleave', 'drop'].forEach(eventName => {
      racesDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        racesDropzone.classList.remove('border-sky-400', 'bg-sky-950/40');
      }, false);
    });
    racesDropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt.files && dt.files.length > 0) handleRaceFiles(dt.files);
    });
  }

  // Demo Sample Races Button
  document.getElementById('btnLoadSampleRaces').addEventListener('click', loadSampleRaces);

  // Select / Deselect All Races
  document.getElementById('btnSelectAllRaces').addEventListener('click', () => {
    state.uploadedRaces.forEach(r => r.visible = true);
    updateUI();
  });

  document.getElementById('btnDeselectAllRaces').addEventListener('click', () => {
    state.uploadedRaces.forEach(r => r.visible = false);
    updateUI();
  });

  // Export CSV
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);

  // Settings: Gate Detection Radius slider
  const gateSlider = document.getElementById('gateRadiusSlider');
  const gateVal = document.getElementById('gateRadiusVal');
  gateSlider.addEventListener('input', (e) => {
    gateVal.textContent = `${e.target.value} m`;
    state.gateRadius = parseInt(e.target.value);
  });

  document.getElementById('btnReanalyze').addEventListener('click', () => {
    reanalyzeAllRaces();
    toggleSettingsDrawer(false);
    showToast('Re-analyzed races with updated parameters');
  });

  // Reset to default Nottingham 500m Preset
  document.getElementById('btnResetDefaults').addEventListener('click', () => {
    state.gateRadius = 35;
    gateSlider.value = 35;
    gateVal.textContent = '35 m';

    setActiveRoute(DEFAULT_NOTTINGHAM_500M_ROUTE.id);
    showToast('Reset detection settings and active route to Nottingham NWSC 500m');
  });

  // Recenter Map Button
  document.getElementById('btnRecenterMap')?.addEventListener('click', () => {
    if (!state.map) return;
    if (state.mapLayers.tracksGroup && state.mapLayers.tracksGroup.getLayers().length > 0) {
      try {
        state.map.fitBounds(state.mapLayers.tracksGroup.getBounds(), { padding: [40, 40], maxZoom: 16 });
      } catch (e) {}
    } else if (state.mapLayers.referencePolyline) {
      try {
        state.map.fitBounds(state.mapLayers.referencePolyline.getBounds(), { padding: [40, 40], maxZoom: 16 });
      } catch (e) {}
    }
    state.map.invalidateSize();
  });

  // Window Resize Auto-Recalibrate
  window.addEventListener('resize', () => {
    if (state.map) state.map.invalidateSize();
  });
});
