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

import { writeFileSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
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
      if (res.status === 429) {
        /* The body says which limit: per minute, per hour or per day.
           Only the first is worth waiting for. */
        let reason = '';
        try { reason = (await res.json()).reason || ''; } catch (e) { /* no body */ }
        const err = new Error(`HTTP 429${reason ? ' - ' + reason : ''}`);
        err.limit = /hour/i.test(reason) ? 'hour' : /dai|day/i.test(reason) ? 'day' : 'minute';
        throw err;
      }
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body && body.error) throw new Error(body.reason || 'API error');
      return body;
    } catch (err) {
      if (attempt === tries) throw new Error(`${label} failed after ${tries} tries: ${err.message}`);
      /* An hourly or daily limit will not clear while this job is alive. */
      if (err.limit === 'hour' || err.limit === 'day') {
        throw new Error(`${label}: ${err.message}. Not retrying - the next scheduled run will.`);
      }
      /* A per-minute limit clears when the minute does, so that is how
         long to wait. This used to back off 2, 8 and 18 seconds - 28 in
         all - and give up, having never once waited out the window it
         was told about. */
      const wait = err.limit === 'minute' ? 62000 : 2000 * attempt * attempt;
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

  /* PACING.

     Open-Meteo's open tier counts every location in a request as a
     call and allows 600 a minute. This grid is 987 points, and the
     loop used to send them 120 at a time with 1.2 seconds between -
     all of it inside fifteen seconds. Measured: the first five
     requests are answered and the sixth is refused with "Minutely API
     request limit exceeded. Please try again in one minute."

     Whether the job then survived came down to luck. The limit resets
     on the clock minute, so a run that happened to straddle one got
     through and a run that did not failed after its 28 seconds of
     retries. It passed four times on the 7th and failed twice on the
     8th, and the site sat a day stale behind it.

     Sixteen seconds between the start of one request and the next is
     450 points a minute, which leaves room for whoever else is behind
     the same address on a shared runner. The whole grid takes a little
     over two minutes, three times a day. */
  const BATCH = 120, GAP_MS = 16000;
  for (let b = 0; b < pts.length; b += BATCH) {
    const began = Date.now();
    const slice = pts.slice(b, b + BATCH);
    const url = 'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${slice.map((p) => p[0]).join(',')}` +
      `&longitude=${slice.map((p) => p[1]).join(',')}` +
      `&hourly=${hourly}&forecast_days=${DAYS}` +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=GMT';

    const batch = await getJSON(url, { label: `forecast batch ${b / BATCH + 1}`, tries: 6 });
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
    if (b + BATCH < pts.length) await sleep(Math.max(0, GAP_MS - (Date.now() - began)));
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
 * key, updated every 15 to 60 minutes.
 *
 * Queried per state, not by bounding box. The bBox endpoint returns 503 for
 * anything useful-sized, which is why the first version of this silently
 * produced an empty file: the failures were caught and skipped, so the run
 * went green with no data in it. */
const STATES = [
  'al', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'id', 'il', 'in', 'ia',
  'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv',
  'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd',
  'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy'
];

async function ingestWater() {
  const sites = new Map();
  let ok = 0, failed = 0;
  for (const st of STATES) {
    const url = 'https://waterservices.usgs.gov/nwis/iv/?format=json' +
      `&stateCd=${st}&parameterCd=00010,00060&siteStatus=active`;
    let payload;
    try {
      payload = await getJSON(url, { label: `water ${st.toUpperCase()}` });
      ok++;
    } catch (err) {
      failed++;
      console.warn(`  skipping ${st.toUpperCase()}: ${err.message}`);
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
    console.log(`  ${st.toUpperCase()}: ${sites.size} sites so far`);
    await sleep(500);
  }

  /* An empty result means the endpoint moved or is down. Fail loudly: a
     green run that quietly wrote an empty file is exactly how this broke
     the first time, and nobody noticed for a day. */
  if (sites.size === 0) {
    throw new Error(`no gauges returned from any state (${ok} ok, ${failed} failed)`);
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

/* HOW A RUN ENDS.

   This used to be one try block: forecast, then gauges, and any error
   failed the job. Three things followed from that. A forecast refusal
   threw away a gauge pull that had nothing wrong with it. One bad
   attempt left the site stale until the next scheduled slot eight hours
   on. And every miss was an email, whether the data was an hour old or a
   day.

   So the schedule now tries often and this decides what a try means:

     --skip-if-fresh=H    the forecast in the repo is under H hours old:
                          do nothing, successfully. Lets the workflow run
                          every two hours without pulling every two hours.
     --tolerate-stale=H   a pull that fails is a warning, not a failure,
                          while the data already published is under H
                          hours old - another attempt is two hours away.
                          Past that it fails properly, because by then
                          someone needs to know.

   With neither flag - a run by hand - any failure fails, as before. */
function forecastAgeHours() {
  try {
    const head = readFileSync(resolve(OUT, 'wx-grid.js'), 'utf8').slice(0, 800);
    const m = /fetched:"([^"]+)"/.exec(head);
    const t = m ? Date.parse(m[1]) : NaN;
    return Number.isFinite(t) ? (Date.now() - t) / 3.6e6 : Infinity;
  } catch (err) {
    return Infinity;
  }
}

const FRESH_H = Number(argv['skip-if-fresh'] ?? 0);
const TOLERATE_H = Number(argv['tolerate-stale'] ?? 0);
const IN_CI = !!process.env.GITHUB_ACTIONS;
const annotate = (level, msg) => console.log(IN_CI ? `::${level}::${msg}` : `${level.toUpperCase()}: ${msg}`);
/* Tells the workflow whether anything was pulled, so the steps after
   this one can stand down when nothing was. */
const report = (refreshed) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `refreshed=${refreshed}\n`);
};

const started = Date.now();
const ageBefore = forecastAgeHours();

if (FRESH_H > 0 && ageBefore < FRESH_H) {
  console.log(`forecast is ${ageBefore.toFixed(1)} h old, under ${FRESH_H} h - nothing to do this run`);
  report(false);
} else {
  const failed = [];
  let pulled = 0;
  if (ONLY !== 'water') {
    try { await ingestForecast(); pulled++; } catch (err) { failed.push(['forecast', err.message]); }
  }
  if (ONLY !== 'wx') {
    try { await ingestWater(); pulled++; } catch (err) { failed.push(['gauges', err.message]); }
  }
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  report(pulled > 0);

  for (const [what, msg] of failed) console.error(`${what} pull failed: ${msg}`);
  if (failed.length) {
    const forecastFailed = failed.some((f) => f[0] === 'forecast');
    const excusable = TOLERATE_H > 0 && (!forecastFailed || ageBefore <= TOLERATE_H);
    if (excusable) {
      annotate('warning', failed.map((f) => `${f[0]} pull failed (${f[1]})`).join('; ') +
        (forecastFailed ? `. Published forecast is ${ageBefore.toFixed(1)} h old; trying again next run.` : ''));
    } else {
      if (forecastFailed && TOLERATE_H > 0) {
        annotate('error', `forecast has not refreshed in ${ageBefore.toFixed(1)} h`);
      }
      process.exitCode = 1;
    }
  }
}
