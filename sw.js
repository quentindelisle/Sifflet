const CACHE_NAME = 'sifflet-v1';
const ASSETS = [
  './', './index.html', './manifest.json', './sw.js', './icon-square.png', './icon-192.png', './icon-512.png',
  './bande-son-sifflet.mp3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  // Pas de skipWaiting() automatique : la page affiche un bandeau "nouvelle version disponible"
  // plutôt que de changer de version en pleine séance (voir message SKIP_WAITING ci-dessous).
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// "Réseau d'abord" pour la page et le manifeste (mises à jour récupérées dès qu'il y a du réseau),
// repli sur le cache hors-ligne (gymnase sans wifi). Le reste est "cache d'abord".
const NETWORK_FIRST_PATHS = ['/index.html', '/manifest.json', '/'];

function isNetworkFirst(url) {
  return NETWORK_FIRST_PATHS.some((p) => url.pathname === p || url.pathname.endsWith(p));
}

// Les navigateurs (Safari surtout) lisent l'audio par morceaux avec un en-tête "Range" :
// on découpe la réponse en cache pour renvoyer un 206, sinon la bande son ne se lit pas hors-ligne.
async function rangeResponse(request, cachedResponse) {
  const range = request.headers.get('range');
  const buf = await cachedResponse.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range || '');
  if (!m) return new Response(buf, { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(buf.byteLength), 'Accept-Ranges': 'bytes' } });
  let start = m[1] === '' ? 0 : Number(m[1]);
  let end = m[2] === '' ? buf.byteLength - 1 : Math.min(Number(m[2]), buf.byteLength - 1);
  if (m[1] === '' && m[2] !== '') { start = Math.max(0, buf.byteLength - Number(m[2])); end = buf.byteLength - 1; }
  const slice = buf.slice(start, end + 1);
  return new Response(slice, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(slice.byteLength),
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Accept-Ranges': 'bytes'
    }
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('.mp3')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(url.pathname.endsWith('bande-son-sifflet.mp3') ? './bande-son-sifflet.mp3' : event.request, { ignoreSearch: true });
        if (cached) return rangeResponse(event.request, cached);
        return fetch(event.request);
      })
    );
    return;
  }

  if (event.request.mode === 'navigate' || isNetworkFirst(url)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
