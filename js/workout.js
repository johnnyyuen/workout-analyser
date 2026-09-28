/**
 * Dragon Boat Interval & Repeat Analyser
 * Supports single GPX workout with repeated back-and-forth laps over a reference course
 */

// Color palette for laps
const lapColorPalette = [
  '#38bdf8', // Sky 400
  '#f59e0b', // Amber 500
  '#ec4899', // Pink 500
  '#10b981', // Emerald 500
  '#a855f7', // Purple 500
  '#fb923c', // Orange 400
  '#06b6d4', // Cyan 500
  '#f43f5e', // Rose 500
  '#84cc16', // Lime 500
  '#eab308'  // Yellow 500
];

// CARTO Basemaps API Key
const CARTO_API_KEY = 'cb1_3z6j_1_74eb2f698e009c6d3c8fdc94';

// Built-in Default Reference Route 1 (Kingston Royal Time Trail)
const DEFAULT_KINGSTON_ROUTE = {
  id: "rroute_kingston_royal_time_trail",
  name: "Kingston Royal Time Trail",
  filename: "rroute_kingston_royal_time_trail.gpx",
  points: [
    { lat: 51.42416000000001, lon: -0.30758, ele: 4.55 },
    { lat: 51.424726670022686, lon: -0.30820331792963457, ele: 4.74 },
    { lat: 51.42529333673965, lon: -0.3088266513180541, ele: 4.68 },
    { lat: 51.42586000000001, lon: -0.30945, ele: 4.76 },
    { lat: 51.426353341152534, lon: -0.3104099792291339, ele: 4.91 },
    { lat: 51.42684667446427, lon: -0.3113699791867304, ele: 4.92 },
    { lat: 51.42734, lon: -0.31233000000000005, ele: 4.59 }
  ]
};

// Built-in Default Reference Route 2 (Kingston Bridge to Island 500m)
const DEFAULT_KINGSTON_BRIDGE_ROUTE = {
  id: "rroute_kingston_bridge_to_island_500m",
  name: "Kingston Bridge to Island 500m",
  filename: "rroute_Kingston_Bridge_to_Island_500m.gpx",
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
  rawWorkoutPoints: null,
  workoutMetadata: null,
  detectedLaps: [],
  filteredDirection: 'ALL', // 'ALL', 'FORWARD', 'RETURN'
  gateRadius: 35, // meters
  minLapDistance: 250, // meters
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

// -------------------------------------------------------------
// Reference Route Management (Storage, Parsing, Scanning)
// -------------------------------------------------------------

function initRouteStorage() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem('workout_analyser_routes') || localStorage.getItem('race_analyser_routes'));
  } catch (e) {
    console.warn('Failed to read routes from localStorage', e);
  }

  if (!saved || typeof saved !== 'object' || Object.keys(saved).length === 0) {
    state.routes = {
      [DEFAULT_KINGSTON_ROUTE.id]: DEFAULT_KINGSTON_ROUTE,
      [DEFAULT_KINGSTON_BRIDGE_ROUTE.id]: DEFAULT_KINGSTON_BRIDGE_ROUTE
    };
    saveRoutesToStorage();
  } else {
    state.routes = saved;
    let changed = false;
    if (!state.routes[DEFAULT_KINGSTON_ROUTE.id]) {
      state.routes[DEFAULT_KINGSTON_ROUTE.id] = DEFAULT_KINGSTON_ROUTE;
      changed = true;
    }
    if (!state.routes[DEFAULT_KINGSTON_BRIDGE_ROUTE.id]) {
      state.routes[DEFAULT_KINGSTON_BRIDGE_ROUTE.id] = DEFAULT_KINGSTON_BRIDGE_ROUTE;
      changed = true;
    }
    if (changed) saveRoutesToStorage();
  }

  const activeId = localStorage.getItem('workout_analyser_active_route') || localStorage.getItem('race_analyser_active_route') || DEFAULT_KINGSTON_ROUTE.id;
  setActiveRoute(state.routes[activeId] ? activeId : DEFAULT_KINGSTON_ROUTE.id);
}

