/*
 * ============================================================================
 *  A320 WIND OPTIMUM FL
 * ============================================================================
 *  Single-page tool that:
 *    1. Reads a route (typed, or imported from an OFP PDF).
 *    2. Downloads forecast winds/temperatures (GFS + ECMWF via Open-Meteo)
 *       for every point of the route at the time the aircraft is there.
 *    3. Simulates the whole trip (climb + cruise + descent) at every flight
 *       level and finds the best level, a step plan, and the 4 wind levels to
 *       enter in (or uplink to) the FMS.
 *    4. Shows hazards (shear / turbulence), a vertical profile chart,
 *       an OFP-vs-optimizer comparison and a flight log for cross-checks.
 *
 *  Units used throughout:
 *    distance  NM          altitude  ft (FL = ft / 100)
 *    speed     kt          fuel      kg          time  hours (unless noted)
 *    wind      vector {u: east component, v: north component} in kt,
 *              pointing where the air GOES (not where it comes from)
 *
 *  File layout (sections in this order):
 *    0. Version and error display
 *    1. Constants (airports, forecast levels, aircraft data)
 *    2. Small helpers (DOM, storage)
 *    3. Geometry (great circle)
 *    4. Route parsing and sampling
 *    5. Standard atmosphere
 *    6. Forecast download and wind profiles
 *    7. Performance model (climb, cruise, descent) and trip simulation
 *   7a. FCOM performance tables (optional file kept on the device)
 *    8. Vertical profiles (constant level, OFP, step plan)
 *    9. Choosing the 4 FMS wind levels
 *   10. Step plan (dynamic programming)
 *   11. Text formatting
 *   12. Reading the input form
 *   13. Main flow (download -> render)
 *   14. Rendering the results
 *   15. Charts
 *   16. Hazards along the route
 *   17. OFP import
 *   18. Flight log
 *   19. Wiring (buttons, start-up)
 * ============================================================================
 */
"use strict";

/* ============================================================================
 * 0. VERSION AND ERROR DISPLAY
 * ========================================================================== */

/** App version, shown in the title and used to force browsers to load new files. */
const APPV = "2.21";

/** Shows an error message in the status line under the "Get winds" button. */
function showErr(message) {
  try {
    const el = document.getElementById("m1");
    if (el) {
      el.className = "msg err";
      el.textContent = "Error: " + message + " (v" + APPV + ")";
    }
  } catch (ignored) { /* nothing else we can do */ }
}

// Any uncaught error or rejected promise is shown on screen instead of failing silently.
window.addEventListener("error", (e) => showErr(e.message || "unknown"));
window.addEventListener("unhandledrejection", (e) =>
  showErr((e.reason && e.reason.message) || String(e.reason)));


/* ============================================================================
 * 1. CONSTANTS
 * ========================================================================== */

/** Built-in airports: ICAO -> [latitude, longitude] in decimal degrees (south/west negative). */
const APT = {
  // Chile
  SCEL: [-33.393, -70.786],  SCIE: [-36.7727, -73.0631], SCFA: [-23.4445, -70.4451],
  SCDA: [-20.5352, -70.1813], SCAR: [-18.3485, -70.3387], SCCF: [-22.4982, -68.9036],
  SCSE: [-29.9162, -71.1995], SCAT: [-27.2612, -70.7792], SCTE: [-41.4389, -73.094],
  SCCI: [-53.0026, -70.8546], SCQP: [-38.9259, -72.6515], SCVD: [-39.65, -73.0861],
  SCJO: [-40.6112, -73.061],  SCBA: [-45.9161, -71.6895], SCNT: [-51.6715, -72.5284],
  SCIP: [-27.1648, -109.4219], SCCH: [-36.5825, -72.0314], SCPQ: [-42.3, -73.7158],
  // Argentina
  SAEZ: [-34.8222, -58.5358], SABE: [-34.5592, -58.4156], SAME: [-32.8317, -68.7929],
  SACO: [-31.3236, -64.208],  SAAR: [-32.9036, -60.785],  SAZS: [-41.1512, -71.1575],
  SAWH: [-54.8433, -68.2958], SANT: [-26.8409, -65.1049], SASA: [-24.856, -65.4862],
  SAZN: [-38.949, -68.1557],
  // Peru
  SPJC: [-12.0219, -77.1143], SPZO: [-13.5357, -71.9388], SPQU: [-16.3411, -71.583],
  SPTN: [-18.0533, -70.2758],
  // Brazil
  SBGR: [-23.4356, -46.4731], SBGL: [-22.81, -43.2506],   SBFL: [-27.6703, -48.5525],
  SBPA: [-29.9944, -51.1714], SBFI: [-25.6003, -54.4872],
  // Others
  SUMU: [-34.8384, -56.0308], SGAS: [-25.24, -57.5191],   SLLP: [-16.5133, -68.1923],
  SLVR: [-17.6448, -63.1354], SEQM: [-0.1292, -78.3575],  SEGU: [-2.1574, -79.8837],
  SKBO: [4.7016, -74.1469],   SKRG: [6.1645, -75.4231],   SKCL: [3.5433, -76.3817],
  MPTO: [9.0714, -79.3835],
};

/** Forecast pressure levels requested (hPa). 850 ≈ 5,000 ft ... 150 ≈ 44,600 ft. */
const LEVELS = [850, 700, 500, 400, 350, 300, 250, 200, 150];

/** Forecast models: [Open-Meteo id, display name]. */
const MODELS = [["gfs_seamless", "GFS"], ["ecmwf_ifs025", "ECMWF"]];

/** Open-Meteo ids used to ask when each model's latest run was produced. */
const META = { GFS: "ncep_gfs025", ECMWF: "ecmwf_ifs025" };

/**
 * Generic aircraft-type factors, relative to the A320 CEO:
 *   cd = climb distance/time, cf = climb fuel, dd = descent distance/time,
 *   df = descent fuel, ff = typical cruise fuel flow (kg/h), w = reference TOW (t).
 * These are estimates, not Airbus data.
 */
const AC = {
  a320ceo: { cd: 1.00, cf: 1.00, dd: 1.00, df: 1.00, ff: 2400, w: 68 },
  a320neo: { cd: 1.00, cf: 0.85, dd: 1.00, df: 0.90, ff: 2100, w: 70 },
  a321ceo: { cd: 1.15, cf: 1.25, dd: 1.05, df: 1.10, ff: 2750, w: 82 },
  a321neo: { cd: 1.15, cf: 1.06, dd: 1.05, df: 1.00, ff: 2400, w: 85 },
};

/**
 * Generic A320 CEO climb from brake release (mid weight, ISA, no wind).
 * Each row: [FL, distance NM, time min, fuel kg]. Values between rows are interpolated.
 */
const CLB = [
  [50, 10, 3, 350],
  [100, 18, 5, 500],
  [200, 45, 11, 850],
  [250, 65, 14, 1000],
  [290, 85, 17, 1150],
  [330, 110, 21, 1350],
  [350, 125, 23, 1450],
  [370, 145, 26, 1600],
  [390, 175, 31, 1800],
  [410, 210, 37, 2050],
];

/** Unit conversions and Earth radius in NM. */
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const REARTH = 3440.065;

/** Speed of sound factor: a (kt) = 38.967854 * sqrt(T in kelvin). */
const SOUND_K = 38.967854;


/* ============================================================================
 * 2. SMALL HELPERS
 * ========================================================================== */

/** Shortcut for document.getElementById. */
const $ = (id) => document.getElementById(id);

/** Saves a value on this device (silently ignored if the browser refuses). */
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (ignored) {}
}

/** Reads a value saved with store(), or null. */
function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (ignored) { return null; }
}

// Fill in the airport list and the version label on the page.
$("aptlist").textContent = Object.keys(APT).join(" ");
try { $("ver").textContent = "v" + APPV; } catch (ignored) {}


/* ============================================================================
 * 3. GEOMETRY (great circle on a sphere)
 *    Points are [lat, lon] in degrees.
 * ========================================================================== */

/** Great-circle distance between two points, in NM (haversine formula). */
function dist(a, b) {
  const [lat1, lon1] = [a[0] * D2R, a[1] * D2R];
  const [lat2, lon2] = [b[0] * D2R, b[1] * D2R];
  const h = Math.sin((lat2 - lat1) / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * REARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial true bearing from a to b, in degrees 0–360. */
function brg(a, b) {
  const [lat1, lon1] = [a[0] * D2R, a[1] * D2R];
  const [lat2, lon2] = [b[0] * D2R, b[1] * D2R];
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Point at fraction t (0..1) of the great circle from a to b. */
function gcInterp(a, b, t) {
  const [lat1, lon1] = [a[0] * D2R, a[1] * D2R];
  const [lat2, lon2] = [b[0] * D2R, b[1] * D2R];
  const angle = dist(a, b) / REARTH;            // central angle (radians)
  if (angle < 1e-9) return a.slice();           // same point

  const A = Math.sin((1 - t) * angle) / Math.sin(angle);
  const B = Math.sin(t * angle) / Math.sin(angle);
  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  return [Math.atan2(z, Math.hypot(x, y)) * R2D, Math.atan2(y, x) * R2D];
}


/* ============================================================================
 * 4. ROUTE PARSING AND SAMPLING
 * ========================================================================== */

/**
 * Parses one coordinate token. Accepted formats:
 *   -33.79,-70.78        decimal degrees
 *   S3347.6W07047.1      (also S33W070)
 *   3347.6S/07047.1W
 * Returns [lat, lon] or null.
 */
function parseCoord(s) {
  let m;
  // Decimal degrees
  if ((m = s.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/))) {
    return [+m[1], +m[2]];
  }
  // Hemisphere first: S3347.6W07047.1
  if ((m = s.match(/^([NS])(\d{2})(\d{2}(?:\.\d+)?)?([EW])(\d{3})(\d{2}(?:\.\d+)?)?$/))) {
    const lat = (+m[2] + (m[3] ? +m[3] / 60 : 0)) * (m[1] == "S" ? -1 : 1);
    const lon = (+m[5] + (m[6] ? +m[6] / 60 : 0)) * (m[4] == "W" ? -1 : 1);
    return [lat, lon];
  }
  // Hemisphere last: 3347.6S/07047.1W
  if ((m = s.match(/^(\d{2})(\d{2}(?:\.\d+)?)?([NS])\/?(\d{3})(\d{2}(?:\.\d+)?)?([EW])$/))) {
    const lat = (+m[1] + (m[2] ? +m[2] / 60 : 0)) * (m[3] == "S" ? -1 : 1);
    const lon = (+m[4] + (m[5] ? +m[5] / 60 : 0)) * (m[6] == "W" ? -1 : 1);
    return [lat, lon];
  }
  return null;
}

/** Formats [lat, lon] as a short name like S3347W07047 (used for unnamed points). */
function fmtLL(c) {
  const la = Math.abs(c[0]), lo = Math.abs(c[1]);
  return (c[0] < 0 ? "S" : "N") +
    String(Math.floor(la)).padStart(2, "0") + ((la % 1) * 60).toFixed(0).padStart(2, "0") +
    (c[1] < 0 ? "W" : "E") +
    String(Math.floor(lo)).padStart(3, "0") + ((lo % 1) * 60).toFixed(0).padStart(2, "0");
}

/**
 * Splits the route text into points.
 * A token can be an airport (SCEL), a coordinate, or NAME/coordinate.
 * Returns { pts: [{name, lat, lon, apt}], bad: [tokens not understood] }.
 */
function parseRoute(txt) {
  const tokens = txt.toUpperCase().trim().split(/\s+/).filter(Boolean);
  const pts = [], bad = [];

  tokens.forEach((t, i) => {
    let name = t, coord = null, apt = false;

    if (t.includes("/") && /^[A-Z0-9_]{2,8}\//.test(t) && !parseCoord(t)) {
      // NAME/coordinate. An airport name counts as an airport only at the ends.
      const k = t.indexOf("/");
      name = t.slice(0, k);
      coord = parseCoord(t.slice(k + 1));
      apt = !!APT[name] && (i == 0 || i == tokens.length - 1);
    } else if (APT[t]) {
      coord = APT[t];
      apt = true;
    } else {
      coord = parseCoord(t);
      if (coord) name = t.length > 10 ? fmtLL(coord) : t;
    }

    if (coord && Math.abs(coord[0]) <= 90 && Math.abs(coord[1]) <= 180) {
      pts.push({ name, lat: coord[0], lon: coord[1], apt });
    } else {
      bad.push(t);
    }
  });
  return { pts, bad };
}

/**
 * Cuts the route into samples about `step` NM apart (plus every route point).
 * Each sample is the unit the simulation works with. Fields:
 *   lat, lon   position
 *   cum        distance from departure (NM)
 *   trk        local true track (deg)
 *   name/user  route point name (user = it's one of the route points)
 *   apt        it's the departure/destination airport
 *   a0..a1     the stretch of route this sample represents; seg = a1 - a0
 */
function sampleRoute(pts, step) {
  const out = [];
  let cum = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const a = [pts[i].lat, pts[i].lon];
    const b = [pts[i + 1].lat, pts[i + 1].lon];
    const legDist = dist(a, b);
    const n = Math.max(1, Math.ceil(legDist / step));   // samples on this leg

    for (let k = 0; k < n; k++) {
      const t = k / n;
      const p = gcInterp(a, b, t);
      const ahead = gcInterp(a, b, Math.min(1, t + 0.5 / n));  // used for the local track
      out.push({
        lat: p[0], lon: p[1],
        cum: cum + legDist * t,
        trk: brg(p, ahead),
        name: k == 0 ? pts[i].name : null,
        user: k == 0,
        apt: k == 0 && pts[i].apt,
      });
    }
    cum += legDist;
  }

  // Destination
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];
  out.push({
    lat: last.lat, lon: last.lon, cum,
    trk: brg([prev.lat, prev.lon], [last.lat, last.lon]),
    name: last.name, user: true, apt: last.apt,
  });

  // Each sample "owns" half the distance to its neighbours.
  for (let i = 0; i < out.length; i++) {
    const back = i > 0 ? (out[i].cum - out[i - 1].cum) / 2 : 0;
    const fwd = i < out.length - 1 ? (out[i + 1].cum - out[i].cum) / 2 : 0;
    out[i].seg = back + fwd;
    out[i].a0 = out[i].cum - back;
    out[i].a1 = out[i].cum + fwd;
  }
  return { samples: out, total: cum };
}


/* ============================================================================
 * 5. STANDARD ATMOSPHERE (ISA)
 *    delta = pressure ratio p / 1013.25 hPa.
 * ========================================================================== */

/** Pressure (hPa) -> pressure altitude (ft). */
function hpaToFt(p) {
  return p >= 226.32
    ? (1 - Math.pow(p / 1013.25, 0.190263)) * 145366.45          // troposphere
    : 36089.24 + 20805.8 * Math.log(226.3206 / p);               // stratosphere
}

/** Pressure altitude (ft) -> pressure ratio delta. */
function deltaOf(ft) {
  return ft <= 36089
    ? Math.pow(1 - ft / 145366.45, 5.25588)
    : 0.22336 * Math.exp(-(ft - 36089) / 20805.8);
}

/** Pressure ratio delta -> pressure altitude (ft). */
function ftOfDelta(d) {
  return d >= 0.22336
    ? 145366.45 * (1 - Math.pow(d, 1 / 5.25588))
    : 36089 + 20805.8 * Math.log(0.22336 / d);
}

/** ISA temperature (°C) at a pressure altitude (ft). */
function isaT(ft) {
  return ft <= 36089 ? 15 - 1.98 * ft / 1000 : -56.5;
}

/** Altitude of each forecast level, in ft. */
const LV_FT = LEVELS.map(hpaToFt);

/**
 * OPT and REC MAX move with weight at a constant weight/pressure ratio (W/delta).
 * Given a level fl0 valid at takeoff weight, returns the equivalent level at weight w (kg).
 */
function flAtWeight(fl0, w, c) {
  return ftOfDelta(deltaOf(fl0 * 100) * w / (c.tow * 1000)) / 100;
}


/* ============================================================================
 * 6. FORECAST DOWNLOAD AND WIND PROFILES
 *    A "profile" is a list of {ft, u, v, T} sorted by altitude, for one point.
 * ========================================================================== */

/** Date -> "YYYY-MM-DDTHH:00" (the hour format Open-Meteo expects). */
function isoH(d) {
  return d.toISOString().slice(0, 13) + ":00";
}

