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
  /* Not used as a table - see turkeySuit - but a species needs a row to exist. */
  turkey:    { 41: 1.00, 43: 0.90, 42: 0.75, 90: 0.60 },
  upland:    { 82: 0.88, 71: 0.90, 81: 0.80, 52: 0.70, 41: 0.30, 90: 0.30, 21: 0.15 },
  waterfowl: { 95: 1.00, 90: 0.86, 11: 0.80, 82: 0.70, 81: 0.45, 71: 0.30, 12: 0.05 },
  /* Not used as a table - see gooseSuit - but a species needs a row to exist. */
  goose:     { 82: 1.00, 81: 0.70, 71: 0.30, 95: 0.30 },
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
const SATURATE = { whitetail: 7, waterfowl: 4, trout: 30 };

/* MAPPED BUT NOT RECORDED.

   Whitetail range is the occurrence records and the USGS map together
   (see ingest/usgs-range.mjs for why). Where there are records, the
   land cover table is taken at face value, shrub included, because
   the brush country of south Texas is shrub and is the best whitetail
   ground there is. Where only the map says they are present - the
   western Dakotas, the Montana river valleys, the Bighorn Basin - the
   deer are in the hay, the grain and the cottonwoods, and the sage
   round them is empty. Land cover cannot tell mesquite from sagebrush,
   so for that ground the classes listed here are left out, and the
   result is written as a second plane. */
const UNRECORDED_SKIP = { whitetail: [52] };

/* Elk and open ground - see where it is applied. */
const ELK_REFUGE = { forest: 0.125, relief: [60, 300], low: 0.30 };

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
  turkey:    [-400, -300, 9300, 10300],
  upland:    [-400, -300, 10500, 12000],
  waterfowl: [-400, -300, 9500, 11800],
  goose:     [-400, -300, 9300, 10300],
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
  /* Sixteen birds, not nine. The first list was the birds of the plains
     and the Great Lakes, and left out the quail of the Southwest and
     the grouse of the western mountains entirely: with no Gambel's
     quail in it, the records round Tucson came out 88 percent pheasant,
     on a handful of released birds, and the advice followed. */
  upland:    ['Phasianus colchicus', 'Colinus virginianus', 'Tympanuchus phasianellus',
              'Centrocercus urophasianus', 'Bonasa umbellus', 'Callipepla californica',
              'Alectoris chukar', 'Perdix perdix', 'Tympanuchus cupido',
              'Callipepla gambelii', 'Callipepla squamata', 'Cyrtonyx montezumae',
              'Oreortyx pictus', 'Dendragapus obscurus', 'Dendragapus fuliginosus',
              'Canachites canadensis'],
  waterfowl: ['Anas platyrhynchos', 'Anas acuta', 'Mareca americana', 'Spatula discors',
              'Aythya affinis', 'Aythya valisineria', 'Anas crecca', 'Mareca strepera',
              'Branta canadensis', 'Anser caerulescens',
              /* The bird the Bighorn check said was missing: 1056
                 records there against 279 pintail, and the one you
                 would actually decoy on a cold tailwater. */
              'Bucephala clangula',
              /* And the ones the South and the East said were missing.
                 Wood ducks are most of the early bag from Maine to
                 Louisiana, ringnecks are Florida's duck, black ducks
                 the Northeast's, mottled ducks the Gulf's, redheads
                 the Laguna Madre's - and with none of them in the
                 list, the spread for the ACE Basin was blue-winged
                 teal. Specklebellies for the same reason on the
                 goose side. */
              'Aix sponsa', 'Aythya collaris', 'Anas rubripes', 'Anas fulvigula',
              'Aythya americana', 'Spatula clypeata', 'Anser albifrons'],
  /* Geese on their own as well, because where a goose is hunted is not
     where a duck is: see gooseSuit. The same records as above, counted
     once - the downloads are shared. */
  goose:     ['Branta canadensis', 'Anser caerulescens', 'Anser albifrons'],
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
const SEASON_MONTHS = { waterfowl: [9, 10, 11, 12, 1], goose: [9, 10, 11, 12, 1] };

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

/* Mean air temperature over a run of weeks, degrees F, at every cell:
   the three nearest stations by inverse distance, each moved to the
   cell's own elevation. NaN where there is nothing to go on. */
function normalsGrid(meanFt, week0, week1) {
  const N = loadNormals();
  const out = new Float32Array(NCELL).fill(NaN);
  if (!N) return out;
  const MISSING = -9999, LAPSE = 0.00357;

  const meanF = new Float32Array(N.n);
  for (let i = 0; i < N.n; i++) {
    let sum = 0, c = 0;
    for (let w = week0; w <= week1; w++) {
      const o = i * 52 + w;
      if (N.TX[o] === MISSING || N.TN[o] === MISSING) continue;
      sum += (N.TX[o] + N.TN[o]) / 20; c++;
    }
    meanF[i] = c ? sum / c : NaN;
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
        if (!isFinite(meanF[i])) continue;
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
        num += (meanF[b[1]] + lapse) * w; den += w;
      }
      if (den) out[k] = num / den;
    }
  }
  return out;
}

