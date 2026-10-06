#!/usr/bin/env node
/* OmniGuide data ingestion.
 *
 * Regenerates js/wx-grid.js (forecast) and js/gauges.js (USGS water) in the
 * exact format the app loads, so the refresh loop is:
 *
 *     node ingest/ingest.mjs  ->  republish  ->  app has current data
 *
 * Node 18+ only. No dependencies: global fetch, fs and nothing else.
 *
 * Usage:
 *   node ingest/ingest.mjs                 both datasets
 *   node ingest/ingest.mjs --only=wx       forecast only
 *   node ingest/ingest.mjs --only=water    gauges only
 *   node ingest/ingest.mjs --spacing=0.75  finer grid (more API calls)
 *   node ingest/ingest.mjs --days=10       longer forecast horizon
 *
 * On a schedule, every 6 hours lines up with the main model cycles:
 *   0 ‍*‍/6 * * * cd /srv/omniguide && node ingest/ingest.mjs >> ingest.log 2>&1
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'js');

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const SPACING = Number(argv.spacing ?? 1.25);
const DAYS = Number(argv.days ?? 8);
const STEP_H = 3;
const ONLY = argv.only ?? null;

/* CONUS envelope. Everything downstream assumes a regular lattice in this
 * box, latitude-major, so do not reorder the point list. */
const LAT0 = 24.5, LAT1 = 49.5, LON0 = -124.5, LON1 = -67.0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, { tries = 4, label = 'request' } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'OmniGuide/1.0 (ingest)' } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body && body.error) throw new Error(body.reason || 'API error');
      return body;
    } catch (err) {
      if (attempt === tries) throw new Error(`${label} failed after ${tries} tries: ${err.message}`);
      const wait = 2000 * attempt * attempt;   // the public tier rate-limits per minute
      console.warn(`  ${label}: ${err.message}; retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

/* ---------------------------------------------------------------- forecast */

const FIELDS = [
  ['temperature_2m', 'T', 1],
  ['surface_pressure', 'P', 1],
  ['wind_speed_10m', 'WS', 1],
  ['wind_direction_10m', 'WD', 1],
  ['wind_gusts_10m', 'WG', 1],
  ['cloud_cover', 'CC', 1],
  ['precipitation', 'PR', 100],
  ['snowfall', 'SF', 10],
  ['snow_depth', 'SD', 100]
];

function buildGrid() {
  const nLat = Math.floor((LAT1 - LAT0) / SPACING) + 1;
  const nLon = Math.floor((LON1 - LON0) / SPACING) + 1;
  const pts = [];
  for (let i = 0; i < nLat; i++) {
    for (let j = 0; j < nLon; j++) {
      pts.push([+(LAT0 + i * SPACING).toFixed(4), +(LON0 + j * SPACING).toFixed(4)]);
    }
  }
  return { pts, nLat, nLon };
}

async function ingestForecast() {
  const { pts, nLat, nLon } = buildGrid();
  const steps = Math.floor((DAYS * 24) / STEP_H);
  console.log(`forecast: ${pts.length} points (${nLat} x ${nLon} at ${SPACING} deg), ` +
              `${steps} steps of ${STEP_H}h`);

  const hourly = FIELDS.map((f) => f[0]).join(',');
  const packed = Object.fromEntries(FIELDS.map((f) => [f[1], []]));
  const lat = [], lon = [], elev = [];
  let t0 = null;

  const BATCH = 120;
  for (let b = 0; b < pts.length; b += BATCH) {
    const slice = pts.slice(b, b + BATCH);
    const url = 'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${slice.map((p) => p[0]).join(',')}` +
      `&longitude=${slice.map((p) => p[1]).join(',')}` +
      `&hourly=${hourly}&forecast_days=${DAYS}` +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=GMT';

    const batch = await getJSON(url, { label: `forecast batch ${b / BATCH + 1}` });
    const rows = Array.isArray(batch) ? batch : [batch];

    for (const p of rows) {
      if (t0 === null) t0 = p.hourly.time[0];
      lat.push(+p.latitude.toFixed(3));
      lon.push(+p.longitude.toFixed(3));
      elev.push(Math.round(p.elevation));
      for (const [name, key, mul] of FIELDS) {
        const src = p.hourly[name], dst = packed[key];
        let last = 0;
        for (let s = 0; s < steps; s++) {
          let v = src[s * STEP_H];
          if (v === null || v === undefined || Number.isNaN(v)) v = last; else last = v;
          dst.push(Math.round(v * mul));
        }
      }
    }
    console.log(`  ${Math.min(b + BATCH, pts.length)}/${pts.length}`);
    await sleep(1200);                 // stay under the per-minute limit
  }

  if (lat.length !== pts.length) {
    throw new Error(`grid incomplete: got ${lat.length} of ${pts.length} points. ` +
                    'A partial grid would misalign every index downstream.');
  }

  const out =
    'window.WX_GRID={v:1,source:"Open-Meteo blend (NBM/GFS/HRRR/ICON)"' +
    `,fetched:${JSON.stringify(new Date().toUTCString())}` +
    `,t0:"${t0}Z",stepH:${STEP_H},steps:${steps},npts:${lat.length}` +
    `,grid:{lat0:${LAT0},lon0:${LON0},d:${SPACING},nlat:${nLat},nlon:${nLon}}` +
    ',units:{T:"F",P:"hPa",WS:"mph",WD:"deg",WG:"mph",CC:"%",PR:"in/100",SF:"in/10",SD:"ft/100"}' +
    `,lat:[${lat}],lon:[${lon}],elev:[${elev}]` +
    FIELDS.map(([, k]) => `,${k}:[${packed[k]}]`).join('') +
    '};\n';

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'wx-grid.js'), out);
  console.log(`wrote js/wx-grid.js (${(out.length / 1e6).toFixed(2)} MB)`);

  if (SPACING !== 1.25 || nLat !== 21 || nLon !== 47) {
    console.warn('NOTE: grid geometry changed. Update NLAT/NLON/LAT0/LON0/DLAT/DLON ' +
                 'at the top of js/wx.js to match, or interpolation will be wrong.');
  }
}

