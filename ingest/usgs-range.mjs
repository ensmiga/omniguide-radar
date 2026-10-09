/* OmniGuide - known range from the USGS Gap Analysis Project.

   WHY THIS EXISTS.

   Range used to be read off occurrence records for every species: where
   someone has logged the animal, it lives. For birds that works - there
   are millions of records. For elk it does not. Dropping the
   non-commercial records leaves 4,565 for the whole country, and a
   count that thin fails in both directions at once:

   A HERD NOBODY LOGGED DOES NOT EXIST. Theodore Roosevelt National Park,
   the Killdeer Mountains, the Pembina Hills, the Turtle Mountains,
   Kittson County and Grygla in Minnesota, the Jarbidge, Laramie Peak -
   all blank. Laramie Peak is one of the larger elk herds in Wyoming.

   ONE PHOTOGRAPH IS A HERD. A single record lights its presence cell,
   and the cell is a degree across. The map showed 3,500 square miles of
   elk range round Cape Girardeau, Missouri; round Taylor, Nebraska;
   round Amarillo; round Rocksprings, Texas; and round Devils Lake,
   North Dakota - one iNaturalist photo each, the last of them taken at
   a fenced federal game preserve. Austin to San Antonio was 6,400
   square miles on four photos.

   Scored against 87 places elk certainly are and 52 where they
   certainly are not, the record gate got 73 and 39. The USGS map gets
   82 and 47 before anything is added to it.

   WHAT THE USGS MAP IS.

   The Gap Analysis Project's species range maps: each of the country's
   sub-watersheds marked with whether the species is there, compiled
   from state agency range data and expert review, for 2008 to 2014.
   Public domain. https://doi.org/10.5066/F7Q81B3R

   The download carries one shape per kind of range, and the attribute
   that says which kind is not in the shapefile, so it was worked out by
   sampling points inside each shape and reading the table row for the
   sub-watershed underneath:

       1  known, native            kept
       2  possibly present, native kept - this is all of Oregon, whose
                                   whole elk range is coded this way
       3  known, introduced        kept
       4  possibly present,        kept - a sliver of south-east Oregon
          introduced
       5  known, reintroduced      kept
       6  possibly present,        dropped - a wandering bull in the
          vagrant                  Wind River basin is not elk range

   Historical range, where elk were shot out a century ago, is in the
   table and not in the shapes. The order above is checked against the
   number of points in each shape, and the build stops if it has changed.

   WHAT IS ADDED TO IT.

   The map ends in 2014. Three states have released elk since, or had
   only just done so, and those herds are not on it. They are added as
   plain circles, because a release site and a date are facts a state
   agency publishes and a record count is not:

       Black River State Forest, Wisconsin   released 2015-16
       Peck Ranch, Missouri                  released 2011-13
       Tomblin WMA, West Virginia            released 2016-18

   That list is short on purpose. It is not the place to patch a miss
   someone noticed; ground the map lacks because elk have spread into it
   since - the Niobrara in Nebraska, most obviously - stays a known gap
   until USGS or the state publishes it.

   Run it when a species is added or the USGS release changes:

       node ingest/usgs-range.mjs
       node tools/stamp.mjs

   It writes js/range-grid.js. The archive is kept in ingest/.cache so a
   second run does not download it again. */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CACHE = join(HERE, '.cache', 'usgs');

/* The habitat grid. Read from the raster so the two cannot drift. */
const hab = (() => {
  const s = readFileSync(join(ROOT, 'js', 'habitat-grid.js'), 'utf8');
  return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)).grid;
})();
const LON0 = hab.lon0, LAT0 = hab.lat0, D = hab.d, NX = hab.nlon, NY = hab.nlat;

/* Each cell is tested at 25 points, so its value is the share of it in range. */
const S = 5, d = D / S, W = NX * S, H = NY * S;

const SPECIES = {
  elk: {
    item: '59f5e1e6e4b063d5d307db71',
    name: 'Elk (Cervus elaphus) mELK1x_CONUS_2001v1 Range Map',
    /* points in each shape, in file order - the check that the order
       the comment above describes is still the order in the file */
    shapes: [547166, 75292, 46697, 7397, 44036, 74611],
    keep: [1, 2, 3, 4, 5],
    added: [
      { name: 'Black River State Forest, Wisconsin', lon: -90.65, lat: 44.30, km: 20, released: '2015-16', by: 'Wisconsin DNR' },
      { name: 'Peck Ranch, Missouri', lon: -91.18, lat: 37.05, km: 20, released: '2011-13', by: 'Missouri Department of Conservation' },
      { name: 'Tomblin WMA, West Virginia', lon: -82.00, lat: 37.80, km: 20, released: '2016-18', by: 'West Virginia DNR' }
    ]
  }
};

