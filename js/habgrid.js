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

  /* ---------- in range, or not ----------

     What an occurrence record can say is that the animal is here. It
     cannot say how good here is, and it was being asked to: the
     presence value multiplied straight into habitat, so a place scored
     by how often someone had photographed a deer in it. Measured on
     whitetail, the Austin and Washington suburbs read 0.94; Pike County,
     Illinois read 0.25 and south-east Kansas 0.00, which blanked it.
     For elk the Selway and the Bob Marshall read zero and Estes Park
     0.67. That is a map of people.

     So presence is now a gate. Land cover and elevation say how good a
     place is; the records only say whether the species is in range,
     and there are two ways to be in range:

     RECORDED HERE. Presence over a low knee counts in full. For the
     birds this is the whole test - there are millions of records, and
     turkey reads exactly zero at every desert point checked and above
     zero at every real one.

     ESTABLISHED ALL ROUND. For the mammals and for trout the records
     are too thin for that, so ground with none of its own still counts
     where enough of the country around it has some: the share of land
     cells within about 140 km carrying any record. Continuous elk
     range reads 0.40 to 0.92 on that measure, the Selway included; an
     isolated eastern herd reads 0.10 to 0.24 at its centre, and ground
     with no elk reads 0.00 to 0.02. Each pair of numbers below is where
     that share starts to count and where it counts in full, set between
     the measured values for real range and for absence.

     An isolated herd therefore shows as its own records and no
     further, which is what a reintroduced herd is, and the Rockies
     show as habitat rather than as a scatter of trailheads.

     What this cannot find is a herd nobody has logged under an open
     licence: the Cimarron grassland elk and the north-west Minnesota
     herd have no records at all and stay blank. */
  var RANGE_KNEE = {
    elk: 0.50, moose: 0.50, whitetail: 0.25, muledeer: 0.25, pronghorn: 0.25,
    turkey: 0.10, upland: 0.15, waterfowl: 0.10, trout: 0.25
  };
  var RANGE_REGION = {
    elk:       [0.30, 0.50],   // high, to keep the eastern herds as islands
    moose:     [0.45, 0.70],   // sagebrush is not willow; at 0.18 this had moose over 83% of Wyoming
    whitetail: [0.30, 0.50],   // Coues deer country must not open the Sonoran floor
    muledeer:  [0.05, 0.25],
    pronghorn: [0.15, 0.35],   // at 0.05 this covered 96% of Arizona
    trout:     [0.35, 0.60]
  };
  var REGION_R = 5, REGION_ANY = 5;      // cells either way; stored value that counts as a record
  var regionPlanes = {};

  function regionalAt(sp, lon, lat) {
    if (presenceAt(sp, lon, lat) == null) return null;
    var PG = raw.presence.grid, p = presPlanes[sp];
    var r = regionPlanes[sp];
    if (r === undefined) {
      var nx = PG.nlon, ny = PG.nlat, n = nx * ny;
      /* Land is wherever the elevation build found ground, so that a
         coast is not marked down for the sea beside it. */
      var cov = b64('covered'), land = new Uint8Array(n);
      for (var y = 0; y < ny; y++) {
        for (var x = 0; x < nx; x++) {
          var ok = 1;
          if (cov && EG) {
            var ex = Math.floor((PG.lon0 + (x + 0.5) * PG.d - EG.lon0) / EG.d);
            var ey = Math.floor((PG.lat0 + (y + 0.5) * PG.d - EG.lat0) / EG.d);
            ok = (ex >= 0 && ey >= 0 && ex < EG.nlon && ey < EG.nlat && cov[ey * EG.nlon + ex]) ? 1 : 0;
          }
          land[y * nx + x] = ok;
        }
      }
      var hs = new Float32Array(n), hc = new Float32Array(n);
      for (var y1 = 0; y1 < ny; y1++) {
        for (var x1 = 0; x1 < nx; x1++) {
          var sv = 0, sc = 0;
          for (var d = -REGION_R; d <= REGION_R; d++) {
            var xx = x1 + d;
            if (xx < 0 || xx >= nx || !land[y1 * nx + xx]) continue;
            if (p[y1 * nx + xx] > REGION_ANY) sv++;
            sc++;
          }
          hs[y1 * nx + x1] = sv; hc[y1 * nx + x1] = sc;
        }
      }
      r = new Float32Array(n);
      for (var y2 = 0; y2 < ny; y2++) {
        for (var x2 = 0; x2 < nx; x2++) {
          var tv = 0, tc = 0;
          for (var e = -REGION_R; e <= REGION_R; e++) {
            var yy = y2 + e;
            if (yy < 0 || yy >= ny) continue;
            tv += hs[yy * nx + x2]; tc += hc[yy * nx + x2];
          }
          r[y2 * nx + x2] = tc > 0 ? tv / tc : 0;
        }
      }
      regionPlanes[sp] = r;
    }
    var ix = Math.floor((lon - PG.lon0) / PG.d), iy = Math.floor((lat - PG.lat0) / PG.d);
    return r[iy * PG.nlon + ix];
  }

  /* 0 out of range, 1 in it. */
  function rangeAt(sp, lon, lat) {
    var pres = presenceAt(sp, lon, lat);
    if (pres == null) return null;
    var knee = RANGE_KNEE[sp] == null ? 0.25 : RANGE_KNEE[sp];
    var here = pres >= knee ? 1 : pres / knee;
    var band = RANGE_REGION[sp];
    if (!band || here >= 1) return here;
    var share = regionalAt(sp, lon, lat);
    var round = share <= band[0] ? 0 : share >= band[1] ? 1 : (share - band[0]) / (band[1] - band[0]);
    return here > round ? here : round;
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
    var inRange = rangeAt(sp, lon, lat);
    return inRange == null ? suit : suit * inRange;
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

     When birds arrive at a latitude in autumn, read from the records.

     The plane carries exact GBIF counts by two-degree latitude band and
     calendar month for each taxon, and the same for every bird record
     of any species. Dividing one by the other gives the share of what
     birders reported that month which was this bird - the standard way
     to take the observers out of an observation count, since there are
     several times as many people looking in May as in January.

     Three things about how that curve is read, each of which was wrong
     at least once:

     ARRIVAL, NOT PRESENCE. The peak of the curve is when the species
     is most reported, and for a wintering duck that is midwinter, weeks
     after it got there. Migration is the rate of arrival, so it is the
     rising edge of the curve - the month-over-month increase - and not
     its summit.

     AUTUMN ONLY. At a middle latitude the curve rises twice, once as
     birds come south and again as they go back north, and a single
     mean fitted across both lands in January, between them. This app
     models autumn seasons, so only August to December is read.

     EACH SPECIES COUNTED ONCE. Mallards are a third of all duck
     records and half of them are on a park pond all year. Pooled, they
     flatten everything. Each taxon's curve is scaled to its own peak
     before they are averaged, so a gadwall that actually migrates has
     the same say as a mallard that mostly does not.

     Returns a peak day of year and a width in days, shaped to drop
     straight into the Gaussian the migration engine already uses. */

  var chronCache = {};

  /* August to December, and the day of year each month begins. */
  /* The step into January is left out. Every duck's share of bird
     records rises from December to January at every latitude in the
     country, the Canadian border included, and that is not birds
     arriving - it is everything else leaving or going quiet, so that
     ducks are a larger part of what is left to report. Counted, it
     dragged every arrival date later and wider. */
  var FALL = [7, 8, 9, 10, 11];
  var FALL_START = [213, 244, 274, 305, 335];

  /* Fewer autumn records than this in a band and the taxon is left out
     of that band's fit rather than allowed to steer it. */
  var MIN_FALL_RECORDS = 300;

  function chronBand(taxa, band) {
    var C = raw.chronology;
    var key = taxa.join('+') + ':' + band;
    if (chronCache[key] !== undefined) return chronCache[key];

    /* How much looking went on, band by month. Builds before the
       all-birds row existed fall back to the sum of the game species,
       which is a much weaker denominator. */
    var den = [];
    for (var m = 0; m < 12; m++) {
      var d = 0;
      if (C.effort) d = C.effort[band * 12 + m] || 0;
      else {
        for (var k in C.sp) {
          if (Object.prototype.hasOwnProperty.call(C.sp, k)) d += C.sp[k][band * 12 + m] || 0;
        }
      }
      den.push(d);
    }

    var rise = [0, 0, 0, 0, 0], curve = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var used = 0, conc = 0;

    for (var j = 0; j < taxa.length; j++) {
      var row = C.sp[taxa[j]];
      if (!row) continue;

      var share = [], top = 0, fallN = 0;
      for (var i = 0; i < 12; i++) {
        var v = den[i] > 0 ? (row[band * 12 + i] || 0) / den[i] : 0;
        share.push(v);
        if (v > top) top = v;
      }
      for (var q = 0; q < FALL.length; q++) fallN += row[band * 12 + FALL[q]] || 0;
      if (fallN < MIN_FALL_RECORDS || top <= 0) continue;

      var mine = 0;
      for (var f = 0; f < FALL.length; f++) {
        var mo = FALL[f], prev = share[(mo + 11) % 12];
        var up = Math.max(0, share[mo] - prev) / top;
        rise[f] += up; mine += up;
      }
      for (var c = 0; c < 12; c++) curve[c] += share[c] / top;
      /* How much of this bird's peak abundance here arrives in autumn.
         Near zero for a resident; near one for a bird that is absent
         in July and everywhere by December. */
      conc += Math.min(1, mine);
      used++;
    }

    var total = 0, mean = 0;
    for (var a = 0; a < FALL.length; a++) { total += rise[a]; mean += rise[a] * FALL_START[a]; }
    if (!used || total <= 0) { chronCache[key] = null; return null; }
    mean /= total;

    var vari = 0;
    for (var b = 0; b < FALL.length; b++) vari += rise[b] * Math.pow(FALL_START[b] - mean, 2);
    vari /= total;
    /* The data is monthly, so every arrival is smeared across about
       thirty days before it is measured; 77 is the variance of that.
       The engine's Gaussian is exp(-(d/w)^2), which makes w the
       standard deviation times root two. */
    var width = Math.sqrt(vari + 77) * Math.SQRT2;
    width = Math.max(20, Math.min(80, width));

    for (var n = 0; n < 12; n++) curve[n] /= used;

    /* The most of itself this group reaches between September and
       January, which is what "peak" means to anyone hunting it. */
    var fallMax = Math.max(curve[8], curve[9], curve[10], curve[11], curve[0]);

    var out = {
      peakLin: mean, widthDays: width, concentration: conc / used,
      months: curve, rise: rise, taxaUsed: used, fallMax: fallMax
    };
    chronCache[key] = out;
    return out;
  }

  function chronology(taxa, lat) {
    if (!raw || !raw.chronology || !raw.chronology.sp) return null;
    if (!taxa || !taxa.length) return null;
    var C = raw.chronology;

    /* Blended between the two nearest band centres. Read band by band
       the calendar steps at every even parallel, and a step in the
       calendar is a straight east-west line across the map. */
    var f = (lat - C.lat0) / C.bandDeg - 0.5;
    var last = C.bands - 1;
    var b0 = Math.floor(f), t = f - b0;
    if (b0 < 0) { b0 = 0; t = 0; }
    if (b0 >= last) { b0 = last; t = 0; }
    var b1 = t > 0 ? b0 + 1 : b0;

    var A = chronBand(taxa, b0), B = b1 === b0 ? A : chronBand(taxa, b1);
    if (!A && !B) return null;
    if (!A) A = B;
    if (!B) B = A;

    var lin = A.peakLin + (B.peakLin - A.peakLin) * t;
    var near = t < 0.5 ? A : B;
    return {
      peakDoy: lin > 365.25 ? lin - 365.25 : lin,
      widthDays: A.widthDays + (B.widthDays - A.widthDays) * t,
      concentration: A.concentration + (B.concentration - A.concentration) * t,
      months: near.months, rise: near.rise, taxaUsed: near.taxaUsed
    };
  }

  /* ---------- seasonal presence ----------

     How much of its autumn and winter peak a group normally has at
     this latitude on this date, 0 to 1.

     The model knew how good a marsh was and whether birds were moving
     into the region, and nothing about whether they had got there. So
     Stuttgart in the first week of October - eighty degrees, a few
     wood ducks and the first teal - scored within ten points of
     Stuttgart in December, because the habitat term is the same all
     year and the weather terms do not care who is there to feel them.

     The records say who is there. At 34 to 36 north the eight duck
     taxa are reported at 29 percent of their own peak in September,
     45 in October, 74 in November and 90 in January. That curve is
     the same share-of-bird-records measure the arrival dates are
     fitted to, read as a level this time instead of a slope.

     It is a reporting rate, not a count: it knows a species is being
     seen on more outings, not that there are ten times as many of
     them, so it understates how much the peak of the season outweighs
     the start. And it is by latitude, coast to coast, so the Central
     Valley shares a curve with Kansas. Both are limits of what a
     count of records can say. */
  function presenceBand(taxa, band, doy) {
    var c = chronBand(taxa, band);
    if (!c || !(c.fallMax > 0)) return null;
    /* Monthly values sit at mid-month; straight line between them. */
    var pos = (((doy - 1) % 365.25) + 365.25) % 365.25 / 30.4375 - 0.5;
    var m0 = Math.floor(pos), f = pos - m0;
    var a = c.months[((m0 % 12) + 12) % 12], b = c.months[(((m0 + 1) % 12) + 12) % 12];
    var v = (a + (b - a) * f) / c.fallMax;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function seasonalPresence(taxa, lat, doy) {
    if (!raw || !raw.chronology || !raw.chronology.sp) return null;
    if (!taxa || !taxa.length) return null;
    var C = raw.chronology;
    var f = (lat - C.lat0) / C.bandDeg - 0.5;
    var last = C.bands - 1;
    var b0 = Math.floor(f), t = f - b0;
    if (b0 < 0) { b0 = 0; t = 0; }
    if (b0 >= last) { b0 = last; t = 0; }
    var A = presenceBand(taxa, b0, doy);
    var B = t > 0 ? presenceBand(taxa, b0 + 1, doy) : A;
    if (A == null && B == null) return null;
    if (A == null) return B;
    if (B == null) return A;
    return A + (B - A) * t;
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
    at: at, presenceAt: presenceAt, regionalAt: regionalAt, rangeAt: rangeAt,
    RANGE_KNEE: RANGE_KNEE, RANGE_REGION: RANGE_REGION,
    ready: !!G,
    meta: raw ? { source: raw.source, note: raw.note, built: raw.built, d: raw.grid.d } : null,

    elevReady: !!EG,
    elevFt: function (lon, lat) { return elevSample('mean', lon, lat); },
    reliefFt: function (lon, lat) { return elevSample('relief', lon, lat); },
    elevMeta: eraw ? { source: eraw.source, note: eraw.note, built: eraw.built } : null,

    pressureAt: pressureAt,
    pressureReady: !!(raw && raw.pressure),
    chronology: chronology,
    seasonalPresence: seasonalPresence,
    chronReady: !!(raw && raw.chronology && raw.chronology.sp),
    composition: composition,
    compReady: !!(raw && raw.composition && raw.composition.sp)
  };
})(window);
