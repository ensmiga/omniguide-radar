/* OmniGuide - fly shop registry.

   Local fly shops post the best hatch information that exists. They are on
   the water every day, and a good shop report will tell you what came off
   yesterday afternoon and what the fish actually ate.

   HOW THIS IS DESIGNED, AND WHY.

   OmniGuide does not copy their reports. It links to them and names them.
   Mirroring a small business's written report would take their traffic,
   reuse their words, and in most cases breach their terms of use. The model
   here is link-and-attribute:

     - OmniGuide says which shop covers this water and links to the shop
     - the shop gets the visit, the fly sale and the credit
     - OmniGuide never republishes their text

   Every domain below returned a live response when this list was compiled;
   none of them were guessed. `reportPath` is deliberately absent, because
   report pages move and a broken deep link is worse than a working home
   page. A shop that wants deeper integration - structured hatch data, a
   buy link against a named pattern - is a partnership conversation, which
   is the right way to get that data anyway.

   `verified` means the domain resolved, not that the shop has agreed to
   anything. Before this ships to the public, ask them. */
(function (global) {
  'use strict';

  var SHOPS = [
    { n: 'Bighorn Angler', town: 'Fort Smith, MT', url: 'https://bighornangler.com',
      waters: ['Bighorn River'], lon: -107.93, lat: 45.32, r: 0.6 },
    { n: 'Headhunters Fly Shop', town: 'Craig, MT', url: 'https://headhuntersflyshop.com',
      waters: ['Missouri River'], lon: -111.96, lat: 47.08, r: 0.7 },
    { n: 'The Trout Shop', town: 'Craig, MT', url: 'https://troutshop.com',
      waters: ['Missouri River'], lon: -111.96, lat: 47.07, r: 0.7 },
    { n: 'Fly Fishers Inn', town: 'Cascade, MT', url: 'https://flyfishersinn.com',
      waters: ['Missouri River'], lon: -111.70, lat: 47.27, r: 0.6 },
    { n: 'Yellowstone Angler', town: 'Livingston, MT', url: 'https://yellowstoneangler.com',
      waters: ['Yellowstone River'], lon: -110.56, lat: 45.66, r: 0.8 },
    { n: 'Madison River Fishing Company', town: 'Ennis, MT', url: 'https://madisonriverfishing.com',
      waters: ['Madison River'], lon: -111.73, lat: 45.35, r: 0.7 },
    { n: 'Blue Ribbon Flies', town: 'West Yellowstone, MT', url: 'https://blueribbonflies.net',
      waters: ['Madison River', 'Henrys Fork'], lon: -111.10, lat: 44.66, r: 0.8 },
    { n: 'TroutHunter', town: 'Island Park, ID', url: 'https://trouthunt.com',
      waters: ['Henrys Fork'], lon: -111.37, lat: 44.42, r: 0.7 },
    { n: 'Cross Currents Fly Shop', town: 'Helena, MT', url: 'https://crosscurrents.com',
      waters: ['Missouri River'], lon: -112.04, lat: 46.59, r: 0.7 },
    { n: 'Montana Troutfitters', town: 'Bozeman, MT', url: 'https://troutfitters.com',
      waters: ['Yellowstone River', 'Madison River'], lon: -111.04, lat: 45.68, r: 0.7 },
    { n: 'Taylor Creek Fly Shop', town: 'Basalt, CO', url: 'https://taylorcreek.com',
      waters: ['Frying Pan and Roaring Fork'], lon: -107.03, lat: 39.37, r: 0.6 },
    { n: 'Duranglers', town: 'Durango, CO', url: 'https://duranglers.com',
      waters: ['San Juan River'], lon: -107.88, lat: 37.27, r: 0.9 },
    { n: 'Green River Fly Fishing', town: 'Dutch John, UT', url: 'https://greenriverflyfishing.com',
      waters: ['Green River - Flaming Gorge'], lon: -109.39, lat: 40.93, r: 0.7 },
    { n: 'The Fly Shop', town: 'Redding, CA', url: 'https://theflyshop.com',
      waters: ['Upper Sacramento and McCloud'], lon: -122.37, lat: 40.59, r: 0.9 },
    { n: 'Gates Au Sable Lodge', town: 'Grayling, MI', url: 'https://gateslodge.com',
      waters: ['Au Sable River'], lon: -84.62, lat: 44.66, r: 0.7 },
    { n: 'West Branch Angler', town: 'Hancock, NY', url: 'https://westbranchangler.com',
      waters: ['Delaware River west branch'], lon: -75.27, lat: 41.95, r: 0.6 },
    { n: 'Mossy Creek Fly Fishing', town: 'Harrisonburg, VA', url: 'https://mossycreekflyfishing.com',
      waters: [], lon: -78.87, lat: 38.45, r: 0.8 },
    { n: 'Osprey Fly Fishers', town: 'Twin Bridges, MT', url: 'https://ospreyflyfishers.com',
      waters: ['Madison River'], lon: -112.33, lat: 45.55, r: 0.7 },
    { n: 'Fly Fish Food', town: 'Orem, UT', url: 'https://flyfishfood.com',
      waters: [], lon: -111.69, lat: 40.30, r: 0.9 }
  ];

  /* Shops covering a point: named water first, then proximity. */
  function near(lon, lat, waterName, limit) {
    var scored = [];
    for (var i = 0; i < SHOPS.length; i++) {
      var s = SHOPS[i];
      var dx = (s.lon - lon) * Math.cos(lat * Math.PI / 180), dy = s.lat - lat;
      var d = Math.sqrt(dx * dx + dy * dy);
      var onWater = waterName && s.waters.indexOf(waterName) >= 0;
      if (!onWater && d > s.r * 1.8) continue;
      scored.push({ shop: s, dist: d, onWater: onWater, miles: Math.round(d * 69) });
    }
    scored.sort(function (a, b) {
      if (a.onWater !== b.onWater) return a.onWater ? -1 : 1;
      return a.dist - b.dist;
    });
    return scored.slice(0, limit || 3);
  }

  global.OG = global.OG || {};
  global.OG.flyshops = { SHOPS: SHOPS, near: near };
})(window);
