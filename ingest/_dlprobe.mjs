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

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, paletteIndex, terrariumMetres } from './png.mjs';

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
  elk:       [1500, 4000, 11800, 13500],
  muledeer:  [300, 2000, 11000, 13000],
  whitetail: [-100, 0, 7500, 10000],
  moose:     [0, 400, 11000, 12500],
  pronghorn: [800, 3000, 10000, 11500],
  turkey:    [-100, 0, 9500, 11000],
  upland:    [-100, 0, 10500, 12000],
  waterfowl: [-100, 0, 9500, 11800],
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

/* Composition is a smooth regional quantity, so it ships on a
   coarser grid than habitat and costs almost nothing. */
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
  const j = await getJSON('https://api.gbif.org/v1/species/match?strict=true&name=' +
    encodeURIComponent(name));
  if (!j || !j.usageKey) throw new Error('no GBIF key for ' + name);
  return j.usageKey;
}

/* Pages coordinates for one taxon into the grid.

   Capped at 30000 records. GBIF's deep paging degrades badly past roughly
   that offset - the first build of this file spent over an hour there -
   and 30000 points is far more than enough to draw a range at 11 km. This
   is a presence surface, not a census. The per-species normalisation
   below means a taxon that hits the cap is not penalised against one that
   does not. */
function occurrenceURL(key, off, limit) {
  return 'https://api.gbif.org/v1/occurrence/search?taxonKey=' + key +
    '&country=US&hasCoordinate=true&hasGeospatialIssue=false' +
    '&year=2015,2025&limit=' + limit + '&offset=' + off;
}

