/* OmniGuide - open water and wetland cover.

   WHY THIS IS SEPARATE FROM habitat.mjs.

   The freeze model needs to know how much water is physically present in
   a cell, which is a different question from how good the cell is for a
   given species. The first attempt at the open-water index used the USGS
   gauge network alone and under-read badly: the Mississippi River gauge
   at Alton reports water temperature and no discharge at all, so the
   largest river on the continent scored lower than a well-instrumented
   creek. Gauges are sparse, inconsistently equipped, and tell you about
   points rather than about ground.

   NLCD knows where the water is everywhere. Gauges know whether it is
   moving and how warm it is. Used together, one covers the other's gap -
   see js/openwater.js for how they combine.

   Two planes, both as a fraction of the cell, 0-255:
     water   - NLCD class 11, open water
     wetland - classes 90 and 95, woody and emergent wetland

       node ingest/water.mjs

   Writes js/water-grid.js. Fast: land cover only, no GBIF. */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, paletteIndex } from './png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'js');

const LON0 = -125, LAT0 = 24, D = 0.1, NLON = 590, NLAT = 260;
const NCELL = NLON * NLAT;

/* Palette index to NLCD class, as MRLC emits its PLTE. */
const PAL_TO_CLASS = {
  1: 11, 2: 12, 3: 21, 4: 22, 5: 23, 6: 24, 7: 31,
  9: 41, 10: 42, 11: 43, 12: 51, 13: 52, 14: 71, 15: 72, 16: 73, 17: 74,
  18: 81, 19: 82, 20: 90, 21: 95
};

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

async function main() {
  const PPC = 6;                         // pixels across each cell edge
  const COLS = 5, ROWS = 4;
  const lonSpan = (NLON / COLS) * D, latSpan = (NLAT / ROWS) * D;
  const w = (NLON / COLS) * PPC, h = (NLAT / ROWS) * PPC;

  const nWater = new Uint32Array(NCELL);
  const nWet = new Uint32Array(NCELL);
  const nTot = new Uint32Array(NCELL);

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
        const iy = Math.floor((NLAT / ROWS) * cy + (img.height - 1 - py) / PPC);
        if (iy < 0 || iy >= NLAT) continue;
        for (let px = 0; px < img.width; px++) {
          const cls = PAL_TO_CLASS[paletteIndex(img, px, py)];
          if (!cls) continue;
          const ix = Math.floor((NLON / COLS) * cx + px / PPC);
          if (ix < 0 || ix >= NLON) continue;
          const k = iy * NLON + ix;
          nTot[k]++;
          if (cls === 11) nWater[k]++;
          else if (cls === 90 || cls === 95) nWet[k]++;
        }
      }
      process.stderr.write('  tile ' + (cx * ROWS + cy + 1) + '/' + (COLS * ROWS) + '\n');
    }
  }

  const water = new Uint8Array(NCELL), wet = new Uint8Array(NCELL);
  let land = 0, anyWater = 0;
  for (let k = 0; k < NCELL; k++) {
    if (!nTot[k]) continue;
    land++;
    water[k] = Math.round(255 * nWater[k] / nTot[k]);
    wet[k] = Math.round(255 * nWet[k] / nTot[k]);
    if (water[k] > 12) anyWater++;
  }
  process.stderr.write('  ' + land + ' land cells, ' + anyWater + ' more than 5% open water\n');
  if (land < NCELL * 0.3) throw new Error('only ' + land + ' cells covered - refusing to ship');

  const js = 'window.US_WATER=' + JSON.stringify({
    source: 'NLCD 2021 land cover (MRLC)',
    note: 'Fraction of each cell in NLCD class 11 (open water) and classes 90/95 ' +
          '(woody and emergent wetland), 0-255.',
    built: new Date().toISOString().slice(0, 10),
    grid: { lon0: LON0, lat0: LAT0, d: D, nlon: NLON, nlat: NLAT },
    water: Buffer.from(water).toString('base64'),
    wetland: Buffer.from(wet).toString('base64')
  }) + ';\n';

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'water-grid.js'), js);
  process.stderr.write('wrote js/water-grid.js (' + (js.length / 1024).toFixed(0) + ' KB)\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