function coldwaterGrid(meanFt) {
  const july = normalsGrid(meanFt, 27, 31);
  const out = new Float32Array(NCELL);
  for (let k = 0; k < NCELL; k++) {
    const t = july[k];
    if (!isFinite(t)) { out[k] = 0.5; continue; }
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

/* ---------- trout water ----------

   THE TROUT MAP USED TO BE A LIST. Twenty rivers drawn as ovals in
   env.js, and nothing outside them: of 57 well-known trout waters the
   app found 27. This plane existed the whole time and was never read,
   and would not have done much better if it had been, for two reasons
   that are both fixed below.

   IT WANTED TO SEE THE WATER. Suitability was the share of the cell
   mapped as open water, and a trout stream is narrower than a pixel.
   Penns Creek, the Beaverkill and every creek in the Driftless read
   zero. Mapped water still counts - a river wide enough to map is a
   bigger fishery - but it is a bonus on top of TROUT_STREAM now, not
   the condition. In country cold enough for trout there is a stream.

   IT GUESSED AT TAILWATERS. A gauge with DAM in its name and either a
   decent flow or a cold reading on the day of the build was taken for
   a cold release. In October every river is cold, and a navigation
   dam on the Ohio has plenty of flow. The measurement exists: USGS
   publishes monthly mean water temperature for every gauge that
   records it, about 2,800 of them. The mean for July and August is
   what a trout has to live through, and it finds the tailwaters, the
   spring creeks and the high freestones without being told which is
   which - 11 C on the Chattahoochee below Buford Dam, in Georgia.

   So, for each cell:

     cold      the warmer-month air temperature (as before), or a gauge
               nearby that measures cold water in summer, or a named
               tailwater or spring creek from js/trout-waters.js,
               whichever says coldest
     occupied  trout recorded there (GBIF, open licences), or a
               self-sustaining population in the USGS Nonindigenous
               Aquatic Species database, or a named water

   Only "established" NAS records are used. Most of that database is
   stocking records, and a pond stocked for a winter fishing derby in
   Ames is not trout water. */

/* What a cell with trout seen in it is worth with no water mapped in it
   at all. Mapped water adds the rest - but only river-sized water. A
   cell that is mostly open water is a lake, a reservoir or the sea:
   Seattle scored 91 on the strength of Puget Sound. A river two hundred
   yards wide is under 2 percent of a cell, so the bonus fades out
   between TROUT_LAKE[0] and TROUT_LAKE[1] of the cell under water.

   And a city is not good trout water whatever has been photographed in
   it. Pavement is what ends a trout stream, and it is also where the
   people with cameras are. Built-up ground takes up to TROUT_CITY[2] off
   a cell, fading in between the first two numbers as a share of the
   cell - except on a named water, because the Lower Sacramento runs
   through the middle of Redding and is none the worse for it. */
const TROUT_STREAM = 0.6;
const TROUT_LAKE = [0.08, 0.30];
const TROUT_CITY = [0.15, 0.50, 0.65];

/* Degrees C, July and August mean: full credit at or below, none at or above. */
const SUMMER_COLD = 18, SUMMER_WARM = 23;
const SUMMER_SINCE = 2005, SUMMER_REACH_KM = 20, SUMMER_PLATEAU_KM = 8;

const NAS_TAXA = [['Salmo', 'trutta'], ['Oncorhynchus', 'mykiss'], ['Salvelinus', 'fontinalis'], ['Oncorhynchus', 'clarkii']];

function loadWindow(file, name) {
  try {
    const win = {};
    new Function('window', readFileSync(resolve(HERE, '..', 'js', file), 'utf8'))(win);
    return win[name] || null;
  } catch (e) { return null; }
}

/* Mean July-August water temperature at every gauge that has one. */
async function summerWater() {
  const raw = loadWindow('gauges.js', 'US_GAUGES');
  if (!raw || !raw.sites) return [];
  const sites = raw.sites.filter((g) => typeof g[4] === 'number' && typeof g[2] === 'number' && typeof g[3] === 'number');
  const means = await cached('nwis-summer-water-' + sites.length, 120, async () => {
    const out = {};
    for (let i = 0; i < sites.length; i += 10) {
      const ids = sites.slice(i, i + 10).map((g) => g[0]);
      let text = '';
      for (let attempt = 0; attempt < 4 && !text; attempt++) {
        try {
          const r = await fetch('https://waterservices.usgs.gov/nwis/stat/?format=rdb&sites=' + ids.join(',') +
            '&statReportType=monthly&statTypeCd=mean&parameterCd=00010', { headers: { 'User-Agent': 'OmniGuide/ingest' }, signal: AbortSignal.timeout(60000) });
          if (r.status === 404) { text = '#'; break; }          // none of these ten has statistics
          if (r.ok) text = await r.text(); else await sleep(2500 * (attempt + 1));
        } catch (e) { await sleep(2500 * (attempt + 1)); }
      }
      if (!text) throw new Error('USGS statistics service would not answer for ' + ids.join(','));
      const acc = {};
      for (const line of text.split('\n')) {
        if (!line || line[0] === '#') continue;
        const c = line.split('\t');
        if (c[0] !== 'USGS') continue;
        const year = +c[5], month = +c[6], v = parseFloat(c[7]);
        if (year < SUMMER_SINCE || (month !== 7 && month !== 8) || !isFinite(v)) continue;
        const a = acc[c[1]] || (acc[c[1]] = [0, 0]);
        a[0] += v; a[1]++;
      }
      for (const id of Object.keys(acc)) if (acc[id][1] >= 2) out[id] = [Math.round(acc[id][0] / acc[id][1] * 10) / 10, acc[id][1]];
      if (i % 500 === 0) process.stderr.write('    summer water ' + i + '/' + sites.length + String.fromCharCode(13));
      await sleep(120);
    }
    return out;
  });
  const list = [];
  for (const g of sites) if (means[g[0]]) list.push({ id: g[0], name: g[1], lat: g[2], lon: g[3], c: means[g[0]][0], n: means[g[0]][1] });
  process.stderr.write('  ' + list.length + ' gauges with a July-August water temperature' + String.fromCharCode(10));
  return list;
}

function summerColdGrid(list) {
  const out = new Float32Array(NCELL);
  for (const g of list) {
    const score = clamp01((SUMMER_WARM - g.c) / (SUMMER_WARM - SUMMER_COLD));
    if (score <= 0) continue;
    const kmPerLon = 111.32 * Math.cos(g.lat * Math.PI / 180);
    const dLat = SUMMER_REACH_KM / 111.32, dLon = SUMMER_REACH_KM / kmPerLon;
    for (let iy = Math.max(0, Math.floor((g.lat - dLat - LAT0) / D)); iy <= Math.min(NLAT - 1, Math.ceil((g.lat + dLat - LAT0) / D)); iy++) {
      for (let ix = Math.max(0, Math.floor((g.lon - dLon - LON0) / D)); ix <= Math.min(NLON - 1, Math.ceil((g.lon + dLon - LON0) / D)); ix++) {
        const ex = (LON0 + (ix + 0.5) * D - g.lon) * kmPerLon, ey = (LAT0 + (iy + 0.5) * D - g.lat) * 111.32;
        const dist = Math.sqrt(ex * ex + ey * ey);
        if (dist > SUMMER_REACH_KM) continue;
        const v = score * (dist <= SUMMER_PLATEAU_KM ? 1 : 1 - (dist - SUMMER_PLATEAU_KM) / (SUMMER_REACH_KM - SUMMER_PLATEAU_KM));
        const k = cellIdx(ix, iy);
        if (v > out[k]) out[k] = v;
      }
    }
  }
  return out;
}

/* Cells inside a named water, and whether that water is cold by kind. */
function namedTroutGrid() {
  const waters = loadWindow('trout-waters.js', 'US_TROUT_WATERS') || [];
  const named = new Uint8Array(NCELL), cold = new Float32Array(NCELL);
  for (const w of waters) {
    for (let iy = Math.max(0, Math.floor((w.lat - w.ry - LAT0) / D)); iy <= Math.min(NLAT - 1, Math.ceil((w.lat + w.ry - LAT0) / D)); iy++) {
      for (let ix = Math.max(0, Math.floor((w.lon - w.rx - LON0) / D)); ix <= Math.min(NLON - 1, Math.ceil((w.lon + w.rx - LON0) / D)); ix++) {
        const ex = (LON0 + (ix + 0.5) * D - w.lon) / w.rx, ey = (LAT0 + (iy + 0.5) * D - w.lat) / w.ry;
        if (ex * ex + ey * ey > 1) continue;
        const k = cellIdx(ix, iy);
        named[k] = 1;
        if (w.cls !== 'freestone') cold[k] = 1;
      }
    }
  }
  process.stderr.write('  ' + waters.length + ' named trout waters' + String.fromCharCode(10));
  return { named, cold };
}

/* Self-sustaining trout populations, from the USGS Nonindigenous Aquatic
   Species database. Public domain. */
async function nasEstablished() {
  const grid = new Float32Array(NCELL);
  let used = 0, seen = 0;
  for (const [genus, species] of NAS_TAXA) {
    const rows = await cached('nas-established-' + genus + '-' + species, 120, async () => {
      const all = [];
      for (let offset = 0; ; offset += 1000) {
        const j = await polite('nas', 400, 'https://nas.er.usgs.gov/api/v2/occurrence/search?genus=' + genus +
          '&species=' + species + '&status=established&limit=1000&offset=' + offset, false);
        for (const r of j.results) all.push([r.decimalLatitude, r.decimalLongitude, r.status || '', r.year || 0, r.latLongAccuracy || '']);
        if (j.results.length < 1000) break;
      }
      return all;
    });
    seen += rows.length;
    for (const r of rows) {
      /* Accurate locations only. 'Approximate' turned out to mean a point
         standing for a whole drainage: one such, labelled Republican
         River, put trout on the Colorado plains forty miles from the
         spring-fed fork that actually has them. */
      if (r[2] !== 'established' || r[4] !== 'Accurate') continue;
      const ix = Math.floor((r[1] - LON0) / D), iy = Math.floor((r[0] - LAT0) / D);
      if (ix < 0 || iy < 0 || ix >= NLON || iy >= NLAT) continue;
      grid[cellIdx(ix, iy)]++; used++;
    }
  }
  process.stderr.write('  NAS: ' + used + ' established trout records of ' + seen + String.fromCharCode(10));
  return grid;
}

/* How sure it is that there are trout in a cell, 0 to 1.

   SEEN HERE. A record in the cell or one beside it - a river does not
   stop at a cell edge. An established population in the USGS database
   or a named water counts in full. An ordinary record counts by how
   cold the place is: where the water is cold outright one is nearly
   enough, and where it is only marginal it takes several, because one
   photograph of a trout from a pond east of Denver is a stocking truck
   and not a fishery. TROUT_RECORDS is how many it takes, marginal to
   cold, and below TROUT_RECORDS_COLD no number of them is enough:
   several people had logged trout from a stocked lake on the Colorado
   plains, and that is still not trout water. Water that warm needs a
   gauge, an established population or a name to vouch for it.

   SEEN ALL ROUND counts for less, and how much of the country round
   about has to hold trout before it counts at all also depends on how
   cold the place is. Both halves of that were needed. In cold country
   a stream with no record is still a trout stream: the north Maine
   woods have almost nobody logging fish in them and a brook trout in
   every brook, and with one bar for everywhere Maine came out 46
   percent trout water. In marginal country it is not: with the same
   bar, southern Michigan farmland with no record anywhere near scored
   76, and two thirds of Ohio was in range on the strength of the Mad
   River and the Lake Erie steelhead streams. So the bar slides, from
   TROUT_NEED[0] of the surrounding cells where the water is only just
   cold enough to TROUT_NEED[1] where it is cold outright, and ground
   that is in on its surroundings alone is capped at TROUT_UNSEEN.

   STREAM COUNTRY. Neither is enough on its own in the West, where a
   basin can be cold, ringed by trout mountains, and dry: the Red
   Desert came in on its neighbours with no stream in it. Ground with
   no trout seen on it has to look like it holds water - timber, or
   mapped water and wetland - before its surroundings count.

   COLD, TIMBERED AND SLOPING IS PRESUMED. There are places the records
   do not reach at all. Around the Allagash one cell in a hundred has a
   trout logged in it; in northern Wisconsin, six. Where the water is
   cold outright, the country is stream country and the ground has some
   fall to it, trout are presumed at TROUT_PRESUMED. The fall matters:
   the Red Lake peatlands are as cold and as wet as the Allagash and
   have no trout streams, and what tells them apart is a few feet of
   relief against a hundred and thirty. Mountains count as stream
   country on their relief alone, since above the trees - the Wind
   Rivers, the Frank Church - there is no timber to go by. */
const TROUT_RECORDS = [6, 0.7], TROUT_RECORDS_COLD = 0.55;
const TROUT_NEED = [0.60, 0.12], TROUT_NEED_WIDTH = 0.20;
const TROUT_COLD_BAND = [0.60, 1.00];
const TROUT_UNSEEN = 0.50, TROUT_PRESUMED = 0.40, TROUT_PRESUMED_COLD = 0.95;
const TROUT_PRESUMED_RELIEF = [10, 60];         // feet of relief inside the cell
const TROUT_ROUND = 12;                         // cells either way: about 80 miles
const STREAM_FOREST = [0.15, 0.40], STREAM_WET = [0.01, 0.04];   // share of the 3 by 3 round a cell
const STREAM_RELIEF = [300, 600];                                // feet

function troutEvidence(count, nas, named, cold, land, counts, reliefFt) {
  const sure = new Float32Array(NCELL), seen = new Uint8Array(NCELL), here = new Uint8Array(NCELL);
  for (let iy = 0; iy < NLAT; iy++) {
    for (let ix = 0; ix < NLON; ix++) {
      const k = cellIdx(ix, iy);
      if (!land[k]) continue;
      let full = named[k] ? 1 : 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = ix + dx, y = iy + dy;
          if (x < 0 || y < 0 || x >= NLON || y >= NLAT) continue;
          const j = cellIdx(x, y);
          if (nas[j] > 0) full = 1;
          n += count[j];
        }
      }
      const c = clamp01((cold[k] - TROUT_RECORDS_COLD) / (1 - TROUT_RECORDS_COLD));
      const takes = TROUT_RECORDS[0] + (TROUT_RECORDS[1] - TROUT_RECORDS[0]) * c;
      sure[k] = full ? 1 : n > 0 && cold[k] > TROUT_RECORDS_COLD ? 1 - Math.exp(-n / takes) : 0;
      here[k] = sure[k] >= 0.5 ? 1 : 0;
    }
  }

  /* Share of land cells round about that are occupied: two running sums. */
  const rowHit = new Float32Array(NCELL), rowLand = new Float32Array(NCELL);
  for (let iy = 0; iy < NLAT; iy++) {
    for (let ix = 0; ix < NLON; ix++) {
      let h = 0, l = 0;
      for (let dx = -TROUT_ROUND; dx <= TROUT_ROUND; dx++) {
        const x = ix + dx;
        if (x < 0 || x >= NLON) continue;
        const j = cellIdx(x, iy);
        if (!land[j]) continue;
        l++; h += here[j];
      }
      rowHit[cellIdx(ix, iy)] = h; rowLand[cellIdx(ix, iy)] = l;
    }
  }

  /* Does it look like stream country: share of timber, and of water and
     wetland, in the nine cells round each one. */
  const share = (classes) => {
    const own = new Float32Array(NCELL);
    for (const c of classes) { const arr = counts.get(c); if (arr) for (let k = 0; k < NCELL; k++) if (land[k]) own[k] += arr[k] / land[k]; }
    const nine = new Float32Array(NCELL);
    for (let iy = 0; iy < NLAT; iy++) for (let ix = 0; ix < NLON; ix++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = ix + dx, y = iy + dy;
        if (x < 0 || y < 0 || x >= NLON || y >= NLAT || !land[cellIdx(x, y)]) continue;
        sum += own[cellIdx(x, y)]; n++;
      }
      nine[cellIdx(ix, iy)] = n ? sum / n : 0;
    }
    return nine;
  };
  const timber = share([41, 42, 43, 90]), wet = share([11, 90, 95]);

  const round = new Float32Array(NCELL), unseen = new Float32Array(NCELL);
  for (let iy = 0; iy < NLAT; iy++) {
    for (let ix = 0; ix < NLON; ix++) {
      const k = cellIdx(ix, iy);
      if (!land[k]) continue;
      let h = 0, l = 0;
      for (let dy = -TROUT_ROUND; dy <= TROUT_ROUND; dy++) {
        const y = iy + dy;
        if (y < 0 || y >= NLAT) continue;
        h += rowHit[cellIdx(ix, y)]; l += rowLand[cellIdx(ix, y)];
      }
      round[k] = l > 0 ? h / l : 0;
      const c = clamp01((cold[k] - TROUT_COLD_BAND[0]) / (TROUT_COLD_BAND[1] - TROUT_COLD_BAND[0]));
      const need = TROUT_NEED[0] + (TROUT_NEED[1] - TROUT_NEED[0]) * c;
      const relief = isFinite(reliefFt[k]) ? reliefFt[k] : 0;
      const country = Math.max(
        clamp01((timber[k] - STREAM_FOREST[0]) / (STREAM_FOREST[1] - STREAM_FOREST[0])),
        clamp01((wet[k] - STREAM_WET[0]) / (STREAM_WET[1] - STREAM_WET[0])),
        clamp01((relief - STREAM_RELIEF[0]) / (STREAM_RELIEF[1] - STREAM_RELIEF[0])));
      const fromRound = TROUT_UNSEEN * clamp01((round[k] - need) / TROUT_NEED_WIDTH);
      const fall = clamp01((relief - TROUT_PRESUMED_RELIEF[0]) / (TROUT_PRESUMED_RELIEF[1] - TROUT_PRESUMED_RELIEF[0]));
      const presumed = cold[k] >= TROUT_PRESUMED_COLD ? TROUT_PRESUMED * fall : 0;
      unseen[k] = country * Math.max(fromRound, presumed);
      /* Seen, for what the cell is worth, if the record says more than
         the surroundings do. */
      seen[k] = sure[k] >= unseen[k] && sure[k] > 0 ? 1 : 0;
    }
  }
  const out = new Float32Array(NCELL);
  for (let k = 0; k < NCELL; k++) out[k] = seen[k] ? sure[k] : unseen[k];

  /* How the numbers above were set, and how to set them again: point
     TROUT_DEBUG at a JSON file of { "name": [lon, lat] } and each place
     prints what the rule saw there. */
  if (process.env.TROUT_DEBUG) {
    const probe = JSON.parse(readFileSync(process.env.TROUT_DEBUG, 'utf8'));
    for (const [name, p] of Object.entries(probe)) {
      const k = cellIdx(Math.floor((p[0] - LON0) / D), Math.floor((p[1] - LAT0) / D));
      console.log('TROUT ' + name.padEnd(30) + ' cold ' + cold[k].toFixed(2) + '  seen ' + sure[k].toFixed(2) + '  round ' + round[k].toFixed(2) +
        '  timber ' + timber[k].toFixed(2) + '  wet ' + wet[k].toFixed(3) + '  relief ' + String(Math.round(reliefFt[k])).padStart(4) + '  evidence ' + out[k].toFixed(2) + (seen[k] ? ' (seen)' : ''));
    }
  }
  return { sure: out, seen: seen };
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

