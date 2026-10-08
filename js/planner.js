/* OmniGuide - Plan a Hunt.

   The 8-day forecast answers "should I go Thursday". This answers "which week
   of the season should I take off work for", and it cannot use a forecast
   because none exists at that range. It uses climate normals instead.

   Source: NOAA NCEI daily climate normals, 1991-2020, roughly 700 first-order
   stations across the lower 48, aggregated into 52 weekly values and
   interpolated by inverse distance with an elevation lapse correction.

   WHAT THIS CAN AND CANNOT DO, because the distinction matters:

     It CAN rank weeks by the things that are genuinely seasonal - how cold it
     normally is, when freeze-up normally arrives, when snow normally covers
     the ground, when the migration chronology for a species normally peaks at
     this latitude, and when the season is legally open.

     It CANNOT tell you the wind, the pressure, or when a front will come
     through. Those are weather, not climate, and at six weeks out nobody
     knows them. So the planner deliberately holds those terms neutral and
     says so, rather than inventing a number that would look like a forecast. */
(function (global) {
  'use strict';

  var env = global.OG.env, models = global.OG.models, regs = global.OG.regs, geo = global.OG.geo;
  var clamp01 = env.clamp01, clamp = env.clamp;

  var N = global.US_NORMALS || null;
  var MISSING = -9999;

  function available() { return !!N && N.n > 0; }

  /* ---------- Climatology lookup ---------- */

  var K = 4;                       // nearest stations blended per query
  var LAPSE_F_PER_FT = 0.00357;

  function at(lon, lat, week) {
    if (!available()) return null;
    week = ((week % 52) + 52) % 52;

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
    if (!best.length) return null;

    var terrainFt = env.habitat(lon, lat).elev;
    var wSum = 0, tx = 0, tn = 0, sd = 0, pp = 0, sdW = 0, ppW = 0;

    for (var b = 0; b < best.length; b++) {
      var idx = best[b][1];
      var w = 1 / (best[b][0] + 0.02);           // inverse distance, softened
      var o = idx * 52 + week;
      if (N.TX[o] === MISSING || N.TN[o] === MISSING) continue;
      /* Correct both ends of the day for the elevation difference between the
         reporting station and the ground actually being hunted. */
      var lapse = (N.elev[idx] - terrainFt) * LAPSE_F_PER_FT;
      tx += (N.TX[o] / 10 + lapse) * w;
      tn += (N.TN[o] / 10 + lapse) * w;
      wSum += w;
      if (N.SD[o] !== MISSING) { sd += (N.SD[o] / 10) * w; sdW += w; }
      if (N.PP[o] !== MISSING) { pp += N.PP[o] * w; ppW += w; }
    }
    if (wSum <= 0) return null;

    var nearestMiles = Math.sqrt(best[0][0]) * 69;
    return {
      tmax: tx / wSum, tmin: tn / wSum, tmean: (tx + tn) / (2 * wSum),
      snowIn: sdW > 0 ? sd / sdW : 0,
      precipProb: ppW > 0 ? pp / ppW : 20,
      nearestMiles: nearestMiles,
      coverage: clamp01(1 - nearestMiles / 160)
    };
  }

  /* ---------- Typical conditions for a week ---------- */

  function seasonalIdx(doy) { return -Math.cos((doy - 14) / 365.25 * 2 * Math.PI); }

  /* Builds the same shape the Conditions Engine emits, from normals rather
     than from a forecast. Wind, pressure and frontal terms are held at
     neutral because climate cannot speak to them. */
  function typicalConditions(lon, lat, week, hab) {
    var c = at(lon, lat, week);
    if (!c) return null;
    var prev = at(lon, lat, week - 1) || c;
    var doy = week * 7 + 4;

    /* Daytime hunting temperature sits above the daily mean. */
    var tempF = c.tmean + 0.35 * (c.tmax - c.tmean);
    /* The only temperature change climate knows about is the seasonal slope. */
    var temp24 = (c.tmean - prev.tmean) / 7;

    var meanT = c.tmean;
    /* Accumulated, the same way the live model does it - see the ice
       notes in env.js. */
    var freeze = env.freezeIndex(lon, lat, doy, hab.elev, meanT, 0);
    var freezeDeep = env.freezeDepth ? env.freezeDepth(lon, lat, doy, hab.elev, meanT, 0) : 0;
    /* Snow depth normals are reported by very few stations, so where the
       station does not carry one it is derived from the temperature normal
       rather than assumed to be zero - which would read as bare ground in
       January across most of the north. */
    var snowDepth = c.snowIn > 0.05
      ? clamp01(c.snowIn / 8)
      : clamp01((30 - meanT) / 16) * (seasonalIdx(doy) < 0 ? 1 : 0.15);
    freeze = clamp01(freeze + snowDepth * 0.25);

    var cloud = clamp01(0.32 + (c.precipProb / 100) * 1.1);
    /* The fitted estimate the live model uses - see env.js. */
    var waterTemp = env.modelWaterTemp(meanT, hab, doy, lon, lat);

    return {
      tempF: tempF, temp24: temp24,
      pressure: 1015, pressTrend: 0,
      windFrom: 315, windSpd: 11,              // neutral placeholders, not a forecast
      gust: 15, cloud: cloud,
      precip: clamp01(c.precipProb / 100 * 0.5),
      snow: snowDepth * 0.3, snowDepth: snowDepth,
      freeze: freeze, freezeDeep: freezeDeep, waterTemp: waterTemp,
      flowIdx: clamp01(0.45 + 0.35 * Math.sin((doy - 80) / 365 * 2 * Math.PI)),
      flowReal: false, flowJudged: false, frontal: 0.35,   // average, not a predicted passage
      elev: hab.elev, seas: seasonalIdx(doy), real: false, climatological: true,
      precipIn: 0, snowDepthFt: c.snowIn / 12,
      _clim: c
    };
  }

  /* ---------- Climatological migration ---------- */

  /* Up-flyway freeze gradient from normals: the week freeze-up normally
     reaches the staging grounds north of here is the week birds normally
     leave them. That is a real seasonal signal, unlike wind. */
  function climateMigration(lon, lat, week, sp, hab, localFreeze) {
    if (!sp.migratory) return { intensity: 0, newBird: 0, applies: false, notes: [] };

    var fw = geo.flyway(lon), br = geo.UPFLYWAY[fw] * Math.PI / 180;
    var cosLat = Math.max(0.4, Math.cos(lat * Math.PI / 180));
    var dists = [2.6, 5.2, 8.6], wts = [0.45, 0.33, 0.22];
    var upFreeze = 0, upGain = 0, upSnow = 0, got = 0;

    for (var i = 0; i < dists.length; i++) {
      var plat = clamp(lat + dists[i] * Math.cos(br), 20, 49.4);
      var plon = lon + dists[i] * Math.sin(br) / cosLat;
      var c = at(plon, plat, week);
      if (!c) continue;
      var pe = env.elevFt ? env.elevFt(plon, plat) : 0;
      var f = env.freezeIndex(plon, plat, week * 7 + 4, pe, c.tmean, 0);
      upFreeze += wts[i] * f;
      upGain += wts[i] * env.freezeGain(plon, plat, week * 7 + 4, pe, f);
      upSnow += wts[i] * clamp01((c.snowIn || 0) / 9.6);
      got += wts[i];
    }
    if (got <= 0) return { intensity: 0, newBird: 0, applies: false, notes: [] };
    upFreeze /= got; upGain /= got; upSnow /= got;

    /* Freeze-up arriving, not the north merely being frozen - as in the
       live migration engine. */
    var freezeDelta = clamp01(upGain * 2.5 + 0.25 * Math.max(0, upFreeze - localFreeze));
    var doy = week * 7 + 4;

    /* The same calendar the live engine uses: arrival measured from
       the records where the species is seasonal enough at this
       latitude to fit one, the hand-set dates where it is not. This
       function had kept the hand-set dates for every case, so the
       planner and the map disagreed about when birds arrive. */
    var peak = sp.migPeak + (46 - lat) * 2.1, width = sp.migWidth;
    var hg = global.OG.habgrid;
    if (hg && hg.chronReady && sp.chronTaxa) {
      var cro = hg.chronology(sp.chronTaxa, lat);
      if (cro && cro.concentration > 0.15) { peak = cro.peakDoy; width = cro.widthDays; }
    }
    var dd = Math.abs(doy - peak);
    if (dd > 182.625) dd = 365.25 - dd;
    var chron = Math.exp(-Math.pow(dd / width, 2));

    /* And the same sum, with the two things climate cannot know set
       to what they average: a tailwind about a third of the time, a
       sharp drop up the flyway about a fifth. It used to be its own
       formula in which the calendar alone was worth 80 points, three
       times what the live engine gives an ordinary day - harmless on
       a private scale, and the reason every peak week pegged at 99
       once the planner was put on the live one. */
    var push = 0.33 * freezeDelta + 0.25 * 0.30 + 0.23 * 0.20 + 0.19 * clamp01(upSnow * 1.7);
    var intensity = 100 * clamp01(push * (0.30 + 0.70 * chron) * 1.18);
    var newBird = 100 * clamp01((intensity / 100) * (0.45 + 0.55 * clamp01(hab.waterfowl * 1.5)) *
                                (1 - 0.75 * localFreeze) * 1.1);

    var notes = [];
    if (chron > 0.6) notes.push('Normal migration chronology for this latitude peaks around now');
    if (freezeDelta > 0.45) notes.push('Freeze-up normally reaches the staging grounds up-flyway by this week');
    return { intensity: intensity, newBird: newBird, applies: true, chron: chron, notes: notes };
  }

  /* ---------- Weekly scoring ---------- */

  function weekDate(week) {
    var now = new Date();
    var y = now.getFullYear();
    var d = new Date(y, 0, 1 + week * 7 + 3);
    if (d < now) d = new Date(y + 1, 0, 1 + week * 7 + 3);
    return d;
  }

  function currentWeek() {
    return Math.min(51, Math.floor((env.dayOfYear(new Date()) - 1) / 7));
  }

  function scoreWeek(lon, lat, week, spId) {
    var sp = models.byId(spId);
    var hab = env.habitat(lon, lat);
    var wx = typicalConditions(lon, lat, week, hab);
    if (!wx) return null;

    var doy = week * 7 + 4;
    wx.lon = lon; wx.lat = lat;          // the rut calendar is regional
    var mv = sp.movement(wx, hab, doy);
    var mig = climateMigration(lon, lat, week, sp, hab, wx.freeze);
    var habV = hab[sp.habKey];
    var w = sp.weights;
    var wMig = mig.applies ? w.mig : 0;
    /* A week the water is normally locked is not a week to hunt it,
       whatever the cold does for movement. Same gate as the live score. */
    var lock = models.freezeLock ? models.freezeLock(sp, wx.freeze, hab, wx.freezeDeep || 0) : 0;
    /* Thin habitat does not ride on its weather - as in the live score. */
    var thin = models.HAB_THIN == null ? 1
      : models.HAB_THIN + (1 - models.HAB_THIN) * clamp01(habV / models.HAB_ENOUGH);
    /* And scaled by how many of the birds are normally here yet. */
    var present = models.presenceFactor ? models.presenceFactor(sp, lat, doy) : null;
    var shown = present == null ? 1 : models.PRESENT_FLOOR + (1 - models.PRESENT_FLOOR) * present;

    /* What a day of ordinary weather would score in this week, on the
       live scale.

       Climate cannot say whether a front arrives on the fourteenth, so
       wind, pressure and frontal passage are held at neutral values and
       the weather term is scored from those. The sum is then put
       through the same weights, the same hunting-pressure cut and the
       same per-species scale as the live score, so 70 here means what
       70 means on the map: this is what the week is worth before the
       weather has had its say. A real day in it will land above or
       below depending on what blows through.

       It had its own scale before, a fixed line set by eye, and then
       briefly a measured one of its own. Either way the number could
       not be read against the map, and a typical rut week in Iowa came
       out at 93. */
    var total = w.hab + w.move + wMig + w.wx;
    var wxs = models.weatherScore ? models.weatherScore(wx, sp) : 50;
    var keep = 1 - (sp.pressureSens == null ? 0.10 : sp.pressureSens) * models.huntingPressure(lon, lat);
    var raw = keep * shown * (w.hab * habV * (1 - 0.75 * lock) * 100 +
      thin * (1 - 0.8 * lock) * (w.move * mv.score + wMig * mig.intensity + w.wx * wxs)) / total;
    var score = models.toScore(raw, sp.id);

    /* Band: re-score a notably warm and a notably cold version of the same
       week. Year-to-year temperature swing is the dominant uncertainty. */
    function shifted(delta) {
      var alt = {};
      for (var k in wx) alt[k] = wx[k];
      alt.tempF = wx.tempF + delta;
      /* A warm or cold year is warm or cold for the weeks before as well. */
      alt.freeze = env.freezeIndex(lon, lat, doy, hab.elev, wx._clim.tmean + delta, wx.snowDepth, delta);
      alt.freezeDeep = env.freezeDepth ? env.freezeDepth(lon, lat, doy, hab.elev, wx._clim.tmean + delta, delta) : 0;
      alt.waterTemp = clamp(wx.waterTemp + delta * 0.787, 32, 90);
      var m2 = sp.movement(alt, hab, doy);
      var l2 = models.freezeLock ? models.freezeLock(sp, alt.freeze, hab, alt.freezeDeep || 0) : 0;
      var wx2 = models.weatherScore ? models.weatherScore(alt, sp) : 50;
      var r2 = keep * shown * (w.hab * habV * (1 - 0.75 * l2) * 100 +
        thin * (1 - 0.8 * l2) * (w.move * m2.score + wMig * mig.intensity + w.wx * wx2)) / total;
      return models.toScore(r2, sp.id);
    }
    var a = shifted(-9), b = shifted(9);

    var date = weekDate(week);
    var legal = regs.check(lon, lat, date, spId);

    return {
      week: week, date: date, score: score, raw: raw,
      lo: Math.min(a, b, score), hi: Math.max(a, b, score),
      /* A permit season is open - to whoever holds the tag. This
         counted only OPEN and LIMITED, so every draw species came
         back closed in every week: an elk hunter in Colorado was
         told there was no legal week in the next twenty, in the
         middle of rifle season. The status still says PERMIT and
         the panel still says a tag is needed; what changes is that
         the weeks inside the season are ranked instead of greyed
         out. */
      status: legal.status,
      legalOpen: legal.status === 'OPEN' || legal.status === 'LIMITED' || legal.status === 'PERMIT',
      mig: Math.round(mig.intensity), newBird: Math.round(mig.newBird),
      clim: wx._clim, coverage: wx._clim.coverage,
      drivers: mv.pos.slice(0, 3).concat(mig.notes.map(function (t) { return { t: t, s: 1 }; })),
      negatives: mv.neg.slice(0, 2)
    };
  }

  /* Horizon starting at the current week. */
  function horizon(lon, lat, spId, nWeeks) {
    var start = currentWeek(), out = [];
    for (var i = 0; i < (nWeeks || 20); i++) {
      var r = scoreWeek(lon, lat, (start + i) % 52, spId);
      if (r) out.push(r);
    }
    return out;
  }

  /* Best contiguous runs of legally open weeks, ranked by mean score. */
  function bestWindows(rows, maxRuns) {
    var runs = [], cur = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].legalOpen) {
        if (!cur) cur = { from: i, to: i, sum: 0, n: 0, peak: 0, peakIdx: i };
        cur.to = i; cur.sum += rows[i].score; cur.n++;
        if (rows[i].score > cur.peak) { cur.peak = rows[i].score; cur.peakIdx = i; }
      } else if (cur) { runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
    runs.forEach(function (r) { r.mean = r.sum / r.n; });
    runs.sort(function (a, b) { return b.peak - a.peak; });
    return runs.slice(0, maxRuns || 3);
  }

  /* ---------- National comparison ----------

     "Is week eleven the best week here" is a different question from "is
     here anywhere near the best place". A season index of 49 means nothing
     on its own; it means a great deal once you know whether the rest of the
     country is sitting at 30 or at 80 that same week.

     Samples a 2.5 degree lattice over land, scores every point for the one
     week in question, and reports where the chosen spot falls in that
     distribution. Only legally open points count toward the ranking,
     because a brilliant score in a closed state is not an option. */

  var natCache = new Map();

  function sampleGrid() {
    if (sampleGrid._pts) return sampleGrid._pts;
    var pts = [];
    for (var lat = 25.5; lat <= 49; lat += 2.2) {
      for (var lon = -124; lon <= -67; lon += 2.2) {
        var si = geo.stateIndexAt(lon, lat);
        if (si < 0) continue;
        pts.push({ lon: lon, lat: lat, state: geo.states[si].abbr, stateName: geo.states[si].name });
      }
    }
    sampleGrid._pts = pts;
    return pts;
  }

  /* A readable name for a sample point: the habitat complex it sits in if
     there is one, otherwise the state. */
  function regionName(p) {
    var best = null, bd = 1e9;
    var all = env.WF_REGIONS.concat(env.TROUT_WATERS);
    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      var dx = (p.lon - r.lon) / (r.rx * 1.6), dy = (p.lat - r.lat) / (r.ry * 1.6);
      var d = dx * dx + dy * dy;
      if (d < 1 && d < bd) { bd = d; best = r.n; }
    }
    return best ? best + ', ' + p.state : p.stateName;
  }

  function national(spId, week) {
    var key = spId + ':' + week;
    if (natCache.has(key)) return natCache.get(key);

    var pts = sampleGrid(), rows = [];
    for (var i = 0; i < pts.length; i++) {
      var r = scoreWeek(pts[i].lon, pts[i].lat, week, spId);
      if (!r) continue;
      rows.push({
        lon: pts[i].lon, lat: pts[i].lat, state: pts[i].state,
        name: regionName(pts[i]), score: r.score, open: r.legalOpen
      });
    }
    var openRows = rows.filter(function (r) { return r.open; });
    openRows.sort(function (a, b) { return b.score - a.score; });

    /* Several lattice points land inside one named complex, so the best
       of each gets the entry. A top five listing the Prairie Potholes
       three times is not a top five. */
    var seen = {}, top = [];
    for (var k = 0; k < openRows.length && top.length < 5; k++) {
      if (seen[openRows[k].name]) continue;
      seen[openRows[k].name] = true;
      top.push(openRows[k]);
    }

    var out = {
      week: week, species: spId,
      all: rows, open: openRows,
      sampled: rows.length, openCount: openRows.length,
      top: top
    };
    if (natCache.size > 40) natCache.clear();
    natCache.set(key, out);
    return out;
  }

  /* Where a score falls against the open-season national distribution. */
  function percentile(nat, score) {
    if (!nat.openCount) return null;
    var below = 0;
    for (var i = 0; i < nat.open.length; i++) if (nat.open[i].score < score) below++;
    return Math.round(below / nat.openCount * 100);
  }

  global.OG.planner = {
    national: national, percentile: percentile,
    available: available, at: at, horizon: horizon, scoreWeek: scoreWeek,
    bestWindows: bestWindows, weekDate: weekDate, currentWeek: currentWeek,
    period: N ? N.period : null, source: N ? N.source : null,
    stations: N ? N.n : 0
  };
})(window);
