/* OmniGuide - real habitat surface lookup.

   Reads the raster built by ingest/habitat.mjs: NLCD 2021 land cover and
   AWS elevation for quality, GBIF occurrence share for presence, at 0.1
   degrees over the lower 48. Replaces the hand-placed Gaussian blobs that
   used to stand in for habitat - see the header of that script for what
   those were getting wrong.

   Bilinear, because the thing being sampled is a continuous suitability
   surface and a hunter dragging the cursor across a valley should not see
   it step. Returns null when the grid has not loaded or the point is off
   the grid, and every caller falls back to the old synthetic surface in
   that case rather than reading zero as "no animals here". */
(function (global) {
  'use strict';

  var raw = global.US_HABITAT || null;
  var planes = {};
  var G = raw ? raw.grid : null;

  function plane(sp) {
    if (!raw || !raw.sp[sp]) return null;
    var p = planes[sp];
    if (p !== undefined) return p;
    try {
      var bin = global.atob(raw.sp[sp]);
      var a = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      p = a;
    } catch (e) {
      p = null;
    }
    planes[sp] = p;
    return p;
  }

  function at(sp, lon, lat) {
    if (!G) return null;
    var a = plane(sp);
    if (!a) return null;

    /* Grid values sit at cell centres, so shift half a cell before
       interpolating or the whole surface drifts southwest by 5 km. */
    var fx = (lon - G.lon0) / G.d - 0.5;
    var fy = (lat - G.lat0) / G.d - 0.5;
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    var tx = fx - x0, ty = fy - y0;
    if (x0 < 0 || y0 < 0 || x0 + 1 >= G.nlon || y0 + 1 >= G.nlat) return null;

    var i00 = y0 * G.nlon + x0, i10 = i00 + 1;
    var i01 = i00 + G.nlon, i11 = i01 + 1;
    var top = a[i00] * (1 - tx) + a[i10] * tx;
    var bot = a[i01] * (1 - tx) + a[i11] * tx;
    return (top * (1 - ty) + bot * ty) / 255;
  }

  global.OG = global.OG || {};
  global.OG.habgrid = {
    at: at,
    ready: !!G,
    meta: raw ? { source: raw.source, note: raw.note, built: raw.built, d: raw.grid.d } : null
  };
})(window);