/** Builds the Open-Meteo request: all samples, all levels, both models, around the flight time. */
function buildUrl(samples, dep, total) {
  const vars = [];
  for (const L of LEVELS) {
    vars.push("wind_speed_" + L + "hPa", "wind_direction_" + L + "hPa", "temperature_" + L + "hPa");
  }
  const firstHour = new Date(dep.getTime() - 3600e3);
  const lastHour = new Date(dep.getTime() + (total / 400 + 2) * 3600e3);

  return "https://api.open-meteo.com/v1/forecast" +
    "?latitude=" + samples.map((s) => s.lat.toFixed(3)).join(",") +
    "&longitude=" + samples.map((s) => s.lon.toFixed(3)).join(",") +
    "&hourly=" + vars.join(",") +
    "&wind_speed_unit=kn" +
    "&models=" + MODELS.map((m) => m[0]).join(",") +
    "&timezone=GMT" +
    "&start_hour=" + isoH(firstHour) +
    "&end_hour=" + isoH(lastHour);
}

/**
 * Stores the forecast in each sample:
 *   s.pm.GFS / s.pm.ECMWF  profile for each model
 *   s.pm.AVG               average of the available models
 * For each sample it uses the forecast hour closest to the time the aircraft
 * is there (ETD + distance / 440 kt).
 * Returns { age: worst gap (h) between ETA and forecast hour, models: [names found] }.
 */
function attachWx(samples, json, dep) {
  const arr = Array.isArray(json) ? json : [json];
  if (arr.length !== samples.length) {
    throw new Error("Data has " + arr.length + " points, route has " + samples.length +
      ". Use the same route that made the link.");
  }

  let maxGapMs = 0;
  const modelsFound = {};

  samples.forEach((s, i) => {
    const h = arr[i].hourly;
    if (!h || !h.time) throw new Error("Unexpected data format");

    // Pick the forecast hour closest to this point's ETA.
    const eta = dep.getTime() + s.cum / 440 * 3600e3;
    let bestIdx = 0, bestGap = 1e18;
    h.time.forEach((t, j) => {
      const gap = Math.abs(Date.parse(t + (t.length <= 16 ? ":00Z" : "")) - eta);
      if (gap < bestGap) { bestGap = gap; bestIdx = j; }
    });
    maxGapMs = Math.max(maxGapMs, bestGap);

    // With several models, Open-Meteo appends "_<model>" to each variable name.
    s.pm = {};
    const suffixed = Object.keys(h).some((x) => MODELS.some((m) => x.endsWith("_" + m[0])));

    for (const [modelId, modelName] of MODELS) {
      const prof = [];
      LEVELS.forEach((L, k) => {
        const get = (name) => suffixed ? h[name + "_" + modelId] : (modelName == "GFS" ? h[name] : null);
        const speed = get("wind_speed_" + L + "hPa");
        const dir = get("wind_direction_" + L + "hPa");
        const temp = get("temperature_" + L + "hPa");
        if (speed && dir && temp && speed[bestIdx] != null && dir[bestIdx] != null && temp[bestIdx] != null) {
          // Direction is where the wind comes FROM; u/v point where it goes.
          const th = dir[bestIdx] * D2R;
          prof.push({
            ft: LV_FT[k],
            u: -speed[bestIdx] * Math.sin(th),
            v: -speed[bestIdx] * Math.cos(th),
            T: temp[bestIdx],
          });
        }
      });
      if (prof.length >= 2) {
        s.pm[modelName] = prof;
        modelsFound[modelName] = 1;
      }
    }

    const names = Object.keys(s.pm);
    if (!names.length) throw new Error("No wind levels in the data at point " + (i + 1));

    // Average of the models, level by level.
    const avg = [];
    LEVELS.forEach((L, k) => {
      const xs = names.map((m) => s.pm[m].find((q) => q.ft == LV_FT[k])).filter(Boolean);
      if (xs.length) {
        avg.push({
          ft: LV_FT[k],
          u: xs.reduce((acc, q) => acc + q.u, 0) / xs.length,
          v: xs.reduce((acc, q) => acc + q.v, 0) / xs.length,
          T: xs.reduce((acc, q) => acc + q.T, 0) / xs.length,
        });
      }
    });
    s.pm.AVG = avg;
  });

  return { age: maxGapMs / 3600e3, models: Object.keys(modelsFound) };
}

/** Selects which model's profile the calculations use ("AVG", "GFS" or "ECMWF"). */
function useModel(S, model) {
  for (const s of S) s.prof = s.pm[model] || s.pm.AVG;
}

/**
 * Wind and temperature at altitude ft, by straight-line interpolation between
 * profile levels. Outside the profile the nearest level is used.
 */
function interpProf(prof, ft) {
  if (ft <= prof[0].ft) return prof[0];
  const n = prof.length;
  if (ft >= prof[n - 1].ft) return prof[n - 1];
  for (let i = 0; i < n - 1; i++) {
    const a = prof[i], b = prof[i + 1];
    if (ft <= b.ft) {
      const t = (ft - a.ft) / (b.ft - a.ft);
      return { u: a.u + t * (b.u - a.u), v: a.v + t * (b.v - a.v), T: a.T + t * (b.T - a.T) };
    }
  }
}

/**
 * The profile the FMS would "see" if given winds only at the levels in `lvls`
 * (it interpolates between them and holds the end values outside them).
 */
function fmsProf(prof, lvls) {
  return lvls.map((fl) => {
    const w = interpProf(prof, fl * 100);
    return { ft: fl * 100, u: w.u, v: w.v, T: w.T };
  });
}

/** Along-track wind component (kt): positive = tailwind. */
function along(w, trk) {
  const t = trk * D2R;
  return w.u * Math.sin(t) + w.v * Math.cos(t);
}


/* ============================================================================
 * 7. PERFORMANCE MODEL AND TRIP SIMULATION
 * ========================================================================== */

/**
 * Off-OPT fuel penalty as a function of distance from OPT (in thousands of ft).
 * Shape: a·d² + b·|d|, fitted so that it equals p2 % at 2000 ft and p4 % at 4000 ft.
 */
function penaltyFn(p2, p4) {
  const a = (p4 - 2 * p2) / 8 / 100;
  const b = (p2 / 100 - 4 * a) / 2;
  return (dk) => {
    const d = Math.abs(dk);
    return Math.max(0, a * d * d + b * d);
  };
}

/** Aircraft-type factors for the selected type. */
function acOf(c) {
  return AC[c.ac] || AC.a320ceo;
}

/**
 * Climb to level fl: { d: distance NM, t: time h, f: fuel kg }.
 * From the generic table, scaled by aircraft type, takeoff weight
 * (relative to the type's reference, limited to 0.85–1.25) and "Climb table scale".
 */
function climbOf(fl, c) {
  const r = climbRaw(fl, c);
  // "Climb fuel correction": kg to add at FL350 for this aircraft type, applied to
  // every level in proportion to its climb fuel (so it is −200 kg at FL350, about
  // −100 kg at FL200 ...). Distance and time are not changed.
  const corr = c.clcorr || 0;
  if (corr) r.f *= Math.max(0.5, 1 + corr / climbRaw(350, c).f);
  return r;
}

/** Climb from the FCOM table or the generic model, before the fuel correction. */
function climbRaw(fl, c) {
  const scale = (c.clf || 100) / 100;
  const T = tablesFor(c);
  if (T && T.climb) {
    // FCOM table: by level and takeoff weight; "Climb table scale" still applies.
    return {
      d: lookupT(T.climb, "d", fl, c.tow, c.clIsa, true) * scale,
      t: lookupT(T.climb, "t", fl, c.tow, c.clIsa, true) * scale / 60,
      f: lookupT(T.climb, "f", fl, c.tow, c.clIsa, true) * scale,
    };
  }
  const A = acOf(c);
  const weightK = Math.min(1.25, Math.max(0.85, c.tow / A.w));

  // Find the table rows around fl and interpolate.
  let i = 0;
  while (i < CLB.length - 2 && fl > CLB[i + 1][0]) i++;
  const a = CLB[i], b = CLB[i + 1];
  const t = (fl - a[0]) / (b[0] - a[0]);
  const col = (j) => a[j] + t * (b[j] - a[j]);

  return {
    d: col(1) * scale * A.cd * weightK,
    t: col(2) * scale * A.cd * weightK / 60,
    f: col(3) * scale * A.cf * weightK,
  };
}

/**
 * Descent from level fl to landing: { d, t, f }.
 * Simple linear model in k = FL/10: 3.2 NM and 0.45 min per 1000 ft, 150 kg + 5 kg per 1000 ft.
 */
function descOf(fl, c) {
  const T = tablesFor(c);
  if (T && T.descent) {
    // FCOM table: by level (and landing weight if the table has weight columns).
    const landingT = c.tow - c.ff * (c.total || 0) / 450 / 1000;
    // The table goes from fl down to 1500 ft (above a sea-level airport). At a high
    // airport the descent ends at elevation + 1500 ft, so the part of the table
    // below that is taken off: value(fl) − [value(elev + 1500 ft) − value(1500 ft)].
    const endFL = Math.min(fl, 15 + Math.max(0, c.delev || 0) / 100);
    const part = (k) => lookup2(T.descent, k, fl, landingT) - (lookup2(T.descent, k, endFL, landingT) - lookup2(T.descent, k, 15, landingT));
    // Approach and landing from 1500 ft above the airport, if the table gives it.
    const ap = T.descent.approach || { t: 0, f: 0, d: 0 };
    // Descent distance setting: a slower (low-CI) descent is longer and takes longer
    // at idle, so distance, time and fuel scale together; the approach doesn't.
    // The table may carry its own calibrated factor (descent.distFactor) for the type.
    const k = (c.desf || 1) * (T.descent.distFactor || 1);
    // FCOM correction per °C above ISA (descent.tempCorr = { t, f, d } fractions per °C).
    const tc = T.descent.tempCorr || {}, dev = Math.max(0, c.desIsa || 0);
    const kt = (x) => 1 + (tc[x] || 0) * dev;
    return {
      d: part("d") * k * kt("d") + (ap.d || 0),
      t: (part("t") * k * kt("t") + (ap.t || 0)) / 60,
      f: part("f") * k * kt("f") + (ap.f || 0),
    };
  }
  // Generic: the descent ends at the airport, so count only the height above it.
  const k = Math.max(0, fl - Math.max(0, c.delev || 0) / 100) / 10;
  const A = acOf(c);
  const kd = c.desf || 1;
  return {
    d: (3.2 * k * kd + 10) * A.dd,
    t: (0.45 * k * kd + 6) * A.dd / 60,
    f: (150 + 5 * k) * A.df * kd,
  };
}

/**
 * Average along-track wind over a stretch of route (s0..s1 NM) and a band of
 * altitudes (ft0..ft1, every 2000 ft). Used for the climb and descent winds.
 */
function windBand(S, s0, s1, ft0, ft1, src) {
  let total = 0, n = 0;
  for (const s of S) {
    if (s.cum < s0 - 1 || s.cum > s1 + 1) continue;
    const p = src(s);
    for (let h = ft0; h <= ft1; h += 2000) {
      total += along(interpProf(p, h), s.trk);
      n++;
    }
  }
  return n ? total / n : 0;
}

/**
 * Simulates the whole trip along a vertical profile.
 *
 *   S     route samples (with s.prof = wind profile)
 *   c     settings from cfg() (plus c.total and c.tasRef, set in render)
 *   path  { L0: first cruise level, at(s): level at route distance s }
 *   opt   { src: alternative wind profile per sample (e.g. what the FMS sees),
 *           cal: fuel calibration factor }
 *
 * Model:
 *   - Climb and descent from climbOf() / descOf(), with ground distance corrected by wind.
 *   - Cruise sample by sample:
 *       TAS  = Mach × speed of sound(T)
 *       GS   = √(TAS² − crosswind²) + tailwind
 *       FF   = average FF × (weight / mid-flight weight)
 *              × (1 + off-OPT penalty for the current weight)
 *              × (TAS / route-average TAS at OPT)
 *       fuel = FF × distance / GS, and the weight drops by that fuel.
 *   - Each step climb costs stepFuelKg(): from the FCOM climb table when loaded,
 *     otherwise c.stepc kg per 1000 ft.
 *
 * Returns (or { bad: true } if the route is too short for this level):
 *   fuel, time, cost (= fuel + CI × minutes), cruise figures (cfuel, ctime, cgs, cdist),
 *   averages (tw tailwind, isa deviation, tas), lo/hi = route distance where cruise
 *   starts/ends, over = breaks the REC MAX margin somewhere, chk/tchk = fuel burnt
 *   and time at each named fix, wts = weight along the route, climb/descent details.
 */
function sim(S, c, path, opt = {}) {
  const src = opt.src || ((s) => s.prof);
  const pen = penaltyFn(c.p2, c.p4);
  const tasRef = c.tasRef || c.mach * 573.57;     // fallback: TAS in ISA at the tropopause
  const cal = opt.cal ?? c.cal;

  // --- Climb and descent ---------------------------------------------------
  const L0 = path.L0;
  const climb = climbOf(L0, c);
  const Lend = path.at(c.total - 1);
  const desc = descOf(Lend, c);
  const climbWind = windBand(S, 0, climb.d, 3000, L0 * 100, src);
  const descWind = windBand(S, c.total - desc.d, c.total, 3000, Lend * 100, src);

  // Cruise runs from the end of climb (lo) to the start of descent (hi), over the ground.
  const lo = climb.d + climbWind * climb.t;
  const hi = c.total - (desc.d + descWind * desc.t);
  if (hi - lo < 15) return { fl: L0, bad: true, why: "short" };

  // --- Cruise ----------------------------------------------------------------
  let weight = c.tow * 1000 - climb.f * cal;
  let time = 0, fuel = 0;
  let dsum = 0, twSum = 0, isaSum = 0, tasSum = 0;   // distance-weighted sums for averages
  let prevFL = null, steps = 0, over = false;
  const chk = {}, tchk = {}, wts = [];

  // Weight at mid-flight: the average FF the user enters applies there.
  const midWeight = c.tow * 1000 - 0.5 * c.ff * (c.total / 450);

  for (const s of S) {
    // Part of this sample's stretch that is in cruise.
    const d = Math.max(0, Math.min(s.a1, hi) - Math.max(s.a0, lo));
    const fuelBefore = fuel, timeBefore = time;

    if (d > 0) {
      const fl = path.at(s.cum);

      // Level change: a climb costs fuel, a descent is free.
      if (prevFL !== null && fl !== prevFL) {
        if (fl > prevFL) {
          const stepFuel = stepFuelKg(c, prevFL, fl, weight) * cal;
          fuel += stepFuel;
          weight -= stepFuel;
        }
        steps++;
      }
      prevFL = fl;

      // Inside the REC MAX margin at this weight?
      if (fl > recAt(weight, c, s.cum) - c.recm / 100 + 0.5) over = true;

      // Wind components, TAS and ground speed.
      const W = interpProf(src(s), fl * 100);
      const t = s.trk * D2R;
      const tail = W.u * Math.sin(t) + W.v * Math.cos(t);
      const cross = W.u * Math.cos(t) - W.v * Math.sin(t);
      const tas = c.mach * SOUND_K * Math.sqrt(W.T + 273.15);
      const gs = Math.sqrt(Math.max(tas * tas - cross * cross, 1)) + tail;
      const hours = d / Math.max(gs, 150);

      // Fuel flow and fuel for this piece.
      const f = pieceFuel(c, fl, weight, tas, hours, cal, pen, tasRef, midWeight);

      time += hours;
      fuel += f;
      weight -= f;
      dsum += d;
      twSum += tail * d;
      isaSum += (W.T - isaT(fl * 100)) * d;
      tasSum += tas * d;
    }

    wts.push({ cum: s.cum, w: weight });

    // Fuel burnt and time elapsed at each named route point.
    if (s.user && s.name) {
      if (s.cum < lo) {
        // In the climb: find the level reached at this distance from the climb
        // table itself, and take that level's climb fuel and time.
        const p = phaseAt((fl) => climbPart(fl, c), Math.max(0, s.cum) * climb.d / lo, L0);
        chk[s.name] = p.f * cal;
        tchk[s.name] = p.t;
      } else if (s.cum <= hi) {
        // In cruise: climb + cruise so far, including the part of this piece before the fix.
        const frac = d > 0 ? Math.min(1, Math.max(0, (Math.min(s.cum, hi) - Math.max(s.a0, lo)) / d)) : 0;
        chk[s.name] = climb.f * cal + fuelBefore + (fuel - fuelBefore) * frac;
        tchk[s.name] = climb.t + timeBefore + (time - timeBefore) * frac;
      } else {
        // In the descent: the level still to descend from at this distance to go
        // (from the descent table); the fuel and time used so far are the rest.
        const toGo = (c.total - s.cum) * desc.d / Math.max(1, c.total - hi);
        const p = phaseAt((fl) => descOf(fl, c), toGo, Lend);
        chk[s.name] = climb.f * cal + fuel + (desc.f - p.f) * cal;
        tchk[s.name] = climb.t + time + (desc.t - p.t);
      }
    }
  }
  if (!dsum) return { fl: L0, bad: true, why: "short" };

  // --- Totals ----------------------------------------------------------------
  const extraFuel = (climb.f + desc.f) * cal;
  const extraTime = climb.t + desc.t;
  const T = time + extraTime;
  const F = fuel + extraFuel;

  return {
    fl: L0, fuel: F, time: T, cost: F + c.ci * T * 60,
    cfuel: fuel, ctime: time, cgs: dsum / time, cdist: dsum, xf: extraFuel,
    tw: twSum / dsum, isa: isaSum / dsum, tas: tasSum / dsum,
    lo, hi, over, steps, chk, tchk, wts,
    wc: climbWind, wd: descWind, cl: climb, de: desc,
  };
}


