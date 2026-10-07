/* Regenerates the CAL table in js/models.js.

   The scoring model's weighted mean never spans 0-100 - its components rarely
   peak at the same time - and each species sits in its own narrow band. CAL
   rescales each species through the range it actually produces, so the word
   "Primo" means the same thing for ducks as for elk.

   This has to run in the browser, because the model needs env.js, geo.js and
   the fetched forecast/habitat data. Open the site, wait for it to finish
   loading, open the console and paste this file in. It prints the replacement
   CAL literal; paste that over the one in js/models.js.

   Run it after changing any species' weights, movement curve, habitat key or
   pressure sensitivity - those all shift the raw range. */
(function () {
  var SPECIES = ['ducks', 'canada-goose', 'elk', 'whitetail', 'muledeer',
                 'moose', 'pronghorn', 'turkey', 'upland', 'trout'];
  var LAT_STEP = 1.8, LON_STEP = 1.8, DAY_STEP = 5;

  function anchors(spId) {
    var vals = [];
    for (var t = -170; t <= 195; t += DAY_STEP) {
      var doy = OG.env.doyFor(t);
      for (var lat = 25.5; lat <= 49; lat += LAT_STEP) {
        for (var lon = -124; lon <= -67; lon += LON_STEP) {
          if (OG.geo.stateIndexAt(lon, lat) < 0) continue;
          var sc = OG.models.scoreAt(lon, lat, t, doy, spId);
          if (sc.inRange) vals.push(sc.breakdown.afterPressure);
        }
      }
    }
    if (vals.length < 200) { console.warn(spId + ': only ' + vals.length + ' samples'); }
    vals.sort(function (a, b) { return a - b; });
    var q = function (p) { return vals[Math.min(vals.length - 1, Math.floor(vals.length * p))]; };
    return { lo: q(0.02), hi: q(0.995), n: vals.length };
  }

  var pad = 0;
  SPECIES.forEach(function (s) { pad = Math.max(pad, s.length + 3); });

  var lines = SPECIES.map(function (spId) {
    var a = anchors(spId);
    console.log(spId + ': n=' + a.n);
    var key = "'" + spId + "':";
    while (key.length < pad) key += ' ';
    return '    ' + key + ' [' + a.lo.toFixed(1) + ', ' + a.hi.toFixed(1) + ']';
  });

  console.log('\n  var CAL = {\n' + lines.join(',\n') + '\n  };');
})();
