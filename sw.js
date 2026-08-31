/* Propho — service worker
   Réseau d'abord, cache en secours. Le nom du cache contient le numéro de
   build, donc chaque déploiement crée un cache neuf et efface les anciens.
   __BUILD__ est remplacé au déploiement par le workflow GitHub Actions. */
const BUILD = '__BUILD__';
const CACHE = 'propho-' + BUILD;
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    try {
      const c = await caches.open(CACHE);
      // cache:'reload' oblige à passer outre le cache HTTP du navigateur :
      // sans cela on précharge la version périmée que Safari a gardée.
      await c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    } catch (e) { /* hors ligne à l'installation */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // Le fichier de version doit toujours venir du réseau, sinon
  // l'app ne verrait jamais qu'une mise à jour existe.
  if (url.pathname.endsWith('version.json')) {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }

  // Une navigation doit toujours repartir du réseau réel. Un fetch ordinaire
  // se contente du cache HTTP, qui garde index.html plusieurs minutes : c'est
  // ce qui faisait réapparaître l'ancienne version à chaque relancement.
  const contournerCache = req.mode === 'navigate' || /\.html$|\/$/.test(url.pathname);

  e.respondWith((async () => {
    try {
      const fresh = contournerCache
        ? await fetch(new Request(req.url, { cache: 'reload', credentials: 'same-origin' }))
        : await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const idx = await caches.match('./index.html');
        if (idx) return idx;
      }
      throw err;
    }
  })());
});
