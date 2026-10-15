/* Where the USGS basemap caches actually have tiles.

   WHY THIS EXISTS.

   The National Map basemaps are pre-rendered tile caches, and none of
   them is complete. Each service's tileInfo lists the standard 24 Web
   Mercator levels, and its maxScale says something else again (level 7
   for shaded relief, 16 for topo and imagery). Neither is the truth.
   Asking the caches tile by tile, on 2026-10-14:

     - every service stops at level 16; level 17 is 404 everywhere;
     - shaded relief has whole blocks missing in the middle levels:
       nothing at 9 west of about 90 W, nothing at 10 across the
       northern West, nothing at 11 in the north-west corner - zoomed in
       on Montana, levels 9 to 11 are all 404 and 12 to 16 are there;
     - from level 9 to 12 down, all three thin out to the US and its
       coast: the open sea and most of Canada and Mexico are 404 at the
       deeper levels, and the deepest reach less far offshore than the
       ones above them.

   The map was asking for whatever level the zoom called for and drawing
   nothing where it came back 404. Twenty failures in a row also tripped
   the "tiles are blocked" fallback, which is why Montana went flat grey.

   So this asks each cache which tiles it holds and writes the answer to
   js/tile-cover.js. The tile cache is stored in bundles of 128 x 128
   tiles, and the service answers a tilemap request per bundle: a
   presence bit for every tile, or 422 if the bundle holds none. That is
   recorded per bundle as absent, full or partial. The map never asks for
   a tile in an absent bundle, asks freely in a full one, and fetches the
   tilemap of a partial one before asking for anything inside it - a
   partial bundle always answers 200, so nothing it requests can fail.

   Levels 0 to 8 are surveyed for the whole world, 9 to 12 over a wide
   box around the lower 48, and 13 to 16, where bundles are small and
   many, over a tighter one. Outside those boxes the map uses the
   deepest level surveyed there.

   Rerun when the map starts showing blurry patches where it used to be
   sharp, or 404s come back - USGS does rebuild these caches:

       node tools/tile-cover.mjs
       node tools/stamp.mjs

   Read-only. About 19,000 tilemap requests over the three services,
   six at a time; a bundle with tiles in it answers with 32 KB, so it
   pulls a few hundred MB and takes about ten minutes. The table it
   writes is about 6 KB. */

import { writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://basemap.nationalmap.gov/arcgis/rest/services/';
const SERVICES = ['USGSShadedReliefOnly', 'USGSTopo', 'USGSImageryOnly'];
const B = 128;              // bundle edge in tiles
const MAX_LEVEL = 16;       // deepest level surveyed; 17 is checked to be empty
const WIDE = [-135, 15, -55, 56];     // lon0, lat0, lon1, lat1 for levels 9-12
const TIGHT = [-127, 23, -65, 51];    // levels 13-16
const PARALLEL = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'user-agent': 'omniguide-tile-cover (github.com/ensmiga/omniguide-radar)' };

async function get(url) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
      if (res.status === 429 || res.status >= 500) { await sleep(3000 * attempt); continue; }
      return { status: res.status, body: await res.text() };
    } catch (e) {
      await sleep(3000 * attempt);
    }
  }
  throw new Error('kept failing: ' + url);
}

const tileX = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const tileY = (lat, z) => {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
};

/* The bundle grid a level is surveyed over. */
function gridFor(z) {
  const b = Math.min(B, 2 ** z);
  if (z <= 8) { const n = 2 ** z / b; return { b, r0: 0, c0: 0, rows: n, cols: n }; }
  const box = z <= 12 ? WIDE : TIGHT;
  const c0 = Math.floor(tileX(box[0], z) / b), c1 = Math.floor(tileX(box[2], z) / b);
  const r0 = Math.floor(tileY(box[3], z) / b), r1 = Math.floor(tileY(box[1], z) / b);
  return { b, r0, c0, rows: r1 - r0 + 1, cols: c1 - c0 + 1 };
}

