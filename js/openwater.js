/* OmniGuide - open water in a freeze.

   WHY THIS EXISTS.

   The duck model already knew that a partial freeze concentrates birds -
   it peaks at about half frozen and falls away either side. What it did
   not know is WHERE the open water is. Freeze was applied uniformly, so
   every cell in a cold region took the same penalty, and a tailwater
   running four thousand cubic feet a second below a dam was treated
   exactly like the shallow pothole next to it that locks up solid in one
   hard night.

   That is backwards for the places that matter most in late season. When
   everything else freezes, the water that stays open does not get worse -
   it gets better, because every bird for fifty miles is now on it.

   This reads the USGS gauge network already ingested for streamflow and
   asks a different question of it: how likely is there to be open water
   here when it turns hard?

     - Discharge. Moving water resists freezing, and the bigger the river
       the longer it holds. Log-scaled, because the difference between 20
       and 200 cfs matters far more than between 20,000 and 20,200.
     - Tailwater. USGS names its sites descriptively, so "BELOW HOLT DAM"
       and "TAILRACE" are in the record. Releases are drawn from depth and
       come out well above freezing. Only counted where discharge is
       actually substantial - a great many "below dam" sites in the
       network are trickles behind farm ponds.
     - Measured water temperature, where the site reports it. Nothing
       beats being told the water is 41 degrees.

   Returns 0 to 1. Zero means no gauge nearby says anything reassuring,
   which is not proof the water freezes - only that we have no evidence it
   stays open, and the model treats it as the ordinary case rather than as
   a penalty. */
