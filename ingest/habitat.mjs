/* OmniGuide - habitat raster builder.

   WHY THIS EXISTS.

   Habitat used to be invented. Every big-game surface in env.js was a
   handful of hand-placed Gaussian blobs over fractal noise, and elk had no
   blob list at all - it was an elevation band times noise. The result was
   exactly as good as that sounds: White River, Colorado, some of the best
   elk country on the continent, scored 19 out of 100 for elk habitat. The
   GBIF layer that was meant to correct it is binned at 2.5 degrees, about
   275 km, so it could not tell White River from Denver.

   This builds a real one at 0.1 degrees (about 11 km) from three sources,
   none of which need a key:

     1. NLCD 2021 land cover (MRLC WMS) - what is actually on the ground,
        read as class fractions inside each cell rather than a point sample,
        so a cell is "62% evergreen, 20% grass" and not "evergreen".
     2. AWS terrarium elevation tiles - mean elevation and relief per cell.
     3. GBIF occurrence records - where the animals have actually been
        recorded, as a share of all game records in the same cell so that
        observer effort largely cancels.

   Land cover and elevation decide how good a cell is; GBIF decides whether
   the species is there at all. A cell can be perfect elk habitat on paper
   and still score zero because no elk has been recorded within a hundred
   miles of it, which is the right answer for most of the Appalachians.

   Run by hand or monthly - habitat is not a three-times-daily quantity.
   The scheduled job in ingest.mjs stays weather-only.

       node ingest/habitat.mjs

   Writes js/habitat-grid.js. */

import { writeFileSync, mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { serialize, deserialize } from 'node:v8';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, paletteIndex, terrariumMetres } from './png.mjs';
import { decodeBins } from './mvt.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'js');

/* ---------- grid ---------- */

const LON0 = -125, LAT0 = 24, D = 0.1, NLON = 590, NLAT = 260;
const NCELL = NLON * NLAT;
const cellIdx = (ix, iy) => iy * NLON + ix;

/* ---------- NLCD ---------- */

/* Palette index to NLCD class, in the order MRLC emits its PLTE. Checked
   against the RGB values in the served palette rather than assumed. */
const PAL_TO_CLASS = {
  1: 11, 2: 12, 3: 21, 4: 22, 5: 23, 6: 24, 7: 31,
  9: 41, 10: 42, 11: 43, 12: 51, 13: 52, 14: 71, 15: 72, 16: 73, 17: 74,
  18: 81, 19: 82, 20: 90, 21: 95
};

/* How good each land-cover class is for each species, 0-1. These are
   judgement calls from the habitat literature and from what these animals
   actually use - the one hand-set input left in the chain, and at least
   now applied to real ground cover. Classes absent from a row score zero. */
const SUIT = {
  elk:       { 42: 1.00, 43: 0.92, 41: 0.78, 71: 0.80, 52: 0.62, 90: 0.50, 81: 0.40, 82: 0.15, 31: 0.20, 12: 0.05 },
  muledeer:  { 52: 1.00, 71: 0.72, 42: 0.62, 43: 0.62, 41: 0.50, 31: 0.30, 82: 0.22, 81: 0.30, 90: 0.25 },
  whitetail: { 41: 1.00, 43: 0.95, 90: 0.90, 82: 0.76, 81: 0.70, 42: 0.60, 52: 0.48, 21: 0.34, 95: 0.45 },
  moose:     { 90: 1.00, 95: 0.86, 42: 0.80, 43: 0.75, 41: 0.60, 52: 0.52, 11: 0.40, 71: 0.20 },
  pronghorn: { 71: 1.00, 52: 0.86, 81: 0.50, 82: 0.36, 31: 0.30, 21: 0.10 },
  turkey:    { 41: 1.00, 43: 0.95, 42: 0.70, 81: 0.62, 82: 0.56, 52: 0.42, 90: 0.55, 21: 0.30 },
  upland:    { 82: 0.88, 71: 0.90, 81: 0.80, 52: 0.70, 41: 0.30, 90: 0.30, 21: 0.15 },
  waterfowl: { 95: 1.00, 90: 0.86, 11: 0.80, 82: 0.70, 81: 0.45, 71: 0.30, 12: 0.05 },
  /* A fish only cares about one class. Everything else here is the
     riparian margin that tells you a stream runs through the cell even
     when the stream itself is narrower than a pixel. */
  trout:     { 11: 1.00, 90: 0.30, 95: 0.22 }
};

/* Cover presence beats cover fraction for some species, and an
   area-weighted mean cannot express that. A cottonwood bottom 200 m wide
   on a prairie river is about 2% of an 11 km cell, so the mean reads it
   as shortgrass and the eastern Wyoming and eastern Colorado whitetail
   corridors blanked out. A trout stream is worse - a 20 m creek is a
   rounding error by area and the whole fishery.

   These saturate the suitability instead: s -> 1 - exp(-k*s), so a small
   amount of the right cover counts for a lot and more of it adds less.
   False positives are held off by the occurrence gate rather than by
   keeping the suitability artificially low - the Utah west desert has
   woody cover too, and no whitetail recorded in it. */
const SATURATE = { whitetail: 7, turkey: 5, waterfowl: 4, trout: 30 };

/* Elevation preference in feet: [zero below, full above, full below, zero
   above]. A sanity bound, not the model.

   These were first written against the old invented elevation surface,
   which smoothed the high country down by a thousand feet and more. Once
   real elevation went in they started biting far too early and punched
   holes in exactly the best country: every cell in the Sawatch, the
   Mosquito Range and the San Juans above 10500 ft read zero elk habitat
   and dropped out of range entirely. Those are among the highest elk
   densities on the continent. Elk, mule deer and dusky grouse all use
   ground to treeline and above it in early season, so the upper taper
   now sits where the animals actually stop rather than where a round
   number felt about right. */
const ELEV = {
  /* Elk are not a high-elevation animal. They are a continental one
     that settlement pushed into the mountains, and every reintroduced
     herd is back down low: Kentucky at 1500 ft, Michigan 1075, Missouri
     900, Oklahoma 1000, Kansas 1188. A lower bound of 1500 scored all
     of them at exactly zero and the model missed ten of the eighteen
     established herds outside the Rockies - including Kentucky, which
     holds the largest herd east of the Mississippi. I widened the top
     of this band for the Sawatch and never questioned the bottom. */
  elk:       [0, 500, 11800, 13500],
  muledeer:  [300, 2000, 11000, 13000],
  /* The low end is -400 for anything that lives at the coast. It was -100,
     which is fine until the Salton Sea: 230 feet below sea level, one of
     the main waterfowl areas in the Southwest, and scored at exactly
     zero. The Imperial Valley floor and the lowest Delta islands were
     being shaved by the same ramp. */
  whitetail: [-400, -300, 7500, 10000],
  moose:     [0, 400, 11000, 12500],
  pronghorn: [800, 3000, 10000, 11500],
  turkey:    [-400, -300, 9500, 11000],
  upland:    [-400, -300, 10500, 12000],
  waterfowl: [-400, -300, 9500, 11800],
  trout:     null
};

/* GBIF backbone names. Upland and waterfowl are groups, so they take
   several taxa and sum them. */
