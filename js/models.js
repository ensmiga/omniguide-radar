/* OmniGuide - Animal Behavior Engine, Migration Engine, Confidence Engine.

   Architectural rule from the brief: no universal scoring formula. Shared
   infrastructure, species-specific models. Each species declares its own
   response curves and its own component weights, and every driver carries the
   text used later to explain the score. The explanation is generated from the
   same numbers that produced the score, never written after the fact. */
(function (global) {
  'use strict';

  var env = global.OG.env, geo = global.OG.geo;
  var D2R = Math.PI / 180;
  var clamp = env.clamp, clamp01 = env.clamp01, bell = env.bell;

  function ramp(v, a, b) { return clamp01((v - a) / (b - a)); }
  function pref(v, ideal, tol) { var k = (v - ideal) / tol; return Math.exp(-k * k); }

  /* ---------- Observed distribution ---------- */

  /* GBIF occurrence records (eBird and iNaturalist feed most of them),
     expressed as each species' share of all game-species records in a cell.
     Composition rather than raw counts, because all ten species are recorded
     by the same observers, so the ratio largely cancels the fact that people
     report far more wildlife near cities than in the Missouri Breaks.

     It is a range and presence signal, not an abundance estimate, so it
     modulates the habitat surface instead of replacing it - hard for species
     with sharp range edges, gently for the ones found nearly everywhere.
     Cells where the query failed or records were too thin return null and no
     adjustment is made at all. */
  var D = global.US_DIST || null;

  function distAt(lon, lat, key) {
    if (!D || !D.sp[key]) return null;
    var g = D.grid, arr = D.sp[key];
    var fx = (lon - g.lon0) / g.d - 0.5, fy = (lat - g.lat0) / g.d - 0.5;
    var ix = Math.floor(fx), iy = Math.floor(fy);
    var tx = fx - ix, ty = fy - iy;
    var sum = 0, wsum = 0;
    for (var a = 0; a <= 1; a++) {
      for (var b = 0; b <= 1; b++) {
        var cx = ix + a, cy = iy + b;
        if (cx < 0 || cy < 0 || cx >= g.nlon || cy >= g.nlat) continue;
        var v = arr[cy * g.nlon + cx];
        if (v < 0) continue;                    // unknown cell, contributes nothing
        var w = (a ? tx : 1 - tx) * (b ? ty : 1 - ty);
        if (w <= 0) continue;
        sum += (v / 1000) * w;
        wsum += w;
      }
    }
    if (wsum < 0.25) return null;               // too little known coverage to trust
    return sum / wsum;
  }

  /* Weighted blend that also harvests the strong drivers for the explanation. */
  function blend(parts) {
    var s = 0, w = 0, pos = [], neg = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      s += p.w * p.v; w += p.w;
      if (!p.hi) continue;
      if (p.v >= 0.66) pos.push({ t: p.hi, s: p.w * p.v });
      else if (p.v <= 0.34 && p.lo) neg.push({ t: p.lo, s: p.w * (1 - p.v) });
    }
    return { score: (s / w) * 100, pos: pos, neg: neg };
  }

  /* ---------- Hunting pressure proxy ---------- */

  var METROS = [
    [-87.7, 41.9, 9.5], [-118.3, 34.0, 13.2], [-96.8, 32.8, 7.6], [-95.4, 29.8, 7.1],
    [-84.4, 33.8, 6.1], [-77.0, 38.9, 6.3], [-75.2, 40.0, 6.2], [-74.0, 40.7, 19.8],
    [-71.1, 42.4, 4.9], [-80.2, 25.8, 6.1], [-122.4, 37.8, 4.7], [-122.3, 47.6, 4.0],
    [-104.9, 39.7, 2.9], [-112.1, 33.4, 4.9], [-90.2, 38.6, 2.8], [-86.2, 39.8, 2.1],
    [-93.3, 44.9, 3.7], [-82.5, 27.9, 3.2], [-81.4, 28.5, 2.6], [-80.8, 35.2, 2.7],
    [-86.8, 36.2, 2.0], [-90.0, 35.1, 1.3], [-94.6, 39.1, 2.2], [-95.9, 41.3, 0.9],
    [-97.5, 35.5, 1.4], [-96.8, 46.9, 0.25], [-100.8, 46.8, 0.13], [-106.6, 35.1, 0.92],
    [-111.9, 40.8, 1.3], [-117.2, 32.7, 3.3], [-121.5, 38.6, 2.4], [-123.1, 45.5, 2.5],
    [-83.0, 42.3, 4.3], [-81.7, 41.5, 2.1], [-80.0, 40.4, 2.4], [-78.9, 36.0, 2.0],
    [-85.8, 38.3, 1.3], [-92.3, 34.7, 0.75], [-90.1, 30.0, 1.3], [-98.5, 29.4, 2.6],
    [-115.1, 36.2, 2.3], [-108.5, 45.8, 0.12], [-111.0, 45.7, 0.12], [-116.2, 43.6, 0.78]
  ];

  function huntingPressure(lon, lat) {
    var p = 0;
    for (var i = 0; i < METROS.length; i++) {
      var dx = (lon - METROS[i][0]) * Math.cos(lat * D2R), dy = lat - METROS[i][1];
      var d2 = dx * dx + dy * dy;
      p += METROS[i][2] * Math.exp(-d2 / 1.9);
    }
    return clamp01(p / 7 + (env.fbm(lon * 1.3, lat * 1.3, 51) - 0.5) * 0.3);
  }

  /* ---------- Migration Engine ---------- */

  function migration(lon, lat, t, doy, sp, hab, localFreeze) {
    if (!sp.migratory) return { intensity: 0, newBird: 0, applies: false, pos: [], neg: [], dirDeg: 0 };

    var fw = geo.flyway(lon), br = geo.UPFLYWAY[fw], brR = br * D2R;
    var cosLat = Math.max(0.4, Math.cos(lat * D2R));
    var dists = [2.6, 5.2, 8.6], wts = [0.45, 0.33, 0.22];
    var upFreeze = 0, upDrop = 0, upSnow = 0, tail = 0;

    for (var i = 0; i < dists.length; i++) {
      var dl = dists[i];
      var plat = clamp(lat + dl * Math.cos(brR), 20, 66);
      var plon = lon + dl * Math.sin(brR) / cosLat;
      var s = env.probe(plon, plat, t, doy);
      upFreeze += wts[i] * s.freeze;
      upDrop += wts[i] * Math.max(0, -s.temp24);
      upSnow += wts[i] * s.snow;
      /* Wind blowing FROM the up-flyway bearing is a tailwind for birds
         heading down the flyway. */
      tail += wts[i] * Math.cos((s.windFrom - br) * D2R) * s.windSpd;
    }

    var freezeDelta = clamp01((upFreeze - localFreeze) * 2.0);
    var tailwind = clamp01(tail / 17);
    var drop = clamp01(upDrop / 13);
    var snow = clamp01(upSnow * 1.7);

    /* Chronology: the same calendar week means different things at different
       latitudes, so the species peak slides south through the season. */
    var peak = sp.migPeak + (46 - lat) * 2.1;
    var chron = Math.exp(-Math.pow((doy - peak) / sp.migWidth, 2));

    var raw = 0.33 * freezeDelta + 0.25 * tailwind + 0.23 * drop + 0.19 * snow;
    var intensity = 100 * clamp01(raw * (0.30 + 0.70 * chron) * 1.18);

    /* New birds need both a push upstream and open, usable water here. */
    var newBird = 100 * clamp01(
      (intensity / 100) * (0.45 + 0.55 * clamp01(hab.waterfowl * 1.5)) * (1 - 0.75 * localFreeze) * 1.1
    );

    var pos = [], neg = [];
    if (freezeDelta > 0.45) pos.push({ t: 'Freeze-up advancing north of here', s: freezeDelta });
    if (tailwind > 0.5) pos.push({ t: 'Sustained tailwind down the ' + fw + ' flyway', s: tailwind });
    if (drop > 0.5) pos.push({ t: 'Sharp temperature decline up-flyway', s: drop });
    if (snow > 0.45) pos.push({ t: 'Snow accumulating on northern staging areas', s: snow });
    if (chron < 0.35) neg.push({ t: 'Outside the usual migration window for this latitude', s: 1 - chron });
    if (tailwind < 0.15 && chron > 0.4) neg.push({ t: 'No tailwind component up-flyway', s: 0.7 });

    return {
      intensity: intensity, newBird: newBird, applies: true,
      pos: pos, neg: neg, dirDeg: (br + 180) % 360, flyway: fw, chron: chron
    };
  }

  /* ---------- Species models ---------- */

  /* Shared duck response curves, then each species bends them its own way. */
  function duckCommon(wx, hab) {
    return {
      wind: { w: 1, v: clamp01(ramp(wx.windSpd, 2, 13)) * (1 - 0.45 * ramp(wx.windSpd, 27, 40)),
        hi: 'Wind strong enough to keep birds moving and decoys working',
        lo: 'Flat calm - birds sit tight and flare on clean water' },
      drop: { w: 1, v: ramp(-wx.temp24, 1, 15),
        hi: 'Major overnight temperature decline', lo: 'Warming trend overnight' },
      front: { w: 1, v: wx.frontal,
        hi: 'Frontal passage overhead', lo: null },
      press: { w: 1, v: clamp01(0.5 + wx.pressTrend * 0.45),
        hi: 'Favorable pressure change', lo: 'Stagnant high pressure' },
      cloud: { w: 1, v: 0.35 + 0.65 * pref(wx.cloud, 0.7, 0.4),
        hi: 'Low ceiling keeping birds down in range', lo: null },
      hab: { w: 1, v: hab.waterfowl, hi: null, lo: null }
    };
  }

  var SPECIES = [
    {
      id: 'ducks', name: 'Ducks', group: 'waterfowl', pursuit: 'hunt',
      migratory: true, migPeak: 310, migWidth: 44, habKey: 'waterfowl',
      pressureSens: 0.13,
      distWeight: 0.20,
      habFloor: 0.07, rangeFloor: 0.015,
      weights: { hab: 0.26, move: 0.30, mig: 0.28, wx: 0.16 },
      blurb: 'All duck species together - dabblers and divers, early teal through late mallards. ' +
             'The chronology is deliberately broad because the group is.',
      movement: function (wx, hab) {
        var c = duckCommon(wx, hab);
        return blend([
          { w: 1.7, v: c.wind.v, hi: c.wind.hi, lo: c.wind.lo },
          { w: 1.5, v: c.drop.v, hi: c.drop.hi, lo: c.drop.lo },
          { w: 1.2, v: c.front.v, hi: c.front.hi },
          { w: 1.0, v: c.press.v, hi: c.press.hi, lo: c.press.lo },
          { w: 0.8, v: c.cloud.v, hi: c.cloud.hi },
          { w: 1.2, v: clamp01(ramp(42 - wx.tempF, -8, 26)),
            hi: 'Cold enough to force heavy feeding flights', lo: 'Mild air - birds loafing, little daytime movement' },
          { w: 1.1, v: pref(wx.freeze, 0.52, 0.36),
            hi: 'Partial freeze concentrating birds on the remaining open water',
            lo: wx.freeze > 0.85 ? 'Water largely locked up here' : 'No freeze pressure concentrating birds' },
          { w: 0.9, v: clamp01(hab.waterfowl * 1.25) * (1 - 0.55 * wx.freeze),
            hi: 'Shallow feeding water still open', lo: 'Little usable shallow water' },
          { w: 0.7, v: clamp01(wx.snowDepth * 1.4), hi: 'Snow cover pushing birds to food', lo: null }
        ]);
      }
    },
    {
      id: 'canada-goose', name: 'Canada goose', group: 'waterfowl', pursuit: 'hunt',
      distKey: 'goose',
      migratory: true, migPeak: 322, migWidth: 40, habKey: 'waterfowl',
      pressureSens: 0.12,
      distWeight: 0.20,
      habFloor: 0.07, rangeFloor: 0.015,
      weights: { hab: 0.24, move: 0.36, mig: 0.22, wx: 0.18 },
      blurb: 'Field feeder. Reads snow cover and feed availability more than freeze.',
      movement: function (wx, hab) {
        var c = duckCommon(wx, hab);
        return blend([
          { w: 1.2, v: pref(wx.windSpd, 14, 11), hi: 'Steady wind for a clean field approach', lo: 'Calm air - geese circle and hang up' },
          { w: 1.5, v: ramp(-wx.temp24, 1, 16), hi: 'Temperature crash driving a heavy feed', lo: 'Warming trend overnight' },
          { w: 1.3, v: clamp01(ramp(34 - wx.tempF, -6, 20)), hi: 'Cold forcing two feeds a day', lo: 'Warm enough that one short feed covers them' },
          { w: 1.4, v: clamp01(wx.snowDepth * 1.8), hi: 'Snow cover concentrating birds on exposed grain', lo: null },
          { w: 1.0, v: c.front.v, hi: 'Frontal passage overhead' },
          { w: 0.9, v: c.press.v, hi: 'Favorable pressure change', lo: 'Stagnant high pressure' },
          { w: 1.0, v: clamp01(hab.openness * 0.7 + hab.waterfowl * 0.6), hi: 'Open agricultural ground next to roost water', lo: 'Little field feed near roost water' }
        ]);
      }
    },
    {
      id: 'elk', name: 'Elk', group: 'biggame', pursuit: 'hunt', preview: true,
      migratory: false, habKey: 'elk',
      pressureSens: 0.17,
      distWeight: 0.45,
      habFloor: 0.10, rangeFloor: 0.03,
      weights: { hab: 0.38, move: 0.38, mig: 0, wx: 0.24 },
      blurb: 'Preview model. Thermals, rut stage and terrain rather than flyway dynamics.',
      movement: function (wx, hab, doy) {
        var rut = Math.exp(-Math.pow((doy - 268) / 18, 2));
        return blend([
          { w: 1.6, v: clamp01(ramp(52 - wx.tempF, -8, 26)), hi: 'Cool enough to keep elk on their feet past first light', lo: 'Warm - elk bedded in dark timber early' },
          { w: 1.5, v: 0.25 + 0.75 * rut, hi: 'Peak rut activity', lo: 'Outside the rut - movement is feed-driven only' },
          { w: 1.3, v: pref(wx.windSpd, 7, 6), hi: 'Light, predictable thermals', lo: 'Wind too strong for a quiet approach and consistent thermals' },
          { w: 1.1, v: clamp01(hab.elk * 1.3), hi: 'Timber, benches and meadow edges in the right elevation band', lo: 'Marginal elk country' },
          { w: 0.9, v: clamp01(wx.snowDepth * 1.6 + ramp(-wx.temp24, 2, 16) * 0.6), hi: 'Weather pushing elk toward lower feed', lo: null },
          { w: 0.8, v: 0.4 + 0.6 * pref(wx.cloud, 0.65, 0.4), hi: 'Overcast extending morning movement' }
        ]);
      }
    },
    {
      id: 'whitetail', name: 'Whitetail deer', group: 'biggame', pursuit: 'hunt',
      migratory: false, habKey: 'whitetail',
      pressureSens: 0.11,
      distWeight: 0.35,
      habFloor: 0.08, rangeFloor: 0.02,
      weights: { hab: 0.34, move: 0.42, mig: 0, wx: 0.24 },
      blurb: 'Rut timing, cold fronts and pressure. Daylight movement is the whole game.',
      movement: function (wx, hab, doy) {
        /* Northern rut peaks mid-November and slides later going south; the
           model is given the date, not the latitude, so this is the average. */
        var rut = Math.exp(-Math.pow((doy - 318) / 16, 2));
        var preRut = Math.exp(-Math.pow((doy - 300) / 14, 2));
        return blend([
          { w: 1.8, v: 0.2 + 0.8 * clamp01(rut + preRut * 0.75),
            hi: 'Rut activity has bucks on their feet in daylight',
            lo: 'Outside the rut - movement is feed and cover driven only' },
          { w: 1.6, v: ramp(-wx.temp24, 1, 15),
            hi: 'Sharp temperature drop, which is the single best whitetail trigger',
            lo: 'Warming trend suppressing daylight movement' },
          { w: 1.3, v: clamp01(ramp(48 - wx.tempF, -6, 30)),
            hi: 'Cold enough to push a long afternoon feed', lo: 'Unseasonably warm - expect nocturnal movement' },
          { w: 1.2, v: wx.frontal, hi: 'Front moving through' },
          { w: 1.1, v: pref(wx.windSpd, 8, 7),
            hi: 'Enough wind to cover your sound without shutting deer down',
            lo: wx.windSpd > 18 ? 'Wind strong enough to keep deer bedded in cover' : 'Dead calm - they will hear you first' },
          { w: 1.0, v: clamp01(hab.whitetail * 1.25), hi: 'Strong cover-to-feed mosaic', lo: 'Thin whitetail country' },
          { w: 0.8, v: 0.4 + 0.6 * clamp01(0.5 + wx.pressTrend * 0.4), hi: 'Rising pressure behind the front' },
          { w: 0.7, v: 1 - clamp01(wx.precip * 1.4), hi: null, lo: 'Steady rain keeping deer bedded' }
        ]);
      }
    },
    {
      id: 'muledeer', name: 'Mule deer', group: 'biggame', pursuit: 'hunt',
      migratory: false, habKey: 'muledeer',
      pressureSens: 0.10,
      distWeight: 0.45,
      habFloor: 0.10, rangeFloor: 0.035,
      weights: { hab: 0.38, move: 0.38, mig: 0, wx: 0.24 },
      blurb: 'Open-country glassing. Later rut than whitetail, and snow moves them down.',
      movement: function (wx, hab, doy) {
        var rut = Math.exp(-Math.pow((doy - 328) / 15, 2));
        return blend([
          { w: 1.6, v: 0.25 + 0.75 * rut, hi: 'Rut has bucks moving with does in the open',
            lo: 'Pre-rut - bucks still in bachelor groups and high country' },
          { w: 1.5, v: clamp01(1 - wx.cloud * 0.9),
            hi: 'Clear light for long-range glassing', lo: 'Flat light and low cloud will cost you glassing distance' },
          { w: 1.4, v: clamp01(ramp(45 - wx.tempF, -8, 28)),
            hi: 'Cold keeping deer feeding later into the morning', lo: 'Warm - deer bedded by shooting light' },
          { w: 1.3, v: clamp01(wx.snowDepth * 1.7 + ramp(-wx.temp24, 2, 16) * 0.5),
            hi: 'Snow pushing deer out of the high country', lo: null },
          { w: 1.1, v: pref(wx.windSpd, 9, 8), hi: 'Workable wind for a stalk',
            lo: wx.windSpd > 20 ? 'Too much wind - deer will be in the lee and jumpy' : 'No wind to cover a stalk' },
          { w: 1.0, v: clamp01(hab.muledeer * 1.25), hi: 'Classic sage and breaks country', lo: 'Marginal mule deer range' }
        ]);
      }
    },
    {
      id: 'moose', name: 'Moose', group: 'biggame', pursuit: 'hunt',
      migratory: false, habKey: 'moose',
      pressureSens: 0.05,
      distWeight: 0.50,
      habFloor: 0.10, rangeFloor: 0.04,
      weights: { hab: 0.44, move: 0.34, mig: 0, wx: 0.22 },
      blurb: 'Heat is the limiting factor. Willow bottoms, wet ground and the late-September rut.',
      movement: function (wx, hab, doy) {
        var rut = Math.exp(-Math.pow((doy - 273) / 15, 2));
        return blend([
          { w: 2.0, v: clamp01(ramp(50 - wx.tempF, -4, 26)),
            hi: 'Cool enough that moose stay on their feet',
            lo: 'Too warm - moose will be bedded in shade or standing in water' },
          { w: 1.6, v: 0.2 + 0.8 * rut, hi: 'Peak rut, bulls responding and moving',
            lo: 'Outside the rut - this is a spot-and-stalk feeding pattern' },
          { w: 1.4, v: clamp01(hab.moose * 1.3), hi: 'Willow bottoms and wet feeding ground', lo: 'Marginal moose habitat' },
          { w: 1.0, v: pref(wx.windSpd, 6, 6), hi: 'Calm enough to hear and be heard',
            lo: 'Wind is covering the sounds you need to hunt by' },
          { w: 0.9, v: 0.35 + 0.65 * clamp01(wx.cloud), hi: 'Overcast extending the movement window' },
          { w: 0.8, v: clamp01(wx.snowDepth * 1.3 + 0.3), hi: 'Fresh snow for tracking', lo: null }
        ]);
      }
    },
    {
      id: 'pronghorn', name: 'Pronghorn', group: 'biggame', pursuit: 'hunt',
      migratory: false, habKey: 'pronghorn',
      pressureSens: 0.06,
      distWeight: 0.50,
      habFloor: 0.10, rangeFloor: 0.035,
      weights: { hab: 0.42, move: 0.34, mig: 0, wx: 0.24 },
      blurb: 'Eyes, not noses. Visibility, water and the mid-September rut.',
      movement: function (wx, hab, doy) {
        var rut = Math.exp(-Math.pow((doy - 259) / 14, 2));
        return blend([
          { w: 1.7, v: 0.3 + 0.7 * rut, hi: 'Rut has bucks tending does and ignoring everything else',
            lo: 'Outside the rut - animals are grouped, wary and hard to approach' },
          { w: 1.5, v: clamp01(hab.pronghorn * 1.25), hi: 'Open shortgrass and sage country', lo: 'Outside core pronghorn range' },
          { w: 1.3, v: clamp01(ramp(wx.tempF, 48, 82)),
            hi: 'Warm enough to pull animals to water in the middle of the day',
            lo: 'Cool - animals are spread out and not tied to water' },
          { w: 1.2, v: 1 - clamp01(wx.cloud * 0.8),
            hi: 'Clear air for spotting at distance', lo: 'Poor visibility for glassing open country' },
          { w: 1.1, v: pref(wx.windSpd, 13, 10),
            hi: 'Wind giving you cover to crawl the last two hundred yards',
            lo: wx.windSpd > 25 ? 'Wind too strong for a steady long shot' : 'Calm and clear - they will see you coming' },
          { w: 0.8, v: 1 - clamp01(wx.precip * 1.6), hi: null, lo: 'Wet ground and poor visibility' }
        ]);
      }
    },
    {
      id: 'turkey', name: 'Wild turkey', group: 'turkey', pursuit: 'hunt',
      migratory: false, habKey: 'turkey',
      pressureSens: 0.11,
      distWeight: 0.30,
      habFloor: 0.09, rangeFloor: 0.025,
      weights: { hab: 0.36, move: 0.40, mig: 0, wx: 0.24 },
      blurb: 'Gobbling activity. Calm clear mornings in spring, flocked up and feed-driven in fall.',
      movement: function (wx, hab, doy) {
        var spring = Math.exp(-Math.pow((doy - 115) / 28, 2));      // April and early May
        var fall = Math.exp(-Math.pow((doy - 295) / 26, 2));
        var season = Math.max(spring, fall * 0.72);
        return blend([
          { w: 1.8, v: 0.15 + 0.85 * season,
            hi: spring > fall ? 'Peak spring gobbling period' : 'Fall flocks are predictable on feed',
            lo: 'Well outside the active turkey window' },
          { w: 1.6, v: 1 - clamp01(ramp(wx.windSpd, 7, 20)),
            hi: 'Calm enough to hear a gobble at distance and to be heard',
            lo: 'Wind is killing both gobbling and your ability to hear it' },
          { w: 1.4, v: 1 - clamp01(wx.precip * 1.8),
            hi: 'Dry morning - birds gobble and stay on the ground',
            lo: 'Rain shuts down gobbling and pushes birds to open fields' },
          { w: 1.2, v: 0.35 + 0.65 * clamp01(1 - wx.cloud * 0.8),
            hi: 'Clear sky at fly-down, which is when they are loudest', lo: 'Heavy overcast muting the roost gobble' },
          { w: 1.1, v: clamp01(hab.turkey * 1.3), hi: 'Timber and field edge they roost and strut in', lo: 'Thin turkey country' },
          { w: 1.0, v: 0.4 + 0.6 * clamp01(0.5 + wx.pressTrend * 0.5),
            hi: 'Stable or rising pressure, which gobbling tracks closely', lo: 'Falling pressure ahead of weather' },
          { w: 0.9, v: pref(wx.tempF, 58, 18), hi: 'Comfortable temperature for all-morning activity', lo: null }
        ]);
      }
    },
    {
      id: 'upland', name: 'Upland birds', group: 'upland', pursuit: 'hunt',
      migratory: false, habKey: 'upland',
      pressureSens: 0.09,
      distWeight: 0.30,
      habFloor: 0.09, rangeFloor: 0.025,
      weights: { hab: 0.40, move: 0.36, mig: 0, wx: 0.24 },
      blurb: 'Pheasant, quail and grouse together. Scenting conditions for the dog drive most of it.',
      movement: function (wx, hab, doy) {
        /* Scent holds in cool, damp, lightly moving air and dies in hot, dry,
           windy conditions. For a dog hunter that matters more than the birds. */
        var scent = clamp01(0.30 + 0.45 * clamp01(ramp(58 - wx.tempF, -10, 34)) +
                            0.25 * clamp01(wx.cloud) + 0.22 * clamp01(wx.precip * 2) -
                            0.30 * clamp01(ramp(wx.windSpd, 12, 28)));
        var season = clamp01(ramp(doy, 270, 292));
        return blend([
          { w: 1.9, v: scent, hi: 'Cool damp air holding scent well for the dog',
            lo: 'Hot, dry or windy - scenting conditions will be poor' },
          { w: 1.5, v: clamp01(hab.upland * 1.3), hi: 'Strong cover and grain edge', lo: 'Little holding cover here' },
          { w: 1.2, v: 0.25 + 0.75 * season, hi: 'Inside the normal upland season window',
            lo: 'Early - crops are likely still standing and birds are scattered' },
          { w: 1.1, v: 1 - clamp01(ramp(wx.windSpd, 14, 32)),
            hi: 'Manageable wind', lo: 'Heavy wind pushes birds into the thickest cover and makes them run' },
          { w: 1.0, v: clamp01(wx.snowDepth * 1.5 + 0.35),
            hi: 'Snow concentrating birds in heavy cover', lo: null },
          { w: 0.9, v: clamp01(ramp(38 - wx.tempF, -14, 22)),
            hi: 'Cold holding birds tight instead of running', lo: 'Warm - expect running birds and a hot dog' }
        ]);
      }
    },
    {
      id: 'trout', name: 'Trout', group: 'fishing', pursuit: 'fish', preview: true,
      migratory: false, habKey: 'trout',
      pressureSens: 0.11,
      distWeight: 0.30,
      habFloor: 0.08, rangeFloor: 0.02,
      weights: { hab: 0.34, move: 0.40, mig: 0, wx: 0.26 },
      blurb: 'Fly fishing model. Water temperature, flow stability and hatch timing.',
      movement: function (wx, hab) {
        return blend([
          { w: 2.0, v: pref(wx.waterTemp, 55, 9), hi: 'Water temperature inside the active feeding band', lo: wx.waterTemp < 46 ? 'Water too cold for sustained feeding' : 'Water too warm - fish stressed and off the feed' },
          { w: 1.5, v: pref(wx.flowIdx, 0.48, 0.26), hi: 'Flows in a fishable, stable range', lo: wx.flowIdx > 0.7 ? 'High, pushy water' : 'Very low, clear water' },
          { w: 1.3, v: clamp01(wx.cloud * 1.2), hi: 'Cloud cover supporting a strong emergence', lo: 'Bright sun suppressing surface activity' },
          { w: 1.0, v: 0.35 + 0.65 * clamp01(1 - Math.abs(wx.pressTrend) * 0.8), hi: 'Stable barometer', lo: 'Rapidly changing pressure' },
          { w: 1.2, v: clamp01(hab.trout * 1.25), hi: 'Productive, well-known water', lo: 'Marginal trout water' },
          { w: 0.9, v: 1 - clamp01(ramp(wx.windSpd, 12, 30)), hi: null, lo: 'Wind making presentation difficult' }
        ]);
      }
    }
  ];

  var BY_ID = {};
  SPECIES.forEach(function (s) { BY_ID[s.id] = s; });

  /* ---------- Conditions sub-score shown as the Weather component ---------- */

  function weatherScore(wx, sp) {
    if (sp.pursuit === 'fish') {
      return 100 * clamp01(0.3 + 0.4 * pref(wx.waterTemp, 55, 10) + 0.2 * clamp01(wx.cloud) +
        0.2 * (1 - clamp01(ramp(wx.windSpd, 14, 32))));
    }
    return 100 * clamp01(
      0.26 * clamp01(ramp(wx.windSpd, 3, 16)) +
      0.26 * ramp(-wx.temp24, 0, 15) +
      0.20 * wx.frontal +
      0.16 * clamp01(0.5 + wx.pressTrend * 0.4) +
      0.12 * clamp01(wx.cloud)
    );
  }

  /* ---------- Confidence Engine ---------- */

  function confidence(lon, lat, t, wx, hab, sp, pressureIdx) {
    var lead = clamp01(1 - t / 8.5);
    var obs = clamp01(pressureIdx * 0.8 + hab[sp.habKey] * 0.4);   // more people here means more reports
    var sensor = env.fbm(lon * 0.7, lat * 0.7, 77);
    var frontUnc = wx.frontal;
    var habQual = hab.region || hab.water ? 1 : 0.5;
    var c = 0.28 + 0.31 * lead + 0.13 * obs + 0.10 * habQual + 0.08 * sensor - 0.17 * frontUnc;
    if (sp.preview) c -= 0.11;
    return 100 * clamp(c, 0.12, 0.94);
  }

  /* ---------- Composite ---------- */

  function scoreAt(lon, lat, t, doy, spId) {
    var sp = BY_ID[spId];
    var wx = env.conditions(lon, lat, t, doy);
    var hab = env.habitat(lon, lat);
    var mv = sp.movement(wx, hab, doy);
    var mig = migration(lon, lat, t, doy, sp, hab, wx.freeze);
    var wxs = weatherScore(wx, sp);
    var w = sp.weights;

    var habModel = hab[sp.habKey];
    var dIdx = distAt(lon, lat, sp.distKey || sp.id);
    var dw = sp.distWeight == null ? 0.3 : sp.distWeight;
    var habV = habModel;
    if (dIdx != null) habV = habModel * ((1 - dw) + dw * dIdx);

    /* RANGE GATE.
       Habitat is only part of the weighted sum, so a cell with zero elk
       habitat still collected sixty-odd points from wind, temperature and
       frontal terms. That is how elk opportunity appeared in Florida. A
       species outside its range does not get a weak score - it gets no
       score, and the renderer leaves the ground blank. */
    var habFloor = sp.habFloor == null ? 0.07 : sp.habFloor;
    var rangeFloor = sp.rangeFloor == null ? 0.02 : sp.rangeFloor;
    var outOfRange = null;
    if (habModel < habFloor) outOfRange = 'habitat';
    else if (dIdx != null && dIdx < rangeFloor) outOfRange = 'records';

    if (outOfRange) {
      return {
        inRange: false, outReason: outOfRange, species: sp,
        opportunity: null, movement: null, migration: null, newBird: null,
        weather: null, habitat: Math.round(habModel * 100), confidence: null,
        pressure: null, wx: wx, hab: hab,
        lon: lon, lat: lat,
        mig: { applies: false, intensity: 0, newBird: 0, pos: [], neg: [] },
        pos: [], neg: [], breakdown: null
      };
    }

    var wMig = mig.applies ? w.mig : 0;
    var total = w.hab + w.move + wMig + w.wx;
    var parts = [
      { k: 'Habitat', v: habV * 100, w: w.hab },
      { k: 'Local movement', v: mv.score, w: w.move },
      { k: 'Migration', v: mig.intensity, w: wMig },
      { k: 'Conditions', v: wxs, w: w.wx }
    ];
    var weighted = (w.hab * habV * 100 + w.move * mv.score + wMig * mig.intensity + w.wx * wxs) / total;

    /* Hunter density was previously computed and then ignored. It belongs in
       the number: a cell an hour from a metro does not hunt like the same
       habitat four hours from one, and species differ in how hard pressure
       hits them. */
    var press = huntingPressure(lon, lat);
    var sens = sp.pressureSens == null ? 0.10 : sp.pressureSens;
    var pressDrop = weighted * sens * press;
    var afterPress = weighted - pressDrop;

    /* Spread the distribution so the map reads as a forecast rather than a
       cloud of mid-fifties. */
    var opp = clamp(Math.round(50 + (afterPress - 51) * 1.42), 1, 99);

    return {
      opportunity: opp,
      movement: Math.round(mv.score),
      migration: Math.round(mig.intensity),
      newBird: Math.round(mig.newBird),
      weather: Math.round(wxs),
      habitat: Math.round(habV * 100),
      confidence: Math.round(confidence(lon, lat, t, wx, hab, sp, press)),
      pressure: Math.round(press * 100),
      wx: wx, hab: hab, mig: mig,
      pos: mv.pos.concat(mig.pos), neg: mv.neg.concat(mig.neg),
      species: sp, inRange: true, outReason: null, lon: lon, lat: lat,
      /* Everything needed to reconstruct the number by hand. */
      breakdown: {
        parts: parts, totalWeight: total, weighted: weighted,
        pressureIdx: press, pressureSens: sens, pressureDrop: pressDrop,
        afterPressure: afterPress, spread: 1.42, pivot: 51, final: opp,
        habModel: habModel * 100, distIdx: dIdx, distWeight: dw, habAdjusted: habV * 100
      }
    };
  }

  /* ---------- Hourly activity curves ---------- */

  function hourlyActivity(spId, h, sunObj, wx) {
    var sp = BY_ID[spId];
    var sr = (sunObj.sunrise || 420) / 60, ss = (sunObj.sunset || 1080) / 60;
    var coldWind = clamp01(ramp(wx.windSpd, 8, 22)) * clamp01(ramp(36 - wx.tempF, 0, 20));
    var a = 0.12;

    if (sp.id === 'canada-goose') {
      a += 1.00 * bell(h - (sr + 1.1), 1.05);
      a += 0.80 * bell(h - (ss - 2.0), 1.25);
      a += 0.35 * coldWind * bell(h - 12.5, 2.4);
    } else if (sp.id === 'elk') {
      a += 1.00 * bell(h - (sr + 0.4), 0.85);
      a += 0.75 * bell(h - (ss - 0.6), 0.8);
      a += 0.30 * Math.exp(-Math.pow((wx.seas), 2)) * bell(h - 12, 2.5);
    } else if (sp.id === 'whitetail') {
      var cold = clamp01(ramp(44 - wx.tempF, 0, 26));
      a += 1.00 * bell(h - (sr + 0.3), 0.9);
      a += 0.95 * bell(h - (ss - 0.5), 0.95);
      a += (0.20 + 0.45 * cold) * bell(h - 11.5, 2.2);       // rut and cold push midday
    } else if (sp.id === 'muledeer') {
      a += 1.00 * bell(h - (sr + 0.5), 1.1);
      a += 0.85 * bell(h - (ss - 0.8), 1.0);
      a += 0.30 * clamp01(ramp(40 - wx.tempF, 0, 24)) * bell(h - 12, 2.6);
    } else if (sp.id === 'moose') {
      a += 1.00 * bell(h - (sr + 0.6), 1.2);
      a += 0.80 * bell(h - (ss - 1.0), 1.1);
      a += 0.35 * clamp01(ramp(44 - wx.tempF, 0, 22)) * bell(h - 12, 2.8);
    } else if (sp.id === 'pronghorn') {
      /* Open-country animals feed and water through the day; the dawn and
         dusk bias is much weaker than for deer. */
      a += 0.80 * bell(h - (sr + 1.0), 1.5);
      a += 0.70 * bell(h - (ss - 1.3), 1.4);
      a += 0.65 * bell(h - 12.5, 3.4);
    } else if (sp.id === 'turkey') {
      a += 1.00 * bell(h - (sr + 0.35), 0.7);                // fly-down gobbling
      a += 0.55 * bell(h - (sr + 2.6), 1.3);                 // mid-morning strutting
      a += 0.45 * bell(h - 12.5, 2.0);
      a += 0.60 * bell(h - (ss - 1.2), 1.2);                 // return to roost
    } else if (sp.id === 'upland') {
      /* Dog work, not animal movement: scent improves once the dew burns off
         and falls away in the heat of the afternoon. */
      a += 0.85 * bell(h - (sr + 1.8), 1.8);
      a += 0.95 * bell(h - (ss - 2.2), 2.0);
      a += 0.45 * bell(h - 12.5, 2.6);
    } else if (sp.id === 'trout') {
      var cold = clamp01(ramp(58 - wx.waterTemp, 0, 12));
      a += (0.35 + 0.75 * cold) * bell(h - 13.0, 2.3);
      a += (0.85 - 0.55 * cold) * bell(h - (sr + 1.4), 1.6);
      a += (0.80 - 0.45 * cold) * bell(h - (ss - 1.2), 1.5);
      a += 0.25 * clamp01(wx.cloud) * bell(h - 11.5, 3.2);
    } else {
      /* Ducks. Dabblers set the dawn and dusk peaks; the midday shoulder is
         the diver and big-water contribution, which is wind-driven. */
      a += 1.00 * bell(h - (sr + 0.55), 1.0);
      a += 0.58 * bell(h - (ss - 0.9), 1.0);
      a += 0.50 * coldWind * bell(h - 12.6, 2.3);
      a += 0.30 * clamp01(ramp(wx.windSpd, 11, 26)) * bell(h - 12.2, 3.0);
      a += 0.22 * clamp01(wx.cloud) * bell(h - 10.5, 2.4);
    }
    return clamp01(a);
  }

  global.OG.models = {
    SPECIES: SPECIES, byId: function (id) { return BY_ID[id]; },
    scoreAt: scoreAt, hourlyActivity: hourlyActivity,
    huntingPressure: huntingPressure, migration: migration
  };
})(window);
