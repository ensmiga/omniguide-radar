/* OmniGuide Radar - the national opportunity grid.

   Cells are scored at quarter-day steps and cross-faded between them, so the
   timeline scrubs and animates continuously instead of snapping between days.
   Resolution follows zoom: the prediction genuinely becomes more geographically
   specific as you move in, rather than showing the same number bigger. */
(function (global) {
  'use strict';

  var geo = global.OG.geo, env = global.OG.env, models = global.OG.models, regs = global.OG.regs;

  var RAMP = [
    [0.00, 30, 58, 82], [0.20, 28, 100, 117], [0.38, 46, 143, 110],
    [0.55, 143, 164, 65], [0.70, 211, 154, 46], [0.85, 220, 106, 42], [1.00, 198, 47, 42]
  ];

  function rampRGB(v) {
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    for (var i = 1; i < RAMP.length; i++) {
      if (v <= RAMP[i][0]) {
        var a = RAMP[i - 1], b = RAMP[i];
        var f = (v - a[0]) / (b[0] - a[0]);
        return [Math.round(a[1] + (b[1] - a[1]) * f),
                Math.round(a[2] + (b[2] - a[2]) * f),
                Math.round(a[3] + (b[3] - a[3]) * f)];
      }
    }
    return [198, 47, 42];
  }
  function rampCSS(v, alpha) {
    var c = rampRGB(v);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
  }

  function radarCSSForValue(v) { return rampCSS(v / 100, 1); }

  /* ---------- Weather layer ramps ---------- */

  function hexRGB(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function makeRamp(stops) {
    var S = stops.map(function (s) { return [s[0]].concat(hexRGB(s[1])); });
    return function (v) {
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      for (var i = 1; i < S.length; i++) {
        if (v <= S[i][0]) {
          var a = S[i - 1], b = S[i], f = (v - a[0]) / (b[0] - a[0] || 1);
          return [Math.round(a[1] + (b[1] - a[1]) * f),
                  Math.round(a[2] + (b[2] - a[2]) * f),
                  Math.round(a[3] + (b[3] - a[3]) * f)];
        }
      }
      return S[S.length - 1].slice(1);
    };
  }

  var WX_LAYERS = {
    temp: {
      name: 'Temperature', unit: '°F', min: -20, max: 110, digits: 0,
      get: function (w) { return w.tempF; },
      ramp: makeRamp([[0, '#3B1F6B'], [0.16, '#2B4FA0'], [0.29, '#2B8FB8'], [0.40, '#43A97F'],
                      [0.52, '#8FB84A'], [0.64, '#E0C13C'], [0.78, '#E0802E'], [0.9, '#C9372A'], [1, '#7E1A16']])
    },
    wind: {
      name: 'Wind', unit: 'mph', min: 0, max: 40, digits: 0,
      get: function (w) { return w.windSpd; },
      ramp: makeRamp([[0, '#1C4C56'], [0.2, '#1E7D86'], [0.4, '#4FA86B'], [0.6, '#D8BF3E'],
                      [0.78, '#DE7C2C'], [1, '#B82E5C']])
    },
    gusts: {
      name: 'Gusts', unit: 'mph', min: 0, max: 55, digits: 0,
      get: function (w) { return w.gust; },
      ramp: makeRamp([[0, '#1C4C56'], [0.2, '#1E7D86'], [0.4, '#4FA86B'], [0.6, '#D8BF3E'],
                      [0.78, '#DE7C2C'], [1, '#B82E5C']])
    },
    precip: {
      name: 'Precipitation', unit: 'in/3h', min: 0, max: 0.35, digits: 2,
      get: function (w) { return w.precipIn || 0; },
      ramp: makeRamp([[0, '#223033'], [0.12, '#2C6E8E'], [0.35, '#3A9FC4'], [0.6, '#5D7BD6'],
                      [0.82, '#8E5BC9'], [1, '#C44C9B']])
    },
    cloud: {
      name: 'Cloud cover', unit: '%', min: 0, max: 100, digits: 0,
      get: function (w) { return w.cloud * 100; },
      ramp: makeRamp([[0, '#1F4A5C'], [0.35, '#60798A'], [0.7, '#A9B6BE'], [1, '#EFF3F5']])
    },
    snowpack: {
      name: 'Snow depth', unit: 'in', min: 0, max: 24, digits: 1,
      get: function (w) { return (w.snowDepthFt || 0) * 12; },
      ramp: makeRamp([[0, '#1B3A4B'], [0.2, '#3E7FA8'], [0.5, '#8FC0D8'], [0.78, '#CFE4EE'], [1, '#FFFFFF']])
    }
  };

  var LEGAL_RGB = { 90: [63, 167, 118], 65: [214, 160, 54], 45: [150, 120, 200], 15: [104, 120, 128], 0: [130, 140, 146] };

  var STATUS_COLOR = {
    OPEN: 'rgba(63,167,118,0.72)', LIMITED: 'rgba(214,160,54,0.72)',
    PERMIT: 'rgba(150,120,200,0.70)', CLOSED: 'rgba(104,120,128,0.42)',
    UNKNOWN: 'rgba(130,140,146,0.30)'
  };

  /* ---------- Caches ---------- */

  var hexCache = new Map();     // res:j:i -> Float32Array(12) world vertices
  var scoreCache = new Map();   // res:j:i:sp:tq -> Float32Array(5)
  var legalCache = new Map();   // zoneId:sp:day -> status
  var landCache = new Map();    // res:j:i -> state index (-1 for water/outside)

  function clearScores() { scoreCache.clear(); legalCache.clear(); }

  function hexFor(res, j, i, lon, lat) {
    var k = res + ':' + j + ':' + i, h = hexCache.get(k);
    if (!h) {
      h = new Float32Array(12);
      geo.hexWorld(res, lon, lat, h);
      if (hexCache.size > 120000) hexCache.clear();
      hexCache.set(k, h);
    }
    return h;
  }

  function landFor(res, j, i, lon, lat) {
    var k = res + ':' + j + ':' + i, s = landCache.get(k);
    if (s === undefined) {
      s = geo.stateIndexAt(lon, lat);
      if (landCache.size > 200000) landCache.clear();
      landCache.set(k, s);
    }
    return s;
  }


  var wxCache = new Map();          // res:j:i:tq -> conditions, species independent

  function wxAt(res, j, i, lon, lat, tq) {
    var k = res + ':' + j + ':' + i + ':' + tq;
    var v = wxCache.get(k);
    if (!v) {
      v = env.conditions(lon, lat, tq, env.doyFor(tq));
      if (wxCache.size > 200000) wxCache.clear();
      wxCache.set(k, v);
    }
    return v;
  }

  function scoresAt(res, j, i, lon, lat, spId, tq) {
    var k = res + ':' + j + ':' + i + ':' + spId + ':' + tq;
    var v = scoreCache.get(k);
    if (v) return v;
    var sc = models.scoreAt(lon, lat, tq, env.doyFor(tq), spId);
    v = new Float32Array(6);
    if (!sc.inRange) {
      v[5] = 0;                      // out of range; nothing else is meaningful
    } else {
      v[0] = sc.opportunity; v[1] = sc.movement; v[2] = sc.migration;
      v[3] = sc.newBird; v[4] = sc.confidence; v[5] = 1;
    }
    if (scoreCache.size > 400000) scoreCache.clear();
    scoreCache.set(k, v);
    return v;
  }

  function legalAt(lon, lat, spId, day) {
    var si = geo.stateIndexAt(lon, lat);
    if (si < 0) return 'UNKNOWN';
    var z = regs.zoneFor(geo.states[si].abbr, lon, lat);
    var k = z.id + ':' + spId + ':' + day;
    var s = legalCache.get(k);
    if (s === undefined) {
      s = regs.check(lon, lat, global.OG.guide.dateFor(day), spId).status;
      legalCache.set(k, s);
    }
    return s;
  }

  /* ---------- Renderer ---------- */

  function Radar(canvas, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.view = { cx: geo.WORLD_W / 2, cy: geo.WORLD_H / 2, zoom: 1 };
    this.dpr = Math.min(global.devicePixelRatio || 1, 2);
    this.particles = [];
    this.frameCells = new Map();
    this.frameVal = new Map();
    this.frameWind = new Map();
    this.labelBoxes = [];
    this._centerCache = null;
    this.hatch = this._makeHatch();
    this.fitted = false;
    this._pt = [0, 0];
  }

  Radar.prototype._makeHatch = function () {
    var c = document.createElement('canvas');
    c.width = c.height = 8;
    var x = c.getContext('2d');
    x.strokeStyle = 'rgba(224,232,228,0.30)';
    x.lineWidth = 1.1;
    x.beginPath();
    x.moveTo(-2, 10); x.lineTo(10, -2);
    x.moveTo(2, 14); x.lineTo(14, 2);
    x.stroke();
    return this.ctx.createPattern(c, 'repeat');
  };

  Radar.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    /* Don't fit until the layout has a real size. The first resize can fire
       with a one-pixel-tall canvas, and fitting to that pins the zoom at
       effectively nothing. */
    if (!this.fitted && this.w > 80 && this.h > 80) { this.fit(); this.fitted = true; }
  };

  /* World space is the whole Mercator square now, so the opening view frames
     the lower 48 rather than the planet. */
  Radar.prototype.fit = function () {
    this.zoomToBounds(-125.2, 24.2, -66.6, 49.6, 0.06);
  };

  Radar.prototype.toScreen = function (wx, wy, out) {
    out[0] = (wx - this.view.cx) * this.view.zoom + this.w / 2;
    out[1] = (wy - this.view.cy) * this.view.zoom + this.h / 2;
    return out;
  };

  Radar.prototype.toWorld = function (sx, sy, out) {
    out[0] = (sx - this.w / 2) / this.view.zoom + this.view.cx;
    out[1] = (sy - this.h / 2) / this.view.zoom + this.view.cy;
    return out;
  };

  Radar.prototype.lonLatAt = function (sx, sy) {
    var w = this.toWorld(sx, sy, [0, 0]);
    return geo.unproject(w[0], w[1], [0, 0]);
  };

  /* ---------- Raster basemap ----------

     Tiles only work outside the artifact sandbox, where the content security
     policy blocks every external image. On a real origin they load normally;
     inside the sandbox every request fails silently and the map falls back to
     flat land shapes, which still works, just without the relief. */

  var BASEMAPS = {
    relief: {
      name: 'Relief',
      url: 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
      credit: 'Esri, USGS, NOAA',
      maxZoom: 15, premium: false
    },
    satellite: {
      name: 'Satellite',
      url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      credit: 'Esri, Maxar, Earthstar Geographics',
      maxZoom: 18, premium: true
    },
    none: { name: 'No basemap', url: null, credit: null, maxZoom: 0, premium: false }
  };

  var tileCache = new Map();     // key -> {img, ok} ; img.complete when drawable
  var tileFails = 0, tileTried = 0;

  function tileKey(b, z, x, y) { return b + '/' + z + '/' + x + '/' + y; }

  function getTile(radar, bkey, z, x, y) {
    var k = tileKey(bkey, z, x, y);
    var t = tileCache.get(k);
    if (t) return t;
    var def = BASEMAPS[bkey];
    if (!def || !def.url) return null;
    var n = 1 << z;
    if (x < 0 || y < 0 || x >= n || y >= n) return null;

    var img = new Image();
    img.crossOrigin = 'anonymous';
    t = { img: img, ok: false, failed: false };
    tileTried++;
    img.onload = function () { t.ok = true; radar.app.dirty = true; };
    img.onerror = function () { t.failed = true; tileFails++; radar.app.dirty = true; };
    img.src = def.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    if (tileCache.size > 900) {
      /* Crude eviction: drop the oldest third rather than grow without end. */
      var drop = Math.floor(tileCache.size / 3), it = tileCache.keys();
      for (var i = 0; i < drop; i++) tileCache.delete(it.next().value);
    }
    tileCache.set(k, t);
    return t;
  }

  /* True once enough tile requests have failed that we are clearly offline or
     sandboxed, so the renderer can draw land shapes instead. */
  function tilesBlocked() { return tileTried >= 6 && tileFails / tileTried > 0.8; }

  Radar.prototype.drawBasemap = function () {
    var bkey = this.app.state.basemap || 'relief';
    var def = BASEMAPS[bkey];
    if (!def || !def.url || tilesBlocked()) return false;

    var ctx = this.ctx, W = geo.WORLD;
    /* Pick the zoom level whose tiles land nearest 256 screen pixels. */
    var z = Math.round(Math.log2(this.view.zoom * W / 256));
    z = Math.max(2, Math.min(def.maxZoom, z));
    var n = 1 << z, tileWorld = W / n;
    var tilePx = tileWorld * this.view.zoom;

    var tl = this.toWorld(0, 0, [0, 0]), br = this.toWorld(this.w, this.h, [0, 0]);
    var x0 = Math.floor(tl[0] / tileWorld), x1 = Math.floor(br[0] / tileWorld);
    var y0 = Math.floor(tl[1] / tileWorld), y1 = Math.floor(br[1] / tileWorld);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return false;   // sanity guard

    var drew = 0, p = this._pt;
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        var t = getTile(this, bkey, z, tx, ty);
        if (!t || !t.ok) continue;
        this.toScreen(tx * tileWorld, ty * tileWorld, p);
        /* The half-pixel overdraw hides seams from fractional positions. */
        ctx.drawImage(t.img, p[0], p[1], tilePx + 1, tilePx + 1);
        drew++;
      }
    }
    this.basemapCredit = drew ? def.credit : null;
    return drew > 0;
  };

  Radar.prototype.resolution = function () {
    var z = this.view.zoom;
    if (z < 15) return 0;
    if (z < 26) return 1;
    if (z < 44) return 2;
    return 3;
  };

  Radar.prototype.visibleLonLat = function () {
    var c = [[0, 0], [this.w, 0], [0, this.h], [this.w, this.h], [this.w / 2, 0], [this.w / 2, this.h]];
    var lo = [999, 999], hi = [-999, -999];
    for (var i = 0; i < c.length; i++) {
      var ll = this.lonLatAt(c[i][0], c[i][1]);
      if (!isFinite(ll[0]) || !isFinite(ll[1])) continue;
      lo[0] = Math.min(lo[0], ll[0]); hi[0] = Math.max(hi[0], ll[0]);
      lo[1] = Math.min(lo[1], ll[1]); hi[1] = Math.max(hi[1], ll[1]);
    }
    /* Corners outside the projection domain can come back unusable, so the
       window is always clamped to the modelled region. */
    var b = geo.bounds;
    if (lo[0] > hi[0] || lo[1] > hi[1]) return { lon0: b.lon0, lat0: b.lat0, lon1: b.lon1, lat1: b.lat1 };
    return {
      lon0: Math.max(b.lon0 - 1, lo[0] - 1.6), lat0: Math.max(b.lat0 - 1, lo[1] - 1.2),
      lon1: Math.min(b.lon1 + 1, hi[0] + 1.6), lat1: Math.min(b.lat1 + 1, hi[1] + 1.2)
    };
  };

  Radar.prototype.zoomToBounds = function (lon0, lat0, lon1, lat1, padFrac) {
    var a = geo.project(lon0, lat0, [0, 0]), b = geo.project(lon1, lat1, [0, 0]);
    var c = geo.project(lon0, lat1, [0, 0]), d = geo.project(lon1, lat0, [0, 0]);
    var x0 = Math.min(a[0], b[0], c[0], d[0]), x1 = Math.max(a[0], b[0], c[0], d[0]);
    var y0 = Math.min(a[1], b[1], c[1], d[1]), y1 = Math.max(a[1], b[1], c[1], d[1]);
    var p = padFrac == null ? 0.16 : padFrac;
    this.view.zoom = Math.min(this.w / ((x1 - x0) * (1 + p)), this.h / ((y1 - y0) * (1 + p)));
    this.view.cx = (x0 + x1) / 2;
    this.view.cy = (y0 + y1) / 2;
  };

  Radar.prototype.zoomToState = function (abbr) {
    var st = null;
    for (var i = 0; i < geo.states.length; i++) if (geo.states[i].abbr === abbr) st = geo.states[i];
    if (!st) return;
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (var r = 0; r < st.world.length; r++) {
      var ring = st.world[r];
      for (var k = 0; k < ring.length; k += 2) {
        if (ring[k] < x0) x0 = ring[k]; if (ring[k] > x1) x1 = ring[k];
        if (ring[k + 1] < y0) y0 = ring[k + 1]; if (ring[k + 1] > y1) y1 = ring[k + 1];
      }
    }
    this.view.zoom = Math.min(this.w / ((x1 - x0) * 1.35), this.h / ((y1 - y0) * 1.5));
    this.view.cx = (x0 + x1) / 2;
    this.view.cy = (y0 + y1) / 2;
  };

  /* ---------- Drawing ---------- */

  Radar.prototype.drawLand = function (fill, stroke, lw) {
    var ctx = this.ctx, v = this.view, p = this._pt;
    ctx.beginPath();
    for (var s = 0; s < geo.states.length; s++) {
      var ws = geo.states[s].world;
      for (var r = 0; r < ws.length; r++) {
        var ring = ws[r];
        if (ring.length < 6) continue;
        this.toScreen(ring[0], ring[1], p);
        ctx.moveTo(p[0], p[1]);
        for (var k = 2; k < ring.length; k += 2) {
          this.toScreen(ring[k], ring[k + 1], p);
          ctx.lineTo(p[0], p[1]);
        }
        ctx.closePath();
      }
    }
    if (fill) { ctx.fillStyle = fill; ctx.fill('evenodd'); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  };

  /* ---------- Continuous field ----------

     The hexagons are gone. They made the map read as a mosaic of decisions
     when what the model actually produces is a smooth surface, and at
     national scale the mesh was pure noise.

     Scores are sampled on a lattice in WORLD space rather than screen space,
     so panning reuses what was already computed and the samples stay put
     instead of shimmering. World space is an affine function of the screen,
     so the small sample canvas can simply be stretched to fit, and the
     browser's own bilinear filtering is what turns a lattice of numbers into
     a continuous surface. */

  var fieldVals = new Map();      // numeric key -> display value, NaN = nothing here
  var fieldAux = new Map();       // numeric key -> wind direction, for streamlines
  var fieldStamp = '';

  function fkey(gx, gy) { return (gx + 32768) * 65536 + (gy + 32768); }

  Radar.prototype.fieldValue = function (gx, gy, nodeWorld, spId, layer, t, day, ent) {
    var k = fkey(gx, gy);
    var v = fieldVals.get(k);
    if (v !== undefined) return v;

    var ll = geo.unproject(gx * nodeWorld, gy * nodeWorld, this._ll || (this._ll = [0, 0]));
    var lon = ll[0], lat = ll[1];
    var si = geo.stateIndexAt(lon, lat);
    var out = NaN, aux = 0;

    if (si >= 0) {
      var st = geo.states[si];
      var wxl = WX_LAYERS[layer];
      if (wxl) {
        var w = env.conditions(lon, lat, t, env.doyFor(t));
        out = wxl.get(w);
        aux = w.windFrom;
      } else if (!ent.pro && !(ent.state === st.abbr && ent.species === spId)) {
        out = -1;                                     // locked: drawn as a flat preview
      } else if (layer === 'legal') {
        out = STATUS_ORDER[legalAt(lon, lat, spId, day)];
      } else if (layer === 'opportunity' && this.app.state.oppMode === 'day') {
        /* Sampled from the coarse Day lattice rather than scored per cell -
           see dayField in models.js for why 1 degree is the honest
           resolution for this quantity. */
        if (!regs.hasSeasonRecord(st.abbr, spId)) out = NaN;
        else {
          var dv = models.dayField(spId, t).at(lon, lat);
          out = dv === dv ? dv : NaN;
        }
      } else {
        var sc = models.scoreAt(lon, lat, t, env.doyFor(t), spId);
        if (!sc.inRange || !regs.hasSeasonRecord(st.abbr, spId)) out = NaN;
        else {
          out = layer === 'movement' ? sc.movement : layer === 'migration' ? sc.migration :
                layer === 'newbird' ? sc.newBird : layer === 'confidence' ? sc.confidence :
                sc.opportunity;
          aux = sc.mig.applies ? sc.migration : 0;
        }
      }
    }
    if (fieldVals.size > 400000) { fieldVals.clear(); fieldAux.clear(); }
    fieldVals.set(k, out);
    fieldAux.set(k, aux);
    return out;
  };

  var STATUS_ORDER = { OPEN: 90, LIMITED: 65, PERMIT: 45, CLOSED: 15, UNKNOWN: 0 };

  Radar.prototype.drawField = function (layer, spId, t, day, ent) {
    var ctx = this.ctx, z = this.view.zoom;

    /* Roughly 15 screen pixels between samples: fine enough that the
       upscaled surface shows real structure, coarse enough to stay live. */
    var nodeWorld = 15 / z;
    /* oppMode is in the stamp because Spot and Day are different numbers
       for the same cell - without it, switching the toggle would redraw
       from the cache and show the old surface. */
    var stamp = [spId, layer, this.app.state.oppMode, t, nodeWorld.toFixed(6),
                 ent.pro ? 1 : 0, ent.state, ent.species].join('|');
    if (stamp !== fieldStamp) { fieldVals.clear(); fieldAux.clear(); fieldStamp = stamp; }

    var tl = this.toWorld(0, 0, [0, 0]), br = this.toWorld(this.w, this.h, [0, 0]);
    var gx0 = Math.floor(tl[0] / nodeWorld) - 1, gx1 = Math.ceil(br[0] / nodeWorld) + 1;
    var gy0 = Math.floor(tl[1] / nodeWorld) - 1, gy1 = Math.ceil(br[1] / nodeWorld) + 1;
    var cols = gx1 - gx0 + 1, rows = gy1 - gy0 + 1;
    if (cols < 2 || rows < 2 || cols * rows > 60000) return;

    if (!this._fc) {
      this._fc = document.createElement('canvas');
      this._fcx = this._fc.getContext('2d');
    }
    if (this._fc.width !== cols || this._fc.height !== rows) {
      this._fc.width = cols; this._fc.height = rows;
    }
    var img = this._fcx.createImageData(cols, rows);
    var data = img.data;

    var wxl = WX_LAYERS[layer];
    var lo = wxl ? wxl.min : 0, span = wxl ? (wxl.max - wxl.min) : 100;
    var legalMode = layer === 'legal';
    /* The overlay has to sit on top of a basemap now. Full strength buries
       imagery, which defeats the point of having imagery. */
    var bm = this.app.state.basemap || 'relief';
    var opacity = this.app.state.fieldOpacity;
    if (opacity == null) opacity = bm === 'satellite' ? 0.42 : bm === 'relief' ? 0.62 : 0.82;
    var alpha = Math.round(255 * opacity);
    var softAlpha = wxl && (layer === 'precip' || layer === 'snowpack');

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var v = this.fieldValue(gx0 + c, gy0 + r, nodeWorld, spId, layer, t, day, ent);
        var o = (r * cols + c) * 4;
        if (v !== v) continue;                                  // NaN: transparent
        var col, a;
        if (v === -1) { col = [128, 138, 134]; a = 46; }         // locked preview
        else if (legalMode) {
          col = LEGAL_RGB[v] || [130, 140, 146];
          a = Math.round(alpha * 0.8);
        } else if (wxl) {
          col = wxl.ramp((v - lo) / span);
          /* Precipitation and snow read better fading in from nothing than
             as a wall of colour over dry ground. */
          a = softAlpha
            ? Math.round(alpha * Math.min(1, Math.max(0, (v - lo) / span) * 2.4))
            : alpha;
        } else {
          col = rampRGB(v / 100);
          a = alpha;
        }
        data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = a;
      }
    }
    this._fcx.putImageData(img, 0, 0);

    var p = this._pt;
    this.toScreen(gx0 * nodeWorld, gy0 * nodeWorld, p);
    var px = p[0], py = p[1];
    var pw = (cols - 1) * nodeWorld * z, ph = (rows - 1) * nodeWorld * z;

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    /* Half a node of inset on each side: the outer ring of samples exists
       only to give the filter something to interpolate against. */
    var half = nodeWorld * z / 2;
    ctx.drawImage(this._fc, 0.5, 0.5, cols - 1, rows - 1,
                  px + half, py + half, pw, ph);
    ctx.restore();

    this.field = { gx0: gx0, gy0: gy0, cols: cols, rows: rows, nodeWorld: nodeWorld };
  };

  /* Bilinear read-back of the field the last frame drew, for streamlines and
     for the value shown next to town labels. */
  Radar.prototype.fieldAt = function (lon, lat, wantAux) {
    var f = this.field;
    if (!f) return NaN;
    var w = geo.project(lon, lat, [0, 0]);
    var fx = w[0] / f.nodeWorld, fy = w[1] / f.nodeWorld;
    var ix = Math.floor(fx), iy = Math.floor(fy);
    var tx = fx - ix, ty = fy - iy, sum = 0, wsum = 0;
    var src = wantAux ? fieldAux : fieldVals;
    for (var a = 0; a <= 1; a++) {
      for (var b = 0; b <= 1; b++) {
        var v = src.get(fkey(ix + a, iy + b));
        if (v === undefined || v !== v || v === -1) continue;
        var ww = (a ? tx : 1 - tx) * (b ? ty : 1 - ty);
        if (ww <= 0) continue;
        sum += v * ww; wsum += ww;
      }
    }
    return wsum > 0.2 ? sum / wsum : NaN;
  };

  Radar.prototype.draw = function () {
    var app = this.app, ctx = this.ctx, theme = app.theme();
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = theme.mapBg;
    ctx.fillRect(0, 0, this.w, this.h);

    var tiles = this.drawBasemap();
    if (!tiles) this.drawLand(theme.land, null, 0);

    var win = this.visibleLonLat();
    var res = this.resolution();
    var t = app.state.t;
    var spId = app.state.species;
    var layer = app.state.layer;
    var day = Math.floor(t);
    var ent = app.entitlement();

    this.labelBoxes.length = 0;

    this.drawField(layer, spId, t, day, ent);

    if (!tiles) this.drawHydro(win);
    if (this.view.zoom > 22) this.drawCounties(win);
    this.drawLand(null, theme.border, this.view.zoom > 25 ? 1.2 : 0.9);

    if (layer === 'migration') this.drawMigration(res);
    if (layer === 'wind' || layer === 'gusts') this.drawWindFlow(res);
    this.drawPlaceLabels(win, res);
    this.drawGraticule();
    this.drawSpots();
    this.drawUserLocation();
    this.drawSelection();
    this.drawScaleBar();
    this.drawWhereAmI();
    this.drawEdgeCoords();
    if (!ent.pro) this.drawLockHint();
  };

  /* ---------- Reference geography ---------- */

  /* Rivers and lakes. For a waterfowl product the water is not decoration -
     it is the thing being hunted, so it draws over the heat, not under it. */
  Radar.prototype.drawHydro = function (win) {
    var ctx = this.ctx, p = this._pt, z = this.view.zoom, th = this.app.theme();
    var maxRank = z < 13 ? 4 : z < 22 ? 6 : z < 42 ? 8 : z < 75 ? 10 : 99;

    var lakes = geo.lakes, i, k, ring;
    ctx.fillStyle = th.water;
    for (i = 0; i < lakes.length; i++) {
      var lb = lakes[i].bbox;
      if (lb[2] < win.lon0 || lb[0] > win.lon1 || lb[3] < win.lat0 || lb[1] > win.lat1) continue;
      if (lakes[i].rank > maxRank + 2) continue;
      ring = lakes[i].w;
      ctx.beginPath();
      this.toScreen(ring[0], ring[1], p);
      ctx.moveTo(p[0], p[1]);
      for (k = 2; k < ring.length; k += 2) {
        this.toScreen(ring[k], ring[k + 1], p);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();
      ctx.fill();
    }

    var rivers = geo.rivers;
    ctx.strokeStyle = th.water;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var pass = 0; pass < 2; pass++) {
      /* Two passes so trunk rivers read heavier than their tributaries. */
      var lo = pass === 0 ? 0 : 6, hi = pass === 0 ? 5 : maxRank;
      if (lo > maxRank) break;
      ctx.lineWidth = pass === 0 ? Math.min(3.2, 0.9 + z * 0.35) : Math.min(1.8, 0.5 + z * 0.18);
      ctx.beginPath();
      for (i = 0; i < rivers.length; i++) {
        var r = rivers[i];
        if (r.rank < lo || r.rank > hi) continue;
        var b = r.bbox;
        if (b[2] < win.lon0 || b[0] > win.lon1 || b[3] < win.lat0 || b[1] > win.lat1) continue;
        var w = r.w;
        this.toScreen(w[0], w[1], p);
        ctx.moveTo(p[0], p[1]);
        for (k = 2; k < w.length; k += 2) {
          this.toScreen(w[k], w[k + 1], p);
          ctx.lineTo(p[0], p[1]);
        }
      }
      ctx.stroke();
    }
  };

  /* Wind streamlines, reusing the migration particle field. */
  Radar.prototype.drawWindFlow = function (res) {
    var ctx = this.ctx, p = this._pt;
    var win = this.visibleLonLat();
    while (this.particles.length < 340) {
      this.particles.push({
        lon: win.lon0 + Math.random() * (win.lon1 - win.lon0),
        lat: win.lat0 + Math.random() * (win.lat1 - win.lat0),
        age: Math.random() * 90
      });
    }
    ctx.lineCap = 'round';
    for (var i = 0; i < this.particles.length; i++) {
      var q = this.particles[i];
      var ci = geo.cellIndexAt(res, q.lon, q.lat);
      var dirv = this.fieldAt(q.lon, q.lat, true); var spdv = this.fieldAt(q.lon, q.lat, false); var wv = (dirv === dirv && spdv === spdv) ? [dirv, spdv] : null;
      if (!wv) { q.age = 999; }
      var dirTo = wv ? (wv[0] + 180) * Math.PI / 180 : 0;
      var spd = wv ? wv[1] : 0;
      var step = 0.004 + (spd / 40) * 0.07;
      var plon = q.lon, plat = q.lat;
      q.lat += step * Math.cos(dirTo);
      q.lon += step * Math.sin(dirTo) / Math.max(0.4, Math.cos(q.lat * Math.PI / 180));
      q.age += 1;
      if (q.age > 140 || q.lat < win.lat0 || q.lat > win.lat1 || q.lon < win.lon0 || q.lon > win.lon1) {
        q.lon = win.lon0 + Math.random() * (win.lon1 - win.lon0);
        q.lat = win.lat0 + Math.random() * (win.lat1 - win.lat0);
        q.age = 0;
        continue;
      }
      if (spd < 3) continue;
      var w0 = geo.project(plon, plat, [0, 0]), w1 = geo.project(q.lon, q.lat, [0, 0]);
      this.toScreen(w0[0], w0[1], p);
      var x0 = p[0], y0 = p[1];
      this.toScreen(w1[0], w1[1], p);
      var fade = Math.sin(Math.min(1, q.age / 140) * Math.PI);
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.10 + Math.min(0.5, spd / 45)) * fade + ')';
      ctx.lineWidth = 0.9 + Math.min(1.6, spd / 22);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
  };

  Radar.prototype.drawCounties = function (win) {
    var ctx = this.ctx, p = this._pt, cs = geo.counties;
    var z = this.view.zoom;
    ctx.beginPath();
    for (var i = 0; i < cs.length; i++) {
      var b = cs[i].bbox;
      if (b[2] < win.lon0 || b[0] > win.lon1 || b[3] < win.lat0 || b[1] > win.lat1) continue;
      var ws = cs[i].world;
      for (var r = 0; r < ws.length; r++) {
        var ring = ws[r];
        if (ring.length < 6) continue;
        this.toScreen(ring[0], ring[1], p);
        ctx.moveTo(p[0], p[1]);
        for (var k = 2; k < ring.length; k += 2) {
          this.toScreen(ring[k], ring[k + 1], p);
          ctx.lineTo(p[0], p[1]);
        }
      }
    }
    ctx.strokeStyle = this.app.theme().county;
    ctx.lineWidth = z > 50 ? 0.8 : 0.6;
    ctx.globalAlpha = Math.min(1, (z - 2.1) / 1.6);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  /* ---------- Labels ---------- */

  Radar.prototype._fits = function (x, y, w, h) {
    if (x < 2 || y < 2 || x + w > this.w - 2 || y + h > this.h - 2) return false;
    var B = this.labelBoxes;
    for (var i = 0; i < B.length; i++) {
      if (x < B[i][2] && x + w > B[i][0] && y < B[i][3] && y + h > B[i][1]) return false;
    }
    B.push([x, y, x + w, y + h]);
    return true;
  };

  Radar.prototype._label = function (text, cx, cy, font, color, halo, pad) {
    var ctx = this.ctx;
    ctx.font = font;
    var w = ctx.measureText(text).width, h = pad || 13;
    if (!this._fits(cx - w / 2 - 2, cy - h / 2, w + 4, h)) return false;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = halo;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, cx, cy);
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy);
    return true;
  };

  Radar.prototype.drawPlaceLabels = function (win, res) {
    var ctx = this.ctx, p = this._pt, z = this.view.zoom, th = this.app.theme();
    var halo = th.halo;

    /* State names carry the national view; they fade out as counties arrive. */
    if (z < 35) {
      var sa = z > 22 ? 0.35 : 0.72;
      ctx.globalAlpha = sa;
      for (var s = 0; s < geo.states.length; s++) {
        var st = geo.states[s];
        this.toScreen(st.label[0], st.label[1], p);
        if (p[0] < -60 || p[1] < -30 || p[0] > this.w + 60 || p[1] > this.h + 30) continue;
        ctx.letterSpacing = '2px';
        this._label(st.abbr, p[0], p[1], '700 ' + Math.min(26, 11 + z * 4) + 'px "Saira Condensed", sans-serif',
          th.stateLabel, halo, 18);
        ctx.letterSpacing = '0px';
      }
      ctx.globalAlpha = 1;
    }

    /* County names once the county lines are legible. */
    if (z > 42) {
      ctx.globalAlpha = 0.62;
      var cs = geo.counties;
      for (var c = 0; c < cs.length; c++) {
        var b = cs[c].bbox;
        if (b[2] < win.lon0 || b[0] > win.lon1 || b[3] < win.lat0 || b[1] > win.lat1) continue;
        this.toScreen(cs[c].label[0], cs[c].label[1], p);
        this._label(cs[c].name.toUpperCase(), p[0], p[1],
          '600 10px "Saira Condensed", sans-serif', th.countyLabel, halo, 12);
      }
      ctx.globalAlpha = 1;
    }

    /* Towns, most prominent first, each one placed only where it fits. */
    var budget = Math.max(18, Math.min(90, Math.round(this.w * this.h / 13000)));
    var showScore = z > 20;
    var cities = geo.cities, placed = 0;
    for (var i = 0; i < cities.length && placed < budget; i++) {
      var ct = cities[i];
      if (ct.lon < win.lon0 || ct.lon > win.lon1 || ct.lat < win.lat0 || ct.lat > win.lat1) continue;
      if (!ct.major && z < 17) continue;
      this.toScreen(ct.wx, ct.wy, p);
      var x = p[0], y = p[1];
      if (x < 4 || y < 4 || x > this.w - 4 || y > this.h - 4) continue;

      var val = null;
      if (showScore) {
        var ci2 = geo.cellIndexAt(res, ct.lon, ct.lat);
        var v = this.fieldAt(ct.lon, ct.lat, false);  if (v !== v) v = undefined;
        if (v !== undefined) val = Math.round(v);
      }
      var size = ct.major ? 12 : 11;
      var ok = this._label(ct.name, x, y - (val == null ? 0 : 6),
        (ct.major ? '600 ' : '500 ') + size + 'px "Public Sans", sans-serif', th.cityLabel, halo,
        val == null ? 13 : 12);
      if (!ok) continue;
      placed++;
      if (val != null) {
        ctx.font = '600 11px "IBM Plex Mono", monospace';
        ctx.lineWidth = 3;
        ctx.strokeStyle = halo;
        ctx.strokeText(String(val), x, y + 7);
        ctx.fillStyle = radarCSSForValue(val);
        ctx.fillText(String(val), x, y + 7);
      }
      ctx.beginPath();
      ctx.arc(x, y - (val == null ? 8 : 15), 1.7, 0, Math.PI * 2);
      ctx.fillStyle = th.cityLabel;
      ctx.fill();
    }
  };

  /* ---------- Map chrome ---------- */

  /* Thin crosshair ticks instead of a full graticule: enough to register as a
     surveyed surface without drawing a cage over the data. */
  Radar.prototype.drawGraticule = function () {
    var ctx = this.ctx, th = this.app.theme(), p = this._pt;
    var z = this.view.zoom;
    var stepDeg = z < 10 ? 10 : z < 25 ? 5 : z < 67 ? 2 : z < 167 ? 1 : 0.5;
    var win = this.visibleLonLat();
    ctx.save();
    ctx.strokeStyle = th.graticule;
    ctx.lineWidth = 1;
    var lo0 = Math.ceil(win.lon0 / stepDeg) * stepDeg;
    var la0 = Math.ceil(win.lat0 / stepDeg) * stepDeg;
    for (var lon = lo0; lon <= win.lon1; lon += stepDeg) {
      for (var lat = la0; lat <= win.lat1; lat += stepDeg) {
        geo.project(lon, lat, p);
        this.toScreen(p[0], p[1], p);
        if (p[0] < 0 || p[1] < 0 || p[0] > this.w || p[1] > this.h) continue;
        ctx.beginPath();
        ctx.moveTo(p[0] - 5, p[1]); ctx.lineTo(p[0] + 5, p[1]);
        ctx.moveTo(p[0], p[1] - 5); ctx.lineTo(p[0], p[1] + 5);
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  function dms(v, posChar, negChar) {
    var sign = v < 0 ? negChar : posChar;
    v = Math.abs(v);
    var d = Math.floor(v), m = Math.floor((v - d) * 60), s = Math.round((((v - d) * 60) - m) * 60);
    if (s === 60) { s = 0; m++; }
    if (m === 60) { m = 0; d++; }
    return d + '° ' + (m < 10 ? '0' : '') + m + "' " + (s < 10 ? '0' : '') + s + '" ' + sign;
  }

  /* Rotated coordinate readout down the right edge. */
  Radar.prototype.drawEdgeCoords = function () {
    var c = this.lonLatAt(this.w / 2, this.h / 2);
    if (!isFinite(c[0])) return;
    var ctx = this.ctx, th = this.app.theme();
    ctx.save();
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    ctx.fillStyle = th.micro;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.translate(this.w - 10, this.h * 0.30);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(dms(c[1], 'N', 'S'), 0, 0);
    ctx.restore();
    ctx.save();
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    ctx.fillStyle = th.micro;
    ctx.textAlign = 'center';
    ctx.translate(this.w - 10, this.h * 0.62);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(dms(c[0], 'E', 'W'), 0, 0);
    ctx.restore();
  };

  /* Where the device says you are. */
  Radar.prototype.drawUserLocation = function () {
    var g = this.app.state.gps;
    if (!g) return;
    var ctx = this.ctx, p = this._pt;
    geo.project(g.lon, g.lat, p);
    this.toScreen(p[0], p[1], p);
    if (p[0] < -50 || p[1] < -50 || p[0] > this.w + 50 || p[1] > this.h + 50) return;

    if (g.accuracy) {
      /* Accuracy circle, in real metres rather than a fixed pixel radius. */
      var mPerPx = this.metresPerPixel(g.lat);
      var rad = g.accuracy / mPerPx;
      if (rad > 6 && rad < 2000) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(198,242,78,0.12)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(198,242,78,0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.arc(p[0], p[1], 7, 0, Math.PI * 2);
    ctx.fillStyle = '#C6F24E';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(12,16,12,0.9)';
    ctx.stroke();
  };

  Radar.prototype.metresPerPixel = function (lat) {
    return (40075016.686 * Math.cos(lat * Math.PI / 180) / geo.WORLD) / this.view.zoom;
  };

  /* The legend goes full width at phone sizes, so map chrome lifts above it. */
  Radar.prototype.bottomPad = function () { return this.w < 720 ? 104 : 16; };

  /* How far in from the right the canvas-drawn chrome has to start so it
     clears the legend. Measured from the live element rather than
     hard-coded, because the legend's width changes with the layer. */
  Radar.prototype.rightInset = function () {
    if (this.w < 720) return 16;            // legend is full width down there
    var lg = document.getElementById('legend');
    return lg ? lg.offsetWidth + 24 : 24;
  };

  Radar.prototype.drawScaleBar = function () {
    var ctx = this.ctx, th = this.app.theme();
    var a = this.lonLatAt(this.w - 150, this.h - 30);
    var b = this.lonLatAt(this.w - 50, this.h - 30);
    if (!isFinite(a[0]) || !isFinite(b[0])) return;
    var R = 3958.8;                               // Earth radius in miles
    var dLat = (b[1] - a[1]) * Math.PI / 180;
    var dLon = (b[0] - a[0]) * Math.PI / 180;
    var mLat = (a[1] + b[1]) / 2 * Math.PI / 180;
    var milesPer100px = R * Math.sqrt(dLat * dLat + Math.pow(dLon * Math.cos(mLat), 2));
    if (!(milesPer100px > 0)) return;

    /* Reaches down to a hundred feet, because the map now zooms that far. */
    var steps = [0.0189, 0.0379, 0.0947, 0.189, 0.379, 0.947,
                 1, 2, 5, 10, 25, 50, 100, 200, 500, 1000];
    var target = milesPer100px * 1.2, pick = steps[0];
    for (var i = 0; i < steps.length; i++) if (steps[i] <= target) pick = steps[i];
    var px = pick / milesPer100px * 100;
    var label = pick < 1 ? Math.round(pick * 5280) + ' ft' : pick + ' mi';

    var x1 = this.w - this.rightInset(), x0 = x1 - px, y = this.h - this.bottomPad();
    ctx.save();
    ctx.strokeStyle = th.halo;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    ctx.moveTo(x0, y - 4); ctx.lineTo(x0, y + 4);
    ctx.moveTo(x1, y - 4); ctx.lineTo(x1, y + 4);
    ctx.stroke();
    ctx.strokeStyle = th.label;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.font = '600 10.5px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = th.halo;
    ctx.strokeText(label, x1, y - 6);
    ctx.fillStyle = th.label;
    ctx.fillText(label, x1, y - 6);
    ctx.restore();
  };

  Radar.prototype.drawWhereAmI = function () {
    if (this.view.zoom < 18) return;
    var ll = this.lonLatAt(this.w / 2, this.h / 2);
    if (!isFinite(ll[0])) return;
    var key = ll[0].toFixed(2) + ',' + ll[1].toFixed(2);
    if (!this._centerCache || this._centerCache.key !== key) {
      var co = geo.countyAt(ll[0], ll[1]);
      this._centerCache = {
        key: key,
        text: co ? co.name + ' County, ' + co.stateAbbr : null
      };
    }
    var text = this._centerCache.text;
    if (!text) return;
    var ctx = this.ctx, th = this.app.theme();
    ctx.save();
    ctx.font = '600 11.5px "Saira Condensed", sans-serif';
    ctx.letterSpacing = '1.5px';
    var w = ctx.measureText(text).width;
    var x = this.w - this.rightInset() - w, y = this.h - this.bottomPad() - 22;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = th.halo;
    ctx.strokeText(text.toUpperCase(), x, y);
    ctx.fillStyle = th.label;
    ctx.fillText(text.toUpperCase(), x, y);
    ctx.letterSpacing = '0px';
    ctx.restore();
  };

  /* Particle field showing expected direction of movement, not tracked birds. */
  Radar.prototype.drawMigration = function (res) {
    var ctx = this.ctx, p = this._pt, self = this;
    if (this.particles.length < 320) {
      var win = this.visibleLonLat();
      while (this.particles.length < 320) {
        this.particles.push({
          lon: win.lon0 + Math.random() * (win.lon1 - win.lon0),
          lat: win.lat0 + Math.random() * (win.lat1 - win.lat0),
          age: Math.random() * 90
        });
      }
    }
    var win2 = this.visibleLonLat();
    ctx.lineCap = 'round';
    for (var i = 0; i < this.particles.length; i++) {
      var q = this.particles[i];
      var ci = geo.cellIndexAt(res, q.lon, q.lat);
      var inten = this.fieldAt(q.lon, q.lat, false); if (inten !== inten) inten = 0;
      if (inten === undefined) inten = 0;
      var fw = geo.flyway(q.lon);
      var br = (geo.UPFLYWAY[fw] + 180) * Math.PI / 180;
      var sp = 0.004 + (inten / 100) * 0.055;
      var plon = q.lon, plat = q.lat;
      q.lat += sp * Math.cos(br);
      q.lon += sp * Math.sin(br) / Math.max(0.4, Math.cos(q.lat * Math.PI / 180));
      q.age += 1;
      if (q.age > 150 || q.lat < win2.lat0 || q.lat > win2.lat1 || q.lon < win2.lon0 || q.lon > win2.lon1) {
        q.lon = win2.lon0 + Math.random() * (win2.lon1 - win2.lon0);
        q.lat = win2.lat0 + Math.random() * (win2.lat1 - win2.lat0);
        q.age = 0;
        continue;
      }
      if (inten < 32) continue;
      var w0 = geo.project(plon, plat, [0, 0]), w1 = geo.project(q.lon, q.lat, [0, 0]);
      this.toScreen(w0[0], w0[1], p);
      var x0 = p[0], y0 = p[1];
      this.toScreen(w1[0], w1[1], p);
      var fade = Math.sin(Math.min(1, q.age / 150) * Math.PI);
      ctx.strokeStyle = 'rgba(246,238,214,' + (0.16 + (inten / 100) * 0.55) * fade + ')';
      ctx.lineWidth = 1 + (inten / 100) * 1.6;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(p[0], p[1]);
      ctx.stroke();
    }
  };

  Radar.prototype.drawSpots = function () {
    var app = this.app, ctx = this.ctx, p = this._pt;
    var spots = app.state.spots;
    if (!spots.length) return;
    var day = app.state.t;
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      var w = geo.project(s.lon, s.lat, [0, 0]);
      this.toScreen(w[0], w[1], p);
      if (p[0] < -40 || p[1] < -40 || p[0] > this.w + 40 || p[1] > this.h + 40) continue;
      var sc = app.spotScore(s, day);
      var r = 15;
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fillStyle = rampCSS(sc.opp / 100, 0.95);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(12,18,16,0.85)';
      ctx.stroke();
      ctx.fillStyle = sc.opp > 62 ? '#101715' : '#F2F7F3';
      ctx.font = '700 12px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sc.opp, p[0], p[1] + 0.5);
      if (this.view.zoom > 20) {
        ctx.font = '600 11px "Saira Condensed", sans-serif';
        ctx.fillStyle = this.app.theme().label;
        ctx.textBaseline = 'top';
        ctx.fillText(s.name, p[0], p[1] + r + 4);
      }
    }
  };

  Radar.prototype.drawSelection = function () {
    var sel = this.app.state.selection;
    if (!sel) return;
    var ctx = this.ctx, p = this._pt;
    var w = geo.project(sel.lon, sel.lat, [0, 0]);
    this.toScreen(w[0], w[1], p);
    ctx.save();
    ctx.strokeStyle = '#E8A93A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p[0], p[1], 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p[0] - 19, p[1]); ctx.lineTo(p[0] - 13, p[1]);
    ctx.moveTo(p[0] + 13, p[1]); ctx.lineTo(p[0] + 19, p[1]);
    ctx.moveTo(p[0], p[1] - 19); ctx.lineTo(p[0], p[1] - 13);
    ctx.moveTo(p[0], p[1] + 13); ctx.lineTo(p[0], p[1] + 19);
    ctx.stroke();
    ctx.restore();
  };

  Radar.prototype.drawLockHint = function () {
    var ctx = this.ctx, ent = this.app.entitlement();
    var txt = 'Preview outside ' + ent.stateName + ' + ' + this.app.speciesName(ent.species);
    ctx.save();
    ctx.font = '600 11px "Saira Condensed", sans-serif';
    var w = ctx.measureText(txt).width + 22;
    ctx.fillStyle = 'rgba(12,19,17,0.72)';
    ctx.strokeStyle = 'rgba(232,169,58,0.5)';
    ctx.lineWidth = 1;
    var x = (this.w - w) / 2, y = this.h - this.bottomPad() - 58;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, 24, 12); else ctx.rect(x, y, w, 24);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#E8A93A';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, x + w / 2, y + 12);
    ctx.restore();
  };

  global.OG.radar = {
    WX_LAYERS: WX_LAYERS,
    Radar: Radar, rampCSS: rampCSS, rampRGB: rampRGB,
    clearScores: clearScores, STATUS_COLOR: STATUS_COLOR
  };
})(window);
