/* OmniGuide - observed water.

   USGS instantaneous-values gauges: discharge and water temperature,
   measured rather than modelled. Until now the trout model inferred water
   temperature from air temperature and invented streamflow from a seasonal
   curve. Where a gauge is close enough to be about the same water, the
   measurement wins.

   "Close enough" is the whole question. A gauge forty miles away on a
   different river tells you nothing, so the lookup is deliberately strict:
   within ~25 miles, and the result carries the distance so the UI can say
   where the number came from. Nothing is interpolated between gauges,
   because two gauges on different rivers do not average into anything
   real. */
(function (global) {
  'use strict';

  var G = global.US_GAUGES || null;
  var MAX_MILES = 25;

  /* Binned by whole degree. The lookup used to walk all ten thousand
     gauges, twice, for every point asked about - most of a millisecond a
     call. That was tolerable while only "today" used a gauge. Once the
     forecast days were anchored to the reading as well, every frame of
     the map paid it at every node and changing species froze the page
     for ten seconds. Twenty-five miles is never more than 0.55 of a
     degree here, so the nearest gauge that could qualify is always in
     the point's own cell or one of the eight around it. */
  var sites = [], bins = new Map();
  function binKey(ix, iy) { return ix * 1000 + iy; }
  if (G && G.sites) {
    for (var i = 0; i < G.sites.length; i++) {
      var s = G.sites[i];
      if (typeof s[2] !== 'number' || typeof s[3] !== 'number') continue;
      var site = { id: s[0], name: s[1], lat: s[2], lon: s[3], tempC: s[4], cfs: s[5] };
      sites.push(site);
      var k = binKey(Math.floor(site.lon), Math.floor(site.lat));
      var b = bins.get(k);
      if (!b) { b = []; bins.set(k, b); }
      b.push(site);
    }
  }

  function available() { return sites.length > 0; }

  /* Nearest gauge reporting the field asked for. */
  function nearest(lon, lat, field) {
    var best = null, bd = Infinity;
    var cx = Math.floor(lon), cy = Math.floor(lat);
    var cosLat = Math.cos(lat * Math.PI / 180);
    for (var ix = cx - 1; ix <= cx + 1; ix++) {
      for (var iy = cy - 1; iy <= cy + 1; iy++) {
        var b = bins.get(binKey(ix, iy));
        if (!b) continue;
        for (var i = 0; i < b.length; i++) {
          var s = b[i];
          if (field === 'temp' && (s.tempC === null || s.tempC === undefined)) continue;
          if (field === 'flow' && (s.cfs === null || s.cfs === undefined)) continue;
          var dx = (s.lon - lon) * cosLat;
          var dy = s.lat - lat;
          var d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = s; }
        }
      }
    }
    if (!best) return null;
    var miles = Math.sqrt(bd) * 69;
    if (miles > MAX_MILES) return null;
    return { site: best, miles: miles };
  }

  /* Observed water conditions at a point, or null when no gauge is near. */
  function at(lon, lat) {
    var t = nearest(lon, lat, 'temp');
    var f = nearest(lon, lat, 'flow');
    if (!t && !f) return null;
    var out = { fetched: G.fetched };
    if (t) {
      out.waterTempF = t.site.tempC * 9 / 5 + 32;
      out.tempSite = t.site.name;
      out.tempMiles = Math.round(t.miles);
    }
    if (f) {
      out.cfs = f.site.cfs;
      out.flowSite = f.site.name;
      out.flowMiles = Math.round(f.miles);
    }
    return out;
  }

  global.OG = global.OG || {};
  global.OG.gauges = {
    available: available, at: at, count: sites.length,
    fetched: G ? G.fetched : null, maxMiles: MAX_MILES
  };
})(window);
