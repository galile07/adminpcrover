const VERSION = 'pcrover-offline-v1';
const NAV_CACHE = VERSION + '-nav';
const STATIC_CACHE = VERSION + '-static';

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function (cache) {
        return cache.addAll([
          'index.html',
          'dashboard.html',
          'pos.html',
          'orders.html',
          'inventory.html',
          'automation.html',
          'sync.html',
          'lazada-callback.html'
        ]);
      })
      .catch(function () {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k !== STATIC_CACHE && k !== NAV_CACHE; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (url.hostname.indexOf('supabase.co') !== -1) {
    // Supabase API/functions/storage: network-first, fall back to cache when offline.
    event.respondWith(
      fetch(req).then(function (res) {
        if (res.ok && url.pathname.indexOf('/storage/v1/object') !== -1) {
          var copy = res.clone();
          caches.open(STATIC_CACHE).then(function (c) { return c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(NAV_CACHE).then(function (c) { return c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (m) { return m || caches.match('index.html'); });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(STATIC_CACHE).then(function (c) { return c.put(req, copy); });
        }
        return res;
      });
      return hit || network;
    })
  );
});