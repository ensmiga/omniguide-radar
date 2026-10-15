/* OmniGuide - ground closed to hunting, for the Legal Gate.

   WHY THIS EXISTS.

   The season placeholders are by state, so a state with a bear season
   showed the Great Smoky Mountains as open for bears, Shenandoah as open
   for whitetail and Yellowstone and Rocky Mountain as open for elk.
   Hunting is not allowed in a national park unless a federal law says it
   is (36 CFR 2.2), and in the lower 48 the one such law is Grand Teton's
   elk reduction program. Preserves, recreation areas, seashores and the
   rest are left alone: many of them do allow hunting.

   And one closure the state draws itself: Nevada does not allow bear
   hunting in its part of the Lake Tahoe Basin, or on the east face of the
   Carson Range between the basin and US 395 (NDOW, CR 26-07, special
   regulations for units 192 and 194).

   SOURCES, both public domain.
     National Park Service, Land Resources Division boundaries
       (UNIT_TYPE 'National Parks').
     USDA Forest Service, administrative forest boundaries
       (Lake Tahoe Basin Management Unit).

   Writes js/closures.js. Run: node ingest/closures.mjs */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, '.cache', 'closures');
const OUT = join(HERE, '..', 'js', 'closures.js');
mkdirSync(CACHE, { recursive: true });

const NPS = 'https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/' +
  'NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2/query';
const USFS = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/MapServer/1/query';

/* Simplified on the server to about 200 m - finer than anything the map
   or a lattice point can tell apart. */
const OFFSET = 0.002;

async function getJSON(url, name) {
  const path = join(CACHE, name + '.json');
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const res = await fetch(url, { headers: { 'user-agent': 'omniguide-ingest' } });
  if (!res.ok) throw new Error(name + ': HTTP ' + res.status);
  const j = await res.json();
  if (j.error) throw new Error(name + ': ' + JSON.stringify(j.error));
  writeFileSync(path, JSON.stringify(j));
  return j;
}

function query(base, where, fields) {
  return base + '?where=' + encodeURIComponent(where) + '&outFields=' + fields +
    '&returnGeometry=true&outSR=4326&maxAllowableOffset=' + OFFSET + '&geometryPrecision=4&f=json';
}

function bboxOf(rings) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (const [x, y] of r) {
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  }
  return b.map((v) => +v.toFixed(4));
}

const round = (rings) => rings.map((r) => r.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]));

/* Outside the lower 48: Alaska, Hawaii, American Samoa, the Virgin Islands. */
const NOT_CONUS = /^(AK|HI|SAMOA|VI)/;

const parksRaw = await getJSON(query(NPS, "UNIT_TYPE='National Parks'", 'UNIT_CODE,UNIT_NAME,STATE'), 'nps-parks');
const parks = [];
for (const f of parksRaw.features) {
  const a = f.attributes;
  if (NOT_CONUS.test(a.STATE || '')) continue;
  if (!f.geometry || !f.geometry.rings || !f.geometry.rings.length) throw new Error('no geometry for ' + a.UNIT_CODE);
  const rings = round(f.geometry.rings);
  parks.push({ code: a.UNIT_CODE, name: a.UNIT_NAME, bbox: bboxOf(rings), rings });
}
parks.sort((p, q) => p.code < q.code ? -1 : 1);

const ltbmuRaw = await getJSON(query(USFS, "FORESTNAME='Lake Tahoe Basin Management Unit'", 'FORESTNAME'), 'usfs-ltbmu');
if (ltbmuRaw.features.length !== 1) throw new Error('LTBMU: ' + ltbmuRaw.features.length + ' features');
const ltbmu = round(ltbmuRaw.features[0].geometry.rings);

/* The Carson Range east of the basin, as CR 26-07 bounds it: west, the
   basin boundary from the Little Valley line north to the Mount Rose
   Wilderness at the Relay Ridge radio tower; the wilderness boundary to
   the west line of Range 19 East and that line north to Thomas Creek
   Road (USFS 41049); north, Thomas Creek Road east to Timberline Drive,
   Timberline Drive to the Mount Rose Highway (SR 431) and the highway to
   US 395; east, US 395 south to the Bellevue interchange; south, the
   south line of Sections 14 to 18, T16N R19E, along the University of
   Nevada Little Valley study area, back to the basin. The corners are
   placed by hand from those landmarks, to within a kilometre or so, and
   the west edge is run a little into the basin so the two shapes meet.
   NDOW's own map is the authority. */
const carson = [[
  [-119.950, 39.330], [-119.895, 39.360], [-119.895, 39.395], [-119.840, 39.392],
  [-119.825, 39.380], [-119.776, 39.407], [-119.790, 39.330], [-119.808, 39.232],
  [-119.950, 39.230], [-119.950, 39.330]
]];

const out = {
  built: new Date().toISOString().slice(0, 10),
  source: 'National Park Service Land Resources Division boundaries; USDA Forest Service administrative ' +
    'forest boundaries (Lake Tahoe Basin Management Unit); Nevada CR 26-07 special regulations',
  parks,
  tahoe: { basin: { bbox: bboxOf(ltbmu), rings: ltbmu }, carson: { bbox: bboxOf(carson), rings: carson } }
};
const js = '/* Generated by ingest/closures.mjs - do not edit. Public domain sources; see that file. */\n' +
  'window.US_CLOSURES=' + JSON.stringify(out) + ';\n';
writeFileSync(OUT, js);
console.log('parks ' + parks.length + ' (' + parks.reduce((n, p) => n + p.rings.reduce((m, r) => m + r.length, 0), 0) +
  ' points), basin ' + ltbmu.reduce((m, r) => m + r.length, 0) + ' points, ' + (js.length / 1024).toFixed(0) + ' KB');
