/* OmniGuide - Regulatory Engine (the Legal Gate).

   READ THIS BEFORE TRUSTING ANYTHING THIS FILE RETURNS.

   The brief is explicit: regulations are high-consequence information, current
   rules must come from authoritative state and federal sources, and the system
   must never guess. This build ships the ENGINE, not a verified ruleset.

   What is real here:
     - the record schema (agency, source, effective date, retrieval date,
       geographic scope, species, season type, verification status)
     - zone resolution that can split a state geographically
     - the OPEN / CLOSED / LIMITED / PERMIT REQUIRED / UNKNOWN state machine
     - the hard gate that sits in front of every recommendation
     - legal shooting hours computed from real solar geometry

   What is NOT real here:
     - the dates. Every window below is a placeholder shaped like a typical
       federal-framework season and is tagged verification:'unverified-sample'.
       The UI renders that tag on every surface. States with no placeholder
       deliberately return UNKNOWN so the "do not guess" path is visible.

   Production swaps RULES for records ingested from state proclamations and the
   USFWS migratory bird frameworks, each carrying its own source URL and
   retrieval timestamp. Nothing above this file changes. */
(function (global) {
  'use strict';

  var geo = global.OG.geo, env = global.OG.env;

  var FEDERAL = 'U.S. Fish and Wildlife Service - migratory bird framework';

  /* Agency names for the focus states. Everything else falls back to a generic
     label rather than inventing an official-sounding name. */
  var AGENCY = {
    MT: 'Montana Fish, Wildlife and Parks',
    ND: 'North Dakota Game and Fish Department',
    SD: 'South Dakota Game, Fish and Parks',
    MN: 'Minnesota Department of Natural Resources',
    AR: 'Arkansas Game and Fish Commission',
    LA: 'Louisiana Department of Wildlife and Fisheries',
    TX: 'Texas Parks and Wildlife Department',
    CA: 'California Department of Fish and Wildlife',
    MO: 'Missouri Department of Conservation',
    KS: 'Kansas Department of Wildlife and Parks',
    NE: 'Nebraska Game and Parks Commission',
    CO: 'Colorado Parks and Wildlife',
    WY: 'Wyoming Game and Fish Department',
    ID: 'Idaho Department of Fish and Game',
    WI: 'Wisconsin Department of Natural Resources'
  };

  function agencyFor(abbr, stateName) {
    return AGENCY[abbr] || (stateName + ' state wildlife agency');
  }

  /* ---------- Zones ---------- */

  /* A state is not one legal unit. These sample splits exist to prove the
     engine resolves sub-state geography before it answers. */
  var ZONES = {
    MT: [
      { id: 'MT-PAC', name: 'Pacific Flyway portion (west of the Continental Divide)',
        test: function (lon, lat) { return lon < -112.5 + (lat - 45) * 0.25; } },
      { id: 'MT-CEN', name: 'Central Flyway portion', test: function () { return true; } }
    ],
    ND: [
      { id: 'ND-HP', name: 'High Plains unit (west of US-281)', test: function (lon) { return lon < -98.5; } },
      { id: 'ND-LP', name: 'Low Plains unit', test: function () { return true; } }
    ],
    TX: [
      { id: 'TX-HP', name: 'High Plains Mallard Management Unit', test: function (lon) { return lon < -100.5; } },
      { id: 'TX-SZ', name: 'South Zone', test: function (lon, lat) { return lat < 29.3; } },
      { id: 'TX-NZ', name: 'North Zone', test: function () { return true; } }
    ],
    CA: [
      { id: 'CA-NE', name: 'Northeastern Zone', test: function (lon, lat) { return lat > 40.3 && lon > -122.3; } },
      { id: 'CA-BV', name: 'Balance of State', test: function () { return true; } }
    ]
  };

  function zoneFor(abbr, lon, lat) {
    var list = ZONES[abbr];
    if (!list) return { id: abbr + '-ALL', name: 'Statewide' };
    for (var i = 0; i < list.length; i++) if (list[i].test(lon, lat)) return list[i];
    return { id: abbr + '-ALL', name: 'Statewide' };
  }

  /* ---------- Placeholder rules ---------- */

  var NORTH = ['ND', 'SD', 'MN', 'MT', 'WI', 'MI', 'IA', 'NE', 'WY', 'ID', 'ME', 'VT', 'NH', 'NY'];
  var MID = ['KS', 'MO', 'IL', 'IN', 'OH', 'CO', 'UT', 'NV', 'OR', 'WA', 'PA', 'NJ', 'MD', 'DE', 'WV', 'KY', 'MA', 'CT', 'RI', 'CA'];
  var SOUTH = ['TX', 'LA', 'AR', 'MS', 'AL', 'TN', 'OK', 'NM', 'AZ', 'GA', 'FL', 'SC', 'NC', 'VA'];

  var DUCKS = ['ducks'];

  function rule(o) {
    o.verification = 'unverified-sample';
    o.effective = null;
    o.retrieved = null;
    o.url = null;
    return o;
  }

  var RULES = [
    /* These are OUTER ENVELOPES, not season dates: the earliest opening and
       latest closing the federal framework allows in that part of the
       country. Real seasons sit inside them, usually with splits, and vary
       by zone. The envelope is the honest shape for a placeholder - it errs
       toward showing a week as possibly open rather than wrongly closed. */
    rule({ states: NORTH, species: DUCKS, type: 'Regular duck season',
      start: '09-24', end: '01-10', status: 'OPEN',
      bag: '6 ducks daily, species and sex restrictions apply',
      possession: '3 times the daily bag', hours: 'waterfowl',
      note: 'Framework envelope, not an actual season. Northern states commonly run ' +
            '60 to 107 days inside this range, usually split, and zoned.',
      source: FEDERAL }),
    rule({ states: MID, species: DUCKS, type: 'Regular duck season',
      start: '10-01', end: '01-25', status: 'OPEN',
      bag: '6 ducks daily, species and sex restrictions apply',
      possession: '3 times the daily bag', hours: 'waterfowl',
      note: 'Framework envelope, not an actual season. Expect splits and zone differences.',
      source: FEDERAL }),
    rule({ states: SOUTH, species: DUCKS, type: 'Regular duck season',
      start: '10-25', end: '01-31', status: 'OPEN',
      bag: '6 ducks daily, species and sex restrictions apply',
      possession: '3 times the daily bag', hours: 'waterfowl',
      note: 'Framework envelope, not an actual season. Southern states typically open late ' +
            'and run to the end of January.',
      source: FEDERAL }),

    rule({ states: NORTH.concat(MID, SOUTH), species: ['canada-goose'], type: 'Early Canada goose season',
      start: '09-01', end: '09-15', status: 'OPEN',
      bag: 'Liberal early-season bag, varies by state',
      possession: '3 times the daily bag', hours: 'waterfowl', source: FEDERAL }),
    rule({ states: NORTH, species: ['canada-goose'], type: 'Regular Canada goose season',
      start: '09-24', end: '01-10', status: 'OPEN',
      bag: '3 dark geese daily, varies by zone',
      possession: '3 times the daily bag', hours: 'waterfowl', source: FEDERAL }),
    rule({ states: MID.concat(SOUTH), species: ['canada-goose'], type: 'Regular Canada goose season',
      start: '10-01', end: '02-15', status: 'OPEN',
      bag: '3 dark geese daily, varies by zone',
      possession: '3 times the daily bag', hours: 'waterfowl', source: FEDERAL }),

    rule({ states: NORTH.concat(MID, SOUTH), species: DUCKS, type: 'September teal season',
      start: '09-01', end: '09-30', status: 'LIMITED',
      bag: '6 teal daily - blue-winged, green-winged and cinnamon only',
      possession: '3 times the daily bag', hours: 'teal',
      note: 'Teal-only season: no other duck species is legal. Shooting hours are commonly restricted ' +
            'to sunrise rather than the usual half hour before.',
      source: FEDERAL }),

    rule({ states: ['MT', 'WY', 'CO', 'ID', 'UT', 'NM', 'AZ', 'OR', 'WA', 'NV'], species: ['elk'],
      type: 'Archery elk season', start: '09-01', end: '09-30', status: 'PERMIT',
      bag: 'One elk, license and unit-specific permit required',
      note: 'Most western elk hunting is unit-by-unit and frequently draw-only. Unit boundaries are not modeled in this build.',
      hours: 'daylight', source: 'State wildlife agency' }),
    rule({ states: ['MT', 'WY', 'CO', 'ID', 'UT', 'NM', 'AZ', 'OR', 'WA', 'NV'], species: ['elk'],
      type: 'General rifle elk season', start: '10-20', end: '11-25', status: 'PERMIT',
      bag: 'One elk, license and unit-specific permit required',
      hours: 'daylight', source: 'State wildlife agency' }),

    rule({ states: NORTH.concat(MID, SOUTH), species: ['whitetail'], type: 'Archery deer season',
      start: '09-15', end: '11-05', status: 'LIMITED',
      bag: 'Varies widely by state, unit and sex. Antler restrictions common.',
      note: 'Deer seasons are among the most unit-specific regulations there are. Nothing here is unit-aware.',
      hours: 'daylight', source: 'State wildlife agency' }),
    rule({ states: NORTH.concat(MID, SOUTH), species: ['whitetail'], type: 'Firearms deer season',
      start: '11-10', end: '12-10', status: 'LIMITED',
      bag: 'Varies widely by state, unit and sex',
      hours: 'daylight', source: 'State wildlife agency' }),

    rule({ states: ['MT', 'WY', 'CO', 'ID', 'UT', 'NM', 'AZ', 'OR', 'WA', 'NV', 'CA', 'ND', 'SD', 'NE', 'KS', 'TX'],
      species: ['muledeer'], type: 'General and limited-entry mule deer seasons',
      start: '09-01', end: '11-30', status: 'PERMIT',
      bag: 'One deer, unit-specific tag. Many units are draw-only.',
      note: 'Mule deer tags are allocated by unit and frequently by draw. Unit boundaries are not modeled.',
      hours: 'daylight', source: 'State wildlife agency' }),

    rule({ states: ['ME', 'NH', 'VT', 'NY', 'MN', 'WI', 'MI', 'MT', 'ID', 'WY', 'CO', 'UT', 'WA'],
      species: ['moose'], type: 'Moose season', start: '09-15', end: '11-15', status: 'PERMIT',
      bag: 'One moose. Once-in-a-lifetime or long-odds draw in most states.',
      note: 'Moose permits are almost universally draw-only and often once in a lifetime.',
      hours: 'daylight', source: 'State wildlife agency' }),

    rule({ states: ['WY', 'MT', 'CO', 'NM', 'NV', 'UT', 'ID', 'OR', 'AZ', 'SD', 'ND', 'NE', 'KS', 'TX'],
      species: ['pronghorn'], type: 'Pronghorn season', start: '08-15', end: '10-31', status: 'PERMIT',
      bag: 'One pronghorn, unit-specific tag, usually by draw',
      hours: 'daylight', source: 'State wildlife agency' }),

    rule({ states: NORTH.concat(MID, SOUTH), species: ['turkey'], type: 'Spring turkey season',
      start: '04-01', end: '05-20', status: 'LIMITED',
      bag: 'Bearded birds only in spring. Bag varies by state.',
      note: 'Spring seasons are usually bearded-bird-only and often zoned with staggered opening dates.',
      hours: 'turkey', source: 'State wildlife agency' }),
    rule({ states: NORTH.concat(MID, SOUTH), species: ['turkey'], type: 'Fall turkey season',
      start: '10-01', end: '11-30', status: 'LIMITED',
      bag: 'Either sex in most fall seasons, where a fall season exists at all',
      hours: 'daylight', source: 'State wildlife agency' }),

    rule({ states: NORTH.concat(MID, SOUTH), species: ['upland'], type: 'Upland game bird season',
      start: '10-01', end: '01-31', status: 'LIMITED',
      bag: 'Differs by bird: pheasant, quail and grouse each carry their own limit',
      note: 'This single record stands in for several species with different seasons and limits. ' +
            'Pheasant, quail, and the grouse species are regulated separately.',
      hours: 'daylight', source: 'State wildlife agency' }),

    rule({ states: ['MT', 'WY', 'CO', 'UT', 'NM', 'AR', 'MO', 'PA', 'NY', 'MI', 'WI', 'MN', 'ID', 'OR', 'CA', 'TN', 'NC', 'VA', 'WV'],
      species: ['trout'], type: 'General trout season', start: '01-01', end: '12-31', status: 'LIMITED',
      bag: 'Varies by reach - many waters are catch-and-release or artificial-only',
      note: 'Trout regulations change between individual river sections. Reach-level rules are not modeled in this build.',
      hours: 'none', source: 'State wildlife agency' })
  ];

  /* Special management areas. A handful of real refuges, included to exercise
     the warning path - the restrictions themselves are not modeled. */
  var SPECIAL = [
    { n: 'Loess Bluffs National Wildlife Refuge', lon: -95.24, lat: 40.08, r: 0.14 },
    { n: 'Sand Lake National Wildlife Refuge', lon: -98.09, lat: 45.71, r: 0.16 },
    { n: 'Bosque del Apache National Wildlife Refuge', lon: -106.87, lat: 33.80, r: 0.16 },
    { n: 'Horicon National Wildlife Refuge', lon: -88.63, lat: 43.52, r: 0.14 },
    { n: 'Bear River Migratory Bird Refuge', lon: -112.33, lat: 41.44, r: 0.20 },
    { n: 'Sacramento National Wildlife Refuge', lon: -122.17, lat: 39.44, r: 0.14 },
    { n: 'Squaw Creek and Missouri River bottoms', lon: -95.21, lat: 39.98, r: 0.12 },
    { n: 'Chincoteague National Wildlife Refuge', lon: -75.38, lat: 37.90, r: 0.12 },
    { n: 'Malheur National Wildlife Refuge', lon: -118.88, lat: 43.26, r: 0.22 },
    { n: 'Lacreek National Wildlife Refuge', lon: -101.60, lat: 43.10, r: 0.13 }
  ];

  function specialAreaAt(lon, lat) {
    for (var i = 0; i < SPECIAL.length; i++) {
      var s = SPECIAL[i];
      var dx = (lon - s.lon) * 0.75, dy = lat - s.lat;
      if (dx * dx + dy * dy < s.r * s.r) return s;
    }
    return null;
  }

  /* ---------- Date windows ---------- */

  function md(date) { return (date.getMonth() + 1) * 100 + date.getDate(); }
  function parseMD(s) { return parseInt(s.slice(0, 2), 10) * 100 + parseInt(s.slice(3), 10); }

  function inWindow(date, start, end) {
    var v = md(date), a = parseMD(start), b = parseMD(end);
    return a <= b ? (v >= a && v <= b) : (v >= a || v <= b);
  }

  /* Does any season record exist at all for this species in this state?
     No record means the species is not a hunted resource there, which is a
     different statement from "the season is closed today" and the map must
     not render it as a weak opportunity. */
  var occursCache = {};
  function hasSeasonRecord(abbr, spId) {
    var k = abbr + ':' + spId;
    if (k in occursCache) return occursCache[k];
    var found = false;
    for (var i = 0; i < RULES.length && !found; i++) {
      if (RULES[i].species.indexOf(spId) >= 0 && RULES[i].states.indexOf(abbr) >= 0) found = true;
    }
    occursCache[k] = found;
    return found;
  }

  /* ---------- The gate ---------- */

  var ORDER = { OPEN: 4, LIMITED: 3, PERMIT: 2, CLOSED: 1, UNKNOWN: 0 };

  function check(lon, lat, date, spId) {
    var si = geo.stateIndexAt(lon, lat);
    if (si < 0) {
      return { status: 'UNKNOWN', state: null, reason: 'Outside the modeled region.',
        verified: false, rules: [], zone: null };
    }
    var st = geo.states[si];
    var zone = zoneFor(st.abbr, lon, lat);
    var matched = [], best = null, anyForSpecies = false;

    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      if (r.species.indexOf(spId) < 0) continue;
      if (r.states.indexOf(st.abbr) < 0) continue;
      anyForSpecies = true;
      var open = inWindow(date, r.start, r.end);
      var entry = { rule: r, active: open, status: open ? r.status : 'CLOSED' };
      matched.push(entry);
      if (!best || ORDER[entry.status] > ORDER[best.status]) best = entry;
    }

    var special = specialAreaAt(lon, lat);
    var status, reason;

    if (!anyForSpecies) {
      status = 'UNKNOWN';
      reason = 'No regulation record for ' + st.name + ' and this species. OmniGuide will not guess a season.';
    } else {
      status = best.status;
      reason = best.active
        ? best.rule.type + ' is within its placeholder window.'
        : 'No placeholder season window covers this date.';
    }
    if (status === 'OPEN' && special) {
      status = 'LIMITED';
      reason = 'Inside ' + special.n + '. Refuge and special-area rules are not modeled - check the area regulations directly.';
    }

    return {
      status: status, reason: reason, state: st, zone: zone, special: special,
      rules: matched, verified: false,
      agency: agencyFor(st.abbr, st.name),
      source: best ? best.rule.source : null,
      bag: best && best.active ? best.rule.bag : null,
      possession: best && best.active ? best.rule.possession : null,
      note: best && best.active ? best.rule.note : null,
      hoursRule: best ? best.rule.hours : 'unknown',
      typeName: best ? best.rule.type : null
    };
  }

  /* Legal shooting hours. The solar geometry is exact; the half-hour framework
     offset is the common federal waterfowl convention and states narrow it. */
  function legalHours(lon, lat, date, spId, hoursRule) {
    var s = env.sun(lat, lon, date);
    if (s.sunrise == null) return { start: null, end: null, sun: s, label: 'Not computable at this latitude' };
    if (hoursRule === 'none') return { start: null, end: null, sun: s, label: 'No daily time restriction modeled' };
    /* No rule on file means no claim about legal hours either. */
    if (hoursRule === 'unknown') return { start: null, end: null, sun: s,
      label: 'Shooting hours unknown - verify with the issuing agency' };
    if (hoursRule === 'teal') return { start: s.sunrise, end: s.sunset, sun: s, label: 'Sunrise to sunset' };
    if (hoursRule === 'daylight') return { start: s.sunrise - 30, end: s.sunset + 30, sun: s, label: 'Half hour before sunrise to half hour after sunset' };
    /* Many states close spring turkey hunting at midday; some run all day. */
    if (hoursRule === 'turkey') return { start: s.sunrise - 30, end: s.sunset, sun: s,
      label: 'Half hour before sunrise to sunset - several states close at 1 PM in spring' };
    return { start: s.shootStart, end: s.shootEnd, sun: s, label: 'Half hour before sunrise to sunset' };
  }

  global.OG.regs = {
    check: check, legalHours: legalHours, zoneFor: zoneFor, hasSeasonRecord: hasSeasonRecord,
    specialAreaAt: specialAreaAt, RULES: RULES, SPECIAL: SPECIAL,
    DISCLAIMER: 'Season information in OmniGuide is an unverified convenience reference, not legal ' +
      'advice and not authorization to hunt or fish. Records may be wrong, out of date, or missing ' +
      'entirely, and they do not reflect zone boundaries, unit rules, refuge closures, emergency ' +
      'orders or land access. You are solely responsible for confirming every season date, zone, ' +
      'unit, bag limit, tag requirement and shooting hour with the issuing state or federal agency ' +
      'before you go afield.',
    SHORT: 'Unverified reference only. Confirm with the issuing agency before you hunt or fish.'
  };
})(window);