// Automatically discovers and loads all rroute_*.gpx from ./routes/ directory
async function loadServerRoutes(notify = false) {
  const discoveredFilenames = new Set();

  // 1. Try to fetch routes/routes.json manifest
  try {
    const res = await fetch('routes/routes.json', { cache: 'no-cache' });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        list.forEach(f => {
          if (typeof f === 'string' && f.toLowerCase().startsWith('rroute_') && f.toLowerCase().endsWith('.gpx')) {
            discoveredFilenames.add(f);
          }
        });
      }
    }
  } catch (err) {
    console.debug('routes.json not directly accessible, will try fallbacks:', err);
  }

  // 2. Try fetching directory listing if server supports it (Nginx autoindex / Apache)
  try {
    const dirRes = await fetch('routes/', { cache: 'no-cache' });
    if (dirRes.ok) {
      const htmlText = await dirRes.text();
      const matches = htmlText.match(/href=["'](rroute_[^"'\s>]+\.gpx)["']/gi);
      if (matches) {
        matches.forEach(m => {
          const matchName = m.replace(/href=["']/i, '').replace(/["']$/i, '');
          if (matchName) discoveredFilenames.add(matchName);
        });
      }
    }
  } catch (e) {
    // Ignore directory listing fetch error
  }

  // 3. Always include known default route filenames as baseline
  discoveredFilenames.add('rroute_kingston_royal_time_trail.gpx');
  discoveredFilenames.add('rroute_Kingston_Bridge_to_Island_500m.gpx');

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

function saveRoutesToStorage() {
  try {
    localStorage.setItem('workout_analyser_routes', JSON.stringify(state.routes));
  } catch (e) {
    console.warn('Could not save routes to localStorage', e);
  }
}

function setActiveRoute(routeId) {
  if (!state.routes[routeId]) return;
  state.activeRouteId = routeId;
  localStorage.setItem('workout_analyser_active_route', routeId);

  const rawRoute = state.routes[routeId];
  state.activeRouteData = processRouteGeometry(rawRoute);

  updateRouteUI();
  
  // If workout already loaded, re-analyze against the new route
  if (state.rawWorkoutPoints && state.rawWorkoutPoints.length > 0) {
    analyzeWorkout();
  } else if (state.map) {
    renderReferenceRouteOnMap();
  }
}

function processRouteGeometry(route) {
  const pts = route.points || [];
  if (pts.length < 2) return null;

  const dists = [0];
  for (let i = 0; i < pts.length - 1; i++) {
    const d = haversine(pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon);
    dists.push(dists[dists.length - 1] + d);
  }

  const totalDist = dists[dists.length - 1];
  const startPt = pts[0];
  const endPt = pts[pts.length - 1];

  return {
    ...route,
    points: pts,
    cumulativeDists: dists,
    totalDist: totalDist,
    startPoint: startPt,
    endPoint: endPt
  };
}

// Project coordinate onto reference route polyline
function projectPointToRoute(lat, lon, routeData) {
  if (!routeData || !routeData.points || routeData.points.length < 2) {
    return { alongDist: 0, crossDist: 0 };
  }

  const pts = routeData.points;
  const dists = routeData.cumulativeDists;
  let minCrossDist = Infinity;
  let bestAlongDist = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const segLen = dists[i + 1] - dists[i];
    if (segLen === 0) continue;

    const midLat = ((p1.lat + p2.lat) / 2) * Math.PI / 180;
    const m_per_lat = 111132.954;
    const m_per_lon = 111412.84 * Math.cos(midLat);

    const vx = (p2.lon - p1.lon) * m_per_lon;
    const vy = (p2.lat - p1.lat) * m_per_lat;

    const px = (lon - p1.lon) * m_per_lon;
    const py = (lat - p1.lat) * m_per_lat;

    const vSq = vx * vx + vy * vy;
    const t = (px * vx + py * vy) / vSq;

    // For first segment allow t < 0 to track approaches before Gate A
    // For last segment allow t > 1 to track overshoots past Gate B
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

// Parse GPX text for Route (trk, rte, or wpt)
function parseRouteGPX(xmlText, filename = '') {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");
  
  // Extract Route Name
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
      .replace(/^rroute_/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  } else {
    routeName = "Custom Route " + new Date().toLocaleDateString();
  }

  // Extract Points
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
    ? filename.replace(/\.gpx$/i, '').toLowerCase().replace(/^rroute_+/i, '').replace(/[^a-z0-9_]/g, '_')
    : Math.random().toString(36).substr(2, 9);
  const id = `rroute_${cleanBase}`;

  return {
    id,
    name: routeName,
    filename: filename || `${id}.gpx`,
    points
  };
}

// Parse Workout GPX text
function parseWorkoutGPX(xmlText) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");
  const trkpts = xml.querySelectorAll("trkpt");
  const pts = [];

  // Helper for namespaced elements like <ns3:hr> or <hr>
  function extractNodeValue(el, localTagName) {
    let nodes = el.getElementsByTagNameNS("*", localTagName);
    if (nodes && nodes.length > 0) return nodes[0].textContent;
    nodes = el.getElementsByTagName(localTagName);
    if (nodes && nodes.length > 0) return nodes[0].textContent;
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i];
      if (child.localName === localTagName || child.nodeName.endsWith(':' + localTagName)) {
        return child.textContent;
      }
    }
    return null;
  }

  trkpts.forEach(pt => {
    const lat = parseFloat(pt.getAttribute("lat"));
    const lon = parseFloat(pt.getAttribute("lon"));
    const timeStr = extractNodeValue(pt, "time") || pt.querySelector("time")?.textContent;
    const time = timeStr ? new Date(timeStr).getTime() : 0;
    
    const hrVal = extractNodeValue(pt, "hr");
    const hr = hrVal ? parseInt(hrVal) : null;

    const cadVal = extractNodeValue(pt, "cad");
    const cad = cadVal ? parseInt(cadVal) : null;

    if (!isNaN(lat) && !isNaN(lon)) {
      pts.push({ lat, lon, time, hr, cad });
    }
  });

  return pts;
}

// -------------------------------------------------------------
// Lap & Repeat Detection Engine
// -------------------------------------------------------------