const TAXA = {
  elk:       ['Cervus canadensis'],
  muledeer:  ['Odocoileus hemionus'],
  whitetail: ['Odocoileus virginianus'],
  moose:     ['Alces alces'],
  pronghorn: ['Antilocapra americana'],
  turkey:    ['Meleagris gallopavo'],
  upland:    ['Phasianus colchicus', 'Colinus virginianus', 'Tympanuchus phasianellus',
              'Centrocercus urophasianus', 'Bonasa umbellus', 'Callipepla californica',
              'Alectoris chukar', 'Perdix perdix', 'Tympanuchus cupido'],
  waterfowl: ['Anas platyrhynchos', 'Anas acuta', 'Mareca americana', 'Spatula discors',
              'Aythya affinis', 'Aythya valisineria', 'Anas crecca', 'Mareca strepera',
              'Branta canadensis', 'Anser caerulescens',
              /* The bird the Bighorn check said was missing: 1056
                 records there against 279 pintail, and the one you
                 would actually decoy on a cold tailwater. */
              'Bucephala clangula'],
  trout:     ['Oncorhynchus mykiss', 'Salmo trutta', 'Salvelinus fontinalis',
              'Oncorhynchus clarkii']
};

const SPECIES = Object.keys(SUIT);

/* Migration timing is accumulated by latitude band, because a
   species does not peak on the same date in Saskatchewan and
   Louisiana - that lag was a single hardcoded 2.1 days per degree,
   applied identically to every migratory species. */
const CHRON_BAND_DEG = 2;
const CHRON_BANDS = Math.ceil((NLAT * D) / CHRON_BAND_DEG);

/* Groups whose per-taxon split is worth keeping. The decoy spread
   used to name pintails anywhere the migration window was open and
   the habitat was decent; on the Bighorn, GBIF has 5514 mallard and
   1056 goldeneye records against 279 pintail. */
const COMPOSITION = ['waterfowl', 'upland'];

/* Which months a group's records are counted over.

   Waterfowl are counted from September to January, for the range gate
   and the species mix alike, because both are questions about the
   hunting season: where the birds are when anyone is hunting them, and
   what to put in the spread. Counted across the whole year, a prairie
   marsh that empties in October looks as good as one that holds birds
   to freeze-up, and blue-winged teal - all over the north in June,
   gone before most openers - get recommended in North Dakota in
   November. Everything else here is resident and keeps every month. */
const SEASON_MONTHS = { waterfowl: [9, 10, 11, 12, 1] };

/* Groups that migrate, and so need a calendar. */
const CHRON_GROUPS = ['waterfowl'];

/* Composition is a smooth regional quantity, so it ships on a
   coarser grid than habitat and costs almost nothing. */
/* Presence is smoothed over 33 km before use, so a tenth of a degree
   was storing detail that is not in the signal. */
const PRES_D = 0.25;
const PRES_NLON = Math.ceil(NLON * D / PRES_D);
const PRES_NLAT = Math.ceil(NLAT * D / PRES_D);

const COMP_D = 0.5;
const COMP_NLON = Math.ceil(NLON * D / COMP_D);
const COMP_NLAT = Math.ceil(NLAT * D / COMP_D);

/* Every request gets a deadline. Without one a stalled GBIF connection
   hangs the whole build silently - memory flat, no output, no error -
   and the retry loop above never gets a chance to do its job. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A deadline that cannot be ignored.

   AbortSignal.timeout on its own was not enough: a build sat idle for
   95 minutes on a single request, zero CPU, never aborting and never
   returning, while GBIF was answering other callers in under half a
   second. Whatever the cause inside fetch, a promise that never settles
   stops the whole pipeline, so the deadline is enforced from outside as
   well and the loser is always a rejection. */
function deadline(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout after ' + ms + 'ms: ' + what)), ms); })
  ]).finally(() => clearTimeout(timer));
}

async function getBuf(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await deadline(fetch(url, { headers: { 'User-Agent': 'OmniGuide/ingest' }, signal: AbortSignal.timeout(40000) }), 45000, url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return Buffer.from(await deadline(r.arrayBuffer(), 30000, url));
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(700 * (i + 1));
    }
  }
}

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await deadline(fetch(url, { headers: { 'User-Agent': 'OmniGuide/ingest' }, signal: AbortSignal.timeout(40000) }), 45000, url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await deadline(r.json(), 30000, url);
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(700 * (i + 1));
    }
  }
}

/* ---------- cache ----------

   Land cover and elevation do not change between builds, and the
   occurrence counts change slowly. Without this, a one-line change to
   how the layers are combined cost a full rebuild to test, which is
   how a wrong sample survived as long as it did: every look at the
   output was too expensive to take casually.

   OG_FRESH=1 ignores it. */
const CACHE = resolve(HERE, '.cache');
const FRESH = process.env.OG_FRESH === '1';

function cacheRead(name, maxAgeDays) {
  if (FRESH) return null;
  const f = resolve(CACHE, name + '.bin');
  try {
    if (!existsSync(f)) return null;
    if (Date.now() - statSync(f).mtimeMs > maxAgeDays * 864e5) return null;
    return deserialize(readFileSync(f));
  } catch (e) { return null; }
}

function cacheWrite(name, value) {
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(resolve(CACHE, name + '.bin'), serialize(value));
}

async function cached(name, maxAgeDays, build) {
  const hit = cacheRead(name, maxAgeDays);
  if (hit) return hit;
  const v = await build();
  cacheWrite(name, v);
  return v;
}

/* ---------- a polite client for GBIF ----------

   One request at a time per service, spaced out, and when the answer
   is 429 the lane stops for as long as the response says and then a
   bit. The old client fired six at once and retried a refusal after
   700 ms, which is how to get an address throttled; it then reported
   the refused pages as timeouts and carried on without them.

   Gives up loudly. A request that cannot be made after eight tries
   throws, and the build stops, because every caller here needs the
   answer to be complete. */
const lanes = {};

function polite(lane, spacing, url, binary) {
  const L = lanes[lane] || (lanes[lane] = { chain: Promise.resolve(), next: 0 });
  const run = async () => {
    let last = null;
    for (let i = 0; i < 8; i++) {
      const wait = L.next - Date.now();
      if (wait > 0) await sleep(wait);
      L.next = Date.now() + spacing;
      try {
        const r = await deadline(fetch(url, {
          headers: { 'User-Agent': 'OmniGuide/ingest' }, signal: AbortSignal.timeout(90000)
        }), 95000, url);
        if (r.status === 429 || r.status === 503) {
          const ra = parseFloat(r.headers.get('retry-after')) || 3;
          await r.arrayBuffer().catch(() => null);
          L.next = Date.now() + (ra + 2) * 1000 * (i + 1);
          last = new Error('HTTP ' + r.status);
          continue;
        }
        /* The map service answers a tile with nothing in it two ways:
           204 with no body, or 400 with this message, depending on
           which of its backends took the request. Checked on the
           tile that stopped a build - whitetail on the Oregon coast
           - against the search API's count for the same box: zero.
           Only this exact message is read as empty; any other 400
           is a malformed request and still fails. */
        if (r.status === 400 && binary) {
          const msg = await r.text().catch(() => '');
          if (msg.indexOf('missing the expected layer') >= 0) return Buffer.alloc(0);
          throw new Error('HTTP 400 ' + msg.slice(0, 120));
        }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        if (binary) return Buffer.from(await deadline(r.arrayBuffer(), 60000, url));
        return await deadline(r.json(), 60000, url);
      } catch (e) {
        last = e;
        L.next = Date.now() + 1500 * (i + 1);
      }
    }
    throw new Error('GBIF would not answer after 8 tries (' + (last && last.message) + '): ' + url);
  };
  const p = L.chain.then(run, run);
  L.chain = p.catch(() => null);
  return p;
}

