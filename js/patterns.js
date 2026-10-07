/* OmniGuide - subsurface patterns by water.

   What actually produces below the surface on a given river, which is not
   the same question as what is hatching. Most fish, most days, eat
   subsurface, and the productive patterns on a tailwater are often nothing
   to do with the day's emergence: sowbugs on the Bighorn, mysis below
   Ruedi, a pink squirrel in the Driftless.

   PROVENANCE, because it matters.

   These are established patterns for each water - the flies that have
   produced there for years and that any shop in the valley will have in
   the bins. They are NOT scraped from shop reports, and they are not a
   claim about what is working this week. OmniGuide links to the local
   shops for that, because their report is theirs and they are the ones
   standing in the river.

   The honest division of labour:
     here          - what reliably works on this water, and when
     the shop link - what is working right now

   If a shop partners, their current picks can slot in above these with a
   buy link, which is the right way to get that data and the right way to
   pay for it. */
(function (global) {
  'use strict';

  /* m: months the pattern is worth fishing (1 = January). */
  var ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  var COLD = [11, 12, 1, 2, 3, 4];
  var WARM = [5, 6, 7, 8, 9, 10];

  var WATERS = {
    'Bighorn River': [
      { f: 'Ray Charles sowbug', s: '#14-16', m: ALL, w: 'Tan or grey. The fly the river is known for, and it works every month.' },
      { f: 'Firebead sowbug', s: '#14-16', m: ALL, w: 'The hot-bead version when the water is off colour or fish are stale.' },
      { f: 'Zebra midge', s: '#18-20', m: COLD, w: 'Black with silver. The winter and early spring workhorse.' },
      { f: 'Pheasant tail', s: '#16-18', m: ALL, w: 'Generic mayfly nymph, best through the BWO weeks.' },
      { f: 'Soft hackle sowbug', s: '#16', m: WARM, w: 'Swung on the tailouts in the afternoon.' }
    ],
    'Missouri River - Craig': [
      { f: 'Zebra midge', s: '#16-18', m: ALL, w: 'Red or black. The default on this river.' },
      { f: 'Pink Amex', s: '#16', m: ALL, w: 'An attractor that works when nothing obvious is happening.' },
      { f: 'Firebead ray charles', s: '#14-16', m: COLD, w: 'Sowbug imitation for the colder half of the year.' },
      { f: 'Split case PMD', s: '#16', m: [6, 7], w: 'Through the PMD weeks, fished off the back of a heavier fly.' },
      { f: 'Weight fly or rubber legs', s: '#8-10', m: ALL, w: 'As the anchor rather than the attraction.' }
    ],
    'San Juan River': [
      { f: 'Midge larva', s: '#22-26', m: ALL, w: 'Red, cream or olive. Small is not optional here.' },
      { f: 'Disco midge', s: '#22-24', m: ALL, w: 'Flash for off-colour water.' },
      { f: 'San Juan worm', s: '#12-14', m: ALL, w: 'Especially after any bump in flow.' },
      { f: 'RS2', s: '#22-24', m: ALL, w: 'Grey or black, fished high in the column as an emerger.' }
    ],
    'Green River - Flaming Gorge': [
      { f: 'Scud', s: '#14-16', m: ALL, w: 'Orange or grey-olive. The staple below the dam.' },
      { f: 'Zebra midge', s: '#18-20', m: COLD, w: 'Through the cold months in the slower water.' },
      { f: 'Chironomid pupa', s: '#16-18', m: ALL, w: 'Fished deep in the flats.' },
      { f: 'San Juan worm', s: '#12', m: ALL, w: 'After rain or a flow change.' }
    ],
    'Madison River': [
      { f: "Pat's rubber legs", s: '#8-10', m: ALL, w: 'Black or brown. The anchor fly on this river.' },
      { f: 'Prince nymph', s: '#14-16', m: WARM, w: 'Classic attractor in the riffles.' },
      { f: 'Caddis pupa', s: '#14-16', m: [5, 6, 7, 8, 9], w: 'Through the long caddis season.' },
      { f: 'Salmonfly nymph', s: '#6-8', m: [4, 5, 6], w: 'Before and during the hatch, fished tight to the bank.' }
    ],
    'Yellowstone River': [
      { f: 'Rubber legs', s: '#8-10', m: ALL, w: 'Big water wants a big anchor.' },
      { f: 'Prince nymph', s: '#12-16', m: WARM, w: 'Dropped behind the stonefly.' },
      { f: 'Caddis pupa', s: '#14-16', m: [6, 7, 8, 9], w: 'Swung through the evening.' },
      { f: 'Pheasant tail', s: '#16-18', m: ALL, w: 'When the water drops and clears.' }
    ],
    'Henrys Fork': [
      { f: 'Flashback pheasant tail', s: '#16-18', m: ALL, w: 'The reliable searching nymph.' },
      { f: 'Zebra midge', s: '#18-20', m: COLD, w: 'Winter and early spring in the slow water.' },
      { f: 'Serendipity', s: '#16-18', m: ALL, w: 'Red or olive, fished just under the film.' },
      { f: 'PMD nymph', s: '#16', m: [6, 7], w: 'Ahead of the afternoon emergence.' }
    ],
    'White River': [
      { f: 'San Juan worm', s: '#10-12', m: ALL, w: 'Red. The first fly on after generation.' },
      { f: 'Egg pattern', s: '#14', m: [10, 11, 12, 1, 2, 3], w: 'Through the brown trout spawn and after.' },
      { f: 'Sowbug', s: '#14-16', m: ALL, w: 'Grey. The resident food source.' },
      { f: 'Ruby midge', s: '#18-20', m: COLD, w: 'In the slower water on low generation.' }
    ],
    'Frying Pan and Roaring Fork': [
      { f: 'Mysis shrimp', s: '#16-18', m: ALL, w: 'Below Ruedi, and the reason the fish there are the size they are.' },
      { f: 'Midge larva', s: '#20-24', m: COLD, w: 'The winter staple in the flats.' },
      { f: 'BWO nymph', s: '#18-20', m: [3, 4, 5, 9, 10, 11], w: 'Through both olive seasons.' },
      { f: 'Rubber legs', s: '#8-10', m: WARM, w: 'On the Roaring Fork rather than the Pan.' }
    ],
    'South Platte - Deckers': [
      { f: 'Midge larva', s: '#20-24', m: ALL, w: 'Black or red. The year-round answer.' },
      { f: 'BWO nymph', s: '#18-20', m: [3, 4, 5, 9, 10], w: 'Through the olive weeks.' },
      { f: 'Egg pattern', s: '#14-16', m: [10, 11, 12], w: 'During and after the spawn.' },
      { f: 'Pheasant tail', s: '#18-20', m: ALL, w: 'Small, and fished on fine tippet.' }
    ],
    'Deschutes River': [
      { f: 'Stonefly nymph', s: '#6-10', m: ALL, w: 'Golden or black, tight to the bank.' },
      { f: 'Prince nymph', s: '#12-14', m: WARM, w: 'The standard dropper here.' },
      { f: 'October caddis pupa', s: '#8-10', m: [9, 10], w: 'Through the autumn caddis.' },
      { f: 'Pheasant tail', s: '#14-16', m: ALL, w: 'In the softer seams.' }
    ],
    'Au Sable River': [
      { f: 'Hex nymph', s: '#6-8', m: [5, 6], w: 'In the silt beds ahead of the hatch.' },
      { f: 'Pheasant tail', s: '#14-18', m: ALL, w: 'The searching nymph all season.' },
      { f: 'Caddis pupa', s: '#14-16', m: WARM, w: 'Swung in the evening.' },
      { f: 'Prince nymph', s: '#12-16', m: ALL, w: 'Dark water, dark fly.' }
    ],
    'Driftless spring creeks': [
      { f: 'Pink squirrel', s: '#14-16', m: ALL, w: 'The Driftless fly. If you only carry one, carry this.' },
      { f: 'Scud', s: '#14-16', m: ALL, w: 'Grey or olive, in the watercress.' },
      { f: 'Pheasant tail', s: '#16-18', m: ALL, w: 'Through the riffles.' },
      { f: 'Caddis larva', s: '#14-16', m: WARM, w: 'Green, bounced along the bottom.' }
    ],
    'Gunnison and Taylor': [
      { f: 'Mysis shrimp', s: '#16-20', m: ALL, w: 'In the Taylor tailwater, where the big fish live on them.' },
      { f: 'Midge larva', s: '#20-24', m: COLD, w: 'Small and deep.' },
      { f: 'Rubber legs', s: '#8-10', m: WARM, w: 'On the Gunnison proper.' },
      { f: 'Pheasant tail', s: '#16-18', m: ALL, w: 'The default dropper.' }
    ],
    'Bitterroot and Blackfoot': [
      { f: 'Skwala nymph', s: '#10-12', m: [3, 4], w: 'Ahead of the spring stonefly, tight to the bank.' },
      { f: 'Rubber legs', s: '#8-10', m: ALL, w: 'The anchor through runoff and after.' },
      { f: 'Pheasant tail', s: '#14-18', m: ALL, w: 'Once the water clears.' },
      { f: 'Caddis pupa', s: '#14-16', m: WARM, w: 'Evening, swung.' }
    ],
    'Snake River - South Fork': [
      { f: 'Rubber legs', s: '#8-10', m: ALL, w: 'Brown or black, as the anchor.' },
      { f: 'Zebra midge', s: '#18', m: COLD, w: 'Through the winter flows.' },
      { f: 'PMD nymph', s: '#16', m: [6, 7], w: 'Ahead of the afternoon hatch.' },
      { f: 'San Juan worm', s: '#12', m: ALL, w: 'Any time the water comes up.' }
    ],
    'Upper Sacramento and McCloud': [
      { f: 'Caddis pupa', s: '#14-16', m: WARM, w: 'The dominant food here.' },
      { f: 'Birds nest', s: '#14-16', m: ALL, w: 'The regional searching fly.' },
      { f: 'Golden stone nymph', s: '#8-12', m: [4, 5, 6], w: 'In the pocket water.' },
      { f: 'Pheasant tail', s: '#16-18', m: ALL, w: 'Small, in the tailouts.' }
    ],
    'Delaware River west branch': [
      { f: 'Pheasant tail', s: '#16-20', m: ALL, w: 'Fished fine, these fish are educated.' },
      { f: 'BWO nymph', s: '#18-20', m: [4, 5, 9, 10], w: 'Through both olive seasons.' },
      { f: 'Sulphur nymph', s: '#16', m: [5, 6], w: 'Ahead of the evening emergence.' },
      { f: 'Caddis pupa', s: '#16', m: WARM, w: 'Swung at dusk.' }
    ],
    'Letort and Cumberland limestone': [
      { f: 'Cress bug', s: '#14-18', m: ALL, w: 'The limestone staple.' },
      { f: 'Scud', s: '#14-16', m: ALL, w: 'In the weed beds.' },
      { f: 'Sulphur nymph', s: '#16-18', m: [5, 6], w: 'Through the sulphur weeks.' },
      { f: 'Pheasant tail', s: '#18-20', m: ALL, w: 'Small and unweighted on these spooky fish.' }
    ],
    'Great Smoky headwaters': [
      { f: 'Pheasant tail', s: '#14-18', m: ALL, w: 'The default in pocket water.' },
      { f: 'Hares ear', s: '#14-16', m: ALL, w: 'Dropped under a dry.' },
      { f: 'Green weenie', s: '#14', m: WARM, w: 'A regional oddity that genuinely works.' },
      { f: 'Prince nymph', s: '#14-16', m: ALL, w: 'In the plunge pools.' }
    ]
  };

  /* Fallbacks when the water is not one of the named ones. */
  var GENERIC = {
    tailwater: [
      { f: 'Zebra midge', s: '#18-20', m: ALL, w: 'Tailwaters run cold and midges never stop.' },
      { f: 'Scud or sowbug', s: '#14-16', m: ALL, w: 'The resident food in most constant-temperature water.' },
      { f: 'Pheasant tail', s: '#16-18', m: ALL, w: 'Generic mayfly nymph.' }
    ],
    spring: [
      { f: 'Scud', s: '#14-16', m: ALL, w: 'Spring creeks grow them year round.' },
      { f: 'Cress bug', s: '#14-18', m: ALL, w: 'In the weed.' },
      { f: 'Pheasant tail', s: '#18-20', m: ALL, w: 'Small, on fine tippet.' }
    ],
    freestone: [
      { f: 'Rubber legs or stonefly nymph', s: '#8-12', m: ALL, w: 'Freestone fish see stoneflies all year.' },
      { f: 'Pheasant tail', s: '#14-18', m: ALL, w: 'The searching nymph.' },
      { f: 'Hares ear', s: '#14-16', m: ALL, w: 'When nothing is obvious.' }
    ]
  };

  function forWater(waterName, waterClass, date) {
    var month = (date || new Date()).getMonth() + 1;
    var list = (waterName && WATERS[waterName]) || GENERIC[waterClass] || GENERIC.freestone;
    var inSeason = list.filter(function (p) { return p.m.indexOf(month) >= 0; });
    return {
      named: !!(waterName && WATERS[waterName]),
      water: waterName || null,
      patterns: (inSeason.length ? inSeason : list).slice(0, 5)
    };
  }

  global.OG = global.OG || {};
  global.OG.patterns = { forWater: forWater, WATERS: WATERS };
})(window);
