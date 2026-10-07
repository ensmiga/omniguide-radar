/* SNODAS snow ingestion.
 *
 * NOHRSC runs a daily national snow model. This pulls the snow-depth and
 * snow-water-equivalent grids and downsamples them onto the same 1.25 degree
 * lattice the forecast uses, so the app can read snow the same way it reads
 * everything else.
 *
 * Why bother when the weather model already carries a snow field: the
 * forecast's snow is modelled from its own precipitation and temperature,
 * and it drifts. SNODAS assimilates satellite and ground observations, so
 * it is far closer to what is actually lying on the ground - which for
 * geese, deer and upland birds is the single most behaviour-changing
 * variable there is.
 *
 * Format, from the product headers:
 *   6935 x 3351 grid, 30 arc-second cells
 *   big-endian signed 16-bit, no-data -9999
 *   origin at the north-west corner, row-major, south-ward
 *   snow depth and SWE both in millimetres
 *
 * Product codes: 1036 snow depth, 1034 snow water equivalent.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'js');

const COLS = 6935, ROWS = 3351;
const RES = 1 / 120;                     // 30 arc-seconds
const WEST = -124.733333333328, NORTH = 52.8749999999979;
const NODATA = -9999;

/* The app's grid, matching js/wx.js. */
const LAT0 = 24.5, LON0 = -124.5, D = 1.25, NLAT = 21, NLON = 47;

function pad(n) { return String(n).padStart(2, '0'); }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function tarUrl(d) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  return 'https://noaadata.apps.nsidc.org/NOAA/G02158/masked/' +
    `${y}/${pad(m + 1)}_${MONTHS[m]}/SNODAS_${y}${pad(m + 1)}${pad(d.getUTCDate())}.tar`;
}

/* Minimal tar reader: 512-byte headers, name in the first 100 bytes, octal
 * size at offset 124, data padded to a 512-byte boundary. */
function* tarEntries(buf) {
  let off = 0;
  while (off + 512 <= buf.length) {
    const name = buf.toString('utf8', off, off + 100).replace(/\0.*$/, '');
    if (!name) { off += 512; continue; }
    const sizeStr = buf.toString('ascii', off + 124, off + 136).replace(/\0.*$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const start = off + 512;
    yield { name, data: buf.subarray(start, start + size) };
    off = start + Math.ceil(size / 512) * 512;
  }
}

/* Average the SNODAS cells falling inside each app grid cell. */
function downsample(grid) {
  const out = new Float64Array(NLAT * NLON);
  const count = new Int32Array(NLAT * NLON);

  for (let r = 0; r < ROWS; r++) {
    const lat = NORTH - (r + 0.5) * RES;
    const gy = Math.round((lat - LAT0) / D);
    if (gy < 0 || gy >= NLAT) continue;
    const rowOff = r * COLS;
    for (let c = 0; c < COLS; c++) {
      const v = grid[rowOff + c];
      if (v === NODATA) continue;
      const lon = WEST + (c + 0.5) * RES;
      const gx = Math.round((lon - LON0) / D);
      if (gx < 0 || gx >= NLON) continue;
      const i = gy * NLON + gx;
      out[i] += v;
      count[i] += 1;
    }
  }
  const res = new Array(NLAT * NLON);
  for (let i = 0; i < res.length; i++) res[i] = count[i] ? Math.round(out[i] / count[i]) : -1;
  return res;
}

async function fetchDay(d) {
  const url = tarUrl(d);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

export async function ingestSnow() {
  /* The current day is published mid-morning UTC, so step back until one
     exists rather than failing on a race with their publishing schedule. */
  let buf = null, used = null;
  for (let back = 1; back <= 4 && !buf; back++) {
    const d = new Date(Date.now() - back * 86400000);
    try {
      buf = await fetchDay(d);
      used = d;
      console.log(`snow: using ${d.toISOString().slice(0, 10)}`);
    } catch (e) {
      console.warn(`  ${e.message}`);
    }
  }
  if (!buf) throw new Error('no SNODAS archive available in the last four days');

  const want = { '1036': 'depth', '1034': 'swe' };
  const found = {};
  for (const e of tarEntries(buf)) {
    const m = e.name.match(/ssmv1(\d{4})/);
    if (!m || !want[m[1]] || !e.name.endsWith('.dat.gz')) continue;
    const raw = gunzipSync(e.data);
    if (raw.length !== COLS * ROWS * 2) {
      console.warn(`  ${e.name}: unexpected size ${raw.length}, skipping`);
      continue;
    }
    const grid = new Int16Array(COLS * ROWS);
    for (let i = 0; i < grid.length; i++) grid[i] = raw.readInt16BE(i * 2);
    found[want[m[1]]] = downsample(grid);
    console.log(`  ${want[m[1]]}: parsed and downsampled`);
  }

  if (!found.depth) throw new Error('snow depth product missing from the archive');

  const out = 'window.US_SNOW={source:"NOHRSC SNODAS daily snow model"' +
    `,date:"${used.toISOString().slice(0, 10)}"` +
    `,fetched:${JSON.stringify(new Date().toUTCString())}` +
    ',units:{depth:"mm",swe:"mm"},nodata:-1' +
    `,grid:{lat0:${LAT0},lon0:${LON0},d:${D},nlat:${NLAT},nlon:${NLON}}` +
    `,depth:[${found.depth}]` +
    (found.swe ? `,swe:[${found.swe}]` : '') +
    '};\n';

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'snow.js'), out);
  const covered = found.depth.filter((v) => v >= 0).length;
  console.log(`wrote js/snow.js (${covered} of ${NLAT * NLON} cells with data)`);
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/') ||
    process.argv[1]?.endsWith('snodas.mjs')) {
  ingestSnow().catch((e) => { console.error('snow ingest failed:', e.message); process.exitCode = 1; });
}
