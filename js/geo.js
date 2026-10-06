/* OmniGuide - Geography layer.
   Decodes the embedded TopoJSON (states + counties), projects with Albers
   conic equal-area, rasterizes state boundaries for O(1) point lookup, and
   generates the multi-resolution hex lattice the Opportunity grid is scored on.

   Screen space runs y-down, so project() flips the projection's y axis. */
(function (global) {
  'use strict';

  var D2R = Math.PI / 180;

  var META = {
    '01': ['AL', 'Alabama'], '04': ['AZ', 'Arizona'], '05': ['AR', 'Arkansas'],
    '06': ['CA', 'California'], '08': ['CO', 'Colorado'], '09': ['CT', 'Connecticut'],
    '10': ['DE', 'Delaware'], '11': ['DC', 'District of Columbia'], '12': ['FL', 'Florida'],
    '13': ['GA', 'Georgia'], '16': ['ID', 'Idaho'], '17': ['IL', 'Illinois'],
    '18': ['IN', 'Indiana'], '19': ['IA', 'Iowa'], '20': ['KS', 'Kansas'],
    '21': ['KY', 'Kentucky'], '22': ['LA', 'Louisiana'], '23': ['ME', 'Maine'],
    '24': ['MD', 'Maryland'], '25': ['MA', 'Massachusetts'], '26': ['MI', 'Michigan'],
    '27': ['MN', 'Minnesota'], '28': ['MS', 'Mississippi'], '29': ['MO', 'Missouri'],
    '30': ['MT', 'Montana'], '31': ['NE', 'Nebraska'], '32': ['NV', 'Nevada'],
    '33': ['NH', 'New Hampshire'], '34': ['NJ', 'New Jersey'], '35': ['NM', 'New Mexico'],
    '36': ['NY', 'New York'], '37': ['NC', 'North Carolina'], '38': ['ND', 'North Dakota'],
    '39': ['OH', 'Ohio'], '40': ['OK', 'Oklahoma'], '41': ['OR', 'Oregon'],
    '42': ['PA', 'Pennsylvania'], '44': ['RI', 'Rhode Island'], '45': ['SC', 'South Carolina'],
    '46': ['SD', 'South Dakota'], '47': ['TN', 'Tennessee'], '48': ['TX', 'Texas'],
    '49': ['UT', 'Utah'], '50': ['VT', 'Vermont'], '51': ['VA', 'Virginia'],
    '53': ['WA', 'Washington'], '54': ['WV', 'West Virginia'], '55': ['WI', 'Wisconsin'],
    '56': ['WY', 'Wyoming']
  };

  /* ---------- TopoJSON ---------- */

  function decodeArcs(topo) {
    var t = topo.transform, sx = t.scale[0], sy = t.scale[1],
        tx = t.translate[0], ty = t.translate[1];
    var out = new Array(topo.arcs.length);
    for (var a = 0; a < topo.arcs.length; a++) {
      var src = topo.arcs[a], n = src.length, buf = new Float64Array(n * 2), x = 0, y = 0;
      for (var i = 0; i < n; i++) {
        x += src[i][0]; y += src[i][1];
        buf[i * 2] = x * sx + tx; buf[i * 2 + 1] = y * sy + ty;
      }
      out[a] = buf;
    }
    return out;
  }

  function stitch(arcIdx, arcs) {
    var pts = [];
    for (var k = 0; k < arcIdx.length; k++) {
      var ai = arcIdx[k], rev = ai < 0, arr = arcs[rev ? ~ai : ai], n = arr.length / 2, i;
      if (rev) { for (i = n - 1; i >= 0; i--) pts.push(arr[i * 2], arr[i * 2 + 1]); }
      else { for (i = 0; i < n; i++) pts.push(arr[i * 2], arr[i * 2 + 1]); }
    }
    return Float64Array.from(pts);
  }

  function ringsOf(geom, arcs) {
    var rings = [];
    if (geom.type === 'Polygon') {
      for (var a = 0; a < geom.arcs.length; a++) rings.push(stitch(geom.arcs[a], arcs));
    } else if (geom.type === 'MultiPolygon') {
      for (var p = 0; p < geom.arcs.length; p++)
        for (var r = 0; r < geom.arcs[p].length; r++) rings.push(stitch(geom.arcs[p][r], arcs));
    }
    return rings;
  }

  /* ---------- Spherical Mercator ----------

     This used to be Albers conic equal-area, which is the better projection
     for a national thematic map: it keeps cell areas comparable so a hexagon
     in Montana means the same as one in Texas.

     It was swapped for Web Mercator because every raster tile service on
     earth publishes in Web Mercator, and a hillshade or satellite basemap
     that does not line up with the geometry drawn over it is worthless. The
     cost is that area is exaggerated toward the north. That mattered when
     the map drew discrete equal-area cells; it matters much less now that
     the field is rendered as a smooth continuous surface, and every score is
     computed in lon/lat regardless of how it is drawn.

     World space is the full Mercator square, 0..WORLD on both axes, so tile
     maths is just WORLD / 2^z. */

  var WORLD = 1000;
  var MAXLAT = 85.0511;

  function project(lon, lat, out) {
    out[0] = (lon + 180) / 360 * WORLD;
    var la = lat > MAXLAT ? MAXLAT : lat < -MAXLAT ? -MAXLAT : lat;
    var s = Math.sin(la * D2R);
    out[1] = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD;
    return out;
  }

  function unproject(wx, wy, out) {
    out[0] = wx / WORLD * 360 - 180;
    var n = Math.PI - 2 * Math.PI * wy / WORLD;
    out[1] = Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))) / D2R;
    return out;
  }

  /* ---------- Build ---------- */

  var topo = global.US_TOPO;
  var arcs = decodeArcs(topo);
  var states = [], counties = [];
  var byFips = {};

  var sg = topo.objects.states.geometries;
  for (var g = 0; g < sg.length; g++) {
    var m = META[sg[g].id];
    if (!m) continue;      // territories, Alaska and Hawaii sit outside the CONUS grid
    var st = { fips: sg[g].id, abbr: m[0], name: m[1], rings: ringsOf(sg[g], arcs), world: null, label: null };
    states.push(st);
    byFips[st.fips] = st;
  }
  states.sort(function (a, b) { return a.name < b.name ? -1 : 1; });

  var cg = topo.objects.counties.geometries;
  for (var c = 0; c < cg.length; c++) {
    var pf = cg[c].id.slice(0, 2);
    if (!META[pf]) continue;
    counties.push({
      fips: cg[c].id, name: cg[c].properties.name,
      stateAbbr: META[pf][0], stateName: META[pf][1],
      rings: ringsOf(cg[c], arcs), world: null, bbox: null, c: null
    });
  }

  var tmp = [0, 0];
  var s, i2, ring, j;
  var WORLD_W = WORLD, WORLD_H = WORLD;

  /* Area-weighted centroid of a ring, used to place labels inside the shape. */
  function ringCentroid(r) {
    var a = 0, cx = 0, cy = 0, n = r.length / 2;
    for (var i = 0; i < n; i++) {
      var k = (i + 1) % n;
      var x0 = r[i * 2], y0 = r[i * 2 + 1], x1 = r[k * 2], y1 = r[k * 2 + 1];
      var f = x0 * y1 - x1 * y0;
      a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
    }
    if (Math.abs(a) < 1e-12) return [r[0], r[1]];
    return [cx / (3 * a), cy / (3 * a)];
  }

  function largestRing(rings) {
    var best = rings[0], bl = 0;
    for (var i = 0; i < rings.length; i++) if (rings[i].length > bl) { bl = rings[i].length; best = rings[i]; }
    return best;
  }

  function projectRings(obj) {
    var wr = [];
    for (var i = 0; i < obj.rings.length; i++) {
      var r = obj.rings[i], buf = new Float32Array(r.length);
      for (var k = 0; k < r.length; k += 2) {
        project(r[k], r[k + 1], tmp);
        buf[k] = tmp[0]; buf[k + 1] = tmp[1];
      }
      wr.push(buf);
    }
    obj.world = wr;
  }

  for (s = 0; s < states.length; s++) {
    projectRings(states[s]);
    states[s].label = ringCentroid(largestRing(states[s].world));
  }

  for (var ci = 0; ci < counties.length; ci++) {
    var co = counties[ci];
    projectRings(co);
    co.label = ringCentroid(largestRing(co.world));
    var lo0 = 999, la0 = 999, lo1 = -999, la1 = -999;
    for (var ri = 0; ri < co.rings.length; ri++) {
      var rr = co.rings[ri];
      for (var kk = 0; kk < rr.length; kk += 2) {
        if (rr[kk] < lo0) lo0 = rr[kk];
        if (rr[kk] > lo1) lo1 = rr[kk];
        if (rr[kk + 1] < la0) la0 = rr[kk + 1];
        if (rr[kk + 1] > la1) la1 = rr[kk + 1];
      }
    }
    co.bbox = [lo0, la0, lo1, la1];
  }

  function pointInRings(rings, lon, lat) {
    var inside = false;
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i], n = r.length / 2;
      for (var a = 0, b = n - 1; a < n; b = a++) {
        var xa = r[a * 2], ya = r[a * 2 + 1], xb = r[b * 2], yb = r[b * 2 + 1];
        if ((ya > lat) !== (yb > lat) && lon < (xb - xa) * (lat - ya) / (yb - ya) + xa) inside = !inside;
      }
    }
    return inside;
  }

  function countyAt(lon, lat) {
    for (var i = 0; i < counties.length; i++) {
      var b = counties[i].bbox;
      if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
      if (pointInRings(counties[i].rings, lon, lat)) return counties[i];
    }
    return null;
  }

  /* ---------- State raster: lon/lat to state index in constant time ---------- */

  var MLON0 = -125.2, MLAT0 = 24.2, MLON1 = -66.8, MLAT1 = 49.6, MSTEP = 0.07;
  var MCOLS = Math.ceil((MLON1 - MLON0) / MSTEP), MROWS = Math.ceil((MLAT1 - MLAT0) / MSTEP);
  var mask = new Uint8Array(MCOLS * MROWS);

  (function rasterize() {
    var byX = function (a, b) { return a - b; };
    for (var si = 0; si < states.length; si++) {
      var buckets = new Array(MROWS), rs = states[si].rings, any = false;
      for (var ri = 0; ri < rs.length; ri++) {
        var rg = rs[ri], np = rg.length / 2;
        for (var k = 0; k < np; k++) {
          var ax = rg[k * 2], ay = rg[k * 2 + 1];
          var nk = (k + 1) % np, bx = rg[nk * 2], by = rg[nk * 2 + 1];
          if (ay === by) continue;
          var ylo = Math.min(ay, by), yhi = Math.max(ay, by);
          var rowA = Math.ceil((ylo - MLAT0) / MSTEP - 0.5);
          var rowB = Math.floor((yhi - MLAT0) / MSTEP - 0.5);
          if (rowB < 0 || rowA >= MROWS) continue;
          if (rowA < 0) rowA = 0;
          if (rowB >= MROWS) rowB = MROWS - 1;
          for (var rw = rowA; rw <= rowB; rw++) {
            var yc = MLAT0 + (rw + 0.5) * MSTEP;
            if (yc < ylo || yc >= yhi) continue;
            (buckets[rw] || (buckets[rw] = [])).push(ax + (yc - ay) / (by - ay) * (bx - ax));
            any = true;
          }
        }
      }
      if (!any) continue;
      for (var rw2 = 0; rw2 < MROWS; rw2++) {
        var xs = buckets[rw2];
        if (!xs || xs.length < 2) continue;
        xs.sort(byX);
        for (var p = 0; p + 1 < xs.length; p += 2) {
          var colA = Math.ceil((xs[p] - MLON0) / MSTEP - 0.5);
          var colB = Math.floor((xs[p + 1] - MLON0) / MSTEP - 0.5);
          if (colB < 0 || colA >= MCOLS) continue;
          if (colA < 0) colA = 0;
          if (colB >= MCOLS) colB = MCOLS - 1;
          var base = rw2 * MCOLS;
          for (var cc = colA; cc <= colB; cc++) mask[base + cc] = si + 1;
        }
      }
    }
  })();

  function stateIndexAt(lon, lat) {
    var c = Math.floor((lon - MLON0) / MSTEP), r = Math.floor((lat - MLAT0) / MSTEP);
    if (c < 0 || r < 0 || c >= MCOLS || r >= MROWS) return -1;
    return mask[r * MCOLS + c] - 1;
  }

  /* ---------- Hex lattice: H3-style multi-resolution cells ---------- */

  var RES = [0.80, 0.46, 0.27, 0.16];     // circumradius in degrees of latitude
  var LAT_ORIGIN = 23.0, LON_ORIGIN = -126.5;

  function rowLat(res, j) { return LAT_ORIGIN + j * 1.5 * RES[res]; }
  function lonStep(res, lat) { return Math.sqrt(3) * RES[res] / Math.max(0.35, Math.cos(lat * D2R)); }

  function forEachCell(res, lonMin, latMin, lonMax, latMax, cb) {
    var R = RES[res];
    var j0 = Math.floor((latMin - LAT_ORIGIN) / (1.5 * R)) - 1;
    var j1 = Math.ceil((latMax - LAT_ORIGIN) / (1.5 * R)) + 1;
    if (j0 < 0) j0 = 0;
    for (var j = j0; j <= j1; j++) {
      var lat = rowLat(res, j);
      if (lat < 19 || lat > 72) continue;
      var st2 = lonStep(res, lat), off = (j & 1 ? 0.5 : 0);
      var i0 = Math.floor((lonMin - LON_ORIGIN) / st2 - off) - 1;
      var i1 = Math.ceil((lonMax - LON_ORIGIN) / st2 - off) + 1;
      for (var i = i0; i <= i1; i++) cb(LON_ORIGIN + (i + off) * st2, lat, j, i);
    }
  }

  function cellIndexAt(res, lon, lat) {
    var R = RES[res];
    var j = Math.round((lat - LAT_ORIGIN) / (1.5 * R));
    var la = rowLat(res, j), st2 = lonStep(res, la), off = (j & 1 ? 0.5 : 0);
    return [j, Math.round((lon - LON_ORIGIN) / st2 - off)];
  }

  function cellCenter(res, j, i) {
    var lat = rowLat(res, j), st2 = lonStep(res, lat), off = (j & 1 ? 0.5 : 0);
    return [LON_ORIGIN + (i + off) * st2, lat];
  }

  /* cellIndexAt rounds on a rectangle, which can land on the wrong hexagon
     near a shared edge. For anything the user clicks, test the neighbourhood
     and take the genuinely nearest centre so the panel and the hexagon under
     the cursor are always the same cell. */
  function nearestCell(res, lon, lat) {
    var base = cellIndexAt(res, lon, lat);
    var best = null, bd = Infinity;
    for (var dj = -1; dj <= 1; dj++) {
      var j = base[0] + dj;
      if (j < 0) continue;
      var la = rowLat(res, j), st2 = lonStep(res, la), off = (j & 1 ? 0.5 : 0);
      var i0 = Math.round((lon - LON_ORIGIN) / st2 - off);
      for (var di = -1; di <= 1; di++) {
        var i = i0 + di;
        var clon = LON_ORIGIN + (i + off) * st2;
        var dx = (clon - lon) * Math.cos(lat * D2R), dy = la - lat;
        var d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = [j, i, clon, la]; }
      }
    }
    return best;
  }

  var HEXC = [], HEXS = [];
  for (var h = 0; h < 6; h++) { HEXC.push(Math.cos(h * Math.PI / 3)); HEXS.push(Math.sin(h * Math.PI / 3)); }

  function hexWorld(res, lon, lat, out) {
    var R = RES[res], inv = 1 / Math.max(0.35, Math.cos(lat * D2R));
    for (var k = 0; k < 6; k++) {
      project(lon + R * HEXS[k] * inv, lat + R * HEXC[k], tmp);
      out[k * 2] = tmp[0]; out[k * 2 + 1] = tmp[1];
    }
    return out;
  }

  /* ---------- Flyways ---------- */

  function flyway(lon) {
    if (lon < -114) return 'pacific';
    if (lon < -97) return 'central';
    if (lon < -84.5) return 'mississippi';
    return 'atlantic';
  }
  var UPFLYWAY = { pacific: 352, central: 340, mississippi: 330, atlantic: 318 };

  /* ---------- Cities, ranked so labels thin out sensibly ---------- */

  var MAJOR = ('New York City|NY,Los Angeles|CA,Chicago|IL,Houston|TX,Phoenix|AZ,Philadelphia|PA,' +
    'San Antonio|TX,San Diego|CA,Dallas|TX,Austin|TX,Jacksonville|FL,Fort Worth|TX,Columbus|OH,' +
    'Charlotte|NC,Indianapolis|IN,San Francisco|CA,Seattle|WA,Denver|CO,Washington|DC,Boston|MA,' +
    'Nashville|TN,Detroit|MI,Portland|OR,Memphis|TN,Louisville|KY,Milwaukee|WI,Baltimore|MD,' +
    'Albuquerque|NM,Tucson|AZ,Fresno|CA,Sacramento|CA,Kansas City|MO,Atlanta|GA,Omaha|NE,' +
    'Colorado Springs|CO,Raleigh|NC,Virginia Beach|VA,Miami|FL,Oakland|CA,Minneapolis|MN,' +
    'Tulsa|OK,Wichita|KS,New Orleans|LA,Cleveland|OH,Tampa|FL,Bakersfield|CA,Aurora|CO,' +
    'Honolulu|HI,Anaheim|CA,Santa Ana|CA,St. Louis|MO,Pittsburgh|PA,Corpus Christi|TX,' +
    'Riverside|CA,Cincinnati|OH,Lexington|KY,Anchorage|AK,Stockton|CA,Toledo|OH,Saint Paul|MN,' +
    'Newark|NJ,Greensboro|NC,Buffalo|NY,Plano|TX,Lincoln|NE,Henderson|NV,Fort Wayne|IN,' +
    'Jersey City|NJ,Chandler|AZ,Chula Vista|CA,Orlando|FL,Laredo|TX,Norfolk|VA,Durham|NC,' +
    'Madison|WI,Lubbock|TX,Winston-Salem|NC,Garland|TX,Glendale|AZ,Reno|NV,Hialeah|FL,' +
    'Chesapeake|VA,Scottsdale|AZ,North Las Vegas|NV,Irving|TX,Fremont|CA,Las Vegas|NV,' +
    'Baton Rouge|LA,Richmond|VA,Boise|ID,San Bernardino|CA,Spokane|WA,Birmingham|AL,' +
    'Modesto|CA,Des Moines|IA,Rochester|NY,Tacoma|WA,Fontana|CA,Oxnard|CA,Moreno Valley|CA,' +
    'Fayetteville|NC,Huntington Beach|CA,Yonkers|NY,Montgomery|AL,Amarillo|TX,Little Rock|AR,' +
    'Akron|OH,Columbus|GA,Augusta|GA,Grand Rapids|MI,Shreveport|LA,Salt Lake City|UT,' +
    'Huntsville|AL,Mobile|AL,Tallahassee|FL,Grand Prairie|TX,Overland Park|KS,Knoxville|TN,' +
    'Worcester|MA,Brownsville|TX,Newport News|VA,Santa Clarita|CA,Providence|RI,Fort Lauderdale|FL,' +
    'Chattanooga|TN,Oceanside|CA,Jackson|MS,Rancho Cucamonga|CA,Santa Rosa|CA,Port St. Lucie|FL,' +
    'Tempe|AZ,Ontario|CA,Vancouver|WA,Cape Coral|FL,Sioux Falls|SD,Springfield|MO,Peoria|AZ,' +
    'Pembroke Pines|FL,Elk Grove|CA,Salem|OR,Lancaster|CA,Corona|CA,Eugene|OR,Palmdale|CA,' +
    'Salinas|CA,Springfield|MA,Pasadena|TX,Fort Collins|CO,Hayward|CA,Pomona|CA,Cary|NC,' +
    'Rockford|IL,Alexandria|VA,Escondido|CA,McKinney|TX,Kansas City|KS,Joliet|IL,Sunnyvale|CA,' +
    'Torrance|CA,Bridgeport|CT,Lakewood|CO,Hollywood|FL,Paterson|NJ,Naperville|IL,Syracuse|NY,' +
    'Mesquite|TX,Dayton|OH,Savannah|GA,Clarksville|TN,Orange|CA,Pasadena|CA,Fullerton|CA,' +
    'Killeen|TX,Frisco|TX,Hampton|VA,McAllen|TX,Warren|MI,Bellevue|WA,West Valley City|UT,' +
    'Columbia|SC,Olathe|KS,Sterling Heights|MI,New Haven|CT,Miramar|FL,Waco|TX,Thousand Oaks|CA,' +
    'Cedar Rapids|IA,Charleston|SC,Visalia|CA,Topeka|KS,Elizabeth|NJ,Gainesville|FL,Thornton|CO,' +
    'Roseville|CA,Carrollton|TX,Coral Springs|FL,Stamford|CT,Simi Valley|CA,Concord|CA,' +
    'Hartford|CT,Kent|WA,Lafayette|LA,Midland|TX,Surprise|AZ,Denton|TX,Victorville|CA,Evansville|IN,' +
    'Santa Clara|CA,Abilene|TX,Athens|GA,Vallejo|CA,Allentown|PA,Norman|OK,Beaumont|TX,' +
    'Independence|MO,Murfreesboro|TN,Ann Arbor|MI,Springfield|IL,Berkeley|CA,Peoria|IL,' +
    'Provo|UT,El Monte|CA,Columbia|MO,Lansing|MI,Fargo|ND,Downey|CA,Costa Mesa|CA,Wilmington|NC,' +
    'Arvada|CO,Inglewood|CA,Miami Gardens|FL,Carlsbad|CA,Westminster|CO,Rochester|MN,Odessa|TX,' +
    'Manchester|NH,Elgin|IL,West Jordan|UT,Round Rock|TX,Clearwater|FL,Waterbury|CT,Gresham|OR,' +
    'Fairfield|CA,Billings|MT,Lowell|MA,San Buenaventura|CA,Pueblo|CO,High Point|NC,West Covina|CA,' +
    'Richmond|CA,Murrieta|CA,Cambridge|MA,Antioch|CA,Temecula|CA,Norwalk|CA,Centennial|CO,' +
    'Everett|WA,Palm Bay|FL,Wichita Falls|TX,Green Bay|WI,Daly City|CA,Burbank|CA,Richardson|TX,' +
    'Pompano Beach|FL,North Charleston|SC,Broken Arrow|OK,Boulder|CO,West Palm Beach|FL,' +
    'Santa Maria|CA,El Cajon|CA,Davenport|IA,Rialto|CA,Las Cruces|NM,San Mateo|CA,Lewisville|TX,' +
    'South Bend|IN,Lakeland|FL,Erie|PA,Tyler|TX,Pearland|TX,College Station|TX,Kenosha|WI,' +
    'Sandy Springs|GA,Clovis|CA,Flint|MI,Roanoke|VA,Albany|NY,Jurupa Valley|CA,Compton|CA,' +
    'San Angelo|TX,Hillsboro|OR,Lawton|OK,Renton|WA,Vista|CA,Davie|FL,Greeley|CO,Mission Viejo|CA,' +
    'Portsmouth|VA,Dearborn|MI,South Gate|CA,Tuscaloosa|AL,Bend|OR,Lynn|MA,Bloomington|MN,' +
    'Rapid City|SD,Duluth|MN,Casper|WY,Cheyenne|WY,Great Falls|MT,Missoula|MT,Bozeman|MT,' +
    'Bismarck|ND,Grand Forks|ND,Sioux City|IA,Dubuque|IA,Jefferson City|MO,Springfield|OH,' +
    'Idaho Falls|ID,Pocatello|ID,Twin Falls|ID,Logan|UT,St. George|UT,Grand Junction|CO,' +
    'Durango|CO,Santa Fe|NM,Farmington|NM,Flagstaff|AZ,Yuma|AZ,Redding|CA,Chico|CA,Medford|OR,' +
    'Klamath Falls|OR,Yakima|WA,Walla Walla|WA,Wenatchee|WA,Coeur d\'Alene|ID,Kalispell|MT,' +
    'Helena|MT,Miles City|MT,Glasgow|MT,Havre|MT,Sheridan|WY,Gillette|WY,Cody|WY,Rock Springs|WY,' +
    'Scottsbluff|NE,North Platte|NE,Kearney|NE,Grand Island|NE,Hastings|NE,Salina|KS,' +
    'Dodge City|KS,Garden City|KS,Hays|KS,Emporia|KS,Enid|OK,Stillwater|OK,Ponca City|OK,' +
    'Altus|OK,Pierre|SD,Aberdeen|SD,Watertown|SD,Mitchell|SD,Brookings|SD,Huron|SD,' +
    'Jamestown|ND,Minot|ND,Williston|ND,Dickinson|ND,Devils Lake|ND,Bemidji|MN,Brainerd|MN,' +
    'Fergus Falls|MN,Willmar|MN,Mankato|MN,Winona|MN,La Crosse|WI,Eau Claire|WI,Wausau|WI,' +
    'Oshkosh|WI,Stevens Point|WI,Marquette|MI,Traverse City|MI,Alpena|MI,Escanaba|MI,' +
    'Quincy|IL,Decatur|IL,Champaign|IL,Carbondale|IL,Cape Girardeau|MO,Poplar Bluff|MO,' +
    'Jonesboro|AR,Stuttgart|AR,Pine Bluff|AR,Fort Smith|AR,Fayetteville|AR,Texarkana|TX,' +
    'Monroe|LA,Alexandria|LA,Lake Charles|LA,Houma|LA,Natchez|MS,Greenville|MS,Tupelo|MS,' +
    'Dothan|AL,Albany|GA,Valdosta|GA,Macon|GA,Brunswick|GA,Florence|SC,Myrtle Beach|SC,' +
    'Greenville|NC,Elizabeth City|NC,Salisbury|MD,Dover|DE,Atlantic City|NJ,Binghamton|NY,' +
    'Watertown|NY,Plattsburgh|NY,Burlington|VT,Bangor|ME,Presque Isle|ME,Augusta|ME').split(',');

  var RANK = {};
  for (var mi = 0; mi < MAJOR.length; mi++) RANK[MAJOR[mi]] = mi;

  var cities = [];
  (function () {
    var src = global.US_CITIES || [];
    for (var i = 0; i < src.length; i++) {
      var row = src[i], key = row[0] + '|' + row[3];
      var rank = RANK[key];
      cities.push({
        name: row[0], lat: row[1], lon: row[2], st: row[3],
        rank: rank === undefined ? 4000 + (i % 3000) : rank,
        major: rank !== undefined
      });
    }
    cities.sort(function (a, b) { return a.rank - b.rank; });
    for (var k = 0; k < cities.length; k++) {
      var w = project(cities[k].lon, cities[k].lat, [0, 0]);
      cities[k].wx = w[0]; cities[k].wy = w[1];
    }
  })();

  /* ---------- Hydrography ---------- */

  /* Rivers and lakes arrive as lon/lat with a Natural Earth scalerank; they are
     projected once and carry a bbox so the renderer can cull by viewport and
     reveal smaller water as the map zooms in. */
  function prepHydro(src) {
    var out = [];
    if (!src) return out;
    for (var i = 0; i < src.length; i++) {
      var row = src[i], rank = row[0], n = (row.length - 1) / 2;
      if (n < 2) continue;
      var w = new Float32Array(n * 2);
      var lo0 = 999, la0 = 999, lo1 = -999, la1 = -999;
      for (var k = 0; k < n; k++) {
        var lon = row[1 + k * 2], lat = row[2 + k * 2];
        if (lon < lo0) lo0 = lon;
        if (lon > lo1) lo1 = lon;
        if (lat < la0) la0 = lat;
        if (lat > la1) la1 = lat;
        project(lon, lat, tmp);
        w[k * 2] = tmp[0]; w[k * 2 + 1] = tmp[1];
      }
      out.push({ rank: rank, w: w, bbox: [lo0, la0, lo1, la1] });
    }
    return out;
  }

  var H = global.US_HYDRO || {};
  var rivers = prepHydro(H.rivers);
  var lakes = prepHydro(H.lakes);

  global.OG = global.OG || {};
  global.OG.geo = {
    states: states, counties: counties, cities: cities,
    rivers: rivers, lakes: lakes,
    project: project, unproject: unproject,
    WORLD_W: WORLD_W, WORLD_H: WORLD_H, WORLD: WORLD,
    stateIndexAt: stateIndexAt, countyAt: countyAt,
    forEachCell: forEachCell, hexWorld: hexWorld, cellIndexAt: cellIndexAt,
    cellCenter: cellCenter, nearestCell: nearestCell,
    RES: RES, rowLat: rowLat,
    flyway: flyway, UPFLYWAY: UPFLYWAY,
    bounds: { lon0: MLON0, lat0: MLAT0, lon1: MLON1, lat1: MLAT1 }
  };
})(window);