/* ============================================================================
 * 7a. FCOM PERFORMANCE TABLES (optional)
 *    Loaded from a JSON file the user keeps on the device (never part of the
 *    code). When a table is present for the selected aircraft type it replaces
 *    the generic model for that phase. File format: see TABLES_HELP below.
 * ========================================================================== */

/** Loaded tables by aircraft type key ("a320neo" ...), or {} if none. */
let TABLES = load("optfl.tables") || {};

/**
 * Tables for the selected aircraft type, or null.
 * Returns null when the "Performance model" switch is on "Generic",
 * so the generic model is used even if tables are loaded.
 */
function tablesFor(c) {
  if (c.perf !== "tables") return null;
  const T = TABLES[c.ac];
  if (!T) return null;
  if (!T.variants) return T;                       // older file: one table per type
  // Several FCOM variants for the type: pick the one whose MSN range has c.msn.
  const v = c.msn && T.variants.find((x) => x.msn && c.msn >= x.msn[0] && c.msn <= x.msn[1]);
  return v || T.variants[0];
}

/** Linear interpolation that extrapolates past the ends (used across ISA deviations). */
function lerpX(xs, ys, x) {
  const n = xs.length;
  if (n == 1) return ys[0];
  const i = x <= xs[0] ? 0 : x >= xs[n - 1] ? n - 2 : xs.findIndex((v, k) => x >= v && x <= xs[k + 1]);
  return ys[i] + (ys[i + 1] - ys[i]) * (x - xs[i]) / (xs[i + 1] - xs[i]);
}

/**
 * Lookup in a table that may come in several temperatures:
 *   { weights, rows }                         one temperature
 *   { weights, sets: [{ isa, rows }, ...] }   e.g. ISA+10 and ISA+20
 * Interpolates in weight and FL inside each set, then in ISA deviation.
 * clamp = true holds the value at the coldest/warmest set instead of extrapolating.
 */
function lookupT(tbl, key, fl, weightT, isa, clamp) {
  if (!tbl.sets) return lookup2(tbl, key, fl, weightT);
  const xs = tbl.sets.map((st) => st.isa);
  const ys = tbl.sets.map((st) => lookup2({ weights: tbl.weights, rows: st.rows }, key, fl, weightT));
  const d = isFinite(isa) ? isa : xs[0];
  return clamp ? lerp1(xs, ys, d) : lerpX(xs, ys, Math.max(-15, Math.min(30, d)));
}

/** Straight-line interpolation of ys over xs (sorted ascending), clamped at the ends. */
function lerp1(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  const n = xs.length;
  if (x >= xs[n - 1]) return ys[n - 1];
  for (let i = 0; i < n - 1; i++) {
    if (x <= xs[i + 1]) {
      const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
      return ys[i] + t * (ys[i + 1] - ys[i]);
    }
  }
}

/**
 * Two-way lookup in a table with FL rows and weight columns:
 *   tbl = { weights: [t, ...], rows: [{ fl, <key>: [value per weight] or value }, ...] }
 * Interpolates in weight (t) inside each row, then in FL between rows.
 */
function lookup2(tbl, key, fl, weightT) {
  const fls = tbl.rows.map((r) => r.fl);
  const vals = tbl.rows.map((r) => Array.isArray(r[key]) ? lerp1(tbl.weights, r[key], weightT) : r[key]);
  return lerp1(fls, vals, fl);
}

/** OPT (FL) at weight w (kg): from the FCOM table if loaded, otherwise by constant W/delta. */
function optAt(w, c) {
  const T = tablesFor(c);
  return T && T.alt ? lerp1(T.alt.weights, T.alt.opt, w / 1000) : flAtWeight(c.opt, w, c);
}

/**
 * REC MAX (FL) at weight w (kg): from the FCOM table if loaded, otherwise by constant W/delta.
 * With the warm-day lines, `cum` (NM from departure) selects the local forecast temperature.
 */
function recAt(w, c, cum) {
  const T = tablesFor(c);
  // With "My FMS value", the chart line is shifted (c.recOff) so it passes through
  // the REC MAX typed in at TOW; the chart then only gives the change with weight.
  if (!(T && T.alt)) return flAtWeight(c.recmax, w, c);
  // ISA deviation: the local forecast at distance cum if given, else the route average.
  const dev = cum != null && c.devAt ? c.devAt(cum) : c.isaDev;
  return chartRecMax(T.alt, w / 1000, dev) + (c.recOff || 0);
}

/**
 * Chart REC MAX (FL) at weight wT (t) for an ISA deviation (°C).
 * If the table has the warm-day lines (alt.recmaxT: ≤ISA+10, ISA+15, ISA+20),
 * interpolate between them; colder than +10 uses the ≤ISA+10 line, warmer than
 * +20 the ISA+20 line. Without them, the single REC MAX line is used.
 */
function chartRecMax(alt, wT, isaDev) {
  const base = lerp1(alt.weights, alt.recmax, wT);
  const R = alt.recmaxT;
  if (!R || !isFinite(isaDev)) return base;
  const lines = R.fl.map((row) => lerp1(alt.weights, row, wT));
  return lerp1(R.isa, lines, Math.min(Math.max(isaDev, R.isa[0]), R.isa[R.isa.length - 1]));
}

/**
 * Fuel (kg) for one cruise piece.
 *   With an FCOM cruise table: FF(FL, weight) at ISA, corrected by TAS / TAS(ISA)
 *   for the real temperature.
 *   Without: average FF × weight ratio × (1 + off-OPT penalty) × TAS / reference TAS.
 */
function pieceFuel(c, fl, weight, tas, hours, cal, pen, tasRef, midWeight) {
  const T = tablesFor(c);
  if (T && T.cruise && T.cruise.sets) {
    // Tables at several temperatures: fuel flow at the local ISA deviation (recovered
    // from the TAS), then scaled for your Mach against the table's Mach.
    const Tk = Math.pow(tas / (c.mach * SOUND_K), 2);
    const isa = Tk - 273.15 - isaT(fl * 100);
    const ff = lookupT(T.cruise, "ff", fl, weight / 1000, isa, false);
    return ff * cal * (c.mach / (T.cruise.mach || c.mach)) * hours;
  }
  if (T && T.cruise) {
    const ff = lookup2(T.cruise, "ff", fl, weight / 1000);
    // The table is for its own Mach (M.78) in ISA. Fuel flow scales with the actual
    // TAS (your Mach, real temperature) over the table's TAS (table Mach, ISA).
    const tasIsa = (T.cruise.mach || c.mach) * SOUND_K * Math.sqrt(isaT(fl * 100) + 273.15);
    return ff * cal * (tas / tasIsa) * hours;
  }
  const ff = c.ff * cal * (weight / midWeight);
  return ff * (1 + pen((fl - optAt(weight, c)) / 10)) * (tas / tasRef) * hours;
}

/**
 * Extra fuel (kg, before the perf factor) of a step climb from FL `from` to FL `to`
 * at weight w (kg). With FCOM climb and cruise tables: the climb fuel between the
 * two levels (table at this weight and the climb temperature) minus the cruise fuel
 * the aircraft would have burned anyway over the extra distance covered in the climb.
 * Without tables: the "Step climb cost" setting (kg per 1000 ft).
 */
function stepFuelKg(c, from, to, w) {
  if (to <= from) return 0;
  const T = tablesFor(c);
  if (!(T && T.climb && T.cruise && T.cruise.sets)) return c.stepc * (to - from) / 10;
  const wt = w / 1000, isa = c.isaDev || 0;
  const cl = (fl, k) => lookupT(T.climb, k, fl, wt, isa, true);
  const dF = cl(to, "f") - cl(from, "f");
  const dD = cl(to, "d") - cl(from, "d");
  // Cruise fuel per NM at the lower level, this weight and temperature (still air).
  const tas = (T.cruise.mach || c.mach) * SOUND_K * Math.sqrt(isaT(from * 100) + isa + 273.15);
  const perNM = lookupT(T.cruise, "ff", from, wt, isa, false) / tas;
  return Math.max(0, dF - dD * perNM);
}

/** Which phases come from FCOM tables, for the notes on screen. */
function tablesInUse(c) {
  const T = tablesFor(c);
  if (!T) return [];
  return ["climb", "cruise", "alt", "descent"].filter((k) => T[k]);
}

/**
 * Reads a tables file. Accepted shapes:
 *   { "tables": [ { "type": "a320neo", ... }, ... ] }   several aircraft
 *   { "type": "a320neo", ... }                           one aircraft
 * Each aircraft may contain any of:
 *   "climb":   { "weights": [t], "rows": [{ "fl", "t": [min], "f": [kg], "d": [NM] }] }   from brake release
 *   "cruise":  { "weights": [t], "rows": [{ "fl", "ff": [kg/h, both engines] }] }        at the cruise Mach, ISA
 *   "alt":     { "weights": [t], "opt": [FL], "recmax": [FL] }
 *              optional "recmaxT": { "isa": [10, 15, 20], "fl": [[FL by weight] per ISA line] }
 *   "descent": { "rows": [{ "fl", "t": min, "f": kg, "d": NM }] }                       to landing
 *              (or with "weights" and arrays, interpolated at the estimated landing weight)
 */
function parseTables(json) {
  const list = Array.isArray(json.tables) ? json.tables : [json];
  const out = {};
  const okRows1 = (t, keys) => t && Array.isArray(t.rows) && t.rows.length >= 2 &&
    t.rows.every((r) => isFinite(r.fl) && keys.every((k) => r[k] != null));
  // A table is either one set of rows or several temperature sets of rows.
  const okRows = (t, keys) => t && (t.sets
    ? Array.isArray(t.sets) && t.sets.length >= 1 && t.sets.every((st) => isFinite(st.isa) && okRows1(st, keys))
    : okRows1(t, keys));
  for (const t of list) {
    if (!t || !AC[t.type]) throw new Error("Unknown aircraft type: " + (t && t.type) + " (use a320ceo, a320neo, a321ceo or a321neo)");
    const e = { name: t.name || t.type, msn: Array.isArray(t.msn) ? t.msn : null };
    if (t.climb) { if (!okRows(t.climb, ["t", "f", "d"])) throw new Error(t.type + ": climb table incomplete"); e.climb = t.climb; }
    if (t.cruise) { if (!okRows(t.cruise, ["ff"])) throw new Error(t.type + ": cruise table incomplete"); e.cruise = t.cruise; }
    if (t.descent) { if (!okRows(t.descent, ["t", "f", "d"])) throw new Error(t.type + ": descent table incomplete"); e.descent = t.descent; }
    if (t.alt) {
      const a = t.alt;
      if (!(Array.isArray(a.weights) && Array.isArray(a.opt) && Array.isArray(a.recmax) &&
            a.weights.length >= 2 && a.opt.length == a.weights.length && a.recmax.length == a.weights.length)) {
        throw new Error(t.type + ": alt table incomplete");
      }
      // Optional warm-day REC MAX lines: { isa: [10, 15, 20], fl: [[...], [...], [...]] }.
      const R = a.recmaxT;
      if (R && !(Array.isArray(R.isa) && Array.isArray(R.fl) && R.isa.length >= 2 && R.fl.length == R.isa.length &&
                 R.fl.every((row) => Array.isArray(row) && row.length == a.weights.length))) {
        throw new Error(t.type + ": alt.recmaxT incomplete");
      }
      e.alt = a;
    }
    // Several entries for one type = FCOM variants by MSN.
    (out[t.type] = out[t.type] || { variants: [] }).variants.push(e);
  }
  return out;
}

/* ============================================================================
 * 8. VERTICAL PROFILES
 *    A profile ("path") is { L0, at(s) }: first cruise level and level at distance s.
 * ========================================================================== */

/** Constant level all the way. */
const constPath = (L) => ({ L0: L, at: () => L });

/**
 * Reads the OFP's planned cruise levels from its navigation log and returns the
 * level changes at fixes: [{ fix, fl }]. Uses T/C and T/D pseudo-points and
 * "steady" levels (same level at two consecutive fixes), ignoring points
 * where the aircraft is still climbing.
 */
function ofpChanges(levels) {
  const out = [];
  let current = null, lastFix = null;

  levels.forEach((item, i) => {
    const pseudo = /^T_O_|^B_O_/.test(item.name);
    if (pseudo) {
      if (/^T_O_[CD]/.test(item.name) && item.fl != current) {
        out.push({ fix: lastFix, fl: Math.round(item.fl / 10) * 10 });
        current = item.fl;
      }
      return;
    }
    const next = levels.slice(i + 1).find((q) => !/^B_O_/.test(q.name));
    if (current !== null && next && next.fl == item.fl && item.fl >= 200 && item.fl != current) {
      out.push({ fix: lastFix, fl: Math.round(item.fl / 10) * 10 });
      current = item.fl;
    }
    lastFix = item.name;
  });
  return out;
}

/** Turns the OFP's level changes into a profile on this route. */
function pathFromOFP(levels, S) {
  const changes = ofpChanges(levels || []);
  if (!changes.length) return null;
  const pts = changes.map((q) => {
    const s = S.find((x) => x.name == q.fix);
    return { at: s ? s.cum : 0, fl: q.fl };
  });
  return {
    L0: pts[0].fl,
    at: (x) => {
      let f = pts[0].fl;
      for (const q of pts) if (x >= q.at) f = q.fl;
      return f;
    },
  };
}

/** Turns a step plan (from stepPlan) into a profile. */
function pathFromPlan(sp, base) {
  if (!sp) return constPath(base.fl);
  const changes = [];
  sp.pick.forEach((L, k) => {
    if (k == 0 || L != sp.pick[k - 1]) changes.push({ at: sp.segs[k].a, fl: L });
  });
  return {
    L0: changes[0].fl,
    at: (x) => {
      let f = changes[0].fl;
      for (const q of changes) if (x >= q.at) f = q.fl;
      return f;
    },
  };
}

/** Text like "FL340 → FL360 (ILMAR)" describing a profile's cruise levels. */
function profTxt(path, r, S) {
  const out = [];
  let prev = null;
  for (const s of S) {
    if (s.cum < r.lo || s.cum > r.hi) continue;
    const f = path.at(s.cum);
    if (f !== prev) {
      out.push("FL" + f + (prev !== null && s.name ? " (" + s.name + ")" : ""));
      prev = f;
    }
  }
  return out.join(" → ");
}


/* ============================================================================
 * 9. CHOOSING THE 4 FMS WIND LEVELS
 * ========================================================================== */

/**
 * Tries every set of 4 levels between FL200 and FL410 and keeps the one whose
 * FMS-style reconstruction (straight lines between the 4) best matches the
 * forecast over the band of interest.
 *
 *   cruise  samples in the cruise
 *   band    levels where accuracy matters
 *   wts     weight per level (levels close to the best fuel count more)
 *   must    the best level: the 4 levels must bracket it
 *
 * Error = worst weighted error in the band + 0.25 × weighted average error.
 * Returns { lv: [4 levels], e: error in kt }.
 */
function pickFmsLevels(cruise, band, wts, must) {
  const cands = [];
  for (let f = 200; f <= 410; f += 10) cands.push(f);
  const wsum = cruise.reduce((acc, s) => acc + s.seg, 0) || 1;

  const errorOf = (lv) => {
    let worst = 0, total = 0, wTotal = 0;
    for (const fl of band) {
      let e = 0;
      for (const s of cruise) {
        if (s.seg <= 0) continue;
        const real = interpProf(s.prof, fl * 100);
        const key = lv.join();
        const seen = s._c[key] || (s._c[key] = fmsProf(s.prof, lv));   // cache per sample
        const fms = interpProf(seen, fl * 100);
        e += Math.hypot(real.u - fms.u, real.v - fms.v) * s.seg;
      }
      e /= wsum;
      const w = wts[fl] ?? 0.2;
      worst = Math.max(worst, w * e);
      total += w * e;
      wTotal += w;
    }
    return worst + 0.25 * total / wTotal;
  };

  cruise.forEach((s) => { s._c = {}; });
  let best = null;
  for (let i = 0; i < cands.length; i++)
    for (let j = i + 1; j < cands.length; j++)
      for (let k = j + 1; k < cands.length; k++)
        for (let l = k + 1; l < cands.length; l++) {
          const lv = [cands[i], cands[j], cands[k], cands[l]];
          // Must bracket the best level and stay close to the band.
          if (lv[0] > must || lv[3] < must) continue;
          if (lv[3] < band[band.length - 1] - 40 || lv[0] > band[0] + 40) continue;
          const e = errorOf(lv);
          if (!best || e < best.e - 1e-9) best = { lv, e };
        }
  cruise.forEach((s) => { delete s._c; });
  return best;
}

