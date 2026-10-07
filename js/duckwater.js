/* OmniGuide - huntable waterfowl water.

   WHAT THIS IS FOR.

   "Where is the water" and "where is the duck water" are different
   questions, and the first one is nearly useless. The middle of a deep
   reservoir holds nothing you can hunt. A quarter acre of emergent marsh
   at the back of a slough holds everything.

   So this does not draw water. It draws the cover types a duck actually
   feeds and loafs in, read straight off NLCD at its native 30 m through
   the MRLC image service, recoloured in the browser:

     emergent herbaceous wetland   the prime stuff, cattail and smartweed
     woody wetland                 flooded timber
     open water                    edge and loafing water, weighted down
                                   because the raster cannot see depth and
                                   most of a big lake is not huntable
     cropland and pasture          only where they sit against water, which
                                   is the flooded-ag and moist-soil case

   The adjacency test is the point of the last one. Cut corn in Iowa on
   its own is a deer field; cut corn against a marsh is a duck hunt, and
   the difference is a dilation of the water mask.

   Falls back silently to the coarse baked grid when the service is
   unreachable or the view is too wide to request sensibly. */
(function (global) {
  'use strict';

  var WMS = 'https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/wms';

  /* NLCD palette, as the service actually serves it. Verified against a
     live response rather than taken from the spec sheet. */
  var PALETTE = [
    [71, 107, 160, 11], [209, 221, 249, 12], [221, 201, 201, 21], [216, 147, 130, 22],
    [237, 0, 0, 23], [170, 0, 0, 24], [178, 173, 163, 31], [104, 170, 99, 41],
    [28, 99, 48, 42], [181, 201, 142, 43], [204, 186, 124, 52], [226, 226, 193, 71],
    [219, 216, 61, 81], [170, 112, 40, 82], [186, 216, 234, 90], [112, 163, 186, 95]
  ];

  /* How much of a duck hunt each cover type is, on its own. */
  var VALUE = { 95: 1.00, 90: 0.85, 11: 0.55 };
  /* And what it becomes when it sits against water. */
  var NEAR_WATER = { 82: 0.60, 81: 0.30, 71: 0.22 };

  var MAX_SPAN_DEG = 6;        // wider than this and the request is pointless
  var MAX_PX = 900;

  var cache = new Map();       // key -> {canvas, bbox} | 'pending' | 'failed'
  var inflight = 0;

  function classOf(r, g, b) {
    /* Nearest palette entry. The service antialiases nothing, but PNG
       colour management can shift a value by one. */
    var best = 0, bestD = 1e9;
    for (var i = 0; i < PALETTE.length; i++) {
      var p = PALETTE[i];
      var d = (r - p[0]) * (r - p[0]) + (g - p[1]) * (g - p[1]) + (b - p[2]) * (b - p[2]);
      if (d < bestD) { bestD = d; best = p[3]; }
    }
    return bestD > 900 ? 0 : best;      // far from every entry: background
  }

  function keyFor(bbox, w, h) {
    return bbox.map(function (v) { return v.toFixed(3); }).join(',') + ':' + w + 'x' + h;
  }

  /* Build the orange overlay for one bbox. Returns a canvas or null. */
  function render(img, w, h) {
    var src = document.createElement('canvas');
    src.width = w; src.height = h;
    var sx = src.getContext('2d', { willReadFrequently: true });
    sx.drawImage(img, 0, 0, w, h);
    var d;
    try { d = sx.getImageData(0, 0, w, h).data; } catch (e) { return null; }

    var n = w * h;
    var cls = new Uint8Array(n);
    var water = new Uint8Array(n);
    for (var i = 0, k = 0; i < n; i++, k += 4) {
      var c = classOf(d[k], d[k + 1], d[k + 2]);
      cls[i] = c;
      if (c === 11 || c === 90 || c === 95) water[i] = 1;
    }

    /* Dilate the water mask by a few pixels. Cropland only counts as
       duck ground when it is within a short flight of wet cover. */
    var R = Math.max(2, Math.round(Math.min(w, h) / 90));
    var near = new Uint8Array(n);
    var tmp = new Uint8Array(n);
    var x, y, dx, dy, j;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var hit = 0;
        for (dx = -R; dx <= R && !hit; dx++) {
          j = x + dx;
          if (j < 0 || j >= w) continue;
          if (water[y * w + j]) hit = 1;
        }
        tmp[y * w + x] = hit;
      }
    }
    for (x = 0; x < w; x++) {
      for (y = 0; y < h; y++) {
        var hit2 = 0;
        for (dy = -R; dy <= R && !hit2; dy++) {
          j = y + dy;
          if (j < 0 || j >= h) continue;
          if (tmp[j * w + x]) hit2 = 1;
        }
        near[y * w + x] = hit2;
      }
    }

    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    var ox = out.getContext('2d');
    var od = ox.createImageData(w, h);
    var p = od.data;
    for (i = 0, k = 0; i < n; i++, k += 4) {
      var v = VALUE[cls[i]] || 0;
      if (!v && near[i]) v = NEAR_WATER[cls[i]] || 0;
      if (!v) continue;
      /* One hue, varying weight, so the eye reads intensity as how much
         of a duck hunt it is rather than as a category. */
      p[k] = 255;
      p[k + 1] = Math.round(150 - 60 * v);
      p[k + 2] = Math.round(40 - 20 * v);
      p[k + 3] = Math.round(235 * v);
    }
    ox.putImageData(od, 0, 0);
    return out;
  }

  /* Returns a ready canvas for this view, or null while it loads. */
  function overlay(bbox, onReady) {
    var spanLon = bbox[2] - bbox[0], spanLat = bbox[3] - bbox[1];
    if (spanLon > MAX_SPAN_DEG || spanLat > MAX_SPAN_DEG) return null;

    var ar = spanLon / Math.max(1e-6, spanLat);
    var w = Math.round(Math.min(MAX_PX, Math.max(160, MAX_PX)));
    var h = Math.round(w / Math.max(0.2, ar));
    if (h > MAX_PX) { h = MAX_PX; w = Math.round(h * ar); }

    var key = keyFor(bbox, w, h);
    var hit = cache.get(key);
    if (hit === 'failed') return null;
    if (hit === 'pending') return null;
    if (hit) return hit;
    if (inflight > 1) return null;

    cache.set(key, 'pending');
    inflight++;
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      inflight--;
      var c = null;
      try { c = render(img, w, h); } catch (e) { c = null; }
      cache.set(key, c || 'failed');
      if (cache.size > 24) {
        var first = cache.keys().next().value;
        cache.delete(first);
      }
      if (c && onReady) onReady();
    };
    img.onerror = function () {
      inflight--;
      cache.set(key, 'failed');
    };
    img.src = WMS + '?service=WMS&version=1.1.1&request=GetMap' +
      '&layers=NLCD_2021_Land_Cover_L48&bbox=' + bbox.join(',') +
      '&width=' + w + '&height=' + h + '&srs=EPSG:4326&format=image/png';
    return null;
  }

  global.OG = global.OG || {};
  global.OG.duckwater = {
    overlay: overlay,
    maxSpanDeg: MAX_SPAN_DEG,
    source: 'NLCD 2021 land cover (MRLC), recoloured in the browser'
  };
})(window);
