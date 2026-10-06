/* OmniGuide - Terrain Engine.

   Real elevation at the point someone actually clicked, rather than a
   habitat guess averaged over a hundred square miles.

   Source: AWS Open Data terrain tiles (Mapzen/Tilezen terrarium encoding,
   built from SRTM, 3DEP and national datasets). Free, keyless, CORS-open,
   so the browser can read the pixels back and do the arithmetic locally.

     elevation_metres = (R * 256 + G + B / 256) - 32768

   At tile level 13 a pixel is roughly 20 m on the ground in the lower 48,
   which is fine enough to separate a bench from the draw below it.

   Everything here needs network access, so it does nothing inside the
   artifact sandbox and the Guide falls back to its coarse habitat model. */
(function (global) {
  'use strict';

  var TILE_Z = 13;
  var TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  var SIZE = 256;

  var cache = new Map();        // "z/x/y" -> {data: Float32Array|null, state}
  var inflight = new Map();

  function lon2x(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
  function lat2y(lat, z) {
    var s = Math.sin(lat * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z);
  }

  function loadTile(z, x, y) {
    var key = z + '/' + x + '/' + y;
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (inflight.has(key)) return inflight.get(key);

    var p = new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      var done = false;
      function finish(val) {
        if (done) return;
        done = true;
        cache.set(key, val);
        inflight.delete(key);
        if (cache.size > 60) cache.delete(cache.keys().next().value);
        resolve(val);
      }
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = c.height = SIZE;
          var cx = c.getContext('2d', { willReadFrequently: true });
          cx.drawImage(img, 0, 0);
          var px = cx.getImageData(0, 0, SIZE, SIZE).data;
          var out = new Float32Array(SIZE * SIZE);
          for (var i = 0, n = SIZE * SIZE; i < n; i++) {
            var o = i * 4;
            out[i] = (px[o] * 256 + px[o + 1] + px[o + 2] / 256) - 32768;
          }
          finish(out);
        } catch (e) {
          finish(null);          // tainted canvas, i.e. no CORS
        }
      };
      img.onerror = function () { finish(null); };
      setTimeout(function () { finish(null); }, 12000);
      img.src = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    });
    inflight.set(key, p);
    return p;
  }

  /* Elevation sampler over a 3x3 tile neighbourhood, so a window near a tile
     edge still has data on all sides. */
  function Sampler(tiles, z, cx, cy) {
    this.tiles = tiles; this.z = z; this.cx = cx; this.cy = cy;
    this.n = Math.pow(2, z);
  }
  Sampler.prototype.at = function (lon, lat) {
    var fx = lon2x(lon, this.z), fy = lat2y(lat, this.z);
    var tx = Math.floor(fx), ty = Math.floor(fy);
    var t = this.tiles[(tx - this.cx + 1) * 3 + (ty - this.cy + 1)];
    if (!t) return NaN;
    var px = Math.min(SIZE - 1, Math.max(0, Math.floor((fx - tx) * SIZE)));
    var py = Math.min(SIZE - 1, Math.max(0, Math.floor((fy - ty) * SIZE)));
    return t[py * SIZE + px];
  };

  function bearingName(deg) {
    var names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return names[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  }

  /* Analyse the ground around a point. Resolves to null when tiles are
     unavailable, which is the signal to fall back. */
  function analyse(lon, lat) {
    var z = TILE_Z;
    var cx = Math.floor(lon2x(lon, z)), cy = Math.floor(lat2y(lat, z));
    var jobs = [];
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) jobs.push(loadTile(z, cx + dx, cy + dy));
    }
    return Promise.all(jobs).then(function (tiles) {
      if (!tiles[4]) return null;                    // centre tile is required
      var S = new Sampler(tiles, z, cx, cy);
      var here = S.at(lon, lat);
      if (!isFinite(here)) return null;

      /* Metres per degree at this latitude, for real gradients. */
      var mPerDegLat = 111320;
      var mPerDegLon = 111320 * Math.cos(lat * Math.PI / 180);
      var stepM = 30;
      var dLat = stepM / mPerDegLat, dLon = stepM / mPerDegLon;

      var zN = S.at(lon, lat + dLat), zS = S.at(lon, lat - dLat);
      var zE = S.at(lon + dLon, lat), zW = S.at(lon - dLon, lat);
      if (![zN, zS, zE, zW].every(isFinite)) return null;

      var dzdx = (zE - zW) / (2 * stepM);
      var dzdy = (zN - zS) / (2 * stepM);
      var slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      var slopeDeg = slopeRad * 180 / Math.PI;
      /* Aspect: the compass direction the slope faces. */
      var aspect = (Math.atan2(-dzdx, -dzdy) * 180 / Math.PI + 360) % 360;

      /* Relief and position in the local landform, from a wider ring. */
      var ringM = 400, lo = Infinity, hi = -Infinity, sum = 0, cnt = 0, below = 0;
      for (var a = 0; a < 16; a++) {
        var th = a / 16 * 2 * Math.PI;
        var e = S.at(lon + Math.sin(th) * ringM / mPerDegLon,
                     lat + Math.cos(th) * ringM / mPerDegLat);
        if (!isFinite(e)) continue;
        lo = Math.min(lo, e); hi = Math.max(hi, e);
        sum += e; cnt++;
        if (e < here) below++;
      }
      if (!cnt) return null;
      var ringMean = sum / cnt;
      var relief = hi - lo;
      /* Topographic position: positive on a ridge or bench, negative in a
         draw or bottom. */
      var tpi = here - ringMean;
      var openness = below / cnt;

      var landform;
      if (relief < 12) landform = 'flat ground';
      else if (tpi > relief * 0.25) landform = openness > 0.85 ? 'ridge top' : 'bench or shoulder';
      else if (tpi < -relief * 0.25) landform = openness < 0.2 ? 'bottom or draw' : 'lower slope';
      else landform = slopeDeg > 18 ? 'steep sidehill' : 'mid slope';

      /* Which way water leaves this point: the steepest descent. */
      var drainDeg = (Math.atan2(dzdx, dzdy) * 180 / Math.PI + 180 + 360) % 360;

      return {
        elevM: here, elevFt: here * 3.28084,
        slopeDeg: slopeDeg,
        aspectDeg: aspect, aspect: bearingName(aspect),
        reliefM: relief, tpiM: tpi, openness: openness,
        landform: landform,
        drainDeg: drainDeg, drain: bearingName(drainDeg),
        resolutionM: Math.round(156543 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z)),
        source: 'AWS terrain tiles (SRTM / 3DEP)'
      };
    }).catch(function () { return null; });
  }

  global.OG = global.OG || {};
  global.OG.terrain = { analyse: analyse, TILE_Z: TILE_Z };
})(window);