/* ---------- upland, bird by bird ----------

   "Upland birds" was one row of the table: grain, grass and brush good,
   timber bad. That is a pheasant. Applied to everything, it scored the
   ruffed grouse woods of northern Wisconsin 37 out of 100 and northern
   Maine 14, and the quail plantations round Albany, Georgia 7 - piney
   woods being, to a pheasant, no cover at all - while a wheat field in
   Kansas scored 79.

   Each bird gets its own row, and a cell is as good as the best bird
   that is actually there. "Actually there" is from the records: a bird
   with a quarter of the upland records round a cell counts in full, and
   less than that counts in proportion. Not a weighted average, because
   the records lean toward birds near roads and towns - at Farson,
   Wyoming more than half are pheasants from the hay meadows, and an
   average would have marked the sage grouse country round them down for
   being poor pheasant ground.

   Two numbers a bird, kept apart. The row is how well each kind of
   cover fits it, and settles which bird a cell is about. The worth is
   how much a cell that fits it should count for, and is a judgement:
   with every bird at full worth, plain sagebrush came out the best
   upland ground in the country on the strength of sage grouse, which
   are thin on the ground and closed or permit-only across much of
   their range, and of valley quail, which live along its creeks and
   not across it.

   Chukar need the ground to be steep as well as brushy. */