/** Worst (unweighted) wind error in kt over the band when the FMS has winds only at `lv`. */
function profErr(cruise, band, lv) {
  const wsum = cruise.reduce((acc, s) => acc + s.seg, 0) || 1;
  let worst = 0;
  for (const fl of band) {
    let e = 0;
    for (const s of cruise) {
      if (s.seg <= 0) continue;
      const real = interpProf(s.prof, fl * 100);
      const fms = interpProf(fmsProf(s.prof, lv), fl * 100);
      e += Math.hypot(real.u - fms.u, real.v - fms.v) * s.seg;
    }
    worst = Math.max(worst, e / wsum);
  }
  return worst;
}


/* ============================================================================
 * 10. STEP PLAN (dynamic programming)
 * ========================================================================== */

/**
 * Finds the cheapest sequence of levels along the cruise, changing only at fixes.
 *
 *   base    simulation of the best constant level (gives cruise limits and weights)
 *   levels  allowed levels (right direction, up to REC MAX at landing weight)
 *
 * 1. Cut the cruise into sections at route fixes (sections < 120 NM are merged).
 * 2. Cost of flying each section at each level (fuel + CI × minutes),
 *    or null if the level breaks the REC MAX margin there.
 * 3. Dynamic programming over sections: cost so far + step-climb cost.
 *    Climb and descent are charged for the first/last level, including the
 *    extra cruise distance a lower level flies.
 *
 * Returns { segs, pick: level per section, saving vs base level all the way, levels }.
 */
function stepPlan(S, c, base, levels) {
  // --- 1. Sections between fixes -------------------------------------------
  const fixes = S.filter((s) => s.user && s.name && !s.apt && s.cum > base.lo + 20 && s.cum < base.hi - 20);
  const cuts = [base.lo, ...fixes.map((s) => s.cum), base.hi];
  const names = ["T/C", ...fixes.map((s) => s.name)];
  const segs = [];
  for (let i = 0; i < cuts.length - 1; i++) segs.push({ a: cuts[i], b: cuts[i + 1], name: names[i] });

  // Merge short sections with a neighbour until all are >= 120 NM.
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].b - segs[i].a < 120 && segs.length > 1) {
      const j = i < segs.length - 1 ? i + 1 : i - 1;
      const first = Math.min(i, j), second = Math.max(i, j);
      segs.splice(first, 2, { a: segs[first].a, b: segs[second].b, name: segs[first].name });
      i = -1;   // start again
    }
  }

  // --- 2. Cost per section and level -----------------------------------------
  const weightAt = (x) => {
    let w = base.wts[0].w;
    for (const q of base.wts) if (q.cum <= x) w = q.w;
    return w;
  };
  const pen = penaltyFn(c.p2, c.p4);
  const tasRef = c.tasRef || c.mach * 573.57;
  const midWeight = c.tow * 1000 - 0.5 * c.ff * (c.total / 450);

  const segCost = (sg, L) => {
    let w = weightAt(sg.a), F = 0, T = 0;
    // Inside the margin anywhere in the section (local temperature, weight there)?
    if (L > recAt(w, c, sg.a) - c.recm / 100 + 0.5) return null;
    for (const s of S) {
      if (s.cum > sg.a && s.cum < sg.b && L > recAt(weightAt(s.cum), c, s.cum) - c.recm / 100 + 0.5) return null;
    }
    for (const s of S) {
      const d = Math.max(0, Math.min(s.a1, sg.b) - Math.max(s.a0, sg.a));
      if (d <= 0) continue;
      const W = interpProf(s.prof, L * 100);
      const t = s.trk * D2R;
      const tail = W.u * Math.sin(t) + W.v * Math.cos(t);
      const cross = W.u * Math.cos(t) - W.v * Math.sin(t);
      const tas = c.mach * SOUND_K * Math.sqrt(W.T + 273.15);
      const gs = Math.sqrt(Math.max(tas * tas - cross * cross, 1)) + tail;
      const hours = d / Math.max(gs, 150);
      const f = pieceFuel(c, L, w, tas, hours, c.cal, pen, tasRef, midWeight);
      F += f; T += hours; w -= f;
    }
    return F + c.ci * T * 60;
  };

  const n = segs.length;
  const cost = segs.map((sg) => levels.map((L) => segCost(sg, L)));

  // --- 3. Dynamic programming ---------------------------------------------------
  // Climb/descent cost of a whole constant level (used for the comparison).
  const endsCost = (L) => {
    const cl = climbOf(L, c), de = descOf(L, c);
    return (cl.f + de.f) * c.cal + c.ci * (cl.t + de.t) * 60;
  };

  // A lower first level ends its climb earlier, so it flies extra cruise:
  // charge it at that level's cost per NM in the first section (same for the descent).
  const len0 = segs[0].b - segs[0].a;
  const lenN = segs[n - 1].b - segs[n - 1].a;
  const baseClimb = climbOf(base.fl, c), baseDesc = descOf(base.fl, c);
  const climbCost = (L, j) => {
    const cl = climbOf(L, c);
    return cl.f * c.cal + c.ci * cl.t * 60 + (baseClimb.d - cl.d) * cost[0][j] / len0;
  };
  const descCost = (L, j) => {
    const de = descOf(L, c);
    return de.f * c.cal + c.ci * de.t * 60 + (baseDesc.d - de.d) * cost[n - 1][j] / lenN;
  };

  const dp = [], back = [];   // dp[k][j] = best cost to finish section k at levels[j]
  dp[0] = levels.map((L, j) => cost[0][j] == null ? Infinity : cost[0][j] + climbCost(L, j));

  for (let k = 1; k < n; k++) {
    dp[k] = [];
    back[k] = [];
    levels.forEach((L, j) => {
      dp[k][j] = Infinity;
      if (cost[k][j] == null) return;
      levels.forEach((P, i) => {
        if (dp[k - 1][i] === Infinity) return;
        // Step climb costs fuel; a step down gets a tiny cost so it isn't chosen for nothing.
        const transition = L > P ? stepFuelKg(c, P, L, weightAt(segs[k].a)) * c.cal : (L < P ? 5 : 0);
        const v = dp[k - 1][i] + transition + cost[k][j];
        if (v < dp[k][j]) { dp[k][j] = v; back[k][j] = i; }
      });
    });
  }

  const finalCost = levels.map((L, j) => cost[n - 1][j] == null ? Infinity : dp[n - 1][j] + descCost(L, j));
  let j = finalCost.indexOf(Math.min(...finalCost));
  if (!isFinite(finalCost[j])) return null;

  // Walk back to get the level of each section.
  const pick = [];
  for (let k = n - 1; k >= 0; k--) {
    pick[k] = levels[j];
    if (k > 0) j = back[k][j];
  }

  // Saving against flying the base level all the way.
  const bi = levels.indexOf(base.fl);
  let constCost = null;
  if (bi >= 0 && cost.every((row) => row[bi] != null)) {
    constCost = cost.reduce((acc, row) => acc + row[bi], 0) + endsCost(base.fl);
  }
  const best = Math.min(...finalCost);
  return { segs, pick, saving: constCost != null ? constCost - best : null, levels };
}


/* ============================================================================
 * 11. TEXT FORMATTING
 * ========================================================================== */

/** Wind vector -> "DDD/SSS" (direction it comes from / speed), as the FMS shows it. */
function windStr(w) {
  const speed = Math.hypot(w.u, w.v);
  let dir = (Math.atan2(-w.u, -w.v) * R2D + 360) % 360;
  dir = Math.round(dir) % 360 || 360;
  return String(dir).padStart(3, "0") + "/" + String(Math.round(speed)).padStart(3, "0");
}

/** Hours -> "h:mm" (durations). */
function hm(h) {
  const m = Math.round(h * 60);
  return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0");
}

/** Number with sign: +5, -3, 0. */
function sgn(x, dp = 0) {
  const v = x.toFixed(dp);
  return +v == 0 ? (0).toFixed(dp) : (x > 0 ? "+" : "") + v;
}

/** Signed kg with thousands separator: +1,234 / −56. */
function kgs(x) {
  return (x >= 0 ? "+" : "−") + kg(Math.abs(x));
}

/** kg with thousands separator: 12,345. */
function kg(x) {
  return Math.round(x).toLocaleString("en-US");
}

/** Average wind vector at altitude ft over route distance s0..s1. */
function vecAvg(S, s0, s1, ft) {
  let u = 0, v = 0, n = 0;
  for (const s of S) {
    if (s.cum < s0 - 1 || s.cum > s1 + 1) continue;
    const w = interpProf(s.prof, ft);
    u += w.u; v += w.v; n++;
  }
  return n ? { u: u / n, v: v / n } : null;
}


/* ============================================================================
 * 12. READING THE INPUT FORM
 * ========================================================================== */

/** Form fields saved on the device and restored at start-up. */
const IDS = ["actype", "mode", "route", "dep", "tow", "mach", "ci", "goal", "opt", "recmax", "recm",
  "minfl", "model", "perf", "recsrc", "parity", "ff", "clf", "pfac", "msn", "delev", "desf", "magvar", "p2", "p4", "stepc", "minstep", "mine"];

/** Saves all form fields. */
function saveInputs() {
  const o = {};
  IDS.forEach((id) => { o[id] = $(id).value; });
  store("optfl.in", o);
}

/** Reads the form into a settings object `c` used by all calculations. */
function cfg() {
  const num = (id) => parseFloat($(id).value);
  const ac = $("actype").value;
  return {
    ac,                                                   // aircraft type key
    mach: num("mach") || 0.78,
    // Objective: "fuel" ignores the cost index (minimum trip fuel); "cost" uses
    // cost = fuel + CI × minutes, like the FMS ECON.
    goal: $("goal").value,
    ci: $("goal").value == "cost" ? num("ci") || 0 : 0,  // cost index (kg/min); 0 = minimum fuel
    tow: num("tow") || AC[ac].w,                          // takeoff weight (t)
    opt: num("opt"),                                      // no-wind OPT at TOW (FL)
    recmax: num("recmax"),                                // REC MAX at TOW (FL)
    minfl: num("minfl"),                                  // lowest level to check
    ff: num("ff"),                                        // average cruise FF (kg/h)
    clf: num("clf") || 100,                               // climb table scale (%)
    clcorr: num("clcorr") || 0,                           // climb fuel correction at FL350 (kg, this type)
    delev: num("delev") || 0,                             // destination elevation (ft)
    pfac: num("pfac") || 0,
    msn: num("msn") || 0,                                 // aircraft MSN: picks the FCOM variant
    desf: (num("desf") || 100) / 100,                     // descent distance vs FCOM (1 = table)                               // perf factor / fuel bias (%), FCOM tables only
    p2: num("p2"), p4: num("p4"),                         // off-OPT penalties (%)
    recm: isFinite(num("recm")) ? Math.max(0, num("recm")) : 2000,   // margin below REC MAX (ft)
    stepc: isFinite(num("stepc")) ? num("stepc") : 25,               // step climb cost (kg/1000 ft)
    minstep: isFinite(num("minstep")) ? num("minstep") : 40,         // min saving for a step (kg)
    parity: $("parity").value,                            // auto / odd / even / all
    mode: $("mode").value,                                // manual / datalink
    magvar: num("magvar") || 0,
    model: $("model").value,                              // AVG / GFS / ECMWF
    perf: $("perf").value,                                // performance model: generic / tables
    recsrc: $("recsrc").value,                            // REC MAX with tables: "chart" or "fms"
    recOff: 0,                                            // FL shift of the chart REC MAX (set in render)
    cal: 1,                                               // fuel calibration factor
    mine: $("mine").value.split(/[\s,]+/).map(Number).filter((x) => x >= 100 && x <= 450).slice(0, 4),
  };
}

/** Departure time from the form (UTC). */
function depDate() {
  const v = $("dep").value;
  return v ? new Date(v + ":00Z") : new Date();
}


/* ============================================================================
 * 13. MAIN FLOW: route -> forecast -> render
 * ========================================================================== */

/**
 * Current state:
 *   STATE.P     prepared route { pts, samples, total, dep, route }
 *   STATE.json  raw forecast data
 *   STATE.meta  { fetched: time downloaded, runs: model run times }
 *   STATE.info  { age, models } from attachWx
 *   STATE.last  results of the last render (used by the flight log)
 */
let STATE = null;

/** Parses and samples the route in the form. Throws a readable error if it can't. */
function prepare() {
  const { pts, bad } = parseRoute($("route").value);
  if (bad.length) {
    throw new Error("Unknown: " + bad.join(" ") + "\nUse coordinates (e.g. S3530.0W07130.0) or NAME/coords.");
  }
  if (pts.length < 2) throw new Error("Enter at least two points.");
  const { samples, total } = sampleRoute(pts, 100);
  if (samples.length > 90) throw new Error("Route too long for one request.");
  return { pts, samples, total, dep: depDate(), route: $("route").value };
}

/** Status line under the buttons. cls = "", "ok", "warn" or "err". */
function setMsg(text, cls) {
  $("m1").className = "msg " + (cls || "");
  $("m1").textContent = text;
}

/** Asks Open-Meteo when each model's latest run was produced (optional; 5 s timeout). */
async function fetchMeta() {
  const out = {};
  await Promise.all(Object.entries(META).map(async ([name, id]) => {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch("https://api.open-meteo.com/data/" + id + "/static/meta.json", { signal: ctl.signal });
      clearTimeout(timer);
      if (r.ok) {
        const j = await r.json();
        if (j.last_run_initialisation_time) out[name] = j.last_run_initialisation_time * 1000;
      }
    } catch (ignored) {}
  }));
  return out;
}

/**
 * "Get winds & calculate": downloads the forecast and renders.
 * If the download is blocked (e.g. inside claude.ai), shows a link and a paste box.
 */
async function go() {
  setMsg("Fetching GFS + ECMWF winds…");
  $("paste").style.display = "none";

  let P;
  try { P = prepare(); } catch (e) { setMsg(e.message, "err"); return; }

  const url = buildUrl(P.samples, P.dep, P.total);
  saveInputs();
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 200));
    const j = await r.json();
    const runs = await fetchMeta();
    finish(P, j, { fetched: Date.now(), runs });
  } catch (e) {
    STATE = { P, json: null };
    $("dlink").href = url;
    $("paste").style.display = "block";
    setMsg("Automatic download blocked (" + (e.message || e) + "). Use the two steps below.", "warn");
  }
}

/** Attaches the forecast to the route, saves it on the device and renders. */
function finish(P, json, meta) {
  try {
    const info = attachWx(P.samples, json, P.dep);
    STATE = { P, json, meta, info };
    store("optfl.data", { route: P.route, dep: P.dep.toISOString(), json, meta });
    setMsg("Winds loaded for " + P.samples.length + " points (" + info.models.join(" + ") + ")" +
      (info.age > 1.5 ? ". Closest forecast hour is " + info.age.toFixed(1) + " h from ETA: check departure time" : "") +
      ".", "ok");
    render(P);
  } catch (e) {
    setMsg(e.message, "err");
    console.error(e);
  }
}


/* ============================================================================
 * 14. RENDERING THE RESULTS
 * ========================================================================== */

/**
 * Reference TAS for the fuel-flow temperature correction: the route-average TAS
 * at the OPT level with the forecast temperatures. The average FF the user
 * enters is real (already at the real temperature), so only differences from
 * this reference change the fuel.
 */
function tasRefOf(S, c) {
  let t = 0, w = 0;
  for (const s of S) {
    const T = interpProf(s.prof, c.opt * 100).T;
    t += c.mach * SOUND_K * Math.sqrt(T + 273.15) * s.seg;
    w += s.seg;
  }
  return w ? t / w : c.mach * 573.57;
}

/**
 * Route-average ISA deviation (°C) at level fl from the forecast,
 * weighted by distance. Used to pick the warm-day REC MAX line.
 */
function isaDevOf(S, fl) {
  let t = 0, w = 0;
  for (const s of S) {
    t += (interpProf(s.prof, fl * 100).T - isaT(fl * 100)) * s.seg;
    w += s.seg;
  }
  return w ? t / w : 0;
}

/**
 * Local ISA deviation along the route at level fl, smoothed over ±75 NM
 * (forecast points are 50–100 NM apart). Sets c.devAt(cum), c.devMin/devMax
 * and c.coolCum (where it is coldest, i.e. where REC MAX is highest).
 */