/* ---------- 1. land cover fractions ---------- */

/* Five pixels across each 0.1 degree cell, so a cell gets 25 samples and
   the fractions mean something. Requested as a grid of tiles because one
   image at this resolution is past what the service will return. */
async function landCover() {
  const PPC = 5;
  const COLS = 5, ROWS = 4;
  const lonSpan = (NLON / COLS) * D, latSpan = (NLAT / ROWS) * D;
  const w = (NLON / COLS) * PPC, h = (NLAT / ROWS) * PPC;

  const counts = new Map();
  const total = new Uint16Array(NCELL);

  for (let cx = 0; cx < COLS; cx++) {
    for (let cy = 0; cy < ROWS; cy++) {
      const west = LON0 + cx * lonSpan, east = west + lonSpan;
      const south = LAT0 + cy * latSpan, north = south + latSpan;
      const url = 'https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/wms' +
        '?service=WMS&version=1.1.1&request=GetMap&layers=NLCD_2021_Land_Cover_L48' +
        '&bbox=' + west + ',' + south + ',' + east + ',' + north +
        '&width=' + w + '&height=' + h + '&srs=EPSG:4326&format=image/png';
      const img = decodePNG(await getBuf(url));
      if (img.color !== 3) throw new Error('MRLC returned a non-paletted image');

      for (let py = 0; py < img.height; py++) {
        /* Image rows run north to south; the grid runs south to north. */
        const iy = Math.floor((NLAT / ROWS) * cy + (img.height - 1 - py) / PPC);
        if (iy < 0 || iy >= NLAT) continue;
        for (let px = 0; px < img.width; px++) {
          const cls = PAL_TO_CLASS[paletteIndex(img, px, py)];
          if (!cls) continue;
          const ix = Math.floor((NLON / COLS) * cx + px / PPC);
          if (ix < 0 || ix >= NLON) continue;
          const k = cellIdx(ix, iy);
          let arr = counts.get(cls);
          if (!arr) { arr = new Uint16Array(NCELL); counts.set(cls, arr); }
          arr[k]++; total[k]++;
        }
      }
      process.stderr.write('  nlcd tile ' + (cx * ROWS + cy + 1) + '/' + (COLS * ROWS) + '\n');
    }
  }
  return { counts, total };
}

/* ---------- 1b. rice ----------

   NLCD files rice under cultivated crops, with soybeans and corn. For
   a duck that is the difference that matters most across the lower
   Mississippi valley, the Gulf prairies and the Sacramento Valley: a
   rice field is flooded, shallow and full of waste grain, and a bean
   field is not. On land cover alone Stuttgart scored 51 against 42
   for a square of north Iowa corn.

   The USDA Cropland Data Layer separates the crops, at 30 m, every
   year, in the public domain. Read here the same way as the land
   cover: rendered tiles, five samples across a cell, counted by
   colour. Only rice is taken. Its legend colour is 0,169,230 -
   checked on the Grand Prairie, where it came back as 14.4 percent
   of the box round Stuttgart beside 29 percent soybeans. */
const CDL_YEAR = 2024;
const RICE_RGB = [0, 169, 230];

async function riceCover() {
  const PPC = 5, COLS = 5, ROWS = 4;
  const lonSpan = (NLON / COLS) * D, latSpan = (NLAT / ROWS) * D;
  const w = (NLON / COLS) * PPC, h = (NLAT / ROWS) * PPC;
  const hit = new Uint16Array(NCELL), seen = new Uint16Array(NCELL);

  for (let cx = 0; cx < COLS; cx++) {
    for (let cy = 0; cy < ROWS; cy++) {
      const west = LON0 + cx * lonSpan, east = west + lonSpan;
      const south = LAT0 + cy * latSpan, north = south + latSpan;
      const url = 'https://nassgeodata.gmu.edu/CropScapeService/wms_cdlall.cgi' +
        '?service=WMS&version=1.1.1&request=GetMap&layers=cdl_' + CDL_YEAR + '&styles=' +
        '&bbox=' + r3(west) + ',' + r3(south) + ',' + r3(east) + ',' + r3(north) +
        '&width=' + w + '&height=' + h + '&srs=EPSG:4326&format=image/png';
      const img = decodePNG(await getBuf(url));
      const pal = img.color === 3;
      if (!pal && img.channels < 3) throw new Error('crop map returned an image this cannot read');
      for (let py = 0; py < img.height; py++) {
        const iy = Math.floor((NLAT / ROWS) * cy + (img.height - 1 - py) / PPC);
        if (iy < 0 || iy >= NLAT) continue;
        for (let px = 0; px < img.width; px++) {
          const ix = Math.floor((NLON / COLS) * cx + px / PPC);
          if (ix < 0 || ix >= NLON) continue;
          let r, g, b;
          if (pal) {
            const i = paletteIndex(img, px, py) * 3;
            r = img.palette[i]; g = img.palette[i + 1]; b = img.palette[i + 2];
          } else {
            const o = (py * img.width + px) * img.channels;
            r = img.data[o]; g = img.data[o + 1]; b = img.data[o + 2];
          }
          const k = cellIdx(ix, iy);
          seen[k]++;
          if (Math.abs(r - RICE_RGB[0]) <= 3 && Math.abs(g - RICE_RGB[1]) <= 3 && Math.abs(b - RICE_RGB[2]) <= 3) hit[k]++;
        }
      }
      process.stderr.write('  crop map tile ' + (cx * ROWS + cy + 1) + '/' + (COLS * ROWS) + '\n');
    }
  }
  const out = new Float32Array(NCELL);
  let cells = 0;
  for (let k = 0; k < NCELL; k++) {
    if (!seen[k]) continue;
    out[k] = hit[k] / seen[k];
    if (out[k] >= 0.05) cells++;
  }
  process.stderr.write('  ' + cells + ' cells at least a twentieth rice\n');
  if (cells < 200) throw new Error('crop map found almost no rice - the legend colour has probably changed');
  return out;
}

/* ---------- 2. elevation ---------- */

const lon2tx = (lon, z) => Math.floor(((lon + 180) / 360) * Math.pow(2, z));
function lat2ty(lat, z) {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}
const tx2lon = (x, z) => x / Math.pow(2, z) * 360 - 180;
function ty2lat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