const UPLAND_BIRDS = {
  'Phasianus colchicus':       { 71: 1.00, 82: 0.95, 81: 0.78, 95: 0.67, 52: 0.28, 21: 0.11 },
  'Perdix perdix':             { 82: 1.00, 71: 0.95, 81: 0.70, 52: 0.35 },
  'Tympanuchus phasianellus':  { 71: 1.00, 52: 0.65, 81: 0.60, 82: 0.45, 41: 0.25 },
  'Tympanuchus cupido':        { 71: 1.00, 81: 0.60, 82: 0.50 },
  'Centrocercus urophasianus': { 52: 1.00, 71: 0.45 },
  'Colinus virginianus':       { 71: 1.00, 52: 0.95, 82: 0.60, 42: 0.53, 81: 0.47, 43: 0.35, 41: 0.18 },
  'Callipepla californica':    { 52: 1.00, 90: 0.85, 71: 0.65, 82: 0.50, 81: 0.50, 41: 0.45, 43: 0.40, 42: 0.10 },
  'Callipepla gambelii':       { 52: 1.00, 90: 0.60, 71: 0.50, 42: 0.30, 82: 0.30 },
  'Callipepla squamata':       { 71: 1.00, 52: 0.95, 81: 0.35 },
  'Cyrtonyx montezumae':       { 42: 1.00, 71: 1.00, 43: 0.90, 41: 0.80, 52: 0.30 },
  'Oreortyx pictus':           { 52: 1.00, 43: 0.80, 42: 0.75, 41: 0.60 },
  'Alectoris chukar':          { 52: 1.00, 71: 0.85, 31: 0.45 },
  'Bonasa umbellus':           { 43: 1.00, 41: 0.95, 52: 0.90, 90: 0.85, 42: 0.55 },
  'Dendragapus obscurus':      { 42: 1.00, 43: 1.00, 41: 0.85, 52: 0.15, 71: 0.15 },
  'Dendragapus fuliginosus':   { 42: 1.00, 43: 1.00, 41: 0.60, 52: 0.15 },
  'Canachites canadensis':     { 42: 1.00, 90: 0.90, 43: 0.70 }
};
const UPLAND_WORTH = {
  'Phasianus colchicus': 0.90, 'Perdix perdix': 0.85, 'Tympanuchus phasianellus': 1.00, 'Tympanuchus cupido': 1.00,
  'Centrocercus urophasianus': 0.55, 'Colinus virginianus': 0.85, 'Callipepla californica': 0.60,
  'Callipepla gambelii': 0.80, 'Callipepla squamata': 0.85, 'Cyrtonyx montezumae': 0.70, 'Oreortyx pictus': 0.75,
  'Alectoris chukar': 0.90, 'Bonasa umbellus': 0.90, 'Dendragapus obscurus': 0.75, 'Dendragapus fuliginosus': 0.75,
  'Canachites canadensis': 0.50
};
const UPLAND_COUNTS_IN_FULL = 0.25;       // share of the upland records round a cell
const UPLAND_ROUND = 4;                   // cells either way the records are pooled over
const CHUKAR_STEEP = [120, 450];          // feet of relief inside the cell