async function occurrences(key, grid, chron, taxonGrid) {
  const LIMIT = 300, MAXOFF = 30000, PAR = 8;
  let off = 0, got = 0, end = false, lost = 0;
  while (!end && off < MAXOFF) {
    const batch = [];
    for (let i = 0; i < PAR && off + i * LIMIT < MAXOFF; i++) batch.push(off + i * LIMIT);
    off += PAR * LIMIT;
    process.stderr.write('    .. offset ' + off + String.fromCharCode(10));

    let pages = await Promise.all(batch.map((o) =>
      getJSON(occurrenceURL(key, o, LIMIT)).catch(() => null)));

    /* Second pass over just the offsets that came back empty-handed.
       getJSON has already retried each of these four times with
       backoff, so this is a fifth through eighth attempt on a page
       that is probably being throttled rather than one that does
       not exist. Serial, to stop hammering a service that is
       already struggling. */
    for (let i = 0; i < pages.length; i++) {
      if (pages[i] !== null) continue;
      await sleep(1200);
      pages[i] = await getJSON(occurrenceURL(key, batch[i], LIMIT)).catch(() => null);
      if (pages[i] === null) lost++;
    }
    for (const p of pages) {
      /* A page we could not get is a hole in the sample, not the
         bottom of it. Keep going; the loop still stops at MAXOFF. */
      if (p === null) continue;
      if (!p.results) { end = true; continue; }
      if (p.results.length === 0 || p.endOfRecords) end = true;
      for (const r of p.results) {
        const ix = Math.floor((r.decimalLongitude - LON0) / D);
        const iy = Math.floor((r.decimalLatitude - LAT0) / D);
        if (ix < 0 || ix >= NLON || iy < 0 || iy >= NLAT) continue;
        const ci = cellIdx(ix, iy);
        grid[ci]++; got++;
        if (taxonGrid) taxonGrid[ci]++;
        /* Migration timing, by latitude band. When a species is
           where is a fact in the record - the month is on every
           occurrence - and it was being guessed with a peak day and
           a width per species plus a flat 2.1 days per degree of
           latitude. */
        if (chron && typeof r.month === 'number' && r.month >= 1 && r.month <= 12) {
          const band = Math.max(0, Math.min(CHRON_BANDS - 1,
            Math.floor((r.decimalLatitude - LAT0) / CHRON_BAND_DEG)));
          chron[band * 12 + (r.month - 1)]++;
        }
      }
    }
  }
  return { got: got, lost: lost };
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
  const lc = await landCover();

  process.stderr.write('elevation...\n');
  const ev = await elevation();

  process.stderr.write('pressure...\n');
  const press = pressureGrid(lc.counts, lc.total);

  process.stderr.write('coldwater...\n');
  const cold = coldwaterGrid(ev.meanFt);
  const tw = tailwaterGrid();
  /* A cold release beats whatever the climate would have predicted. */
  for (let k = 0; k < NCELL; k++) if (tw[k] > cold[k]) cold[k] = tw[k];

  process.stderr.write('occurrences...\n');
  const occ = {}, effort = new Float32Array(NCELL);
  const chronology = {}, composition = {};
  for (const sp of SPECIES) {
    occ[sp] = new Float32Array(NCELL);
    let total = 0;
    const perTaxon = {};
    for (const name of TAXA[sp]) {
      perTaxon[name] = new Float32Array(NCELL);
      const key = await taxonKey(name);
      if (!chronology[name]) chronology[name] = new Float64Array(CHRON_BANDS * 12);
      const res = await occurrences(key, occ[sp], chronology[name], perTaxon[name]);
      const got = res.got;
      total += got;
      process.stderr.write('  ' + sp + ' / ' + name + ': ' + got +
        (res.lost ? '   WARNING ' + res.lost + ' pages lost to timeouts' : '') + '\n');
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
  const out = {};
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
    for (let k = 0; k < NCELL; k++) {
      if (!lc.total[k]) continue;
      let s = 0;
      for (let q = 0; q < suitPairs.length; q++) {
        const arr = lc.counts.get(suitPairs[q][0]);
        if (arr) s += suitPairs[q][1] * (arr[k] / lc.total[k]);
      }
      s *= elevFactor(ev.meanFt[k], band);
      if (satK) s = 1 - Math.exp(-satK * s);
      /* Coldwater is applied to the finished value rather than to
         the land-cover term, so a cold creek with almost no mapped
         water still clears the floor. */

      /* Presence gate. Full weight once the species is as common here as
         it is anywhere; a long toe so a cell just outside the recorded
         range is reduced rather than erased. */
      const pres = clamp01(Math.pow(clamp01(share[k] / p97), 0.45));
      /* For most species the land cover is the evidence and the
         occurrence record is the gate. For a fish in a small stream
         it is the other way round: Penns Creek and the Battenkill
         are 20 m wide, invisible to a 30 m land-cover raster
         averaged over 11 km, and both came out blank on the first
         build while the records say plainly that trout are there.
         So trout leans on presence and treats water cover as a
         bonus, which is the honest reading of what each source
         actually knows. */
      const v = sp === 'trout'
        ? (0.35 + 0.65 * s) * pres * cold[k]
        : s * (0.12 + 0.88 * pres);
      vals[k] = Math.round(clamp01(v) * 255);
    }
    out[sp] = Buffer.from(vals).toString('base64');
    let above = 0;
    for (let k = 0; k < NCELL; k++) if (vals[k] > 18) above++;
    report.push(sp + ': ' + above + ' cells above the range floor');
  }
  process.stderr.write('  ' + report.join('\n  ') + '\n');

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
      coarse[tx] = c;
    }
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
    source: 'NLCD 2021 land cover (MRLC), AWS terrarium elevation, GBIF occurrence records 2015-2025',
    note: 'Land cover and elevation set habitat quality; GBIF occurrence share gates presence. ' +
          'Modelled suitability, not a census and not an abundance estimate.',
    built: new Date().toISOString().slice(0, 10),
    grid: { lon0: LON0, lat0: LAT0, d: D, nlon: NLON, nlat: NLAT },
    sp: out,

    /* Hunting pressure from developed land cover, replacing a list
       of hand-weighted metro blobs. */
    pressure: Buffer.from(quantise(press)).toString('base64'),

    /* Occurrence counts by latitude band and calendar month, per
       taxon. Keyed by taxon rather than by group, because ducks and
       these rather than from a hardcoded peak day and width. */
    chronology: {
      bandDeg: CHRON_BAND_DEG, bands: CHRON_BANDS, lat0: LAT0,
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

export { deadline, getJSON, occurrences, taxonKey, NCELL, CHRON_BANDS };