/* ---------- the archive ---------- */

async function fetchArchive(sp) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, sp.item + '.zip');
  if (existsSync(path)) return readFileSync(path);
  const meta = await (await fetch('https://www.sciencebase.gov/catalog/item/' + sp.item + '?format=json',
    { headers: { 'user-agent': 'omniguide-ingest' } })).json();
  if (meta.title !== sp.name) throw new Error('ScienceBase item ' + sp.item + ' is "' + meta.title + '", expected "' + sp.name + '"');
  const file = (meta.files || []).find((f) => /_Range_.*\.zip$/i.test(f.name));
  if (!file) throw new Error('no range archive attached to ' + sp.item);
  const res = await fetch(file.url, { headers: { 'user-agent': 'omniguide-ingest' } });
  if (!res.ok) throw new Error('USGS download failed: ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  return buf;
}

/* Just enough of the zip format to pull one member out: the directory at
   the end says where each file starts and how it was packed. */
function unzip(buf, wanted) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip archive');
  let o = buf.readUInt32LE(e + 16);
  for (let i = buf.readUInt16LE(e + 10); i > 0; i--) {
    if (buf.readUInt32LE(o) !== 0x02014b50) throw new Error('damaged zip directory');
    const method = buf.readUInt16LE(o + 10), size = buf.readUInt32LE(o + 20);
    const nameLen = buf.readUInt16LE(o + 28), local = buf.readUInt32LE(o + 42);
    const name = buf.toString('utf8', o + 46, o + 46 + nameLen);
    if (wanted.test(name)) {
      const at = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(at, at + size);
      if (method === 0) return raw;
      if (method === 8) return inflateRawSync(raw);
      throw new Error(name + ' is packed with method ' + method);
    }
    o += 46 + nameLen + buf.readUInt16LE(o + 30) + buf.readUInt16LE(o + 32);
  }
  throw new Error('nothing matching ' + wanted + ' in the archive');
}

/* ---------- the projection ----------

   The shapes are in Albers equal-area, NAD83: central meridian 96 W,
   standard parallels 29.5 and 45.5, origin 23 N, metres. This is the
   inverse on the GRS80 ellipsoid (Snyder, Map Projections - A Working
   Manual, equations 14-8 to 14-11 and 3-16). */
const A = 6378137, F = 1 / 298.257222101, E2 = 2 * F - F * F, E = Math.sqrt(E2), RAD = Math.PI / 180;
const qOf = (p) => { const s = Math.sin(p); return (1 - E2) * (s / (1 - E2 * s * s) - Math.log((1 - E * s) / (1 + E * s)) / (2 * E)); };
const mOf = (p) => Math.cos(p) / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
const P1 = 29.5 * RAD, P2 = 45.5 * RAD, P0 = 23 * RAD, L0 = -96 * RAD;
const CONE = (mOf(P1) ** 2 - mOf(P2) ** 2) / (qOf(P2) - qOf(P1));
const CC = mOf(P1) ** 2 + CONE * qOf(P1);
const RHO0 = A * Math.sqrt(CC - CONE * qOf(P0)) / CONE;

function toLonLat(x, y, out) {
  const dy = RHO0 - y, rho = Math.sqrt(x * x + dy * dy), theta = Math.atan2(x, dy);
  const q = (CC - rho * rho * CONE * CONE / (A * A)) / CONE;
  let p = Math.asin(q / 2);
  for (let i = 0; i < 6; i++) {
    const s = Math.sin(p), t = 1 - E2 * s * s;
    p += t * t / (2 * Math.cos(p)) * (q / (1 - E2) - s / t + Math.log((1 - E * s) / (1 + E * s)) / (2 * E));
  }
  out[0] = (L0 + theta / CONE) / RAD;
  out[1] = p / RAD;
  return out;
}

/* ---------- shapes onto the grid ----------

   Scanline fill, even-odd, one shape at a time so that a hole in one
   is not filled by counting it against another. Every ring edge is
   dropped onto the rows of sample points it crosses; along each row the
   crossings pair off into the stretches that are inside. */