function setLocalDev(S, c, fl) {
  const raw = S.map((s) => ({ cum: s.cum, dev: interpProf(s.prof, fl * 100).T - isaT(fl * 100) }));
  const pts = raw.map((p) => {
    const near = raw.filter((q) => Math.abs(q.cum - p.cum) <= 75);
    return { cum: p.cum, dev: near.reduce((a, q) => a + q.dev, 0) / near.length };
  });
  const xs = pts.map((p) => p.cum), ys = pts.map((p) => p.dev);
  c.devAt = (cum) => lerp1(xs, ys, cum);
  c.devMax = Math.max(...ys);
  c.devMin = Math.min(...ys);
  c.coolCum = xs[ys.indexOf(c.devMin)];
}

/** Computes everything and builds all the result cards. */
function render(P) {
  // --- Settings and route --------------------------------------------------------
  const c = cfg();
  const S = P.samples;
  c.total = P.total;
  useModel(S, c.model);
  // With an FCOM altitude table, OPT and REC MAX at TOW come from it (not from the form).
  const T = tablesFor(c);
  if (T && T.alt) {
    c.opt = Math.round(optAt(c.tow * 1000, c) / 10) * 10;
    // ISA deviation at the cool-day REC MAX level (where REC MAX is decided).
    const refFL = Math.min(390, lerp1(T.alt.weights, T.alt.recmax, c.tow));
    c.isaDev = isaDevOf(S, refFL);
    if (T.alt.recmaxT) setLocalDev(S, c, refFL);
    if (c.recsrc == "fms" && isFinite(c.recmax)) {
      c.recOff = c.recmax - recAt(c.tow * 1000, c);         // FMS value minus chart, at TOW
    } else {
      c.recmax = Math.floor(recAt(c.tow * 1000, c) / 10) * 10;
    }
  }
  c.tasRef = tasRefOf(S, c);
  // Temperatures for the climb and descent tables: ISA deviation at FL200 over the
  // first and last 150 NM of the route.
  c.clIsa = isaDevOf(S.filter((s) => s.cum <= 150), 200);
  c.desIsa = isaDevOf(S.filter((s) => s.cum >= c.total - 150), 200);
  // FCOM tables are book values for a new aircraft: apply the aircraft's
  // perf factor (FMS PERF FACTOR, or a fuel bias) to all fuel. The generic
  // model doesn't need it: its fuel flow comes from the OFP, already biased.
  if (tablesInUse(c).length && c.pfac) c.cal = 1 + c.pfac / 100;

  // Direction of flight -> odd or even levels.
  const first = P.pts[0], lastPt = P.pts[P.pts.length - 1];
  const overall = brg([first.lat, first.lon], [lastPt.lat, lastPt.lon]);
  const magTrk = (overall - c.magvar + 360) % 360;
  const par = c.parity == "auto" ? (magTrk < 180 ? "odd" : "even") : c.parity;
  const isDir = (f) => par == "all" || ((f / 10) % 2 == 1) == (par == "odd");

  // --- Every constant level ----------------------------------------------------------
  const all = [];
  for (let f = c.minfl; f <= c.recmax; f += 10) all.push(f);
  const res = all.map((f) => sim(S, c, constPath(f))).filter((r) => !r.bad);
  const shown = res.filter((r) => isDir(r.fl));      // right direction only
  if (!shown.length) {
    $("out").innerHTML = '<div class="card err">No level fits: route too short for these levels, or check Lowest FL / REC MAX.</div>';
    return;
  }

  // Best level = lowest cost (fuel + CI × time) among levels that respect the REC MAX margin.
  const key = (r) => r.cost;
  const minBy = (list, fn) => list.reduce((a, b) => fn(b) < fn(a) ? b : a);
  const okLv = shown.filter((r) => !r.over);
  const bestAny = minBy(shown, key);                       // ignoring the margin
  const bestF = okLv.length ? minBy(okLv, key) : bestAny;  // respecting the margin
  const bestT = minBy(shown, (r) => r.time);               // fastest

  let cruise = S.filter((s) => s.cum >= bestF.lo && s.cum <= bestF.hi);
  if (!cruise.length) cruise = [S[Math.floor(S.length / 2)]];

  // Reference row = the no-wind OPT (or the closest level to it).
  const ref = res.find((r) => r.fl == c.opt) || minBy(res, (r) => Math.abs(r.fl - c.opt));
  const tooHigh = all.filter((f) => isDir(f) && !res.find((r) => r.fl == f));

  // --- 4 wind levels -------------------------------------------------------------------
  const band = all.filter((f) => f >= Math.max(c.minfl, Math.min(bestF.fl, c.opt) - 60));
  const wts = {};
  res.forEach((r) => { wts[r.fl] = 1 / (1 + Math.max(0, key(r) - key(bestF)) / 150); });
  const pick = pickFmsLevels(cruise, band, wts, bestF.fl);

  // --- Text blocks ---------------------------------------------------------------------
  const agree = modelAgreementHtml(S, cruise, band, bestF);
  const age = forecastAgeHtml();
  const mineHtml = usualLevelsHtml(S, c, all, isDir, key, shown, bestF, cruise, band);

  // --- Step plan -----------------------------------------------------------------------
  // Allowed levels go up to REC MAX at landing weight (max FL390).
  const landingWeight = c.tow * 1000 - bestF.fuel;
  const topFL = Math.min(390, Math.floor(recAt(landingWeight, c, c.coolCum) / 10) * 10);
  const dirLv = [];
  for (let f = c.minfl; f <= Math.max(topFL, c.recmax); f += 10) if (isDir(f)) dirLv.push(f);
  const sp = stepPlan(S, c, bestF, dirLv);
  const stepHtml = stepPlanHtml(sp, c, bestF);

  // --- Recommended profile and OFP profile -------------------------------------------------
  const showPlan = sp && bestF.cdist >= 250 && sp.saving != null && sp.saving >= c.minstep &&
    sp.pick.some((L, k) => k && L != sp.pick[k - 1]);
  const recPath = showPlan ? pathFromPlan(sp, bestF) : constPath(bestF.fl);
  const recSim = showPlan ? sim(S, c, recPath) : bestF;

  const OFd = load("optfl.ofp");
  const ofpOK = !!(OFd && OFd.route == P.route);
  const ofpP = ofpOK ? pathFromOFP(OFd.levels, S) : null;
  const ofpS = ofpP ? sim(S, c, ofpP) : null;

  // --- Hazards and profile chart (isolated: a problem here never hides the rest) -----------
  let hzHtml = "", recM = null;
  try {
    const out = hazardsHtml(S, c, recPath, recSim, ofpP, ofpS, ofpOK ? OFd.sr || {} : {});
    hzHtml = out.html;
    recM = out.recM;
  } catch (e) {
    console.error(e);
    hzHtml = `<div class="card err">Profile/hazards could not be drawn: ${e.message}</div>`;
  }

  const cmpHtml = ofpCompareHtml(c, OFd, ofpS, recSim, recPath, S, ofpP);
  const cdHtml = climbDescentHtml(S, c, bestF, recSim, recPath);
  const levelsCard = levelsCardHtml(c, pick, cruise, band, bestF, bestT, shown, key, mineHtml);
  const resultHtml = resultCardHtml(P, c, res, ref, bestF, bestT, bestAny, key, isDir, par, magTrk, tooHigh, agree, age);

  // --- Put it all on the page ------------------------------------------------------------
  $("out").innerHTML = `
${resultHtml}
${cmpHtml}
${levelsCard}
${stepHtml}
<div id="logcard"></div>
${hzHtml}
${cdHtml}
<div class="card"><h2>Wind profile (cruise average)</h2>${profileSvg(cruise, pick.lv, c.mine)}</div>`;

  STATE.last = { c, bestF, pick: pick.lv, S, P, recPath, ofpP, ofd: ofpOK ? OFd : null };
  renderLog();

  // "Use X ft" button in the hazards card.
  const useBtn = $("userec");
  if (useBtn && recM) {
    useBtn.onclick = () => { $("recm").value = recM; saveInputs(); rerender(); };
  }
}

/** GFS vs ECMWF wind difference at the best level (warns above 20 kt). */
function modelAgreementHtml(S, cruise, band, bestF) {
  if (!(S[0].pm.GFS && S[0].pm.ECMWF)) return "";
  let sum = 0, worst = 0, n = 0;
  for (const s of cruise) {
    for (const f of band) {
      const a = interpProf(s.pm.GFS, f * 100), b = interpProf(s.pm.ECMWF, f * 100);
      const e = Math.hypot(a.u - b.u, a.v - b.v);
      if (f == bestF.fl) { sum += e; n++; }
      worst = Math.max(worst, e);
    }
  }
  const avg = n ? sum / n : 0;
  return `<p class="${avg > 20 ? "warn" : "note"}" style="font-size:12px">GFS vs ECMWF at FL${bestF.fl}: ${Math.round(avg)} kt average difference (max ${Math.round(worst)} kt in band)${avg > 20 ? ". The models disagree: treat the result with caution and compare with the OFP winds." : "."}</p>`;
}

/** When the forecast was downloaded and which model runs it came from. */
function forecastAgeHtml() {
  const M = (STATE && STATE.meta) || {};
  if (!M.fetched) return "";
  const hrs = (Date.now() - M.fetched) / 3600e3;
  const runs = Object.entries(M.runs || {})
    .map(([name, t]) => `${name} ${new Date(t).toISOString().slice(11, 13)}Z run`).join(", ");
  return `<p class="${hrs > 6 ? "warn" : "note"}" style="font-size:12px">Forecast downloaded ${hrs < 1 ? Math.round(hrs * 60) + " min" : hrs.toFixed(1) + " h"} ago${runs ? " · " + runs : ""}${hrs > 6 ? ". Download again for fresher winds." : "."}</p>`;
}

/** What the FMS would choose with the user's usual 4 wind levels. */
function usualLevelsHtml(S, c, all, isDir, key, shown, bestF, cruise, band) {
  if (c.mine.length < 2) return "";
  const lv = c.mine.slice().sort((a, b) => a - b);
  const src = (s) => fmsProf(s.prof, lv);                     // the winds the FMS would have
  const perceived = all.filter(isDir).map((f) => sim(S, c, constPath(f), { src })).filter((r) => !r.bad);
  if (!perceived.length) return "";

  const fmsBest = perceived.reduce((a, b) => key(b) < key(a) ? b : a);
  const trueAt = shown.find((r) => r.fl == fmsBest.fl) || bestF;
  return `<p style="font-size:13px">With winds ${c.mode == "datalink" ? "uplinked" : "entered"} only at <b>${lv.map((f) => "FL" + f).join(" ")}</b>, the FMS sees a best of <b>FL${fmsBest.fl}</b>. Errors reach ${profErr(cruise, band, lv).toFixed(0)} kt in your band.${fmsBest.fl != bestF.fl ? ` With the real profile the best is <b>FL${bestF.fl}</b>. Flying FL${fmsBest.fl} means ${kgs(trueAt.fuel - bestF.fuel)} kg and ${sgn((trueAt.time - bestF.time) * 60)} min.` : " Same answer as the real profile."}</p>`;
}

/** Step plan card. */
function stepPlanHtml(sp, c, bestF) {
  if (!(sp && bestF.cdist >= 250)) return "";
  const changes = [];
  sp.pick.forEach((L, k) => { if (k == 0 || L != sp.pick[k - 1]) changes.push({ k, L }); });
  const worth = sp.saving != null && sp.saving >= c.minstep && changes.length > 1;

  const body = worth
    ? `<div class="scroll"><table><tr><th>WHERE</th><th>LEVEL</th><th>UNTIL</th></tr>
${changes.map((q, i) => {
    const next = changes[i + 1];
    return `<tr class="${i > 0 ? "best" : ""}"><td>${i == 0 ? "Initial" : "At " + sp.segs[q.k].name}</td><td>FL${q.L}</td><td>${next ? sp.segs[next.k].name : "T/D"}</td></tr>`;
  }).join("")}</table></div>
<p style="font-size:13px">Saves ≈<b>${kg(sp.saving)} kg</b>${c.ci ? " (cost units)" : ""} against FL${bestF.fl} all the way, after ${tablesFor(c) && tablesFor(c).climb && tablesFor(c).cruise && tablesFor(c).cruise.sets ? `the FCOM step-climb cost (≈${kg(stepFuelKg(c, bestF.fl, bestF.fl + 20, c.tow * 1000 - 3000) / 2)} kg per 1000 ft here)` : `${c.stepc} kg per 1000 ft of step climb`}.</p>`
    : `<p style="font-size:13px">No step worth requesting: <b>FL${bestF.fl}</b> all the way${changes.length > 1 && sp.saving != null && sp.saving > 0 ? ` (best step plan saves only ${kg(sp.saving)} kg)` : ""}.</p>`;

  return `<div class="card"><h2>Step plan</h2>${body}
<p class="note">Steps can only happen at route fixes. OPT and REC MAX rise as fuel burns (constant weight/pressure ratio). The minimum saving is in More settings.</p></div>`;
}

/** Vertical profile chart + route hazards table + recommended REC MAX margin. */
function hazardsHtml(S, c, recPath, recSim, ofpP, ofpS, sr) {
  const HZ = recSim.bad ? [] : hazards(S, c, recPath, recSim.lo, recSim.hi, recSim.wts);

  // The margin only matters where the profile is close to REC MAX (within 4500 ft).
  const near = HZ.filter((h) => h.room < 4500);
  const recM = near.length ? Math.max(...near.map((h) => h.marg)) : 1000;
  const worst = HZ.length ? HZ.reduce((a, b) => b.lv > a.lv || (b.lv == a.lv && b.vws > a.vws) ? b : a) : null;
  const worstNear = near.length ? near.reduce((a, b) => b.marg > a.marg ? b : a) : null;
  const hasSR = Object.keys(sr).length > 0;

  const rows = HZ.filter((h) => h.s.user && h.s.name).map((h) => `<tr>
<td>${h.s.name}</td><td>FL${h.fl}</td><td>${windStr(h.W)}</td>
<td style="color:${h.vws >= 5 ? RCOL[2] : h.vws >= 3 ? RCOL[1] : "inherit"}">${h.vws.toFixed(1)}</td>
${hasSR ? `<td>${sr[h.s.name] ?? "—"}</td>` : ""}
<td>${Math.round(h.hws)}</td><td>${h.dT.toFixed(1)}</td>
<td style="color:${h.spd ? RCOL[2] : "inherit"}">${Math.abs(h.dWa) < 1 ? "0" : (h.dWa > 0 ? "↓" : "↑") + Math.round(Math.abs(h.dWa))}</td>
<td style="color:${RCOL[h.lv]}">${RISK[h.lv]}</td>
<td style="color:${h.room < h.marg ? "var(--rd)" : "inherit"}">${Math.round(h.room / 100) * 100}</td>
<td>${h.marg}</td></tr>`).join("");

  const summary = worstNear && worstNear.marg > 1000
    ? `Margin set by <b>${worstNear.s.name || Math.round(worstNear.s.cum) + " NM"}</b> (FL${worstNear.fl}, ${Math.round(worstNear.room)} ft below REC MAX): ${worstNear.why.join(", ")}.`
    : near.length ? "No significant signals where you're close to REC MAX."
      : "The profile stays more than 4500 ft below REC MAX, so the minimum margin is enough.";
  const worstTxt = worst && worst.lv && worst !== worstNear
    ? ` Highest risk on the route: <b>${worst.s.name || Math.round(worst.s.cum) + " NM"}</b>, ${RISK[worst.lv].toLowerCase()} (${worst.why.join(", ")}), where you're ${Math.round(worst.room)} ft below REC MAX.`
    : "";

  const html = `<div class="card"><h2>Vertical profile</h2>${recSim.bad ? "" : profileChart(S, c, recSim, recPath, HZ, ofpP, ofpS)}</div>
<div class="card"><h2>Route hazards &amp; REC MAX margin</h2>
<div class="row" style="justify-content:space-between">
  <div><div class="note">Recommended margin</div><div class="big" style="color:${RCOL[RMARG.indexOf(Math.min(recM, 4000))] || "var(--acc)"}">${recM} ft</div></div>
  <div><div class="note">Your margin</div><div class="big" style="color:var(--cy)">${c.recm} ft</div></div>
  ${recM != c.recm ? `<button class="sec" id="userec">Use ${recM} ft</button>` : ""}
</div>
<p style="font-size:13px">${summary}
${worstTxt}</p>
<div class="scroll"><table><tr><th>WPT</th><th>FL</th><th>WIND</th><th>VWS</th>${hasSR ? "<th>OFP SR</th>" : ""}<th>HWS</th><th>ΔT</th><th>SPD</th><th>RISK</th><th>ROOM</th><th>MARG</th></tr>${rows || `<tr><td colspan="9">No fixes in the cruise portion.</td></tr>`}</table></div>
<p class="note">At the recommended level. VWS = vertical wind shear, kt per 1000 ft (±2000 ft). HWS = horizontal shear along the route, kt per 150 NM. ΔT = temperature change, °C per 100 NM. SPD = along-track wind change per 50 NM: ↓ means tailwind increasing / headwind dropping, so speed decays; ↑ means headwind increasing, so speed rises towards MMO (margin ≈${HZ.length ? Math.round(HZ[0].mmoKt) : "?"} kt at M${c.mach}). Risk thresholds: FAA AC 00-30C (moderate CAT likely with VWS ≥ 5 kt/1000 ft, HWS ≥ 40 kt/150 NM, jet ≥ 110 kt) and WMO (VWS ≥ 9 kt/1000 ft moderate-to-severe; ΔT ≥ 5 °C/100 NM). ROOM = ft below REC MAX for the weight there (red if less than the suggested margin). The recommended margin only counts points within 4500 ft of REC MAX, where it can bind. Margin: 1000 ft with no signal, 2000 light, 3000 moderate, 4000 moderate-to-severe, +1000 ft for large speed changes. This is a rule of thumb from model data with levels 3000–5000 ft apart. It doesn't see mountain waves or convection: use it alongside SIGWX charts, PIREPs and company policy.</p></div>`;

  return { html, recM };
}

