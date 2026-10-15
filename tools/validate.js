/* Does the model think animals live where they actually live?

   Paste into the console on a loaded page. Prints a per-species score
   and names every miss.

   WHY THIS EXISTS.

   The range gate has knobs - the habitat floor in models.js, and in
   habgrid.js the knee and the regional share at which a species counts
   as in range - and they were being set by one global number and then
   adjusted whenever a single bad cell turned up.
   That is how you end up back at hand-drawn blobs: each fix is local,
   nothing checks the whole picture, and a change that rescues
   Mississippi quietly invents whitetail in Nevada.

   So: a fixed list of places where the answer is not in dispute, and a
   number for how many it gets right. Tune against this, not against the
   last thing someone noticed. Re-run it after every raster build.

   The negatives matter more than the positives. Anyone can light up the
   whole country; the question is whether it knows where to stop. A
   species scored everywhere is useless even though it never misses.

   Sources for the truth table are state agency range maps and hunting
   regulations - where a state sells a tag and publishes a season, the
   animal is there; where no season exists anywhere in the state, it is
   not. Reintroduced herds (Pennsylvania and Kentucky elk, Smokies elk)
   are included deliberately, because they are small, real, and exactly
   the kind of thing an occurrence-driven model should catch and a
   hand-drawn one never would. */