async function elevation() {
  const Z = 7;
  const x0 = lon2tx(LON0, Z), x1 = lon2tx(LON0 + NLON * D, Z);
  const y0 = lat2ty(LAT0 + NLAT * D, Z), y1 = lat2ty(LAT0, Z);

  const sum = new Float64Array(NCELL), sumSq = new Float64Array(NCELL);
  const n = new Uint32Array(NCELL);
  const totalTiles = (x1 - x0 + 1) * (y1 - y0 + 1);
  let done = 0;

  for (let tx = x0; tx <= x1; tx++) {
    const jobs = [];
    for (let ty = y0; ty <= y1; ty++) jobs.push([tx, ty]);
    const imgs = await Promise.all(jobs.map(async ([x, y]) => {
      try {
        return [x, y, decodePNG(await getBuf(
          'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + Z + '/' + x + '/' + y + '.png', 2))];
      } catch { return [x, y, null]; }
    }));
    for (const [x, y, img] of imgs) {
      done++;
      if (!img) continue;
      const wLon = tx2lon(x, Z), eLon = tx2lon(x + 1, Z);
      const nLat = ty2lat(y, Z), sLat = ty2lat(y + 1, Z);
      for (let py = 0; py < img.height; py += 2) {
        const lat = nLat + (sLat - nLat) * (py / img.height);
        const iy = Math.floor((lat - LAT0) / D);
        if (iy < 0 || iy >= NLAT) continue;
        for (let px = 0; px < img.width; px += 2) {
          const lon = wLon + (eLon - wLon) * (px / img.width);
          const ix = Math.floor((lon - LON0) / D);
          if (ix < 0 || ix >= NLON) continue;
          const m = terrariumMetres(img, px, py);
          if (m < -400 || m > 9000) continue;
          const k = cellIdx(ix, iy);
          sum[k] += m; sumSq[k] += m * m; n[k]++;
        }
      }
    }
    process.stderr.write('  elev ' + done + '/' + totalTiles + '\n');
  }

  const meanFt = new Float32Array(NCELL), reliefFt = new Float32Array(NCELL);
  for (let k = 0; k < NCELL; k++) {
    if (!n[k]) { meanFt[k] = NaN; continue; }
    const m = sum[k] / n[k];
    const v = Math.max(0, sumSq[k] / n[k] - m * m);
    meanFt[k] = m * 3.28084;
    reliefFt[k] = Math.sqrt(v) * 3.28084;
  }
  return { meanFt, reliefFt };
}

/* ---------- 3. GBIF occurrences ---------- */

async function taxonKey(name) {
  return cached('key-' + name.replace(/[^A-Za-z]+/g, '-'), 90, async () => {
    const j = await polite('search', 2600,
      'https://api.gbif.org/v1/species/match?strict=true&name=' + encodeURIComponent(name), false);
    if (!j || !j.usageKey) throw new Error('no GBIF key for ' + name);
    return j.usageKey;
  });
}

/* LICENCE FILTER.

   GBIF records carry a licence per record, chosen by whoever logged
   the sighting. The default on iNaturalist is non-commercial, and
   this product has a paid tier, so the non-commercial records cannot
   be used to build it however good they are.

   The cost is lopsided and worth knowing. Birds come from eBird and
   are openly licensed - mallard keeps 98% of its records, turkey 95%
   - so waterfowl, turkey and upland lose essentially nothing.
   Mammals come from iNaturalist: elk keeps 16%, whitetail 13%, moose
   17%. Measured on elk, that is 1148 distinct 11 km cells down to
   860, because most of what goes is a repeat sighting from a place
   already covered rather than new ground.

   CC0 and CC-BY only. CC-BY still obliges us to credit the sources,
   which the app has to surface somewhere. */
var LICENCE = '&license=CC0_1_0&license=CC_BY_4_0';

/* HOW THE RECORDS ARE COUNTED.

   This used to page the first 9000 records of each taxon through the
   search API and treat them as a sample. They were not one. GBIF
   returns records in the order they were indexed, which for the eBird
   dataset runs by date, so the first 9000 northern pintail are every
   pintail logged between 1 January and mid February 2025 - out of
   1,365,890. The build shipped a pintail that was 94% January, a
   canvasback that was 97% January and a mallard with no records at
   all from September to December, and three things were built on it:
   the range gate, the migration calendar, and the species mix behind
   the decoy advice. The calendar came out saying ducks arrive
   everywhere in January, which sent the national hotspot north again
   in midwinter.

   It was also losing a third of its pages. What the log called
   timeouts were HTTP 429: GBIF saying, in as many words, that the
   search API is not for bulk harvesting.

   So nothing is paged any more, and nothing is sampled. GBIF's map
   service does the counting on its side: ask for a tile with any
   search filter attached and it returns the exact number of matching
   records in each of 32 by 32 squares, placed at the centroid of the
   records in that square. At zoom 5 a square is 0.176 degrees, which
   is finer than the presence plane this feeds. Checked against the
   search API's own count for the same box and filter on three tiles
   and it agrees to the record: 16241, 785, 78562.

   Every taxon therefore comes back complete - a mallard and a
   canvasback are counted as the seven million and the two hundred
   thousand they are, rather than each being capped at the same
   number and looking equally common. */
const YEAR0 = 2015, YEAR1 = 2025;
const r3 = (v) => Math.round(v * 1000) / 1000;
const LAT1 = r3(LAT0 + NLAT * D), LON1 = r3(LON0 + NLON * D);

/* The grid's own bounding box goes in every query, so a count is a
   count of records that can actually land in a cell. */
function occurrenceFilter(key, latLo, latHi) {
  return 'taxonKey=' + key +
    '&country=US&hasCoordinate=true&hasGeospatialIssue=false' +
    '&year=' + YEAR0 + ',' + YEAR1 +
    '&decimalLatitude=' + latLo + ',' + latHi +
    '&decimalLongitude=' + LON0 + ',' + LON1 + LICENCE;
}

/* Plain latitude and longitude tiles: two across at zoom 0, each
   level halving the span. The service aggregates to a 32 by 32 grid
   inside a tile whatever bin size is asked for, so the zoom is the
   resolution. */
const TILE_Z = 5, TILE_SPAN = 180 / Math.pow(2, TILE_Z);

/* Only the tiles with any mapped land cover in them. Open ocean and
   the far side of both borders are a third of the bounding box. */
function landTiles(lcTotal) {
  const x0 = Math.floor((LON0 + 180) / TILE_SPAN), x1 = Math.floor((LON1 - 1e-9 + 180) / TILE_SPAN);
  const y0 = Math.floor((90 - LAT1) / TILE_SPAN), y1 = Math.floor((90 - LAT0 - 1e-9) / TILE_SPAN);
  const out = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const lonW = -180 + x * TILE_SPAN, latN = 90 - y * TILE_SPAN;
      const ixa = Math.max(0, Math.floor((lonW - LON0) / D));
      const ixb = Math.min(NLON - 1, Math.ceil((lonW + TILE_SPAN - LON0) / D));
      const iya = Math.max(0, Math.floor((latN - TILE_SPAN - LAT0) / D));
      const iyb = Math.min(NLAT - 1, Math.ceil((latN - LAT0) / D));
      let land = false;
      for (let iy = iya; iy <= iyb && !land; iy++) {
        for (let ix = ixa; ix <= ixb; ix++) {
          if (lcTotal[cellIdx(ix, iy)]) { land = true; break; }
        }
      }
      if (land) out.push([x, y]);
    }
  }
  return out;
}

/* Record counts for one taxon on the habitat grid, optionally for a
   set of calendar months. Exact, and either complete or an error:
   a tile that cannot be fetched fails the build rather than leaving
   a hole the size of Nebraska in the range. */
async function density(key, name, months, tiles) {
  const tag = 'den-' + key + '-' + (months ? months.join('.') : 'all');
  const hit = cacheRead(tag, 20);
  if (hit) {
    process.stderr.write('    ' + name + ': from cache\n');
    return hit;
  }

  const filter = occurrenceFilter(key, LAT0, LAT1) +
    (months ? months.map((m) => '&month=' + m).join('') : '');
  const grid = new Float32Array(NCELL);
  let total = 0, placed = 0, bins = 0;

  for (let i = 0; i < tiles.length; i++) {
    const x = tiles[i][0], y = tiles[i][1];
    const buf = await polite('map', 220,
      'https://api.gbif.org/v2/map/occurrence/adhoc/' + TILE_Z + '/' + x + '/' + y +
      '.mvt?srs=EPSG:4326&bin=square&squareSize=8&' + filter, true);
    if (!buf.length) continue;                    // 204: nothing here
    const t = decodeBins(buf);
    const lonW = -180 + x * TILE_SPAN, latN = 90 - y * TILE_SPAN;
    for (const b of t.bins) {
      const lon = lonW + (b.x0 + b.x1) / 2 / t.extent * TILE_SPAN;
      const lat = latN - (b.y0 + b.y1) / 2 / t.extent * TILE_SPAN;
      total += b.total; bins++;
      const ix = Math.floor((lon - LON0) / D), iy = Math.floor((lat - LAT0) / D);
      if (ix < 0 || ix >= NLON || iy < 0 || iy >= NLAT) continue;
      grid[cellIdx(ix, iy)] += b.total;
      placed += b.total;
    }
  }

  const out = { grid: grid, total: total, placed: placed, bins: bins };
  cacheWrite(tag, out);
  return out;
}

/* Month by latitude band, as exact counts.

   The one thing still asked of the search API, and asked the way it
   is meant to be used: a facet, where GBIF counts every matching
   record on its side and returns twelve numbers. Thirteen small
   requests a taxon, one at a time, in a lane that waits when told to. */
async function monthsByBand(key) {
  const out = new Float64Array(CHRON_BANDS * 12);
  for (let b = 0; b < CHRON_BANDS; b++) {
    const lo = LAT0 + b * CHRON_BAND_DEG;
    /* Both ends of a GBIF range are inclusive; stop a hair short so
       a record on the boundary is not counted in two bands. */
    const hi = r3(lo + CHRON_BAND_DEG - 0.001);
    const j = await polite('search', 2600,
      'https://api.gbif.org/v1/occurrence/search?' + occurrenceFilter(key, lo, hi) +
      '&limit=0&facet=month&facetLimit=12', false);
    const counts = j && j.facets && j.facets[0] ? j.facets[0].counts : [];
    for (const c of counts) {
      const m = +c.name;
      if (m >= 1 && m <= 12) out[b * 12 + m - 1] = c.count;
    }
  }
  return out;
}

/* ---------- coldwater ----------

   Trout are bounded by temperature before anything else. Summer air
   temperature from the NOAA normals already in the repo stands in for
   stream temperature, lapse-corrected to the cell: Grayling reads 66 F
   in July and holds brook trout, Phoenix reads 92 and does not.

   It is the wrong answer for a tailwater - Little Rock reads 83 F while
   the White River below Bull Shoals runs cold all summer because it is
   drawn from the bottom of a reservoir. That case is handled at runtime
   instead, from gauge water temperature and USGS tailwater site naming
   in openwater.js, which refresh with the rest of the live data. What is
   baked here is the climate, not the release schedule. */

function loadNormals() {
  const win = {};
  const code = readFileSync(resolve(HERE, '..', 'js', 'normals.js'), 'utf8');
  new Function('window', code)(win);
  return win.US_NORMALS || null;
}

function coldwaterGrid(meanFt) {
  const N = loadNormals();
  const out = new Float32Array(NCELL);
  if (!N) { out.fill(0.5); return out; }
  const MISSING = -9999, LAPSE = 0.00357;

  /* July mean per station, once. */
  const julyF = new Float32Array(N.n);
  for (let i = 0; i < N.n; i++) {
    let sum = 0, c = 0;
    for (let w = 27; w <= 31; w++) {
      const o = i * 52 + w;
      if (N.TX[o] === MISSING || N.TN[o] === MISSING) continue;
      sum += (N.TX[o] + N.TN[o]) / 20; c++;
    }
    julyF[i] = c ? sum / c : NaN;
  }

  for (let iy = 0; iy < NLAT; iy++) {
    const lat = LAT0 + (iy + 0.5) * D;
    const cosLat = Math.cos(lat * Math.PI / 180);
    for (let ix = 0; ix < NLON; ix++) {
      const lon = LON0 + (ix + 0.5) * D;
      const k = cellIdx(ix, iy);
      /* Three nearest stations, inverse distance. */
      let b0 = [1e9, -1], b1 = [1e9, -1], b2 = [1e9, -1];
      for (let i = 0; i < N.n; i++) {
        if (!isFinite(julyF[i])) continue;
        const dx = (N.lon[i] - lon) * cosLat, dy = N.lat[i] - lat;
        const d2 = dx * dx + dy * dy;
        if (d2 < b0[0]) { b2 = b1; b1 = b0; b0 = [d2, i]; }
        else if (d2 < b1[0]) { b2 = b1; b1 = [d2, i]; }
        else if (d2 < b2[0]) { b2 = [d2, i]; }
      }
      let num = 0, den = 0;
      for (const b of [b0, b1, b2]) {
        if (b[1] < 0) continue;
        const w = 1 / (b[0] + 0.02);
        const lapse = (N.elev[b[1]] - (isFinite(meanFt[k]) ? meanFt[k] : N.elev[b[1]])) * LAPSE;
        num += (julyF[b[1]] + lapse) * w; den += w;
      }
      if (!den) { out[k] = 0.5; continue; }
      const t = num / den;
      /* Full below 68 F, nothing above 80 F.

         Calibrated against real fisheries, not against water temperature
         directly: a stream runs well below the July air mean because of
         groundwater, shade and because the mean includes hot afternoons.
         A first cut at 58-72 F scored Penns Creek 0.03 and the Madison
         0.34, which would have wiped out trout almost everywhere outside
         the high Rockies. At 68-80 the Madison and the Au Sable come out
         full, Penns Creek 0.70, the Battenkill 0.88, and Phoenix and
         Houston still zero. */
      out[k] = Math.max(0, Math.min(1, (80 - t) / 12));
    }
  }
  return out;
}

/* ---------- hunting pressure ----------

   Pressure was a list of hand-placed metro blobs with hand-set
   weights and a noise field on top. NLCD already says where the
   people are, at 30 m, and it is the same download the habitat
   surfaces come from.

   Developed classes are weighted by intensity, because an acre of
   high-intensity development holds far more people than an acre of
   large-lot housing, and then spread over roughly an hour's drive:
   what matters to a hunter is not whether this cell is built up but
   how many people can reach it before shooting light. */

const DEVELOPED = { 21: 0.15, 22: 0.45, 23: 0.80, 24: 1.00 };

function pressureGrid(counts, total) {
  const dev = new Float32Array(NCELL);
  for (let k = 0; k < NCELL; k++) {
    if (!total[k]) continue;
    let v = 0;
    for (const cls of Object.keys(DEVELOPED)) {
      const arr = counts.get(+cls);
      if (arr) v += DEVELOPED[cls] * (arr[k] / total[k]);
    }
    dev[k] = v;
  }
  /* About 70 km, which is the distance a lot of people will drive
     before work on a Saturday. */
  const spread = smooth(dev, 6);
  const out = new Float32Array(NCELL);
  /* Normalise against the 99th percentile rather than the maximum,
     so one dense city core does not flatten everywhere else. */
  const nz = Array.from(spread).filter((v) => v > 0).sort((a, b) => a - b);
  const p99 = nz.length ? nz[Math.floor(nz.length * 0.99)] : 1;
  for (let k = 0; k < NCELL; k++) {
    out[k] = Math.max(0, Math.min(1, Math.pow(spread[k] / (p99 || 1), 0.6)));
  }
  return out;
}

/* ---------- tailwaters ----------

   The coldwater index above is climate, and climate says no to some
   of the best trout water in the country. The White River below Bull
   Shoals scores 0.00 on July air temperature and runs 57 F in
   October, because it is drawn from the bottom of a reservoir. The
   Norfork reads 53 F, Taneycomo 55 F. A trout map built on air
   temperature alone blanks the Ozarks and the Tennessee Valley.

   USGS names its sites descriptively, so "WHITE RIVER BELOW BULL
   SHOALS DAM" and "TAILRACE" are in the record. Naming is a
   structural fact about the river rather than a reading, which
   matters here: keying off live water temperature instead would mark
   every river in Minnesota as trout water in January.

   Folded into the coldwater grid BEFORE the occurrence gate, not
   applied on top of the finished surface, so a cold tailwater with no
   trout ever recorded in it still comes out empty. */

function tailwaterGrid() {
  const out = new Float32Array(NCELL);
  let raw = null;
  try {
    const win = {};
    new Function('window', readFileSync(resolve(HERE, '..', 'js', 'gauges.js'), 'utf8'))(win);
    raw = win.US_GAUGES;
  } catch (e) { /* no gauge file - the climate index stands alone */ }
  if (!raw || !raw.sites) return out;

  const TW = /\b(TAILRACE|TAILWATER|POWERHOUSE|PWRHSE)\b|\b(BL|BLW|BELOW|DS)\b[^,]{0,40}\bDAM\b/i;
  const REACH_KM = 28;
  let n = 0;

  for (const site of raw.sites) {
    const lat = site[2], lon = site[3], tempC = site[4], cfs = site[5];
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    if (!TW.test(site[1] || '')) continue;

    /* Many "below dam" sites in the network are trickles behind farm
       ponds. Require real flow, or a temperature cold enough to be a
       bottom release. */
    const bigFlow = typeof cfs === 'number' && cfs >= 150;
    const coldRead = typeof tempC === 'number' && tempC <= 17;   // 63 F
    if (!bigFlow && !coldRead) continue;
    n++;

    const strength = coldRead ? 1.0 : 0.8;
    const kmPerLon = 111.32 * Math.cos(lat * Math.PI / 180);
    const dLat = REACH_KM / 111.32, dLon = REACH_KM / kmPerLon;
    const iy0 = Math.max(0, Math.floor((lat - dLat - LAT0) / D));
    const iy1 = Math.min(NLAT - 1, Math.ceil((lat + dLat - LAT0) / D));
    const ix0 = Math.max(0, Math.floor((lon - dLon - LON0) / D));
    const ix1 = Math.min(NLON - 1, Math.ceil((lon + dLon - LON0) / D));
    for (let iy = iy0; iy <= iy1; iy++) {
      const cy = LAT0 + (iy + 0.5) * D;
      for (let ix = ix0; ix <= ix1; ix++) {
        const cx = LON0 + (ix + 0.5) * D;
        const ex = (cx - lon) * kmPerLon, ey = (cy - lat) * 111.32;
        const d = Math.sqrt(ex * ex + ey * ey);
        if (d > REACH_KM) continue;
        const v = strength * (1 - d / REACH_KM);
        const k = cellIdx(ix, iy);
        if (v > out[k]) out[k] = v;
      }
    }
  }
  process.stderr.write('  ' + n + ' qualifying tailwater gauges' + String.fromCharCode(10));
  return out;
}

/* ---------- combine ---------- */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function quantise(f32) {
  const b = new Uint8Array(f32.length);
  for (let i = 0; i < f32.length; i++) b[i] = Math.round(clamp01(f32[i]) * 255);
  return b;
}

function elevFactor(ft, band) {
  if (!band || !isFinite(ft)) return 1;
  const lo = band[0], loF = band[1], hiF = band[2], hi = band[3];
  if (ft <= lo || ft >= hi) return 0;
  if (ft < loF) return (ft - lo) / (loF - lo);
  if (ft > hiF) return (hi - ft) / (hi - hiF);
  return 1;
}

/* Waterfowl suitability, built from water outward.

   The class weights alone gave a square of cropland with no water
   in it 0.94 and a square of dry grassland 0.70 - the Trans-Pecos
   scored as duck country - and the only thing holding that down was
   the occurrence layer, which is not what an occurrence layer is
   for. A cornfield is feed, and feed is worth exactly as much as
   the roost water within a flight of it.

   So water and wetland carry the score, and fields add to it in
   proportion to the water and wetland cover in the block of cells
   round about, counting in full at three percent. Open water is
   worth most where it meets something - a square that is all lake
   is the middle of the lake. */
function waterfowlSuit(lc, rice) {
  const frac = (cls, k) => { const a = lc.counts.get(cls); return a ? a[k] / lc.total[k] : 0; };
  const wet = new Float32Array(NCELL), feed = new Float32Array(NCELL), water = new Float32Array(NCELL);
  for (let k = 0; k < NCELL; k++) {
    if (!lc.total[k]) continue;
    const open = frac(11, k), marsh = frac(95, k), swamp = frac(90, k);
    /* Rice counts three ways: as the best feed there is, as shallow
       water in its own right for the part of it that is flooded
       through the season, and as water for the fields beside it. It
       is already inside the NLCD crop fraction, so only the extra
       over an ordinary crop is added to feed. */
    const paddy = rice ? rice[k] : 0;
    wet[k] = 1.00 * marsh + 0.86 * swamp + 0.80 * open * (1 - open * open) + 0.45 * paddy;
    feed[k] = 0.70 * frac(82, k) + 0.45 * frac(81, k) + 0.30 * frac(71, k) + 0.30 * paddy;
    water[k] = open + marsh + swamp + 0.5 * paddy;
  }
  const near = smooth(water, 1);
  const out = new Float32Array(NCELL);
  for (let k = 0; k < NCELL; k++) {
    if (!lc.total[k]) continue;
    const reach = clamp01(near[k] / 0.03);
    /* A pond in a city is water and is not somewhere to hunt. Built-up
       ground - not the parks and verges NLCD calls open space - takes
       the score down with it: Central Park read 37. */
    const built = frac(22, k) + frac(23, k) + frac(24, k);
    out[k] = clamp01((1 - Math.exp(-4 * wet[k])) + 0.6 * feed[k] * reach) * Math.pow(1 - built, 1.5);
  }
  return out;
}

/* 1-2-1 in each direction, on a grid of any size. */
function blur3(src, nx, ny) {
  const tmp = new Float64Array(src.length), out = new Float64Array(src.length);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const a = src[y * nx + Math.max(0, x - 1)], b = src[y * nx + x];
      const c = src[y * nx + Math.min(nx - 1, x + 1)];
      tmp[y * nx + x] = (a + 2 * b + c) / 4;
    }
  }
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const a = tmp[Math.max(0, y - 1) * nx + x], b = tmp[y * nx + x];
      const c = tmp[Math.min(ny - 1, y + 1) * nx + x];
      out[y * nx + x] = (a + 2 * b + c) / 4;
    }
  }
  return out;
}