function rasterise(shp, sp) {
  const inside = new Uint8Array(W * H);
  const ll = [0, 0];
  let o = 100, index = 0;
  while (o < shp.length) {
    const bytes = shp.readInt32BE(o + 4) * 2, b = o + 8;
    if (shp.readInt32LE(b) !== 5) throw new Error('shape ' + (index + 1) + ' is not a polygon');
    const nParts = shp.readInt32LE(b + 36), nPts = shp.readInt32LE(b + 40);
    index++;
    if (sp.shapes[index - 1] !== nPts) {
      throw new Error('shape ' + index + ' has ' + nPts + ' points, expected ' + sp.shapes[index - 1] +
        ' - the USGS file has changed and which shape is which kind of range must be worked out again');
    }
    if (sp.keep.indexOf(index) >= 0) {
      const partsAt = b + 44, ptsAt = partsAt + 4 * nParts;
      const rows = Array.from({ length: H }, () => []);
      for (let p = 0; p < nParts; p++) {
        const from = shp.readInt32LE(partsAt + 4 * p);
        const to = p + 1 < nParts ? shp.readInt32LE(partsAt + 4 * (p + 1)) : nPts;
        let px = 0, py = 0;
        for (let i = from; i < to; i++) {
          toLonLat(shp.readDoubleLE(ptsAt + 16 * i), shp.readDoubleLE(ptsAt + 16 * i + 8), ll);
          const x = (ll[0] - LON0) / d, y = (ll[1] - LAT0) / d;
          if (i > from && y !== py) {
            const lo = Math.min(y, py), hi = Math.max(y, py);
            for (let j = Math.max(0, Math.ceil(lo - 0.5)); j <= Math.min(H - 1, Math.floor(hi - 0.5)); j++) {
              const yc = j + 0.5;
              if (yc < lo || yc >= hi) continue;
              rows[j].push(px + (x - px) * (yc - py) / (y - py));
            }
          }
          px = x; py = y;
        }
      }
      for (let j = 0; j < H; j++) {
        const r = rows[j];
        if (!r.length) continue;
        r.sort((a, c) => a - c);
        for (let k = 0; k + 1 < r.length; k += 2) {
          for (let i = Math.max(0, Math.ceil(r[k] - 0.5)); i <= Math.min(W - 1, Math.floor(r[k + 1] - 0.5)); i++) inside[j * W + i] = 1;
        }
      }
    }
    o += 8 + bytes;
  }
  if (index !== sp.shapes.length) throw new Error('expected ' + sp.shapes.length + ' shapes, found ' + index);
  return inside;
}

function addCircles(inside, list) {
  for (const c of list) {
    const dLat = c.km / 111.2, dLon = dLat / Math.cos(c.lat * RAD);
    for (let j = Math.floor((c.lat - dLat - LAT0) / d); j <= Math.ceil((c.lat + dLat - LAT0) / d); j++) {
      for (let i = Math.floor((c.lon - dLon - LON0) / d); i <= Math.ceil((c.lon + dLon - LON0) / d); i++) {
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        const ey = (LAT0 + (j + 0.5) * d - c.lat) / dLat, ex = (LON0 + (i + 0.5) * d - c.lon) / dLon;
        if (ex * ex + ey * ey <= 1) inside[j * W + i] = 1;
      }
    }
  }
}

function toCells(inside) {
  const out = new Uint8Array(NX * NY);
  let any = 0;
  for (let y = 0; y < NY; y++) {
    for (let x = 0; x < NX; x++) {
      let n = 0;
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) n += inside[(y * S + j) * W + x * S + i];
      out[y * NX + x] = Math.round(255 * n / (S * S));
      if (n) any++;
    }
  }
  return { cells: out, touched: any };
}

/* ---------- build ---------- */

const out = {
  source: 'U.S. Geological Survey Gap Analysis Project, Species Range Maps CONUS_2001 (2018), https://doi.org/10.5066/F7Q81B3R',
  note: 'Share of each cell inside the known range, 0-255. Vagrant and historical range left out. ' +
        'Herds released since the map was compiled are added as circles and listed under added.',
  built: new Date().toISOString().slice(0, 10),
  grid: { lon0: LON0, lat0: LAT0, d: D, nlon: NX, nlat: NY },
  sp: {},
  added: {}
};

for (const [id, sp] of Object.entries(SPECIES)) {
  const zip = await fetchArchive(sp);
  const inside = rasterise(unzip(zip, /\.shp$/i), sp);
  const mapped = toCells(inside).touched;
  addCircles(inside, sp.added);
  const r = toCells(inside);
  out.sp[id] = Buffer.from(r.cells).toString('base64');
  out.added[id] = sp.added.map((c) => ({ name: c.name, released: c.released, by: c.by }));
  console.log(id + ': ' + mapped + ' cells from the USGS map, ' + (r.touched - mapped) + ' more from ' + sp.added.length + ' later releases');
}

writeFileSync(join(ROOT, 'js', 'range-grid.js'), 'window.US_RANGE=' + JSON.stringify(out) + ';\n');
console.log('wrote js/range-grid.js');