/** OFP profile vs optimizer profile, both through the same model and winds. */
function ofpCompareHtml(c, OFd, ofpS, recSim, recPath, S, ofpP) {
  if (!(ofpS && !ofpS.bad && !recSim.bad)) return "";
  const dF = ofpS.fuel - recSim.fuel;            // positive = optimizer saves fuel
  const dT = (ofpS.time - recSim.time) * 60;     // positive = optimizer is faster (min)
  const dC = ofpS.cost - recSim.cost;
  const tripTime = OFd.tripTime ? (+OFd.tripTime.slice(0, 2) + +OFd.tripTime.slice(2) / 60) : null;
  const bias = OFd.trip ? ofpS.fuel / OFd.trip - 1 : null;

  // Closest the OFP profile gets to REC MAX in cruise (ft) and where. The optimizer
  // must stay outside the REC MAX margin; the OFP is not held to it.
  let room = Infinity, roomAt = "";
  if (ofpP) {
    ofpS.wts.forEach((q) => {
      if (q.cum <= ofpS.lo || q.cum >= ofpS.hi) return;
      const r = (recAt(q.w, c, q.cum) - ofpP.at(q.cum)) * 100;
      if (r < room) { room = r; roomAt = (S.filter((s) => s.user && s.name && s.cum <= q.cum).pop() || {}).name || ""; }
    });
  }
  const marginNote = room < c.recm
    ? `<p style="font-size:13px;color:var(--am)">The OFP profile ${room <= 0 ? `goes <b>${Math.ceil(-room / 100) * 100} ft above REC MAX</b>` : `comes within <b>${Math.floor(room / 100) * 100} ft of REC MAX</b>`}${roomAt ? ` (after ${roomAt})` : ""}, inside your ${c.recm} ft margin. The optimizer isn't allowed that close, so part of any difference is the price of your margin. ${room > 0 ? `Set the margin to ${Math.floor(room / 100) * 100} ft to compare on equal terms.` : "The app's REC MAX for that weight and temperature is below the OFP level there."}</p>`
    : "";

  const row = (name, levelsText, r) => `<tr><td>${name}</td><td style="text-align:left;white-space:normal">${levelsText}</td><td>${kg(r.fuel)}</td><td>${hm(r.time)}</td>${c.ci ? `<td>${kg(r.cost)}</td>` : ""}</tr>`;
  const big = (label, good, text) => `<div><div class="note">${label}</div><div class="big" style="color:${good ? "var(--acc)" : "var(--rd)"}">${text}</div></div>`;

  let sentence;
  if (Math.abs(dF) < 30 && Math.abs(dT) < 1) {
    sentence = "The optimizer profile is practically the same as the OFP.";
  } else if (dF >= 0) {
    sentence = `Flying the optimizer profile instead of the OFP saves ≈<b>${kg(dF)} kg</b>${dT >= 0.5 ? ` and ${Math.round(dT)} min` : dT <= -0.5 ? ` but takes ${Math.round(-dT)} min longer` : ""}.`;
  } else {
    sentence = `The OFP profile is ≈<b>${kg(-dF)} kg</b> better than the optimizer with these winds${c.ci && dC < 0 ? " (the optimizer wins on time cost)" : ""}.`;
  }

  return `<div class="card"><h2>OFP vs optimizer</h2>
<div class="row" style="justify-content:space-between">
  ${big("Fuel", dF >= 0, (dF >= 0 ? "−" : "+") + kg(Math.abs(dF)) + " kg")}
  ${big("Time", dT >= 0, Math.abs(dT) < 0.5 ? "same" : (dT > 0 ? "−" : "+") + Math.round(Math.abs(dT)) + " min")}
  ${c.ci ? big("Cost (CI " + c.ci + ")", dC >= 0, (dC >= 0 ? "−" : "+") + kg(Math.abs(dC))) : ""}
</div>
<p style="font-size:13px">${sentence}</p>${marginNote}
<div class="scroll"><table><tr><th>PROFILE</th><th style="text-align:left">LEVELS</th><th>TRIP kg</th><th>TIME</th>${c.ci ? "<th>COST</th>" : ""}</tr>
${row("OFP", OFd.levelsTxt || "", ofpS)}${row("Optimizer", profTxt(recPath, recSim, S), recSim)}</table></div>
<p class="note">Both profiles are flown through the same model and the same forecast winds, so the difference is like for like.${OFd.trip ? ` For reference, the OFP's own figures are ${kg(OFd.trip)} kg${tripTime ? " and " + hm(tripTime) : ""}; the tool estimates the OFP profile at ${kg(ofpS.fuel)} kg (${sgn(bias * 100, 1)}%), so read absolute kg with that offset.` : ""}</p></div>`;
}

/** Climb and descent winds for the FMS CLB/DES WIND pages. */
function climbDescentHtml(S, c, bestF, recSim, recPath) {
  const td = tdInfo(S, c, recSim, recPath);
  const levels = [50, 100, 180, 250, bestF.fl];
  const climbEnd = bestF.cl.d + bestF.wc * bestF.cl.t;            // NM from departure
  const descStart = c.total - (bestF.de.d + bestF.wd * bestF.de.t);
  const cells = (s0, s1) => levels.map((f) => {
    const w = vecAvg(S, s0, s1, f * 100);
    return w ? `<td>${windStr(w)}</td>` : "<td>—</td>";
  }).join("");

  return `<div class="card"><h2>Climb &amp; descent winds</h2><div class="scroll"><table>
<tr><th></th>${levels.map((f) => `<th>FL${String(f).padStart(3, "0")}</th>`).join("")}</tr>
<tr><td>CLB</td>${cells(0, Math.max(climbEnd, 60))}</tr>
<tr><td>DES</td>${cells(Math.min(descStart, c.total - 60), c.total)}</tr></table></div>
<p class="note">For the FMS CLB/DES WIND pages, averaged over the climb (first ${Math.round(climbEnd)} NM) and descent (last ${Math.round(c.total - descStart)} NM). Average climb wind ${sgn(bestF.wc)} kt, descent ${sgn(bestF.wd)} kt along track, already included in the trip figures.</p>
${td ? `<h2 style="margin-top:12px">Estimated top of descent</h2>
<p style="font-size:15px"><b>${Math.round(td.toGo)} NM</b> to touchdown · ${tdWhere(td)}</p>
<p class="note">From FL${td.fl} on the recommended profile, to ${Math.max(0, c.delev || 0)} ft + 1500 ft${c.delev ? "" : " (destination elevation 0: set it in More settings, or load the OFP)"}, then the approach. Still air ${Math.round(td.desc.d)} NM, ${Math.round(td.desc.t * 60)} min, ${kg(td.desc.f * c.cal)} kg; descent wind ${sgn(td.wind)} kt along track. 3-to-1 check: ${Math.round(td.rule3)} NM (plus about 10 NM to slow down). The flight log shows the T/D time and fuel. ATC, the STAR and speed restrictions move the real T/D: use the FMS T/D for the descent.</p>` : ""}</div>`;
}

/**
 * Climb from brake release to fl, with the part below FL50 (where the tables
 * start) taken as a straight line from the runway.
 */
function climbPart(fl, c) {
  if (fl >= 50) return climbOf(fl, c);
  const r = climbOf(50, c), q = Math.max(0, fl) / 50;
  return { d: r.d * q, t: r.t * q, f: r.f * q };
}

/**
 * Inverse of a climb/descent function: the level whose distance is `dist`
 * (bisection between 0 and maxFL). Returns that level's { d, t, f }.
 */
function phaseAt(fn, dist, maxFL) {
  let a = 0, b = maxFL;
  // Shorter than the bottom of the table (e.g. the last miles of the approach): pro rata.
  const z = fn(0);
  if (dist <= z.d) return { d: dist, t: z.d ? z.t * dist / z.d : 0, f: z.d ? z.f * dist / z.d : 0 };
  if (dist >= fn(b).d) return fn(b);
  for (let i = 0; i < 25; i++) {
    const m = (a + b) / 2;
    if (fn(m).d < dist) a = m; else b = m;
  }
  return fn((a + b) / 2);
}

/**
 * Estimated top of descent for a simulated profile r (from sim) flown on path:
 *   toGo   ground distance from T/D to the destination (descent table to
 *          elevation + 1500 ft, the approach, and the forecast descent wind)
 *   cum    NM from departure; prev/next = route fixes around it
 *   t, f   time (h) and fuel burnt (kg) from takeoff to T/D
 *   rule3  the 3-NM-per-1000-ft check from the cruise level down to the airport
 */
function tdInfo(S, c, r, path) {
  if (!r || r.bad) return null;
  const fl = path.at(Math.max(0, r.hi - 1));
  const fixes = S.filter((s) => s.user && s.name && !s.apt);
  const prev = fixes.filter((s) => s.cum <= r.hi).pop();
  const next = fixes.find((s) => s.cum > r.hi);
  return {
    fl, cum: r.hi, toGo: c.total - r.hi,
    prev: prev ? { name: prev.name, nm: r.hi - prev.cum } : null,
    next: next ? { name: next.name, nm: next.cum - r.hi } : null,
    t: r.time - r.de.t, f: r.fuel - r.de.f * c.cal,
    wind: r.wd, desc: r.de,
    rule3: 3 * (fl * 100 - Math.max(0, c.delev || 0)) / 1000,
  };
}

/** Text for the T/D position: "38 NM after MER (12 NM before ANKAS)". */
function tdWhere(td) {
  const a = td.prev ? `${Math.round(td.prev.nm)} NM after ${td.prev.name}` : "";
  const b = td.next ? `${Math.round(td.next.nm)} NM before ${td.next.name}` : "";
  return a && b ? `${a} (${b})` : a || b;
}

/** Card 3: the 4 wind levels (manual entry table or datalink request). */
function levelsCardHtml(c, pick, cruise, band, bestF, bestT, shown, key, mineHtml) {
  const lv = pick.lv;

  if (c.mode == "datalink") {
    const top = shown.slice().sort((a, b) => key(a) - key(b)).slice(0, 4);
    return `<div class="card"><h2>3 · Request wind uplink at</h2>
<div>${lv.map((f) => `<span class="pill" style="font-size:20px;padding:6px 14px">FL${f}</span>`).join("")}</div>
<p style="font-size:13px">With winds at these 4 levels at every waypoint, the FMS matches the forecast profile within ≈${profErr(cruise, band, lv).toFixed(0)} kt from FL${band[0]} to FL${band[band.length - 1]}. The set brackets the best level (FL${bestF.fl}), so the OPT the FMS computes after the uplink can be trusted.</p>
${mineHtml || `<p class="note">Type the 4 levels you usually request above to see what they would do to the FMS OPT.</p>`}</div>
<div class="card"><details><summary style="font-size:14px;color:var(--am);font-weight:700">ALSO: FL TO REQUEST FROM ATC</summary>
<div class="scroll"><table><tr><th>#</th><th>FL</th><th>FUEL</th><th>TIME</th><th>WIND</th></tr>
${top.map((a, i) => `<tr class="${i == 0 ? "best" : ""}"><td>${i + 1}</td><td>FL${a.fl}</td><td>${i == 0 ? "best" : (a.fuel >= bestF.fuel ? "+" : "−") + kg(Math.abs(a.fuel - bestF.fuel)) + " kg"}</td><td>${i == 0 ? hm(a.time) : sgn((a.time - bestF.time) * 60) + " min"}</td><td>${sgn(a.tw)} kt</td></tr>`).join("")}</table></div>
${bestT.fl != bestF.fl ? `<p style="font-size:13px">If you're late, <b>FL${bestT.fl}</b> is fastest: ${Math.round((bestF.time - bestT.time) * 60)} min saved for ${kgs(bestT.fuel - bestF.fuel)} kg.</p>` : ""}</details></div>`;
  }

  // Manual entry: winds at each cruise fix, or route averages if there are no fixes.
  const wps = cruise.filter((s) => s.user && !s.apt && s.name);
  let rows;
  if (wps.length) {
    rows = wps.map((s) => `<tr><td>${s.name}</td>${lv.map((f) => `<td>${windStr(interpProf(s.prof, f * 100))}</td>`).join("")}</tr>`).join("");
  } else {
    const avg = lv.map((f) => vecAvg(cruise, 0, 1e9, f * 100));
    rows = `<tr><td>Route avg</td>${avg.map((x) => `<td>${windStr(x)}</td>`).join("")}</tr>`;
  }
  return `<div class="card"><h2>3 · Enter these winds in the FMS</h2><div>${lv.map((f) => `<span class="pill">FL${f}</span>`).join("")}</div>
<p class="note">These 4 levels let the FMS's interpolation match the forecast profile from FL${band[0]} to FL${band[band.length - 1]} within ≈${pick.e.toFixed(0)} kt.</p>
<div class="scroll"><table><tr><th>WPT</th>${lv.map((f) => `<th>FL${f}</th>`).join("")}</tr>${rows}</table></div>
${wps.length ? "" : `<p class="note">No en-route fixes in the cruise portion: enter these averages at your first cruise waypoint and let them propagate.</p>`}${mineHtml}</div>`;
}

