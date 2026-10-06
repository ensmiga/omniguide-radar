# OmniGuide data ingestion

`ingest.mjs` regenerates the data files the app reads. Node 18 or newer, no dependencies.

```bash
node ingest/ingest.mjs
```

Writes `js/wx-grid.js` (forecast) and `js/gauges.js` (USGS water). Takes a few minutes,
mostly spent waiting out the public API rate limit.

Every six hours tracks the main model cycles:

```
0 */6 * * * cd /srv/omniguide && node ingest/ingest.mjs >> ingest.log 2>&1
```

## Why the app ships a snapshot

The published artifact runs under a content security policy that blocks every outbound
request — fetch, XHR, WebSocket, all of it. So the page cannot call a weather API at
runtime no matter how it is written. The data is baked into a file instead, and the app
says on screen how old that file is.

Outside the artifact sandbox the same client code can call a live endpoint. Replace the
`window.WX_GRID` script tag with a fetch of the same JSON and nothing else changes —
`js/wx.js` is the only module that touches the grid.

## What it pulls today

**Forecast — Open-Meteo multi-model blend.** Free, no key, accepts up to ~120 coordinate
pairs per request. A 1.25° lattice over the lower 48 is 987 points; at 3-hourly over
8 days that is 64 steps per point and lands around 1.5 MB packed.

Each grid node carries its own model elevation, which is what makes the lapse correction
in `wx.js` possible: the forecast is adjusted to the real terrain height of the cell being
scored, so a valley floor and the ridge above it differ even on a 140 km grid.

**Water — USGS NWIS instantaneous values.** Discharge and water temperature from every
active gauge, free, no key, 15–60 minute updates. CONUS is walked in eight tiles because
the bounding box is size-limited. `js/gauges.js` is written but not yet consumed — wiring
it into the trout model replaces the last synthetic field in the Conditions Engine.

## Scaling up

The public Open-Meteo tier is fine for a 1.25° grid on a 6-hour cycle. Finer than about
0.75° (roughly 2,700 points) you want either their commercial tier or your own GRIB
pipeline:

- **NBM** — `s3://noaa-nbm-grib2-pds`, hourly out to ~10 days, the right national
  backbone. No credentials needed.
- **HRRR** — `s3://noaa-hrrr-bdp-pds`, 3 km, 0–48 h. Use it for the near term.
- **GFS** — `s3://noaa-gfs-bdp-pds`, beyond NBM's horizon.

Decode with `wgrib2` or eccodes, resample onto the H3 cells, store in Postgres or
TimescaleDB. At that point scores get precomputed per cycle and the client reads tiles
instead of modelling anything.

## Not yet wired

- **SNODAS** snow depth and water equivalent, 1 km daily, NOHRSC. Better than the
  forecast model's snow field for anything goose-related.
- **Cropland Data Layer** (USDA), **National Wetlands Inventory** (USFWS), **PAD-US**
  public land. Annual downloads, processed once per year, and the biggest single upgrade
  available to the habitat surfaces — they would replace the hand-placed regions in
  `js/env.js` with real polygons.
- **BirdCast** nocturnal migration forecasts and **eBird Status & Trends** abundance.
- **Regulations.** No API exists. Fifty states, annual proclamations, mostly PDFs. This
  is a staffed, human-verified pipeline, and every record needs a source URL and a
  retrieval date before it is allowed to say OPEN.