/* Three things the one-bird maps showed up, each of them hidden while
   another bird's cover was there to take the cell:

   Valley quail had conifer forest at 0.40, and were on the crest of the
   Oregon Cascades and in the middle of the Olympics. Now 0.10.

   The blue grouse had sagebrush at 0.65, and the lava desert east of
   Arco, Idaho read 0.60 for them. They use the sage at the edge of
   timber, not sage on its own: 0.15.

   Mearns quail are birds of oak and grass on hills, and had desert
   brush at 0.85: the floor of the Sulphur Springs valley read 0.83
   beside the Chiricahuas at 0.91. Brush is now 0.30, and the flattest
   ground is faded as well. Only faded, and only the flattest, because
   relief does not tell these apart the way it does for chukar - the
   Sonoita grasslands, which are the real thing, read 212 feet and the
   valley floors 125 to 163. */
const MEARNS_HILLS = [60, 180];           // feet of relief inside the cell

/* Ruffed grouse do best where winter is long: the aspen and birch
   country of the Lake States and the north-east. Land cover cannot tell
   that from an oak ridge in West Virginia - both are deciduous forest -
   and scored the oak ridge higher, because it has fewer lakes and bogs
   in it. January mean air temperature can: full worth at 18 F or
   colder, down to about two thirds at 28 F or warmer. This is a stand-in
   for the kind of forest, chosen for that reason, and not a measurement
   of grouse. */
const GROUSE_WINTER = [18, 28], GROUSE_SOUTH = 0.65;

/* Pheasants and Huns are farmland birds that need grass in the farmland.
   Scored as a plain sum, a cell of unbroken native grass came out the
   best pheasant ground there is, and so did a cell of unbroken corn.
   For these two the grain and the grass each count for a part, and the
   lesser of the two counts again: [each, both]. A judgement, like the
   table above. */
const GRAIN_AND_GRASS = { 'Phasianus colchicus': [0.40, 2.0], 'Perdix perdix': [0.50, 1.5] };

function uplandSuit(lc, reliefFt, perTaxon, januaryF) {
  const names = Object.keys(UPLAND_BIRDS).filter((n) => perTaxon[n]);
  const near = {}, total = new Float32Array(NCELL);
  for (const n of names) {
    near[n] = smooth(perTaxon[n], UPLAND_ROUND);
    for (let k = 0; k < NCELL; k++) total[k] += near[n][k];
  }
  const rows = names.map((n) => [n, Object.keys(UPLAND_BIRDS[n]).map((c) => [lc.counts.get(+c), UPLAND_BIRDS[n][c], +c])]);
  const bareArr = lc.counts.get(31);
  const out = new Float32Array(NCELL), lead = new Uint8Array(NCELL);
  /* How well the cover fits each bird, whether or not the bird is
     there: what the one-bird maps are made from. */
  const fits = {};
  for (const n of names) fits[n] = new Float32Array(NCELL);
  for (let k = 0; k < NCELL; k++) {
    if (!lc.total[k]) continue;
    const bare = bareArr ? bareArr[k] / lc.total[k] : 0;
    let best = 0, bestFit = 0, who = 0;
    for (let i = 0; i < rows.length; i++) {
      const n = rows[i][0], pairs = rows[i][1];
      let fit = 0, grain = 0;
      for (const [arr, w, c] of pairs) {
        if (!arr) continue;
        const part = arr[k] / lc.total[k];
        if (c === 82 && GRAIN_AND_GRASS[n]) grain = part;
        else fit += w * part;
      }
      if (GRAIN_AND_GRASS[n]) {
        const g = GRAIN_AND_GRASS[n];
        fit = clamp01(g[0] * (grain + fit) + g[1] * Math.min(grain, fit));
      }
      if (n === 'Alectoris chukar') {
        fit *= clamp01(((isFinite(reliefFt[k]) ? reliefFt[k] : 0) - CHUKAR_STEEP[0]) / (CHUKAR_STEEP[1] - CHUKAR_STEEP[0]));
      } else {
        if (n === 'Cyrtonyx montezumae') {
          fit *= clamp01(((isFinite(reliefFt[k]) ? reliefFt[k] : 0) - MEARNS_HILLS[0]) / (MEARNS_HILLS[1] - MEARNS_HILLS[0]));
        }
        /* Brush mapped beside bare playa, dune or salt pan is the
           thinnest brush there is, and it was counting the same as a
           brushy foothill. Rock is cover to a chukar and to nothing
           else here, so chukar keep their own term above. */
        fit *= (1 - bare) * (1 - bare);
      }
      let winter = 1;
      if (n === 'Bonasa umbellus' && januaryF && isFinite(januaryF[k])) {
        winter = GROUSE_SOUTH + (1 - GROUSE_SOUTH) *
          clamp01((GROUSE_WINTER[1] - januaryF[k]) / (GROUSE_WINTER[1] - GROUSE_WINTER[0]));
      }
      fits[n][k] = fit * winter;
      if (total[k] <= 0) continue;
      const share = near[n][k] / total[k];
      if (share <= 0) continue;
      fit *= Math.min(1, share / UPLAND_COUNTS_IN_FULL);
      const worth = UPLAND_WORTH[n] * winter;
      if (fit > bestFit) { bestFit = fit; who = i + 1; }
      if (fit * worth > best) best = fit * worth;
    }
    out[k] = best; lead[k] = who;
  }
  /* The bird the cover fits best is kept as well: it is the one the
     advice should be about on this ground. */
  return { val: out, lead: lead, names: [''].concat(names), fits: fits };
}

/* ---------- upland, one bird at a time ----------

   "Upland birds" on the map was one surface for sixteen birds, and the
   only place it said which bird was a line in the plan. Each bird a
   hunter would name gets its own surface as well: how well the cover
   fits it, from uplandSuit, and where it is recorded, counted and
   gated exactly as the other species are - its share of all the game
   records in a place, against its own best.

   The two blue grouse are one entry. They were one species until 2006,
   their ranges do not overlap, and nobody plans a hunt for one of them
   by name. */
const BIRDS = {
  'pheasant':        ['Phasianus colchicus'],
  'bobwhite':        ['Colinus virginianus'],
  'ruffed-grouse':   ['Bonasa umbellus'],
  'sharptail':       ['Tympanuchus phasianellus'],
  'prairie-chicken': ['Tympanuchus cupido'],
  'hun':             ['Perdix perdix'],
  'chukar':          ['Alectoris chukar'],
  'sage-grouse':     ['Centrocercus urophasianus'],
  'valley-quail':    ['Callipepla californica'],
  'gambels-quail':   ['Callipepla gambelii'],
  'scaled-quail':    ['Callipepla squamata'],
  'mearns-quail':    ['Cyrtonyx montezumae'],
  'mountain-quail':  ['Oreortyx pictus'],
  'blue-grouse':     ['Dendragapus obscurus', 'Dendragapus fuliginosus'],
  'spruce-grouse':   ['Canachites canadensis']
};

