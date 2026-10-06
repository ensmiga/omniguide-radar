# Getting OmniGuide onto GitHub Pages

Twenty minutes, start to finish. Everything the artifact sandbox blocks works after this:
live data, satellite tiles, GPS, and scheduled refreshes.

## What you need once

- A GitHub account
- Git installed (`git --version` to check)
- Node 20+ if you want to run the data pull locally (`node --version`). Not required —
  the scheduled job runs it in the cloud.
- The `gh` CLI is optional but makes step 2 one command instead of six.

## 1. Get the files

Download the project from this conversation into a folder, so it looks like:

```
omniguide/
  index.html
  js/
  ingest/
  .github/workflows/refresh-data.yml
```

## 2. Create the repo

```bash
cd omniguide
git init -b main
git add .
git commit -m "OmniGuide"
```

With the `gh` CLI:

```bash
gh repo create omniguide --private --source=. --push
```

Without it: create an empty repo at github.com/new (no README, no .gitignore), then

```bash
git remote add origin https://github.com/YOUR-NAME/omniguide.git
git push -u origin main
```

**Note the data files are large** — the forecast grid is about 1.5 MB and the whole repo
lands near 5 MB. That is fine for Git, but because the forecast file is rewritten three
times a day, history will grow by roughly 1.5 MB per commit. Revisit this in a few months;
the fix when it matters is to stop committing data and have the workflow publish it as a
build artifact instead.

## 3. Turn on Pages

Repo → **Settings** → **Pages** → under *Build and deployment*, set **Source** to
**GitHub Actions**. Not "Deploy from a branch" — the workflow handles deployment itself.

If the repo is private, Pages requires a paid plan. Make it public, or use Cloudflare
Pages instead (free for private repos, same workflow with a different deploy step).

## 4. Let the workflow write to the repo

Repo → **Settings** → **Actions** → **General** → *Workflow permissions* →
**Read and write permissions**. Without this the scheduled job cannot commit the
refreshed data and the run fails at the push step.

## 5. Run it once by hand

Repo → **Actions** → *Refresh forecast data* → **Run workflow**.

It pulls the forecast and the USGS gauges, sanity-checks the grid size, commits, and
deploys. First run takes a few minutes, mostly waiting out API rate limits. When it
finishes your site is at `https://YOUR-NAME.github.io/omniguide/`.

After that it runs on its own three times a day.

## Why this removes the blocks

Artifacts run under a Content Security Policy that blocks every outbound request and
every external image. That is deliberate — an artifact is generated code running inside
your logged-in session, and cutting the network removes a whole class of risk. The policy
belongs to the host, not to the HTML. On your own domain there is no such policy.

What becomes possible immediately:

| Blocked in the sandbox | Works on Pages |
|---|---|
| Live weather and gauge calls | Open-Meteo and USGS both send permissive CORS headers, so the browser calls them directly. No backend. |
| Satellite and terrain tiles | Any tile host. Esri World Imagery needs no key. |
| GPS | `navigator.geolocation` needs a secure origin and a permissions policy that allows it. Pages is HTTPS, and the page is top-level rather than a locked-down iframe. |
| Scheduled refresh | The workflow in step 5. |
| Offline maps | A service worker, which needs a real origin to register. |

## A caution about scheduled runs

GitHub disables scheduled workflows in repos with no activity for 60 days, and cron
timing is best-effort — runs can be delayed under load. If the refresh genuinely must
happen on time, move it to a small always-on host or a Cloudflare Worker on a cron
trigger. For a three-times-daily forecast refresh, late is not a problem.

Keep the `grep -q 'npts:987'` check in the workflow. A truncated grid does not throw an
error anywhere; it silently misaligns every index the app reads, and the map would look
plausible while being wrong.

## Before anyone else uses it

The season data is the part that can get a person cited. Have a lawyer look at the terms
of service and the disclaimer wording before the site is public. The in-app
acknowledgment and the wording in `js/regs.js` are a careful starting point, not a
reviewed one.