function analyzeWorkout() {
  if (!state.rawWorkoutPoints || state.rawWorkoutPoints.length < 10) return;
  if (!state.activeRouteData) return;

  const raw = state.rawWorkoutPoints;
  const route = state.activeRouteData;
  const totalRefDist = route.totalDist;
  const gateR = state.gateRadius;
  const minLapD = state.minLapDistance;

  // 1. Calculate along-route distance and instantaneous speed for each point
  const projected = [];
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    const { alongDist, crossDist } = projectPointToRoute(p.lat, p.lon, route);
    
    let speed_kmh = 0;
    let speed_ms = 0;
    if (i > 0) {
      const dt = (p.time - raw[i - 1].time) / 1000;
      const ds = haversine(raw[i - 1].lat, raw[i - 1].lon, p.lat, p.lon);
      if (dt > 0) {
        speed_ms = ds / dt;
        speed_kmh = speed_ms * 3.6;
      }
    }

    projected.push({
      idx: i,
      lat: p.lat,
      lon: p.lon,
      time: p.time,
      hr: p.hr,
      cad: p.cad,
      d_along: alongDist,
      d_cross: crossDist,
      speed_ms: speed_ms,
      speed_kmh: speed_kmh
    });
  }

  // 2. State Machine for detecting repeated laps between Gate A (s ~ 0) and Gate B (s ~ totalRefDist)
  const rawLaps = [];
  let mode = 'SEARCHING'; // 'AT_A', 'AT_B', 'IN_A_TO_B', 'IN_B_TO_A'
  let lapStartIdx = null;
  let lastStationaryA = null;
  let lastStationaryB = null;

  for (let i = 0; i < projected.length; i++) {
    const p = projected[i];
    const d = p.d_along;
    const spd = p.speed_kmh;

    if (d <= gateR) {
      // Inside Gate A zone
      if (mode === 'IN_B_TO_A') {
        // Reached Gate A from Gate B -> Completed RETURN lap!
        const endIdx = i;
        const distCovered = Math.abs(projected[endIdx].d_along - projected[lapStartIdx].d_along);
        if (distCovered >= minLapD) {
          rawLaps.push({
            direction: 'RETURN',
            directionLabel: 'Return (B ➔ A)',
            arrow: '⬅️',
            startIdx: lapStartIdx,
            endIdx: endIdx
          });
        }
        mode = 'AT_A';
      } else if (mode !== 'AT_A') {
        mode = 'AT_A';
      }

      if (spd < 3.2 || lastStationaryA === null) {
        lastStationaryA = i;
      }

    } else if (d >= totalRefDist - gateR) {
      // Inside Gate B zone
      if (mode === 'IN_A_TO_B') {
        // Reached Gate B from Gate A -> Completed FORWARD lap!
        const endIdx = i;
        const distCovered = Math.abs(projected[endIdx].d_along - projected[lapStartIdx].d_along);
        if (distCovered >= minLapD) {
          rawLaps.push({
            direction: 'FORWARD',
            directionLabel: 'Forward (A ➔ B)',
            arrow: '➡️',
            startIdx: lapStartIdx,
            endIdx: endIdx
          });
        }
        mode = 'AT_B';
      } else if (mode !== 'AT_B') {
        mode = 'AT_B';
      }

      if (spd < 3.2 || lastStationaryB === null) {
        lastStationaryB = i;
      }

    } else {
      // In transit between gates
      if (mode === 'AT_A') {
        if (i > 0 && projected[i].d_along > projected[i - 1].d_along) {
          mode = 'IN_A_TO_B';
          lapStartIdx = lastStationaryA !== null ? lastStationaryA : i - 1;
        }
      } else if (mode === 'AT_B') {
        if (i > 0 && projected[i].d_along < projected[i - 1].d_along) {
          mode = 'IN_B_TO_A';
          lapStartIdx = lastStationaryB !== null ? lastStationaryB : i - 1;
        }
      } else if (mode === 'SEARCHING') {
        if (i > 5) {
          if (projected[i].d_along > projected[i - 5].d_along) {
            mode = 'IN_A_TO_B';
            lapStartIdx = 0;
          } else {
            mode = 'IN_B_TO_A';
            lapStartIdx = 0;
          }
        }
      }
    }
  }

  // 3. Process each detected lap with telemetry normalization & splits
  state.detectedLaps = rawLaps.map((lap, index) => {
    const rawSlice = projected.slice(lap.startIdx, lap.endIdx + 1);
    const color = lapColorPalette[index % lapColorPalette.length];
    const lapId = `lap_${index + 1}`;

    const t0 = rawSlice[0].time;
    let runningDist = 0;

    const trimmed = rawSlice.map((pt, k) => {
      if (k > 0) {
        runningDist += haversine(rawSlice[k - 1].lat, rawSlice[k - 1].lon, pt.lat, pt.lon);
      }
      return {
        lat: pt.lat,
        lon: pt.lon,
        time: pt.time,
        elapsedSec: (pt.time - t0) / 1000,
        rawDist: runningDist,
        speed_kmh: pt.speed_kmh,
        speed_ms: pt.speed_ms,
        hr: pt.hr || 130,
        cad: pt.cad
      };
    });

    const finalRawDist = trimmed[trimmed.length - 1].rawDist || totalRefDist;
    const targetDist = 500; // Normalized 500m standard for comparison

    // Normalize distance 0 -> targetDist so all laps overlay directly
    trimmed.forEach(pt => {
      pt.dist = (pt.rawDist / finalRawDist) * targetDist;
    });

    // Model cadence if sensor absent
    for (let k = 0; k < trimmed.length; k++) {
      const d = trimmed[k].dist;
      const v = trimmed[k].speed_ms;
      const hr = trimmed[k].hr;

      if (!trimmed[k].cad) {
        let baseCadence = 76 + (v * 2.2);
        if (d < 60) {
          baseCadence = 96 + ((1 - d / 60) * 16);
        } else if (d > 380) {
          baseCadence = 84 + (((d - 380) / 120) * 18);
        }
        const hrBump = hr > 150 ? (hr - 150) * 0.12 : 0;
        trimmed[k].cadence = Math.round(Math.min(120, Math.max(70, baseCadence + hrBump)));
      } else {
        trimmed[k].cadence = trimmed[k].cad;
      }

      trimmed[k].pace_sec = v > 0.4 ? Math.min(220, Math.round(500 / v)) : 175;
    }

    const totalDuration = trimmed[trimmed.length - 1].elapsedSec;
    const avgSpeed = (trimmed.reduce((a, b) => a + b.speed_kmh, 0) / trimmed.length);
    const maxSpeed = Math.max(...trimmed.map(p => p.speed_kmh));
    const validHrs = trimmed.filter(p => p.hr).map(p => p.hr);
    const avgHr = validHrs.length > 0 ? Math.round(validHrs.reduce((a, b) => a + b, 0) / validHrs.length) : null;
    const maxHr = validHrs.length > 0 ? Math.max(...validHrs) : null;

    // Splits calculation: 0-100m, 100-200m, 200-300m, 300-400m, 400-500m
    const marks = [100, 200, 300, 400, 500];
    const splits = [];
    let prevT = 0;
    marks.forEach(m => {
      const found = trimmed.find(p => p.dist >= m) || trimmed[trimmed.length - 1];
      const dt = Math.max(0.1, found.elapsedSec - prevT);
      splits.push(parseFloat(dt.toFixed(1)));
      prevT = found.elapsedSec;
    });

    return {
      lapIndex: index + 1,
      lapId,
      name: `Lap ${index + 1} (${lap.direction === 'FORWARD' ? 'A➔B' : 'B➔A'})`,
      direction: lap.direction,
      directionLabel: lap.directionLabel,
      arrow: lap.arrow,
      color,
      visible: true,
      startTime: new Date(rawSlice[0].time),
      endTime: new Date(rawSlice[rawSlice.length - 1].time),
      durationSec: totalDuration,
      totalDist: finalRawDist,
      avgSpeedKmh: parseFloat(avgSpeed.toFixed(2)),
      maxSpeedKmh: parseFloat(maxSpeed.toFixed(2)),
      avgHr,
      maxHr,
      splits,
      points: trimmed,
      rawSlice
    };
  });

  renderDashboardView();
}