/* ---------- turkey ----------

   A turkey sleeps in a tree. The table had no way to say so: it added
   up cover of every kind and then flattened the sum, so that a cell of
   nothing but sagebrush came to 0.88 and a cell of nothing but cotton
   to 0.94. Big Bend read 0.87, the San Joaquin valley floor 0.93, the
   Snake River Plain 0.68 - and the Ozarks, 0.99, were not much better
   than any of them.

   Two things are counted instead. Timber is somewhere to roost and
   something to eat in the fall, and without any there are no turkeys
   whatever else is there. It does not take much: a creek bottom of
   cottonwoods through pasture holds Rio Grande birds, so the roost
   term is most of the way to full by a tenth of the cell.

   Then the mix. Turkeys use the woods and the openings beside them -
   fields, pasture, meadow, burn - and ground with both is worth more
   than unbroken timber, which keeps TURKEY_WOODS_ONLY of the value.

   BRUSH. The live oak and juniper of the Texas Hill Country, where
   there are more Rio Grande turkeys than anywhere, is mapped as brush:
   at the test point there the land cover has no timber at all and brush
   over the whole cell, exactly what it has at Organ Pipe in the Sonoran
   desert. Land cover cannot tell those apart, so there are two
   surfaces. One counts timber only, and is what ground is worth where
   the only evidence of turkeys is that someone recorded one. The other
   lets brush stand in for a little timber, and is used only where the
   USGS range map has the bird - see RANGE_WITH_RECORDS in
   js/habgrid.js.

   Even there it has to be earned. The USGS map takes in whole
   watersheds, some of them desert, and with brush counted outright
   Big Bend came back at 0.31 and a quarter of Nevada was turkey range.
   So brush counts in proportion to how well the bird is recorded on
   it: the Texas brush country reads 0.43 to 1.00 on that measure, Big
   Bend 0.10, the Utah and Nevada desert 0.06 and under. */
const TURKEY_TIMBER = { 41: 1.00, 43: 0.90, 42: 0.75, 90: 0.60 };
const TURKEY_OPEN = { 81: 1.00, 82: 0.90, 71: 0.80, 52: 0.50, 21: 0.30 };
const TURKEY_ROOST = 0.03;          // timber share at which the roost term reaches 63%
const TURKEY_WOODS_ONLY = 0.55;
const TURKEY_BOTH = 0.15;           // share of each at which the mix counts in full
const TURKEY_BRUSH = 0.10;          // what a cell of nothing but brush is worth as timber, on mapped range
const TURKEY_BRUSH_SEEN = [0.15, 0.40];   // presence at which brush starts to count, and counts in full

function turkeySuit(lc, presence) {
  const part = (table, k) => {
    let v = 0;
    for (const c of Object.keys(table)) { const a = lc.counts.get(+c); if (a) v += table[c] * a[k] / lc.total[k]; }
    return v;
  };
  const frac = (cls, k) => { const a = lc.counts.get(cls); return a ? a[k] / lc.total[k] : 0; };
  const timber = new Float32Array(NCELL), open = new Float32Array(NCELL);
  for (let k = 0; k < NCELL; k++) {
    if (!lc.total[k]) continue;
    timber[k] = part(TURKEY_TIMBER, k); open[k] = part(TURKEY_OPEN, k);
  }
  /* A roost is used from a mile or two off, and the tally is 25 points
     a cell: the timber counted is the cell's or its neighbours'. */
  const nearTimber = smooth(timber, 1);
  const recorded = new Float32Array(NCELL), mapped = new Float32Array(NCELL);
  const value = (wood, k) => {
    const roost = 1 - Math.exp(-wood / TURKEY_ROOST);
    const mix = clamp01(Math.min(wood, open[k]) / TURKEY_BOTH);
    return roost * (TURKEY_WOODS_ONLY + (1 - TURKEY_WOODS_ONLY) * mix) * (1 - frac(23, k) - frac(24, k));
  };
  for (let k = 0; k < NCELL; k++) {
    if (!lc.total[k]) continue;
    const wood = Math.max(timber[k], nearTimber[k]);
    recorded[k] = value(wood, k);
    const seen = clamp01((presence[k] - TURKEY_BRUSH_SEEN[0]) / (TURKEY_BRUSH_SEEN[1] - TURKEY_BRUSH_SEEN[0]));
    mapped[k] = value(wood + TURKEY_BRUSH * seen * frac(52, k), k);
  }
  /* For checking the rule against places whose answer is known: point
     TURKEY_DEBUG at a JSON file of { "name": [lon, lat] }. */
  if (process.env.TURKEY_DEBUG) {
    const probe = JSON.parse(readFileSync(process.env.TURKEY_DEBUG, 'utf8'));
    for (const [name, p] of Object.entries(probe)) {
      const k = cellIdx(Math.floor((p[0] - LON0) / D), Math.floor((p[1] - LAT0) / D));
      console.log('TURKEY ' + name.padEnd(34) + ' timber ' + timber[k].toFixed(3) + '  round ' + nearTimber[k].toFixed(3) +
        '  open ' + open[k].toFixed(2) + '  brush ' + frac(52, k).toFixed(2) + '  recorded ' + recorded[k].toFixed(2) +
        '  mapped ' + mapped[k].toFixed(2));
    }
  }
  return { recorded: recorded, mapped: mapped };
}

/* ---------- geese ----------

   Geese were scored on the duck surface, which is water and marsh with
   some credit for feed beside it. A goose hunt is the other way up: it
   happens in a field, and the water matters as somewhere to roost within
   a morning's flight. So the Front Range of Colorado - reservoirs in
   winter wheat and corn, and as much Canada goose hunting as anywhere in
   the country - read 0.30, and peaked at 51 out of 100.

   Feed is what is in the cell and the ones beside it: grain first, then
   hay and pasture. Range grass and marsh count for very little - at
   three tenths each they made goose ground of the Chihuahuan desert
   grassland, the tundra of the Wind Rivers and the Everglades.

   Roost is open water or marsh within about fifteen miles, and it adds
   to the value rather than being required for it. It was required, and
   the land cover here is twenty-five samples a cell, which does not see
   a stock tank or a four-hundred-acre lake: Knox City, Texas showed 2
   samples of water in 625 and Middle Creek, Pennsylvania 3, the same as
   Death Valley. Grain with no water in sight keeps half. */
const GOOSE_FEED = { 82: 1.00, 81: 0.70, 71: 0.05, 95: 0.10 };
const GOOSE_FEED_K = 2.4, GOOSE_ROOST = 0.02, GOOSE_NO_ROOST = 0.5;