/** Card 2: best level, fastest level, saving vs OPT, and the table of all levels. */
function resultCardHtml(P, c, res, ref, bestF, bestT, bestAny, key, isDir, par, magTrk, tooHigh, agree, age) {
  const save = ref.fuel - bestF.fuel;
  const tsave = (ref.time - bestF.time) * 60;
  const modelName = c.model == "AVG"
    ? (STATE.info && STATE.info.models.length > 1 ? "GFS+ECMWF average" : (STATE.info ? STATE.info.models.join("") : ""))
    : c.model;

  // One table row per level, highest first.
  const rows = res.slice().reverse().map((r) => {
    const d = key(r) - key(bestF);
    const isRef = r === ref;
    // HAVE = wind gain vs OPT; NEED = gain required to burn the same trip fuel as OPT.
    const have = r.tw - ref.tw;
    const fuelLeftForCruise = ref.fuel - r.xf;
    const need = fuelLeftForCruise > 0 ? r.tw + (r.cfuel * r.cgs / fuelLeftForCruise - r.cgs) - ref.tw : NaN;
    return `<tr class="${r === bestF ? "best" : ""} ${r.fl == c.opt ? "opt" : ""} ${isDir(r.fl) ? "" : "dim"}"><td>FL${r.fl}${r.over ? "*" : ""}</td>
<td style="color:${r.tw >= 0 ? "var(--acc)" : "var(--rd)"}">${sgn(r.tw)}</td><td>${isRef ? "ref" : sgn(have)}</td><td style="color:${isRef ? "inherit" : have >= need ? "var(--acc)" : "var(--mut)"}">${isRef ? "—" : isFinite(need) ? sgn(need) : "n/a"}</td>
${c.ci ? "" : `<td>${sgn(r.isa)}</td>`}<td>${Math.round(r.cgs)}</td><td>${hm(r.time)}</td><td>${kg(r.fuel)}</td>${c.ci ? `<td>${kg(r.cost)}</td>` : ""}<td>${r === bestF ? "best" : d < 0 ? "−" + kg(-d) : "+" + kg(d)}</td></tr>`;
  }).join("");

  return `<div class="card"><h2>2 · Result</h2>
<div class="row" style="justify-content:space-between">
  <div><div class="note">Best level${c.ci ? " (CI " + c.ci + ")" : " (fuel)"}</div><div class="big">FL${bestF.fl}</div></div>
  <div><div class="note">Fastest</div><div class="big" style="color:var(--cy)">FL${bestT.fl}</div></div>
  <div><div class="note">vs FL${ref.fl} (no-wind OPT)</div><div class="big" style="color:${save > 0 ? "var(--acc)" : "var(--mut)"}">${save > 0.5 ? "−" + kg(save) + " kg" : "—"}</div><div class="note">${Math.abs(tsave) < 0.5 ? "same time" : (tsave > 0 ? Math.round(tsave) + " min faster" : Math.round(-tsave) + " min slower")}</div></div>
</div>
<p class="note">Trip ${kg(P.total)} NM · cruise at FL${bestF.fl} ≈${kg(bestF.cdist)} NM · ${modelName} · best from <b>${par}</b> levels (mag track ${String(Math.round(magTrk)).padStart(3, "0")}°). Grey rows are the other direction${tooHigh.length ? " · too short for " + tooHigh.map((f) => "FL" + f).join(", ") : ""}${c.cal != 1 ? ` · perf factor ${sgn(c.pfac, 1)}%` : ""} · performance: ${tablesInUse(c).length ? "<b>FCOM tables</b> (" + tablesInUse(c).join(", ") + ")" + (tablesFor(c).alt ? `, OPT FL${c.opt} / REC MAX FL${Math.round(c.recmax)} at TOW${tablesFor(c).alt.recmaxT && !c.recOff ? ` (ISA${sgn(c.isaDev)} route average; along the route REC MAX uses the local temperature, ISA${sgn(c.devMin)} to ISA${sgn(c.devMax)})` : ""}${c.recOff ? ` (your FMS value, chart ${c.recOff > 0 ? "+" : "−"}${Math.abs(c.recOff).toFixed(0)} FL)` : ""}` : "") : c.perf == "tables" ? "<b>generic model</b> (no FCOM tables loaded for this aircraft type)" : "generic model"}</p>
${bestAny !== bestF ? `<p class="note" style="font-size:12px">The REC MAX margin keeps you off FL${bestAny.fl} as a constant level: it costs ≈${kg(bestF.fuel - bestAny.fuel)} kg${c.ci ? " (fuel)" : ""}. The step plan below shows when the margin allows a higher level.</p>` : ""}${agree}${age}
<div class="scroll"><table><tr><th>FL</th><th>WIND</th><th>HAVE</th><th>NEED</th>${c.ci ? "" : "<th>ISA</th>"}<th>GS</th><th>TIME</th><th>TRIP kg</th>${c.ci ? "<th>COST</th>" : ""}<th>Δ</th></tr>
${rows}
</table></div>
<div class="note">WIND = average tail(+)/head(−) over the cruise. HAVE = wind gain vs your OPT; NEED = gain required to pay for leaving OPT (green when HAVE ≥ NEED). TRIP = climb + cruise + descent, with weight-based OPT.${c.ci ? " COST = fuel + CI × minutes (kg)." : ""} * = inside the ${kg(c.recm)} ft REC MAX margin somewhere in the cruise (not eligible as a constant level).</div>
</div>`;
}


/* ============================================================================
 * 15. CHARTS (SVG)
 * ========================================================================== */

/** Cruise-average tail/head wind by level: forecast, what the FMS sees with the 4 levels, and with the user's levels. */
function profileSvg(cruise, lv, mine) {
  const fls = [];
  for (let f = 200; f <= 410; f += 10) fls.push(f);
  const wsum = cruise.reduce((acc, s) => acc + s.seg, 0) || 1;

  // Average along-track wind at each level, for a given profile source.
  const comp = (src) => fls.map((fl) => {
    let t = 0;
    for (const s of cruise) t += along(interpProf(src(s), fl * 100), s.trk) * s.seg;
    return t / wsum;
  });
  const real = comp((s) => s.prof);
  const fms = comp((s) => fmsProf(s.prof, lv));
  const mn = mine.length >= 2 ? comp((s) => fmsProf(s.prof, mine.slice().sort((a, b) => a - b))) : null;

  // Scales.
  const vals = real.concat(fms, mn || []);
  const lo = Math.min(0, ...vals) - 5, hi = Math.max(0, ...vals) + 5;
  const W = 340, H = 260;
  const x = (v) => 30 + (v - lo) / (hi - lo) * (W - 40);
  const y = (f) => H - 20 - (f - 200) / 210 * (H - 30);
  const path = (arr) => arr.map((v, i) => (i ? "L" : "M") + x(v).toFixed(1) + "," + y(fls[i]).toFixed(1)).join("");

  // Grid and axes.
  let g = "";
  for (let f = 200; f <= 400; f += 40) {
    g += `<line x1="30" x2="${W - 10}" y1="${y(f)}" y2="${y(f)}" stroke="#30363d"/><text x="2" y="${y(f) + 4}" fill="#8b949e" font-size="10">${f}</text>`;
  }
  g += `<line x1="${x(0)}" x2="${x(0)}" y1="10" y2="${H - 20}" stroke="#8b949e" stroke-dasharray="3 3"/>` +
       `<text x="${x(lo)}" y="${H - 5}" fill="#8b949e" font-size="10">${Math.round(lo)} kt</text>` +
       `<text x="${x(hi) - 30}" y="${H - 5}" fill="#8b949e" font-size="10">+${Math.round(hi)} kt</text>`;

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:520px">${g}
<path d="${path(real)}" fill="none" stroke="#3fb950" stroke-width="2.5"/>
<path d="${path(fms)}" fill="none" stroke="#39c5cf" stroke-width="1.5" stroke-dasharray="5 3"/>
${mn ? `<path d="${path(mn)}" fill="none" stroke="#f85149" stroke-width="1.5" stroke-dasharray="2 3"/>` : ""}</svg>
<div class="note"><span style="color:#3fb950">━</span> forecast tail(+)/head(−) wind · <span style="color:#39c5cf">╌</span> what FMS sees with recommended levels${mn ? ` · <span style="color:#f85149">┈</span> with your levels` : ""}</div>`;
}

/**
 * Vertical profile chart: recommended profile, OFP profile, REC MAX (and minus margin),
 * OPT along the flight, and turbulence-risk dots. Zoomed on the cruise levels.
 */
function profileChart(S, c, rec, recPath, hz, ofpPath, ofpSim) {
  const W = 700, H = 300, L = 40, R = 10, T = 12, B = 60;   // size and margins
  const total = c.total;

  // Vertical range: 40 below the lowest cruise level / OPT to just above the highest REC MAX.
  const cr = S.filter((s) => s.cum > rec.lo && s.cum < rec.hi);
  const lvs = cr.map((s) => recPath.at(s.cum)).concat(ofpPath ? cr.map((s) => ofpPath.at(s.cum)) : []);
  const wl = rec.wts.filter((q) => q.cum >= rec.lo && q.cum <= rec.hi);
  const fmin = Math.floor((Math.min(...lvs, ...wl.map((q) => optAt(q.w, c))) - 40) / 20) * 20;
  const fmax = Math.ceil((Math.max(...wl.map((q) => recAt(q.w, c, q.cum))) + 10) / 20) * 20;

  const x = (d) => L + d / total * (W - L - R);
  const y = (f) => T + (1 - (f - fmin) / (fmax - fmin)) * (H - T - B);

  // Grid (outside the clip) and plot content (clipped to the plot area).
  let g = `<defs><clipPath id="pc"><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></clipPath></defs>`;
  for (let f = fmin; f <= fmax; f += 20) {
    g += `<line x1="${L}" x2="${W - R}" y1="${y(f)}" y2="${y(f)}" stroke="#30363d"/><text x="2" y="${y(f) + 4}" fill="#8b949e" font-size="11">FL${f}</text>`;
  }
  let plot = "";

  // A profile drawn as: climb, cruise with steps, descent.
  const profileLine = (simRes, path, color, dash, width) => {
    const pts = [[0, 15], [simRes.lo, path.L0]];
    let prev = path.L0;
    for (const s of S) {
      if (s.cum <= simRes.lo || s.cum >= simRes.hi) continue;
      const f = path.at(s.cum);
      if (f != prev) { pts.push([s.cum, prev], [s.cum + 8, f]); prev = f; }
    }
    pts.push([simRes.hi, prev], [total, 15]);
    const d = pts.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(1) + "," + y(p[1]).toFixed(1)).join("");
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`;
  };

  // A level that depends on the simulated weight (REC MAX, OPT).
  const weightLine = (fn, color, dash) => {
    const d = wl.map((q, i) => (i ? "L" : "M") + x(q.cum).toFixed(1) + "," + y(fn(q.w, q.cum)).toFixed(1)).join("");
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.3" ${dash ? `stroke-dasharray="${dash}"` : ""}/>`;
  };

  plot += weightLine((w, cum) => recAt(w, c, cum), "#f85149", "");
  plot += weightLine((w, cum) => recAt(w, c, cum) - c.recm / 100, "#f85149", "4 3");
  plot += weightLine((w) => optAt(w, c), "#d2a8ff", "2 3");
  if (ofpPath && ofpSim && !ofpSim.bad) plot += profileLine(ofpSim, ofpPath, "#8b949e", "6 4", 1.5);
  plot += profileLine(rec, recPath, "#39c5cf", "", 3);
  for (const h of hz) {
    plot += `<circle cx="${x(h.s.cum).toFixed(1)}" cy="${y(h.fl).toFixed(1)}" r="${h.lv ? 4.5 : 3}" fill="${RCOL[h.lv]}"/>`;
  }
  g += `<g clip-path="url(#pc)">${plot}</g>`;

  // Fix names along the bottom.
  S.filter((s) => s.user && s.name).forEach((s) => {
    g += `<line x1="${x(s.cum)}" x2="${x(s.cum)}" y1="${H - B}" y2="${H - B + 4}" stroke="#8b949e"/>` +
         `<text transform="translate(${x(s.cum) + 3},${H - B + 8}) rotate(60)" fill="#8b949e" font-size="9.5">${s.name}</text>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" width="100%">${g}</svg>
<div class="note"><span style="color:#39c5cf">━</span> recommended profile${ofpPath ? ` · <span style="color:#8b949e">╌</span> OFP` : ""} · <span style="color:#f85149">━</span> REC MAX · <span style="color:#f85149">╌</span> REC MAX − margin · <span style="color:#d2a8ff">┈</span> OPT (no wind) · dots: turbulence risk ${RISK.map((r, i) => `<span style="color:${RCOL[i]}">●</span> ${r}`).join(" ")}</div>`;
}


/* ============================================================================
 * 16. HAZARDS ALONG THE ROUTE
 *    Thresholds: FAA AC 00-30C (moderate CAT likely with vertical shear
 *    >= 5 kt/1000 ft, horizontal >= 40 kt/150 NM, jet core >= 110 kt) and WMO
 *    (vertical shear >= 9 kt/1000 ft moderate-to-severe; temperature gradient
 *    >= 5 °C/100 NM). The margin mapping is a rule of thumb, not a standard.
 * ========================================================================== */

const MMO = 0.82;                                             // A320 family max operating Mach
const RISK = ["None", "Light", "Moderate", "Mod–Sev"];        // risk level names
const RCOL = ["#3fb950", "#e3b341", "#f0883e", "#f85149"];    // their colours
const RMARG = [1000, 2000, 3000, 4000];                       // suggested REC MAX margin (ft)

/**
 * For every cruise sample on the profile, measures:
 *   vws  vertical shear at the level (kt / 1000 ft, over ±2000 ft)
 *   hws  horizontal shear along the route (kt / 150 NM)
 *   dT   temperature change along the route (°C / 100 NM)
 *   dWa  along-track wind change (kt / 50 NM): + = speed decay, − = speed increase
 *   jet  strongest wind between FL250 and FL450 at that point
 *   lv   risk level 0..3, spd = large speed change, room = ft below REC MAX,
 *   marg = suggested margin, why = reasons in words
 */
function hazards(S, c, path, lo, hi, wts) {
  const out = [];
  const weightAt = (x) => {
    let w = wts[0].w;
    for (const q of wts) if (q.cum <= x) w = q.w;
    return w;
  };

  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    if (s.cum < lo || s.cum > hi) continue;

    const fl = path.at(s.cum), h = fl * 100, p = s.prof;
    const prev = S[Math.max(0, i - 1)], next = S[Math.min(S.length - 1, i + 1)];
    const span = Math.max(1, next.cum - prev.cum);           // NM between neighbours

    // Vertical shear: wind 2000 ft above vs 2000 ft below.
    const up = interpProf(p, h + 2000), dn = interpProf(p, h - 2000), W = interpProf(p, h);
    const vws = Math.hypot(up.u - dn.u, up.v - dn.v) / 4;

    // Horizontal changes between the neighbouring samples, at the same level.
    const a = interpProf(prev.prof, h), b = interpProf(next.prof, h);
    const hws = Math.hypot(b.u - a.u, b.v - a.v) / span * 150;
    const dT = Math.abs(b.T - a.T) / span * 100;
    const dWa = (along(b, next.trk) - along(a, prev.trk)) / span * 50;

    // Jet core strength.
    let jet = 0;
    for (let f = 25000; f <= 45000; f += 1000) {
      const q = interpProf(p, f);
      jet = Math.max(jet, Math.hypot(q.u, q.v));
    }

    // Risk level.
    let lv = 0;
    if (vws >= 3 || hws >= 20 || jet >= 110) lv = 1;
    if (vws >= 5 || hws >= 40 || dT >= 5) lv = 2;
    if (vws >= 9) lv = 3;

    // Speed excursion: big wind change, or a headwind increase eating half the margin to MMO.
    const sound = c.mach > 0 ? SOUND_K * Math.sqrt(W.T + 273.15) : 600;
    const mmoKt = (MMO - c.mach) * sound;
    const spd = Math.abs(dWa) >= 15 || (dWa < 0 && -dWa >= 0.5 * mmoKt);

    const why = [];
    if (vws >= 3) why.push("vertical shear " + vws.toFixed(1) + " kt/1000 ft");
    if (hws >= 20) why.push("horizontal shear " + Math.round(hws) + " kt/150 NM");
    if (dT >= 5) why.push("temperature change " + dT.toFixed(1) + " °C/100 NM");
    if (jet >= 110) why.push("jet " + Math.round(jet) + " kt");
    if (spd) why.push("wind change " + Math.round(Math.abs(dWa)) + " kt/50 NM");

    const room = (recAt(weightAt(s.cum), c, s.cum) - fl) * 100;
    out.push({
      s, fl, W, vws, hws, dT, dWa, jet, lv, spd, mmoKt, why, room,
      marg: Math.min(4000, RMARG[lv] + (spd ? 1000 : 0)),
    });
  }
  return out;
}


/* ============================================================================
 * 17. OFP IMPORT
 *    pdf.js reads the PDF text; ofp.js (separate file) extracts the flight data.
 * ========================================================================== */

async function importOFP(file) {
  const msg = $("ofpmsg");
  msg.className = "msg";
  msg.textContent = "Reading OFP…";
  try {
    const [pdfjs, mod] = await Promise.all([import("./pdf.min.mjs"), import("./ofp.js?v=" + APPV)]);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.mjs", location.href).href;
    const lines = await mod.pdfLines(pdfjs, new Uint8Array(await file.arrayBuffer()));
    const o = mod.parseOFP(lines);
    if (o.waypoints.length < 2) throw new Error("No navigation log found in this PDF.");

    // Fill the form with what the OFP provides.
    $("route").value = o.route;
    if (o.etd) $("dep").value = o.etd.toISOString().slice(0, 16);
    if (o.type) { $("actype").value = prevType = o.type; showClimbCorr(); }
    if (o.tow) $("tow").value = (o.tow / 1000).toFixed(1);
    if (o.mach) $("mach").value = o.mach.toFixed(2);
    if (o.ci != null) $("ci").value = o.ci;
    if (o.ff) $("ff").value = o.ff;
    if (o.p2) $("p2").value = o.p2;
    if (o.p4) $("p4").value = o.p4;
    if (o.destElev != null) $("delev").value = o.destElev;

    // Keep the OFP data for the comparison, the flight log and the hazards table.
    const lvTxt = ofpChanges(o.levels).map((q, i) => "FL" + q.fl + (i && q.fix ? " (" + q.fix + ")" : "")).join(" → ");
    store("optfl.ofp", {
      route: o.route, levels: o.levels, trip: o.trip, tripTime: o.tripTime,
      tof: o.tof, fix: o.fix || [], levelsTxt: lvTxt, sr: o.sr || {},
    });
    saveInputs();

    msg.className = "msg ok";
    msg.textContent = `OFP ${o.orig || ""}→${o.dest || ""}: ${o.waypoints.length} fixes, ETD ${o.etd ? o.etd.toISOString().slice(11, 16) + "Z" : "?"}, ${(o.type || "").toUpperCase()}, TOW ${o.tow ? (o.tow / 1000).toFixed(1) + " t" : "?"}, CI ${o.ci ?? "?"}, M${o.mach || "?"}, FF ${o.ff || "?"} kg/h, penalties ${o.p2 || "?"}% / ${o.p4 || "?"}%${o.bias != null ? `, fuel bias ${o.bias > 0 ? "+" : ""}${o.bias}%` : ""}${o.destElev != null ? `, ${o.dest} elevation ${o.destElev} ft` : ""}, trip ${o.trip ? kg(o.trip) + " kg" : "?"}.\nOFP levels: ${lvTxt}.\nStill needed: OPT and REC MAX at TOW from the FMS (no winds).`;
  } catch (e) {
    msg.className = "msg err";
    msg.textContent = "Couldn't read the OFP: " + (e.message || e) + ". You can still paste the route.";
    console.error(e);
  }
}


