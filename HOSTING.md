# Getting OmniGuide out of the sandbox

## Why the artifact cannot fetch anything

Artifacts run in a sandboxed iframe under a strict Content Security Policy. Scripts load
only from a short CDN allowlist; `fetch`, `XMLHttpRequest`, WebSockets, external images
and external stylesheets are all blocked outright, with no visible error.

That is deliberate containment, not a bug. An artifact is generated code running inside a
logged-in session. If it could make arbitrary outbound requests it could exfiltrate
whatever is on the page or pull in code that was never reviewed. Blocking the network
removes that whole class of problem, and the cost is that a page like this one cannot
call a weather API or load map tiles.

Nothing about the app's code requires the sandbox. The restriction travels with the host,
not the HTML.

## GitHub Pages is enough

Yes — a plain static host fixes it, and GitHub Pages is free.

```bash
git init
git add .
git commit -m "OmniGuide"
gh repo create omniguide --private --source=. --push
```

Then Settings → Pages → Source: GitHub Actions. The workflow in
`.github/workflows/refresh-data.yml` runs `ingest/ingest.mjs` every six hours, commits the
refreshed data files and redeploys. No server, no database, no API keys.

Cloudflare Pages, Netlify, Vercel and an S3 bucket all work the same way.

### What unlocks the moment you leave the sandbox

**Live data instead of a snapshot.** Open-Meteo and USGS both send permissive CORS
headers, so the browser can call them directly with no backend at all. The cleanest split
is a baked grid for the national view (one file, fast, already computed) plus a live
point query when a user taps a specific spot. `js/wx.js` is the only module that touches
the forecast, so this is a change in one file.

**Satellite imagery.** An imagery basemap drawn under the hex grid, so people can see the
slough, the treeline and the field edge they are marking. Options:

- **Esri World Imagery** — free for most uses, no key, good US resolution.
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`
- **USDA NAIP** — aerial imagery flown for agriculture, often 60 cm, the best free option
  over US farmland and the most useful layer for waterfowl. Served through USGS and Esri.
- **Mapbox or Maptiler** — paid above a free tier, better styling control, offline packs.

The renderer already works in projected world coordinates, so a tile layer slots in under
`drawHydro` without touching the scoring path.

**Offline maps.** Service worker plus cached tiles. This matters more than it sounds:
the places worth hunting usually have no signal.

## When a static host stops being enough

Move to a backend when you want any of:

- NBM or HRRR GRIB decoding rather than a third-party API
- precomputed national scores for every species and hour, served as vector tiles
- user accounts, real entitlements and payment
- outcome logs pooled across users, which is the entire learning loop

The natural shape is a worker that ingests on the model cycle, writes scores keyed by H3
cell into Postgres, and renders tiles. The client stops modelling anything and just draws.
Everything in `js/models.js`, `js/guide.js` and `js/regs.js` moves server-side essentially
unchanged — they are already pure functions over a conditions object.