function gooseSuit(lc, rice) {
  const frac = (cls, k) => { const a = lc.counts.get(cls); return a ? a[k] / lc.total[k] : 0; };
  const feed = new Float32Array(NCELL), roost = new Float32Array(NCELL);
  for (let k = 0; k < NCELL; k++) {
    if (!lc.total[k]) continue;
    const paddy = rice ? rice[k] : 0;
    feed[k] = GOOSE_FEED[82] * frac(82, k) + GOOSE_FEED[81] * frac(81, k) + GOOSE_FEED[71] * frac(71, k) +
              GOOSE_FEED[95] * frac(95, k) + 0.30 * paddy;
    roost[k] = frac(11, k) + frac(95, k) + 0.5 * paddy;
  }
  const nearFeed = smooth(feed, 1), nearRoost = smooth(roost, 2);
  const out = new Float32Array(NCELL);
  for (let k = 0; k < NCELL; k++) {
    if (!lc.total[k]) continue;
    const built = frac(22, k) + frac(23, k) + frac(24, k);
    out[k] = clamp01(0.95 * (1 - Math.exp(-GOOSE_FEED_K * nearFeed[k])) * (GOOSE_NO_ROOST + (1 - GOOSE_NO_ROOST) * clamp01(nearRoost[k] / GOOSE_ROOST))) * Math.pow(1 - built, 1.5);
  }
  /* For checking the rule against places whose answer is known: point
     GOOSE_DEBUG at a JSON file of { "name": [lon, lat] }. */
  if (process.env.GOOSE_DEBUG) {
    const probe = JSON.parse(readFileSync(process.env.GOOSE_DEBUG, 'utf8'));
    for (const [name, p] of Object.entries(probe)) {
      const k = cellIdx(Math.floor((p[0] - LON0) / D), Math.floor((p[1] - LAT0) / D));
      console.log('GOOSE ' + name.padEnd(28) + ' feed ' + feed[k].toFixed(3) + '  round ' + nearFeed[k].toFixed(3) +
        '  roost ' + roost[k].toFixed(4) + '  round ' + nearRoost[k].toFixed(4) +
        '  built ' + (frac(22, k) + frac(23, k) + frac(24, k)).toFixed(2) + '  value ' + out[k].toFixed(2));
    }
  }
  return out;
}

/* ---------- what kind of duck water ----------

   The advice names the water - flooded timber, rice, marsh, big water -
   and it got the name from a list of twenty-nine regions drawn by hand.
   Outside them it said "any reliable open water", which is what it said
   at Cheyenne Bottoms, the ACE Basin, the Mobile Delta, Merrymeeting
   Bay and the Skagit. The land cover knows better than that. One code a
   cell, from what is in it and the eight round it. The regions still
   have the say where they cover a place; this fills in the rest.

   A wooded swamp is only "flooded timber" in the south. The first cut
   called Merrymeeting Bay in Maine and Montezuma in New York flooded
   timber, because both have wooded wetland round them, and what is
   meant by the words is bottomland hardwood. North of TIMBER_NORTH it
   is alder, maple and tamarack and is hunted like a marsh. */
const TIMBER_NORTH = 38.5;
const WATER_KINDS = ['', 'rice', 'timber', 'coastal', 'marsh', 'reservoir', 'pothole', 'river'];

