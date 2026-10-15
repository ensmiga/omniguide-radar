/* OmniGuide - service worker: installable, and usable with no signal.

   A hunter opens this at the trailhead, often with one bar or none, so
   the app has to start from what it already has.

   WHAT IS KEPT, AND HOW.

   The page itself is asked for from the network first, with a few
   seconds' grace, and falls back to the copy kept from the last visit.

   Scripts and data under js/ carry the version stamp from
   tools/stamp.mjs, so a URL never changes meaning: they are served from
   the cache, and a new release simply asks for new URLs. Copies from
   older releases are cleared out whenever a new page arrives.

   Three files are the exception: wx-grid.js, gauges.js and snow.js are
   rewritten every two hours by the data refresh (tools/ci-commit-data.sh)
   under the same stamped URL. Those are asked for from the network first
   and fall back to the last copy - the app then says how old the
   forecast is.

   Base map and elevation tiles, and the web fonts, are kept as they are
   used, up to a few hundred tiles, so ground already looked at still has
   a map under it offline. Opaque responses are never kept - each would
   cost megabytes of the storage allowance.

   Install keeps the files the page has just loaded, asking for them
   again - which the browser normally answers from its own cache rather
   than the network, so the first visit does not download them twice. */
'use strict';

var SHELL = 'og-shell-v1', ASSETS = 'og-assets-v1', TILES = 'og-tiles-v1';
var LIVE = /\/js\/(wx-grid|gauges|snow)\.js$/;
var TILE_HOST = /(^|\.)nationalmap\.gov$|(^|\.)amazonaws\.com$|^fonts\.(googleapis|gstatic)\.com$/;
var TILE_MAX = 600;
var PAGE_WAIT_MS = 3500, LIVE_WAIT_MS = 6000;

var scope = self.registration.scope;
var PAGE = new URL('./', scope).href;

/* Local scripts and stylesheets the page loads, as absolute URLs. */
function assetsIn(html) {
  var out = [], re = /(?:src|href)="((?:js|css)\/[^"]+)"/g, m;
  while ((m = re.exec(html))) out.push(new URL(m[1], scope).href);
  return out;
}

/* Drop copies of these files from older releases. */
function prune(html) {
  var keep = {}, paths = {};
  assetsIn(html).forEach(function (u) { keep[u] = 1; paths[new URL(u).pathname] = 1; });
  return caches.open(ASSETS).then(function (c) {
    return c.keys().then(function (reqs) {
      return Promise.all(reqs.map(function (r) {
        var u = new URL(r.url);
        if (paths[u.pathname] && !keep[r.url] && !LIVE.test(u.pathname)) return c.delete(r);
      }));
    });
  });
}

self.addEventListener('install', function (e) {
  e.waitUntil(fetch(PAGE).then(function (res) {
    if (!res.ok) return;
    var copy = res.clone();
    return res.text().then(function (html) {
      return caches.open(SHELL).then(function (c) { return c.put(PAGE, copy); }).then(function () {
        return caches.open(ASSETS);
      }).then(function (c) {
        /* Each on its own, so one failure does not lose the rest. */
        return Promise.all(assetsIn(html).map(function (u) { return c.add(u).catch(function () {}); }));
      });
    });
  }).catch(function () {}).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.map(function (n) {
      if (n !== SHELL && n !== ASSETS && n !== TILES) return caches.delete(n);
    }));
  }).then(function () { return self.clients.claim(); }));
});

function timeout(ms) { return new Promise(function (_, no) { setTimeout(no, ms); }); }

/* Network first, the kept copy if the network fails or is too slow. */
function networkFirst(req, cacheName, wait, key, onFresh) {
  var net = fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(cacheName).then(function (c) {
        if (LIVE.test(new URL(req.url).pathname)) {
          /* One copy of each live file, whatever its stamp. */
          return c.keys().then(function (reqs) {
            return Promise.all(reqs.filter(function (r) {
              return new URL(r.url).pathname === new URL(req.url).pathname;
            }).map(function (r) { return c.delete(r); }));
          }).then(function () { return c.put(req, copy); });
        }
        return c.put(key || req, copy);
      });
      if (onFresh) onFresh(res.clone());
    }
    return res;
  });
  net.catch(function () {});           // a late failure after the kept copy was served is not an error
  return Promise.race([net, timeout(wait)]).catch(function () {
    return caches.match(key || req, { ignoreSearch: !!LIVE.test(new URL(req.url).pathname) || !!key })
      .then(function (hit) { return hit || net; });
  });
}

/* The cache, else the network - and keep what comes back. */
function cacheFirst(req, cacheName, cap) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      if (res && res.ok && res.type !== 'opaque') {
        var copy = res.clone();
        caches.open(cacheName).then(function (c) {
          return c.put(req, copy).then(function () {
            if (!cap) return;
            return c.keys().then(function (reqs) {
              for (var i = 0; i < reqs.length - cap; i++) c.delete(reqs[i]);
            });
          });
        });
      }
      return res;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, SHELL, PAGE_WAIT_MS, PAGE, function (res) {
      res.text().then(prune).catch(function () {});
    }));
    return;
  }
  if (url.origin === self.location.origin) {
    if (LIVE.test(url.pathname)) { e.respondWith(networkFirst(req, ASSETS, LIVE_WAIT_MS)); return; }
    if (/\/(js|css|icons)\//.test(url.pathname) || /manifest\.webmanifest$/.test(url.pathname)) {
      e.respondWith(cacheFirst(req, ASSETS));
    }
    return;
  }
  if (TILE_HOST.test(url.hostname) && !/\/tilemap\//.test(url.pathname) && !/GetFeatureInfo/i.test(url.search)) {
    e.respondWith(cacheFirst(req, TILES, TILE_MAX));
  }
});
