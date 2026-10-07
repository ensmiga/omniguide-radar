/* OmniGuide - elevation raster builder.

   WHY THIS EXISTS.

   elevFt() in env.js is eleven hand-placed Gaussian mountain ranges plus
   fractal noise. It is a drawing of the United States from memory. That
   would be bad enough on its own, but elevation is not a decoration in
   this model - it drives:

     - the temperature lapse correction applied to every forecast readout,
       so a wrong elevation is a wrong temperature everywhere;
     - the elk, mule deer and pronghorn elevation bands;
     - the damping that stops ducks scoring in alpine terrain;
     - the trout elevation term.

   A fake mountain is therefore a fake forecast, not just a fake contour.

   This bakes real elevation from AWS terrarium tiles at 0.1 degrees:
   a mean and a standard deviation (relief) per cell, both in feet, stored
   at 50 foot resolution. Relief matters as much as the mean - a cell
   averaging 7000 feet that is flat and one that spans 5000 to 9000 are
   completely different country, and the mean alone cannot tell them apart.

   The exact-coordinate work in terrain.js still fetches zoom 13 tiles at
   runtime and is unaffected; this is the synchronous, national surface
   the conditions and habitat engines need.

       node ingest/elevation.mjs

   Writes js/elev-grid.js. */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, terrariumMetres } from './png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'js');

const LON0 = -125, LAT0 = 24, D = 0.1, NLON = 590, NLAT = 260;
const NCELL = NLON * NLAT;
const STEP_FT = 50;                    // one byte per cell, 0 to 12750 feet
const Z = 8;                           // about 600 m per pixel at these latitudes

const lon2tx = (lon, z) => Math.floor(((lon + 180) / 360) * Math.pow(2, z));
function lat2ty(lat, z) {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}
const tx2lon = (x, z) => (x / Math.pow(2, z)) * 360 - 180;
function ty2lat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tile(x, y) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(
        'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + Z + '/' + x + '/' + y + '.png',
        { headers: { 'User-Agent': 'OmniGuide/ingest' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return decodePNG(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      if (i === 2) return null;
      await sleep(500 * (i + 1));
    }
  }
  return null;
}

async function main() {
  const x0 = lon2tx(LON0, Z), x1 = lon2tx(LON0 + NLON * D, Z);
  const y0 = lat2ty(LAT0 + NLAT * D, Z), y1 = lat2ty(LAT0, Z);
  const totalTiles = (x1 - x0 + 1) * (y1 - y0 + 1);

  const sum = new Float64Array(NCELL), sumSq = new Float64Array(NCELL);
  const n = new Uint32Array(NCELL);
  let done = 0, failed = 0;

  for (let tx = x0; tx <= x1; tx++) {
    const ys = [];
    for (let ty = y0; ty <= y1; ty++) ys.push(ty);
    /* One column at a time, eight tiles in flight. Enough to keep the
       pipe busy without hammering a free service. */
    for (let i = 0; i < ys.length; i += 8) {
      const chunk = ys.slice(i, i + 8);
      const imgs = await Promise.all(chunk.map(async (ty) => [ty, await tile(tx, ty)]));
      for (const [ty, img] of imgs) {
        done++;
        if (!img) { failed++; continue; }
        const wLon = tx2lon(tx, Z), eLon = tx2lon(tx + 1, Z);
        const nLat = ty2lat(ty, Z), sLat = ty2lat(ty + 1, Z);
        for (let py = 0; py < img.height; py++) {
          const lat = nLat + (sLat - nLat) * (py / img.height);
          const iy = Math.floor((lat - LAT0) / D);
          if (iy < 0 || iy >= NLAT) continue;
          for (let px = 0; px < img.width; px++) {
            const lon = wLon + (eLon - wLon) * (px / img.width);
            const ix = Math.floor((lon - LON0) / D);
            if (ix < 0 || ix >= NLON) continue;
            const m = terrariumMetres(img, px, py);
            if (m < -500 || m > 9000) continue;
            const k = iy * NLON + ix;
            sum[k] += m; sumSq[k] += m * m; n[k]++;
          }
        }
      }
    }
    process.stderr.write('  ' + done + '/' + totalTiles + ' tiles\n');
  }

  if (failed > totalTiles * 0.02) {
    throw new Error(failed + ' of ' + totalTiles + ' tiles failed - refusing to ship a holed raster');
  }

  const mean = new Uint8Array(NCELL), relief = new Uint8Array(NCELL);
  const covered = new Uint8Array(NCELL);
  let land = 0;
  for (let k = 0; k < NCELL; k++) {
    if (!n[k]) continue;
    covered[k] = 1; land++;
    const m = sum[k] / n[k];
    const v = Math.max(0, sumSq[k] / n[k] - m * m);
    mean[k] = Math.max(0, Math.min(255, Math.round((m * 3.28084) / STEP_FT)));
    relief[k] = Math.max(0, Math.min(255, Math.round((Math.sqrt(v) * 3.28084) / STEP_FT)));
  }
  process.stderr.write('  ' + land + ' of ' + NCELL + ' cells have data\n');

  const js = 'window.US_ELEV=' + JSON.stringify({
    source: 'AWS terrarium elevation tiles (Mapzen/Tilezen), zoom ' + Z,
    note: 'Mean and standard deviation of elevation within each cell, in feet, ' +
          'quantised to ' + STEP_FT + ' ft. Relief is the within-cell standard deviation.',
    built: new Date().toISOString().slice(0, 10),
    stepFt: STEP_FT,
    grid: { lon0: LON0, lat0: LAT0, d: D, nlon: NLON, nlat: NLAT },
    mean: Buffer.from(mean).toString('base64'),
    relief: Buffer.from(relief).toString('base64'),
    covered: Buffer.from(covered).toString('base64')
  }) + ';\n';

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'elev-grid.js'), js);
  process.stderr.write('wrote js/elev-grid.js (' + (js.length / 1024).toFixed(0) + ' KB)\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
