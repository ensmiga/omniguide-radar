/* Stamp a cache-busting version onto every local script and stylesheet
   in index.html.

   WHY THIS EXISTS.

   GitHub Pages serves js/*.js with a long cache lifetime and no
   fingerprint in the filename, so a browser that has visited before
   keeps running whatever it downloaded last time. Pushing a fix and
   seeing the old behaviour is indistinguishable from the fix not
   working, and that cost real debugging time: the duck water layer kept
   drawing coarse blocks and the movement streamlines never appeared,
   both of which were fixed code being served from cache.

   Run after changing anything under js/, before committing:

       node tools/stamp.mjs

   It rewrites src="js/foo.js" to src="js/foo.js?v=<stamp>" where the
   stamp is the newest modification time across js/, so an unchanged
   tree produces an unchanged file and this is safe to run repeatedly. */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

function newestMtime(dir) {
  let newest = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) newest = Math.max(newest, newestMtime(p));
    else newest = Math.max(newest, st.mtimeMs);
  }
  return newest;
}

const stamp = Math.floor(newestMtime(join(ROOT, 'js')) / 1000).toString(36);

const file = join(ROOT, 'index.html');
let html = readFileSync(file, 'utf8');

/* Strip any existing stamp, then apply the current one. Local paths
   only - a CDN or tile URL must not be touched. */
let count = 0;
html = html.replace(/(src|href)="((?:js|css)\/[^"?]+)(\?v=[^"]*)?"/g, (m, attr, path) => {
  count++;
  return attr + '="' + path + '?v=' + stamp + '"';
});

writeFileSync(file, html);
process.stdout.write('stamped ' + count + ' local assets with v=' + stamp + '\n');
