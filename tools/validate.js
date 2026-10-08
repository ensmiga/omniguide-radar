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
      yes: [
        ['White River CO', -107.60, 40.00], ['Gunnison CO', -106.93, 38.55],
        ['Bitterroot MT', -114.09, 46.10], ['Jackson WY', -110.70, 43.55],
        ['Gila NM', -108.40, 33.30], ['Blue Mountains OR', -118.40, 45.10],
        ['Olympic Pen. WA', -123.60, 47.70], ['Benezette PA', -78.35, 41.32],
        ['Buffalo River AR', -93.05, 35.98], ['SE Kentucky', -83.30, 37.10],
        /* The first version of this table listed ten elk positives, all
           of them obvious western country plus two reintroductions, and
           scored 8/10 - which looked respectable and was hiding that the
           model missed ten of the eighteen established herds outside the
           Rockies. Elk are in far more states than a mountain-shaped
           intuition suggests. Every one of these has a herd and a
           season. */
        ['Fort Riley KS', -96.80, 39.10], ['Cimarron Grassland KS', -101.90, 37.10],
        ['Black Hills SD', -103.70, 43.90], ['Custer SP SD', -103.40, 43.75],
        ['Pigeon River MI', -84.45, 45.10], ['Clam Lake WI', -90.90, 46.15],
        ['NW Minnesota', -96.40, 48.60], ['Peck Ranch MO', -91.15, 37.20],
        ['Wichita Mts OK', -98.70, 34.73], ['Cookson Hills OK', -94.85, 35.70],
        ['Glass Mts TX', -103.10, 30.55], ['Buchanan Co VA', -82.05, 37.25],
        ['Tomblin WMA WV', -81.95, 37.85], ['N Cumberland TN', -84.15, 36.45],
        ['Cataloochee NC', -83.10, 35.62]
      ],
      no: [
        ['Central Florida', -81.50, 28.50], ['Coastal Georgia', -82.00, 31.50],
        ['Iowa farmland', -93.60, 41.90], ['New Jersey', -74.60, 40.20],
        ['Delmarva', -75.70, 38.80], ['Mississippi delta', -90.80, 33.40]
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