/* Separable box blur, radius in cells. Occurrence records are points; a
   cell with no record next to one with forty is not empty of animals. */
function smooth(src, radius) {
  const tmp = new Float32Array(NCELL), out = new Float32Array(NCELL);
  for (let iy = 0; iy < NLAT; iy++) {
    for (let ix = 0; ix < NLON; ix++) {
      let s = 0, n = 0;
      for (let d = -radius; d <= radius; d++) {
        const x = ix + d;
        if (x < 0 || x >= NLON) continue;
        s += src[cellIdx(x, iy)]; n++;
      }
      tmp[cellIdx(ix, iy)] = s / n;
    }
  }
  for (let ix = 0; ix < NLON; ix++) {
    for (let iy = 0; iy < NLAT; iy++) {
      let s = 0, n = 0;
      for (let d = -radius; d <= radius; d++) {
        const y = iy + d;
        if (y < 0 || y >= NLAT) continue;
        s += tmp[cellIdx(ix, y)]; n++;
      }
      out[cellIdx(ix, iy)] = s / n;
    }
  }
  return out;
}

async function main() {
  process.stderr.write('land cover...\n');
  const lc = await cached('landcover-' + NLON + 'x' + NLAT, 45, landCover);

  process.stderr.write('elevation...\n');
  const ev = await cached('elevation-' + NLON + 'x' + NLAT, 45, elevation);

  process.stderr.write('rice...\n');
  const rice = await cached('rice-' + CDL_YEAR + '-' + NLON + 'x' + NLAT, 120, riceCover);

  process.stderr.write('pressure...\n');
  const press = pressureGrid(lc.counts, lc.total);

  process.stderr.write('coldwater...\n');
  const cold = coldwaterGrid(ev.meanFt);
  const tw = tailwaterGrid();
  /* A cold release beats whatever the climate would have predicted. */
  for (let k = 0; k < NCELL; k++) if (tw[k] > cold[k]) cold[k] = tw[k];

  process.stderr.write('occurrences...\n');
  const occ = {}, effort = new Float32Array(NCELL);
  const chronology = {}, composition = {}, harvest = [];

  const land = landTiles(lc.total);
  process.stderr.write('  ' + land.length + ' map tiles with land in them\n');

  const keys = {};
  for (const sp of SPECIES) for (const name of TAXA[sp]) keys[name] = await taxonKey(name);

  /* Every bird record in the grid, by band and month: how much
     looking was going on. The runtime divides by it, so that a
     species is read as a share of what birders reported rather than
     a raw count, and May does not look like a migration peak just
     because that is when people go birding. */
  const aves = await cached('key-class-Aves', 90, () => polite('search', 2600,
    'https://api.gbif.org/v1/species/match?strict=true&rank=CLASS&name=Aves', false));
  if (!aves || aves.canonicalName !== 'Aves' || !aves.usageKey) throw new Error('could not resolve class Aves');

  /* The calendar comes down in its own slow lane while the tiles
     come down in theirs. Settled rather than left bare, so a refusal
     surfaces where the result is collected and not as an unhandled
     rejection halfway through something else. */
  const settle = (p) => p.then((v) => ({ ok: v }), (e) => ({ err: e }));
  const effortJob = settle(cached('effort-aves', 20, () => monthsByBand(aves.usageKey)));
  const chronJobs = {};
  for (const sp of CHRON_GROUPS) {
    for (const name of TAXA[sp]) {
      chronJobs[name] = settle(cached('chron-' + keys[name], 20, () => monthsByBand(keys[name])));
    }
  }
  for (const sp of SPECIES) {
    occ[sp] = new Float32Array(NCELL);
    let total = 0;
    const perTaxon = {};
    const months = SEASON_MONTHS[sp] || null;
    for (const name of TAXA[sp]) {
      const S = await density(keys[name], name, months, land);
      perTaxon[name] = S.grid;
      for (let k = 0; k < NCELL; k++) occ[sp][k] += S.grid[k];
      total += S.placed;
      harvest.push({ name: name, records: S.placed, months: months ? months.join(',') : 'all' });
      process.stderr.write('  ' + sp + ' / ' + name + ': ' + S.placed + ' records in ' +
        S.bins + ' squares' + (months ? ', months ' + months.join(',') : '') + '\n');
    }
    if (total < 500) throw new Error(sp + ' returned only ' + total + ' records - refusing to ship it');
    if (COMPOSITION.indexOf(sp) >= 0) composition[sp] = perTaxon;
    /* Normalise to a unit total before it joins the effort sum. Without
       this, a species whose download hit the record cap contributes fewer
       counts than one that did not, and its share - the whole point of the
       denominator - comes out understated through no fault of the birds. */
    let tot = 0;
    for (let k = 0; k < NCELL; k++) tot += occ[sp][k];
    if (tot > 0) for (let k = 0; k < NCELL; k++) occ[sp][k] /= tot;
    for (let k = 0; k < NCELL; k++) effort[k] += occ[sp][k];
  }

  /* Share of game records, so a cell watched by a thousand birders and a
     cell watched by one are judged the same way. */
  const effortS = smooth(effort, 3);
  const out = {}, presOut = {};
  const report = [];
  for (const sp of SPECIES) {
    const occS = smooth(occ[sp], 3);
    const share = new Float32Array(NCELL);
    for (let k = 0; k < NCELL; k++) {
      share[k] = effortS[k] > 1e-9 ? occS[k] / effortS[k] : 0;
    }
    /* Normalise against this species' own 97th percentile - species differ
       enormously in how often they are reported, and what matters is where
       this one is relative to where else it is. */
    const nz = Array.from(share).filter((v) => v > 0).sort((a, b) => a - b);
    const p97 = nz.length ? nz[Math.floor(nz.length * 0.97)] : 1;

    const band = ELEV[sp], suit = SUIT[sp], satK = SATURATE[sp] || 0;
    const suitPairs = Object.keys(suit).map((c) => [+c, suit[c]]);
    const vals = new Uint8Array(NCELL);
    const ducks = sp === 'waterfowl' ? waterfowlSuit(lc, rice) : null;
    for (let k = 0; k < NCELL; k++) {
      if (!lc.total[k]) continue;
      let s = 0;
      for (let q = 0; q < suitPairs.length; q++) {
        const arr = lc.counts.get(suitPairs[q][0]);
        if (arr) s += suitPairs[q][1] * (arr[k] / lc.total[k]);
      }
      /* Pronghorn live on ground they can see across and run on. Land
         cover cannot tell a sage flat from a sage mountainside, so
         every range in Nevada and the whole Colorado high country
         scored as antelope ground. Relief can: the spread of elevation
         inside the cell, full value under 250 feet and nothing by
         1100. */
      if (sp === 'pronghorn') s *= 1 - clamp01((ev.reliefFt[k] - 250) / 850);
      if (ducks) s = ducks[k] * elevFactor(ev.meanFt[k], band);
      else {
        s *= elevFactor(ev.meanFt[k], band);
        if (satK) s = 1 - Math.exp(-satK * s);
      }
      /* Coldwater is applied to the finished value rather than to
         the land-cover term, so a cold creek with almost no mapped
         water still clears the floor. */

      /* Presence gate. Full weight once the species is as common here
         as it is anywhere, with a short toe so a cell just outside the
         recorded range is reduced rather than erased.

         The toe was 0.12, which meant a cell with no records at all
         still kept an eighth of whatever its land cover was worth. For
         a species whose cover looks plausible where it does not live,
         that is enough to clear the habitat floor: Nevada and the Utah
         west desert both scored for whitetail on shrub cover and zero
         deer. 0.04 keeps the softness at the edge of a range without
         inventing one. */
      const pres = clamp01(Math.pow(clamp01(share[k] / p97), 0.45));
      /* Suitability only. The runtime multiplies in presence with a
         per-species weighting - see habgrid.js - so that the balance
         between "the ground looks right" and "something has actually
         been seen here" can be set per species and measured against
         the validation set without rebuilding.

         Trout keeps its coldwater term here because that is a
         property of the water rather than of the records. */
      vals[k] = Math.round(clamp01(sp === 'trout' ? s * cold[k] : s) * 255);
    }
    out[sp] = Buffer.from(vals).toString('base64');

    /* Presence, downsampled by taking the strongest value in each
       coarse cell rather than the mean: a range edge should not be
       eroded by the empty ground beyond it. */
    const pv = new Uint8Array(PRES_NLON * PRES_NLAT);
    for (let iy = 0; iy < NLAT; iy++) {
      const cy = Math.floor((iy * D) / PRES_D);
      for (let ix = 0; ix < NLON; ix++) {
        const cx = Math.floor((ix * D) / PRES_D);
        const q = Math.round(255 * clamp01(Math.pow(clamp01(share[iy * NLON + ix] / p97), 0.45)));
        const o = cy * PRES_NLON + cx;
        if (q > pv[o]) pv[o] = q;
      }
    }
    presOut[sp] = Buffer.from(pv).toString('base64');
    let above = 0;
    for (let k = 0; k < NCELL; k++) if (vals[k] > 18) above++;   // suitability only
    report.push(sp + ': ' + above + ' cells above the range floor');
  }
  process.stderr.write('  ' + report.join('\n  ') + '\n');

  const effortRes = await effortJob;
  if (effortRes.err) throw effortRes.err;
  const effortChron = effortRes.ok;
  for (const name of Object.keys(chronJobs)) {
    const r = await chronJobs[name];
    if (r.err) throw r.err;
    chronology[name] = r.ok;
    process.stderr.write('  calendar / ' + name + '\n');
  }

  /* Chronology: raw counts per band per month, rounded. Kept as
     counts rather than a fitted curve so the runtime can decide how
     much to trust a thin band. */
  const chronOut = {};
  for (const sp of Object.keys(chronology)) {
    chronOut[sp] = Array.from(chronology[sp]).map((v) => Math.round(v));
  }

  /* Composition: each taxon as a share of its group, on the coarse
     grid, one byte per cell. */
  const compOut = {};
  for (const grp of Object.keys(composition)) {
    const taxa = Object.keys(composition[grp]);
    const coarse = {}, totals = new Float64Array(COMP_NLON * COMP_NLAT);
    for (const tx of taxa) {
      const c = new Float64Array(COMP_NLON * COMP_NLAT);
      const src = composition[grp][tx];
      for (let iy = 0; iy < NLAT; iy++) {
        const cy = Math.floor((iy * D) / COMP_D);
        for (let ix = 0; ix < NLON; ix++) {
          const cx = Math.floor((ix * D) / COMP_D);
          const v = src[iy * NLON + ix];
          if (!v) continue;
          c[cy * COMP_NLON + cx] += v;
          totals[cy * COMP_NLON + cx] += v;
        }
      }
      /* Blurred across its neighbours first. A half-degree cell with
         forty records in it is not a stable place to read a ratio
         between eleven species from. */
      coarse[tx] = blur3(c, COMP_NLON, COMP_NLAT);
    }
    totals.fill(0);
    for (const tx of taxa) for (let k = 0; k < totals.length; k++) totals[k] += coarse[tx][k];
    const grpOut = {};
    for (const tx of taxa) {
      const b = new Uint8Array(COMP_NLON * COMP_NLAT);
      for (let k = 0; k < b.length; k++) {
        b[k] = totals[k] > 0 ? Math.round(255 * coarse[tx][k] / totals[k]) : 0;
      }
      grpOut[tx] = Buffer.from(b).toString('base64');
    }
    compOut[grp] = grpOut;
  }

  const js = 'window.US_HABITAT=' + JSON.stringify({
    source: 'NLCD 2021 land cover (MRLC), USDA NASS Cropland Data Layer ' + CDL_YEAR + ' (rice), AWS terrarium elevation, ' +
            'GBIF occurrence records 2015-2025 (CC0 and CC-BY only)',
    note: 'Land cover and elevation set habitat quality; GBIF occurrence share gates presence. ' +
          'Modelled suitability, not a census and not an abundance estimate. Occurrence records ' +
          'filtered to CC0 and CC-BY so the layer can be used commercially; CC-BY requires ' +
          'attribution to the contributing datasets.',
    built: new Date().toISOString().slice(0, 10),
    grid: { lon0: LON0, lat0: LAT0, d: D, nlon: NLON, nlat: NLAT },

    /* What the occurrence layers were counted from: every matching
       record per taxon, and over which months. Complete counts from
       GBIF's map service, not a sample. */
    harvest: harvest,
    sp: out,

    /* Occurrence presence, separate from suitability so the runtime
       can weight them per species. */
    presence: {
      grid: { lon0: LON0, lat0: LAT0, d: PRES_D, nlon: PRES_NLON, nlat: PRES_NLAT },
      sp: presOut
    },

    /* Hunting pressure from developed land cover, replacing a list
       of hand-weighted metro blobs. */
    pressure: Buffer.from(quantise(press)).toString('base64'),

    /* Occurrence counts by latitude band and calendar month, per
       taxon. Keyed by taxon rather than by group, because ducks and
       these rather than from a hardcoded peak day and width. */
    chronology: {
      bandDeg: CHRON_BAND_DEG, bands: CHRON_BANDS, lat0: LAT0,
      /* All bird records, same bands and months: the denominator. */
      effort: Array.from(effortChron).map((v) => Math.round(v)),
      sp: chronOut
    },

    /* Share of each taxon within its group, so advice can name the
       birds that are actually there. */
    composition: {
      grid: { lon0: LON0, lat0: LAT0, d: COMP_D, nlon: COMP_NLON, nlat: COMP_NLAT },
      sp: compOut
    }
  }) + ';\n';
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'habitat-grid.js'), js);
  process.stderr.write('wrote js/habitat-grid.js (' + (js.length / 1024).toFixed(0) + ' KB)\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
