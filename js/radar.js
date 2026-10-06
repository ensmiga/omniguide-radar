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
    if (!this.fitted) { this.fit(); this.fitted = true; }
  };

  Radar.prototype.fit = function (pad) {
    pad = pad || 28;
    var z = Math.min((this.w - pad * 2) / geo.WORLD_W, (this.h - pad * 2 - 40) / geo.WORLD_H);
    this.view.zoom = z;
    this.view.cx = geo.WORLD_W / 2;
    this.view.cy = geo.WORLD_H / 2;
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

  Radar.prototype.resolution = function () {
    var z = this.view.zoom;
    if (z < 1.8) return 0;
    if (z < 3.1) return 1;
    if (z < 5.2) return 2;
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

  Radar.prototype.draw = function () {
    var app = this.app, ctx = this.ctx, theme = app.theme();
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = theme.mapBg;
    ctx.fillRect(0, 0, this.w, this.h);

    this.drawLand(theme.land, null, 0);

    var res = this.resolution();
    var win = this.visibleLonLat();
    var t = app.state.t;
    /* App time is quantised to the forecast's own 3-hour step (see STEP_T in
       app.js), so there is nothing to cross-fade: the map draws the score at
       exactly the instant the panel computes it. Blending between two cached
       snapshots is what used to make the hexagon and the plan disagree -
       lerping two scores is not the same as scoring the midpoint, because
       everything between the conditions and the final number is non-linear. */
    var tq0 = t, tq1 = t, f = 0;
    var spId = app.state.species;
    var layer = app.state.layer;
    var day = Math.floor(t);
    var ent = app.entitlement();
    var self = this;
    var p = this._pt, verts = new Float32Array(12);
    var closed = 0, lockedCount = 0;
    var cellPx = geo.RES[res] * (geo.WORLD_H / 25.4) * this.view.zoom;
    var showNums = cellPx > 26;

    this.frameCells.clear();
    this.frameVal.clear();
    this.frameWind.clear();
    this.labelBoxes.length = 0;
    ctx.lineJoin = 'round';

    geo.forEachCell(res, win.lon0, win.lat0, win.lon1, win.lat1, function (lon, lat, j, i) {
      var si = landFor(res, j, i, lon, lat);
      if (si < 0) return;
      var st = geo.states[si];

      var wxl = WX_LAYERS[layer] || null;
      var val, wxNow = null;

      if (wxl) {
        /* Weather layers are species independent and read straight from the
           interpolated forecast rather than from the opportunity models. */
        var w0 = wxAt(res, j, i, lon, lat, tq0);
        var w1 = tq1 === tq0 ? w0 : wxAt(res, j, i, lon, lat, tq1);
        wxNow = w0;
        var raw = wxl.get(w0) + (wxl.get(w1) - wxl.get(w0)) * f;
        val = raw;
        self.frameVal.set(j + ':' + i, raw);
        self.frameWind.set(j + ':' + i, [w0.windFrom, w0.windSpd]);
      } else {
        var s0 = scoresAt(res, j, i, lon, lat, spId, tq0);
        /* Out of range, or no season record in this state: the ground stays
           blank. A faint score here would be worse than nothing. */
        if (!s0[5] || !regs.hasSeasonRecord(st.abbr, spId)) {
          ctx.fillStyle = theme.outRange;
          ctx.fill();
          return;
        }
        var idx = layer === 'movement' ? 1 : layer === 'migration' ? 2 :
                  layer === 'newbird' ? 3 : layer === 'confidence' ? 4 : 0;
        val = s0[idx];
        self.frameCells.set(j + ':' + i, s0[2]);
        self.frameVal.set(j + ':' + i, s0[0]);
      }

      var hx = hexFor(res, j, i, lon, lat);
      ctx.beginPath();
      self.toScreen(hx[0], hx[1], p);
      ctx.moveTo(p[0], p[1]);
      for (var k = 2; k < 12; k += 2) {
        self.toScreen(hx[k], hx[k + 1], p);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();

      /* Weather is not a species entitlement; it is open to everyone. */
      var unlocked = wxl ? true : (ent.pro || (ent.state === st.abbr && ent.species === spId));
      if (!unlocked) {
        ctx.fillStyle = 'rgba(120,134,140,' + (0.10 + val / 100 * 0.17) + ')';
        ctx.fill();
        lockedCount++;
        return;
      }

      if (wxl) {
        var cw = wxl.ramp((val - wxl.min) / (wxl.max - wxl.min));
        ctx.fillStyle = 'rgba(' + cw[0] + ',' + cw[1] + ',' + cw[2] + ',' +
          (layer === 'precip' || layer === 'snowpack'
            ? (0.12 + 0.78 * Math.min(1, Math.max(0, (val - wxl.min) / (wxl.max - wxl.min)) * 2.2))
            : 0.82) + ')';
        ctx.fill();
        if (showNums) {
          ctx.fillStyle = 'rgba(248,250,248,0.92)';
          ctx.font = '600 ' + Math.min(14, Math.max(9, cellPx * 0.38)) + 'px "IBM Plex Mono", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          geo.project(lon, lat, verts);
          self.toScreen(verts[0], verts[1], p);
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = 'rgba(10,16,14,0.55)';
          var txt = wxl.digits ? val.toFixed(wxl.digits) : String(Math.round(val));
          ctx.strokeText(txt, p[0], p[1]);
          ctx.fillText(txt, p[0], p[1]);
        }
        return;
      }

      var status = legalAt(lon, lat, spId, day);

      if (layer === 'legal') {
        ctx.fillStyle = STATUS_COLOR[status] || STATUS_COLOR.UNKNOWN;
        ctx.fill();
        return;
      }

      var legalOk = status === 'OPEN' || status === 'LIMITED';
      if (app.state.legalOverlay && !legalOk) {
        /* Biology stays visible, but muted, and never reads as a legal hunt. */
        var c = rampRGB(val / 100);
        var g = (c[0] * 0.3 + c[1] * 0.5 + c[2] * 0.2);
        ctx.fillStyle = 'rgba(' + Math.round((c[0] + g * 1.6) / 2.6) + ',' +
          Math.round((c[1] + g * 1.6) / 2.6) + ',' + Math.round((c[2] + g * 1.6) / 2.6) + ',0.40)';
        ctx.fill();
        closed++;
        ctx.fillStyle = self.hatch;
        ctx.globalAlpha = status === 'UNKNOWN' ? 0.25 : 0.45;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = rampCSS(val / 100, 0.84);
        ctx.fill();
        if (layer === 'confidence' && val < 55) {
          ctx.fillStyle = self.hatch;
          ctx.globalAlpha = 0.22;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      if (showNums) {
        ctx.fillStyle = val > 62 ? 'rgba(14,20,18,0.86)' : 'rgba(236,243,238,0.90)';
        ctx.font = '600 ' + Math.min(15, Math.max(9, cellPx * 0.42)) + 'px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        geo.project(lon, lat, verts);
        self.toScreen(verts[0], verts[1], p);
        ctx.fillText(Math.round(val), p[0], p[1]);
      }
    });

    /* Reference geography over the heat, fine detail first so the heavier
       state lines read as the stronger boundary. */
    this.drawHydro(win);
    if (this.view.zoom > 2.1) this.drawCounties(win);
    this.drawLand(null, theme.border, this.view.zoom > 3 ? 1.2 : 0.8);

    if (layer === 'migration') this.drawMigration(res);
    if (layer === 'wind' || layer === 'gusts') this.drawWindFlow(res);
    this.drawPlaceLabels(win, res);
    this.drawSpots();
    this.drawSelection();
    this.drawScaleBar();
    this.drawWhereAmI();

    if (lockedCount && !ent.pro) this.drawLockHint();
  };

  /* ---------- Reference geography ---------- */

  /* Rivers and lakes. For a waterfowl product the water is not decoration -
     it is the thing being hunted, so it draws over the heat, not under it. */
  Radar.prototype.drawHydro = function (win) {
    var ctx = this.ctx, p = this._pt, z = this.view.zoom, th = this.app.theme();
    var maxRank = z < 1.5 ? 4 : z < 2.6 ? 6 : z < 5 ? 8 : z < 9 ? 10 : 99;

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
      var wv = this.frameWind.get(ci[0] + ':' + ci[1]);
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
    ctx.lineWidth = z > 6 ? 0.8 : 0.6;
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
    if (z < 4.2) {
      var sa = z > 2.6 ? 0.35 : 0.72;
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
    if (z > 5) {
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
    var showScore = z > 2.4;
    var cities = geo.cities, placed = 0;
    for (var i = 0; i < cities.length && placed < budget; i++) {
      var ct = cities[i];
      if (ct.lon < win.lon0 || ct.lon > win.lon1 || ct.lat < win.lat0 || ct.lat > win.lat1) continue;
      if (!ct.major && z < 2.0) continue;
      this.toScreen(ct.wx, ct.wy, p);
      var x = p[0], y = p[1];
      if (x < 4 || y < 4 || x > this.w - 4 || y > this.h - 4) continue;

      var val = null;
      if (showScore) {
        var ci2 = geo.cellIndexAt(res, ct.lon, ct.lat);
        var v = this.frameVal.get(ci2[0] + ':' + ci2[1]);
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

  /* The legend goes full width at phone sizes, so map chrome lifts above it. */
  Radar.prototype.bottomPad = function () { return this.w < 720 ? 104 : 16; };

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

    var steps = [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000];
    var target = milesPer100px * 1.2, pick = steps[0];
    for (var i = 0; i < steps.length; i++) if (steps[i] <= target) pick = steps[i];
    var px = pick / milesPer100px * 100;

    var x1 = this.w - 16, x0 = x1 - px, y = this.h - this.bottomPad();
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
    ctx.strokeText(pick + ' mi', x1, y - 6);
    ctx.fillStyle = th.label;
    ctx.fillText(pick + ' mi', x1, y - 6);
    ctx.restore();
  };

  Radar.prototype.drawWhereAmI = function () {
    if (this.view.zoom < 2.1) return;
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
    var x = this.w - 16 - w, y = this.h - this.bottomPad() - 22;
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
      var inten = this.frameCells.get(ci[0] + ':' + ci[1]);
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
      if (this.view.zoom > 2.4) {
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