(function () {
  'use strict';

  var T = {
    elk: {
      /* Rewritten when elk range moved from occurrence records to the
         USGS map. The old list was 25 places and 6, and the record gate
         scored 22 and 6 on it - which looked fine and was hiding that it
         had no elk anywhere in North Dakota and 3,500 square miles of
         them round a single photograph in five places. An easy list
         flatters whatever it is pointed at. This one is every herd I
         could name with a state agency behind it, and for the negatives
         the cities and farm country inside or beside elk range, plus the
         fenced herds: elk live at White Horse Hill, Land Between the
         Lakes and Lone Elk Park, behind a fence, and that is not range.

         The record gate scored 73 of 87 and 41 of 55 on it. The two
         positives still missed are real gaps in the USGS map: the
         Niobrara, which elk have spread into since 2014, and Tejon. */
      yes: [
        ['ND Badlands (T. Roosevelt NP)', -103.45, 46.95],
        ['ND Killdeer Mts', -102.90, 47.45], ['ND Pembina Hills', -98.00, 48.90],
        ['ND Turtle Mts', -100.00, 48.90], ['MN Kittson Co', -96.60, 48.80],
        ['MN Grygla', -95.60, 48.30], ['NE Pine Ridge', -103.00, 42.70],
        ['NE Wildcat Hills', -103.70, 41.70], ['NE Niobrara (Valentine)', -100.50, 42.80],
        ['SD Black Hills', -103.70, 44.00], ['KS Cimarron Grassland', -101.90, 37.10],
        ['KS Fort Riley', -96.80, 39.20], ['WY Red Desert', -108.80, 42.00],
        ['WY Jackson', -110.60, 43.60], ['WY Bighorns', -107.30, 44.50],
        ['WY Laramie Peak', -105.40, 42.30], ['WY Sierra Madre', -107.00, 41.20],
        ['MT Missouri Breaks', -108.00, 47.60], ['MT Bull Mts', -108.30, 46.40],
        ['MT Bitterroot', -114.00, 46.00], ['MT Gallatin', -111.20, 45.30],
        ['MT Rocky Mtn Front', -112.60, 47.80], ['MT Yaak', -115.70, 48.80],
        ['AZ Flagstaff', -111.60, 35.20], ['AZ White Mts', -109.50, 33.90],
        ['AZ Hualapai Mts', -113.90, 35.10], ['NM Gila', -108.30, 33.30],
        ['NM Valles Caldera', -106.50, 35.90], ['NM Sacramento Mts', -105.70, 32.90],
        ['NM Raton', -104.40, 36.90], ['NM Mt Taylor', -107.60, 35.20],
        ['TX Davis Mts', -104.00, 30.70], ['TX Glass Mts', -103.20, 30.40],
        ['TX Guadalupe Mts', -104.86, 31.90], ['UT Book Cliffs', -109.70, 39.50],
        ['UT Boulder Mtn', -111.50, 38.10], ['UT Wasatch', -111.20, 40.30],
        ['UT Pahvant', -112.20, 38.80], ['NV Jarbidge', -115.40, 41.80],
        ['NV Schell Creek', -114.60, 39.30], ['NV Monitor Range', -116.50, 38.80],
        ['NV Spring Mts', -115.70, 36.30], ['NV Lincoln Co', -114.40, 38.00],
        ['CA Redwood NP', -124.00, 41.30], ['CA Cache Creek', -122.40, 39.00],
        ['CA Owens Valley', -118.30, 37.00], ['CA La Panza', -120.20, 35.40],
        ['CA Tejon', -118.70, 34.90], ['CA Mendocino', -123.30, 39.50],
        ['CA Siskiyou', -122.50, 41.50], ['CA Modoc', -120.40, 41.50],
        ['OR Coast Range', -123.60, 45.20], ['OR Cascades', -122.00, 44.20],
        ['OR Blue Mts', -118.30, 45.30], ['OR Ochocos', -120.30, 44.40],
        ['OR Southwest', -123.20, 42.50], ['WA Olympics', -123.80, 47.80],
        ['WA St Helens', -122.30, 46.30], ['WA Yakima', -120.90, 46.80],
        ['WA Blue Mts', -117.80, 46.20], ['WA Selkirks', -117.30, 48.70],
        ['WA Nooksack', -122.00, 48.60], ['ID Clearwater', -115.50, 46.50],
        ['ID Salmon', -114.00, 45.00], ['ID Panhandle', -116.30, 47.80],
        ['ID Southeast', -111.50, 42.70], ['CO White River', -107.50, 40.00],
        ['CO San Juans', -107.30, 37.60], ['CO Estes Park', -105.50, 40.40],
        ['CO Gunnison', -106.90, 38.50], ['CO Sangre de Cristo', -105.50, 37.90],
        ['CO Trinidad', -104.90, 37.20], ['CO Northwest sage', -108.20, 40.60],
        ['PA Benezette', -78.37, 41.31], ['KY Hazard', -83.20, 37.25],
        ['TN N Cumberland', -84.30, 36.30], ['VA Buchanan Co', -82.10, 37.25],
        ['NC Cataloochee', -83.10, 35.63], ['WV Logan Co', -82.00, 37.80],
        ['WI Clam Lake', -90.90, 46.20], ['WI Black River', -90.70, 44.30],
        ['MI Pigeon River', -84.40, 45.20], ['MO Peck Ranch', -91.20, 37.00],
        ['AR Boxley', -93.40, 36.00], ['OK Wichita Mts', -98.70, 34.75],
        ['OK Cookson Hills', -94.90, 35.70], ['OK Pushmataha', -95.30, 34.50]
      ],
      no: [
        ['Seattle', -122.33, 47.61], ['Portland', -122.67, 45.52],
        ['WA Columbia Basin', -119.30, 47.10], ['ID Snake River Plain', -114.50, 42.60],
        ['Boise', -116.20, 43.60], ['San Francisco', -122.44, 37.76],
        ['Sacramento', -121.50, 38.58], ['Fresno', -119.80, 36.75],
        ['Los Angeles', -118.25, 34.05], ['San Diego', -117.15, 32.72],
        ['Mojave (Barstow)', -117.00, 34.90], ['Las Vegas', -115.15, 36.17],
        ['Phoenix', -112.07, 33.45], ['Tucson', -110.97, 32.22], ['Yuma', -114.60, 32.70],
        ['UT West Desert', -113.50, 40.70], ['Denver', -104.99, 39.74],
        ['CO Eastern Plains', -102.60, 39.30], ['W Kansas', -100.50, 38.50],
        ['Iowa', -93.60, 42.00], ['Illinois', -89.00, 40.00], ['Ohio', -82.90, 40.00],
        ['New York', -75.50, 43.00], ['Maine', -69.00, 45.20], ['Georgia', -83.50, 32.50],
        ['N Georgia Mts', -84.00, 34.80], ['Florida', -81.50, 28.50],
        ['Alabama', -86.80, 32.80], ['Louisiana', -92.00, 31.00],
        ['Dallas', -96.80, 32.80], ['Houston', -95.37, 29.76], ['Austin', -97.74, 30.27],
        ['San Antonio', -98.49, 29.42], ['San Marcos TX', -97.94, 29.88],
        ['TX Hill Country (Kerrville)', -99.14, 30.05], ['E South Dakota', -98.00, 44.40],
        ['Fargo', -96.80, 46.88], ['Devils Lake ND', -98.87, 48.11],
        ['Minneapolis', -93.27, 44.98], ['Madison', -89.40, 43.07],
        ['Lansing', -84.55, 42.73], ['Greenville SC', -82.40, 34.85],
        ['Knoxville', -83.92, 35.96], ['Asheville', -82.55, 35.60],
        ['Charleston WV', -81.63, 38.35], ['Pittsburgh', -80.00, 40.44],
        ['Harrisburg', -76.88, 40.27], ['Cape Girardeau MO', -89.52, 37.31],
        ['Amarillo', -101.83, 35.20], ['Manhattan KS town', -96.57, 39.18],
        ['Topeka', -95.68, 39.05], ['Grand Island NE', -98.34, 40.92],
        ['White Horse Hill preserve ND (fenced)', -98.97, 47.98],
        ['Land Between the Lakes KY (fenced)', -88.07, 36.78],
        ['Lone Elk Park MO (fenced)', -90.54, 38.53]
      ]
    },
    muledeer: {
      /* Lengthened when every species was put through the test elk failed.
         The record gate got all of it, so mule deer stay on records. */
      yes: [
        ['W Colorado', -108.00, 39.20], ['Red Desert WY', -108.20, 41.80],
        ['Book Cliffs UT', -109.60, 39.40], ['Kaibab AZ', -112.20, 36.40],
        ['E Oregon', -118.60, 43.60], ['SW Idaho', -116.20, 43.00],
        ['WY Wyoming Range', -110.60, 42.60], ['AZ Kaibab', -112.20, 36.50],
        ['AZ Strip', -113.20, 36.60], ['AZ desert (Gila Bend)', -112.80, 33.00],
        ['NM Jicarilla', -107.20, 36.60], ['NM Gila', -108.30, 33.30],
        ['TX Trans-Pecos', -103.50, 30.60], ['TX Canadian breaks', -101.00, 35.90],
        ['OK Panhandle', -102.50, 36.80], ['W Kansas', -101.30, 38.80],
        ['NE Sandhills west', -101.80, 42.00], ['NE Pine Ridge', -103.00, 42.70],
        ['W South Dakota', -102.50, 44.50], ['ND Badlands', -103.40, 47.00],
        ['E Montana', -106.00, 46.80], ['MT Missouri Breaks', -108.00, 47.60],
        ['ID Salmon', -114.00, 45.00], ['ID Owyhee', -116.60, 42.60],
        ['ID Southeast', -111.50, 42.70], ['UT Book Cliffs', -109.70, 39.50],
        ['UT Paunsaugunt', -112.20, 37.50], ['NV Rubies', -115.40, 40.60],
        ['NV central', -116.90, 39.20], ['CA Sierra east side', -118.60, 37.60],
        ['CA Modoc', -120.50, 41.30], ['CA Mendocino blacktail', -123.30, 39.50],
        ['CA San Diego backcountry', -116.60, 32.90], ['OR W blacktail', -123.40, 44.50],
        ['WA W blacktail', -122.50, 46.80], ['WA Okanogan', -119.60, 48.40],
        ['OR Steens', -118.70, 42.70], ['MT Bitterroot', -114.00, 46.00],
        ['CO Gunnison', -106.90, 38.50]
      ],
      no: [
        ['Ohio', -82.90, 40.20], ['Georgia', -83.50, 32.80],
        ['Pennsylvania', -77.80, 40.90], ['Mississippi', -89.80, 32.40],
        ['Illinois', -89.20, 40.10], ['Iowa', -93.60, 42.00], ['Illinois', -89.00, 40.00],
        ['Missouri', -92.50, 38.50], ['E Texas', -95.00, 31.50],
        ['Louisiana', -92.00, 31.00], ['Arkansas', -92.50, 34.80],
        ['Minnesota central', -93.50, 46.00], ['Wisconsin', -89.80, 44.50],
        ['Michigan', -84.60, 44.00], ['Ohio', -82.90, 40.00],
        ['Pennsylvania', -77.50, 41.00], ['New York', -75.50, 43.00],
        ['Georgia', -83.50, 32.50], ['Florida', -81.50, 28.50],
        ['E Oklahoma', -95.50, 35.50], ['E Kansas', -95.50, 38.50],
        ['E Nebraska', -96.50, 41.00], ['E North Dakota', -97.20, 47.50],
        ['Houston', -95.37, 29.76], ['Dallas', -96.80, 32.80],
        ['Tennessee', -86.50, 35.80], ['Maine', -69.00, 45.20]
      ]
    },
    whitetail: {
      /* Lengthened when every species was put through the test elk failed.
         The western Dakotas and the Montana river valleys are here because
         the first list had none of them and the record gate was missing a
         third of each state. Whitetail range is records and the USGS map
         together - see RANGE_WITH_RECORDS in js/habgrid.js. */
      yes: [
        ['Iowa', -93.60, 41.90], ['Buffalo Co WI', -91.75, 44.37],
        ['Texas Hill Country', -99.10, 30.30], ['S Georgia', -83.40, 31.40],
        ['Pennsylvania', -77.80, 40.90], ['Milk River MT', -107.90, 48.40],
        ['E Colorado bottoms', -102.60, 40.60], ['N Idaho', -116.50, 47.80],
        ['ID Panhandle', -116.50, 47.50], ['MT Northwest', -114.50, 48.30],
        ['WA Northeast', -117.60, 48.50], ['MT Milk River', -107.50, 48.40],
        ['MT Yellowstone River', -105.00, 46.70], ['WY Black Hills', -104.30, 44.50],
        ['WY North Platte', -104.20, 42.00], ['CO South Platte', -103.20, 40.60],
        ['CO Arkansas River', -102.60, 38.10], ['AZ Coues sky islands', -110.70, 31.80],
        ['AZ Chiricahuas', -109.30, 31.90], ['TX South', -98.50, 27.50],
        ['IL Pike County', -90.90, 39.60], ['SE Kansas', -95.20, 37.50],
        ['Iowa', -93.00, 41.00], ['MI Northern Lower', -84.50, 44.80],
        ['Pennsylvania', -77.80, 41.20], ['NY Southern Tier', -77.00, 42.20],
        ['Maine', -69.50, 44.80], ['Georgia', -83.50, 32.50],
        ['AL Black Belt', -87.30, 32.40], ['Mississippi', -90.00, 32.80],
        ['FL Panhandle', -85.50, 30.60], ['FL Big Cypress', -81.20, 26.00],
        ['SE Ohio', -81.80, 39.60], ['W Kentucky', -87.50, 37.30],
        ['Louisiana', -92.20, 31.50], ['Oklahoma', -96.50, 35.50],
        ['NE Missouri River', -96.50, 42.00], ['SD James River', -98.00, 44.40],
        ['North Dakota', -98.50, 47.00], ['OR Roseburg (Columbian)', -123.30, 43.30],
        ['OR Northeast', -117.50, 45.50], ['Missouri Ozarks', -91.50, 37.30],
        ['Virginia', -78.50, 37.50], ['Minnesota', -94.50, 46.50],
        ['SD Cheyenne River', -102.00, 44.50], ['ND Little Missouri', -103.40, 47.00],
        ['MT Musselshell', -108.00, 46.50], ['WY Bighorn Basin (Basin)', -108.05, 44.38],
        ['NE Sandhills (Loup)', -100.50, 42.00], ['KS Smoky Hill', -100.50, 38.80],
        ['TX Panhandle', -101.50, 35.20], ['CO Republican River', -102.30, 40.05],
        ['ND Missouri River', -100.80, 46.80]
      ],
      no: [
        ['Nevada Great Basin', -116.50, 39.50], ['Utah west desert', -113.00, 39.50],
        ['Mojave CA', -116.20, 34.80], ['Central AZ desert', -112.60, 33.20],
        ['UT central', -112.50, 39.00], ['CA Central Valley', -120.50, 37.00],
        ['CA Sierra', -119.50, 37.80], ['Los Angeles', -118.25, 34.05],
        ['AZ Sonoran floor (Gila Bend)', -112.70, 32.95], ['Mojave', -116.00, 35.00],
        ['WA Olympics', -123.80, 47.80], ['OR coast', -123.90, 45.00],
        ['OR Great Basin', -119.50, 43.00], ['WY Red Desert', -108.80, 41.80],
        ['AZ Kaibab', -112.20, 36.50], ['NM San Juan Basin', -108.20, 36.40],
        ['Las Vegas', -115.15, 36.17], ['UT West Desert', -113.50, 40.70],
        ['San Francisco', -122.44, 37.76], ['WY Great Divide Basin', -108.00, 42.10],
        ['NM White Sands', -106.30, 32.80], ['AZ Painted Desert', -110.50, 35.50],
        ['CO San Luis Valley floor', -105.90, 37.70]
      ]
    },
    moose: {
      /* Lengthened when every species was put through the test elk failed.
         The record gate scored 26 of 32 and 29 of 32 on this; moose range is
         the USGS map now. Harrisburg and Wheaton are here because a
         wandering moose is the thing a record gate cannot tell from a herd. */
      yes: [
        ['N Maine', -69.30, 46.30], ['Adirondacks NY', -74.30, 44.10],
        ['N Minnesota', -91.60, 47.90], ['NW Montana', -114.20, 48.40],
        ['Jackson WY', -110.70, 43.55], ['Uintas UT', -110.40, 40.70],
        ['North Park CO', -106.30, 40.70], ['ME Moosehead', -69.60, 45.60],
        ['ME Allagash', -69.20, 46.60], ['ME Rangeley', -70.70, 45.00],
        ['NH Pittsburg', -71.30, 45.10], ['VT Northeast Kingdom', -71.80, 44.80],
        ['NY Adirondacks', -74.40, 44.30], ['MA Quabbin', -72.30, 42.45],
        ['MI Upper Peninsula west', -88.00, 46.60], ['MN Arrowhead', -91.00, 47.80],
        ['MN Agassiz', -95.90, 48.30], ['ND Turtle Mts', -100.00, 48.90],
        ['ND Pembina Hills', -98.00, 48.90], ['ND Kenmare prairie', -102.10, 48.70],
        ['MT Yaak', -115.70, 48.80], ['MT Big Hole', -113.40, 45.60],
        ['MT Rocky Mtn Front', -112.60, 47.80], ['MT Centennial Valley', -111.80, 44.65],
        ['ID Panhandle', -116.50, 48.30], ['ID Island Park', -111.30, 44.50],
        ['ID Southeast', -111.30, 42.60], ['WY Jackson', -110.60, 43.70],
        ['WY Bighorns', -107.20, 44.60], ['WY Snowy Range', -106.30, 41.30],
        ['WY Pinedale', -110.00, 42.90], ['UT Uintas north slope', -110.50, 40.90],
        ['UT Wasatch', -111.50, 40.70], ['UT Cache', -111.60, 41.80],
        ['CO Grand Mesa', -108.00, 39.05], ['CO Creede', -106.90, 37.85],
        ['WA Selkirks', -117.50, 48.60], ['WA Mt Spokane', -117.10, 47.90]
      ],
      no: [
        ['Kansas', -98.50, 38.50], ['Texas', -97.50, 31.50], ['Georgia', -83.50, 32.80],
        ['Nebraska', -99.00, 41.00], ['Ohio', -82.90, 40.20],
        ['Pennsylvania', -77.50, 41.00], ['Ohio', -82.90, 40.00],
        ['Illinois', -89.00, 40.00], ['Iowa', -93.60, 42.00], ['Missouri', -92.50, 38.50],
        ['Harrisburg NE', -103.74, 41.55], ['Nebraska Sandhills', -100.50, 42.00],
        ['Texas', -99.00, 31.00], ['Oklahoma', -97.50, 35.50],
        ['Flagstaff AZ', -111.60, 35.20], ['California Sierra', -120.50, 39.50],
        ['W Oregon', -123.00, 44.00], ['WA Olympics', -123.80, 47.80],
        ['ID Snake River Plain', -114.50, 42.60], ['Las Vegas', -115.15, 36.17],
        ['Georgia', -83.50, 32.50], ['Florida', -81.50, 28.50],
        ['Tennessee', -86.50, 35.80], ['Kentucky', -84.50, 37.80],
        ['Virginia', -78.50, 37.50], ['West Virginia', -80.50, 38.60],
        ['Madison WI', -89.40, 43.07], ['Lansing MI', -84.55, 42.73],
        ['Wheaton MN', -96.50, 45.80], ['S Minnesota', -94.00, 44.20],
        ['Pierre SD', -100.30, 44.40], ['Denver', -104.99, 39.74],
        ['UT West Desert', -113.50, 40.70], ['New Jersey', -74.60, 40.20],
        ['Maryland', -76.80, 39.20], ['Long Island', -73.00, 40.80]
      ]
    },
    pronghorn: {
      /* Lengthened when every species was put through the test elk failed.
         The record gate got 28 of 28 and 22 of 23; pronghorn stay on records. */
      yes: [
        ['Red Desert WY', -108.20, 41.80], ['E Montana', -105.80, 46.40],
        ['NE New Mexico', -104.20, 36.10], ['W Nebraska', -103.40, 41.60],
        ['SE Oregon', -118.80, 42.60], ['W Texas', -102.90, 31.40],
        ['WY Red Desert', -108.50, 41.80], ['WY Thunder Basin', -105.20, 43.60],
        ['WY Shirley Basin', -106.30, 42.20], ['E Montana', -106.50, 46.50],
        ['MT Malta', -107.90, 48.20], ['CO Northeast', -104.00, 40.80],
        ['CO Southeast', -103.50, 37.70], ['CO Northwest', -108.20, 40.60],
        ['NM plains', -104.50, 34.50], ['NM Northeast', -104.50, 36.50],
        ['TX Marfa', -104.00, 30.30], ['TX Panhandle', -102.30, 35.90],
        ['W Kansas', -101.60, 38.80], ['W Nebraska', -103.30, 41.90],
        ['W South Dakota', -102.80, 44.80], ['SW North Dakota', -103.30, 46.30],
        ['OR Hart Mountain', -119.60, 42.50], ['NV Sheldon', -119.20, 41.80],
        ['CA Modoc', -120.30, 41.60], ['ID Craters', -113.50, 43.20],
        ['ID Lemhi', -113.60, 44.60], ['UT Parker Mountain', -111.80, 38.30],
        ['UT West Desert', -113.60, 39.50], ['UT Uinta Basin', -109.60, 40.20],
        ['AZ Chino Valley', -112.50, 34.80], ['AZ Anderson Mesa', -111.40, 35.00],
        ['AZ Sonoita', -110.60, 31.70], ['OK Panhandle', -102.30, 36.80]
      ],
      no: [
        ['Ohio', -82.90, 40.20], ['Alabama', -86.80, 32.60], ['Missouri', -92.50, 38.50],
        ['Maine', -69.30, 45.30], ['Florida', -81.50, 28.50], ['Seattle', -122.33, 47.61],
        ['WA Olympics', -123.80, 47.80], ['W Oregon', -123.00, 44.00],
        ['San Francisco', -122.44, 37.76], ['Los Angeles', -118.25, 34.05],
        ['Iowa', -93.60, 42.00], ['Minnesota', -94.50, 46.50], ['Illinois', -89.00, 40.00],
        ['E Texas', -95.00, 31.50], ['Houston', -95.37, 29.76],
        ['E Kansas', -95.50, 38.50], ['E Nebraska', -96.50, 41.00],
        ['E South Dakota', -97.00, 44.00], ['ID Panhandle', -116.30, 47.80],
        ['MT Northwest', -114.50, 48.30], ['CO San Juans high', -107.60, 37.80],
        ['CA Sierra', -119.50, 37.80], ['Phoenix', -112.07, 33.45],
        ['Las Vegas', -115.15, 36.17], ['Georgia', -83.50, 32.50],
        ['Pennsylvania', -77.50, 41.00]
      ]
    },
    bear: {
      /* Black bear country from the Adirondacks to the Gila, the coastal
         swamps of the Carolinas and Florida, the Louisiana bottoms and the
         western mountains, against farm country, plains, desert and valley
         floor. The range is the USGS map with the Gila National Forest
         added - see ingest/usgs-range.mjs - and the Atchafalaya point is at
         Krotz Springs, in the basin's northern population; it first sat
         between the two. */
      yes: [
        ['Adirondacks NY', -74.30, 44.10], ['Catskills NY', -74.40, 42.10],
        ['N Maine', -69.30, 46.30], ['N NH', -71.30, 44.90], ['Vermont', -72.80, 43.80],
        ['W Massachusetts', -73.00, 42.40], ['NW New Jersey', -74.70, 41.10],
        ['PA north central', -77.80, 41.50], ['Poconos PA', -75.30, 41.20],
        ['WV highlands', -79.80, 38.60], ['W Maryland', -79.20, 39.60],
        ['Shenandoah VA', -78.40, 38.50], ['Great Smokies', -83.50, 35.60],
        ['N Georgia mountains', -84.00, 34.80], ['Great Dismal Swamp', -76.45, 36.60],
        ['NC coastal plain', -76.50, 35.50], ['Ocala FL', -81.80, 29.20],
        ['Osceola NF FL', -82.40, 30.30], ['Big Cypress FL', -81.20, 26.10],
        ['Apalachicola FL', -85.00, 30.20], ['Okefenokee GA', -82.30, 30.80],
        ['Ozark NF AR', -93.50, 35.80], ['Ouachitas', -94.30, 34.60],
        ['Missouri Ozarks', -91.50, 37.00], ['Tensas River LA', -91.30, 32.20],
        ['N Minnesota', -93.50, 47.30], ['N Wisconsin', -90.40, 45.90],
        ['UP Michigan', -87.50, 46.40], ['N Lower Michigan', -84.60, 44.80],
        ['E Kentucky', -83.30, 37.20], ['E Tennessee', -84.20, 36.40],
        ['NW Montana', -114.50, 48.40], ['Bitterroot MT', -114.30, 46.30],
        ['Idaho Clearwater', -115.50, 46.50], ['Central Idaho', -115.00, 44.50],
        ['NE Washington', -117.80, 48.60], ['Olympic Peninsula', -123.50, 47.70],
        ['Oregon Cascades', -122.00, 44.00], ['Oregon Coast Range', -123.60, 44.30],
        ['SW Oregon', -123.40, 42.60], ['Klamath Mts CA', -123.30, 41.50],
        ['Sierra Nevada CA', -120.00, 38.60], ['S Sierra CA', -118.70, 36.00],
        ['San Bernardino Mts CA', -117.00, 34.20], ['Colorado high country', -106.50, 39.50],
        ['Colorado SW', -107.90, 37.40], ['NM Sangre de Cristo', -105.50, 36.30],
        ['NM Gila', -108.30, 33.30], ['AZ Mogollon Rim', -111.00, 34.40],
        ['AZ White Mts', -109.50, 33.90], ['Utah Uintas', -111.00, 40.70],
        ['Utah Manti-La Sal', -111.40, 39.40], ['Bighorns WY', -107.30, 44.50],
        ['Absarokas WY', -109.90, 44.40], ['Lake Tahoe NV', -119.90, 39.10],
        ['Upper Atchafalaya (Krotz Springs) LA', -91.75, 30.55]
      ],
      no: [
        ['Iowa corn belt', -93.50, 42.00], ['Central Illinois', -89.00, 40.50],
        ['Central Kansas', -98.00, 38.50], ['Central Nebraska', -99.00, 41.50],
        ['North Dakota drift prairie', -99.00, 47.50], ['Eastern South Dakota', -97.80, 44.20],
        ['Texas Panhandle', -102.00, 34.80], ['Permian W Texas', -102.80, 31.00],
        ['W Oklahoma', -99.40, 35.60], ['Death Valley', -116.90, 36.40],
        ['Mojave CA', -116.20, 34.80], ['Sonoran AZ', -113.20, 32.80],
        ['Nevada interior', -116.50, 39.50], ['Bonneville flats', -113.80, 40.75],
        ['WY Red Desert', -108.80, 41.80], ['Snake River Plain ID', -114.40, 43.00],
        ['Columbia Basin WA', -119.30, 46.98], ['San Joaquin floor CA', -120.00, 36.50],
        ['Sacramento Valley floor', -121.90, 39.30], ['Imperial Valley CA', -115.50, 33.00],
        ['E Colorado plains', -103.00, 39.50], ['E Montana plains', -106.90, 47.30],
        ['Delmarva', -75.60, 38.60], ['Long Island', -72.80, 40.85],
        ['Central Indiana', -86.20, 39.80], ['NW Ohio', -84.00, 41.30],
        ['S Minnesota farmland', -95.00, 44.00],
        ['Mississippi River Delta coast', -89.40, 29.20]
      ]
    },
    turkey: {
      /* Rewritten, because the list it replaces was too easy. That one
         had 46 places and 15, the 15 nearly all desert, and the record
         gate passed 46 and 13 of it while showing turkeys across 96
         percent of Idaho and 93 of Montana. The absences that matter
         are the ones beside real turkey country - the high country
         above it and the farmed or sage valley floor below - and they
         are in here now: against these, records alone found every
         place turkeys are and 16 of the first 33 places they are not.
         Turkey range is the USGS map with strong records beside it;
         see ingest/usgs-range.mjs.

         One point was moved. South-west Idaho was a spot on the open
         grass hills north of Emmett, where the birds are in the river
         bottom and not on the hill; it is now the timbered foothills at
         Council. */
      yes: [
        ['MO Ozarks', -91.50, 37.30], ['N Missouri', -93.00, 40.20],
        ['Missouri River hills MO', -92.50, 38.50], ['AL Black Belt', -87.30, 32.40],
        ['E Alabama', -86.80, 32.60], ['Georgia Piedmont', -83.50, 32.50],
        ['Red Hills GA', -84.10, 30.72], ['N Florida', -84.50, 30.40],
        ['FL Osceola (Kissimmee prairie)', -81.20, 27.60], ['Big Cypress FL', -81.20, 26.10],
        ['SC Lowcountry', -80.60, 33.00], ['NC Piedmont', -79.50, 35.80],
        ['Virginia Piedmont', -78.50, 37.50], ['WV', -80.50, 38.80],
        ['W Maryland', -79.00, 39.60], ['PA ridge and valley', -77.80, 40.90],
        ['PA north central', -77.80, 41.20], ['NW New Jersey', -74.80, 41.00],
        ['Catskills NY', -75.50, 42.60], ['W Massachusetts', -72.90, 42.40],
        ['Connecticut', -72.50, 41.60], ['Vermont', -72.80, 43.80],
        ['S New Hampshire', -71.60, 43.20], ['S Maine', -70.30, 44.20],
        ['SE Ohio', -81.80, 39.60], ['Kentucky Bluegrass', -84.50, 37.80],
        ['W Kentucky', -88.00, 37.00], ['Middle Tennessee', -86.50, 35.80],
        ['S Indiana', -86.40, 38.70], ['W Illinois (Pike Co)', -90.90, 39.60],
        ['S Michigan', -84.80, 42.60], ['N Lower Michigan', -84.50, 44.80],
        ['WI Driftless', -90.60, 43.20], ['SE Minnesota', -92.00, 44.00],
        ['S Iowa', -93.00, 41.00], ['SE Nebraska bluffs', -95.90, 40.60],
        ['Mississippi', -90.00, 32.80], ['Arkansas', -92.50, 34.80],
        ['N Louisiana', -92.20, 31.50], ['E Texas Pineywoods', -94.60, 31.30],
        ['TX Hill Country', -99.20, 30.30], ['TX South brush', -98.30, 28.30],
        ['TX Rolling Plains', -100.20, 33.50], ['W Oklahoma', -99.50, 35.50],
        ['C Kansas', -98.00, 38.50], ['NE Niobrara', -100.00, 42.80],
        ['NE Pine Ridge', -103.20, 42.70], ['ND Missouri River', -100.80, 46.80],
        ['SD Black Hills', -103.70, 44.00], ['NE Wyoming', -104.50, 44.50],
        ['SE Montana', -105.50, 45.60], ['Flathead MT', -114.20, 48.10],
        ['CO Southwest', -107.90, 37.30], ['Spanish Peaks CO', -104.90, 37.40],
        ['Uncompahgre CO', -108.50, 38.50], ['NM Lincoln NF', -105.60, 33.00],
        ['NM Gila', -108.30, 33.30], ['AZ Mogollon Rim', -111.00, 34.40],
        ['AZ Kaibab', -112.20, 36.60], ['AZ Huachucas (Gould\'s)', -110.30, 31.45],
        ['ID Clearwater', -116.30, 46.20], ['NE Washington', -117.80, 48.30],
        ['WA Klickitat', -121.20, 45.80], ['NE Oregon Blues', -118.00, 45.50],
        ['SW Oregon', -123.30, 43.00], ['CA Sierra foothills', -120.80, 38.50],
        ['CA Coast Range', -122.80, 38.80], ['WA Blue Mts', -117.80, 46.20],
        ['N Idaho Panhandle', -116.60, 47.90], ['Willamette foothills OR', -123.00, 44.30],
        ['CA North Coast', -123.30, 39.30], ['CA Central Coast', -120.70, 35.60],
        ['CA San Diego backcountry', -116.70, 33.10], ['N Utah (Cache)', -111.70, 41.60],
        ['MT Bitterroot', -114.10, 46.40], ['MT Musselshell', -108.50, 46.40],
        ['WY Laramie Peak', -105.40, 42.30], ['CO Front Range foothills', -105.20, 39.50],
        ['NM Sangre de Cristo', -105.50, 36.30], ['TX Canadian River breaks', -100.40, 35.90],
        ['OK Cross Timbers', -97.60, 34.60], ['KS Flint Hills', -96.60, 38.40],
        ['NE Republican River', -100.20, 40.20], ['SD Missouri breaks', -99.30, 43.20],
        ['ND Little Missouri badlands', -103.40, 47.00], ['C Minnesota', -94.30, 45.60],
        ['N central Wisconsin', -89.70, 45.20], ['UP Menominee MI', -87.60, 45.40],
        ['N New York (St Lawrence)', -75.20, 44.50], ['C Maine', -69.50, 44.80],
        ['Delmarva', -75.60, 38.60], ['E NC coastal plain', -77.30, 35.30],
        ['S Georgia', -83.40, 31.40], ['FL Panhandle', -85.80, 30.60],
        ['S Alabama', -86.90, 31.30], ['LA Florida parishes', -90.60, 30.80],
        ['OK Ouachitas', -94.90, 34.60], ['TX Edwards Plateau west', -100.60, 30.60],
        ['TX Coastal Bend', -97.60, 28.40], ['SW Idaho (Council)', -116.50, 44.80],
        ['S Utah (Paunsaugunt)', -112.50, 37.60]
      ],
      no: [
        ['Mojave CA', -116.20, 34.80], ['Death Valley', -116.90, 36.40],
        ['Las Vegas', -115.15, 36.17], ['Los Angeles', -118.25, 34.05],
        ['Imperial Valley CA', -115.50, 33.00], ['San Joaquin floor CA', -120.00, 36.50],
        ['Sierra crest CA', -118.60, 37.00], ['Sonoran AZ', -113.40, 33.00],
        ['Yuma', -114.60, 32.70], ['Painted Desert AZ', -110.50, 35.50],
        ['Nevada interior', -116.50, 39.50], ['NV central', -116.50, 39.00],
        ['UT West Desert', -113.50, 40.50], ['Bonneville flats', -113.80, 40.75],
        ['WY Red Desert', -108.80, 41.80], ['Wind Rivers alpine WY', -109.60, 43.10],
        ['Yellowstone plateau', -110.50, 44.60], ['CO Sawatch alpine', -106.40, 39.10],
        ['Glacier high country MT', -113.80, 48.70], ['Sawtooth crest ID', -114.90, 44.00],
        ['Snake River Plain ID', -114.40, 43.00], ['Columbia Basin WA', -119.30, 46.98],
        ['North Cascades WA', -121.00, 48.60], ['Olympic interior WA', -123.70, 47.80],
        ['OR Alvord', -118.50, 42.50], ['Big Bend TX', -103.30, 29.30],
        ['Chihuahuan desert NM', -107.50, 32.30], ['White Sands NM', -106.30, 32.80],
        ['TX Llano Estacado', -102.30, 33.90], ['Louisiana coastal marsh', -91.00, 29.40],
        ['Mississippi River Delta LA', -89.40, 29.20], ['Everglades', -80.80, 25.60],
        ['Boundary Waters MN', -91.40, 47.95], ['High Uintas UT', -110.40, 40.75],
        ['San Juan alpine CO', -107.60, 37.80], ['Beartooth plateau MT', -109.60, 45.00],
        ['Mt Rainier WA', -121.75, 46.85], ['Black Rock Desert NV', -119.00, 40.90],
        ['Organ Pipe AZ', -112.80, 32.00], ['El Paso desert TX', -106.00, 31.80]
      ]
    },
    upland: {
      /* Sixteen birds, so the list is by bird: the places each is known
         for. The short list this replaces passed in full while northern
         Maine read 14 out of 100 and the quail country round Albany,
         Georgia read 7, because all it asked was whether a place was in
         range, and nearly everywhere is in range of something.

         Three of the first points were wrong and were moved, not tuned
         round. Albany and Thomasville, Georgia sat within three
         kilometres of the middle of each town; they are now on the
         plantation country beside them. The Death Valley point sat on
         the fan below the Panamints, where chukar are 22% of the upland
         records, and is now on the salt pan at Badwater. */
      yes: [
        ['Pheasant: Mitchell SD', -98.00, 43.70], ['Pheasant: Winner SD', -99.85, 43.38],
        ['Pheasant: Aberdeen SD', -98.50, 45.50], ['Pheasant: Mott ND', -102.30, 46.37],
        ['Pheasant: Colby KS', -101.05, 39.40], ['Pheasant: Holyoke CO', -102.30, 40.50],
        ['Pheasant: McCook NE', -100.60, 40.20], ['Pheasant: Spencer IA', -95.15, 43.15],
        ['Pheasant: Marshall MN', -95.80, 44.45], ['Pheasant: Plentywood MT', -104.55, 48.78],
        ['Pheasant: Palouse WA', -118.00, 46.90],
        ['Pheasant: Sacramento Valley', -121.90, 39.30],
        ['Pheasant: TX Panhandle', -102.00, 34.80], ['Pheasant: Michigan Thumb', -83.20, 43.60],
        ['Bobwhite: Thomasville GA', -84.10, 30.72], ['Bobwhite: Albany GA', -84.35, 31.40],
        ['Bobwhite: Brooks Co TX', -98.20, 27.00], ['Bobwhite: Albany TX', -99.30, 32.70],
        ['Bobwhite: W Oklahoma', -99.40, 35.60], ['Bobwhite: Flint Hills KS', -96.20, 37.80],
        ['Bobwhite: N Missouri', -93.00, 40.20], ['Bobwhite: Ames TN', -89.20, 35.10],
        ['Bobwhite: AL Black Belt', -87.50, 32.30],
        ['Bobwhite: SC coastal plain', -79.50, 34.20], ['Bobwhite: Babcock FL', -81.70, 26.85],
        ['Ruffed grouse: Park Falls WI', -90.45, 45.93],
        ['Ruffed grouse: Grand Rapids MN', -93.53, 47.24],
        ['Ruffed grouse: Gaylord MI', -84.67, 45.03], ['Ruffed grouse: N Maine', -69.30, 46.30],
        ['Ruffed grouse: N NH', -71.30, 44.90], ['Ruffed grouse: Adirondacks NY', -74.30, 44.10],
        ['Ruffed grouse: PA north central', -77.80, 41.50],
        ['Ruffed grouse: WV highlands', -79.80, 38.60],
        ['Sharptail and Hun: Malta MT', -107.87, 48.36],
        ['Sharptail and Hun: Lewistown MT', -109.40, 47.06],
        ['Sharptail: Williston ND', -103.60, 48.15],
        ['Sharptail: Fort Pierre SD', -100.40, 44.20],
        ['Sharptail and chicken: Valentine NE', -100.55, 42.87],
        ['Prairie chicken: Flint Hills KS', -96.60, 38.40],
        ['Sage grouse: Farson WY', -109.40, 42.10], ['Sage grouse: Rawlins WY', -107.20, 41.80],
        ['Sage grouse: Craig CO', -107.55, 40.50], ['Sage grouse: Elko NV', -115.80, 41.50],
        ['Sage grouse: Hart Mtn OR', -119.60, 42.50],
        ['Chukar: Hells Canyon ID', -116.80, 45.30], ['Chukar: Santa Rosa NV', -117.60, 41.50],
        ['Chukar: John Day OR', -119.60, 44.80], ['Chukar: Snake breaks WA', -117.20, 46.50],
        ['Chukar: UT West Desert ranges', -112.90, 40.30],
        ['California quail: Coast Range CA', -121.00, 36.20],
        ['California quail: Yakima WA', -120.50, 46.60],
        ['Gambels quail: Oracle AZ', -110.80, 32.60],
        ['Gambels quail: Phoenix foothills', -111.50, 33.80],
        ['Scaled quail: SE New Mexico', -104.00, 32.50],
        ['Scaled quail: W Texas', -102.80, 31.00], ['Mearns quail: Sonoita AZ', -110.60, 31.60],
        ['Dusky grouse: Colorado', -106.50, 39.50],
        ['Dusky grouse: Wyoming Range', -110.60, 42.60],
        ['Sooty grouse: Cascades WA', -121.50, 47.30],
        ['Mountain quail: Sierra foothills', -120.30, 38.30], ['E South Dakota', -97.80, 44.20],
        ['C Kansas', -98.50, 38.50], ['TX Panhandle east', -101.40, 35.20],
        ['S Georgia', -83.40, 31.40], ['SW Idaho', -116.80, 43.40],
        ['NV chukar', -117.20, 40.60]
      ],
      no: [
        ['Everglades FL', -80.90, 25.90], ['Miami', -80.25, 25.78],
        ['Louisiana coastal marsh', -91.00, 29.40], ['Okefenokee interior GA', -82.30, 30.80],
        ['Atchafalaya swamp LA', -91.60, 30.00], ['New York City', -73.95, 40.75],
        ['Los Angeles', -118.25, 34.05], ['Chicago', -87.65, 41.85], ['Houston', -95.37, 29.76],
        ['Bonneville flats UT', -113.80, 40.75], ['Imperial dunes CA', -115.00, 32.90],
        ['Black Rock playa NV', -119.00, 40.90], ['Mississippi River Delta LA', -89.40, 29.20],
        ['White Sands NM', -106.30, 32.80], ['Badwater salt pan', -116.83, 36.25]
      ]
    },
    ducks: {
      /* Refuges, marshes and river bottoms known for ducks in every
         flyway, against desert and ground above treeline. Death Valley
         fails: the land cover has water or wetland in that cell, and
         nothing here says it is salt. */
      yes: [
        ['Devils Lake ND', -98.86, 48.11], ['J Clark Salyer ND', -100.90, 48.60],
        ['Sand Lake SD', -98.25, 45.80], ['Lake Andes SD', -98.50, 43.15],
        ['Rainwater Basin NE', -98.00, 40.60], ['Platte River NE', -99.00, 40.70],
        ['Cheyenne Bottoms KS', -98.65, 38.47], ['Quivira KS', -98.50, 38.15],
        ['Loess Bluffs MO', -95.25, 40.07], ['Grand Pass MO', -93.30, 39.25],
        ['Swan Lake MO', -93.20, 39.60], ['Mingo MO', -90.10, 37.00],
        ['Illinois River (Chautauqua)', -90.10, 40.38], ['Carlyle Lake IL', -89.30, 38.70],
        ['Reelfoot TN', -89.39, 36.37], ['Stuttgart AR', -91.55, 34.50],
        ['Bayou Meto AR', -91.50, 34.20], ['Cache River AR', -91.30, 35.10],
        ['Mississippi Delta MS', -90.60, 33.50], ['Catahoula Lake LA', -92.10, 31.50],
        ['SW Louisiana', -92.70, 30.00], ['Mississippi River Delta LA', -89.40, 29.30],
        ['Texas rice prairie', -96.30, 29.60], ['Matagorda TX', -96.00, 28.70],
        ['Laguna Madre TX', -97.40, 27.30], ['Playa Lakes TX', -101.80, 34.50],
        ['Hackberry Flat OK', -99.00, 34.30], ['Salt Plains OK', -98.20, 36.75],
        ['Bear River UT', -112.26, 41.44], ['Farmington Bay UT', -112.00, 41.00],
        ['Klamath Basin', -121.60, 41.95], ['Sacramento Valley CA', -121.80, 39.10],
        ['Suisun Marsh CA', -122.00, 38.15], ['Grasslands CA', -120.80, 37.10],
        ['Salton Sea CA', -115.65, 33.20], ['Cibola AZ', -114.70, 33.30],
        ['Columbia Basin WA', -119.30, 46.98], ['Skagit WA', -122.40, 48.35],
        ['Sauvie Island OR', -122.80, 45.70], ['Malheur OR', -118.85, 43.25],
        ['Freezout Lake MT', -112.05, 47.67], ['Bowdoin MT', -107.60, 48.40],
        ['American Falls ID', -112.80, 42.90], ['Stillwater NV', -118.50, 39.55],
        ['Ruby Marshes NV', -115.45, 40.20], ['Bosque del Apache NM', -106.88, 33.80],
        ['Monte Vista CO', -106.10, 37.50], ['Jackson Lake CO', -104.10, 40.40],
        ['Torrington WY', -104.20, 42.07], ['Horicon WI', -88.63, 43.45],
        ['Mississippi Pool 8 WI', -91.25, 43.70], ['Lac qui Parle MN', -95.90, 45.02],
        ['Thief Lake MN', -95.95, 48.50], ['Saginaw Bay MI', -83.52, 43.72],
        ['Lake St Clair MI', -82.75, 42.55], ['Lake Erie marshes OH', -83.10, 41.60],
        ['Montezuma NY', -76.75, 43.00], ['Blackwater MD', -76.10, 38.45],
        ['Susquehanna Flats MD', -76.05, 39.50], ['Bombay Hook DE', -75.45, 39.27],
        ['Forsythe NJ', -74.42, 39.45], ['Great South Bay NY', -73.00, 40.68],
        ['Missisquoi VT', -73.15, 44.97], ['Merrymeeting Bay ME', -69.85, 44.00],
        ['Mattamuskeet NC', -76.20, 35.50], ['Currituck NC', -75.95, 36.40],
        ['Santee SC', -80.10, 33.50], ['ACE Basin SC', -80.45, 32.60],
        ['Altamaha GA', -81.45, 31.35], ['Lake Okeechobee FL', -80.85, 27.00],
        ['Merritt Island FL', -80.70, 28.65], ['Mobile Delta AL', -87.95, 30.75],
        ['Wheeler AL', -86.95, 34.60], ['Kentucky Lake', -88.10, 36.60],
        ['Ballard KY', -89.05, 37.15], ['Chesapeake MD', -76.20, 38.60],
        ['Katy Prairie TX', -95.90, 29.80], ['Mississippi', -90.40, 31.50]
      ],
      no: [
        ['Mojave CA', -116.20, 34.80], ['Death Valley', -116.90, 36.30],
        ['W Texas desert', -104.00, 30.50], ['Big Bend TX', -103.30, 29.30],
        ['White Sands NM', -106.30, 32.80], ['Chihuahuan desert NM', -107.50, 32.30],
        ['Sonoran desert AZ', -113.20, 32.80], ['Painted Desert AZ', -110.50, 35.50],
        ['Canyonlands UT', -110.00, 38.30], ['Bonneville flats UT', -113.80, 40.75],
        ['Black Rock Desert NV', -119.00, 40.90], ['Nevada interior', -116.50, 39.50],
        ['Owyhee desert', -117.00, 42.30], ['Sawatch alpine CO', -106.35, 38.80],
        ['Wind Rivers alpine WY', -109.60, 43.10], ['Sierra crest CA', -118.60, 37.00],
        ['Edwards Plateau dry TX', -100.50, 30.30], ['Guadalupe Mts TX', -104.86, 31.90]
      ]
    },
    'canada-goose': {
      /* Field country within reach of roost water. One fails: Bosque del
         Apache is a narrow irrigated valley through desert, and a cell
         eleven kilometres across reads it as desert. */
      yes: [
        ['Front Range CO (Windsor)', -104.90, 40.50], ['Jackson Lake CO', -104.10, 40.40],
        ['Lamar CO', -102.60, 38.10], ['Torrington WY', -104.20, 42.07],
        ['Rochester MN', -92.55, 43.95], ['Lac qui Parle MN', -95.90, 45.02],
        ['Fergus Falls MN', -96.08, 46.28], ['Pierre SD', -100.35, 44.37],
        ['Sand Lake SD', -98.25, 45.80], ['Devils Lake ND', -98.86, 48.11],
        ['Bismarck ND', -100.60, 46.90], ['Rainwater Basin NE', -98.00, 40.60],
        ['Lake McConaughy NE', -101.70, 41.25], ['Cheyenne Bottoms KS', -98.65, 38.47],
        ['Loess Bluffs MO', -95.25, 40.07], ['Swan Lake MO', -93.20, 39.60],
        ['S Illinois (Union Co)', -89.35, 37.40], ['Ballard KY', -89.05, 37.15],
        ['Horicon WI', -88.63, 43.45], ['Stuttgart AR', -91.55, 34.50],
        ['NE Arkansas', -90.90, 35.80], ['SW Louisiana', -92.70, 30.00],
        ['Texas rice prairie', -96.30, 29.60], ['TX Panhandle (Dumas)', -101.97, 35.86],
        ['Knox City TX', -99.80, 33.40], ['Playa Lakes TX', -101.80, 34.50],
        ['Salt Plains OK', -98.20, 36.75], ['Sacramento Valley CA', -121.90, 39.30],
        ['Klamath Basin', -121.60, 41.95], ['Skagit WA', -122.40, 48.35],
        ['Columbia Basin WA', -119.30, 46.98], ['Willamette Valley OR', -123.10, 44.60],
        ['American Falls ID', -112.80, 42.90], ['Bear River UT', -112.26, 41.44],
        ['Yellowstone valley MT', -108.30, 45.85], ['Freezout Lake MT', -112.05, 47.67],
        ['Bosque del Apache NM', -106.88, 33.80], ['Chestertown MD', -76.00, 39.20],
        ['Easton MD', -76.08, 38.77], ['Bombay Hook DE', -75.50, 39.27],
        ['Middle Creek PA', -76.23, 40.27], ['Montezuma NY', -76.75, 42.95],
        ['Dead Creek VT', -73.35, 44.07], ['Mattamuskeet NC', -76.20, 35.50],
        ['Pungo NC', -76.55, 35.72], ['Fish Point MI', -83.52, 43.72],
        ['Allegan MI', -85.95, 42.58], ['Killdeer Plains OH', -83.30, 40.72],
        ['Mosquito Creek OH', -80.77, 41.38], ['Long Island east end NY', -72.50, 40.95],
        ['Connecticut valley MA', -72.60, 42.35], ['Salem Co NJ', -75.40, 39.60],
        ['Merrymeeting Bay ME', -69.85, 44.00]
      ],
      no: [
        ['Mojave CA', -116.20, 34.80], ['Death Valley', -116.90, 36.30],
        ['W Texas desert', -104.00, 30.50], ['Big Bend TX', -103.30, 29.30],
        ['White Sands NM', -106.30, 32.80], ['Chihuahuan desert NM', -107.50, 32.30],
        ['Sonoran desert AZ', -113.20, 32.80], ['Painted Desert AZ', -110.50, 35.50],
        ['Canyonlands UT', -110.00, 38.30], ['Bonneville flats UT', -113.80, 40.75],
        ['Black Rock Desert NV', -119.00, 40.90], ['Nevada interior', -116.50, 39.50],
        ['Owyhee desert', -117.00, 42.30], ['Sawatch alpine CO', -106.35, 38.80],
        ['Wind Rivers alpine WY', -109.60, 43.10], ['Sierra crest CA', -118.60, 37.00],
        ['Guadalupe Mts TX', -104.86, 31.90], ['Everglades FL', -80.90, 25.90],
        ['Big Cypress FL', -81.10, 26.00], ['Great Smokies crest', -83.50, 35.60],
        ['Selway wilderness ID', -115.00, 46.00], ['Olympic interior WA', -123.70, 47.80]
      ]
    },
    trout: {
      /* The list that showed trout to be the worst of the lot: the app
         found 27 of the first 57 waters on it, because trout habitat was
         twenty rivers drawn by hand. It is measured now - cold water at
         the gauges, trout records, established populations - and this
         list has grown to match, with the places that tested each rule:
         the north Maine woods and the Bob Marshall, where nobody logs
         fish; southern tailwaters no climate would predict; and for the
         negatives the farm country, bogs, dry basins and cities that an
         earlier pass at the rule let in. */
      yes: [
        ['Driftless WI', -90.90, 43.60], ['Au Sable MI', -84.50, 44.70],
        ['Pere Marquette MI', -86.00, 43.90], ['Brule WI', -91.60, 46.60],
        ['North Shore MN', -91.20, 47.50], ['White River AR', -92.50, 36.40],
        ['Norfork AR', -92.24, 36.25], ['Taneycomo MO', -93.20, 36.65],
        ['Current River MO', -91.50, 37.40], ['South Holston TN', -82.10, 36.50],
        ['Smokies TN', -83.50, 35.60], ['Davidson NC', -82.70, 35.30],
        ['Chattahoochee GA', -84.10, 34.10], ['Cumberland KY', -85.10, 36.87],
        ['Shenandoah VA', -78.40, 38.50], ['Elk River WV', -80.30, 38.50],
        ['Savage MD', -79.10, 39.50], ['Gunpowder MD', -76.70, 39.60],
        ['Letort PA', -77.20, 40.20], ['Penns Creek PA', -77.40, 40.85],
        ['Spring Creek PA', -77.80, 40.85], ['Erie tributaries PA', -80.20, 42.00],
        ['Beaverkill NY', -74.90, 41.95], ['West Branch Delaware NY', -75.30, 42.00],
        ['Ausable NY', -73.80, 44.40], ['Salmon River NY', -76.00, 43.50],
        ['Battenkill VT', -73.20, 43.10], ['White Mountains NH', -71.40, 44.20],
        ['Rangeley ME', -70.70, 45.00], ['Guadalupe TX', -98.20, 29.87],
        ['Lower Mountain Fork OK', -94.70, 34.10], ['San Juan NM', -107.70, 36.80],
        ['Lees Ferry AZ', -111.60, 36.87], ['Green River UT', -109.40, 40.90],
        ['Provo UT', -111.55, 40.40], ['Madison MT', -111.60, 45.00],
        ['Bighorn MT', -107.90, 45.30], ['Missouri at Craig MT', -112.00, 47.10],
        ['Henrys Fork ID', -111.30, 44.30], ['Silver Creek ID', -114.10, 43.30],
        ['Deschutes OR', -121.20, 44.80], ['Yakima WA', -120.50, 46.90],
        ['McCloud CA', -122.10, 41.10], ['Truckee CA', -120.20, 39.40],
        ['Owens CA', -118.50, 37.50], ['Fryingpan CO', -106.80, 39.36],
        ['South Platte Deckers CO', -105.20, 39.25], ['North Platte WY', -106.70, 42.20],
        ['Spearfish SD', -103.85, 44.40], ['ME Allagash', -69.20, 46.60],
        ['ME Baxter', -68.90, 46.00], ['NH north', -71.30, 44.90],
        ['NY Adirondacks', -74.40, 44.10], ['MI Upper Peninsula', -87.50, 46.50],
        ['MN Arrowhead', -91.00, 47.80], ['WI north', -89.60, 45.90],
        ['MT Bob Marshall', -113.20, 47.60], ['ID Frank Church', -114.80, 45.00],
        ['WY Wind Rivers', -109.60, 43.00], ['WA N Cascades', -121.00, 48.60],
        ['UT Uintas', -110.40, 40.75], ['CO Weminuche', -107.40, 37.60],
        ['NM Pecos', -105.60, 35.90], ['CA Sierra', -119.30, 37.80],
        ['PA north central', -77.80, 41.50], ['WV highlands', -79.80, 38.60],
        ['NC Blue Ridge', -81.90, 36.00], ['Lower Sacramento CA', -122.35, 40.50],
        ['Caney Fork TN', -85.88, 36.15], ['Bennett Spring MO', -92.86, 37.72],
        ['Owyhee OR', -117.20, 43.70], ['Smith River VA', -79.97, 36.75],
        ['Farmington CT', -72.95, 41.90], ['Arkansas River CO', -106.00, 38.55],
        ['Big Hole MT', -112.90, 45.70]
      ],
      no: [
        ['Florida', -81.50, 28.50], ['S Louisiana', -91.00, 29.80],
        ['Houston', -95.37, 29.76], ['Dallas', -96.80, 32.80],
        ['S Georgia', -83.30, 31.20], ['S Alabama', -87.50, 31.20],
        ['Mississippi delta', -90.80, 33.40], ['Phoenix', -112.07, 33.45],
        ['Yuma', -114.60, 32.70], ['Mojave', -116.00, 35.00], ['W Kansas', -100.50, 38.50],
        ['W Oklahoma', -99.50, 35.50], ['S Texas', -98.50, 27.50],
        ['Iowa farmland', -93.60, 42.00], ['Illinois', -89.00, 40.00],
        ['W Ohio', -84.40, 40.60], ['Red River valley ND', -97.00, 47.50],
        ['E South Dakota', -98.00, 44.40], ['E Nebraska', -96.80, 41.00],
        ['CA Central Valley floor', -120.50, 36.80], ['E Kansas', -95.50, 38.50],
        ['ND prairie', -100.50, 47.50], ['E Montana plains', -105.50, 47.50],
        ['S Michigan', -84.50, 42.50], ['NJ pine barrens', -74.60, 39.80],
        ['Indiana', -86.20, 40.30], ['S Wisconsin', -88.80, 42.90],
        ['Nevada basin', -117.50, 40.20], ['Delmarva', -75.60, 38.60],
        ['S Minnesota farmland', -94.50, 44.30], ['Nebraska Sandhills', -100.50, 42.00],
        ['E Colorado plains', -102.60, 39.30], ['WY Red Desert', -108.50, 41.80],
        ['UT West Desert', -113.50, 40.70], ['Chicago', -87.65, 41.85],
        ['Kansas City', -94.60, 39.10], ['Atlanta south', -84.40, 33.50]
      ]
    }
  };

  /* The upland birds one at a time.

     Each bird against the places it is known for, and against places
     that have other upland birds and not this one - which is the test
     the all-birds list above cannot make. Places are shared between the
     lists, so they are named once.

     Two points were wrong and were changed, not tuned round. The
     foothills north-east of Phoenix were down as having no Mearns
     quail, and the bird is recorded there, in the oak country below the
     Mogollon Rim. And the Sierra foothill point for valley quail was the
     one picked for mountain quail, up in the pines; valley quail now
     have their own, lower down in the oaks. */
  var PLACES = {
    'Mitchell SD': [-98.00, 43.70], 'Winner SD': [-99.85, 43.38], 'Aberdeen SD': [-98.50, 45.50],
    'Mott ND': [-102.30, 46.37], 'Colby KS': [-101.05, 39.40], 'Holyoke CO': [-102.30, 40.50],
    'McCook NE': [-100.60, 40.20], 'Spencer IA': [-95.15, 43.15], 'Marshall MN': [-95.80, 44.45],
    'Plentywood MT': [-104.55, 48.78], 'Palouse WA': [-118.00, 46.90],
    'Sacramento Valley CA': [-121.90, 39.30], 'TX Panhandle': [-102.00, 34.80],
    'Michigan Thumb': [-83.20, 43.60], 'Tulelake CA': [-121.50, 41.90],
    'E central Illinois': [-88.20, 40.40], 'Golden Triangle MT': [-111.00, 48.00],
    'Malta MT': [-107.87, 48.36], 'SE Nebraska': [-96.50, 40.30], 'Yuma Co CO': [-102.40, 40.00],
    'N Maine': [-69.30, 46.30], 'Adirondacks NY': [-74.30, 44.10], 'S Georgia': [-83.40, 31.40],
    'Babcock FL': [-81.70, 26.85], 'SW Louisiana': [-92.70, 30.00], 'Mississippi': [-90.40, 31.50],
    'AL Black Belt': [-87.50, 32.30], 'Ozarks AR': [-93.00, 35.80], 'Great Smokies': [-83.50, 35.60],
    'WV highlands': [-79.80, 38.60], 'Oracle AZ': [-110.80, 32.60],
    'Phoenix foothills AZ': [-111.50, 33.80], 'Mojave Preserve CA': [-115.60, 35.20],
    'Brooks Co TX': [-98.20, 27.00], 'Park Falls WI': [-90.45, 45.93],
    'Lake County MN': [-91.40, 47.80], 'Sawatch alpine CO': [-106.35, 38.80],
    'Olympic Peninsula': [-123.50, 47.50], 'Death Valley floor': [-116.83, 36.25],
    'Red Hills GA': [-84.10, 30.72], 'Albany GA': [-84.35, 31.40], 'Albany TX': [-99.30, 32.70],
    'W Oklahoma': [-99.40, 35.60], 'SE Kansas': [-95.30, 37.50], 'N Missouri': [-93.00, 40.20],
    'Ames TN': [-89.20, 35.10], 'SC coastal plain': [-79.50, 34.20], 'S Iowa': [-93.50, 40.80],
    'W Kentucky': [-88.00, 37.00], 'Rolling Plains TX': [-100.20, 34.50],
    'Southside VA': [-78.00, 36.90], 'S Illinois': [-88.90, 38.00], 'Osage Co OK': [-96.40, 36.80],
    'Flint Hills KS': [-96.60, 38.40], 'Grand Rapids MN': [-93.53, 47.24],
    'Rawlins WY': [-107.20, 41.80], 'Elko NV': [-115.80, 41.50], 'Hart Mtn OR': [-119.60, 42.50],
    'Coast Range CA': [-121.00, 36.20], 'Colorado high country': [-106.50, 39.50],
    'Wyoming Range': [-110.60, 42.60], 'Cascades WA': [-121.50, 47.30], 'N Idaho': [-116.50, 48.50],
    'UP Michigan': [-87.50, 46.40], 'Gaylord MI': [-84.67, 45.03], 'N NH': [-71.30, 44.90],
    'PA north central': [-77.80, 41.50], 'Vermont NEK': [-72.00, 44.70],
    'Idaho panhandle': [-116.30, 47.50], 'Seeley MT': [-113.50, 47.20],
    'NE Washington': [-117.80, 48.60], 'SE New Mexico': [-104.00, 32.50],
    'Lewistown MT': [-109.40, 47.06], 'Williston ND': [-103.60, 48.15],
    'Fort Pierre grassland SD': [-100.40, 44.20], 'Valentine NE': [-100.55, 42.87],
    'Roseau MN': [-95.80, 48.70], 'Thedford Sandhills NE': [-100.60, 41.98],
    'Jordan MT': [-106.90, 47.30], 'Craig CO': [-107.55, 40.50], 'Burwell NE': [-99.10, 41.80],
    'Glacial Ridge MN': [-96.30, 47.70], 'Permian W Texas': [-102.80, 31.00],
    'UT West Desert ranges': [-112.90, 40.30], 'Camas Prairie ID': [-116.30, 46.10],
    'Baker Co OR': [-117.80, 44.80], 'Hells Canyon ID': [-116.80, 45.30],
    'Santa Rosa NV': [-117.60, 41.50], 'John Day OR': [-119.60, 44.80],
    'Snake breaks WA': [-117.20, 46.50], 'NV chukar hills': [-117.20, 40.60],
    'Owyhee canyon OR': [-117.25, 43.60], 'Steens OR': [-118.60, 42.60],
    'Salmon River ID': [-116.30, 45.75], 'Yakima canyon WA': [-120.45, 46.85],
    'Red Mountain CA': [-117.60, 35.35], 'Book Cliffs': [-109.20, 39.40],
    'Cody WY': [-109.20, 44.40], 'Willamette Valley OR': [-123.10, 44.60],
    'Farson WY': [-109.40, 42.10], 'Pinedale WY': [-109.90, 42.70],
    'S Phillips Co MT': [-108.00, 47.90], 'Owyhee ID': [-116.30, 42.50],
    'North Park CO': [-106.30, 40.70], 'Rich Co UT': [-111.20, 41.60],
    'Yakima valley WA': [-120.70, 46.50], 'Sierra foothills CA': [-120.30, 38.30], 'Sierra low foothills CA': [-120.70, 38.10],
    'Boise foothills ID': [-116.10, 43.70], 'Okanogan WA': [-119.60, 48.40],
    'Rogue Valley OR': [-122.90, 42.40], 'Carson Valley NV': [-119.80, 39.00],
    'Mormon Mesa NV': [-114.40, 36.60], 'St George UT': [-113.60, 37.10],
    'Avra Valley AZ': [-111.30, 32.30], 'Safford AZ': [-109.80, 32.90],
    'Lordsburg NM': [-108.70, 32.30], 'Socorro NM': [-106.90, 34.00], 'Kingman AZ': [-114.00, 35.20],
    'Comanche grassland CO': [-103.00, 37.30], 'Marfa TX': [-104.00, 30.30],
    'Sulphur Springs AZ': [-109.80, 31.90], 'Clayton NM': [-103.30, 36.40],
    'Oklahoma Panhandle': [-102.00, 36.80], 'Laredo brush TX': [-99.60, 28.00],
    'Sonoita AZ': [-110.60, 31.60], 'Huachucas AZ': [-110.30, 31.45],
    'Santa Ritas AZ': [-110.85, 31.75], 'Chiricahuas AZ': [-109.30, 31.90],
    'Peloncillos NM': [-108.90, 31.60], 'Davis Mts TX': [-104.00, 30.65],
    'Gila NM': [-108.30, 33.20], 'Mendocino NF CA': [-122.90, 39.50],
    'Klamath Mts CA': [-123.30, 41.50], 'SW Oregon': [-123.40, 42.60],
    'Oregon Coast Range': [-123.60, 44.30], 'San Bernardino Mts CA': [-117.00, 34.20],
    'S Sierra CA': [-118.70, 36.00], 'San Joaquin floor CA': [-120.00, 36.50],
    'Columbia Basin WA': [-119.30, 46.98], 'Bitterroot MT': [-114.30, 46.30],
    'Central Idaho': [-115.00, 44.50], 'Uintas UT': [-111.00, 40.70],
    'N New Mexico mts': [-105.50, 36.30], 'Oregon Cascades': [-122.00, 44.00],
    'Sierra Nevada CA': [-120.00, 38.60], 'Blue Mts OR': [-118.20, 45.30],
    'White Mts AZ': [-109.50, 33.90], 'Bighorns WY': [-107.30, 44.50],
    'Snake River Plain ID': [-114.40, 43.00], 'E UP Michigan': [-86.00, 46.50],
    'NW Montana': [-114.50, 48.50], 'N Cascades WA': [-120.50, 48.60],
    'S Wisconsin': [-89.50, 43.20]
  };
  var BIRDS = {
    'pheasant': {
      yes: [
        'Mitchell SD', 'Winner SD', 'Aberdeen SD', 'Mott ND', 'Colby KS', 'Holyoke CO', 'McCook NE',
        'Spencer IA', 'Marshall MN', 'Plentywood MT', 'Palouse WA', 'Sacramento Valley CA',
        'TX Panhandle', 'Michigan Thumb', 'Tulelake CA', 'E central Illinois', 'Golden Triangle MT',
        'Malta MT', 'SE Nebraska', 'Yuma Co CO'
      ],
      no: [
        'N Maine', 'Adirondacks NY', 'S Georgia', 'Babcock FL', 'SW Louisiana', 'Mississippi',
        'AL Black Belt', 'Ozarks AR', 'Great Smokies', 'WV highlands', 'Oracle AZ',
        'Phoenix foothills AZ', 'Mojave Preserve CA', 'Brooks Co TX', 'Park Falls WI',
        'Lake County MN', 'Sawatch alpine CO', 'Olympic Peninsula', 'Death Valley floor',
        'Red Hills GA'
      ]
    },
    'bobwhite': {
      yes: [
        'Red Hills GA', 'Albany GA', 'Brooks Co TX', 'Albany TX', 'W Oklahoma', 'SE Kansas',
        'N Missouri', 'Ames TN', 'AL Black Belt', 'SC coastal plain', 'Babcock FL', 'SE Nebraska',
        'S Iowa', 'W Kentucky', 'Rolling Plains TX', 'Southside VA', 'S Illinois', 'Osage Co OK',
        'Flint Hills KS', 'S Georgia'
      ],
      no: [
        'N Maine', 'Adirondacks NY', 'Grand Rapids MN', 'Park Falls WI', 'Malta MT', 'Rawlins WY',
        'Elko NV', 'Hart Mtn OR', 'Coast Range CA', 'Phoenix foothills AZ', 'Mott ND',
        'Colorado high country', 'Wyoming Range', 'Death Valley floor', 'Cascades WA', 'N Idaho',
        'Sacramento Valley CA', 'UP Michigan'
      ]
    },
    'ruffed-grouse': {
      yes: [
        'Park Falls WI', 'Grand Rapids MN', 'Gaylord MI', 'N Maine', 'N NH', 'Adirondacks NY',
        'PA north central', 'WV highlands', 'UP Michigan', 'Vermont NEK', 'Idaho panhandle',
        'Seeley MT', 'NE Washington', 'Lake County MN'
      ],
      no: [
        'Colby KS', 'McCook NE', 'Brooks Co TX', 'W Oklahoma', 'Babcock FL', 'S Georgia',
        'SW Louisiana', 'Mississippi', 'Oracle AZ', 'Coast Range CA', 'Death Valley floor',
        'Mitchell SD', 'E central Illinois', 'TX Panhandle', 'Holyoke CO', 'Sacramento Valley CA',
        'Mojave Preserve CA', 'SE New Mexico', 'Red Hills GA', 'Albany TX'
      ]
    },
    'sharptail': {
      yes: [
        'Malta MT', 'Lewistown MT', 'Williston ND', 'Fort Pierre grassland SD', 'Valentine NE',
        'Plentywood MT', 'Roseau MN', 'Mott ND', 'Thedford Sandhills NE', 'Jordan MT', 'Craig CO'
      ],
      no: [
        'Flint Hills KS', 'W Oklahoma', 'Brooks Co TX', 'Red Hills GA', 'Oracle AZ',
        'Coast Range CA', 'N Maine', 'PA north central', 'WV highlands', 'N Missouri', 'Spencer IA',
        'E central Illinois', 'Sacramento Valley CA', 'Babcock FL', 'SE New Mexico',
        'Mojave Preserve CA', 'Albany TX', 'SW Louisiana', 'Cascades WA', 'SE Kansas'
      ]
    },
    'prairie-chicken': {
      yes: [
        'Flint Hills KS', 'Valentine NE', 'Fort Pierre grassland SD', 'Yuma Co CO', 'Burwell NE',
        'Osage Co OK', 'Glacial Ridge MN', 'Thedford Sandhills NE'
      ],
      no: [
        'Malta MT', 'Rawlins WY', 'Red Hills GA', 'N Maine', 'Oracle AZ', 'Elko NV',
        'Coast Range CA', 'Brooks Co TX', 'Permian W Texas', 'Babcock FL', 'PA north central',
        'WV highlands', 'Gaylord MI', 'Palouse WA', 'Hart Mtn OR', 'UT West Desert ranges',
        'SW Louisiana', 'Mississippi', 'Lewistown MT', 'Park Falls WI'
      ]
    },
    'hun': {
      yes: [
        'Malta MT', 'Lewistown MT', 'Williston ND', 'Plentywood MT', 'Mott ND', 'Palouse WA',
        'Camas Prairie ID', 'Spencer IA', 'Baker Co OR', 'Golden Triangle MT'
      ],
      no: [
        'W Oklahoma', 'Brooks Co TX', 'Red Hills GA', 'Oracle AZ', 'SE New Mexico', 'Coast Range CA',
        'N Maine', 'PA north central', 'WV highlands', 'Babcock FL', 'SW Louisiana', 'N Missouri',
        'Holyoke CO', 'Mojave Preserve CA', 'Sacramento Valley CA', 'Flint Hills KS', 'Albany TX',
        'Mississippi', 'Great Smokies'
      ]
    },
    'chukar': {
      yes: [
        'Hells Canyon ID', 'Santa Rosa NV', 'John Day OR', 'Snake breaks WA',
        'UT West Desert ranges', 'NV chukar hills', 'Owyhee canyon OR', 'Steens OR',
        'Salmon River ID', 'Yakima canyon WA', 'Red Mountain CA', 'Book Cliffs', 'Cody WY'
      ],
      no: [
        'Colby KS', 'Mitchell SD', 'McCook NE', 'Marshall MN', 'Red Hills GA', 'N Maine',
        'PA north central', 'Brooks Co TX', 'W Oklahoma', 'Babcock FL', 'SW Louisiana',
        'Park Falls WI', 'Cascades WA', 'Olympic Peninsula', 'Sacramento Valley CA',
        'Willamette Valley OR', 'Phoenix foothills AZ', 'SE New Mexico', 'Adirondacks NY',
        'E central Illinois'
      ]
    },
    'sage-grouse': {
      yes: [
        'Farson WY', 'Rawlins WY', 'Craig CO', 'Elko NV', 'Hart Mtn OR', 'Pinedale WY',
        'S Phillips Co MT', 'Owyhee ID', 'North Park CO', 'Jordan MT', 'Rich Co UT'
      ],
      no: [
        'Colby KS', 'McCook NE', 'Brooks Co TX', 'W Oklahoma', 'Oracle AZ', 'Phoenix foothills AZ',
        'SE New Mexico', 'Red Hills GA', 'N Maine', 'PA north central', 'Park Falls WI',
        'Marshall MN', 'Spencer IA', 'Coast Range CA', 'Cascades WA', 'Mojave Preserve CA',
        'Sacramento Valley CA', 'Mitchell SD', 'Olympic Peninsula', 'Babcock FL'
      ]
    },
    'valley-quail': {
      yes: [
        'Coast Range CA', 'Yakima valley WA', 'Sierra low foothills CA', 'Boise foothills ID',
        'Okanogan WA', 'Rogue Valley OR', 'John Day OR', 'Santa Rosa NV', 'Carson Valley NV',
        'Snake breaks WA', 'Sacramento Valley CA'
      ],
      no: [
        'Colby KS', 'Mitchell SD', 'McCook NE', 'Brooks Co TX', 'W Oklahoma', 'Red Hills GA',
        'N Maine', 'PA north central', 'Marshall MN', 'Park Falls WI', 'Babcock FL', 'SE New Mexico',
        'Malta MT', 'Rawlins WY', 'Holyoke CO', 'Oracle AZ', 'Albany TX', 'Adirondacks NY'
      ]
    },
    'gambels-quail': {
      yes: [
        'Oracle AZ', 'Phoenix foothills AZ', 'Mojave Preserve CA', 'Mormon Mesa NV', 'St George UT',
        'Avra Valley AZ', 'Safford AZ', 'Lordsburg NM', 'Socorro NM', 'Kingman AZ'
      ],
      no: [
        'Colby KS', 'Mitchell SD', 'Brooks Co TX', 'W Oklahoma', 'Red Hills GA', 'N Maine',
        'PA north central', 'Marshall MN', 'Babcock FL', 'Coast Range CA', 'Sacramento Valley CA',
        'Sierra foothills CA', 'John Day OR', 'Yakima valley WA', 'Malta MT', 'Rawlins WY',
        'Elko NV', 'Hart Mtn OR', 'Albany TX', 'Cascades WA'
      ]
    },
    'scaled-quail': {
      yes: [
        'SE New Mexico', 'Permian W Texas', 'Comanche grassland CO', 'Marfa TX',
        'Sulphur Springs AZ', 'Clayton NM', 'Oklahoma Panhandle', 'Laredo brush TX', 'Lordsburg NM'
      ],
      no: [
        'Flint Hills KS', 'Mitchell SD', 'Valentine NE', 'Red Hills GA', 'N Maine',
        'PA north central', 'Marshall MN', 'Babcock FL', 'SW Louisiana', 'Coast Range CA',
        'Sacramento Valley CA', 'John Day OR', 'Yakima valley WA', 'Malta MT', 'Rawlins WY',
        'St George UT', 'Cascades WA', 'Hart Mtn OR', 'N Missouri', 'Mojave Preserve CA'
      ]
    },
    'mearns-quail': {
      yes: [
        'Sonoita AZ', 'Huachucas AZ', 'Santa Ritas AZ', 'Chiricahuas AZ', 'Peloncillos NM',
        'Davis Mts TX', 'Gila NM'
      ],
      no: [
        'Mojave Preserve CA', 'Colby KS', 'Colorado high country', 'Red Hills GA', 'N Maine',
        'Coast Range CA', 'Elko NV', 'St George UT', 'Malta MT', 'Mitchell SD', 'Clayton NM',
        'Brooks Co TX', 'W Oklahoma', 'Permian W Texas', 'Kingman AZ', 'Sacramento Valley CA',
        'Babcock FL', 'PA north central'
      ]
    },
    'mountain-quail': {
      yes: [
        'Sierra foothills CA', 'Mendocino NF CA', 'Klamath Mts CA', 'SW Oregon',
        'Oregon Coast Range', 'San Bernardino Mts CA', 'S Sierra CA'
      ],
      no: [
        'Colby KS', 'Mitchell SD', 'Red Hills GA', 'N Maine', 'PA north central', 'Oracle AZ',
        'SE New Mexico', 'Colorado high country', 'Rawlins WY', 'Malta MT', 'UT West Desert ranges',
        'Sacramento Valley CA', 'San Joaquin floor CA', 'Columbia Basin WA', 'Brooks Co TX',
        'Babcock FL', 'Marshall MN', 'Phoenix foothills AZ', 'Death Valley floor'
      ]
    },
    'blue-grouse': {
      yes: [
        'Colorado high country', 'Wyoming Range', 'Cascades WA', 'Bitterroot MT', 'Central Idaho',
        'Uintas UT', 'N New Mexico mts', 'Oregon Cascades', 'Olympic Peninsula', 'Sierra Nevada CA',
        'Blue Mts OR', 'White Mts AZ', 'Bighorns WY'
      ],
      no: [
        'Colby KS', 'Mitchell SD', 'Red Hills GA', 'N Maine', 'PA north central', 'Oracle AZ',
        'Mojave Preserve CA', 'Sacramento Valley CA', 'Columbia Basin WA', 'Snake River Plain ID',
        'Malta MT', 'Mott ND', 'Brooks Co TX', 'W Oklahoma', 'Babcock FL', 'Park Falls WI',
        'Marshall MN', 'Death Valley floor', 'SE New Mexico', 'Willamette Valley OR'
      ]
    },
    'spruce-grouse': {
      yes: [
        'N Maine', 'Lake County MN', 'E UP Michigan', 'NW Montana', 'N Idaho', 'NE Washington',
        'N Cascades WA', 'N NH'
      ],
      no: [
        'PA north central', 'WV highlands', 'Colby KS', 'Mitchell SD', 'Colorado high country',
        'Uintas UT', 'Elko NV', 'Coast Range CA', 'Sierra Nevada CA', 'Oracle AZ', 'Brooks Co TX',
        'Red Hills GA', 'S Wisconsin', 'Spencer IA', 'SW Oregon', 'N New Mexico mts', 'Babcock FL',
        'Michigan Thumb', 'Great Smokies', 'Marshall MN'
      ]
    }
  };
  Object.keys(BIRDS).forEach(function (b) {
    var at = function (n) { return [n, PLACES[n][0], PLACES[n][1]]; };
    T[b] = { yes: BIRDS[b].yes.map(at), no: BIRDS[b].no.map(at) };
  });

  var OG = window.OG;
  var t = 1.3, doy = OG.env.doyFor(t);
  var rows = [], totYes = 0, hitYes = 0, totNo = 0, hitNo = 0;

  Object.keys(T).forEach(function (sp) {
    var set = T[sp], misses = [];
    var y = 0, n = 0;
    set.yes.forEach(function (p) {
      var sc = OG.models.scoreAt(p[1], p[2], t, doy, sp);
      if (sc.inRange) y++;
      else misses.push('MISSING ' + p[0] + ' (hab ' +
        Math.round(OG.env.habOf(OG.env.habitat(p[1], p[2]), OG.models.byId(sp).habKey) * 100) + ')');
    });
    set.no.forEach(function (p) {
      var sc = OG.models.scoreAt(p[1], p[2], t, doy, sp);
      if (!sc.inRange) n++;
      else misses.push('FALSE   ' + p[0] + ' (opp ' + sc.opportunity + ')');
    });
    totYes += set.yes.length; hitYes += y;
    totNo += set.no.length; hitNo += n;
    rows.push({
      species: sp,
      present: y + '/' + set.yes.length,
      absent: n + '/' + set.no.length,
      misses: misses
    });
  });

  var out = ['RANGE VALIDATION', ''];
  rows.forEach(function (r) {
    out.push(r.species.padEnd(16) + ' present ' + r.present.padEnd(7) + ' absent ' + r.absent);
    r.misses.forEach(function (m) { out.push('              ' + m); });
  });
  out.push('');
  out.push('TOTAL  present ' + hitYes + '/' + totYes +
           '   absent ' + hitNo + '/' + totNo +
           '   overall ' + Math.round(100 * (hitYes + hitNo) / (totYes + totNo)) + '%');
  return out.join('\n');
})();
