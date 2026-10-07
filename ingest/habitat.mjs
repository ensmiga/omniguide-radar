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

import { writeFileSync, mkdirSync } from 'node:fs';
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
  waterfowl: { 95: 1.00, 90: 0.86, 11: 0.80, 82: 0.70, 81: 0.45, 71: 0.30, 12: 0.05 }
};

/* Elevation preference in feet: [zero below, full above, full below, zero
   above]. Deliberately wide - this is a sanity bound, not the model. */
const ELEV = {
  elk:       [2000, 4500, 10500, 12500],
  muledeer:  [500, 2500, 9500, 11500],
  whitetail: [-100, 0, 6000, 9000],
  moose:     [0, 500, 10000, 11500],
  pronghorn: [1000, 3500, 8500, 10000],
  turkey:    [-100, 0, 7500, 9500],
  upland:    [-100, 0, 7000, 9000],
  waterfowl: [-100, 0, 5000, 8000]
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
              'Branta canadensis', 'Anser caerulescens']
};

const SPECIES = Object.keys(SUIT);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getBuf(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'OmniGuide/ingest' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(700 * (i + 1));
    }
  }
}

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'OmniGuide/ingest' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
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

/* Pages coordinates for one taxon into the grid. GBIF caps offset at
   100000, which is plenty to define a range at 11 km - this is a presence
   surface, not a census. */
async function occurrences(key, grid) {
  const LIMIT = 300, MAXOFF = 100000, PAR = 6;
  let off = 0, got = 0, end = false;
  while (!end && off < MAXOFF) {
    const batch = [];
    for (let i = 0; i < PAR && off + i * LIMIT < MAXOFF; i++) batch.push(off + i * LIMIT);
    off += PAR * LIMIT;
    const pages = await Promise.all(batch.map((o) => getJSON(
      'https://api.gbif.org/v1/occurrence/search?taxonKey=' + key +
      '&country=US&hasCoordinate=true&hasGeospatialIssue=false' +
      '&year=2015,2025&limit=' + LIMIT + '&offset=' + o).catch(() => null)));
    for (const p of pages) {
      if (!p || !p.results) { end = true; continue; }
      if (p.results.length === 0 || p.endOfRecords) end = true;
      for (const r of p.results) {
        const ix = Math.floor((r.decimalLongitude - LON0) / D);
        const iy = Math.floor((r.decimalLatitude - LAT0) / D);
        if (ix < 0 || ix >= NLON || iy < 0 || iy >= NLAT) continue;
        grid[cellIdx(ix, iy)]++; got++;
      }
    }
  }
  return got;
}

/* ---------- combine ---------- */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

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

  process.stderr.write('occurrences...\n');
  const occ = {}, effort = new Float32Array(NCELL);
  for (const sp of SPECIES) {
    occ[sp] = new Float32Array(NCELL);
    let total = 0;
    for (const name of TAXA[sp]) {
      const key = await taxonKey(name);
      const got = await occurrences(key, occ[sp]);
      total += got;
      process.stderr.write('  ' + sp + ' / ' + name + ': ' + got + '\n');
    }
    if (total < 500) throw new Error(sp + ' returned only ' + total + ' records - refusing to ship it');
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
      share[k] = effortS[k] > 0.02 ? occS[k] / effortS[k] : 0;
    }
    /* Normalise against this species' own 97th percentile - species differ
       enormously in how often they are reported, and what matters is where
       this one is relative to where else it is. */
    const nz = Array.from(share).filter((v) => v > 0).sort((a, b) => a - b);
    const p97 = nz.length ? nz[Math.floor(nz.length * 0.97)] : 1;

    const band = ELEV[sp], suit = SUIT[sp];
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

      /* Presence gate. Full weight once the species is as common here as
         it is anywhere; a long toe so a cell just outside the recorded
         range is reduced rather than erased. */
      const pres = clamp01(Math.pow(clamp01(share[k] / p97), 0.45));
      vals[k] = Math.round(clamp01(s * (0.12 + 0.88 * pres)) * 255);
    }
    out[sp] = Buffer.from(vals).toString('base64');
    let above = 0;
    for (let k = 0; k < NCELL; k++) if (vals[k] > 18) above++;
    report.push(sp + ': ' + above + ' cells above the range floor');
  }
  process.stderr.write('  ' + report.join('\n  ') + '\n');

  const js = 'window.US_HABITAT=' + JSON.stringify({
    source: 'NLCD 2021 land cover (MRLC), AWS terrarium elevation, GBIF occurrence records 2015-2025',
    note: 'Land cover and elevation set habitat quality; GBIF occurrence share gates presence. ' +
          'Modelled suitability, not a census and not an abundance estimate.',
    built: new Date().toISOString().slice(0, 10),
    grid: { lon0: LON0, lat0: LAT0, d: D, nlon: NLON, nlat: NLAT },
    sp: out
  }) + ';\n';
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'habitat-grid.js'), js);
  process.stderr.write('wrote js/habitat-grid.js (' + (js.length / 1024).toFixed(0) + ' KB)\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
