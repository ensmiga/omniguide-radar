/* OmniGuide - observed land cover.

   NLCD 2021 via the MRLC WMS, queried at the exact coordinate and across a
   small ring around it, so the Guide can say what the ground actually is
   rather than what a hand-placed habitat blob assumes.

   The habitat surfaces in js/env.js are smooth regional functions - good
   enough to rank country at national scale, useless at the scale of a
   field edge. This answers "what is under this pin and what surrounds it":
   flooded crops or dry pasture, timber or sage, wetland or open water.

   Needs network access, so it does nothing in the artifact sandbox and the
   Guide carries on with the modelled habitat. */
(function (global) {
  'use strict';

  var WMS = 'https://www.mrlc.gov/geoserver/mrlc_display/wms';
  var LAYER = 'NLCD_2021_Land_Cover_L48';

  /* NLCD legend, grouped into the things a hunter cares about. */
  var CLASSES = {
    11: { n: 'open water', g: 'water' },
    12: { n: 'perennial ice', g: 'barren' },
    21: { n: 'developed, open space', g: 'developed' },
    22: { n: 'developed, low intensity', g: 'developed' },
    23: { n: 'developed, medium intensity', g: 'developed' },
    24: { n: 'developed, high intensity', g: 'developed' },
    31: { n: 'barren', g: 'barren' },
    41: { n: 'deciduous forest', g: 'forest' },
    42: { n: 'evergreen forest', g: 'forest' },
    43: { n: 'mixed forest', g: 'forest' },
    52: { n: 'shrub and scrub', g: 'shrub' },
    71: { n: 'grassland and herbaceous', g: 'grass' },
    81: { n: 'pasture and hay', g: 'pasture' },
    82: { n: 'cultivated crops', g: 'crops' },
    90: { n: 'woody wetlands', g: 'wetland' },
    95: { n: 'emergent herbaceous wetland', g: 'wetland' }
  };

  var cache = new Map();

  function queryPoint(lon, lat) {
    var k = lon.toFixed(4) + ',' + lat.toFixed(4);
    if (cache.has(k)) return Promise.resolve(cache.get(k));
    var d = 0.0012;                       // ~130 m box, one pixel sampled
    var url = WMS + '?service=WMS&version=1.1.1&request=GetFeatureInfo' +
      '&layers=' + LAYER + '&query_layers=' + LAYER + '&srs=EPSG:4326' +
      '&bbox=' + (lon - d) + ',' + (lat - d) + ',' + (lon + d) + ',' + (lat + d) +
      '&width=10&height=10&x=5&y=5&info_format=application/json';
    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var v = j && j.features && j.features[0] && j.features[0].properties;
        var code = v ? (v.PALETTE_INDEX != null ? v.PALETTE_INDEX : v.GRAY_INDEX) : null;
        if (cache.size > 500) cache.clear();
        cache.set(k, code);
        return code;
      })
      .catch(function () { return null; });
  }

  /* The point plus eight samples on a ring, giving a composition rather
     than a single pixel that might be a road or a pond. */
  function analyse(lon, lat, ringM) {
    var R = ringM || 500;
    var mLat = 111320, mLon = 111320 * Math.cos(lat * Math.PI / 180);
    var pts = [[lon, lat]];
    for (var a = 0; a < 8; a++) {
      var th = a / 8 * 2 * Math.PI;
      pts.push([lon + Math.sin(th) * R / mLon, lat + Math.cos(th) * R / mLat]);
    }
    return Promise.all(pts.map(function (p) { return queryPoint(p[0], p[1]); }))
      .then(function (codes) {
        var centre = codes[0];
        var valid = codes.filter(function (c) { return c != null && CLASSES[c]; });
        if (!valid.length) return null;

        var groups = {}, n = valid.length;
        valid.forEach(function (c) {
          var g = CLASSES[c].g;
          groups[g] = (groups[g] || 0) + 1;
        });
        var mix = Object.keys(groups).map(function (g) {
          return { group: g, share: groups[g] / n };
        }).sort(function (x, y) { return y.share - x.share; });

        return {
          centreCode: centre,
          centre: centre != null && CLASSES[centre] ? CLASSES[centre].n : 'unknown',
          centreGroup: centre != null && CLASSES[centre] ? CLASSES[centre].g : null,
          mix: mix,
          share: function (g) { return groups[g] ? groups[g] / n : 0; },
          sampled: n, ringM: R,
          source: 'NLCD 2021 (MRLC)'
        };
      })
      .catch(function () { return null; });
  }

  global.OG = global.OG || {};
  global.OG.landcover = { analyse: analyse, CLASSES: CLASSES };
})(window);
