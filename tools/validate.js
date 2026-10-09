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
      yes: [
        ['W Colorado', -108.00, 39.20], ['Red Desert WY', -108.20, 41.80],
        ['Book Cliffs UT', -109.60, 39.40], ['Kaibab AZ', -112.20, 36.40],
        ['E Oregon', -118.60, 43.60], ['SW Idaho', -116.20, 43.00]
      ],
      no: [
        ['Ohio', -82.90, 40.20], ['Georgia', -83.50, 32.80],
        ['Pennsylvania', -77.80, 40.90], ['Mississippi', -89.80, 32.40],
        ['Illinois', -89.20, 40.10]
      ]
    },
    whitetail: {
      yes: [
        ['Iowa', -93.60, 41.90], ['Buffalo Co WI', -91.75, 44.37],
        ['Texas Hill Country', -99.10, 30.30], ['S Georgia', -83.40, 31.40],
        ['Pennsylvania', -77.80, 40.90], ['Milk River MT', -107.90, 48.40],
        ['E Colorado bottoms', -102.60, 40.60], ['N Idaho', -116.50, 47.80]
      ],
      no: [
        ['Nevada Great Basin', -116.50, 39.50], ['Utah west desert', -113.00, 39.50],
        ['Mojave CA', -116.20, 34.80], ['Central AZ desert', -112.60, 33.20]
      ]
    },
    moose: {
      yes: [
        ['N Maine', -69.30, 46.30], ['Adirondacks NY', -74.30, 44.10],
        ['N Minnesota', -91.60, 47.90], ['NW Montana', -114.20, 48.40],
        ['Jackson WY', -110.70, 43.55], ['Uintas UT', -110.40, 40.70],
        ['North Park CO', -106.30, 40.70]
      ],
      no: [
        ['Kansas', -98.50, 38.50], ['Texas', -97.50, 31.50],
        ['Georgia', -83.50, 32.80], ['Nebraska', -99.00, 41.00],
        ['Ohio', -82.90, 40.20]
      ]
    },
    pronghorn: {
      yes: [
        ['Red Desert WY', -108.20, 41.80], ['E Montana', -105.80, 46.40],
        ['NE New Mexico', -104.20, 36.10], ['W Nebraska', -103.40, 41.60],
        ['SE Oregon', -118.80, 42.60], ['W Texas', -102.90, 31.40]
      ],
      no: [
        ['Ohio', -82.90, 40.20], ['Alabama', -86.80, 32.60],
        ['Missouri', -92.50, 38.50], ['Maine', -69.30, 45.30],
        ['Florida', -81.50, 28.50]
      ]
    },
    turkey: {
      yes: [
        ['Missouri', -92.50, 38.50], ['Pennsylvania', -77.80, 40.90],
        ['Alabama', -86.80, 32.60], ['Texas Hill Country', -99.10, 30.30],
        ['Black Hills SD', -103.70, 43.90], ['New York', -75.50, 42.60]
      ],
      no: [
        ['Mojave CA', -116.20, 34.80], ['Nevada interior', -116.50, 39.50],
        ['Sonoran AZ', -113.40, 33.00]
      ]
    },
    upland: {
      yes: [
        ['E South Dakota', -97.80, 44.20], ['C Kansas', -98.50, 38.50],
        ['TX Panhandle', -101.40, 35.20], ['S Georgia', -83.40, 31.40],
        ['SW Idaho chukar', -116.80, 43.40], ['NV chukar', -117.20, 40.60],
        /* Ruffed grouse are abundant through the Adirondacks. This was
           listed as an absence in the first draft of this table, which
           was my mistake and not the model's - the table is only worth
           anything if its own errors get corrected rather than tuned
           against. */
        ['Adirondacks NY grouse', -74.30, 44.10]
      ],
      no: [
        ['Everglades sawgrass FL', -80.90, 25.90]
      ]
    },
    ducks: {
      yes: [
        ['Stuttgart AR', -91.55, 34.50], ['Devils Lake ND', -98.86, 48.11],
        ['Bear River UT', -112.26, 41.44], ['Sacramento Valley CA', -121.80, 39.10],
        ['Horicon WI', -88.63, 43.45], ['Chesapeake MD', -76.20, 38.60],
        ['SW Louisiana', -92.70, 30.00], ['Katy Prairie TX', -95.90, 29.80],
        ['Mississippi', -90.40, 31.50], ['Reelfoot TN', -89.39, 36.37]
      ],
      no: [
        ['W Texas desert', -104.00, 30.50], ['Nevada interior', -116.50, 39.50],
        ['Sawatch alpine CO', -106.35, 38.80], ['Mojave CA', -116.20, 34.80]
      ]
    },
    trout: {
      yes: [
        ['Madison MT', -111.60, 45.30], ['Au Sable MI', -84.71, 44.66],
        ['Penns Creek PA', -77.32, 40.88], ['Battenkill VT', -73.10, 43.08],
        ['White R AR', -92.56, 36.37], ['Frying Pan CO', -106.82, 39.36],
        ['Davidson NC', -82.78, 35.28], ['Salmon R NY', -76.13, 43.52],
        ['Driftless WI', -90.80, 43.55]
      ],
      no: [
        ['Phoenix AZ', -112.07, 33.45], ['Houston TX', -95.37, 29.76],
        ['Kansas prairie', -98.50, 38.50], ['S Florida', -80.90, 25.90]
      ]
    }
  };

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
        Math.round(OG.env.habitat(p[1], p[2])[sp === 'ducks' ? 'waterfowl' : sp] * 100) + ')');
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
    out.push(r.species.padEnd(11) + ' present ' + r.present.padEnd(7) + ' absent ' + r.absent);
    r.misses.forEach(function (m) { out.push('              ' + m); });
  });
  out.push('');
  out.push('TOTAL  present ' + hitYes + '/' + totYes +
           '   absent ' + hitNo + '/' + totNo +
           '   overall ' + Math.round(100 * (hitYes + hitNo) / (totYes + totNo)) + '%');
  return out.join('\n');
})();
