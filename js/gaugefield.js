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

  var sites = [];
  if (G && G.sites) {
    for (var i = 0; i < G.sites.length; i++) {
      var s = G.sites[i];
      sites.push({ id: s[0], name: s[1], lat: s[2], lon: s[3], tempC: s[4], cfs: s[5] });
    }
  }

  function available() { return sites.length > 0; }

  /* Nearest gauge reporting the field asked for. */
  function nearest(lon, lat, field) {
    var best = null, bd = Infinity;
    for (var i = 0; i < sites.length; i++) {
      var s = sites[i];
      if (field === 'temp' && (s.tempC === null || s.tempC === undefined)) continue;
      if (field === 'flow' && (s.cfs === null || s.cfs === undefined)) continue;
      var dx = (s.lon - lon) * Math.cos(lat * Math.PI / 180);
      var dy = s.lat - lat;
      var d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = s; }
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
