/* OmniGuide - Conditions Engine, Terrain and Habitat Engine, and solar math.
   Raw environment in, interpreted environment out. Every field below is a
   continuous function of (lon, lat, time) so the forecast timeline can be
   scrubbed and animated at fractional days rather than snapped to steps.

   DEMO DATA NOTICE: the atmosphere here is a deterministic synthetic model,
   not an observed forecast. It is physically structured - fronts advance,
   pressure falls ahead of them, freeze-up follows the cold airmass south - so
   the product logic can be exercised end to end. Production replaces
   conditions() with NBM / HRRR / GFS ingestion and keeps everything above it. */
(function (global) {
  'use strict';

  var D2R = Math.PI / 180;
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var bell = function (x, w) { var k = x / w; return Math.exp(-k * k); };
  var gb = function (a, b) { return Math.exp(-(a * a + b * b)); };

  /* ---------- Deterministic noise ---------- */

  var RUN_SEED = (function () {
    var d = new Date();
    return (d.getFullYear() * 1000 + dayOfYear(d)) | 0;
  })();

  function dayOfYear(d) {
    return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  }

  /* Continuous day-of-year for app time t. Every consumer must use this, or
     the same point scores differently depending on who asked. */
  var BASE_DOY = dayOfYear(new Date());
  function doyFor(t) { return BASE_DOY + t; }

  function hash3(x, y, z) {
    var h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
    h = Math.imul(h ^ RUN_SEED, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  function noise3(x, y, z) {
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    var xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
    var c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
    var c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
    var c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
    var c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);
    var a = c000 + (c100 - c000) * xf, b = c010 + (c110 - c010) * xf;
    var c = c001 + (c101 - c001) * xf, d = c011 + (c111 - c011) * xf;
    var e = a + (b - a) * yf, f = c + (d - c) * yf;
    return e + (f - e) * zf;
  }

  function fbm(x, y, z) {
    return noise3(x, y, z) * 0.6 + noise3(x * 2.3, y * 2.3, z * 1.7) * 0.27 +
           noise3(x * 4.9, y * 4.9, z * 2.6) * 0.13;
  }

  /* ---------- Terrain ---------- */

  /* Real elevation where the baked raster covers the point; the drawn
     surface below is the fallback. This matters beyond contours - the
     lapse correction on every forecast readout runs off this number, so
     an invented mountain was an invented temperature. */
  function elevFt(lon, lat) {
    var hg = global.OG && global.OG.habgrid;
    if (hg && hg.elevReady) {
      var real = hg.elevFt(lon, lat);
      if (real != null) return real;
    }
    return elevDrawn(lon, lat);
  }

  /* The pre-raster surface: eleven Gaussian ranges and some noise. Kept
     only so points off the grid still get a plausible number. */
  function elevDrawn(lon, lat) {
    var e = 0;
    e += 9200 * gb((lon + 106.3) / 3.1, (lat - 40.6) / 4.9);   // Southern + Central Rockies
    e += 7000 * gb((lon + 113.2) / 2.7, (lat - 45.2) / 3.9);   // Northern Rockies
    e += 6600 * gb((lon + 119.4) / 1.2, (lat - 38.4) / 3.1);   // Sierra Nevada
    e += 5000 * gb((lon + 117.0) / 4.3, (lat - 39.8) / 2.9);   // Great Basin
    e += 5200 * gb((lon + 109.4) / 3.3, (lat - 36.4) / 2.4);   // Colorado Plateau
    e += 3400 * gb((lon + 121.6) / 0.8, (lat - 45.0) / 3.3);   // Cascades
    e += 3300 * gb((lon + 82.9) / 1.5, (lat - 36.0) / 2.6);    // Southern Appalachians
    e += 2100 * gb((lon + 74.6) / 1.3, (lat - 43.8) / 1.9);    // Adirondacks
    e += 1700 * clamp01((-96.5 - lon) / 7.5) * clamp01((lat - 29) / 6);  // High Plains ramp
    e -= 1400 * gb((lon + 121.0) / 1.4, (lat - 46.6) / 1.3);   // Columbia Basin
    e -= 900 * gb((lon + 91.2) / 1.5, (lat - 34.0) / 3.4);     // Mississippi Alluvial Valley
    e += 900 * (fbm(lon * 0.55, lat * 0.55, 11.3) - 0.5);
    var coast = Math.max(gb((lon + 123.6) / 1.1, (lat - 44) / 7),
                         gb((lon + 76.5) / 1.4, (lat - 36) / 7));
    e *= (1 - 0.55 * coast);
    return clamp(e, 0, 12500);
  }

  /* ---------- Habitat Engine ---------- */

  /* Named habitat complexes. Real places, because a model that cannot tell the
     Prairie Pothole Region from the Bitterroots is not geographic intelligence. */
  var WF_REGIONS = [
    { n: 'Prairie Pothole Region', lon: -99.4, lat: 47.3, rx: 5.4, ry: 2.9, v: 0.74, cls: 'pothole' },
    { n: 'Mississippi Alluvial Valley', lon: -90.9, lat: 34.1, rx: 1.5, ry: 3.4, v: 0.80, cls: 'timber' },
    { n: 'Texas mid-coast rice prairie', lon: -95.9, lat: 29.3, rx: 2.3, ry: 0.9, v: 0.72, cls: 'rice' },
    { n: 'Sacramento Valley', lon: -121.8, lat: 39.1, rx: 0.8, ry: 1.5, v: 0.78, cls: 'rice' },
    { n: 'San Joaquin Valley', lon: -120.3, lat: 36.8, rx: 0.9, ry: 1.4, v: 0.60, cls: 'rice' },
    { n: 'Great Salt Lake marshes', lon: -112.4, lat: 41.3, rx: 0.7, ry: 0.6, v: 0.70, cls: 'marsh' },
    { n: 'Chesapeake Bay', lon: -76.2, lat: 38.4, rx: 0.8, ry: 1.2, v: 0.66, cls: 'coastal' },
    { n: 'Playa Lakes', lon: -101.8, lat: 34.4, rx: 1.5, ry: 1.5, v: 0.55, cls: 'playa' },
    { n: 'Klamath Basin', lon: -121.7, lat: 42.0, rx: 0.6, ry: 0.5, v: 0.72, cls: 'marsh' },
    { n: 'Central Platte', lon: -99.2, lat: 40.8, rx: 2.6, ry: 0.4, v: 0.68, cls: 'river' },
    { n: 'Nebraska Sandhills', lon: -101.2, lat: 42.0, rx: 2.2, ry: 1.0, v: 0.52, cls: 'marsh' },
    { n: 'Missouri Breaks', lon: -107.6, lat: 47.6, rx: 2.4, ry: 0.9, v: 0.54, cls: 'river' },
    { n: 'Yellowstone-Bighorn corridor', lon: -107.6, lat: 45.9, rx: 1.9, ry: 0.7, v: 0.62, cls: 'river' },
    { n: 'Columbia Basin', lon: -119.2, lat: 46.6, rx: 1.3, ry: 0.8, v: 0.60, cls: 'river' },
    { n: 'Snake River Plain', lon: -114.4, lat: 43.0, rx: 2.1, ry: 0.5, v: 0.52, cls: 'river' },
    { n: 'Illinois River valley', lon: -89.9, lat: 40.6, rx: 0.8, ry: 0.9, v: 0.64, cls: 'river' },
    { n: 'Western Lake Erie', lon: -83.2, lat: 41.7, rx: 1.0, ry: 0.5, v: 0.63, cls: 'coastal' },
    { n: 'Horicon and east-central marshes', lon: -88.6, lat: 43.5, rx: 0.9, ry: 0.8, v: 0.55, cls: 'marsh' },
    { n: 'Louisiana coastal marsh', lon: -91.4, lat: 29.6, rx: 2.1, ry: 0.5, v: 0.78, cls: 'coastal' },
    { n: 'Carolina sounds', lon: -76.2, lat: 35.6, rx: 1.0, ry: 0.7, v: 0.58, cls: 'coastal' },
    { n: 'Delmarva and Jersey marsh', lon: -74.9, lat: 39.4, rx: 0.8, ry: 1.0, v: 0.56, cls: 'coastal' },
    { n: 'Grand Prairie rice', lon: -91.4, lat: 34.6, rx: 0.9, ry: 0.8, v: 0.70, cls: 'rice' },
    { n: 'Upper Mississippi pools', lon: -91.3, lat: 43.4, rx: 0.5, ry: 1.8, v: 0.66, cls: 'river' },
    { n: 'Finger Lakes and Montezuma', lon: -76.7, lat: 43.0, rx: 0.7, ry: 0.5, v: 0.48, cls: 'marsh' },
    { n: 'Tennessee River reservoirs', lon: -87.9, lat: 35.6, rx: 1.4, ry: 0.8, v: 0.52, cls: 'reservoir' },
    { n: 'Red River valley', lon: -96.8, lat: 47.3, rx: 0.6, ry: 1.8, v: 0.60, cls: 'pothole' },
    { n: 'Devils Lake basin', lon: -98.9, lat: 48.1, rx: 0.9, ry: 0.6, v: 0.72, cls: 'pothole' },
    { n: 'Salt Plains and Great Salt Plains', lon: -98.2, lat: 36.8, rx: 1.1, ry: 0.7, v: 0.50, cls: 'reservoir' },
    { n: 'Katy and Eagle Lake prairie', lon: -96.3, lat: 29.6, rx: 0.8, ry: 0.5, v: 0.62, cls: 'rice' }
  ];

  /* Named trout waters: what the river is called and what kind of water
     it is. Not where trout are - that is measured now. The list lives
     in js/trout-waters.js because the raster build reads it as well. */
  var TROUT_WATERS = global.US_TROUT_WATERS || [];

  /* Big game and upland range. Same approach as the waterfowl complexes:
     named country placed where the animals actually are, then shaped by
     terrain rather than drawn as flat state-level polygons. */
  var GAME_REGIONS = [
    { k: 'moose', lon: -69.3, lat: 45.6, rx: 1.6, ry: 1.1, v: 0.85 },
    { k: 'moose', lon: -71.6, lat: 44.4, rx: 0.9, ry: 0.7, v: 0.60 },
    { k: 'moose', lon: -74.3, lat: 44.1, rx: 0.9, ry: 0.6, v: 0.50 },
    { k: 'moose', lon: -92.0, lat: 47.9, rx: 1.6, ry: 0.9, v: 0.70 },
    { k: 'moose', lon: -88.5, lat: 46.5, rx: 1.6, ry: 0.7, v: 0.45 },
    { k: 'moose', lon: -113.5, lat: 46.5, rx: 2.2, ry: 2.0, v: 0.75 },
    { k: 'moose', lon: -110.0, lat: 43.8, rx: 1.6, ry: 1.4, v: 0.80 },
    { k: 'moose', lon: -106.3, lat: 40.6, rx: 1.2, ry: 1.0, v: 0.65 },
    { k: 'moose', lon: -110.0, lat: 40.7, rx: 0.9, ry: 0.6, v: 0.50 },

    { k: 'pronghorn', lon: -107.5, lat: 42.3, rx: 3.0, ry: 2.0, v: 0.95 },
    { k: 'pronghorn', lon: -105.5, lat: 46.0, rx: 2.6, ry: 1.6, v: 0.75 },
    { k: 'pronghorn', lon: -103.5, lat: 43.5, rx: 1.8, ry: 1.4, v: 0.60 },
    { k: 'pronghorn', lon: -103.8, lat: 39.5, rx: 2.0, ry: 1.6, v: 0.60 },
    { k: 'pronghorn', lon: -105.0, lat: 34.5, rx: 2.2, ry: 1.8, v: 0.65 },
    { k: 'pronghorn', lon: -117.5, lat: 41.0, rx: 2.2, ry: 1.6, v: 0.55 },
    { k: 'pronghorn', lon: -102.5, lat: 31.8, rx: 1.6, ry: 1.2, v: 0.50 },
    { k: 'pronghorn', lon: -119.5, lat: 43.0, rx: 1.6, ry: 1.2, v: 0.50 },

    { k: 'upland', lon: -99.0, lat: 45.3, rx: 3.0, ry: 2.2, v: 0.95 },
    { k: 'upland', lon: -99.5, lat: 40.5, rx: 2.6, ry: 1.6, v: 0.80 },
    { k: 'upland', lon: -98.5, lat: 38.5, rx: 2.4, ry: 1.6, v: 0.75 },
    { k: 'upland', lon: -94.5, lat: 42.3, rx: 1.8, ry: 1.2, v: 0.65 },
    { k: 'upland', lon: -95.5, lat: 44.5, rx: 1.6, ry: 1.2, v: 0.70 },
    { k: 'upland', lon: -100.0, lat: 36.5, rx: 2.2, ry: 1.6, v: 0.70 },
    { k: 'upland', lon: -99.5, lat: 32.5, rx: 2.4, ry: 1.8, v: 0.75 },
    { k: 'upland', lon: -84.5, lat: 31.5, rx: 1.8, ry: 1.2, v: 0.55 },
    { k: 'upland', lon: -92.0, lat: 47.0, rx: 2.0, ry: 1.2, v: 0.60 },
    { k: 'upland', lon: -89.0, lat: 45.6, rx: 1.6, ry: 1.0, v: 0.55 },
    { k: 'upland', lon: -69.5, lat: 45.5, rx: 1.6, ry: 1.0, v: 0.50 },
    { k: 'upland', lon: -108.5, lat: 42.5, rx: 2.4, ry: 1.8, v: 0.50 },
    { k: 'upland', lon: -116.5, lat: 42.5, rx: 2.0, ry: 1.4, v: 0.45 },
    { k: 'upland', lon: -118.5, lat: 46.5, rx: 1.4, ry: 1.0, v: 0.60 },

    { k: 'turkey', lon: -92.5, lat: 37.5, rx: 2.2, ry: 1.8, v: 0.90 },
    { k: 'turkey', lon: -86.5, lat: 34.5, rx: 2.6, ry: 2.2, v: 0.85 },
    { k: 'turkey', lon: -98.8, lat: 30.5, rx: 1.6, ry: 1.2, v: 0.90 },
    { k: 'turkey', lon: -78.0, lat: 41.3, rx: 1.8, ry: 1.2, v: 0.70 },
    { k: 'turkey', lon: -90.5, lat: 43.5, rx: 1.6, ry: 1.2, v: 0.65 },
    { k: 'turkey', lon: -103.7, lat: 44.0, rx: 0.9, ry: 0.7, v: 0.70 },
    { k: 'turkey', lon: -121.5, lat: 39.5, rx: 1.2, ry: 1.4, v: 0.60 },
    { k: 'turkey', lon: -110.5, lat: 34.5, rx: 1.4, ry: 1.0, v: 0.50 },
    { k: 'turkey', lon: -83.5, lat: 37.5, rx: 1.8, ry: 1.2, v: 0.70 },
    { k: 'turkey', lon: -96.5, lat: 42.5, rx: 1.6, ry: 1.2, v: 0.60 },

    { k: 'whitetail', lon: -90.0, lat: 40.0, rx: 3.2, ry: 2.6, v: 0.90 },
    { k: 'whitetail', lon: -85.0, lat: 39.5, rx: 2.6, ry: 2.2, v: 0.85 },
    { k: 'whitetail', lon: -94.0, lat: 44.0, rx: 2.2, ry: 1.8, v: 0.80 },
    { k: 'whitetail', lon: -77.5, lat: 41.5, rx: 2.0, ry: 1.6, v: 0.80 },
    { k: 'whitetail', lon: -88.5, lat: 33.0, rx: 2.4, ry: 2.0, v: 0.80 },
    { k: 'whitetail', lon: -98.5, lat: 29.5, rx: 2.0, ry: 1.6, v: 0.85 },
    { k: 'whitetail', lon: -80.5, lat: 35.0, rx: 2.2, ry: 1.8, v: 0.70 },
    { k: 'whitetail', lon: -97.0, lat: 46.0, rx: 1.8, ry: 1.6, v: 0.55 },
    { k: 'whitetail', lon: -104.5, lat: 46.5, rx: 1.6, ry: 1.2, v: 0.45 },

    { k: 'muledeer', lon: -108.0, lat: 41.5, rx: 2.6, ry: 2.2, v: 0.85 },
    { k: 'muledeer', lon: -110.5, lat: 38.5, rx: 2.2, ry: 1.8, v: 0.80 },
    { k: 'muledeer', lon: -112.5, lat: 45.0, rx: 2.2, ry: 1.8, v: 0.75 },
    { k: 'muledeer', lon: -117.0, lat: 41.5, rx: 2.4, ry: 1.8, v: 0.60 },
    { k: 'muledeer', lon: -107.0, lat: 36.5, rx: 2.0, ry: 1.6, v: 0.65 },
    { k: 'muledeer', lon: -120.0, lat: 41.0, rx: 1.6, ry: 1.4, v: 0.60 },
    { k: 'muledeer', lon: -119.5, lat: 45.0, rx: 1.8, ry: 1.4, v: 0.60 },
    { k: 'muledeer', lon: -103.5, lat: 45.5, rx: 1.8, ry: 1.4, v: 0.50 }
  ];

  var habCache = new Map();

  var KIND_DEFINITE = { rice: 1, coastal: 1, marsh: 1, reservoir: 1 };
  var REGION_KEEPS = { pothole: 1, playa: 1, timber: 1 };

  function habitat(lon, lat) {
    var key = (Math.round(lon * 40) * 4096 + Math.round(lat * 40));
    var hit = habCache.get(key);
    if (hit) return hit;

    var elev = elevFt(lon, lat);
    var detail = fbm(lon * 1.9, lat * 1.9, 3.7);
    var corridor = Math.pow(1 - Math.abs(fbm(lon * 0.9, lat * 0.9, 7.1) - 0.5) * 2, 6);

    var wf = 0.10 + corridor * 0.30, cls = 'upland', region = null, best = 0;
    for (var i = 0; i < WF_REGIONS.length; i++) {
      var r = WF_REGIONS[i];
      var w = r.v * gb((lon - r.lon) / r.rx, (lat - r.lat) / r.ry);
      wf += w * 0.85;
      if (w > best) { best = w; if (w > 0.12) { cls = r.cls; region = r.n; } }
    }
    wf += (detail - 0.5) * 0.22;

    /* Where there is actually marsh and open water, from NLCD. This
       replaces an elevation damping that read 1.25 - elev/7000 and so
       zeroed everything above 8750 ft. That rule took out Monte Vista
       NWR in the San Luis Valley, North Park and Jackson Hole - all
       high, all famous for ducks - because elevation cannot tell a
       mountain marsh from a mountain. Cover can. */
    var cov = (global.OG && global.OG.openwater && global.OG.openwater.cover)
      ? global.OG.openwater.cover(lon, lat) : null;
    if (cov) {
      var marsh = clamp01(cov.wetland / 0.22);
      var openw = clamp01(cov.water / 0.14);
      wf = clamp01(0.45 * wf + 0.75 * clamp01(0.75 * marsh + 0.55 * openw));
    }

    /* A real alpine limit, well above the valleys. Rock and ice above
       treeline hold nothing, and this is where that is true. */
    wf *= clamp01((11800 - elev) / 2500);
    wf = clamp01(wf);

    var trout = 0, tw = null, tbest = 0, tcls = null;
    for (var j = 0; j < TROUT_WATERS.length; j++) {
      var q = TROUT_WATERS[j];
      var v = q.v * gb((lon - q.lon) / q.rx, (lat - q.lat) / q.ry);
      trout += v * 0.9;
      /* The name, and the kind of water. Claimed out to about the edge
         of the reach as listed and no further: at 0.30 that is where a
         typical entry stops. It was 0.15, which carried a name to 1.3
         times its reach - tolerable with twenty waters far apart, not
         with fifty, some of them neighbours. */
      if (v > tbest) { tbest = v; if (v > 0.30) { tw = q.n; tcls = q.cls; } }
    }
    trout += clamp01((elev - 3500) / 4000) * 0.30 * corridor;
    trout += clamp01((45 - lat) / 10) * 0 + (detail - 0.5) * 0.10;
    trout = clamp01(trout);

    /* Upper limit raised from 10500 ft, which with real elevation in
       place was zeroing the Sawatch, the Mosquito Range and the San
       Juans - cells reading 10500 to 11600 ft that carry some of the
       highest elk densities on the continent. Elk hold to treeline and
       feed in alpine basins above it well into the early seasons. */
    var elk = clamp01((elev - 4200) / 3200) * clamp01((13200 - elev) / 2800);
    elk *= 0.55 + 0.6 * corridor + 0.3 * (detail - 0.5);
    elk = clamp01(elk * 1.35);

    var g = { moose: 0, pronghorn: 0, upland: 0, turkey: 0, whitetail: 0, muledeer: 0 };
    for (var gi = 0; gi < GAME_REGIONS.length; gi++) {
      var gr = GAME_REGIONS[gi];
      g[gr.k] += gr.v * gb((lon - gr.lon) / gr.rx, (lat - gr.lat) / gr.ry);
    }

    var openness = clamp01(1 - elev / 6000) * clamp01((lon + 118) / 14 + 0.45);
    var lowland = clamp01(1.3 - elev / 6000);
    var midElev = clamp01((elev - 2500) / 2500) * clamp01((10500 - elev) / 3200);
    var wet = clamp01(wf * 0.8 + corridor * 0.5);

    var whitetail = clamp01((0.10 + corridor * 0.26 + g.whitetail * 0.85) * lowland +
                            (detail - 0.5) * 0.14);
    var muledeer = clamp01(g.muledeer * 0.95 * (0.45 + 0.75 * midElev) +
                           (detail - 0.5) * 0.14);
    var moose = clamp01(g.moose * (0.55 + 0.6 * wet) + (detail - 0.5) * 0.12);
    var turkey = clamp01((0.07 + g.turkey * 0.92 + corridor * 0.20) *
                         clamp01(1.25 - elev / 9000) + (detail - 0.5) * 0.14);
    var upland = clamp01(0.05 + g.upland * 0.92 + openness * 0.12 + (detail - 0.5) * 0.16);
    var pronghorn = clamp01(g.pronghorn * 0.95 * (0.5 + 0.6 * openness) +
                            (detail - 0.5) * 0.12);
    /* No hand-drawn surface for bear; if the raster is missing, timbered
       game country stands in for it. */
    var bear = clamp01(0.5 * turkey + 0.3 * moose + 0.2 * elk);

    /* REAL HABITAT OVERRIDE.

       Everything above this point is invented - Gaussian blobs over fractal
       noise, which is why White River, Colorado used to read 19 out of 100
       for elk. Where the baked raster covers the point (NLCD land cover and
       elevation for quality, GBIF occurrence share for presence, 11 km) its
       value wins outright. The synthetic surface stays as the fallback for
       points off the grid and for the case where the raster has not loaded,
       because a missing file should not read as "no animals here".

       Trout comes from the raster too. It was the last thing left on a
       hand-made surface - twenty rivers drawn as ovals - and that surface
       found 27 of 57 well-known trout waters. The trout plane is cold
       water, measured where a gauge measures it, times the places trout
       are recorded; see the trout section of ingest/habitat.mjs. The
       ovals above still say what a river is called and whether it is a
       tailwater, and nothing else. */
    var hg = global.OG && global.OG.habgrid;
    var realSrc = {};
    /* Geese are scored on field feed within reach of a roost, not on the
       duck surface. null until the raster answers; falls back below. */
    var goose = null;
    if (hg && hg.ready) {
      var r;
      if ((r = hg.at('waterfowl', lon, lat)) != null) { wf = r; realSrc.waterfowl = true; }
      if ((r = hg.at('goose', lon, lat)) != null) { goose = r; realSrc.goose = true; }
      if ((r = hg.at('elk', lon, lat)) != null) { elk = r; realSrc.elk = true; }
      if ((r = hg.at('whitetail', lon, lat)) != null) { whitetail = r; realSrc.whitetail = true; }
      if ((r = hg.at('muledeer', lon, lat)) != null) { muledeer = r; realSrc.muledeer = true; }
      if ((r = hg.at('moose', lon, lat)) != null) { moose = r; realSrc.moose = true; }
      if ((r = hg.at('turkey', lon, lat)) != null) { turkey = r; realSrc.turkey = true; }
      if ((r = hg.at('upland', lon, lat)) != null) { upland = r; realSrc.upland = true; }
      if ((r = hg.at('pronghorn', lon, lat)) != null) { pronghorn = r; realSrc.pronghorn = true; }
      if ((r = hg.at('bear', lon, lat)) != null) { bear = r; realSrc.bear = true; }
      if ((r = hg.at('trout', lon, lat)) != null) { trout = r; realSrc.trout = true; }
      /* The kind of water, from land cover. The regions above were the
         only source, and outside them everywhere read as "any reliable
         open water". Inside one, land cover still wins where it reads
         something definite - the Sacramento Valley region had Suisun
         Marsh down as rice, and the Texas rice prairie had Matagorda
         Bay - but not over the three kinds a region knows better:
         potholes and playas, which land cover has no name for, and
         flooded timber, which it sees as the rice round it. Nor does
         it get to call a region timber: it read the pocosin round
         Lake Mattamuskeet and Currituck Sound that way. */
      var kind = hg.waterKindAt ? hg.waterKindAt(lon, lat) : null;
      if (kind && (!region || (KIND_DEFINITE[kind] && !REGION_KEEPS[cls]))) cls = kind;
    }
    if (goose == null) goose = wf;

    var out = {
      lon: lon, lat: lat,
      elev: elev, waterfowl: wf, goose: goose, trout: trout, elk: elk,
      whitetail: whitetail, muledeer: muledeer, moose: moose,
      turkey: turkey, upland: upland, pronghorn: pronghorn, bear: bear,
      cls: cls, region: region, water: tw, waterCls: tcls,
      openness: openness, realHab: realSrc,
      /* Evidence that water here stays open when it turns hard - see
         openwater.js. Read lazily because the gauge data loads after
         this file. */
      openWater: (global.OG && global.OG.openwater) ? global.OG.openwater.at(lon, lat) : 0
    };
    if (habCache.size > 60000) habCache.clear();
    habCache.set(key, out);
    return out;
  }

  /* ---------- Fronts and the synoptic pattern ---------- */

  /* Two systems cross the country during the forecast window. Each is a tilted
     line sliding southeast; "d" is degrees north of the frontal boundary, so
     d > 0 is the cold airmass behind it. */
  var FRONTS = [
    { start: 10.0, speed: 2.05, strength: 1.0 },
    { start: -0.5, speed: 1.75, strength: 0.72 },
    { start: 22.0, speed: 1.90, strength: 0.64 }
  ];

  /* Degrees of latitude a boundary travels before the next one forms
     behind it. At these speeds that puts a frontal passage through any
     given place every five to seven days, which is about what the real
     synoptic pattern does. */
  var FRONT_CYCLE = 36;

  function frontDist(f, lon, lat, t) {
    var travelled = f.start + f.speed * t;
    /* Recurring, not a single boundary sweeping past once and never
       coming back. Unwrapped, travelled reached 126 degrees by day 60,
       every front sat permanently off the map, and the synthetic weather
       past about three weeks had no synoptic variability left in it at
       all - which is most of what the Day baseline and the whole
       seasonal planner are built on. */
    var phase = ((travelled % FRONT_CYCLE) + FRONT_CYCLE) % FRONT_CYCLE;
    var latLine = 54.5 - phase + 0.30 * (lon + 100);
    return lat - latLine;
  }

  function seasonalIndex(doy) { return -Math.cos((doy - 14) / 365.25 * 2 * Math.PI); }

  /* Fast core used for finite-difference trends. */
  function core(lon, lat, t, doy) {
    var seas = seasonalIndex(doy);
    var elev = habitat(lon, lat).elev;

    /* Base temperature from NOAA 1991-2020 normals where they reach,
       with the hand-fitted curve kept only as a fallback. The fitted one
       ran about 35 degrees cold in a northern winter - Devils Lake in
       early January came out at -29 F against a true normal of 8 F -
       which pinned the freeze index at 1.0 from early December and, once
       the freeze lockout went in, flattened every late-season waterfowl
       score in the north. */
    var base, dayRange = null;
    var cl = (global.OG && global.OG.climo)
      ? global.OG.climo.at(lon, lat, global.OG.climo.weekOf(doy), elev) : null;
    if (cl) {
      base = cl.tmean;
      dayRange = cl.tmax - cl.tmin;
    } else {
      base = 60 + 27 * seas - (lat - 37) * (1.95 - 0.55 * seas) - elev / 1000 * 3.4;
      var coastal = Math.max(gb((lon + 123.4) / 1.6, (lat - 44) / 8), gb((lon + 77.0) / 1.8, (lat - 36) / 9) * 0.7);
      base = base * (1 - 0.3 * coastal) + (56 + 10 * seas) * 0.3 * coastal;
    }

    var tAnom = 0, pAnom = 0, wBell = 0, dMain = 0;
    for (var i = 0; i < FRONTS.length; i++) {
      var f = FRONTS[i], d = frontDist(f, lon, lat, t);
      if (i === 0) dMain = d;
      var behind = 0.5 + 0.5 * Math.tanh(d / 2.1);
      /* Centred on zero. This read -17 * behind, which is 0 ahead of the
         boundary and -17 behind it, so its average over any stretch of
         time was about -8 per front and the fronts stacked. A frontal
         anomaly is weather moving through, not a standing cold bias on
         top of the climate. */
      /* Both anomalies are windowed by distance so a boundary on the
         far side of the country contributes nothing. They used to use a
         bare tanh, which saturates: a front 120 degrees away still
         handed back its full value, so the "anomalies" were a standing
         offset of about -15 F and +9 hPa rather than weather. */
      var near = bell(d, 6.0);
      tAnom += f.strength * near * (-17 * Math.tanh(d / 2.1) + 6 * bell(d + 2.0, 2.4));
      pAnom += f.strength * near * (9 * Math.tanh(d / 3.4) - 10 * bell(d + 1.2, 2.2));
      wBell = Math.max(wBell, f.strength * bell(d + 0.4, 2.6));
    }
    var nz = fbm(lon * 0.42, lat * 0.42, t * 0.34 + 2.5);

    /* Shape of the day. Reporting one flat temperature for twenty-four
       hours told every user that dawn feels like mid-afternoon, which in
       an app built around the first and last hour of light is the wrong
       thing to be wrong about. */
    var diur = 0;
    if (dayRange != null && global.OG.climo) {
      diur = global.OG.climo.diurnal((t - Math.floor(t)) * 24) * dayRange * 0.5;
    }
    var temp = base + diur + tAnom + (nz - 0.5) * 11;
    var press = 1013 + pAnom + (fbm(lon * 0.3, lat * 0.3, t * 0.3 + 9) - 0.5) * 7;
    return { temp: temp, press: press, wBell: wBell, d: dMain, seas: seas, nz: nz, elev: elev };
  }

  /* ---------- Real forecast path ---------- */

  var RB = [{}, {}, {}, {}, {}];

  function lapsed(s, terrainFt) {
    return s.T + (s.gelev - terrainFt) * 0.00357;
  }

  /* ---------- Ice ----------

     Whether the water is frozen was decided from the last two days of
     air temperature and nothing else: thirty degrees and falling read
     as freezing up, anything milder as open. That has no memory. A
     Minnesota marsh on the twentieth of January came out 83 percent
     open because the afternoon touched 28 F, and Iowa at 10 F read
     mostly open because the day before had been warm. With the freeze
     lockout keyed to that number, the frozen north scored as some of
     the best duck hunting in the country every time a front went
     through it in midwinter.

     Ice is an accumulation. This keeps a running balance of freezing
     and thawing degree-days over the seven weeks before the date, from
     the 1991-2020 normals, and then adds the last few days at whatever
     the temperature actually is. A cold snap still locks shallow water
     quickly, a week of thaw still opens it, and one mild afternoon in
     January does nothing at all.

     The base is 34 F on the daily mean rather than 32, because skim
     ice is made by the nights and a day that averages 34 has had a
     hard frost in it. Scaled so that about a week averaging in the
     middle twenties closes shallow marsh, which is what it takes.

     The past weeks are normals, not what happened. In a notably warm
     December this will call water frozen that is still open. Real
     recent temperatures would fix that and are not in the feed yet. */
  var ICE_BASE = 34;
  var iceCache = new Map();

  function iceIdx(ice) { return clamp01((ice - 10) / 90); }

  /* Balance through the end of last week, and what the index would
     have read a week ago in a normal year. Both depend only on the
     place and the week, so they are worked out once. */
  function iceMemory(lon, lat, wk, elev, offset) {
    var C = global.OG && global.OG.climo;
    if (!C || !C.available()) return null;
    var key = 0;
    if (!offset) {
      key = (Math.round(lon * 4) + 1000) * 100000 + Math.round(lat * 4) * 100 + wk;
      var hit = iceCache.get(key);
      if (hit !== undefined) return hit;
    }
    var ice = 0, before = 0, lastNormal = 0, out = null;
    for (var i = 7; i >= 1; i--) {
      var c = C.at(lon, lat, wk - i, elev);
      if (!c) { ice = -1; break; }
      var tm = c.tmean + (offset || 0);
      if (i === 1) { before = ice; lastNormal = tm; }
      ice = Math.max(0, ice + 7 * (ICE_BASE - tm));
    }
    if (ice >= 0) out = { bal: ice, weekAgo: iceIdx(Math.max(0, before + 3 * (ICE_BASE - lastNormal))) };
    if (!offset) iceCache.set(key, out);
    return out;
  }

  /* 0 open, 1 locked. offset shifts the whole preceding period, for
     asking what a notably warm or cold year looks like. */
  function freezeIndex(lon, lat, doy, elev, meanT, snowDepth, offset) {
    var C = global.OG && global.OG.climo;
    var m = C && C.available() ? iceMemory(lon, lat, C.weekOf(doy), elev, offset) : null;
    var f = m ? iceIdx(Math.max(0, m.bal + 3 * (ICE_BASE - meanT)))
              : clamp01((30 - meanT) / 13) * (seasonalIndex(doy) < 0.15 ? 1 : 0.2);
    return clamp01(f + (snowDepth || 0) * 0.25);
  }

  /* How far past merely frozen: 0 at the point shallow water has just
     locked, 1 after the kind of cold that puts a foot of ice on a
     river. The index above stops at 1 long before that. */
  function freezeDepth(lon, lat, doy, elev, meanT, offset) {
    var C = global.OG && global.OG.climo;
    var m = C && C.available() ? iceMemory(lon, lat, C.weekOf(doy), elev, offset) : null;
    if (!m) return 0;
    return clamp01((m.bal + 3 * (ICE_BASE - meanT) - 100) / 300);
  }

  /* How much further frozen this place is than it was a week ago. This
     is what moves birds: not the north being frozen, which it is all
     winter, but the week it freezes. */
  function freezeGain(lon, lat, doy, elev, freezeNow) {
    var C = global.OG && global.OG.climo;
    var m = C && C.available() ? iceMemory(lon, lat, C.weekOf(doy), elev, 0) : null;
    return m ? Math.max(0, freezeNow - m.weekAgo) : 0;
  }

  /* Water temperature from the air around it, where nothing has
     measured it. Tailwaters and spring creeks are held close to a
     seasonal value; everything else follows the air. */
  /* Day of year at the moment a gauge was read, given the day of year
     at app time t. */
  function env_doyAt(tObs, doy, t) { return doy - (t - tObs); }

  /* FITTED, NOT GUESSED.

     The first version was 0.62 of the last two days of air temperature
     plus sixteen, then pulled a third of the way toward a fixed 46.
     Checked against every gauge in the feed that reports water
     temperature - 2105 of them on one October evening - it ran 9.5 F
     cold on average and barely moved: 52 where the water was 40, 59
     where it was 80. Typical miss 11 F. It put Arkansas backwater at
     51 in the first week of October.

     A straight line on the normal mean air temperature for the week
     does twice as well: 17.5 + 0.787 x normal, typical miss 5.5 F,
     and the same 5.5 on gauges held out of the fit. Water follows the
     season, not the afternoon. Adding how far the last two days ran
     from normal changed nothing (coefficient -0.08), and neither did
     elevation beyond what the normal already carries, so they are
     not in it.

     Two limits. It is fitted to one evening, near the warm end of
     the daily swing, so it reads a couple of degrees high for dawn.
     And it cannot see a cold snap: between gauges the estimate moves
     with the calendar and not with the weather. Where a gauge is in
     reach none of this is used.

     Named tailwaters and spring creeks are still held toward a cold
     seasonal value, by hand, because a release from the bottom of a
     reservoir does not follow the air at all. */
  function modelWaterTemp(meanT, hb, doy, lon, lat) {
    var C = global.OG && global.OG.climo;
    var cl = (C && C.available() && lon != null) ? C.at(lon, lat, C.weekOf(doy), hb.elev) : null;
    var w = cl ? clamp(17.5 + 0.787 * cl.tmean, 32, 90)
               : clamp(0.62 * meanT + 16 - (hb.elev / 1000) * 0.8, 32, 80);
    var buffer = hb.waterCls === 'tailwater' ? 0.72 : hb.waterCls === 'spring' ? 0.80 : 0;
    return buffer ? w * (1 - buffer) + (46 + 6 * seasonalIndex(doy)) * buffer : w;
  }

  function conditionsReal(lon, lat, t, doy) {
    var W = global.OG.wx;
    var hb = habitat(lon, lat);
    var step = W.stepFor(lon, lat, t);

    var a = W.sample(lon, lat, step, RB[0]);
    var b = W.sample(lon, lat, step - 8, RB[1]);        // 24 hours earlier
    var c = W.sample(lon, lat, step + 1, RB[2]);        // 3 hours later

    var tempF = lapsed(a, hb.elev);
    var tempPrev = lapsed(b, hb.elev);
    var temp24 = tempF - tempPrev;
    var pressTrend = c.P - a.P;                          // hPa per 3 hours

    var snowDepth = clamp01(a.SD / 0.8);                 // feet, 10 inches reads as full cover
    var snowObserved = false, snowInches = a.SD * 12;

    /* SNODAS assimilates observations, so for today it beats the forecast
       model's own snow field. It does not predict, so only today. */
    var SN = global.OG.snow;
    if (SN && SN.available() && t < 1) {
      var mm = SN.depthMm(lon, lat);
      if (mm != null) {
        snowInches = mm / 25.4;
        snowDepth = clamp01(snowInches / 10);
        snowObserved = true;
      }
    }
    var meanT = (tempF + tempPrev) / 2;
    var freeze = freezeIndex(lon, lat, doy, hb.elev, meanT, snowDepth);
    var freezeDeep = freezeDepth(lon, lat, doy, hb.elev, meanT, 0);

    /* No frontal analysis field in the feed, so a passage is inferred from the
       signature it leaves: a sharp temperature fall with a pressure kick. */
    var frontal = clamp01(0.65 * clamp01(-temp24 / 13) + 0.35 * clamp01(Math.abs(pressTrend) / 2.5));

    var waterTemp = modelWaterTemp(meanT, hb, doy, lon, lat);

    var flowIdx = clamp01(0.45 + 0.35 * Math.sin((doy - 80) / 365 * 2 * Math.PI) +
      (fbm(lon * 0.6, lat * 0.6, 31) - 0.5) * 0.5);
    var flowReal = false, gaugeInfo = null;

    /* A nearby gauge is a measurement, and a measurement beats a model.

       For today the reading is used as it stands. For the days after
       it used to be discarded altogether, on the reasoning that a
       reading taken an hour ago says nothing about Thursday - which
       left a formula to speak for a river with a thermometer in it.
       On the Madison at Ennis the formula said 43 F on a day the
       gauge seven miles off read 60, and the plan for the next
       morning told the angler the water was too cold for fish to
       feed.

       A river does not forget overnight. What the formula gets wrong
       is mostly the place - a lake upstream, a dam, a spring - and
       that error is the same tomorrow. So a forecast day keeps the
       formula's change over time and takes its level from the gauge:
       the modelled value for the hour in question, plus whatever the
       formula was off by at the moment the gauge was read. Discharge
       is carried forward as measured; there is no runoff model here
       that would improve on it. */
    var GA = global.OG.gauges;
    var gaugeCarried = false;
    if (GA && GA.available()) {
      var g = GA.at(lon, lat);
      if (g && t >= 1) {
        var tObs = W.tAt && g.fetched ? W.tAt(lon, lat, Date.parse(g.fetched)) : NaN;
        /* A file from last week is not a current reading. */
        if (!(tObs > -1.5 && tObs < 1.5)) g = null;
        else {
          gaugeCarried = true;
          if (g.waterTempF != null) {
            var so = W.stepFor(lon, lat, tObs);
            var o1 = lapsed(W.sample(lon, lat, so, RB[3]), hb.elev);
            var o2 = lapsed(W.sample(lon, lat, so - 8, RB[4]), hb.elev);
            waterTemp = clamp(waterTemp + g.waterTempF -
              modelWaterTemp((o1 + o2) / 2, hb, env_doyAt(tObs, doy, t), lon, lat), 32, 90);
          }
        }
      }
      if (g) {
        gaugeInfo = g;
        if (g.waterTempF != null && !gaugeCarried) waterTemp = g.waterTempF;
        if (g.cfs != null) {
          /* The reading is reported, and that is all.

             This line used to set the flow index to log10(cfs) / 4.2
             and call it the gauge's position within its own range. It
             is nothing of the kind: it is the size of the river. The
             Madison at a perfectly ordinary 991 cfs came out at 0.71
             and the plan called it rising, off-colour water; every
             large trout river read as permanently blown out and every
             small creek as permanently low.

             Whether a river is high depends on what is normal for that
             gauge at that time of year, and the feed does not carry it.
             USGS publishes it (the statistics service, daily medians
             per site). Until that is ingested the index stays on the
             seasonal estimate, which at least does not confuse big
             with high. */
          flowReal = true;
        }
      }
    }

    return {
      tempF: tempF, temp24: temp24, pressure: a.P, pressTrend: pressTrend,
      windFrom: a.WD, windSpd: a.WS, gust: Math.max(a.WG, a.WS),
      cloud: clamp01(a.CC / 100), precip: clamp01(a.PR / 0.08),
      snow: clamp01(a.SF / 0.4), snowDepth: snowDepth,
      freeze: freeze, freezeDeep: freezeDeep, waterTemp: waterTemp, flowIdx: flowIdx, flowReal: flowReal,
      /* True only when the index says where this river stands against its
         own normal. Nothing sets it yet: the index is a seasonal guess,
         and everything that would call the water high or low waits on it. */
      flowJudged: false,
      gauge: gaugeInfo, gaugeCarried: gaugeCarried, snowObserved: snowObserved, snowInches: snowInches,
      frontal: frontal, elev: hb.elev, seas: seasonalIndex(doy), real: true,
      precipIn: a.PR, snowDepthFt: a.SD
    };
  }

  function probeReal(lon, lat, t, doy) {
    var W = global.OG.wx;
    var hb = habitat(lon, lat);
    var step = W.stepFor(lon, lat, t);
    var a = W.sample(lon, lat, step, RB[0]);
    var tNow = lapsed(a, hb.elev);
    var b = W.sample(lon, lat, step - 8, RB[1]);
    var tPrev = lapsed(b, hb.elev);
    var meanT = (tNow + tPrev) / 2;
    var frz = freezeIndex(lon, lat, doy, hb.elev, meanT, clamp01(a.SD / 0.8));
    return {
      temp: tNow, temp24: tNow - tPrev,
      freeze: frz, freezeGain: freezeGain(lon, lat, doy, hb.elev, frz),
      windFrom: a.WD, windSpd: a.WS, press: a.P,
      snow: clamp01(a.SD / 0.8)
    };
  }

  /* ---------- Synthetic fallback ---------- */

  function conditionsSynthetic(lon, lat, t, doy) {
    var now = core(lon, lat, t, doy);
    var prev = core(lon, lat, t - 1, doy - 1);
    var soon = core(lon, lat, t + 0.125, doy);

    var tempF = now.temp;
    var temp24 = now.temp - prev.temp;
    var pressTrend = (soon.press - now.press) / 0.125 * 0.125;   // hPa per 3 hours

    /* Wind: southerly ahead of the boundary, northwest behind it. */
    var behind = 0.5 + 0.5 * Math.tanh(now.d / 2.1);
    var ax = Math.sin(190 * D2R), ay = Math.cos(190 * D2R);
    var bx = Math.sin(318 * D2R), by = Math.cos(318 * D2R);
    var vx = ax * (1 - behind) + bx * behind, vy = ay * (1 - behind) + by * behind;
    var windFrom = (Math.atan2(vx, vy) / D2R + 360) % 360;
    windFrom += (fbm(lon * 0.8, lat * 0.8, t * 0.5 + 4) - 0.5) * 40;
    windFrom = (windFrom + 360) % 360;

    var openness = habitat(lon, lat).openness;
    var windSpd = 5 + 17 * now.wBell + 7 * openness + (now.nz - 0.5) * 9;
    windSpd = clamp(windSpd, 1, 42);
    var gust = windSpd * (1.32 + 0.22 * now.nz);

    var cloudNoise = fbm(lon * 0.5, lat * 0.5, t * 0.45 + 17);
    var cloud = clamp01(0.22 + 0.9 * bell(now.d + 1.0, 3.2) + (cloudNoise - 0.5) * 0.95);
    var precip = clamp01((bell(now.d + 0.6, 1.5) * 1.1 + (cloudNoise - 0.62)) * 1.3);
    var snow = precip * clamp01((34 - tempF) / 8);

    /* Freeze-up: shallow water first, driven by the recent mean temperature. */
    var meanT = (now.temp + prev.temp) / 2;
    var freeze = freezeIndex(lon, lat, doy, now.elev, meanT, 0);
    var freezeDeep = freezeDepth(lon, lat, doy, now.elev, meanT, 0);
    var snowDepth = clamp01(freeze * 0.8 + snow * 0.6 - clamp01((tempF - 34) / 10));

    /* Water: tailwaters buffer the air temperature swing hard. */
    var hb = habitat(lon, lat);
    var waterTemp = modelWaterTemp(meanT, hb, doy, lon, lat);
    var flowIdx = clamp01(0.45 + 0.35 * Math.sin((doy - 80) / 365 * 2 * Math.PI) + (fbm(lon * 0.6, lat * 0.6, t * 0.2 + 31) - 0.5) * 0.5);

    return {
      tempF: tempF, temp24: temp24, pressure: now.press, pressTrend: pressTrend,
      windFrom: windFrom, windSpd: windSpd, gust: gust,
      cloud: cloud, precip: precip, snow: snow, snowDepth: snowDepth,
      freeze: freeze, freezeDeep: freezeDeep, waterTemp: waterTemp, flowIdx: flowIdx, flowReal: false,
      flowJudged: false,
      frontal: bell(now.d + 0.5, 2.4), elev: now.elev, seas: now.seas, real: false,
      precipIn: precip * 0.08, snowDepthFt: snowDepth * 0.8
    };
  }

  /* Cheap upstream sample. The Migration Engine queries this at several points
     up-flyway per cell, so it skips everything migration does not read. */
  function probeSynthetic(lon, lat, t, doy) {
    var now = core(lon, lat, t, doy), prev = core(lon, lat, t - 1, doy - 1);
    var behind = 0.5 + 0.5 * Math.tanh(now.d / 2.1);
    var vx = Math.sin(190 * D2R) * (1 - behind) + Math.sin(318 * D2R) * behind;
    var vy = Math.cos(190 * D2R) * (1 - behind) + Math.cos(318 * D2R) * behind;
    var meanT = (now.temp + prev.temp) / 2;
    var frz = freezeIndex(lon, lat, doy, now.elev, meanT, 0);
    return {
      temp: now.temp,
      temp24: now.temp - prev.temp,
      freeze: frz, freezeGain: freezeGain(lon, lat, doy, now.elev, frz),
      windFrom: (Math.atan2(vx, vy) / D2R + 360) % 360,
      windSpd: clamp(5 + 17 * now.wBell + 7 * habitat(lon, lat).openness + (now.nz - 0.5) * 9, 1, 42),
      press: now.press,
      snow: clamp01((34 - now.temp) / 8) * clamp01(bell(now.d + 0.6, 1.5) * 1.1)
    };
  }

  /* Real data when the grid covers the request, synthetic otherwise, decided
     per call so the fallback also covers times past the end of the forecast. */
  function useReal(t) {
    var W = global.OG.wx;
    return W && W.available() && t >= -0.2 && t <= W.spanDays - 0.3;
  }

  function conditions(lon, lat, t, doy) {
    return useReal(t) ? conditionsReal(lon, lat, t, doy) : conditionsSynthetic(lon, lat, t, doy);
  }

  function probe(lon, lat, t, doy) {
    return useReal(t) ? probeReal(lon, lat, t, doy) : probeSynthetic(lon, lat, t, doy);
  }

  /* ---------- Time zone ---------- */

  /* Which clock a place keeps.

     The zone came from longitude alone - Eastern east of 82.5 W, Central
     to 97 W, Mountain to 114.2 W, Pacific beyond - with daylight time
     everywhere. Times agreed with the label printed beside them, but the
     label was not the local clock, and legal shooting hours are read off
     the local clock. Measured on 2026-10-14: a bear plan at 48.41 N,
     114.52 W, in Flathead County, Montana, which is all Mountain time,
     said "6:00 AM PDT"; the Great Smokies at 83.5 W came out Central; and
     Arizona, which keeps standard time all year, got MDT in summer.

     Now the state decides, from the same state raster the regulations
     use, and each state the zone line runs through carries a ring for
     the part on the far side of it. Checked on a 0.02 degree grid
     over the lower 48 against the timezone-boundary-builder 2026e
     polygons (built from OpenStreetMap, used for the check only and not
     shipped): the longitude rule had the wrong offset or the wrong
     daylight rule at 25.9% of points, this has it at 0.63%. Of that,
     0.47% is the Navajo Nation, which keeps daylight time inside Arizona
     and is not modelled here; 0.15% is within one raster cell (0.07
     degrees) of a state line, where the raster can name the neighbour;
     0.01% is elsewhere, along the traced lines and round Phenix City,
     Alabama, which keeps Eastern time unofficially and is Central here.
     Of the 17,014 towns in us-cities.js, 3,193 had the wrong clock and 32
     still do: 11 on the Navajo Nation, and 21 within one raster cell of
     a state line, five of them the Alabama towns by Columbus and West
     Point, Georgia, that keep Eastern time unofficially. */
  var TZ_STD = {
    CT: -5, DE: -5, DC: -5, FL: -5, GA: -5, IN: -5, KY: -5, ME: -5, MD: -5, MA: -5, MI: -5, NH: -5,
    NJ: -5, NY: -5, NC: -5, OH: -5, PA: -5, RI: -5, SC: -5, VT: -5, VA: -5, WV: -5,
    AL: -6, AR: -6, IL: -6, IA: -6, KS: -6, LA: -6, MN: -6, MS: -6, MO: -6, NE: -6, ND: -6, OK: -6,
    SD: -6, TN: -6, TX: -6, WI: -6,
    AZ: -7, CO: -7, ID: -7, MT: -7, NM: -7, UT: -7, WY: -7,
    CA: -8, NV: -8, OR: -8, WA: -8
  };

  /* The far side of the line in each state it crosses, as [offset,
     [lon, lat, lon, lat, ...]]. Traced from 49 CFR 71.5, 71.7 and 71.9:
     county lines from the Census outlines in us-topo.js, rivers from the
     USGS National Hydrography Dataset, township and section lines from
     the BLM PLSS, and ND 31, the Pierre rail bridge, the Intracoastal
     Waterway and two city limits from Census TIGER, all public domain;
     then simplified to within 0.01 degrees, about a kilometre. A ring
     that follows a line closes round its far side through the next state
     or open water; the state is looked up first, so only points in or
     just off this one are tested against it. */
  var TZ_SPLIT = {
    /* Pacific: north of the Salmon River, from the Idaho-Lemhi county line to the Snake. */
    ID: [
      [-8, [
        -114.558,45.565, -114.633,45.519, -114.662,45.471, -114.795,45.509, -114.795,45.436,
        -114.72,45.396, -114.771,45.391, -114.874,45.418, -115.016,45.508, -115.065,45.511,
        -115.209,45.569, -115.321,45.519, -115.353,45.477, -115.426,45.458, -115.508,45.376,
        -115.611,45.397, -115.667,45.434, -115.752,45.444, -115.808,45.468, -115.938,45.458,
        -116.1,45.403, -116.12,45.402, -116.139,45.427, -116.214,45.4, -116.285,45.423, -116.307,45.412,
        -116.319,45.489, -116.296,45.509, -116.312,45.535, -116.305,45.572, -116.273,45.6,
        -116.304,45.628, -116.285,45.634, -116.292,45.663, -116.281,45.667, -116.319,45.67,
        -116.308,45.681, -116.317,45.714, -116.303,45.729, -116.327,45.758, -116.296,45.859,
        -116.326,45.887, -116.429,45.914, -116.444,45.963, -116.46,45.97, -116.551,45.974,
        -116.622,46.013, -116.613,46.026, -116.626,46.037, -116.649,46.029, -116.65,45.995,
        -116.7,45.998, -116.743,45.968, -116.757,45.943, -116.73,45.895, -116.751,45.869,
        -116.795,45.857, -117.5,45.857, -117.5,49.5, -113.8,49.5, -113.8,45.8, -114.3,45.75]]
    ],
    /* Mountain: Malheur County north of the T.35S/T.36S township line. */
    OR: [
      [-7, [
        -117.221,44.302, -117.487,44.3, -117.487,44.388, -117.569,44.416, -117.591,44.444,
        -117.971,44.444, -118.011,44.43, -118.032,44.39, -118.072,44.372, -118.093,44.329, -118.151,44.3,
        -118.154,44.271, -118.233,44.256, -118.215,42.451, -116,42.451, -116,44.302]]
    ],
    /* Mountain: the City of West Wendover, named in 71.9(b). */
    NV: [
      [-7, [
        -114.113,40.749, -114.113,40.725, -114.044,40.726, -114.043,40.756, -114.113,40.756,
        -114.113,40.75]]
    ],
    /* Mountain: El Paso and Hudspeth Counties. */
    TX: [
      [-7, [
        -104.917,32.001, -104.906,30.836, -104.917,30.836, -104.917,30.663, -104.982,30.629,
        -104.982,29.5, -107,29.5, -107,32.2, -104.917,32.2]]
    ],
    /* Mountain: Sherman, Wallace, Greeley and Hamilton Counties. */
    KS: [
      [-7, [
        -102.049,39.568, -101.389,39.568, -101.392,39.135, -101.479,39.134, -101.486,38.701,
        -101.568,38.7, -101.568,38.263, -101.543,38.263, -101.543,37.828, -101.525,37.828,
        -101.529,37.737, -102.042,37.738, -102.6,37.738, -102.6,39.568]]
    ],
    /* Mountain: west of the CFR line through Cherry County and of Thomas, McPherson, Lincoln, Hayes and Hitchcock. */
    NE: [
      [-7, [
        -100.905,43.046, -100.905,42.813, -100.866,42.813, -100.866,42.784, -100.852,42.784,
        -100.853,42.756, -100.893,42.756, -100.893,42.612, -100.775,42.612, -100.777,42.437,
        -100.829,42.438, -100.829,42.349, -100.81,42.35, -100.809,42.205, -100.751,42.205,
        -100.753,42.088, -100.847,42.088, -100.843,41.741, -101.407,41.743, -101.407,41.395,
        -101.27,41.395, -101.27,41.048, -101.249,41.048, -101.249,40.698, -101.346,40.698,
        -101.342,40.351, -101.324,40.351, -101.324,40.003, -101.324,39.9, -104.5,39.9, -104.5,43.3,
        -100.905,43.3]]
    ],
    /* Mountain: west of the Missouri down to the Pierre rail bridge, then west of Jones, Mellette and Todd;
       and all of Fort Pierre, which that line cuts through: 71.7(g) puts such towns in Mountain time. */
    SD: [
      [-7, [
        -100.499,45.943, -100.387,45.869, -100.377,45.816, -100.308,45.708, -100.337,45.663,
        -100.405,45.65, -100.431,45.595, -100.488,45.536, -100.445,45.509, -100.391,45.512,
        -100.341,45.473, -100.273,45.381, -100.316,45.318, -100.262,45.247, -100.28,45.159,
        -100.326,45.1, -100.316,45.059, -100.28,45.02, -100.391,45.028, -100.423,44.99, -100.402,44.857,
        -100.542,44.761, -100.61,44.77, -100.675,44.823, -100.714,44.821, -100.718,44.771,
        -100.632,44.737, -100.614,44.707, -100.646,44.598, -100.621,44.567, -100.527,44.547,
        -100.531,44.516, -100.574,44.491, -100.581,44.461, -100.535,44.444, -100.409,44.458,
        -100.387,44.44, -100.371,44.374, -100.546,44.168, -101.048,44.168, -101.066,43.841,
        -101.087,43.85, -101.163,43.83, -101.227,43.789, -101.227,42.998, -101.227,42.9, -104.5,42.9,
        -104.5,46.1, -100.499,46.1]],
      [-7, [
        -100.4,44.373, -100.401,44.368, -100.39,44.368, -100.39,44.357, -100.388,44.357, -100.382,44.345,
        -100.359,44.347, -100.37,44.357, -100.38,44.39, -100.395,44.389, -100.395,44.386, -100.4,44.386,
        -100.4,44.382]]
    ],
    /* Mountain: township lines and the Little Missouri in McKenzie, then west of Mercer and Morton, and ND 31. */
    ND: [
      [-7, [
        -104.045,48, -103.97,47.972, -103.959,47.954, -103.968,47.848, -103.797,47.848, -103.798,47.675,
        -103.736,47.675, -103.736,47.589, -103.609,47.588, -103.608,47.514, -103.559,47.507,
        -103.53,47.538, -103.459,47.522, -103.43,47.532, -103.447,47.555, -103.435,47.595,
        -103.382,47.601, -103.297,47.578, -103.268,47.599, -103.172,47.572, -103.129,47.589,
        -103.067,47.578, -103.032,47.634, -103.02,47.632, -103.038,47.659, -103.024,47.679,
        -102.957,47.657, -102.953,47.632, -102.942,47.642, -102.883,47.624, -102.869,47.603,
        -102.765,47.598, -102.747,47.58, -102.687,47.571, -102.671,47.531, -102.597,47.544,
        -102.473,47.512, -102.438,47.521, -102.442,47.567, -102.421,47.569, -102.411,47.592,
        -102.204,47.575, -102.207,47.328, -102.146,47.328, -102.146,46.981, -102.096,46.981,
        -102.096,46.717, -101.719,46.718, -101.719,46.631, -101.299,46.631, -101.299,46.371,
        -101.048,46.371, -101.048,46.284, -101.026,46.284, -101.087,46.276, -101.102,46.23,
        -101.199,46.184, -101.191,46.149, -101.303,46.133, -101.299,46.105, -101.334,46.086,
        -101.334,45.944, -101.334,45.8, -104.5,45.8, -104.5,48]]
    ],
    /* Central: Gogebic, Iron, Dickinson and Menominee Counties. */
    MI: [
      [-6, [
        -87.265,45.551, -87.326,45.552, -87.326,45.899, -87.369,45.899, -87.369,45.985, -87.617,45.986,
        -87.617,46.247, -88.116,46.247, -88.116,46.42, -88.991,46.42, -88.991,46.332, -89.365,46.333,
        -89.365,46.506, -89.742,46.506, -89.742,46.593, -89.864,46.593, -89.864,46.765, -89.889,46.765,
        -89.889,47, -90.6,47, -90.6,44.9, -87.265,44.9]]
    ],
    /* Central: the six northwest and six southwest counties. */
    IN: [
      [-6, [
        -87.527,40.737, -87.1,40.737, -87.1,40.838, -86.985,40.838, -86.989,40.912, -86.931,40.913,
        -86.931,41.172, -86.468,41.171, -86.468,41.433, -86.526,41.433, -86.526,41.52, -86.504,41.519,
        -86.486,41.571, -86.486,41.65, -86.526,41.651, -86.526,41.76, -86.526,42, -88.2,42, -88.2,40.737]],
      [-6, [
        -86.461,38.122, -86.461,38.207, -86.572,38.207, -86.569,38.267, -86.791,38.249, -86.791,38.205,
        -87.075,38.204, -87.075,38.232, -87.297,38.232, -87.315,38.246, -87.315,38.382, -87.409,38.376,
        -87.409,38.436, -87.444,38.436, -87.462,38.466, -87.462,38.534, -87.495,38.496, -87.574,38.491,
        -87.599,38.451, -87.746,38.414, -88.3,38.414, -88.3,37.6, -86.461,37.6]]
    ],
    /* Central: west of Meade, Hardin, Larue, Taylor, Casey, Pulaski and Wayne. */
    KY: [
      [-6, [
        -84.975,36.616, -85,36.624, -85,36.677, -85.022,36.718, -85.004,36.757, -85.065,36.859,
        -84.961,36.916, -84.946,36.96, -84.907,36.946, -84.835,36.998, -84.907,37.047, -84.9,37.116,
        -84.953,37.102, -85.043,37.186, -85.058,37.257, -85.165,37.311, -85.194,37.272, -85.312,37.246,
        -85.309,37.227, -85.352,37.192, -85.478,37.364, -85.585,37.432, -85.585,37.47, -85.635,37.472,
        -85.657,37.422, -86.048,37.45, -86.055,37.496, -86.113,37.567, -86.177,37.555, -86.231,37.575,
        -86.246,37.602, -86.274,37.593, -86.152,37.799, -86.49,38.046, -86.49,39.3, -89.8,39.3,
        -89.8,36.3, -84.975,36.3]]
    ],
    /* Eastern: Scott, Morgan, Roane, Rhea, Hamilton and everything east. */
    TN: [
      [-5, [
        -84.785,36.604, -84.659,36.395, -84.702,36.371, -84.724,36.376, -84.738,36.338, -84.785,36.326,
        -84.799,36.297, -84.875,36.285, -84.885,36.239, -84.914,36.208, -84.907,36.156, -84.871,36.137,
        -84.831,36.084, -84.806,36.091, -84.72,35.995, -84.681,35.909, -84.781,35.825, -84.918,35.762,
        -85.108,35.571, -85.101,35.534, -85.147,35.491, -85.115,35.476, -85.169,35.456, -85.244,35.319,
        -85.388,35.147, -85.391,35.121, -85.363,35.087, -85.388,35.04, -85.474,34.983, -85.474,34.8,
        -81.4,34.8, -81.4,36.8, -84.785,36.8]]
    ],
    /* Central: west of the Apalachicola, Jackson River and Intracoastal Waterway. */
    FL: [
      [-6, [
        -84.864,30.711, -84.907,30.619, -84.932,30.607, -84.989,30.525, -85,30.456, -84.982,30.442,
        -85.032,30.42, -85.015,30.409, -85.083,30.229, -85.115,30.2, -85.154,30.092, -85.137,30.086,
        -85.137,30.043, -85.115,30.023, -85.029,29.987, -85.018,29.951, -85.054,29.911, -85.022,29.808,
        -85.04,29.78, -85.102,29.774, -85.182,29.813, -85.211,29.877, -85.278,29.902, -85.323,29.956,
        -85.371,29.968, -85.389,30.015, -85.389,29.924, -85.45,29.88, -85.45,29.5, -88,29.5, -88,31.2,
        -84.864,31.2]]
    ]
  };

  var tzRings = {};
  (function () {
    for (var ab in TZ_SPLIT) {
      tzRings[ab] = TZ_SPLIT[ab].map(function (z) {
        var r = z[1], w = 999, s = 999, e = -999, n = -999;
        for (var i = 0; i < r.length; i += 2) {
          if (r[i] < w) w = r[i];
          if (r[i] > e) e = r[i];
          if (r[i + 1] < s) s = r[i + 1];
          if (r[i + 1] > n) n = r[i + 1];
        }
        return { off: z[0], r: r, w: w, s: s, e: e, n: n };
      });
    }
  })();

  function inRing(r, x, y) {
    var inside = false;
    for (var i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      var yi = r[i + 1], yj = r[j + 1];
      if ((yi > y) !== (yj > y) && x < (r[j] - r[i]) * (y - yi) / (yj - yi) + r[i]) inside = !inside;
    }
    return inside;
  }

  /* The state raster's cells are 0.07 degrees, and a cell whose centre is
     water belongs to no state, so towns on the shore fell through to the
     longitude rule: Apalachicola and Port St. Joe came out Central, and
     so did Marquette on Lake Superior. The cells one and two steps round
     are asked before giving up. Of the 17,014 towns, 304 sit on such
     cells; the longitude rule had 39 of them on the wrong clock, and with
     this none are. */
  var NEAR = [0.07, 0, -0.07, 0, 0, 0.07, 0, -0.07, 0.07, 0.07, -0.07, 0.07, 0.07, -0.07, -0.07, -0.07,
    0.14, 0, -0.14, 0, 0, 0.14, 0, -0.14, 0.14, 0.14, -0.14, 0.14, 0.14, -0.14, -0.14, -0.14];

  /* Standard offset from GMT, and whether daylight time is kept. Further
     off the state raster than that (offshore, mid-lake) the longitude rule
     stands. Fills `out`, because the forecast sampler asks once per cell. */
  function zoneAt(lon, lat, out) {
    var geo = global.OG.geo;
    var si = geo && lat != null ? geo.stateIndexAt(lon, lat) : -1;
    for (var q = 0; si < 0 && geo && lat != null && q < NEAR.length; q += 2) si = geo.stateIndexAt(lon + NEAR[q], lat + NEAR[q + 1]);
    var ab = si < 0 ? null : geo.states[si].abbr;
    var std = ab ? TZ_STD[ab] : null;
    if (std == null) std = lon >= -82.5 ? -5 : lon >= -97 ? -6 : lon >= -114.2 ? -7 : -8;
    var rs = ab && tzRings[ab];
    if (rs) for (var k = 0; k < rs.length; k++) {
      var z = rs[k];
      if (lon >= z.w && lon <= z.e && lat >= z.s && lat <= z.n && inRing(z.r, lon, lat)) { std = z.off; break; }
    }
    out.std = std;
    out.dst = ab !== 'AZ';
    return out;
  }

  /* Daylight time runs from 2 a.m. local standard time on the second
     Sunday in March to 2 a.m. local daylight time on the first Sunday in
     November (49 CFR 71.2). This switched at 2 a.m. GMT, which is the
     evening before in every US zone, so for four to eight hours round
     each changeover the clock was an hour out. Noon, which is what the
     plans ask about, came out the same either way: checked on every day
     of 2025-2027 in all four zones. */
  var dstYear = NaN, dstOn = 0, dstOff = 0;
  function offsetIn(z, date) {
    if (!z.dst) return z.std;
    var y = date.getUTCFullYear();
    if (y !== dstYear) {
      var mar = new Date(Date.UTC(y, 2, 1)).getUTCDay(), nov = new Date(Date.UTC(y, 10, 1)).getUTCDay();
      dstOn = Date.UTC(y, 2, 8 + (7 - mar) % 7, 2);
      dstOff = Date.UTC(y, 10, 1 + (7 - nov) % 7, 2);
      dstYear = y;
    }
    var ms = date.getTime();
    return (ms >= dstOn - z.std * 3600000 && ms < dstOff - (z.std + 1) * 3600000) ? z.std + 1 : z.std;
  }

  var ZONE = { std: 0, dst: true };
  function tzOffset(lon, lat, date) {
    return offsetIn(zoneAt(lon, lat, ZONE), date);
  }

  /* ---------- Solar: NOAA sunrise/sunset, plus US legal shooting light ---------- */

  /* Minutes after local midnight for a given solar altitude, `off` hours from GMT. */
  function solarEvent(lat, lon, date, angleDeg, morning, off) {
    var doy = dayOfYear(date);
    var g = 2 * Math.PI / 365 * (doy - 1 + 0.5);
    var eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
      - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    var decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
      - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
      - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var la = lat * D2R;
    var cosH = (Math.cos(angleDeg * D2R) - Math.sin(la) * Math.sin(decl)) / (Math.cos(la) * Math.cos(decl));
    if (cosH > 1 || cosH < -1) return null;              // polar day or night
    var ha = Math.acos(cosH) / D2R;
    var utcMin = 720 - 4 * (lon + (morning ? ha : -ha)) - eqTime;
    return utcMin + off * 60;
  }

  function sun(lat, lon, date) {
    var z = zoneAt(lon, lat, {}), off = offsetIn(z, date);
    var sr = solarEvent(lat, lon, date, 90.833, true, off);
    var ss = solarEvent(lat, lon, date, 90.833, false, off);
    var civil = solarEvent(lat, lon, date, 96, true, off);
    var civilEnd = solarEvent(lat, lon, date, 96, false, off);
    /* ET, CT, MT, PT in winter, EDT and so on in summer, MST all year in Arizona. */
    var label = ({ '-5': 'E', '-6': 'C', '-7': 'M', '-8': 'P' })[String(z.std)];
    label = !label ? 'local' : !z.dst ? label + 'ST' : off !== z.std ? label + 'DT' : label + 'T';
    return {
      sunrise: sr, sunset: ss, dawn: civil, dusk: civilEnd, tz: label,
      /* Federal waterfowl framework: one half hour before sunrise to sunset.
         States narrow this; always verify the current state proclamation. */
      shootStart: sr == null ? null : sr - 30,
      shootEnd: ss
    };
  }

  function hhmm(mins) {
    if (mins == null) return '--:--';
    var m = ((Math.round(mins) % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    var ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ap;
  }

  function dirName(deg) {
    var names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return names[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  }

  /* Habitat for one species out of a habitat reading.

     Everything the reading carries was looked up when it was made. The
     upland birds are not - there are fifteen of them and the map asks
     about one at a time - so each is fetched here the first time it is
     asked for and kept on the reading. With no raster to ask, the
     all-birds surface stands in, as the hand-made one does for every
     other species. */
  function habOf(hab, key) {
    var v = hab[key];
    if (v !== undefined) return v;
    var hg = global.OG && global.OG.habgrid;
    v = hg && hg.ready ? hg.at(key, hab.lon, hab.lat) : null;
    if (v == null) v = hab.upland || 0;
    hab[key] = v;
    return v;
  }

  global.OG = global.OG || {};
  global.OG.env = {
    conditions: conditions, probe: probe, habitat: habitat, habOf: habOf, elevFt: elevFt, sun: sun,
    freezeIndex: freezeIndex, freezeGain: freezeGain, freezeDepth: freezeDepth,
    modelWaterTemp: modelWaterTemp,
    doyFor: doyFor,
    dayOfYear: dayOfYear, hhmm: hhmm, dirName: dirName, tzOffset: tzOffset,
    fbm: fbm, clamp: clamp, clamp01: clamp01, bell: bell,
    WF_REGIONS: WF_REGIONS, TROUT_WATERS: TROUT_WATERS
  };
})(window);
