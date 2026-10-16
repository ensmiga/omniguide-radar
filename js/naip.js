/* OmniGuide - sharp aerial imagery for the closest zooms.

   WHY THIS EXISTS.

   The Satellite base map is the USGS imagery tile cache, which stops at
   level 16 - about 2.4 m a pixel at the equator, 1.7 m in Montana - so
   past that the map drew the level-16 tile stretched, and a field edge,
   a two-track or a creek's willows went to a smudge. Esri's imagery goes
   deeper but is not licensed for commercial use without a contract.

   NAIP - the USDA's National Agriculture Imagery Program - flies the
   lower 48 every two or three years at 0.6 m or better, and is public
   domain. USGS serves it as an image service (USGSNAIPImagery) that
   draws any box on request. It does not hand out tiles, and asked for
   one tile at a time it is slow: measured, a 256-pixel tile took 9 to
   10 s and one 1024-pixel image of the same ground 1.2 s. So: one image
   for the whole view, asked for once the view has stopped moving, kept
   and redrawn in place while the map pans until the next one lands. The
   level-16 tiles stay underneath, so the map is never blank.

   Web Mercator throughout (EPSG:3857), the map's own projection, so an
   image lands exactly on its box. */
(function (global) {
  'use strict';

  var SERVICE = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage';
  var MAX_PX = 2048;          // longest side asked for; the service allows 4000
  var KEEP = 3;               // images kept, oldest first - each is several MB decoded
  var TIMEOUT_MS = 25000;
  var RETRY_MS = 5000;        // after a failure, before asking again
  var HALF = Math.PI * 6378137;

  var kept = [];              // { img, box: [x0, y0, x1, y1] metres, key }
  var pendingKey = null, failedAt = 0;

  function merc(lon, lat) {
    var s = Math.sin(lat * Math.PI / 180);
    return [lon * HALF / 180, Math.log((1 + s) / (1 - s)) / 2 * 6378137];
  }

  function fetchImage(box, w, h, key, onReady) {
    pendingKey = key;
    var img = new Image();
    img.crossOrigin = 'anonymous';
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      img.src = '';
      if (pendingKey === key) pendingKey = null;
      failedAt = Date.now();
    }, TIMEOUT_MS);
    img.onload = function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (pendingKey === key) pendingKey = null;
      kept.push({ img: img, box: box, key: key });
      while (kept.length > KEEP) kept.shift();
      if (onReady) onReady();
    };
    img.onerror = function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (pendingKey === key) pendingKey = null;
      failedAt = Date.now();
    };
    img.src = SERVICE + '?bbox=' + box.map(function (v) { return v.toFixed(1); }).join(',') +
      '&bboxSR=3857&imageSR=3857&size=' + w + ',' + h + '&format=jpg&f=image';
  }

  /* The images to draw for this view, oldest first. lon0/lat0 is the
     south-west corner; pxW and pxH the view's size in device pixels.
     A new image is asked for only when the view has stopped moving
     (still) and nothing is already on its way. */
  function images(lon0, lat0, lon1, lat1, pxW, pxH, still, onReady) {
    var a = merc(lon0, lat0), b = merc(lon1, lat1);
    var box = [a[0], a[1], b[0], b[1]];
    var key = box.map(function (v) { return Math.round(v); }).join(',');
    var have = false;
    for (var i = 0; i < kept.length; i++) if (kept[i].key === key) have = true;
    if (still && !have && !pendingKey && Date.now() - failedAt > RETRY_MS) {
      var s = Math.min(1, MAX_PX / Math.max(pxW, pxH));
      fetchImage(box, Math.max(64, Math.round(pxW * s)), Math.max(64, Math.round(pxH * s)), key, onReady);
    }
    return kept;
  }

  /* Metres east and north to the map's world units. */
  function toWorld(mx, my, W, out) {
    out[0] = (mx + HALF) / (2 * HALF) * W;
    out[1] = (HALF - my) / (2 * HALF) * W;
    return out;
  }

  global.OG = global.OG || {};
  global.OG.naip = {
    images: images, toWorld: toWorld,
    credit: 'USDA NAIP imagery, via USGS The National Map'
  };
})(window);