/* ============================================================================
 * 18. FLIGHT LOG: tool prediction vs OFP plan vs actual, at every fix
 * ========================================================================== */

/** "2015" or "20:15" -> hours (20.25), or null. */
function tParse(v) {
  const m = String(v || "").trim().match(/^(\d{1,2})[:.]?(\d{2})$/);
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] + +m[2] / 60 : null;
}

/** "14.5" (t) or "14500" (kg) -> kg, or null. */
function fuelKg(v) {
  const x = parseFloat(String(v || "").replace(",", "."));
  return !isFinite(x) ? null : x < 200 ? x * 1000 : x;
}

/** Hours since midnight -> "HH:MM" (wraps past midnight). */
function hhmm(h) {
  h = ((h % 24) + 24) % 24;
  const m = Math.round(h * 60) % 1440;
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

/** Difference a − b in minutes, taking midnight into account. */
function tdiff(a, b) {
  let d = (a - b) * 60;
  while (d > 720) d -= 1440;
  while (d < -720) d += 1440;
  return d;
}

/** Saved flight-log entries for this route (or a fresh, empty log). */
function logState(route) {
  const saved = load("optfl.log");
  return saved && saved.route == route ? saved : { route, prof: "opt", fl: "", tot: "", tof: "", act: {} };
}

/** Builds the flight log card and wires its inputs. */
function renderLog() {
  const box = $("logcard");
  if (!box || !STATE || !STATE.last) return;
  const { c, S, P, recPath, ofpP, ofd, bestF } = STATE.last;
  const LG = logState(P.route);
  if (LG.prof == "ofp" && !ofpP) LG.prof = "opt";

  // Profile to predict with.
  const fixedFL = parseInt(LG.fl) || bestF.fl;
  const path = LG.prof == "ofp" ? ofpP : LG.prof == "fl" ? constPath(fixedFL) : recPath;
  const r = sim(S, c, path);

  // Takeoff time and fuel (defaults: ETD + 15 min, OFP takeoff fuel).
  const depH = P.dep.getUTCHours() + P.dep.getUTCMinutes() / 60;
  const tot = tParse(LG.tot) ?? depH + 0.25;
  const tof = fuelKg(LG.tof) ?? (ofd && ofd.tof ? ofd.tof : null);

  const ofpFix = {};
  if (ofd && ofd.fix) for (const f of ofd.fix) ofpFix[f.name] = f;

  const pts = S.filter((s) => s.user && s.name);
  const fob = (burnt) => tof != null ? (tof - burnt) / 1000 : null;        // tonnes on board
  const ft = (x) => x == null ? "—" : x.toFixed(1);

  const td = tdInfo(S, c, r, path);
  const tdRow = td ? `<tr style="background:rgba(57,197,207,.10)"><td><b>T/D</b><div class="note" style="font-size:10px">${Math.round(td.cum)} NM · ${Math.round(td.toGo)} to go</div></td>
<td><b>${hhmm(tot + td.t)}</b></td><td class="mut">—</td><td></td><td><b>${ft(fob(td.f))}</b></td><td class="mut">—</td><td></td><td class="note" style="font-size:10px">${tdWhere(td)}</td></tr>` : "";
  const rows = r.bad
    ? `<tr><td colspan="9">This profile doesn't fit the route.</td></tr>`
    : pts.map((s) => {
      const n = s.name, o = ofpFix[n], A = LG.act[n] || {};
      const toolTime = tot + (r.tchk[n] ?? 0);
      const toolFob = fob(r.chk[n] ?? 0);
      const ofpTime = o && o.at != null ? tot + o.at : null;
      const ofpFob = o && o.rem != null && ofd.tof && tof != null ? (tof - (ofd.tof - o.rem)) / 1000 : null;
      const phase = s.cum < r.lo ? "CLB" : s.cum > r.hi ? "DES" : "FL" + path.at(s.cum);
      return `<tr data-n="${n}">
<td>${n}<div class="note" style="font-size:10px">${Math.round(s.cum)} NM · ${phase}</div></td>
<td>${hhmm(toolTime)}</td><td class="mut">${ofpTime != null ? hhmm(ofpTime) : "—"}</td>
<td><input class="li" data-k="ata" value="${A.ata || ""}" placeholder="hh:mm" inputmode="numeric"></td>
<td>${ft(toolFob)}</td><td class="mut">${ft(ofpFob)}</td>
<td><input class="li" data-k="fob" value="${A.fob || ""}" placeholder="t" inputmode="decimal"></td>
<td class="dl" data-ta="${toolTime}" data-fa="${toolFob ?? ""}" data-ot="${ofpTime ?? ""}" data-of="${ofpFob ?? ""}"></td></tr>`
        // T/D row goes after the last fix before it.
        + (td && s === pts.filter((q) => q.cum <= td.cum).pop() ? tdRow : "");
    }).join("");

  const lastPt = pts[pts.length - 1];
  const landing = r.bad ? null : { t: tot + r.time, f: fob(r.fuel) };
  const profileName = LG.prof == "ofp" ? "OFP profile" : LG.prof == "fl" ? "FL" + fixedFL + " constant" : profTxt(path, r, S);

  box.innerHTML = `<div class="card"><h2>Flight log</h2>
<div class="grid">
  <div><label>Profile</label><select id="lg_prof"><option value="opt">Optimizer</option>${ofpP ? '<option value="ofp">OFP</option>' : ""}<option value="fl">Fixed FL</option></select></div>
  <div id="lg_flw" style="${LG.prof == "fl" ? "" : "display:none"}"><label>Fixed FL</label><input id="lg_fl" type="number" step="10" value="${fixedFL}"></div>
  <div><label>Takeoff time (UTC)</label><input id="lg_tot" value="${LG.tot}" placeholder="${hhmm(depH + 0.25)}"></div>
  <div><label>Takeoff fuel (t or kg)</label><input id="lg_tof" value="${LG.tof}" placeholder="${ofd && ofd.tof ? (ofd.tof / 1000).toFixed(1) : "e.g. 15.9"}"></div>
</div>
${landing ? `<p style="font-size:13px">Landing ${lastPt ? lastPt.name : ""}: <b>${hhmm(landing.t)}</b>${landing.f != null ? `, <b>${landing.f.toFixed(1)} t</b> on board` : ""} · trip ${kg(r.fuel)} kg, ${hm(r.time)} (${profileName}).</p>` : ""}
<div class="scroll"><table class="log"><tr><th>WPT</th><th>ETO</th><th class="mut">OFP</th><th>ATA</th><th>FOB</th><th class="mut">OFP</th><th>AFOB</th><th>Δ</th></tr>${rows}</table></div>
<p class="note">ETO and FOB = tool prediction from your takeoff time and fuel. OFP = the plan's own time and fuel at each fix, shifted to your takeoff time and fuel. Type the actual time (ATA) and fuel (AFOB, in t or kg) as you pass each fix. Δ = actual minus prediction (minutes / kg), with the difference against the OFP below it. Your entries are kept on this device for this route.</p>
<button class="sec" id="lg_clear">Clear actual values</button></div>`;

  // --- Live updates of the Δ column as the user types ------------------------------
  const save = () => store("optfl.log", LG);
  const updateRow = (tr) => {
    const n = tr.dataset.n, A = LG.act[n] || {};
    const cell = tr.querySelector(".dl"), d = cell.dataset;
    const at = tParse(A.ata), af = fuelKg(A.fob);
    const vsTool = [], vsOfp = [];
    if (at != null) {
      vsTool.push(sgn(tdiff(at, +d.ta)) + "′");
      if (d.ot) vsOfp.push(sgn(tdiff(at, +d.ot)) + "′");
    }
    if (af != null) {
      if (d.fa) vsTool.push(sgn(af - 1000 * +d.fa));
      if (d.of) vsOfp.push(sgn(af - 1000 * +d.of));
    }
    // Red when 5 min or 300 kg away from the prediction.
    const bad = (at != null && Math.abs(tdiff(at, +d.ta)) >= 5) ||
                (af != null && d.fa && Math.abs(af - 1000 * +d.fa) >= 300);
    cell.innerHTML = vsTool.length
      ? `<span style="color:${bad ? "var(--rd)" : "var(--acc)"}">${vsTool.join(" / ")}</span>${vsOfp.length ? `<div class="note" style="font-size:10px">OFP ${vsOfp.join(" / ")}</div>` : ""}`
      : "";
  };

  box.querySelectorAll("tr[data-n]").forEach((tr) => {
    updateRow(tr);
    tr.querySelectorAll("input.li").forEach((inp) => inp.addEventListener("input", () => {
      const n = tr.dataset.n;
      (LG.act[n] = LG.act[n] || {})[inp.dataset.k] = inp.value.trim();
      save();
      updateRow(tr);
    }));
  });

  // Settings changes rebuild the card (deferred, so it never happens mid-event).
  $("lg_prof").value = LG.prof;
  $("lg_prof").onchange = (e) => { LG.prof = e.target.value; save(); setTimeout(renderLog, 0); };
  $("lg_fl").onchange = (e) => { LG.fl = e.target.value; save(); setTimeout(renderLog, 0); };
  $("lg_tot").onchange = (e) => { LG.tot = e.target.value.trim(); save(); setTimeout(renderLog, 0); };
  $("lg_tof").onchange = (e) => { LG.tof = e.target.value.trim(); save(); setTimeout(renderLog, 0); };

  // Two taps to clear (the page can't show confirmation dialogs).
  let armed = false;
  $("lg_clear").onclick = () => {
    if (!armed) {
      armed = true;
      $("lg_clear").textContent = "Tap again to clear";
      setTimeout(() => {
        armed = false;
        const b = $("lg_clear");
        if (b) b.textContent = "Clear actual values";
      }, 3000);
      return;
    }
    LG.act = {};
    save();
    renderLog();
  };
}


/* ============================================================================
 * 19. WIRING (buttons, start-up)
 * ========================================================================== */

/** Switches between "manual winds" and "datalink" mode. */
function setMode(m) {
  $("mode").value = m;
  document.querySelectorAll(".segb").forEach((b) => b.classList.toggle("on", b.dataset.m == m));
  $("mineLbl").textContent = m == "datalink"
    ? "Levels you usually request in the uplink (to compare)"
    : "Levels you normally enter (to compare)";
  if (STATE && STATE.json) {
    try { render(STATE.P); } catch (e) { console.error(e); }
  }
  saveInputs();
}

/** Recalculates with the winds already loaded. */
function rerender() {
  if (STATE && STATE.json) {
    try { render(STATE.P); } catch (e) { console.error(e); }
  }
}

document.querySelectorAll(".segb").forEach((b) => { b.onclick = () => setMode(b.dataset.m); });

// Restore the saved form (or default the departure to the next whole hour).
(function init() {
  const saved = load("optfl.in");
  if (saved) {
    IDS.forEach((id) => {
      if (saved[id] != null && saved[id] !== "") $(id).value = saved[id];
    });
  }
  if (!$("dep").value) {
    const d = new Date(Date.now() + 3600e3);
    d.setUTCMinutes(0, 0, 0);
    $("dep").value = d.toISOString().slice(0, 16);
  }
})();

// Climb fuel correction is kept per aircraft type (optfl.clcorr = { a320neo: -200, ... }).
function showClimbCorr() {
  const all = load("optfl.clcorr") || {};
  $("clcorr").value = all[$("actype").value] || 0;
}
$("clcorr").addEventListener("change", () => {
  const all = load("optfl.clcorr") || {};
  all[$("actype").value] = parseFloat($("clcorr").value) || 0;
  store("optfl.clcorr", all);
  rerender();
});
showClimbCorr();

// Changing aircraft type resets fuel flow and TOW to that type's typical values,
// but only if they still hold the previous type's typical values (so a TOW and
// fuel flow imported from an OFP or typed in by hand are never overwritten).
let prevType = $("actype").value;
$("actype").addEventListener("change", () => {
  const P = AC[prevType], A = AC[$("actype").value];
  if (!P || +$("ff").value === P.ff) $("ff").value = A.ff;
  if (!P || +$("tow").value === P.w) $("tow").value = A.w;
  prevType = $("actype").value;
  showClimbCorr();
  saveInputs();
  rerender();
});

// These settings recalculate immediately.
["model", "perf", "recsrc", "pfac", "msn", "delev", "desf", "ci", "goal", "stepc", "minstep", "recm"].forEach((id) =>
  $(id).addEventListener("change", () => { saveInputs(); rerender(); }));

$("ofpfile").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (f) importOFP(f);
  e.target.value = "";   // allow importing the same file again
});

/** Shows which tables are loaded on this device. */
function showTables() {
  const types = Object.keys(TABLES);
  $("tblmsg").innerHTML = types.length
    ? "Loaded on this device: " + types.map((t) => {
      const V = TABLES[t].variants || [TABLES[t]];
      const parts = ["climb", "cruise", "alt", "descent"].filter((k) => V[0][k]).join(", ");
      const msn = V.filter((x) => x.msn).map((x) => `MSN ${x.msn[0]}–${x.msn[1]}`).join(" / ");
      return `<b>${t.toUpperCase()}</b> (${parts}${msn ? "; " + msn : ""})`;
    }).join(" · ")
    : "None loaded: the generic model is used.";
  $("tblclear").style.display = types.length ? "" : "none";
}

$("tblfile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const parsed = parseTables(JSON.parse(await f.text()));
    TABLES = Object.assign({}, TABLES, parsed);
    store("optfl.tables", TABLES);
    $("perf").value = "tables";      // use the tables just loaded
    saveInputs();
    showTables();
    rerender();
  } catch (err) {
    $("tblmsg").innerHTML = `<span class="err">Couldn't load the tables: ${err.message}</span>`;
  }
});

// Reset: every setting, the OFP, forecast, flight log and per-type corrections,
// plus the offline cache (so the newest app files load). FCOM tables stay.
$("resetall").onclick = async () => {
  if (!confirm("Reset all settings, the OFP, the forecast and the flight log?\nYour FCOM tables stay loaded.")) return;
  try {
    Object.keys(localStorage).filter((k) => k.startsWith("optfl.") && k != "optfl.tables")
      .forEach((k) => localStorage.removeItem(k));
  } catch (ignored) {}
  try {
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  } catch (ignored) {}
  location.reload();
};

$("tblclear").onclick = () => {
  TABLES = {};
  store("optfl.tables", TABLES);
  showTables();
  rerender();
};
showTables();

$("go").onclick = go;

// Pasted forecast data (when the automatic download is blocked).
$("usepaste").onclick = () => {
  if (!STATE) return;
  let j;
  try { j = JSON.parse($("pj").value.trim()); } catch (e) {
    setMsg("That doesn't look like the forecast data. Copy the whole page.", "err");
    return;
  }
  $("paste").style.display = "none";
  finish(STATE.P, j, { fetched: Date.now() });
};

// "Recalculate": reuse the winds already downloaded for this route.
$("reuse").onclick = () => {
  saveInputs();
  let P;
  try { P = prepare(); } catch (e) { setMsg(e.message, "err"); return; }
  const saved = load("optfl.data");
  const json = STATE && STATE.json && STATE.P.route == P.route
    ? STATE.json
    : (saved && saved.route == P.route ? saved.json : null);
  if (!json) { setMsg("No wind data for this route yet. Tap Get winds.", "warn"); return; }
  finish(P, json, (STATE && STATE.meta) || (saved && saved.meta) || {});
};

setMode($("mode").value || "manual");

// Show the last result straight away (works offline in flight).
(function restoreLast() {
  const saved = load("optfl.data");
  if (saved && saved.route == $("route").value && saved.json) {
    try { finish(prepare(), saved.json, saved.meta || {}); } catch (ignored) {}
  }
})();

// Offline support when installed from a normal website (not inside claude.ai).
try {
  if ("serviceWorker" in navigator && location.protocol === "https:" &&
      !/claude\.ai|claudeusercontent/.test(location.hostname)) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
} catch (ignored) {}