// -------------------------------------------------------------
// UI Rendering: Map, Charts, Splits, Cards
// -------------------------------------------------------------

function renderDashboardView() {
  const emptyStatePanel = document.getElementById('emptyStatePanel');
  const splitsPanel = document.getElementById('splitsPanel');
  const dashboardTelemetry = document.getElementById('dashboardTelemetry');

  if (!state.detectedLaps || state.detectedLaps.length === 0) {
    if (emptyStatePanel) emptyStatePanel.classList.remove('hidden');
    if (splitsPanel) splitsPanel.classList.add('hidden');
    if (dashboardTelemetry) dashboardTelemetry.classList.add('hidden');
    renderReferenceRouteOnMap();
    return;
  }

  if (emptyStatePanel) emptyStatePanel.classList.add('hidden');
  if (splitsPanel) splitsPanel.classList.remove('hidden');
  if (dashboardTelemetry) dashboardTelemetry.classList.remove('hidden');

  renderSummaryCards();
  renderLapToggles();
  renderSplitsTable();
  renderMapAndLayers();
  renderCharts();

  setTimeout(() => {
    if (state.map) state.map.invalidateSize();
  }, 100);
}

function renderSummaryCards() {
  const container = document.getElementById('workoutMetricCards');
  container.innerHTML = '';

  const laps = state.detectedLaps;
  const raw = state.rawWorkoutPoints;
  const totalWorkoutTimeSec = (raw[raw.length - 1].time - raw[0].time) / 1000;
  
  let workoutDistM = 0;
  for (let i = 1; i < raw.length; i++) {
    workoutDistM += haversine(raw[i - 1].lat, raw[i - 1].lon, raw[i].lat, raw[i].lon);
  }

  const forwardCount = laps.filter(l => l.direction === 'FORWARD').length;
  const returnCount = laps.filter(l => l.direction === 'RETURN').length;

  // Best Lap (lowest duration)
  const fastestLap = [...laps].sort((a, b) => a.durationSec - b.durationSec)[0];
  const avgLapTime = laps.reduce((a, b) => a + b.durationSec, 0) / laps.length;
  const avgLapSpeed = laps.reduce((a, b) => a + b.avgSpeedKmh, 0) / laps.length;
  
  const allHrs = raw.filter(p => p.hr).map(p => p.hr);
  const peakWorkoutHr = allHrs.length > 0 ? Math.max(...allHrs) : 'N/A';

  const formatMinSec = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

  const cardsData = [
    {
      label: 'Session Duration & Dist',
      val: `${Math.floor(totalWorkoutTimeSec / 60)}m ${(totalWorkoutTimeSec % 60).toFixed(0)}s`,
      sub: `${(workoutDistM / 1000).toFixed(2)} km Total Track`,
      border: 'border-slate-800'
    },
    {
      label: 'Repeats Detected',
      val: `${laps.length} Laps`,
      sub: `${forwardCount} Forward ➔ | ${returnCount} ⬅️ Return`,
      border: 'border-sky-800/60'
    },
    {
      label: 'Fastest Repeat',
      val: fastestLap ? formatMinSec(fastestLap.durationSec) : '--',
      sub: fastestLap ? `${fastestLap.name} (${fastestLap.avgSpeedKmh} km/h)` : '',
      border: 'border-emerald-700/60',
      badge: 'Best'
    },
    {
      label: 'Average Repeat Pace',
      val: formatMinSec(avgLapTime),
      sub: `${avgLapSpeed.toFixed(1)} km/h Avg Boat Speed`,
      border: 'border-slate-800'
    },
    {
      label: 'Peak Heart Rate',
      val: peakWorkoutHr !== 'N/A' ? `${peakWorkoutHr} bpm` : 'N/A',
      sub: 'Session Peak Intensity',
      border: 'border-slate-800'
    }
  ];

  cardsData.forEach(c => {
    const card = document.createElement('div');
    card.className = `bg-slate-900/90 p-4 rounded-xl border ${c.border} shadow-xl relative overflow-hidden flex flex-col justify-between`;
    card.innerHTML = `
      <div class="flex justify-between items-start">
        <span class="text-xs font-semibold uppercase tracking-wider text-slate-400">${c.label}</span>
        ${c.badge ? `<span class="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded font-bold">${c.badge}</span>` : ''}
      </div>
      <div class="mt-2">
        <div class="text-2xl font-black text-white">${c.val}</div>
        <div class="text-xs text-slate-400 mt-0.5">${c.sub}</div>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderLapToggles() {
  const container = document.getElementById('lapTogglesContainer');
  container.innerHTML = '';

  state.detectedLaps.forEach(lap => {
    const isFilteredOut = (state.filteredDirection === 'FORWARD' && lap.direction !== 'FORWARD') ||
                          (state.filteredDirection === 'RETURN' && lap.direction !== 'RETURN');

    const toggle = document.createElement('label');
    toggle.className = `flex items-center gap-1.5 text-xs bg-slate-950 hover:bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-800 cursor-pointer transition select-none ${isFilteredOut ? 'opacity-40' : ''}`;
    toggle.innerHTML = `
      <input type="checkbox" ${lap.visible && !isFilteredOut ? 'checked' : ''} class="rounded border-slate-700 text-sky-500 focus:ring-0" />
      <span class="w-2.5 h-2.5 rounded-full inline-block" style="background:${lap.color}"></span>
      <span class="font-medium text-slate-200">Lap ${lap.lapIndex}</span>
      <span class="text-[10px] text-slate-400">${lap.direction === 'FORWARD' ? 'A➔B' : 'B➔A'}</span>
      <span class="text-[10px] font-bold text-white ml-0.5">${Math.floor(lap.durationSec / 60)}:${(lap.durationSec % 60).toFixed(0).padStart(2, '0')}</span>
    `;

    toggle.querySelector('input').addEventListener('change', (e) => {
      lap.visible = e.target.checked;
      updateMapAndChartsVisibility();
      renderSplitsTable();
    });

    container.appendChild(toggle);
  });
}

function renderSplitsTable() {
  const thead = document.getElementById('workoutSplitsHeader');
  const tbody = document.getElementById('workoutSplitsBody');
  thead.innerHTML = `
    <tr>
      <th class="p-2">Lap</th>
      <th class="p-2">Dir</th>
      <th class="p-2 text-right">0-100m</th>
      <th class="p-2 text-right">100-200m</th>
      <th class="p-2 text-right">200-300m</th>
      <th class="p-2 text-right">300-400m</th>
      <th class="p-2 text-right">400-500m</th>
      <th class="p-2 text-right font-bold text-white">Total Time</th>
      <th class="p-2 text-right">Avg Spd</th>
      <th class="p-2 text-right">Peak HR</th>
    </tr>
  `;
  tbody.innerHTML = '';

  const activeLaps = state.detectedLaps.filter(lap => {
    if (state.filteredDirection === 'FORWARD' && lap.direction !== 'FORWARD') return false;
    if (state.filteredDirection === 'RETURN' && lap.direction !== 'RETURN') return false;
    return true;
  });

  if (activeLaps.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="p-4 text-center text-slate-400">No laps match the selected direction filter.</td></tr>`;
    return;
  }

  // Find min split time for each column to highlight fastest
  const minSplits = [0, 1, 2, 3, 4].map(colIdx => {
    const vals = activeLaps.map(l => l.splits[colIdx]).filter(v => typeof v === 'number');
    return vals.length > 0 ? Math.min(...vals) : 0;
  });

  activeLaps.forEach(lap => {
    const tr = document.createElement('tr');
    tr.className = `hover:bg-slate-800/50 transition cursor-pointer ${!lap.visible ? 'opacity-40' : ''}`;
    
    // Highlight split cell in emerald if it's the fastest
    let splitCells = lap.splits.map((s, idx) => {
      const isFastest = s === minSplits[idx];
      return `<td class="p-2 text-right ${isFastest ? 'text-emerald-400 font-bold bg-emerald-950/30 rounded' : 'text-slate-300'}">${s}s</td>`;
    }).join('');

    const timeStr = `${Math.floor(lap.durationSec / 60)}:${(lap.durationSec % 60).toFixed(1).padStart(4, '0')}`;

    tr.innerHTML = `
      <td class="p-2 font-medium flex items-center gap-1.5">
        <span class="w-2.5 h-2.5 rounded-full inline-block" style="background:${lap.color}"></span>
        <span>Lap ${lap.lapIndex}</span>
      </td>
      <td class="p-2 text-xs">
        <span class="px-1.5 py-0.5 rounded text-[11px] font-semibold ${lap.direction === 'FORWARD' ? 'bg-sky-950 text-sky-400 border border-sky-800/60' : 'bg-amber-950 text-amber-400 border border-amber-800/60'}">
          ${lap.direction === 'FORWARD' ? 'A ➔ B' : 'B ➔ A'}
        </span>
      </td>
      ${splitCells}
      <td class="p-2 text-right font-black text-white">${timeStr}</td>
      <td class="p-2 text-right text-slate-300">${lap.avgSpeedKmh} <span class="text-[10px] text-slate-500">km/h</span></td>
      <td class="p-2 text-right text-slate-300">${lap.maxHr ? lap.maxHr + ' bpm' : 'N/A'}</td>
    `;

    // Click row to toggle visibility
    tr.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        lap.visible = !lap.visible;
        renderLapToggles();
        renderSplitsTable();
        updateMapAndChartsVisibility();
      }
    });

    tbody.appendChild(tr);
  });
}