function waterKinds(lc, rice, meanFt) {
  const own = (cls) => {
    const a = lc.counts.get(cls), o = new Float32Array(NCELL);
    if (a) for (let k = 0; k < NCELL; k++) if (lc.total[k]) o[k] = a[k] / lc.total[k];
    return smooth(o, 1);
  };
  const open = own(11), marsh = own(95), swamp = own(90), crops = own(82), grass = own(71), hay = own(81);
  const paddy = rice ? smooth(rice, 1) : new Float32Array(NCELL);
  const out = new Uint8Array(NCELL);
  for (let k = 0; k < NCELL; k++) {
    if (!lc.total[k]) continue;
    const low = isFinite(meanFt[k]) && meanFt[k] < 15;
    const lat = LAT0 + (Math.floor(k / NLON) + 0.5) * D;
    let kind = 0;
    if (paddy[k] >= 0.06) kind = 1;
    else if (low && open[k] >= 0.20) kind = 3;
    else if (swamp[k] >= 0.12 && swamp[k] >= marsh[k] && lat < TIMBER_NORTH) kind = 2;
    else if (marsh[k] >= 0.06 || swamp[k] >= 0.12) kind = 4;
    else if (open[k] >= 0.20) kind = 5;
    else if (open[k] + marsh[k] >= 0.02 && crops[k] + grass[k] + hay[k] >= 0.5) kind = 6;
    else if (open[k] >= 0.01) kind = 7;
    out[k] = kind;
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
  /* Measured cold water, and water known to be cold by kind, beat
     whatever the climate would have predicted. Never the other way:
     a warm main stem says nothing about the tributaries above it. */
  const summer = await summerWater();
  const measured = summerColdGrid(summer);
  const namedTrout = namedTroutGrid();
  let coldByGauge = 0, coldByName = 0;
  for (let k = 0; k < NCELL; k++) {
    if (measured[k] > cold[k]) { cold[k] = measured[k]; coldByGauge++; }
    if (namedTrout.cold[k] > cold[k]) { cold[k] = namedTrout.cold[k]; coldByName++; }
  }
  process.stderr.write('  cold water raised by a gauge in ' + coldByGauge + ' cells, by a named water in ' + coldByName + String.fromCharCode(10));
  const nasTrout = await nasEstablished();
  let troutSure = null, troutCount = null, uplandTaxa = null, uplandBest = null;

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
      /* Geese are in the waterfowl count already. */
      if (sp !== 'goose') harvest.push({ name: name, records: S.placed, months: months ? months.join(',') : 'all' });
      process.stderr.write('  ' + sp + ' / ' + name + ': ' + S.placed + ' records in ' +
        S.bins + ' squares' + (months ? ', months ' + months.join(',') : '') + '\n');
    }
    if (total < 500) throw new Error(sp + ' returned only ' + total + ' records - refusing to ship it');
    if (COMPOSITION.indexOf(sp) >= 0) composition[sp] = perTaxon;
    /* Normalise to a unit total before it joins the effort sum. Without
       this, a species whose download hit the record cap contributes fewer
       counts than one that did not, and its share - the whole point of the
       denominator - comes out understated through no fault of the birds. */
    if (sp === 'trout') troutCount = Float32Array.from(occ[sp]);
    let tot = 0;
    for (let k = 0; k < NCELL; k++) tot += occ[sp][k];
    if (tot > 0) for (let k = 0; k < NCELL; k++) occ[sp][k] /= tot;
    if (sp !== 'goose') for (let k = 0; k < NCELL; k++) effort[k] += occ[sp][k];
    if (sp === 'upland') uplandTaxa = perTaxon;
  }

  /* Share of game records, so a cell watched by a thousand birders and a
     cell watched by one are judged the same way. */
  const effortS = smooth(effort, 3);
  const out = {}, presOut = {}, unrecordedOut = {};
  troutSure = troutEvidence(troutCount, nasTrout, namedTrout.named, cold, lc.total, lc.counts, ev.reliefFt);
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
    const skip = UNRECORDED_SKIP[sp] || null;
    const lean = skip || sp === 'turkey' ? new Uint8Array(NCELL) : null;
    const gobblers = sp === 'turkey'
      ? turkeySuit(lc, Float32Array.from(share, (v) => clamp01(Math.pow(clamp01(v / p97), 0.45)))) : null;
    const ducks = sp === 'waterfowl' ? waterfowlSuit(lc, rice) : sp === 'goose' ? gooseSuit(lc, rice)
      : gobblers ? gobblers.recorded : null;
    const birds = sp === 'upland' && uplandTaxa
      ? (uplandBest = uplandSuit(lc, ev.reliefFt, uplandTaxa, normalsGrid(ev.meanFt, 0, 3))).val : null;
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
      /* Elk on open ground need somewhere to go.

         Grass is 0.80 in the table above, and for elk that is right on
         a mountain park or in the breaks and wrong on a wheat-and-
         shortgrass plain, which land cover cannot tell apart. It did
         not matter while occurrence records set the range, because
         nobody photographs elk at Burlington, Colorado. The USGS range
         does include the plains - a few elk do live along the rivers
         there - and the flat prairie came up at 40 out of 100.

         So the open classes count in full only where the cell also
         has timber or broken ground: full at an eighth forest or 300
         feet of relief, down to three tenths of their value on a
         treeless flat. Set from what real herds stand on, measured in
         this grid as share of forest and feet of relief:

             Fort Riley, Kansas          12%    59 ft   kept in full
             Theodore Roosevelt NP       28%    86 ft   kept in full
             Pine Ridge, Nebraska        16%   174 ft   kept in full
             north-west Colorado sage     4%   325 ft   kept in full
             Glass Mountains, Texas       4%   301 ft   kept in full
             Owens Valley tule elk        0%   203 ft   0.52 to 0.38
             Red Desert, Wyoming          0%    90 ft   0.64 to 0.25
             Cimarron Grassland           0%    65 ft   0.42 to 0.13
             Burlington, Colorado         0%    38 ft   0.29 to 0.09

         The last three are the point: desert and grassland elk exist,
         thinly, and now read thin. Timber itself is untouched, so the
         flat aspen parkland of north-west Minnesota (48% forest, 7
         feet of relief) and the Michigan and Wisconsin herds keep
         every point. */
      if (sp === 'elk') {
        const tot = lc.total[k];
        const part = (c) => { const arr = lc.counts.get(c); return arr ? arr[k] / tot : 0; };
        const forest = part(41) + part(42) + part(43) + part(90);
        const open = 0.80 * part(71) + 0.62 * part(52) + 0.40 * part(81) + 0.15 * part(82);
        const refuge = clamp01(Math.max(forest / ELK_REFUGE.forest,
          (ev.reliefFt[k] - ELK_REFUGE.relief[0]) / (ELK_REFUGE.relief[1] - ELK_REFUGE.relief[0])));
        s -= open * (1 - ELK_REFUGE.low) * (1 - refuge);
      }
      if (ducks) s = ducks[k] * elevFactor(ev.meanFt[k], band);
      else if (birds) s = birds[k] * elevFactor(ev.meanFt[k], band);
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
      if (sp === 'trout') {
        /* Cold water, times how sure it is that trout are in it. Where
           they have been seen, mapped water adds to it. */
        const openArr = lc.counts.get(11);
        const open = openArr ? openArr[k] / lc.total[k] : 0;
        const river = s * (1 - clamp01((open - TROUT_LAKE[0]) / (TROUT_LAKE[1] - TROUT_LAKE[0])));
        s = cold[k] * troutSure.sure[k] * (troutSure.seen[k] ? TROUT_STREAM + (1 - TROUT_STREAM) * river : 1);
        if (!namedTrout.named[k]) {
          let built = 0;
          for (const c of [22, 23, 24]) { const arr = lc.counts.get(c); if (arr) built += arr[k] / lc.total[k]; }
          s *= 1 - TROUT_CITY[2] * clamp01((built - TROUT_CITY[0]) / (TROUT_CITY[1] - TROUT_CITY[0]));
        }
      }
      vals[k] = Math.round(clamp01(s) * 255);

      if (lean && gobblers) {
        lean[k] = Math.round(clamp01(gobblers.mapped[k] * elevFactor(ev.meanFt[k], band)) * 255);
      } else if (lean) {
        let t = 0;
        for (let q = 0; q < suitPairs.length; q++) {
          if (skip.indexOf(suitPairs[q][0]) >= 0) continue;
          const arr = lc.counts.get(suitPairs[q][0]);
          if (arr) t += suitPairs[q][1] * (arr[k] / lc.total[k]);
        }
        t *= elevFactor(ev.meanFt[k], band);
        if (satK) t = 1 - Math.exp(-satK * t);
        lean[k] = Math.round(clamp01(t) * 255);
      }
    }
    out[sp] = Buffer.from(vals).toString('base64');
    if (lean) unrecordedOut[sp] = Buffer.from(lean).toString('base64');

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
        /* For trout the question of range is already answered, cell by
           cell, in troutEvidence, and is in the value. This plane only
           has to not get in its way. */
        if (sp === 'trout' && troutSure.sure[iy * NLON + ix] > 0) pv[o] = 255;
      }
    }
    presOut[sp] = Buffer.from(pv).toString('base64');
    let above = 0;
    for (let k = 0; k < NCELL; k++) if (vals[k] > 18) above++;   // suitability only
    report.push(sp + ': ' + above + ' cells above the range floor');
  }
  /* The upland birds one at a time - see BIRDS. */
  if (uplandBest && uplandTaxa) {
    const band = ELEV.upland;
    for (const bird of Object.keys(BIRDS)) {
      const taxa = BIRDS[bird].filter((n) => uplandTaxa[n] && uplandBest.fits[n]);
      if (!taxa.length) continue;
      const occB = new Float32Array(NCELL);
      let tot = 0;
      for (const n of taxa) for (let k = 0; k < NCELL; k++) { occB[k] += uplandTaxa[n][k]; tot += uplandTaxa[n][k]; }
      if (tot > 0) for (let k = 0; k < NCELL; k++) occB[k] /= tot;
      const occS = smooth(occB, 3);
      const share = new Float32Array(NCELL);
      for (let k = 0; k < NCELL; k++) share[k] = effortS[k] > 1e-9 ? occS[k] / effortS[k] : 0;
      const nz = Array.from(share).filter((v) => v > 0).sort((a, b) => a - b);
      const p97 = nz.length ? nz[Math.floor(nz.length * 0.97)] : 1;

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
      presOut[bird] = Buffer.from(pv).toString('base64');

      const vals = new Uint8Array(NCELL);
      let above = 0;
      for (let iy = 0; iy < NLAT; iy++) {
        const cy = Math.floor((iy * D) / PRES_D);
        for (let ix = 0; ix < NLON; ix++) {
          const k = iy * NLON + ix;
          if (!lc.total[k]) continue;
          /* Nothing where the bird has no record anywhere near. The
             range gate would take it to nothing at runtime anyway, and
             a plane that is mostly zeros costs almost nothing to send. */
          if (!pv[cy * PRES_NLON + Math.floor((ix * D) / PRES_D)]) continue;
          let f = 0;
          for (const n of taxa) if (uplandBest.fits[n][k] > f) f = uplandBest.fits[n][k];
          vals[k] = Math.round(clamp01(f * elevFactor(ev.meanFt[k], band)) * 255);
          if (vals[k] > 18) above++;
        }
      }
      out[bird] = Buffer.from(vals).toString('base64');
      report.push(bird + ': ' + above + ' cells above the range floor');
    }
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
            'GBIF occurrence records 2015-2025 (CC0 and CC-BY only), USGS NWIS summer water temperature, ' +
            'USGS Nonindigenous Aquatic Species database (established trout)',
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

    /* What kind of duck water each cell is - see waterKinds. */
    waterKind: { names: WATER_KINDS, cells: Buffer.from(waterKinds(lc, rice, ev.meanFt)).toString('base64') },
    /* Which upland bird each cell was scored on - see uplandSuit. */
    uplandLead: uplandBest ? { names: uplandBest.names, cells: Buffer.from(uplandBest.lead).toString('base64') } : null,

    /* Suitability for ground a species is mapped on but not recorded
       on - see UNRECORDED_SKIP. */
    unrecorded: unrecordedOut,

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
