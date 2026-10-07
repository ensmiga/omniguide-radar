/* OmniGuide - climate normals lookup.

   WHY THIS EXISTS.

   Outside the ten-day forecast window the conditions engine fell back to
   a synthetic temperature curve: a base fitted by hand from latitude,
   elevation and a cosine of the day of year, plus frontal anomalies. It
   was about 35 degrees too cold in a northern winter. NOAA's 1991-2020
   normals, already shipped in normals.js for the planner, put Devils Lake
   at a mean of 8 F in early January. The synthetic curve produced -29 F,
   every year, for every northern station - which drove the freeze index
   hard to 1.0 from early December and, once the freeze lockout went in,
   flattened every late-season waterfowl score in the north.

   494 stations, four nearest blended by inverse distance, each corrected
   for the elevation difference between the reporting station and the
   ground actually being hunted. This is the same lookup planner.js was
   already doing privately; it lives here now so the conditions engine can
   use it too, and so there is one copy of it. */
(function (global) {
  'use strict';

  var N = global.US_NORMALS || null;
  var MISSING = -9999;
  var K = 4;
  var LAPSE_F_PER_FT = 0.00357;

  function available() { return !!N && N.n > 0; }

  function weekOf(doy) {
    var w = Math.floor((((doy - 1) % 365) + 365) % 365 / 7);
    return w > 51 ? 51 : w;
  }

  var cache = new Map();

  /* terrainFt is passed in rather than looked up, so this file does not
     have to reach back into the habitat engine that calls it. */
  function at(lon, lat, week, terrainFt) {
    if (!available()) return null;
    week = ((week % 52) + 52) % 52;

    var ck = (Math.round(lon * 8) * 4096 + Math.round(lat * 8)) * 64 + week;
    var hit = cache.get(ck);
    if (hit !== undefined) return hit;

    var best = [];
    for (var s = 0; s < N.n; s++) {
      var dx = (N.lon[s] - lon) * Math.cos(lat * Math.PI / 180);
      var dy = N.lat[s] - lat;
      var d2 = dx * dx + dy * dy;
      if (best.length < K) {
        best.push([d2, s]);
        best.sort(function (a, b) { return a[0] - b[0]; });
      } else if (d2 < best[K - 1][0]) {
        best[K - 1] = [d2, s];
        best.sort(function (a, b) { return a[0] - b[0]; });
      }
    }
    if (!best.length) { cache.set(ck, null); return null; }

    var wSum = 0, tx = 0, tn = 0, sd = 0, pp = 0, sdW = 0, ppW = 0;
    for (var b = 0; b < best.length; b++) {
      var idx = best[b][1];
      var w = 1 / (best[b][0] + 0.02);
      var o = idx * 52 + week;
      if (N.TX[o] === MISSING || N.TN[o] === MISSING) continue;
      var lapse = (N.elev[idx] - (terrainFt == null ? N.elev[idx] : terrainFt)) * LAPSE_F_PER_FT;
      tx += (N.TX[o] / 10 + lapse) * w;
      tn += (N.TN[o] / 10 + lapse) * w;
      wSum += w;
      if (N.SD[o] !== MISSING) { sd += (N.SD[o] / 10) * w; sdW += w; }
      if (N.PP[o] !== MISSING) { pp += N.PP[o] * w; ppW += w; }
    }
    if (wSum <= 0) { cache.set(ck, null); return null; }

    var out = {
      tmax: tx / wSum,
      tmin: tn / wSum,
      tmean: (tx + tn) / (2 * wSum),
      snowIn: sdW > 0 ? sd / sdW : 0,
      precipProb: ppW > 0 ? pp / ppW : 20,
      nearestMiles: Math.sqrt(best[0][0]) * 69
    };
    if (cache.size > 60000) cache.clear();
    cache.set(ck, out);
    return out;
  }

  /* Shape of the day. Coldest a little before sunrise, warmest mid
     afternoon. Returns -1 at the minimum and +1 at the maximum, so a
     caller scales it by half the normal daily range. A hunting app that
     reported one flat temperature for a whole day was quietly telling
     everyone that dawn feels like 2 PM. */
  function diurnal(hour) {
    return -Math.cos((hour - 5.5) / 24 * 2 * Math.PI);
  }

  global.OG = global.OG || {};
  global.OG.climo = {
    at: at, weekOf: weekOf, diurnal: diurnal,
    available: available,
    source: N ? N.source : null,
    period: N ? N.period : null
  };
})(window);
