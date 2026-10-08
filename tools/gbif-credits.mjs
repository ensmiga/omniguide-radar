/* Who to credit for the occurrence records.

   WHY THIS EXISTS.

   The records behind the range gate and the migration calendar come
   through GBIF, but GBIF is the index, not the owner. Each record
   belongs to a dataset - eBird, iNaturalist, a museum collection - and
   the CC BY 4.0 licence most of them carry allows any use, commercial
   included, on one condition: the dataset is credited. "GBIF" on its
   own is not that credit.

   So this asks GBIF which datasets the build's own filter draws on and
   writes them to js/gbif-credits.js, which the Sources panel lists in
   full. Run it after every raster build, because the list is whatever
   the records were on the day:

       node ingest/habitat.mjs
       node tools/gbif-credits.mjs
       node tools/stamp.mjs

   Read-only against GBIF: facet counts and dataset titles. A hundred
   and fifty or so small requests, spaced out, about a minute.

   The filter below has to stay the same as occurrenceFilter in
   ingest/habitat.mjs. The taxa and the grid are read from the raster
   that build wrote, so those cannot drift; the years and the licence
   list are repeated here and can. */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const YEAR0 = 2015, YEAR1 = 2025;
const LICENCE = '&license=CC0_1_0&license=CC_BY_4_0';
const API = 'https://api.gbif.org/v1/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (v) => Math.round(v * 1000) / 1000;

async function get(path) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(API + path, { headers: { 'user-agent': 'omniguide-credits (github.com/ensmiga/omniguide-radar)' } });
    if (res.status === 429 || res.status >= 500) { await sleep(4000 * attempt); continue; }
    if (!res.ok) throw new Error('GBIF ' + res.status + ' for ' + path);
    await sleep(150);
    return res.json();
  }
  throw new Error('GBIF kept refusing ' + path);
}

const raster = readFileSync(join(ROOT, 'js', 'habitat-grid.js'), 'utf8');
const hab = JSON.parse(raster.slice(raster.indexOf('{'), raster.lastIndexOf('}') + 1));
const g = hab.grid;
const box = '&decimalLatitude=' + g.lat0 + ',' + r3(g.lat0 + g.nlat * g.d) +
            '&decimalLongitude=' + g.lon0 + ',' + r3(g.lon0 + g.nlon * g.d);
const taxa = [...new Set(hab.harvest.map((h) => h.name))];

const FACET_LIMIT = 1000;
const perDataset = new Map();
let total = 0;

for (const name of taxa) {
  const m = await get('species/match?strict=true&name=' + encodeURIComponent(name));
  if (!m.usageKey) throw new Error('no GBIF key for ' + name);
  const j = await get('occurrence/search?limit=0&taxonKey=' + m.usageKey +
    '&country=US&hasCoordinate=true&hasGeospatialIssue=false&year=' + YEAR0 + ',' + YEAR1 +
    box + LICENCE + '&facet=datasetKey&facet=license&facetLimit=' + FACET_LIMIT);
  for (const f of j.facets) {
    if (f.field === 'LICENSE') {
      const odd = f.counts.filter((c) => c.name !== 'CC_BY_4_0' && c.name !== 'CC0_1_0');
      if (odd.length) throw new Error(name + ': records under ' + odd.map((c) => c.name).join(', ') + ' got through the licence filter');
    } else {
      /* A full page means there may be more behind it, and a credit
         list that silently stops at a round number is not a list. */
      if (f.counts.length >= FACET_LIMIT) throw new Error(name + ': more than ' + FACET_LIMIT + ' datasets - raise FACET_LIMIT');
      for (const c of f.counts) perDataset.set(c.name, (perDataset.get(c.name) || 0) + c.count);
    }
  }
  total += j.count;
  process.stderr.write('  ' + name + ': ' + j.count + '\n');
}

const publishers = new Map();
const datasets = [];
for (const [key, n] of [...perDataset].sort((a, b) => b[1] - a[1])) {
  const d = await get('dataset/' + key);
  let pub = publishers.get(d.publishingOrganizationKey);
  if (pub === undefined) {
    pub = (await get('organization/' + d.publishingOrganizationKey)).title || '';
    publishers.set(d.publishingOrganizationKey, pub);
  }
  datasets.push({ t: d.title, p: pub, doi: d.doi || null, key: key, n: n });
}

const out = {
  source: 'GBIF.org occurrence search, facet counts by dataset',
  note: 'Datasets contributing at least one record to the habitat raster build. Only records ' +
        'individually licensed CC BY 4.0 or CC0 1.0 are used.',
  built: new Date().toISOString().slice(0, 10),
  rasterBuilt: hab.built,
  years: [YEAR0, YEAR1],
  taxa: taxa.length,
  records: total,
  datasets: datasets
};

writeFileSync(join(ROOT, 'js', 'gbif-credits.js'), 'window.US_GBIF_CREDITS=' + JSON.stringify(out) + ';\n');
console.log('wrote js/gbif-credits.js: ' + datasets.length + ' datasets behind ' + total + ' records across ' + taxa.length + ' taxa');
console.log('largest: ' + datasets.slice(0, 3).map((d) => d.t + ' ' + (100 * d.n / total).toFixed(2) + '%').join(' | '));
