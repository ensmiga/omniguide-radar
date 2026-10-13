/* OmniGuide - named trout waters.

   WHAT THIS IS NOW.

   This list used to be the trout map. Twenty rivers, each an oval with
   a number on it, and anything outside an oval scored nothing: of 57
   well-known trout waters the app found 27, and the Yakima, the
   Truckee, the South Holston, Penns Creek and the Battenkill were
   blank ground.

   The map is built from measurements now - see the trout section of
   ingest/habitat.mjs: trout records, the self-sustaining populations in
   the USGS Nonindigenous Aquatic Species database, and summer water
   temperature at the gauges that record it. This list is what is left
   for a list to do:

   NAMES. The plan panel says which river you are standing on, the
   pattern table in patterns.js is keyed by these names, and the fly
   shop registry matches on them.

   KIND OF WATER. A tailwater or a spring creek does not follow the air
   temperature, and both the water temperature estimate and the default
   fly list need to know which it is.

   A FLOOR. Each of these is trout water beyond argument, so the build
   counts it as occupied and, for the tailwaters and spring creeks, as
   cold, whether or not anything was measured there. The Guadalupe
   below Canyon Dam is in Texas; no climate model will find it.

   rx and ry are the half-width and half-height of the reach in degrees.
   v is only how strongly the name claims the ground near its edge, for
   deciding between two that overlap. cls is tailwater, spring or
   freestone. */