(function (global) {
  'use strict';

  var raw = global.US_GAUGES || null;

  /* USGS site naming. Deliberately conservative: these phrases are
     unambiguous, and anything vaguer would start matching reservoirs
     above the dam, which freeze like any other lake. */
  var TAILWATER = /\b(TAILRACE|TAILWATER|POWERHOUSE|PWRHSE)\b|\b(BL|BLW|BELOW|DS)\b[^,]{0,40}\bDAM\b/i;

  var BIN = 1;                       // degrees
  var RADIUS_KM = 45;
  var PLATEAU_KM = 14;
  var bins = null;

  function binKey(ix, iy) { return ix * 1000 + iy; }

  function build() {
    bins = new Map();
    if (!raw || !raw.sites) return;
    for (var i = 0; i < raw.sites.length; i++) {
      var s = raw.sites[i];
      var lat = s[2], lon = s[3], tempC = s[4], cfs = s[5];
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      if (typeof cfs !== 'number' && typeof tempC !== 'number') continue;

      /* Log size: 16 cfs reads as nothing, 3000 cfs reads as full. */
      var size = 0;
      if (typeof cfs === 'number' && cfs > 0) {
        size = (Math.log(cfs + 1) / Math.LN10 - 1.2) / 2.3;
        size = size < 0 ? 0 : size > 1 ? 1 : size;
      }
      var isTail = TAILWATER.test(s[1] || '');
      var warm = null;
      if (typeof tempC === 'number') {
        var f = tempC * 9 / 5 + 32;
        warm = (f - 33) / 8;
        warm = warm < 0 ? 0 : warm > 1 ? 1 : warm;
      }

      var v = size;
      /* A named tailwater with real flow behind it, which is the case
         that actually holds birds. */
      if (isTail && size > 0.25) v = Math.min(1, v + 0.30);
      if (warm != null) v = Math.min(1, v + 0.25 * warm);
      if (v <= 0.02) continue;

      /* How far this gauge speaks for. A creek tells you about its own
         valley; the Missouri at 60,000 cfs is open for its whole length,
         and the next gauge down may be eighty km away. Mainstem reaches
         were reading as gaps between gauges before this. */
      var reach = 22 + 55 * v;

      var k = binKey(Math.floor(lon / BIN), Math.floor(lat / BIN));
      var arr = bins.get(k);
      if (!arr) { arr = []; bins.set(k, arr); }
      arr.push([lon, lat, v, isTail ? 1 : 0, reach]);
    }
  }

  /* ---------- NLCD open water ----------
     The gauge network is sparse and inconsistently equipped. Land cover
     is neither, and it is the only one of the two that knows the
     Mississippi is there when the gauge on it reports no discharge. */

  var wraw = global.US_WATER || null;
  var WG = wraw ? wraw.grid : null;
  var wplane = undefined;

  function waterFrac(lon, lat) {
    if (!WG) return null;
    if (wplane === undefined) {
      try {
        var bin = global.atob(wraw.water);
        var a = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
        wplane = a;
      } catch (e) { wplane = null; }
    }
    if (!wplane) return null;
    var ix = Math.floor((lon - WG.lon0) / WG.d), iy = Math.floor((lat - WG.lat0) / WG.d);
    if (ix < 0 || iy < 0 || ix >= WG.nlon || iy >= WG.nlat) return null;

    /* Largest value in a 3x3 neighbourhood rather than the cell alone. A
       river narrower than 11 km of cell can sit just across the line, and
       birds do not care which cell the bank is in. */
    var best = 0;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var x = ix + dx, y = iy + dy;
        if (x < 0 || y < 0 || x >= WG.nlon || y >= WG.nlat) continue;
        var v = wplane[y * WG.nlon + x] / 255;
        if (v > best) best = v;
      }
    }
    return best;
  }

  var cache = new Map();

  function at(lon, lat) {
    if (!bins) build();

    var ck = Math.round(lon * 20) * 8192 + Math.round(lat * 20);
    var hit = cache.get(ck);
    if (hit !== undefined) return hit;

    var kmPerLon = 111.32 * Math.cos(lat * Math.PI / 180);
    var ix = Math.floor(lon / BIN), iy = Math.floor(lat / BIN);
    var best = 0, bestTail = 0;

    for (var dx = -2; dx <= 2; dx++) {
      for (var dy = -2; dy <= 2; dy++) {
        var arr = bins.get(binKey(ix + dx, iy + dy));
        if (!arr) continue;
        for (var i = 0; i < arr.length; i++) {
          var g = arr[i];
          var ex = (g[0] - lon) * kmPerLon, ey = (g[1] - lat) * 111.32;
          var d = Math.sqrt(ex * ex + ey * ey);
          var reach = g[4];
          if (d > reach) continue;
          /* Strongest wins rather than a sum: two gauges on the same
             river are one piece of open water, not two. Full weight
             inside the plateau - a cell 10 km from a big-river gauge
             contains that river, and a squared falloff from zero was
             quietly halving every tailwater in the country. */
          var plat = Math.min(PLATEAU_KM, reach * 0.4);
          var w = d <= plat ? 1 : 1 - (d - plat) / (reach - plat);
          var v = g[2] * w;
          if (v > best) { best = v; bestTail = g[3]; }
        }
      }
    }

    /* Standing or flowing water present at all. Four percent of an 11 km
       cell is a serious river; a third of it is a reservoir. */
    var frac = waterFrac(lon, lat);
    var bulk = frac == null ? 0 : Math.min(1, Math.max(0, (frac - 0.04) / 0.30));

    /* Weighted toward the gauges, because moving water is what actually
       stays open. Land cover cannot tell the Missouri below Garrison from
       Lake Isabel forty miles east - both read as water, and in a North
       Dakota January only one of them is still liquid. Standing water
       still counts for something: a big lake holds out longer than a
       field, and it is where the birds go when it finally gives. */
    var out = Math.min(1, 0.35 * bulk + 0.80 * best);

    if (cache.size > 40000) cache.clear();
    cache.set(ck, out);
    lastTail = bestTail;
    return out;
  }

  var lastTail = 0;

  global.OG = global.OG || {};
  global.OG.openwater = {
    at: at,
    /* Whether the strongest nearby evidence was a named tailwater, for
       the wording in the plan panel. Valid immediately after at(). */
    lastWasTailwater: function () { return !!lastTail; },
    ready: !!(raw && raw.sites && raw.sites.length)
  };
})(window);
