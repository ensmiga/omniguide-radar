/* OmniGuide - observed snow.

   NOHRSC SNODAS, the national daily snow model. It assimilates satellite
   and ground observations, so it reflects what is actually lying on the
   ground rather than what a weather model's own precipitation produced.

   This matters more than it sounds. Snow cover is the single most
   behaviour-changing variable for geese, deer and upland birds: it buries
   waste grain, concentrates birds on whatever is exposed, pushes deer down
   out of the high country and holds pheasants in heavy cover. Getting it
   from a forecast's internal snow field, which drifts, was the weakest
   input in the whole model.

   Observed snow is today's truth only. Past the first day the forecast's
   own snow field takes over, because SNODAS does not predict. */
(function (global) {
  'use strict';

  var S = global.US_SNOW || null;

  function available() { return !!S && !!S.depth; }

  /* Bilinear over known cells; unknown cells simply do not contribute. */
  function depthMm(lon, lat) {
    if (!available()) return null;
    var g = S.grid;
    var fx = (lon - g.lon0) / g.d, fy = (lat - g.lat0) / g.d;
    var ix = Math.floor(fx), iy = Math.floor(fy);
    var tx = fx - ix, ty = fy - iy, sum = 0, w = 0;
    for (var a = 0; a <= 1; a++) {
      for (var b = 0; b <= 1; b++) {
        var cx = ix + a, cy = iy + b;
        if (cx < 0 || cy < 0 || cx >= g.nlon || cy >= g.nlat) continue;
        var v = S.depth[cy * g.nlon + cx];
        if (v == null || v < 0) continue;
        var ww = (a ? tx : 1 - tx) * (b ? ty : 1 - ty);
        if (ww <= 0) continue;
        sum += v * ww; w += ww;
      }
    }
    return w > 0.25 ? sum / w : null;
  }

  global.OG = global.OG || {};
  global.OG.snow = {
    available: available, depthMm: depthMm,
    date: S ? S.date : null, source: S ? S.source : null
  };
})(window);
