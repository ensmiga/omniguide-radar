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

  var TROUT_WATERS = [
    { n: 'Bighorn River', lon: -107.95, lat: 45.32, rx: 0.30, ry: 0.42, v: 0.92, cls: 'tailwater' },
    { n: 'Madison River', lon: -111.55, lat: 45.05, rx: 0.22, ry: 0.55, v: 0.86, cls: 'freestone' },
    { n: 'Missouri River - Craig', lon: -111.95, lat: 47.05, rx: 0.22, ry: 0.35, v: 0.88, cls: 'tailwater' },
    { n: 'Yellowstone River', lon: -110.4, lat: 45.4, rx: 0.8, ry: 0.4, v: 0.78, cls: 'freestone' },
    { n: 'Green River - Flaming Gorge', lon: -109.45, lat: 40.95, rx: 0.25, ry: 0.3, v: 0.88, cls: 'tailwater' },
    { n: 'San Juan River', lon: -107.65, lat: 36.85, rx: 0.3, ry: 0.2, v: 0.85, cls: 'tailwater' },
    { n: 'South Platte - Deckers', lon: -105.3, lat: 39.3, rx: 0.3, ry: 0.35, v: 0.80, cls: 'tailwater' },
    { n: 'Frying Pan and Roaring Fork', lon: -106.9, lat: 39.4, rx: 0.4, ry: 0.25, v: 0.82, cls: 'tailwater' },
    { n: 'White River', lon: -92.3, lat: 36.3, rx: 0.5, ry: 0.3, v: 0.80, cls: 'tailwater' },
    { n: 'Delaware River west branch', lon: -75.2, lat: 42.0, rx: 0.35, ry: 0.3, v: 0.78, cls: 'tailwater' },
    { n: 'Henrys Fork', lon: -111.4, lat: 44.2, rx: 0.3, ry: 0.35, v: 0.84, cls: 'freestone' },
    { n: 'Deschutes River', lon: -121.0, lat: 44.9, rx: 0.3, ry: 0.6, v: 0.80, cls: 'freestone' },
    { n: 'Au Sable River', lon: -84.6, lat: 44.7, rx: 0.4, ry: 0.25, v: 0.72, cls: 'freestone' },
    { n: 'Letort and Cumberland limestone', lon: -77.2, lat: 40.2, rx: 0.4, ry: 0.25, v: 0.70, cls: 'spring' },
    { n: 'Driftless spring creeks', lon: -91.0, lat: 43.6, rx: 0.9, ry: 0.7, v: 0.74, cls: 'spring' },
    { n: 'Gunnison and Taylor', lon: -107.0, lat: 38.6, rx: 0.4, ry: 0.35, v: 0.78, cls: 'tailwater' },
    { n: 'Bitterroot and Blackfoot', lon: -114.0, lat: 46.6, rx: 0.5, ry: 0.6, v: 0.76, cls: 'freestone' },
    { n: 'Snake River - South Fork', lon: -111.4, lat: 43.4, rx: 0.4, ry: 0.3, v: 0.82, cls: 'tailwater' },
    { n: 'Upper Sacramento and McCloud', lon: -122.3, lat: 41.1, rx: 0.3, ry: 0.35, v: 0.74, cls: 'freestone' },
    { n: 'Great Smoky headwaters', lon: -83.5, lat: 35.6, rx: 0.5, ry: 0.35, v: 0.66, cls: 'freestone' }
  ];

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
      if (v > tbest) { tbest = v; if (v > 0.15) { tw = q.n; tcls = q.cls; } }
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

    /* REAL HABITAT OVERRIDE.

       Everything above this point is invented - Gaussian blobs over fractal
       noise, which is why White River, Colorado used to read 19 out of 100
       for elk. Where the baked raster covers the point (NLCD land cover and
       elevation for quality, GBIF occurrence share for presence, 11 km) its
       value wins outright. The synthetic surface stays as the fallback for
       points off the grid and for the case where the raster has not loaded,
       because a missing file should not read as "no animals here".

       Trout is not in the raster: it is a water property, not a land-cover
       one, and it keeps the hydrology-driven surface above. */
    var hg = global.OG && global.OG.habgrid;
    var realSrc = {};
    if (hg && hg.ready) {
      var r;
      if ((r = hg.at('waterfowl', lon, lat)) != null) { wf = r; realSrc.waterfowl = true; }
      if ((r = hg.at('elk', lon, lat)) != null) { elk = r; realSrc.elk = true; }
      if ((r = hg.at('whitetail', lon, lat)) != null) { whitetail = r; realSrc.whitetail = true; }
      if ((r = hg.at('muledeer', lon, lat)) != null) { muledeer = r; realSrc.muledeer = true; }
      if ((r = hg.at('moose', lon, lat)) != null) { moose = r; realSrc.moose = true; }
      if ((r = hg.at('turkey', lon, lat)) != null) { turkey = r; realSrc.turkey = true; }
      if ((r = hg.at('upland', lon, lat)) != null) { upland = r; realSrc.upland = true; }
      if ((r = hg.at('pronghorn', lon, lat)) != null) { pronghorn = r; realSrc.pronghorn = true; }
    }

    var out = {
      elev: elev, waterfowl: wf, trout: trout, elk: elk,
      whitetail: whitetail, muledeer: muledeer, moose: moose,
      turkey: turkey, upland: upland, pronghorn: pronghorn,
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
    { start: -0.5, speed: 1.75, strength: 0.72 }
  ];

  function frontDist(f, lon, lat, t) {
    var travelled = f.start + f.speed * t;
    var latLine = 54.5 - travelled + 0.30 * (lon + 100);
    return lat - latLine;
  }

  function seasonalIndex(doy) { return -Math.cos((doy - 14) / 365.25 * 2 * Math.PI); }

  /* Fast core used for finite-difference trends. */
  function core(lon, lat, t, doy) {
    var seas = seasonalIndex(doy);
    var elev = habitat(lon, lat).elev;
    var base = 60 + 27 * seas - (lat - 37) * (1.95 - 0.55 * seas) - elev / 1000 * 3.4;
    var coastal = Math.max(gb((lon + 123.4) / 1.6, (lat - 44) / 8), gb((lon + 77.0) / 1.8, (lat - 36) / 9) * 0.7);
    base = base * (1 - 0.3 * coastal) + (56 + 10 * seas) * 0.3 * coastal;

    var tAnom = 0, pAnom = 0, wBell = 0, dMain = 0;
    for (var i = 0; i < FRONTS.length; i++) {
      var f = FRONTS[i], d = frontDist(f, lon, lat, t);
      if (i === 0) dMain = d;
      var behind = 0.5 + 0.5 * Math.tanh(d / 2.1);
      tAnom += f.strength * (-17 * behind + 6 * bell(d + 2.0, 2.4));
      pAnom += f.strength * (9 * Math.tanh(d / 3.4) - 10 * bell(d + 1.2, 2.2));
      wBell = Math.max(wBell, f.strength * bell(d + 0.4, 2.6));
    }
    var nz = fbm(lon * 0.42, lat * 0.42, t * 0.34 + 2.5);
    var temp = base + tAnom + (nz - 0.5) * 11;
    var press = 1013 + pAnom + (fbm(lon * 0.3, lat * 0.3, t * 0.3 + 9) - 0.5) * 7;
    return { temp: temp, press: press, wBell: wBell, d: dMain, seas: seas, nz: nz, elev: elev };
  }

  /* ---------- Real forecast path ---------- */

  var RB = [{}, {}, {}];

  function lapsed(s, terrainFt) {
    return s.T + (s.gelev - terrainFt) * 0.00357;
  }

  function conditionsReal(lon, lat, t, doy) {
    var W = global.OG.wx;
    var hb = habitat(lon, lat);
    var step = W.stepFor(lon, t);

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
    var freeze = clamp01((30 - meanT) / 13) * (seasonalIndex(doy) < 0.15 ? 1 : 0.2);
    freeze = clamp01(freeze + snowDepth * 0.25);

    /* No frontal analysis field in the feed, so a passage is inferred from the
       signature it leaves: a sharp temperature fall with a pressure kick. */
    var frontal = clamp01(0.65 * clamp01(-temp24 / 13) + 0.35 * clamp01(Math.abs(pressTrend) / 2.5));

    var buffer = hb.waterCls === 'tailwater' ? 0.72 : hb.waterCls === 'spring' ? 0.80 : 0.35;
    var waterTemp = clamp(0.62 * meanT + 16 - (hb.elev / 1000) * 0.8, 32, 80);
    waterTemp = waterTemp * (1 - buffer) + (46 + 6 * seasonalIndex(doy)) * buffer;

    var flowIdx = clamp01(0.45 + 0.35 * Math.sin((doy - 80) / 365 * 2 * Math.PI) +
      (fbm(lon * 0.6, lat * 0.6, 31) - 0.5) * 0.5);
    var flowReal = false, gaugeInfo = null;

    /* A nearby gauge is a measurement, and a measurement beats a model.
       Only for today, though: a reading taken an hour ago says nothing
       about Thursday. */
    var GA = global.OG.gauges;
    if (GA && GA.available() && t < 1) {
      var g = GA.at(lon, lat);
      if (g) {
        gaugeInfo = g;
        if (g.waterTempF != null) waterTemp = g.waterTempF;
        if (g.cfs != null) {
          /* Discharge in cfs is not comparable between a creek and the
             Missouri, so it is converted to a position within that gauge's
             own plausible range rather than used as an absolute. */
          flowIdx = clamp01(Math.log10(Math.max(1, g.cfs)) / 4.2);
          flowReal = true;
        }
      }
    }

    return {
      tempF: tempF, temp24: temp24, pressure: a.P, pressTrend: pressTrend,
      windFrom: a.WD, windSpd: a.WS, gust: Math.max(a.WG, a.WS),
      cloud: clamp01(a.CC / 100), precip: clamp01(a.PR / 0.08),
      snow: clamp01(a.SF / 0.4), snowDepth: snowDepth,
      freeze: freeze, waterTemp: waterTemp, flowIdx: flowIdx, flowReal: flowReal,
      gauge: gaugeInfo, snowObserved: snowObserved, snowInches: snowInches,
      frontal: frontal, elev: hb.elev, seas: seasonalIndex(doy), real: true,
      precipIn: a.PR, snowDepthFt: a.SD
    };
  }

  function probeReal(lon, lat, t, doy) {
    var W = global.OG.wx;
    var hb = habitat(lon, lat);
    var step = W.stepFor(lon, t);
    var a = W.sample(lon, lat, step, RB[0]);
    var tNow = lapsed(a, hb.elev);
    var b = W.sample(lon, lat, step - 8, RB[1]);
    var tPrev = lapsed(b, hb.elev);
    var meanT = (tNow + tPrev) / 2;
    return {
      temp: tNow, temp24: tNow - tPrev,
      freeze: clamp01(clamp01((30 - meanT) / 13) * (seasonalIndex(doy) < 0.15 ? 1 : 0.2) +
              clamp01(a.SD / 0.8) * 0.25),
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
    var freeze = clamp01((30 - meanT) / 13) * clamp01((now.seas < 0 ? 1 : 0.15));
    var snowDepth = clamp01(freeze * 0.8 + snow * 0.6 - clamp01((tempF - 34) / 10));

    /* Water: tailwaters buffer the air temperature swing hard. */
    var hb = habitat(lon, lat);
    var buffer = hb.waterCls === 'tailwater' ? 0.72 : hb.waterCls === 'spring' ? 0.80 : 0.35;
    var waterTemp = clamp(0.62 * meanT + 16 + (hb.elev / 1000) * -0.8, 32, 80);
    waterTemp = waterTemp * (1 - buffer) + (46 + 6 * now.seas) * buffer;
    var flowIdx = clamp01(0.45 + 0.35 * Math.sin((doy - 80) / 365 * 2 * Math.PI) + (fbm(lon * 0.6, lat * 0.6, t * 0.2 + 31) - 0.5) * 0.5);

    return {
      tempF: tempF, temp24: temp24, pressure: now.press, pressTrend: pressTrend,
      windFrom: windFrom, windSpd: windSpd, gust: gust,
      cloud: cloud, precip: precip, snow: snow, snowDepth: snowDepth,
      freeze: freeze, waterTemp: waterTemp, flowIdx: flowIdx, flowReal: false,
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
    return {
      temp: now.temp,
      temp24: now.temp - prev.temp,
      freeze: clamp01((30 - meanT) / 13) * (now.seas < 0 ? 1 : 0.15),
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

  /* ---------- Solar: NOAA sunrise/sunset, plus US legal shooting light ---------- */

  function tzOffset(lon, date) {
    var std = lon >= -82.5 ? -5 : lon >= -97 ? -6 : lon >= -114.2 ? -7 : -8;
    var y = date.getFullYear();
    var mar = new Date(Date.UTC(y, 2, 1));
    var dstStart = Date.UTC(y, 2, 1 + ((7 - mar.getUTCDay()) % 7) + 7, 2);
    var nov = new Date(Date.UTC(y, 10, 1));
    var dstEnd = Date.UTC(y, 10, 1 + ((7 - nov.getUTCDay()) % 7), 2);
    var ms = date.getTime();
    return (ms >= dstStart && ms < dstEnd) ? std + 1 : std;
  }

  /* Minutes after local midnight for a given solar altitude. */
  function solarEvent(lat, lon, date, angleDeg, morning) {
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
    return utcMin + tzOffset(lon, date) * 60;
  }

  function sun(lat, lon, date) {
    var sr = solarEvent(lat, lon, date, 90.833, true);
    var ss = solarEvent(lat, lon, date, 90.833, false);
    var civil = solarEvent(lat, lon, date, 96, true);
    var civilEnd = solarEvent(lat, lon, date, 96, false);
    var off = tzOffset(lon, date);
    var std = lon >= -82.5 ? -5 : lon >= -97 ? -6 : lon >= -114.2 ? -7 : -8;
    var label = ({ '-5': 'ET', '-6': 'CT', '-7': 'MT', '-8': 'PT' })[String(std)] || 'local';
    if (off !== std) label = label.charAt(0) + 'DT';
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

  global.OG = global.OG || {};
  global.OG.env = {
    conditions: conditions, probe: probe, habitat: habitat, elevFt: elevFt, sun: sun,
    doyFor: doyFor,
    dayOfYear: dayOfYear, hhmm: hhmm, dirName: dirName, tzOffset: tzOffset,
    fbm: fbm, clamp: clamp, clamp01: clamp01, bell: bell,
    WF_REGIONS: WF_REGIONS, TROUT_WATERS: TROUT_WATERS
  };
})(window);