/* 'a' no tiles, 'f' every tile, 'p' some. */
async function bundleClass(svc, z, br, bc, b) {
  const r = await get(BASE + svc + '/MapServer/tilemap/' + z + '/' + br * b + '/' + bc * b + '/' + b + '/' + b);
  if (r.status === 422) return 'a';
  if (r.status !== 200) throw new Error(svc + ' tilemap ' + z + '/' + br + '/' + bc + ' answered ' + r.status);
  const j = JSON.parse(r.body);
  if (j.adjusted || j.location.width !== b || j.location.height !== b) {
    throw new Error(svc + ' tilemap ' + z + '/' + br + '/' + bc + ' came back adjusted: ' + JSON.stringify(j.location));
  }
  let n = 0;
  for (const v of j.data) n += v;
  return n === j.data.length ? 'f' : n ? 'p' : 'a';
}

/* Run-length: "12a3p40f", a count only where it is more than one. */
function rle(s) {
  let out = '';
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j < s.length && s[j] === s[i]) j++;
    out += (j - i > 1 ? j - i : '') + s[i];
    i = j;
  }
  return out;
}

/* The tiling has to be the plain Web Mercator one the map assumes. */
async function checkScheme(svc) {
  const j = JSON.parse((await get(BASE + svc + '/MapServer?f=json')).body);
  const t = j.tileInfo;
  const wkid = t.spatialReference.latestWkid || t.spatialReference.wkid;
  if (t.rows !== 256 || t.cols !== 256 || (wkid !== 3857 && wkid !== 102100) ||
      Math.abs(t.origin.x + 20037508.342787) > 1 || Math.abs(t.origin.y - 20037508.342787) > 1) {
    throw new Error(svc + ' is not on the standard 256 px Web Mercator tiling');
  }
  for (let z = 0; z <= MAX_LEVEL; z++) {
    const lod = t.lods.find((l) => l.level === z);
    if (!lod || Math.abs(lod.resolution * 2 ** z / 156543.03392800014 - 1) > 1e-6) {
      throw new Error(svc + ' level ' + z + ' is missing or at an unexpected resolution');
    }
  }
  const maxScaleLevel = Math.round(Math.log2(591657527.591555 / j.maxScale));
  console.log(svc + ': tileInfo lists levels ' + t.lods[0].level + '-' + t.lods[t.lods.length - 1].level +
    ', maxScale says ' + maxScaleLevel);
}

/* Level 17 should be empty; if USGS ever caches it, say so. */
async function checkBeyond(svc) {
  const pts = [[48.4, -114.5], [35.6, -83.5], [25.8, -80.9], [39.0, -98.0], [44.0, -71.5]];
  const z = MAX_LEVEL + 1;
  for (const [lat, lon] of pts) {
    const br = Math.floor(tileY(lat, z) / B), bc = Math.floor(tileX(lon, z) / B);
    if (await bundleClass(svc, z, br, bc, B) !== 'a') {
      console.log('  NOTE: ' + svc + ' has tiles at level ' + z + ' near ' + lat + ', ' + lon + ' - MAX_LEVEL could go up');
    }
  }
}

const out = {
  source: 'USGS The National Map basemap tile caches, tilemap per 128-tile bundle',
  note: 'Per level, the bundle grid surveyed and a run-length string of its bundles row by row: a = no tiles, f = every tile, p = some.',
  built: new Date().toISOString().slice(0, 10),
  bundle: B,
  services: {}
};

for (const svc of SERVICES) {
  await checkScheme(svc);
  const levels = [];
  let max = 0;
  for (let z = 0; z <= MAX_LEVEL; z++) {
    const g = gridFor(z);
    const jobs = [];
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) jobs.push([r, c]);
    const cls = new Array(jobs.length);
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const i = next++, [r, c] = jobs[i];
        cls[i] = await bundleClass(svc, z, g.r0 + r, g.c0 + c, g.b);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    const s = cls.join('');
    const count = (k) => s.split(k).length - 1;
    if (count('a') < s.length) max = z;
    console.log('  level ' + z + ': ' + s.length + ' bundles, ' + count('f') + ' full, ' + count('p') + ' partial, ' + count('a') + ' absent');
    levels.push({ r0: g.r0, c0: g.c0, rows: g.rows, cols: g.cols, cls: rle(s) });
  }
  await checkBeyond(svc);
  out.services[svc] = { max, levels };
}

const text = 'window.US_TILE_COVER=' + JSON.stringify(out) + ';\n';
writeFileSync(join(ROOT, 'js', 'tile-cover.js'), text);
console.log('wrote js/tile-cover.js, ' + Math.round(text.length / 1024) + ' KB');
