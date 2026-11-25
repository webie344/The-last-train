// Service worker: caches the game shell, model and three.js so it installs and plays offline after the first online load.
const VER = 'lasttrain-v0.2.0';
const CORE = ['./', './index.html', './style.css', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './assets/UAL1_Standard.glb',
  './src/main.js', './src/config.js', './src/util.js', './src/textures.js', './src/nav.js', './src/audio.js', './src/ui.js', './src/input.js', './src/rig.js', './src/world.js',
  './src/player.js', './src/creature.js', './src/director.js', './src/companion.js', './src/interact.js', './src/chapter1.js', './src/fx.js'];
const CDN = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VER).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== VER).map((n) => caches.delete(n)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.pathname.startsWith('/api/')) return;           // the Director always goes to the network (it has its own local fallback)
  const cdn = CDN.includes(u.hostname);
  if (u.origin !== location.origin && !cdn) return;
  if (r.mode === 'navigate') { e.respondWith(fetch(r).then((res) => { const cp = res.clone(); caches.open(VER).then((c) => c.put('./index.html', cp)); return res; }).catch(() => caches.match('./index.html'))); return; }
  // stale-while-revalidate for own files, cache-first for CDN (versioned URLs)
  e.respondWith(caches.match(r).then((hit) => {
    const net = fetch(r).then((res) => { if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(VER).then((c) => c.put(r, cp)); } return res; }).catch(() => hit);
    return hit && cdn ? hit : (hit || net);
  }));
});
