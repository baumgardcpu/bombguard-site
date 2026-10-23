const CACHE = 'bombguard-v11';
const ASSETS = ['/', '/theme.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// Only same-origin GETs go through the worker. Cross-origin requests (Google
// Fonts, ipapi.co, Supabase) are left to the browser: re-fetching them from here
// subjects them to the CSP's connect-src, which blocked the font stylesheet.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
