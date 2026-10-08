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

  /* HOW MUCH A SIGHTING MATTERS, PER SPECIES.

     The number is the share of suitability a cell keeps where nothing
     of that species has ever been recorded. High means trust the
     ground; low means trust the records.

     It cannot be one value. Turkey has nine thousand records and cover
     that looks plausible across half the country, so land cover on its
     own proves nothing and the toe has to be near zero. A duck in the
     Deep South has diagnostic cover and thin records, so it needs
     slack or Mississippi blanks in the middle of the flyway. Elk needs
     slack for the opposite reason - the reintroduced herds in Arkansas
     and Kentucky are real and barely recorded.

     Tuned against tools/validate.js. Change a number, reload, re-run
     the validator - no rebuild. */
  var PRESENCE_TOE = {
    turkey:    0.00,   // ubiquitous cover, abundant records
    whitetail: 0.00,   // same
    upland:    0.02,
    muledeer:  0.03,
    moose:     0.03,
    pronghorn: 0.04,
    elk:       0.10,   // reintroduced herds are thinly recorded
    waterfowl: 0.16,   // water is diagnostic; southern records are thin
    trout:     0.30    // a 20 m stream is invisible to a 30 m raster
  };
  var TOE_DEFAULT = 0.05;

  var presPlanes = {};

  function presenceAt(sp, lon, lat) {
    if (!raw || !raw.presence || !raw.presence.sp[sp]) return null;
    var PG = raw.presence.grid;
    var p = presPlanes[sp];
    if (p === undefined) {
      try {
        var bin = global.atob(raw.presence.sp[sp]);
        var a2 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) a2[i] = bin.charCodeAt(i);
        p = a2;
      } catch (e) { p = null; }
      presPlanes[sp] = p;
    }
    if (!p) return null;
    var ix = Math.floor((lon - PG.lon0) / PG.d), iy = Math.floor((lat - PG.lat0) / PG.d);
    if (ix < 0 || iy < 0 || ix >= PG.nlon || iy >= PG.nlat) return null;
    return p[iy * PG.nlon + ix] / 255;
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
    var suit = (top * (1 - ty) + bot * ty) / 255;

    /* Combine with presence here rather than at build time. */
    var pres = presenceAt(sp, lon, lat);
    if (pres == null) return suit;
    var toe = PRESENCE_TOE[sp] == null ? TOE_DEFAULT : PRESENCE_TOE[sp];
    return suit * (toe + (1 - toe) * pres);
  }

  /* ---------- elevation ----------

     Same grid, separate file, because elevation is wanted by callers that
     do not care about habitat - the lapse correction applied to every
     forecast readout, most of all. env.js used eleven hand-drawn Gaussian
     mountain ranges before this, which made a wrong elevation into a wrong
     temperature everywhere. */

  var eraw = global.US_ELEV || null;
  var EG = eraw ? eraw.grid : null;
  var ePlanes = {};

  function b64(name) {
    if (!eraw || !eraw[name]) return null;
    var p = ePlanes[name];
    if (p !== undefined) return p;
    try {
      var bin = global.atob(eraw[name]);
      var a = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      p = a;
    } catch (e) { p = null; }
    ePlanes[name] = p;
    return p;
  }

  /* Bilinear over covered cells only. Interpolating a coastal cell against
     an all-zero ocean cell would drag the shoreline below sea level. */
  function elevSample(name, lon, lat) {
    if (!EG) return null;
    var a = b64(name), cov = b64('covered');
    if (!a || !cov) return null;

    var fx = (lon - EG.lon0) / EG.d - 0.5;
    var fy = (lat - EG.lat0) / EG.d - 0.5;
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= EG.nlon || y0 + 1 >= EG.nlat) return null;
    var tx = fx - x0, ty = fy - y0;

    var idx = [y0 * EG.nlon + x0, y0 * EG.nlon + x0 + 1,
               (y0 + 1) * EG.nlon + x0, (y0 + 1) * EG.nlon + x0 + 1];
    var wt = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
    var s = 0, w = 0;
    for (var i = 0; i < 4; i++) {
      if (!cov[idx[i]]) continue;
      s += a[idx[i]] * wt[i]; w += wt[i];
    }
    if (w < 0.001) return null;
    return (s / w) * eraw.stepFt;
  }

  /* ---------- derived surfaces ----------

     Three things that used to be hand-set numbers and are now measured
     from the same downloads the habitat surfaces come from. Each returns
     null when its plane is absent, and every caller keeps its old path
     as the fallback - a missing field must not read as a real zero. */

  var pressPlane = undefined;

  /* Hunting pressure from developed land cover, in place of a list of
     metro blobs with hand-set weights. */
  function pressureAt(lon, lat) {
    if (!raw || !raw.pressure || !G) return null;
    if (pressPlane === undefined) {
      try {
        var bin = global.atob(raw.pressure);
        var a = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
        pressPlane = a;
      } catch (e) { pressPlane = null; }
    }
    if (!pressPlane) return null;
    var ix = Math.floor((lon - G.lon0) / G.d), iy = Math.floor((lat - G.lat0) / G.d);
    if (ix < 0 || iy < 0 || ix >= G.nlon || iy >= G.nlat) return null;
    return pressPlane[iy * G.nlon + ix] / 255;
  }

  /* ---------- migration chronology ----------

     Occurrence counts by latitude band and calendar month. Raw counts
     carry the seasonality of the people doing the recording as much as
     the birds - there are far more observers afield in May than in
     January - so each species is taken as a share of all recorded game
     species in the same band and month, which cancels most of it. The
     same trick the habitat presence gate uses.

     Returns a peak day of year and a width in days, fitted as a circular
     mean and spread over the twelve monthly shares, so it slots straight
     into the Gaussian the migration engine already uses. */

  var chronCache = {};

  function chronology(taxa, lat) {
    if (!raw || !raw.chronology || !raw.chronology.sp) return null;
    var C = raw.chronology;
    if (!taxa || !taxa.length) return null;

    var band = Math.floor((lat - C.lat0) / C.bandDeg);
    if (band < 0) band = 0;
    if (band >= C.bands) band = C.bands - 1;

    var key = taxa.join('+') + ':' + band;
    if (chronCache[key] !== undefined) return chronCache[key];

    /* Effort denominator: everything recorded in this band and month. */
    var share = [], total = 0;
    for (var m = 0; m < 12; m++) {
      var mine = 0, all = 0;
      for (var k in C.sp) {
        if (!Object.prototype.hasOwnProperty.call(C.sp, k)) continue;
        all += C.sp[k][band * 12 + m] || 0;
      }
      for (var j = 0; j < taxa.length; j++) {
        var row = C.sp[taxa[j]];
        if (row) mine += row[band * 12 + m] || 0;
      }
      var v = all > 0 ? mine / all : 0;
      share.push(v); total += v;
    }
    /* Too thin to say anything. */
    if (total <= 0) { chronCache[key] = null; return null; }

    /* Circular mean over the year, so a December peak does not average
       with a January one to produce June. */
    var sx = 0, sy = 0;
    for (var i = 0; i < 12; i++) {
      var ang = (i + 0.5) / 12 * 2 * Math.PI;
      sx += share[i] * Math.cos(ang);
      sy += share[i] * Math.sin(ang);
    }
    var R = Math.sqrt(sx * sx + sy * sy) / total;
    var mean = Math.atan2(sy, sx);
    if (mean < 0) mean += 2 * Math.PI;
    var peakDoy = mean / (2 * Math.PI) * 365.25;

    /* Circular standard deviation, converted to days. R near 1 means the
       species is tightly seasonal here; R near 0 means it is present all
       year and the peak means little. */
    var spread = R > 0.001 ? Math.sqrt(-2 * Math.log(Math.min(1, R))) : 3;
    var widthDays = Math.max(18, Math.min(120, spread / (2 * Math.PI) * 365.25));

    var out = { peakDoy: peakDoy, widthDays: widthDays, concentration: R, months: share };
    chronCache[key] = out;
    return out;
  }

  /* ---------- group composition ----------

     Share of each taxon within its group. The decoy advice used to name
     pintails wherever the season was open and the habitat was decent;
     near the Bighorn the records run 5514 mallard and 1056 goldeneye
     against 279 pintail. */

  var compPlanes = {};

  function composition(group, lon, lat) {
    if (!raw || !raw.composition || !raw.composition.sp) return null;
    var grp = raw.composition.sp[group];
    if (!grp) return null;
    var CG = raw.composition.grid;
    var ix = Math.floor((lon - CG.lon0) / CG.d), iy = Math.floor((lat - CG.lat0) / CG.d);
    if (ix < 0 || iy < 0 || ix >= CG.nlon || iy >= CG.nlat) return null;
    var k = iy * CG.nlon + ix;

    var out = [], any = false;
    for (var tx in grp) {
      if (!Object.prototype.hasOwnProperty.call(grp, tx)) continue;
      var key = group + ':' + tx;
      if (compPlanes[key] === undefined) {
        try {
          var bin = global.atob(grp[tx]);
          var a = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
          compPlanes[key] = a;
        } catch (e) { compPlanes[key] = null; }
      }
      var p = compPlanes[key];
      if (!p) continue;
      var sh = p[k] / 255;
      if (sh > 0) any = true;
      out.push({ taxon: tx, share: sh });
    }
    if (!any) return null;
    out.sort(function (a, b) { return b.share - a.share; });
    return out;
  }

  global.OG = global.OG || {};
  global.OG.habgrid = {
    at: at, presenceAt: presenceAt, PRESENCE_TOE: PRESENCE_TOE,
    ready: !!G,
    meta: raw ? { source: raw.source, note: raw.note, built: raw.built, d: raw.grid.d } : null,

    elevReady: !!EG,
    elevFt: function (lon, lat) { return elevSample('mean', lon, lat); },
    reliefFt: function (lon, lat) { return elevSample('relief', lon, lat); },
    elevMeta: eraw ? { source: eraw.source, note: eraw.note, built: eraw.built } : null,

    pressureAt: pressureAt,
    pressureReady: !!(raw && raw.pressure),
    chronology: chronology,
    chronReady: !!(raw && raw.chronology && raw.chronology.sp),
    composition: composition,
    compReady: !!(raw && raw.composition && raw.composition.sp)
  };
})(window);