/* ------------------------------------------------------------------- water */

/* Discharge (00060) and water temperature (00010) from USGS NWIS. Free, no
 * key, updated every 15 to 60 minutes. The bBox limit is 25 degrees per side
 * and the product of the sides is capped too, so CONUS is walked in tiles. */
const WATER_TILES = [
  [-125, 31, -112, 49.5], [-112, 31, -100, 49.5],
  [-100, 36, -88, 49.5], [-100, 25, -88, 36],
  [-88, 36, -75, 49.5], [-88, 25, -75, 36],
  [-75, 36, -66.5, 47.5], [-75, 25, -66.5, 36]
];

async function ingestWater() {
  const sites = new Map();
  for (const [a, b, c, d] of WATER_TILES) {
    const url = 'https://waterservices.usgs.gov/nwis/iv/?format=json' +
      `&bBox=${a},${b},${c},${d}&parameterCd=00010,00060&siteStatus=active`;
    let payload;
    try {
      payload = await getJSON(url, { label: `water tile ${a},${b}` });
    } catch (err) {
      console.warn(`  skipping tile ${a},${b}: ${err.message}`);
      continue;
    }
    for (const series of payload?.value?.timeSeries ?? []) {
      const src = series.sourceInfo;
      const code = series.variable?.variableCode?.[0]?.value;
      const pt = series.values?.[0]?.value?.[0];
      if (!src || !pt || pt.value === undefined) continue;
      const v = Number(pt.value);
      if (!Number.isFinite(v) || v <= -999) continue;

      const id = src.siteCode?.[0]?.value;
      const gl = src.geoLocation?.geogLocation;
      if (!id || !gl) continue;
      if (!sites.has(id)) {
        sites.set(id, {
          id, name: src.siteName, lat: +(+gl.latitude).toFixed(4), lon: +(+gl.longitude).toFixed(4)
        });
      }
      const row = sites.get(id);
      if (code === '00010') row.tempC = +v.toFixed(1);
      if (code === '00060') row.cfs = Math.round(v);
      row.at = pt.dateTime;
    }
    console.log(`  tile ${a},${b}: ${sites.size} sites so far`);
    await sleep(800);
  }

  const rows = [...sites.values()].filter((s) => s.tempC !== undefined || s.cfs !== undefined);
  const out = 'window.US_GAUGES={source:"USGS NWIS instantaneous values"' +
    `,fetched:${JSON.stringify(new Date().toUTCString())}` +
    ',sites:[' + rows.map((s) =>
      `["${s.id}",${JSON.stringify(s.name)},${s.lat},${s.lon},` +
      `${s.tempC ?? 'null'},${s.cfs ?? 'null'}]`).join(',') + ']};\n';

  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, 'gauges.js'), out);
  console.log(`wrote js/gauges.js (${rows.length} gauges, ${(out.length / 1e6).toFixed(2)} MB)`);
}

/* -------------------------------------------------------------------- main */

const started = Date.now();
try {
  if (ONLY !== 'water') await ingestForecast();
  if (ONLY !== 'wx') await ingestWater();
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
} catch (err) {
  console.error('ingest failed:', err.message);
  process.exitCode = 1;
}