window.US_TROUT_WATERS = [
  /* Northern Rockies */
  { n: 'Bighorn River', lon: -107.95, lat: 45.32, rx: 0.30, ry: 0.42, v: 0.92, cls: 'tailwater' },
  { n: 'Madison River', lon: -111.55, lat: 45.05, rx: 0.22, ry: 0.55, v: 0.86, cls: 'freestone' },
  { n: 'Missouri River - Craig', lon: -111.95, lat: 47.05, rx: 0.22, ry: 0.35, v: 0.88, cls: 'tailwater' },
  { n: 'Yellowstone River', lon: -110.4, lat: 45.4, rx: 0.8, ry: 0.4, v: 0.78, cls: 'freestone' },
  { n: 'Big Hole and Beaverhead', lon: -112.8, lat: 45.45, rx: 0.55, ry: 0.45, v: 0.76, cls: 'freestone' },
  { n: 'Bitterroot and Blackfoot', lon: -114.0, lat: 46.6, rx: 0.5, ry: 0.6, v: 0.76, cls: 'freestone' },
  { n: 'Henrys Fork', lon: -111.4, lat: 44.2, rx: 0.3, ry: 0.35, v: 0.84, cls: 'freestone' },
  { n: 'Snake River - South Fork', lon: -111.4, lat: 43.4, rx: 0.4, ry: 0.3, v: 0.82, cls: 'tailwater' },
  { n: 'Silver Creek', lon: -114.1, lat: 43.32, rx: 0.2, ry: 0.12, v: 0.80, cls: 'spring' },
  { n: 'North Platte - Grey Reef', lon: -106.7, lat: 42.45, rx: 0.3, ry: 0.4, v: 0.80, cls: 'tailwater' },
  { n: 'Black Hills streams', lon: -103.8, lat: 44.3, rx: 0.3, ry: 0.35, v: 0.66, cls: 'freestone' },

  /* Colorado, Utah and the Southwest */
  { n: 'Green River - Flaming Gorge', lon: -109.45, lat: 40.95, rx: 0.25, ry: 0.3, v: 0.88, cls: 'tailwater' },
  { n: 'Provo River', lon: -111.5, lat: 40.45, rx: 0.25, ry: 0.2, v: 0.78, cls: 'tailwater' },
  { n: 'South Platte - Deckers', lon: -105.3, lat: 39.3, rx: 0.3, ry: 0.35, v: 0.80, cls: 'tailwater' },
  { n: 'Frying Pan and Roaring Fork', lon: -106.9, lat: 39.4, rx: 0.4, ry: 0.25, v: 0.82, cls: 'tailwater' },
  { n: 'Gunnison and Taylor', lon: -107.0, lat: 38.6, rx: 0.4, ry: 0.35, v: 0.78, cls: 'tailwater' },
  { n: 'Arkansas River', lon: -105.95, lat: 38.6, rx: 0.5, ry: 0.3, v: 0.76, cls: 'freestone' },
  { n: 'San Juan River', lon: -107.65, lat: 36.85, rx: 0.3, ry: 0.2, v: 0.85, cls: 'tailwater' },
  { n: 'Lees Ferry', lon: -111.6, lat: 36.87, rx: 0.15, ry: 0.12, v: 0.80, cls: 'tailwater' },

  /* Pacific states */
  { n: 'Deschutes River', lon: -121.0, lat: 44.9, rx: 0.3, ry: 0.6, v: 0.80, cls: 'freestone' },
  { n: 'Metolius River', lon: -121.63, lat: 44.55, rx: 0.15, ry: 0.2, v: 0.74, cls: 'spring' },
  { n: 'Yakima River', lon: -120.6, lat: 46.9, rx: 0.35, ry: 0.3, v: 0.76, cls: 'freestone' },
  { n: 'Upper Sacramento and McCloud', lon: -122.3, lat: 41.1, rx: 0.3, ry: 0.35, v: 0.74, cls: 'freestone' },
  { n: 'Hat Creek and Fall River', lon: -121.45, lat: 41.0, rx: 0.25, ry: 0.2, v: 0.74, cls: 'spring' },
  { n: 'Truckee River', lon: -120.1, lat: 39.4, rx: 0.3, ry: 0.2, v: 0.74, cls: 'freestone' },
  { n: 'Owens River', lon: -118.6, lat: 37.55, rx: 0.3, ry: 0.35, v: 0.74, cls: 'spring' },
  { n: 'Lower Sacramento River', lon: -122.33, lat: 40.45, rx: 0.15, ry: 0.25, v: 0.80, cls: 'tailwater' },
  { n: 'Putah Creek', lon: -122.07, lat: 38.51, rx: 0.1, ry: 0.06, v: 0.70, cls: 'tailwater' },
  { n: 'Lower Yuba River', lon: -121.38, lat: 39.21, rx: 0.15, ry: 0.08, v: 0.70, cls: 'tailwater' },
  { n: 'Kings River below Pine Flat', lon: -119.35, lat: 36.82, rx: 0.12, ry: 0.08, v: 0.66, cls: 'tailwater' },
  { n: 'Owyhee River', lon: -117.2, lat: 43.7, rx: 0.15, ry: 0.1, v: 0.74, cls: 'tailwater' },
  { n: 'Crooked River', lon: -120.83, lat: 44.17, rx: 0.1, ry: 0.1, v: 0.70, cls: 'tailwater' },
  { n: 'Rocky Ford Creek', lon: -119.45, lat: 47.31, rx: 0.08, ry: 0.08, v: 0.70, cls: 'spring' },
  { n: 'Oak Creek', lon: -111.75, lat: 34.95, rx: 0.08, ry: 0.12, v: 0.66, cls: 'spring' },

  /* Midwest */
  { n: 'Au Sable River', lon: -84.6, lat: 44.7, rx: 0.4, ry: 0.25, v: 0.72, cls: 'freestone' },
  { n: 'Pere Marquette River', lon: -86.0, lat: 43.9, rx: 0.35, ry: 0.15, v: 0.70, cls: 'freestone' },
  { n: 'Brule River', lon: -91.6, lat: 46.6, rx: 0.15, ry: 0.25, v: 0.68, cls: 'freestone' },
  { n: 'Driftless spring creeks', lon: -91.0, lat: 43.6, rx: 0.9, ry: 0.7, v: 0.74, cls: 'spring' },

  /* Ozark and southern tailwaters */
  { n: 'White River', lon: -92.3, lat: 36.3, rx: 0.5, ry: 0.3, v: 0.80, cls: 'tailwater' },
  { n: 'Little Red River', lon: -91.9, lat: 35.5, rx: 0.25, ry: 0.15, v: 0.74, cls: 'tailwater' },
  { n: 'Lake Taneycomo', lon: -93.25, lat: 36.65, rx: 0.15, ry: 0.1, v: 0.76, cls: 'tailwater' },
  { n: 'Lower Mountain Fork', lon: -94.7, lat: 34.1, rx: 0.15, ry: 0.12, v: 0.70, cls: 'tailwater' },
  { n: 'Guadalupe River', lon: -98.15, lat: 29.85, rx: 0.2, ry: 0.1, v: 0.68, cls: 'tailwater' },
  { n: 'Chattahoochee River', lon: -84.2, lat: 34.05, rx: 0.25, ry: 0.15, v: 0.68, cls: 'tailwater' },
  { n: 'Cumberland River', lon: -85.15, lat: 36.9, rx: 0.3, ry: 0.15, v: 0.72, cls: 'tailwater' },
  { n: 'Clinch River', lon: -84.05, lat: 36.2, rx: 0.2, ry: 0.15, v: 0.72, cls: 'tailwater' },
  { n: 'South Holston and Watauga', lon: -82.1, lat: 36.45, rx: 0.3, ry: 0.2, v: 0.80, cls: 'tailwater' },
  { n: 'Beaver tailwater', lon: -93.85, lat: 36.42, rx: 0.1, ry: 0.06, v: 0.68, cls: 'tailwater' },
  { n: 'Spring River', lon: -91.52, lat: 36.42, rx: 0.08, ry: 0.12, v: 0.68, cls: 'spring' },
  { n: 'North Fork of the White', lon: -92.24, lat: 36.7, rx: 0.1, ry: 0.15, v: 0.70, cls: 'spring' },
  { n: 'Eleven Point River', lon: -91.27, lat: 36.72, rx: 0.12, ry: 0.1, v: 0.68, cls: 'spring' },
  { n: 'Bennett Spring', lon: -92.86, lat: 37.72, rx: 0.08, ry: 0.08, v: 0.66, cls: 'spring' },
  { n: 'Montauk and upper Current', lon: -91.62, lat: 37.42, rx: 0.12, ry: 0.08, v: 0.68, cls: 'spring' },
  { n: 'Roaring River', lon: -93.83, lat: 36.59, rx: 0.08, ry: 0.06, v: 0.66, cls: 'spring' },
  { n: 'Maramec Spring', lon: -91.53, lat: 37.95, rx: 0.08, ry: 0.06, v: 0.66, cls: 'spring' },
  { n: 'Lower Illinois River', lon: -95.07, lat: 35.57, rx: 0.08, ry: 0.06, v: 0.66, cls: 'tailwater' },
  { n: 'Caney Fork', lon: -85.88, lat: 36.15, rx: 0.1, ry: 0.1, v: 0.70, cls: 'tailwater' },
  { n: 'Hiwassee River', lon: -84.5, lat: 35.2, rx: 0.12, ry: 0.06, v: 0.70, cls: 'tailwater' },
  { n: 'Elk River below Tims Ford', lon: -86.28, lat: 35.2, rx: 0.12, ry: 0.06, v: 0.66, cls: 'tailwater' },
  { n: 'Toccoa River', lon: -84.32, lat: 34.93, rx: 0.08, ry: 0.08, v: 0.68, cls: 'tailwater' },
  { n: 'Sipsey Fork', lon: -87.1, lat: 33.94, rx: 0.08, ry: 0.06, v: 0.64, cls: 'tailwater' },
  { n: 'Smith River', lon: -79.97, lat: 36.75, rx: 0.12, ry: 0.06, v: 0.68, cls: 'tailwater' },
  { n: 'Jackson River', lon: -79.97, lat: 37.88, rx: 0.08, ry: 0.1, v: 0.68, cls: 'tailwater' },

  /* Appalachians and the Northeast */
  { n: 'Great Smoky headwaters', lon: -83.5, lat: 35.6, rx: 0.5, ry: 0.35, v: 0.66, cls: 'freestone' },
  { n: 'Davidson River', lon: -82.7, lat: 35.28, rx: 0.2, ry: 0.12, v: 0.70, cls: 'freestone' },
  { n: 'Mossy Creek', lon: -78.98, lat: 38.35, rx: 0.12, ry: 0.1, v: 0.68, cls: 'spring' },
  { n: 'Savage River', lon: -79.1, lat: 39.5, rx: 0.15, ry: 0.1, v: 0.68, cls: 'tailwater' },
  { n: 'Gunpowder Falls', lon: -76.7, lat: 39.6, rx: 0.15, ry: 0.1, v: 0.68, cls: 'tailwater' },
  { n: 'Letort and Cumberland limestone', lon: -77.2, lat: 40.2, rx: 0.4, ry: 0.25, v: 0.70, cls: 'spring' },
  { n: 'Falling Spring Branch', lon: -77.62, lat: 39.92, rx: 0.06, ry: 0.05, v: 0.64, cls: 'spring' },
  { n: 'Penns Creek and Spring Creek', lon: -77.6, lat: 40.87, rx: 0.35, ry: 0.12, v: 0.74, cls: 'spring' },
  { n: 'Delaware River west branch', lon: -75.2, lat: 42.0, rx: 0.35, ry: 0.3, v: 0.78, cls: 'tailwater' },
  { n: 'Beaverkill and Willowemoc', lon: -74.85, lat: 41.95, rx: 0.25, ry: 0.12, v: 0.76, cls: 'freestone' },
  { n: 'Farmington River', lon: -72.95, lat: 41.9, rx: 0.2, ry: 0.15, v: 0.74, cls: 'tailwater' },
  { n: 'Battenkill', lon: -73.2, lat: 43.1, rx: 0.2, ry: 0.15, v: 0.70, cls: 'freestone' },
  { n: 'West Branch Ausable', lon: -73.85, lat: 44.4, rx: 0.2, ry: 0.15, v: 0.70, cls: 'freestone' }
];
