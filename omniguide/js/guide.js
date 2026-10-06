/* OmniGuide - Strategy Engine. The "Guide" in OmniGuide.

   Every sentence this file emits is selected by a rule reading a number the
   models produced. There is no language model in the loop and no free-text
   invention: habitat class picks the spread, wind bearing picks the bank and
   the landing pocket, migration and pressure pick the calling, water
   temperature and day of year pick the hatch and the rig. */
(function (global) {
  'use strict';

  var env = global.OG.env, models = global.OG.models, regs = global.OG.regs, geo = global.OG.geo;
  var clamp01 = env.clamp01, clamp = env.clamp, bell = env.bell;
  function pref(v, i, t) { var k = (v - i) / t; return Math.exp(-k * k); }
  function ramp(v, a, b) { return clamp01((v - a) / (b - a)); }

  /* ---------- Place naming ---------- */

  var PLACES = [
    ['Fort Smith', -107.93, 45.32], ['Craig', -111.96, 47.08], ['Ennis', -111.73, 45.35],
    ['Stuttgart', -91.55, 34.50], ['Lonoke', -91.90, 34.78], ['Devils Lake', -98.86, 48.11],
    ['Jamestown', -98.71, 46.91], ['Aberdeen', -98.49, 45.46], ['Pierre', -100.35, 44.37],
    ['Kearney', -99.08, 40.70], ['Grand Island', -98.34, 40.92], ['Valentine', -100.55, 42.87],
    ['Malta', -107.87, 48.36], ['Glasgow', -106.64, 48.20], ['Miles City', -105.84, 46.41],
    ['Billings', -108.50, 45.78], ['Bozeman', -111.04, 45.68], ['Missoula', -113.99, 46.87],
    ['Great Falls', -111.30, 47.51], ['Williston', -103.62, 48.15], ['Bismarck', -100.78, 46.81],
    ['Fargo', -96.79, 46.88], ['Detroit Lakes', -95.85, 46.82], ['Fergus Falls', -96.08, 46.28],
    ['Willmar', -95.04, 45.12], ['Horicon', -88.63, 43.45], ['Prairie du Chien', -91.14, 43.05],
    ['Havana', -90.06, 40.30], ['Cairo', -89.18, 37.01], ['Memphis', -90.05, 35.15],
    ['Greenville', -91.06, 33.41], ['Tallulah', -91.19, 32.41], ['Gueydan', -92.51, 30.03],
    ['Venice', -89.35, 29.28], ['Katy', -95.81, 29.79], ['El Campo', -96.27, 29.20],
    ['Port Lavaca', -96.63, 28.61], ['Amarillo', -101.83, 35.22], ['Lubbock', -101.86, 33.58],
    ['Garden City', -100.87, 37.97], ['Great Bend', -98.76, 38.36], ['Mound City', -95.23, 40.13],
    ['Sumner', -93.24, 39.65], ['Colusa', -122.01, 39.21], ['Gridley', -121.69, 39.36],
    ['Los Banos', -120.85, 37.06], ['Tulelake', -121.48, 41.95], ['Brigham City', -112.02, 41.51],
    ['Burley', -113.79, 42.54], ['Moses Lake', -119.28, 47.13], ['Pasco', -119.10, 46.23],
    ['Easton', -76.08, 38.77], ['Cambridge', -76.08, 38.56], ['Chincoteague', -75.38, 37.93],
    ['Mattamuskeet', -76.18, 35.46], ['Monte Vista', -106.15, 37.58], ['Gunnison', -106.93, 38.55],
    ['Steamboat Springs', -106.83, 40.48], ['Cody', -109.06, 44.53], ['Pinedale', -109.86, 42.87],
    ['Salmon', -113.90, 45.18], ['Baker City', -117.83, 44.77], ['Winnemucca', -117.74, 40.97],
    ['Chama', -106.58, 36.90], ['Farmington', -108.22, 36.73], ['Show Low', -110.03, 34.25],
    ['Roscommon', -84.60, 44.50], ['Montezuma', -76.70, 43.00], ['Hancock', -75.28, 41.95],
    ['Carlisle', -77.19, 40.20], ['Mountain Home', -92.39, 36.34], ['Clarksville', -87.36, 36.53],
    ['Savannah', -88.25, 35.22], ['Bowling Green', -86.44, 36.99], ['Oakland', -79.41, 39.41]
  ];

  function placeLabel(lon, lat) {
    var si = geo.stateIndexAt(lon, lat);
    var stName = si >= 0 ? geo.states[si].name : null;
    var hab = env.habitat(lon, lat);

    var bestP = null, bd = 1e9;
    for (var i = 0; i < PLACES.length; i++) {
      var dx = (lon - PLACES[i][1]) * Math.cos(lat * Math.PI / 180), dy = lat - PLACES[i][2];
      var d = dx * dx + dy * dy;
      if (d < bd) { bd = d; bestP = PLACES[i]; }
    }
    var near = bd < 0.55 ? bestP[0] : null;
    var county = geo.countyAt(lon, lat);

    var title = hab.water || hab.region ||
      (near ? near + ' area' : (county ? county.name + ' County' : stName || 'Selected area'));
    var sub = [];
    if (near && title.indexOf(near) < 0) sub.push('near ' + near);
    if (county && title.indexOf(county.name) < 0) sub.push(county.name + ' County');
    if (stName) sub.push(stName);
    return {
      title: title, county: county,
      sub: sub.join(', ') || 'Unmapped area',
      coords: Math.abs(lat).toFixed(3) + '° ' + (lat >= 0 ? 'N' : 'S') + ', ' +
              Math.abs(lon).toFixed(3) + '° ' + (lon >= 0 ? 'E' : 'W')
    };
  }

  /* ---------- Activity windows ---------- */

  function activityCurve(spId, sunObj, wx) {
    var pts = [];
    for (var h = 0; h <= 24; h += 0.25) pts.push({ h: h, a: models.hourlyActivity(spId, h, sunObj, wx) });
    return pts;
  }

  /* Widest contiguous run above a share of the day's peak. */
  function peakWindow(curve, floorFrac, lo, hi) {
    var max = 0, i;
    for (i = 0; i < curve.length; i++) {
      if (lo != null && curve[i].h * 60 < lo - 0.01) continue;
      if (hi != null && curve[i].h * 60 > hi + 0.01) continue;
      if (curve[i].a > max) max = curve[i].a;
    }
    if (max <= 0) return null;
    var thr = max * floorFrac, bestA = null, bestB = null, bestLen = 0, sA = null;
    for (i = 0; i < curve.length; i++) {
      var inRange = (lo == null || curve[i].h * 60 >= lo - 0.01) && (hi == null || curve[i].h * 60 <= hi + 0.01);
      var ok = inRange && curve[i].a >= thr;
      if (ok && sA === null) sA = curve[i].h;
      if ((!ok || i === curve.length - 1) && sA !== null) {
        var e = curve[i].h, len = e - sA;
        if (len > bestLen) { bestLen = len; bestA = sA; bestB = e; }
        sA = null;
      }
    }
    if (bestA === null) return null;
    return { startMin: bestA * 60, endMin: bestB * 60, peak: max };
  }

  /* ---------- Waterfowl strategy ---------- */

  var CLS_HABITAT = {
    pothole: 'Shallow basins with emergent cover on the lee edge',
    timber: 'Flooded timber holes and the break between flooded and dry ground',
    rice: 'Flooded rice and shallow moist-soil units',
    marsh: 'Protected marsh pockets and cut openings in the cover',
    coastal: 'Protected bays and the lee side of points and islands',
    river: 'Protected side channels, slack water behind islands, and inside bends',
    reservoir: 'Wind-protected coves, points and shallow flats off the main lake',
    playa: 'Shallow playa basins holding fresh water',
    upland: 'Any reliable open water with shallow feeding edges'
  };

  function spreadPlan(sc) {
    var hab = sc.hab, wx = sc.wx, spId = sc.species.id;
    var base = ({ timber: 12, river: 18, pothole: 24, marsh: 22, coastal: 32, rice: 36,
                  reservoir: 26, playa: 20, upland: 20 })[hab.cls] || 22;
    if (sc.newBird > 65) base = Math.round(base * 1.35);
    if (sc.pressure > 60) base = Math.round(base * 0.68);
    if (wx.windSpd > 20) base = Math.round(base * 1.12);
    if (wx.freeze > 0.6) base = Math.round(base * 0.78);
    base = clamp(base, 6, 60);

    var lines = [];
    if (spId === 'canada-goose') {
      lines.push(Math.round(base * 0.8) + '-' + Math.round(base * 1.2) + ' full-body or shell goose decoys');
      lines.push('Break the spread into family groups of 4-7 with real gaps between them');
    } else {
      lines.push(Math.round(base * 0.8) + '-' + Math.round(base * 1.2) + ' mallards as the core of the spread');
      if (sc.mig.chron > 0.45 && hab.waterfowl > 0.4) lines.push('4-8 pintails on the outside edge for visibility');
      if (hab.cls === 'rice' || hab.cls === 'coastal') lines.push('A half dozen wigeon or gadwall along the shallow edge');
      if (hab.cls === 'reservoir' || (hab.cls === 'coastal' && wx.windSpd > 15))
        lines.push('A long line of ' + Math.round(base * 0.9) + ' diver decoys off the point if you are on big water');
      if (wx.windSpd < 8) lines.push('At least one motion decoy or jerk cord - there is no natural movement today');
      if (wx.windSpd > 18) lines.push('Skip spinning wing decoys; the water is already working for you');
    }
    return { count: base, lines: lines };
  }

  function callingPlan(sc) {
    var p = sc.pressure, nb = sc.newBird, w = sc.wx.windSpd;
    if (nb > 65 && p < 50) {
      return 'Call aggressively on distant birds. Fresh birds have not been worked yet and will respond to volume. ' +
             'Cut it to feeding chuckle once they commit.';
    }
    if (p > 62) {
      return 'Minimal calling. These birds have been worked hard. Use quiet feeding chuckle and a single soft greeting, ' +
             'and stop entirely once wings are locked.';
    }
    if (w > 20) {
      return 'More volume than usual to cut the wind on the initial call, then back off sharply as birds turn.';
    }
    return 'Moderate calling during the early movement. Read the first two groups and reduce volume if birds slide off ' +
           'or flare on the call.';
  }

  function concealPlan(sc) {
    var out = [];
    if (sc.wx.snowDepth > 0.4) out.push('Snow cover is on the ground - white cover or a snow layout is more important than anything else today');
    if (sc.hab.cls === 'timber') out.push('Stand against trunk shadow and keep faces down; movement gives you away before the blind does');
    else if (sc.hab.cls === 'rice' || sc.hab.openness > 0.6) out.push('Layout blinds mudded and stubbled with material cut on site, not carried in');
    else out.push('Build into existing bank vegetation rather than adding a new silhouette to the shoreline');
    if (sc.pressure > 60) out.push('Pressure is high here - overbuild concealment and keep the dog hidden');
    return out;
  }

  function waterfowlPlan(sc, legal, win) {
    var wx = sc.wx;
    var windFromName = env.dirName(wx.windFrom);
    var downwindName = env.dirName(wx.windFrom + 180);

    var habLine = CLS_HABITAT[sc.hab.cls] || CLS_HABITAT.upland;
    var rec = [];

    rec.push('Target ' + habLine.charAt(0).toLowerCase() + habLine.slice(1) +
      ' rather than exposed open water.');
    rec.push('Wind is out of the ' + windFromName + ' at ' + Math.round(wx.windSpd) +
      (wx.gust > wx.windSpd * 1.4 ? '-' + Math.round(wx.gust) : '') + ' mph, so the flattest water and the ' +
      'shortest fetch will be along the ' + windFromName + ' shoreline. Hunt that side.');
    rec.push('Birds will finish into the wind, so set the landing pocket 18-25 yards ' + downwindName +
      ' of the blind and keep the wind at your back or quartering over your shoulder.');

    if (sc.newBird > 60) rec.push('New birds are likely arriving. Be set and fully hidden well before legal light - ' +
      'the first flight is usually the least cautious one you will see all day.');
    if (wx.freeze > 0.55) rec.push('Freeze-up is squeezing birds onto whatever stays open. Moving water and wind-kept ' +
      'holes are worth more than habitat quality today.');
    if (sc.pressure > 62) rec.push('This is well-pressured ground. If you can reach water that takes extra effort to ' +
      'access, that is worth more than a better forecast somewhere easy.');

    return {
      headline: rec[0],
      recommendation: rec,
      setup: [
        { k: 'Habitat', v: habLine },
        { k: 'Wind', v: windFromName + ' ' + Math.round(wx.windSpd) + '-' + Math.round(wx.gust) + ' mph' },
        { k: 'Spread', v: spreadPlan(sc).lines },
        { k: 'Landing pocket', v: 'Open water 18-25 yards ' + downwindName + ' of the blind' },
        { k: 'Calling', v: callingPlan(sc) },
        { k: 'Concealment', v: concealPlan(sc) }
      ]
    };
  }

  /* ---------- Big game strategy ---------- */

  function bigGamePlan(sc, legal, win, doy) {
    if (sc.species.id === 'elk') return elkPlan(sc, legal, win);
    var wx = sc.wx, id = sc.species.id;
    var windFromName = env.dirName(wx.windFrom);
    var approachFrom = env.dirName(wx.windFrom);   // move into the wind
    var rec = [], setup = [];

    if (id === 'whitetail') {
      rec.push('Hunt the downwind edge of the thickest cover next to the best food, and get in early ' +
        'enough that the woods settle before shooting light.');
      rec.push('Wind is ' + windFromName + ' at ' + Math.round(wx.windSpd) +
        ' mph. Enter from the ' + env.dirName(wx.windFrom + 180) + ' side so your scent blows away from the bedding cover, ' +
        'and keep the stand downwind of the trail you expect to work.');
      if (wx.temp24 < -8) rec.push('Overnight temperature fell ' + Math.round(-wx.temp24) +
        ' degrees. That is the strongest daylight-movement trigger whitetails have - sit all day if you can.');
      if (sc.movement > 70) rec.push('Rut activity is high enough that bucks will be covering ground mid-morning. ' +
        'The 9 AM to noon window is worth more than it usually is.');
      if (wx.windSpd > 18) rec.push('Wind over 18 mph pins deer into the lee of ridges and thick timber. ' +
        'Move your setup to a protected bench or a creek bottom.');
      setup = [
        { k: 'Stand position', v: ['Downwind of bedding cover, on the food side',
                                   'Entry and exit routes that never cross the trail you are watching'] },
        { k: 'Wind', v: windFromName + ' ' + Math.round(wx.windSpd) + '-' + Math.round(wx.gust) + ' mph' },
        { k: 'Timing', v: sc.movement > 70 ? 'All day - the rut is doing the work'
                                           : 'First and last two hours' },
        { k: 'Calling', v: sc.movement > 70
            ? 'Light grunt and a snort-wheeze on a visible, moving buck. Do not call blind all morning.'
            : 'Minimal. Outside the rut, calling mostly educates deer.' },
        { k: 'Scent control', v: ['Treat wind direction as the only thing that matters',
                                  'Rubber boots and an entry route through water or bare ground where possible'] }
      ];
    } else if (id === 'muledeer') {
      rec.push('Glass from a high vantage at first light and let the country work for you - cover ground with ' +
        'optics before you cover it with boots.');
      rec.push('Find animals feeding in the open early, mark the bed, then plan a stalk that keeps the ' +
        windFromName + ' wind in your face and a ridge between you and the deer.');
      if (wx.cloud > 0.6) rec.push('Flat light today will cost you glassing distance. Work closer to the ' +
        'basins you intend to hunt rather than trying to glass across them.');
      if (wx.snowDepth > 0.3) rec.push('Snow on the high country. Drop to the first benches and sage below the ' +
        'timber line - deer will have moved down with it.');
      setup = [
        { k: 'Elevation band', v: Math.round(sc.hab.elev / 100) * 100 + ' ft, sage benches and rims' },
        { k: 'Glassing', v: ['First light from a high point, facing away from the sun',
                             'Grid the slope in sections rather than sweeping it'] },
        { k: 'Stalk', v: 'Approach from above with the wind in your face. Use the last hundred yards slowly.' },
        { k: 'Wind', v: windFromName + ' ' + Math.round(wx.windSpd) + ' mph' },
        { k: 'Timing', v: 'Glass at daylight, stalk mid-morning once the deer bed' }
      ];
    } else if (id === 'moose') {
      rec.push('Work willow bottoms, beaver flowages and the wet edges where moose feed, and move slowly ' +
        'enough that you can stop and listen every hundred yards.');
      rec.push('Temperature is ' + Math.round(wx.tempF) + ' degrees. ' +
        (wx.tempF > 55 ? 'That is warm for moose - expect them in shade or standing in water, and concentrate on the first and last hour.'
                       : 'Cool enough that animals should be up and feeding well into the morning.'));
      if (sc.movement > 65) rec.push('The rut is on. Raking brush and a cow call will pull a bull in, but be ' +
        'ready for him to come quietly and close.');
      setup = [
        { k: 'Habitat', v: ['Willow and alder bottoms', 'Beaver ponds and old burns with regrowth'] },
        { k: 'Wind', v: windFromName + ' ' + Math.round(wx.windSpd) + ' mph' },
        { k: 'Calling', v: sc.movement > 65
            ? 'Cow call sparingly and rake brush. Stop calling once a bull commits.'
            : 'Outside the rut, hunt quietly on feed and sign rather than calling.' },
        { k: 'Approach', v: 'Slow, with long listening stops. Moose are quiet for their size.' },
        { k: 'Recovery', v: 'Plan the pack-out before you shoot. Distance from access is the real constraint.' }
      ];
    } else {
      rec.push('Glass the open country from a rise and pick a single buck worth a stalk before you commit ' +
        'to crossing ground.');
      rec.push('Pronghorn hunt with their eyes, not their noses. Use terrain folds, fences and cuts rather ' +
        'than worrying about the ' + windFromName + ' wind, and never skyline yourself.');
      if (wx.tempF > 70) rec.push('Warm at ' + Math.round(wx.tempF) + ' degrees - water is the highest-percentage ' +
        'setup. Find the tank or spring they are using and wait it out through the middle of the day.');
      if (sc.movement > 70) rec.push('Rutting bucks are tending does and far less cautious than usual. ' +
        'A decoy can work now and will not later.');
      setup = [
        { k: 'Country', v: 'Open shortgrass and sage, ' + Math.round(sc.hab.elev / 100) * 100 + ' ft' },
        { k: 'Approach', v: ['Crawl the last stretch using every fold in the ground',
                             'Keep the sun behind you where you can'] },
        { k: 'Water', v: wx.tempF > 70 ? 'Sit a tank or spring midday - this is the percentage play today'
                                       : 'Water is less of a magnet in cool weather; hunt feeding flats instead' },
        { k: 'Wind', v: windFromName + ' ' + Math.round(wx.windSpd) + ' mph, mainly a shooting consideration' },
        { k: 'Shot', v: wx.windSpd > 18 ? 'Wind over 18 mph - close the distance rather than stretching the shot'
                                        : 'Steady conditions for a longer shot, off a bipod or pack' }
      ];
    }
    return { headline: rec[0], recommendation: rec, setup: setup };
  }

  /* ---------- Turkey strategy ---------- */

  function turkeyPlan(sc, legal, win, doy) {
    var wx = sc.wx;
    var spring = doy > 60 && doy < 175;
    var rec = [];
    rec.push(spring
      ? 'Get within a couple of hundred yards of the roost in the dark, set up against a tree wider than your ' +
        'shoulders, and let him gobble on the limb before you say anything.'
      : 'Find the flock and the feed they are using, then either ambush the travel route or scatter the flock ' +
        'and call them back together.');
    rec.push(wx.windSpd > 14
      ? 'Wind at ' + Math.round(wx.windSpd) + ' mph will cut both gobbling and your ability to hear it. ' +
        'Hunt leeward hollows and field edges where sound carries, and call louder than feels right.'
      : 'Wind is light at ' + Math.round(wx.windSpd) + ' mph, so birds should gobble well and carry a long way. ' +
        'Move and listen rather than committing to one spot too early.');
    if (wx.precip > 0.3) rec.push('Rain suppresses gobbling and pushes birds into open fields where they can see. ' +
      'Glass field edges rather than trying to call in timber.');
    if (wx.cloud < 0.3 && spring) rec.push('Clear sky at fly-down is the best gobbling condition there is. ' +
      'Be in position early - the roost gobble may be the only one you get.');

    return {
      headline: rec[0],
      recommendation: rec,
      setup: [
        { k: 'Setup', v: ['Back against a tree wider than your shoulders',
                          'Face the likely approach with shooting lanes cleared to 40 yards'] },
        { k: 'Distance', v: spring ? '100-200 yards from the roost, never directly under it'
                                   : 'On the feed or the travel route between roost and feed' },
        { k: 'Calling', v: wx.windSpd > 14
            ? 'Box call for volume into the wind, then cut to a mouth call once he commits.'
            : 'Soft tree yelps at fly-down, then go quiet. Let him look for her.' },
        { k: 'Decoys', v: sc.movement > 70 ? 'A jake and a hen will pull a dominant bird in hard'
                                           : 'A single hen, or none at all on pressured birds' },
        { k: 'Wind', v: env.dirName(wx.windFrom) + ' ' + Math.round(wx.windSpd) + ' mph' }
      ]
    };
  }

  /* ---------- Upland strategy ---------- */

  function uplandPlan(sc, legal, win) {
    var wx = sc.wx;
    var scentGood = sc.movement > 62;
    var rec = [];
    rec.push('Work cover into the ' + env.dirName(wx.windFrom) + ' wind so the dog takes scent on the approach, ' +
      'and push toward a hard edge the birds cannot run past.');
    rec.push(scentGood
      ? 'Scenting conditions are good: cool, damp air holds scent close to the ground. The dog will handle ' +
        'birds at distance today.'
      : 'Scenting conditions are poor today. Slow down, work closer, and expect bumped birds - ' +
        (wx.tempF > 60 ? 'warm dry air carries scent away' : 'wind is stripping scent off the cover') + '.');
    if (wx.snowDepth > 0.25) rec.push('Snow has birds concentrated in the heaviest cover - cattail sloughs, ' +
      'shelterbelts and plum thickets. Skip the thin grass entirely.');
    if (wx.windSpd > 18) rec.push('Heavy wind makes birds run rather than hold. Block the end of the cover ' +
      'before you walk it.');
    if (wx.tempF > 65) rec.push('Warm for dog work at ' + Math.round(wx.tempF) + ' degrees. Carry water and ' +
      'rotate dogs on short runs.');

    return {
      headline: rec[0],
      recommendation: rec,
      setup: [
        { k: 'Cover', v: ['Grass and weedy edge next to standing or harvested grain',
                          'Heavy cover on cold days, lighter edge cover when mild'] },
        { k: 'Direction', v: 'Into the ' + env.dirName(wx.windFrom) + ' wind, pushing toward a hard edge' },
        { k: 'Dog work', v: scentGood ? 'Let the dog range - scent is holding'
                                      : 'Keep the dog close and quarter tight' },
        { k: 'Blockers', v: wx.windSpd > 18 || wx.tempF > 55
            ? 'Post a blocker at the end of the field - birds will run today'
            : 'Blockers optional; birds should hold for a point' },
        { k: 'Timing', v: 'Mid-morning once the dew burns off, and the last two hours into roost cover' }
      ]
    };
  }

  /* ---------- Elk strategy ---------- */

  function elkPlan(sc, legal, win) {
    var wx = sc.wx, windFromName = env.dirName(wx.windFrom);
    var rec = [];
    rec.push('Hunt the timber-to-meadow edge in the ' + Math.round(sc.hab.elev / 100) * 100 +
      ' foot band and let the thermals, not the forecast wind, set your approach.');
    rec.push('Morning thermals pull air downhill until the sun hits the slope. Come in from above the feeding ' +
      'parks, then swing below the benches once the air starts moving up mid-morning.');
    rec.push('Prevailing wind is ' + windFromName + ' at ' + Math.round(wx.windSpd) +
      ' mph. On exposed ridgelines it overrides the thermal, so cross open ground only where that wind works for you.');
    if (wx.snowDepth > 0.3) rec.push('Snow on the high country pushes animals toward lower feed. Drop a band or two ' +
      'from where you found them last week.');
    if (sc.pressure > 55) rec.push('Pressure is high for this country. Plan on elk being in the steepest, nastiest ' +
      'timber within a mile of good feed.');
    return {
      headline: rec[0],
      recommendation: rec,
      setup: [
        { k: 'Elevation band', v: Math.round(sc.hab.elev / 100) * 100 + ' ft, timber edge and benches' },
        { k: 'Wind', v: windFromName + ' ' + Math.round(wx.windSpd) + ' mph, thermals dominant in drainages' },
        { k: 'Approach', v: ['Above the feed early, below the benches late',
                             'Glass from across the drainage before committing to a side'] },
        { k: 'Calling', v: sc.wx.seas > -0.2 && sc.movement > 60
            ? 'Locate with a bugle at first light, then go quiet and close. Cow call only to stop a moving animal.'
            : 'Outside the rut, calling does more harm than good. Hunt feed, water and travel instead.' },
        { k: 'Concealment', v: ['Stay off skylines', 'Approach with the sun behind you where terrain allows'] }
      ]
    };
  }

  /* ---------- Fly fishing strategy ---------- */

  function hatchForecast(wx, doy) {
    function win(d, a, b) { return clamp01(1 - Math.abs(d - (a + b) / 2) / ((b - a) / 2 + 12)); }
    var wt = wx.waterTemp, cloud = wx.cloud;
    var bwoSeason = Math.max(win(doy, 60, 140), win(doy, 250, 330));
    var list = [
      { n: 'Blue-winged olive', v: pref(wt, 48, 7) * (0.45 + 0.55 * cloud) * bwoSeason,
        rig: ['#18 BWO nymph', '#20 BWO emerger'], dry: '#20 parachute BWO' },
      { n: 'Midge', v: pref(wt, 42, 9) * (0.6 + 0.3 * cloud) * (0.55 + 0.45 * win(doy, 320, 420)),
        rig: ['#20 zebra midge', '#18 pheasant tail'], dry: '#22 Griffiths gnat' },
      { n: 'Caddis', v: pref(wt, 56, 6) * win(doy, 110, 180),
        rig: ['#16 caddis pupa', '#14 hares ear'], dry: '#16 elk hair caddis' },
      { n: 'Pale morning dun', v: pref(wt, 57, 5) * win(doy, 150, 225),
        rig: ['#16 PMD nymph', '#18 flashback'], dry: '#16 PMD sparkle dun' },
      { n: 'Trico', v: pref(wt, 60, 6) * win(doy, 205, 265),
        rig: ['#22 trico nymph'], dry: '#22 trico spinner' },
      { n: 'Terrestrials', v: clamp01(ramp(wx.tempF, 62, 85)) * win(doy, 190, 270) * (0.5 + 0.5 * clamp01(ramp(wx.windSpd, 6, 18))),
        rig: ['#10 hopper', '#16 beadhead dropper'], dry: '#10 foam hopper' }
    ];
    list.forEach(function (h) { h.v = clamp01(h.v); });
    list.sort(function (a, b) { return b.v - a.v; });
    return list;
  }

  function troutPlan(sc, legal, win, doy) {
    var wx = sc.wx;
    var hatches = hatchForecast(wx, doy);
    var top = hatches[0];
    var surface = Math.round(100 * clamp01(top.v * (0.5 + 0.5 * wx.cloud) * pref(wx.waterTemp, 55, 10) * 1.3));
    var streamer = Math.round(100 * clamp01(
      0.35 * clamp01(ramp(wx.flowIdx, 0.45, 0.85)) + 0.3 * clamp01(wx.cloud) +
      0.2 * clamp01(ramp(52 - wx.waterTemp, 0, 12)) + 0.25 * clamp01(ramp(doy, 250, 320))));

    var rec = [];
    rec.push('Fish the slower inside seams and the soft water below riffles - that is where fish will hold and ' +
      'feed as the water comes up to temperature.');
    if (top.v > 0.45) rec.push(top.n + ' activity should be the driver today. Expect it to build as water ' +
      'temperature reaches the ' + Math.round(wx.waterTemp) + ' degree range and peak through the middle of the day.');
    else rec.push('No hatch is strong enough to build a day around. Fish subsurface and cover water.');
    if (surface > 55) rec.push('Surface feeding is likely. Start subsurface, but have the dry rigged and switch the ' +
      'moment you see consistent noses rather than one-off rises.');
    if (streamer > 55) rec.push('Streamer conditions are good - low light and ' +
      (wx.flowIdx > 0.6 ? 'pushy water' : 'cold water') + ' favor stripping a bigger fly along the bank structure.');
    if (wx.windSpd > 16) rec.push('Wind at ' + Math.round(wx.windSpd) + ' mph will make long drifts hard. Shorten up ' +
      'and fish close with a heavier point fly.');

    return {
      headline: rec[0],
      recommendation: rec,
      hatches: hatches, surface: surface, streamer: streamer,
      setup: [
        { k: 'Water', v: Math.round(wx.waterTemp) + ' degrees F, flow index ' + wx.flowIdx.toFixed(2) +
            (sc.hab.waterCls === 'tailwater' ? ' (tailwater - buffered)' : '') },
        { k: 'Target water', v: ['Slower inside seams below riffles', 'Soft edges and current breaks, not the fast middle'] },
        { k: 'Starting rig', v: top.rig.concat(surface > 55 ? ['Switch to ' + top.dry + ' on consistent risers'] : []) },
        { k: 'Presentation', v: wx.flowIdx > 0.6
            ? 'Short, heavy, close. Add weight until you tick bottom and shorten the drift.'
            : 'Long leader and fine tippet. Low clear water means the drift matters more than the fly.' },
        { k: 'Depth', v: wx.waterTemp < 48 ? 'On the bottom - fish will not move far for a fly this cold'
                                           : 'Mid column, and higher as the hatch builds' }
      ]
    };
  }

  /* ---------- Failure modes ---------- */

  function failureModes(sc, legalRes) {
    var f = [];
    if (sc.wx.frontal > 0.5)
      f.push('The front is close to this location. If it arrives a few hours early or late the wind direction flips, ' +
             'and the side of the water you should be on flips with it. Check the actual wind before you set up.');
    if (sc.confidence < 60)
      f.push('Confidence is ' + sc.confidence + '%. Local observation coverage is thin here, so treat the score as a ' +
             'direction rather than a promise.');
    if (sc.wx.freeze > 0.5 && sc.species.group === 'waterfowl')
      f.push('If the overnight freeze runs ahead of the model, the water you planned on may be locked and the birds ' +
             'will have shifted overnight. Have a moving-water backup.');
    if (sc.pressure > 65)
      f.push('High access pressure. Other hunters arriving before you is the single most likely reason this plan fails.');
    if (sc.mig.applies && sc.mig.intensity > 70 && sc.newBird < 40)
      f.push('Strong migration conditions but weak local holding habitat - birds may pass over this area rather than ' +
             'stopping in it.');
    if (legalRes.status !== 'OPEN')
      f.push('Legal status is ' + legalRes.status + '. Nothing above is a recommendation to hunt or fish here today.');
    if (!f.length) f.push('No major failure mode identified beyond normal forecast uncertainty.');
    return f;
  }

  /* ---------- Assembly ---------- */

  function dateFor(dayIndex) {
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + Math.floor(dayIndex));
    return d;
  }

  /* `t` may be fractional. The date, the regulations and the outlook use the
     whole day; the score uses the exact time on the slider and the same
     continuous day-of-year the map uses, so the number in this panel is the
     same number drawn on the hexagon. */
  function plan(lon, lat, t, spId) {
    var date = dateFor(t);
    var doy = env.dayOfYear(date);
    var sc = models.scoreAt(lon, lat, t, env.doyFor(t), spId);
    var sp = sc.species;
    var legalRes = regs.check(lon, lat, date, spId);
    var hours = regs.legalHours(lon, lat, date, spId, legalRes.hoursRule);
    var curve = activityCurve(spId, hours.sun, sc.wx);

    var bio = peakWindow(curve, 0.70, null, null);
    var legalWin = (hours.start != null)
      ? peakWindow(curve, 0.70, hours.start, hours.end)
      : bio;

    var body;
    if (sp.group === 'waterfowl') body = waterfowlPlan(sc, legalRes, legalWin);
    else if (sp.group === 'biggame') body = bigGamePlan(sc, legalRes, legalWin, doy);
    else if (sp.group === 'turkey') body = turkeyPlan(sc, legalRes, legalWin, doy);
    else if (sp.group === 'upland') body = uplandPlan(sc, legalRes, legalWin);
    else body = troutPlan(sc, legalRes, legalWin, doy);

    return {
      place: placeLabel(lon, lat), lon: lon, lat: lat, date: date, t: t, dayIndex: Math.floor(t),
      score: sc, species: sp, legal: legalRes, hours: hours, curve: curve,
      bioWindow: bio, legalWindow: legalWin, body: body,
      failures: failureModes(sc, legalRes),
      positives: sc.pos.sort(function (a, b) { return b.s - a.s; }).slice(0, 6),
      negatives: sc.neg.sort(function (a, b) { return b.s - a.s; }).slice(0, 4)
    };
  }

  /* Seven-day outlook for a point. */
  function outlook(lon, lat, spId) {
    var out = [];
    for (var d = 0; d < 7; d++) {
      var date = dateFor(d);
      var doy = env.doyFor(d);
      var sc = models.scoreAt(lon, lat, d, doy, spId);
      var lg = regs.check(lon, lat, date, spId);
      out.push({
        day: d, date: date, opp: sc.opportunity, conf: sc.confidence,
        mig: sc.migration, newBird: sc.newBird, status: lg.status
      });
    }
    return out;
  }

  global.OG.guide = {
    plan: plan, outlook: outlook, placeLabel: placeLabel,
    activityCurve: activityCurve, peakWindow: peakWindow, dateFor: dateFor,
    hatchForecast: hatchForecast
  };
})(window);
