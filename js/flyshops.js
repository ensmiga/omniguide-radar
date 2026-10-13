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

   HOW THE LIST WAS CHECKED, AND WHAT THAT FOUND.

   The first version of this list said every domain had returned a live
   response and none had been guessed. Both were true and neither was
   enough: a domain answering is not the shop answering. Of nineteen
   entries, five were wrong. One address belonged to a fly fishing club in
   British Columbia and was listed as a shop in Twin Bridges, Montana. One
   lodge had closed and its address forwarded to a property listing. Two
   pointed at a different site from the shop named. One was a blank page.

   Every entry below was fetched on 2026-10-09 and the page read for the
   shop's own name and its town. Where the home page names the shop but not
   the town (it is on a contact page instead), the entry is marked. A
   candidate whose address now serves a gambling site was dropped, which is
   the argument for doing this again before each release rather than once.

   `waters` are names from js/trout-waters.js, spelled exactly, because the
   match is on the name: three Missouri River shops were listed against
   'Missouri River' when the water is called 'Missouri River - Craig', and
   so were never shown as fishing it.

   None of these shops has agreed to anything. Before this ships to the
   public, ask them. */
(function (global) {
  'use strict';

  var SHOPS = [
    /* Montana */
    { n: 'Bighorn Angler', town: 'Fort Smith, MT', url: 'https://bighornangler.com',
      waters: ['Bighorn River'], lon: -107.93, lat: 45.32, r: 0.6 },
    { n: 'Headhunters Fly Shop', town: 'Craig, MT', url: 'https://headhuntersflyshop.com',
      waters: ['Missouri River - Craig'], lon: -111.96, lat: 47.08, r: 0.7 },
    { n: 'The Trout Shop', town: 'Craig, MT', url: 'https://thetroutshop.com',
      waters: ['Missouri River - Craig'], lon: -111.96, lat: 47.07, r: 0.7 },
    { n: 'CrossCurrents Fly Shop', town: 'Helena, MT', url: 'https://crosscurrents.com',
      waters: ['Missouri River - Craig'], lon: -112.04, lat: 46.59, r: 0.7 },
    { n: 'Yellowstone Angler', town: 'Livingston, MT', url: 'https://yellowstoneangler.com',
      waters: ['Yellowstone River'], lon: -110.56, lat: 45.66, r: 0.8 },
    { n: 'Montana Troutfitters', town: 'Bozeman, MT', url: 'https://troutfitters.com',
      waters: ['Yellowstone River', 'Madison River'], lon: -111.04, lat: 45.68, r: 0.7 },
    { n: 'Madison River Fishing Company', town: 'Ennis, MT', url: 'https://www.mrfc.com',
      waters: ['Madison River'], lon: -111.73, lat: 45.35, r: 0.7 },
    /* home page names the shop, not the town */
    { n: 'Blue Ribbon Flies', town: 'West Yellowstone, MT', url: 'https://blueribbonflies.com',
      waters: ['Madison River', 'Henrys Fork'], lon: -111.10, lat: 44.66, r: 0.8 },
    { n: 'Four Rivers Fishing Company', town: 'Twin Bridges, MT', url: 'https://4riversmontana.com',
      waters: ['Big Hole and Beaverhead'], lon: -112.33, lat: 45.54, r: 0.7 },
    { n: 'Frontier Anglers', town: 'Dillon, MT', url: 'https://frontieranglers.com',
      waters: ['Big Hole and Beaverhead'], lon: -112.64, lat: 45.22, r: 0.7 },
    { n: 'Grizzly Hackle', town: 'Missoula, MT', url: 'https://grizzlyhackle.com',
      waters: ['Bitterroot and Blackfoot'], lon: -113.99, lat: 46.87, r: 0.8 },

    /* Idaho, Wyoming, the Dakotas */
    { n: 'TroutHunter', town: 'Island Park, ID', url: 'https://trouthunt.com',
      waters: ['Henrys Fork'], lon: -111.37, lat: 44.42, r: 0.7 },
    /* home page names the shop, not the town */
    { n: "Henry's Fork Anglers", town: 'Island Park, ID', url: 'https://henrysforkanglers.com',
      waters: ['Henrys Fork'], lon: -111.33, lat: 44.42, r: 0.7 },
    { n: 'WorldCast Anglers', town: 'Victor, ID', url: 'https://worldcastanglers.com',
      waters: ['Snake River - South Fork'], lon: -111.11, lat: 43.60, r: 0.7 },
    { n: 'Silver Creek Outfitters', town: 'Ketchum, ID', url: 'https://silver-creek.com',
      waters: ['Silver Creek'], lon: -114.36, lat: 43.68, r: 0.7 },
    { n: 'The Reef Fly Shop', town: 'Alcova, WY', url: 'https://northplatteflyfishing.com',
      waters: ['North Platte - Grey Reef'], lon: -106.72, lat: 42.55, r: 0.7 },
    { n: 'Dakota Angler and Outfitter', town: 'Rapid City, SD', url: 'https://flyfishsd.com',
      waters: ['Black Hills streams'], lon: -103.23, lat: 44.08, r: 0.7 },

    /* Utah, Colorado, the Southwest */
    { n: 'Trout Creek Flies', town: 'Dutch John, UT', url: 'https://troutcreekflies.com',
      waters: ['Green River - Flaming Gorge'], lon: -109.39, lat: 40.93, r: 0.7 },
    { n: 'Fly Fish Food', town: 'Orem, UT', url: 'https://flyfishfood.com',
      waters: ['Provo River'], lon: -111.69, lat: 40.30, r: 0.9 },
    { n: 'Taylor Creek Fly Shop', town: 'Basalt, CO', url: 'https://taylorcreek.com',
      waters: ['Frying Pan and Roaring Fork'], lon: -107.03, lat: 39.37, r: 0.6 },
    { n: 'Blue Quill Angler', town: 'Evergreen, CO', url: 'https://bluequillangler.com',
      waters: ['South Platte - Deckers'], lon: -105.32, lat: 39.63, r: 0.7 },
    { n: 'ArkAnglers', town: 'Salida, CO', url: 'https://arkanglers.com',
      waters: ['Arkansas River'], lon: -106.00, lat: 38.53, r: 0.7 },
    { n: 'Duranglers', town: 'Durango, CO', url: 'https://duranglers.com',
      waters: ['San Juan River'], lon: -107.88, lat: 37.27, r: 0.9 },
    { n: 'Fisheads San Juan River Lodge', town: 'Navajo Dam, NM', url: 'https://fisheadsofthesanjuan.com',
      waters: ['San Juan River'], lon: -107.68, lat: 36.82, r: 0.6 },
    { n: 'Taos Fly Shop', town: 'Taos, NM', url: 'https://taosflyshop.com',
      waters: [], lon: -105.57, lat: 36.40, r: 0.8 },
    { n: 'Lees Ferry Anglers', town: 'Marble Canyon, AZ', url: 'https://leesferry.com',
      waters: ['Lees Ferry'], lon: -111.64, lat: 36.81, r: 0.6 },

    /* Pacific states */
    { n: 'The Fly Shop', town: 'Redding, CA', url: 'https://theflyshop.com',
      waters: ['Lower Sacramento River', 'Upper Sacramento and McCloud', 'Hat Creek and Fall River'],
      lon: -122.37, lat: 40.59, r: 0.9 },
    { n: 'Ted Fay Fly Shop', town: 'Dunsmuir, CA', url: 'https://tedfay.com',
      waters: ['Upper Sacramento and McCloud'], lon: -122.27, lat: 41.21, r: 0.6 },
    { n: 'Trout Creek Outfitters', town: 'Truckee, CA', url: 'https://troutcreekoutfitters.com',
      waters: ['Truckee River'], lon: -120.18, lat: 39.33, r: 0.7 },
    { n: 'Deschutes Angler', town: 'Maupin, OR', url: 'https://deschutesangler.com',
      waters: ['Deschutes River'], lon: -121.08, lat: 45.18, r: 0.7 },
    { n: "The Fly Fisher's Place", town: 'Sisters, OR', url: 'https://flyfishersplace.com',
      waters: ['Metolius River'], lon: -121.55, lat: 44.29, r: 0.7 },
    { n: "Red's Fly Shop", town: 'Ellensburg, WA', url: 'https://redsflyfishing.com',
      waters: ['Yakima River'], lon: -120.47, lat: 46.83, r: 0.7 },

    /* Midwest */
    { n: 'Gates Au Sable Lodge', town: 'Grayling, MI', url: 'https://gateslodge.com',
      waters: ['Au Sable River'], lon: -84.62, lat: 44.66, r: 0.7 },
    { n: 'Pere Marquette River Lodge', town: 'Baldwin, MI', url: 'https://pmlodge.com',
      waters: ['Pere Marquette River'], lon: -85.85, lat: 43.87, r: 0.7 },
    { n: 'Driftless Angler', town: 'Viroqua, WI', url: 'https://driftlessangler.com',
      waters: ['Driftless spring creeks'], lon: -90.89, lat: 43.56, r: 0.9 },

    /* Ozarks and the South */
    { n: "Dally's Ozark Fly Fisher", town: 'Cotter, AR', url: 'https://stevedallyoutfitters.com',
      waters: ['White River'], lon: -92.52, lat: 36.27, r: 0.7 },
    { n: 'River Run Outfitters', town: 'Branson, MO', url: 'https://riverrunoutfitters.com',
      waters: ['Lake Taneycomo'], lon: -93.30, lat: 36.67, r: 0.6 },
    { n: 'Gruene Outfitters', town: 'New Braunfels, TX', url: 'https://grueneoutfitters.com',
      waters: ['Guadalupe River'], lon: -98.10, lat: 29.74, r: 0.6 },
    /* home page names the shop, not the town */
    { n: 'Unicoi Outfitters', town: 'Helen, GA', url: 'https://unicoioutfitters.com',
      waters: [], lon: -83.73, lat: 34.70, r: 0.7 },
    { n: 'South Holston River Fly Shop', town: 'Bristol, TN', url: 'https://southholstonriverflyshop.com',
      waters: ['South Holston and Watauga'], lon: -82.10, lat: 36.52, r: 0.6 },
    { n: 'Little River Outfitters', town: 'Townsend, TN', url: 'https://littleriveroutfitters.com',
      waters: ['Great Smoky headwaters'], lon: -83.76, lat: 35.68, r: 0.7 },
    { n: 'Davidson River Outfitters', town: 'Pisgah Forest, NC', url: 'https://davidsonflyfishing.com',
      waters: ['Davidson River'], lon: -82.70, lat: 35.27, r: 0.6 },

    /* Mid-Atlantic and the Northeast */
    { n: 'Mossy Creek Fly Fishing', town: 'Harrisonburg, VA', url: 'https://mossycreekflyfishing.com',
      waters: ['Mossy Creek'], lon: -78.87, lat: 38.45, r: 0.8 },
    { n: 'Backwater Angler', town: 'Monkton, MD', url: 'https://backwaterangler.com',
      waters: ['Gunpowder Falls'], lon: -76.62, lat: 39.58, r: 0.6 },
    { n: 'TCO Fly Shop', town: 'State College, PA', url: 'https://www.tcoflyfishing.com',
      waters: ['Penns Creek and Spring Creek'], lon: -77.86, lat: 40.79, r: 0.7 },
    { n: 'TCO Fly Shop', town: 'Boiling Springs, PA', url: 'https://www.tcoflyfishing.com',
      waters: ['Letort and Cumberland limestone'], lon: -77.13, lat: 40.15, r: 0.6 },
    /* home page names the shop, not the town */
    { n: 'West Branch Angler', town: 'Hancock, NY', url: 'https://westbranchangler.com',
      waters: ['Delaware River west branch'], lon: -75.27, lat: 41.95, r: 0.6 },
    { n: 'Beaverkill Angler', town: 'Roscoe, NY', url: 'https://beaverkillangler.com',
      waters: ['Beaverkill and Willowemoc'], lon: -74.91, lat: 41.93, r: 0.6 },
    { n: 'Whitakers Sports Store', town: 'Pulaski, NY', url: 'https://whitakers.com',
      waters: [], lon: -76.13, lat: 43.57, r: 0.6 },
    /* home page names the shop, not the town */
    { n: 'UpCountry Sportfishing', town: 'New Hartford, CT', url: 'https://farmingtonriver.com',
      waters: ['Farmington River'], lon: -72.97, lat: 41.88, r: 0.6 }
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
