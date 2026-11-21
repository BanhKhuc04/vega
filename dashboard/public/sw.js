// VEGA service worker (M8, brief 0013 B13): only the page's shell is cached, so the app opens offline and shows OFFLINE.
// Data never is: /api, /voice, /vision, /mqtt and /config.js (it carries passwords that may change) always go to the network.
const CACHE = 'vega-shell-v1';
const SHELL = ['/', '/console', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
const NEVER = /^\/(api|voice|vision|mqtt)(\/|$)|^\/config\.js$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || NEVER.test(url.pathname)) return;
  // pages: the network first (a new version shows at once), the cached shell when offline
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          if (r.ok) caches.open(CACHE).then((c) => c.put(url.pathname === '/console' || url.pathname === '/console.html' ? '/console' : '/', copy));
          return r;
        })
        .catch(() => caches.match(url.pathname.startsWith('/console') ? '/console' : '/').then((r) => r || Response.error())),
    );
    return;
  }
  // hashed build files never change: the cache first
  if (url.pathname.startsWith('/assets/') || /\.(png|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((r) => {
            if (r.ok) {
              const copy = r.clone();
              caches.open(CACHE).then((c) => c.put(e.request, copy));
            }
            return r;
          }),
      ),
    );
  }
});
