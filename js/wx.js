/* OmniGuide - real forecast provider.

   Reads the baked forecast grid (window.WX_GRID): a regular 1.25 degree
   lattice over the lower 48, every 3 hours, from the Open-Meteo multi-model
   blend (NBM / GFS / HRRR / ICON depending on range and region).

   The grid is a SNAPSHOT taken when this build was assembled. The published
   page cannot refresh it - the artifact sandbox blocks all network calls - so
   it ages. `staleHours()` reports by how much and the UI says so.

   Two things happen on top of the raw grid:
     - bilinear interpolation in space, linear in time
     - elevation downscaling: each grid node carries its own model elevation,
       so the temperature is lapse-corrected to the actual terrain height of
       the point being scored. That is what lets a valley floor and the ridge
       above it differ on a 140 km grid. */
(function (global) {
  'use strict';

  var G = global.WX_GRID || null;

  var NLAT = 21, NLON = 47, LAT0 = 24.5, LON0 = -124.5, DLAT = 1.25, DLON = 1.25;
  var LAPSE_F_PER_FT = 0.00357;        // 6.5 C/km expressed in F per foot

  var T0 = G ? Date.parse(G.t0) : 0;
  var STEPH = G ? G.stepH : 3;
  var STEPS = G ? G.steps : 0;

  function available() { return !!G && STEPS > 0; }

  /* How long ago the forecast was pulled.

     This measured from T0, which is the first hour the forecast covers:
     midnight GMT on the day it was pulled. So a forecast fetched at five
     in the afternoon was already "17 hours old", and by evening the map
     said the refresh was overdue and might have failed - on a day when
     it had run twice. The file carries the time it was fetched. */
  var FETCHED = G && G.fetched ? Date.parse(G.fetched) : NaN;

  function staleHours() {
    if (!G) return null;
    return (Date.now() - (FETCHED === FETCHED ? FETCHED : T0)) / 3600000;
  }

  /* Midnight today, local to the point being queried, expressed in UTC ms.
     The app's time axis t counts days from there. */
  function localMidnightUTC(lon, now) {
    var tzo = global.OG.env.tzOffset(lon, now);
    var y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    return Date.UTC(y, m, d, 0, 0, 0) - tzo * 3600000;
  }

  var _now = new Date();

  /* Fractional grid step for app time t at this longitude. */
  function stepFor(lon, t) {
    var utc = localMidnightUTC(lon, _now) + t * 86400000;
    return (utc - T0) / (STEPH * 3600000);
  }

  var FIELDS = ['T', 'P', 'WS', 'WD', 'WG', 'CC', 'PR', 'SF', 'SD'];
  var SCALE = { T: 1, P: 1, WS: 1, WD: 1, WG: 1, CC: 1, PR: 100, SF: 10, SD: 100 };

  /* Nearest-node sample with bilinear weights, linear in time.
     Wind direction is interpolated as a vector so 350 and 10 average to 0. */
  function sample(lon, lat, step, out) {
    var fx = (lon - LON0) / DLON, fy = (lat - LAT0) / DLAT;
    var ix = Math.floor(fx), iy = Math.floor(fy);
    if (ix < 0) ix = 0; if (ix > NLON - 2) ix = NLON - 2;
    if (iy < 0) iy = 0; if (iy > NLAT - 2) iy = NLAT - 2;
    var tx = fx - ix, ty = fy - iy;
    if (tx < 0) tx = 0; if (tx > 1) tx = 1;
    if (ty < 0) ty = 0; if (ty > 1) ty = 1;

    var s0 = Math.floor(step), ts = step - s0;
    if (s0 < 0) { s0 = 0; ts = 0; }
    if (s0 > STEPS - 2) { s0 = STEPS - 2; ts = 1; }

    var n00 = iy * NLON + ix, n10 = n00 + 1, n01 = n00 + NLON, n11 = n01 + 1;
    var w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;

    function at(key, node, s) { return G[key][node * STEPS + s]; }
    function bil(key, s) {
      return (at(key, n00, s) * w00 + at(key, n10, s) * w10 +
              at(key, n01, s) * w01 + at(key, n11, s) * w11) / SCALE[key];
    }

    for (var f = 0; f < FIELDS.length; f++) {
      var k = FIELDS[f];
      if (k === 'WD') continue;
      out[k] = bil(k, s0) * (1 - ts) + bil(k, s0 + 1) * ts;
    }

    /* Wind as a vector, weighted by speed so a calm node cannot drag the
       direction of a windy one. */
    var vx = 0, vy = 0;
    var nodes = [n00, n10, n01, n11], ws = [w00, w10, w01, w11];
    for (var i = 0; i < 4; i++) {
      for (var sI = 0; sI < 2; sI++) {
        var w = ws[i] * (sI === 0 ? (1 - ts) : ts);
        if (w <= 0) continue;
        var dir = at('WD', nodes[i], s0 + sI) * Math.PI / 180;
        var spd = at('WS', nodes[i], s0 + sI);
        vx += Math.sin(dir) * spd * w;
        vy += Math.cos(dir) * spd * w;
      }
    }
    out.WD = (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360;

    /* Model elevation at the point, for the lapse correction. */
    out.gelev = (G.elev[n00] * w00 + G.elev[n10] * w10 +
                 G.elev[n01] * w01 + G.elev[n11] * w11) * 3.28084;  // m to ft
    return out;
  }

  var buf = {}, buf2 = {}, buf3 = {};

  global.OG = global.OG || {};
  global.OG.wx = {
    available: available,
    staleHours: staleHours,
    source: G ? G.source : null,
    fetched: G ? G.t0 : null,
    stepFor: stepFor,
    /* App time t for an absolute moment, at this longitude. */
    tAt: function (lon, ms) { return (ms - localMidnightUTC(lon, _now)) / 86400000; },
    sample: sample,
    LAPSE_F_PER_FT: LAPSE_F_PER_FT,
    buffers: [buf, buf2, buf3],
    spanDays: G ? (STEPS * STEPH / 24) : 0
  };
})(window);