// -------------------------------------------------------------
// Leaflet Map Visualizer
// -------------------------------------------------------------

function initMap() {
  if (state.map) return;
  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  state.map = L.map('map', { zoomControl: true }).setView([51.4255, -0.3100], 15);
  
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_API_KEY}`, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(state.map);

  renderReferenceRouteOnMap();

  setTimeout(() => {
    if (state.map) state.map.invalidateSize();
  }, 150);
}

function renderReferenceRouteOnMap() {
  if (!state.map) return;

  // Clear existing reference layers
  if (state.mapLayers.referencePolyline) state.map.removeLayer(state.mapLayers.referencePolyline);
  if (state.mapLayers.gateAMarker) state.map.removeLayer(state.mapLayers.gateAMarker);
  if (state.mapLayers.gateBMarker) state.map.removeLayer(state.mapLayers.gateBMarker);

  const route = state.activeRouteData;
  if (!route || !route.points || route.points.length < 2) return;

  const latlngs = route.points.map(p => [p.lat, p.lon]);

  // Dash-line for reference course
  state.mapLayers.referencePolyline = L.polyline(latlngs, {
    color: '#38bdf8',
    weight: 4,
    dashArray: '8, 8',
    opacity: 0.9
  }).addTo(state.map);

  // Gate A Marker
  state.mapLayers.gateAMarker = L.circleMarker([route.startPoint.lat, route.startPoint.lon], {
    color: '#10b981',
    fillColor: '#10b981',
    radius: 8,
    fillOpacity: 0.95
  }).addTo(state.map).bindPopup(`<b>Gate A (Start Line)</b><br>${route.name}`);

  // Gate B Marker
  state.mapLayers.gateBMarker = L.circleMarker([route.endPoint.lat, route.endPoint.lon], {
    color: '#ef4444',
    fillColor: '#ef4444',
    radius: 8,
    fillOpacity: 0.95
  }).addTo(state.map).bindPopup(`<b>Gate B (Finish Line)</b><br>${route.name} (${Math.round(route.totalDist)}m)`);

  try {
    const bounds = state.mapLayers.referencePolyline.getBounds();
    if (bounds.isValid()) {
      state.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  } catch (e) {
    console.warn('Could not fit bounds on route', e);
  }
}

function renderMapAndLayers() {
  initMap();
  renderReferenceRouteOnMap();

  // Clear existing lap layers
  Object.keys(state.mapLayers).forEach(k => {
    if (k.startsWith('lap_')) {
      state.map.removeLayer(state.mapLayers[k]);
      delete state.mapLayers[k];
    }
  });

  state.detectedLaps.forEach(lap => {
    const latlngs = lap.points.map(p => [p.lat, p.lon]);
    const layer = L.polyline(latlngs, {
      color: lap.color,
      weight: 4,
      opacity: 0.85
    });

    layer.bindTooltip(`<b>${lap.name}</b><br>Time: ${(lap.durationSec).toFixed(1)}s<br>Avg Speed: ${lap.avgSpeedKmh} km/h`, {
      sticky: true
    });

    state.mapLayers[lap.lapId] = layer;

    const isFiltered = (state.filteredDirection === 'FORWARD' && lap.direction !== 'FORWARD') ||
                       (state.filteredDirection === 'RETURN' && lap.direction !== 'RETURN');

    if (lap.visible && !isFiltered) {
      layer.addTo(state.map);
    }
  });
}

function updateMapAndChartsVisibility() {
  state.detectedLaps.forEach(lap => {
    const isFiltered = (state.filteredDirection === 'FORWARD' && lap.direction !== 'FORWARD') ||
                       (state.filteredDirection === 'RETURN' && lap.direction !== 'RETURN');
    const layer = state.mapLayers[lap.lapId];
    if (layer) {
      if (lap.visible && !isFiltered) {
        if (!state.map.hasLayer(layer)) state.map.addLayer(layer);
      } else {
        if (state.map.hasLayer(layer)) state.map.removeLayer(layer);
      }
    }

    // Update charts visibility
    ['speed', 'hr', 'pace', 'cadence'].forEach(chartKey => {
      const chart = state.charts[chartKey];
      if (chart) {
        const ds = chart.data.datasets.find(d => d.id === lap.lapId);
        if (ds) {
          ds.hidden = !lap.visible || isFiltered;
        }
      }
    });
  });

  Object.values(state.charts).forEach(c => c.update());
}

// -------------------------------------------------------------
// Chart.js Telemetry Initializer
// -------------------------------------------------------------

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
        max: 500,
        title: { display: true, text: 'Interval Distance (m)', color: '#64748b' },
        grid: { color: '#1e293b' },
        ticks: { color: '#94a3b8', stepSize: 100 }
      },
      y: { grid: { color: '#1e293b' }, ticks: { color: '#94a3b8' } }
    }
  };

  state.charts.speed = new Chart(document.getElementById('speedChart'), {
    type: 'line', data: { datasets: [] },
    options: { ...commonCfg, scales: { ...commonCfg.scales, y: { ...commonCfg.scales.y, title: { display: true, text: 'km/h', color: '#64748b' } } } }
  });

  state.charts.hr = new Chart(document.getElementById('hrChart'), {
    type: 'line', data: { datasets: [] },
    options: { ...commonCfg, scales: { ...commonCfg.scales, y: { ...commonCfg.scales.y, title: { display: true, text: 'BPM', color: '#64748b' } } } }
  });

  state.charts.pace = new Chart(document.getElementById('paceChart'), {
    type: 'line', data: { datasets: [] },
    options: { ...commonCfg, scales: { ...commonCfg.scales, y: { ...commonCfg.scales.y, reverse: true, title: { display: true, text: 's / 500m Pace', color: '#64748b' } } } }
  });

  state.charts.cadence = new Chart(document.getElementById('cadenceChart'), {
    type: 'line', data: { datasets: [] },
    options: { ...commonCfg, scales: { ...commonCfg.scales, y: { ...commonCfg.scales.y, min: 65, max: 125, title: { display: true, text: 'SPM', color: '#64748b' } } } }
  });

  // Timeline chart (full workout continuous)
  state.charts.timeline = new Chart(document.getElementById('timelineChart'), {
    type: 'line',
    data: { datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#94a3b8' } },
        tooltip: {
          backgroundColor: '#020617',
          borderColor: '#334155',
          borderWidth: 1
        }
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Workout Session Time (Minutes)', color: '#64748b' },
          grid: { color: '#1e293b' },
          ticks: { color: '#94a3b8' }
        },
        y: {
          title: { display: true, text: 'Speed (km/h)', color: '#64748b' },
          grid: { color: '#1e293b' },
          ticks: { color: '#94a3b8' }
        }
      }
    }
  });
}

function renderCharts() {
  if (!state.charts.speed) initCharts();

  // Clear datasets
  Object.values(state.charts).forEach(c => c.data.datasets = []);

  state.detectedLaps.forEach(lap => {
    const isFiltered = (state.filteredDirection === 'FORWARD' && lap.direction !== 'FORWARD') ||
                       (state.filteredDirection === 'RETURN' && lap.direction !== 'RETURN');

    const speedPts = lap.points.map(p => ({ x: Math.round(p.dist), y: parseFloat(p.speed_kmh.toFixed(2)) }));
    const hrPts = lap.points.filter(p => p.hr).map(p => ({ x: Math.round(p.dist), y: p.hr }));
    const pacePts = lap.points.map(p => ({ x: Math.round(p.dist), y: Math.round(p.pace_sec) }));
    const cadPts = lap.points.map(p => ({ x: Math.round(p.dist), y: p.cadence }));

    const dsBase = {
      id: lap.lapId,
      label: lap.name,
      borderColor: lap.color,
      backgroundColor: lap.color,
      pointRadius: 0,
      tension: 0.35,
      borderWidth: 2,
      hidden: !lap.visible || isFiltered
    };

    state.charts.speed.data.datasets.push({ ...dsBase, data: speedPts });
    state.charts.hr.data.datasets.push({ ...dsBase, data: hrPts });
    state.charts.pace.data.datasets.push({ ...dsBase, data: pacePts });
    state.charts.cadence.data.datasets.push({ ...dsBase, data: cadPts });
  });

  // Render Full Timeline
  if (state.rawWorkoutPoints && state.rawWorkoutPoints.length > 0) {
    const t0 = state.rawWorkoutPoints[0].time;
    const timelineSpeed = [];
    
    for (let i = 0; i < state.rawWorkoutPoints.length; i++) {
      const p = state.rawWorkoutPoints[i];
      const minFromStart = (p.time - t0) / 60000;
      let spd = 0;
      if (i > 0) {
        const dt = (p.time - state.rawWorkoutPoints[i - 1].time) / 1000;
        const ds = haversine(state.rawWorkoutPoints[i - 1].lat, state.rawWorkoutPoints[i - 1].lon, p.lat, p.lon);
        spd = dt > 0 ? (ds / dt) * 3.6 : 0;
      }
      timelineSpeed.push({ x: parseFloat(minFromStart.toFixed(2)), y: parseFloat(spd.toFixed(1)) });
    }

    state.charts.timeline.data.datasets.push({
      label: 'Session Speed Profile (km/h)',
      borderColor: '#64748b',
      borderWidth: 1.5,
      pointRadius: 0,
      data: timelineSpeed
    });

    // Add highlighted datasets for each detected lap interval
    state.detectedLaps.forEach(lap => {
      const lapPts = lap.rawSlice.map(p => {
        const minFromStart = (p.time - t0) / 60000;
        return { x: parseFloat(minFromStart.toFixed(2)), y: parseFloat(p.speed_kmh.toFixed(1)) };
      });

      state.charts.timeline.data.datasets.push({
        id: `timeline_${lap.lapId}`,
        label: lap.name,
        borderColor: lap.color,
        borderWidth: 3,
        pointRadius: 0,
        data: lapPts
      });
    });
  }

  Object.values(state.charts).forEach(c => c.update());
}

// -------------------------------------------------------------
// Route UI & Drawer Logic
// -------------------------------------------------------------

function updateRouteUI() {
  const route = state.activeRouteData;
  if (!route) return;

  // Dropdown selector
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

  // Library container in Drawer
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
        ${(r.id !== DEFAULT_KINGSTON_ROUTE.id && r.id !== DEFAULT_KINGSTON_BRIDGE_ROUTE.id) ? `<button data-delete="${r.id}" class="text-slate-500 hover:text-rose-400 p-1 rounded text-xs" title="Delete route">&times;</button>` : ''}
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
            setActiveRoute(DEFAULT_KINGSTON_ROUTE.id);
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

function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `p-3 px-4 rounded-xl shadow-2xl text-xs font-semibold text-white flex items-center gap-2 border transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto ${type === 'error' ? 'bg-rose-950 border-rose-700' : 'bg-slate-900 border-sky-500/80 shadow-sky-500/10'}`;
  toast.innerHTML = `<span>${type === 'error' ? '⚠️' : '✅'}</span><span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  setTimeout(() => {
    toast.classList.add('opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// -------------------------------------------------------------
// Drawer Open / Close Controls
// -------------------------------------------------------------

function toggleSettingsDrawer(open) {
  const drawer = document.getElementById('settingsDrawer');
  const backdrop = document.getElementById('settingsDrawerBackdrop');

  if (open) {
    drawer.classList.remove('invisible');
    backdrop.classList.remove('hidden');
    setTimeout(() => {
      backdrop.classList.remove('opacity-0');
      drawer.classList.remove('translate-x-full');
    }, 10);
  } else {
    backdrop.classList.add('opacity-0');
    drawer.classList.add('translate-x-full');
    setTimeout(() => {
      backdrop.classList.add('hidden');
      drawer.classList.add('invisible');
      if (state.map) state.map.invalidateSize();
    }, 300);
  }
}

// -------------------------------------------------------------
// File Handlers: Route Upload, Directory Scan, Workout Upload
// -------------------------------------------------------------

// Upload route GPX file(s) (supports single or multiple files)
function handleRouteFiles(files) {
  const fileList = (files instanceof FileList || Array.isArray(files)) 
    ? Array.from(files) 
    : (files instanceof File ? [files] : []);
  
  const gpxFiles = fileList.filter(f => f.name.toLowerCase().endsWith('.gpx'));
  if (gpxFiles.length === 0) {
    alert("Please select valid GPX reference route file(s) (.gpx).");
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

// Scan local directory for all rroute_*.gpx files
async function handleDirectoryScan(files) {
  const routeFiles = Array.from(files).filter(f => 
    f.name.toLowerCase().startsWith('rroute_') && f.name.toLowerCase().endsWith('.gpx')
  );

  if (routeFiles.length === 0) {
    alert("No files matching 'rroute_*.gpx' found in the selected folder.\nTip: Name your reference route files like 'rroute_kingston.gpx'.");
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

// Upload workout GPX file
function handleWorkoutFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const pts = parseWorkoutGPX(e.target.result);
      if (pts.length < 20) {
        alert("Workout file has too few GPS points (< 20).");
        return;
      }
      state.rawWorkoutPoints = pts;
      state.workoutMetadata = { filename: file.name, fileSize: file.size };
      analyzeWorkout();
      showToast(`Workout loaded: ${file.name}`);
    } catch (err) {
      alert("Error parsing Workout GPX: " + err.message);
    }
  };
  reader.readAsText(file);
}

// Quick Sample Workout Loader (testKingston.gpx)
async function loadSampleKingstonWorkout() {
  try {
    const res = await fetch('sample_data/testKingston.gpx');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xmlText = await res.text();
    const pts = parseWorkoutGPX(xmlText);
    state.rawWorkoutPoints = pts;
    state.workoutMetadata = { filename: 'testKingston.gpx (Sample Demo)' };
    
    // Ensure Kingston route is active
    if (state.activeRouteId !== DEFAULT_KINGSTON_ROUTE.id) {
      setActiveRoute(DEFAULT_KINGSTON_ROUTE.id);
    } else {
      analyzeWorkout();
    }
    showToast('Loaded demo workout: Kingston Royal Time Trail!');
  } catch (err) {
    console.warn('Direct fetch failed (likely running on file:// protocol)', err);
    alert('Could not auto-fetch sample file via network. Please select "testKingston.gpx" using the "Select Workout GPX" file picker.');
    document.getElementById('workoutFileInput').click();
  }
}

// -------------------------------------------------------------
// CSV Export Functionality
// -------------------------------------------------------------

function exportLapsCSV() {
  if (!state.detectedLaps || state.detectedLaps.length === 0) return;

  const headers = ['Lap Number', 'Direction', 'Start Time', '0-100m (s)', '100-200m (s)', '200-300m (s)', '300-400m (s)', '400-500m (s)', 'Total Duration (s)', 'Avg Speed (km/h)', 'Max Speed (km/h)', 'Avg HR', 'Peak HR'];
  const rows = state.detectedLaps.map(l => [
    l.lapIndex,
    l.direction,
    l.startTime.toISOString(),
    ...l.splits,
    l.durationSec.toFixed(1),
    l.avgSpeedKmh,
    l.maxSpeedKmh,
    l.avgHr || '',
    l.maxHr || ''
  ]);

  let csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `dragonboat_repeats_${state.activeRouteData?.name || 'laps'}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// -------------------------------------------------------------
// Event Listeners & Initialization
// -------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  initRouteStorage();
  initMap();
  initCharts();
  loadServerRoutes(); // Automatically discover and fetch routes in ./routes/

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

  // Drag and drop for route
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

  // Way 2: Scan local directory (supports recursive folder search)
  const btnScanFolder = document.getElementById('btnScanFolder');
  const folderInput = document.getElementById('folderInput');

  btnScanFolder.addEventListener('click', () => {
    // Check if showDirectoryPicker API is available
    if (window.showDirectoryPicker) {
      window.showDirectoryPicker().then(async dirHandle => {
        const foundFiles = [];
        async function scanDir(handle, depth = 0) {
          if (depth > 3) return;
          for await (const entry of handle.values()) {
            if (entry.kind === 'file') {
              if (entry.name.toLowerCase().startsWith('rroute_') && entry.name.toLowerCase().endsWith('.gpx')) {
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
          alert("No 'rroute_*.gpx' files found in selected directory or subdirectories.\nTip: Name reference route files like 'rroute_kingston.gpx'.");
        }
      }).catch(err => {
        if (err.name !== 'AbortError') {
          // Fallback to webkitdirectory input
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

  // Workout File Inputs
  const workoutFileInput = document.getElementById('workoutFileInput');
  const emptyStateFileInput = document.getElementById('emptyStateFileInput');

  workoutFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleWorkoutFile(e.target.files[0]);
    e.target.value = '';
  });
  emptyStateFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleWorkoutFile(e.target.files[0]);
    e.target.value = '';
  });

  // Drag and drop for main workout file
  const workoutDropzone = document.getElementById('workoutDropzone');
  if (workoutDropzone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      workoutDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        workoutDropzone.classList.add('border-sky-400', 'bg-sky-950/40');
      }, false);
    });
    ['dragleave', 'drop'].forEach(eventName => {
      workoutDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        workoutDropzone.classList.remove('border-sky-400', 'bg-sky-950/40');
      }, false);
    });
    workoutDropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt.files && dt.files.length > 0) handleWorkoutFile(dt.files[0]);
    });
  }

  // Demo Workout Button
  document.getElementById('btnLoadSampleWorkout').addEventListener('click', loadSampleKingstonWorkout);

  // Direction filter buttons
  const btnAll = document.getElementById('filterAll');
  const btnForward = document.getElementById('filterForward');
  const btnReturn = document.getElementById('filterReturn');

  function updateFilterButtons(active) {
    state.filteredDirection = active;
    [btnAll, btnForward, btnReturn].forEach(b => {
      b.className = "px-3 py-1 rounded-md transition text-slate-400 hover:text-white font-medium";
    });
    if (active === 'ALL') btnAll.className = "px-3 py-1 rounded-md transition bg-sky-600 text-white font-medium shadow";
    if (active === 'FORWARD') btnForward.className = "px-3 py-1 rounded-md transition bg-sky-600 text-white font-medium shadow";
    if (active === 'RETURN') btnReturn.className = "px-3 py-1 rounded-md transition bg-sky-600 text-white font-medium shadow";

    renderLapToggles();
    renderSplitsTable();
    updateMapAndChartsVisibility();
  }

  btnAll.addEventListener('click', () => updateFilterButtons('ALL'));
  btnForward.addEventListener('click', () => updateFilterButtons('FORWARD'));
  btnReturn.addEventListener('click', () => updateFilterButtons('RETURN'));

  // Select / Deselect All
  document.getElementById('btnSelectAllLaps').addEventListener('click', () => {
    state.detectedLaps.forEach(l => l.visible = true);
    renderLapToggles();
    renderSplitsTable();
    updateMapAndChartsVisibility();
  });
  document.getElementById('btnDeselectAllLaps').addEventListener('click', () => {
    state.detectedLaps.forEach(l => l.visible = false);
    renderLapToggles();
    renderSplitsTable();
    updateMapAndChartsVisibility();
  });

  // Export CSV
  document.getElementById('btnExportCSV').addEventListener('click', exportLapsCSV);

  // Parameter sliders
  const gateSlider = document.getElementById('gateRadiusSlider');
  const gateVal = document.getElementById('gateRadiusVal');
  gateSlider.addEventListener('input', (e) => {
    gateVal.textContent = `${e.target.value} m`;
    state.gateRadius = parseInt(e.target.value);
  });

  const lapSlider = document.getElementById('minLapDistSlider');
  const lapVal = document.getElementById('minLapDistVal');
  lapSlider.addEventListener('input', (e) => {
    lapVal.textContent = `${e.target.value} m`;
    state.minLapDistance = parseInt(e.target.value);
  });

  document.getElementById('btnReanalyze').addEventListener('click', () => {
    analyzeWorkout();
    toggleSettingsDrawer(false);
    showToast('Re-analyzed workout with updated parameters');
  });

  // Reset to default Kingston Route
  document.getElementById('btnResetDefaults').addEventListener('click', () => {
    state.gateRadius = 35;
    gateSlider.value = 35;
    gateVal.textContent = '35 m';

    state.minLapDistance = 250;
    lapSlider.value = 250;
    lapVal.textContent = '250 m';

    setActiveRoute(DEFAULT_KINGSTON_ROUTE.id);
    showToast('Reset detection settings and active route to Kingston Royal');
  });

  // Map Recenter Button
  document.getElementById('btnRecenterMap')?.addEventListener('click', () => {
    if (!state.map) return;
    if (state.mapLayers.referencePolyline) {
      try {
        state.map.fitBounds(state.mapLayers.referencePolyline.getBounds(), { padding: [50, 50], maxZoom: 16 });
      } catch (e) {}
    }
    state.map.invalidateSize();
  });

  // Window Resize Auto-Recalibrate
  window.addEventListener('resize', () => {
    if (state.map) state.map.invalidateSize();
  });
});
