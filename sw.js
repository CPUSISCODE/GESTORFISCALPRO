const CACHE_NAME = 'gestorfiscal-v2';
// Precache apenas arquivos do próprio site. As dependências de CDN são cacheadas
// em tempo de execução pelo handler de fetch (addAll falha se qualquer URL externa recusar).
const CORE_ASSETS = [
  'index.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro; se falhar (offline), cai para o cache.
self.addEventListener('fetch', (event) => {
  // Nunca cacheia chamadas ao Supabase (auth/banco/edge functions) nem métodos != GET.
  if (event.request.method !== 'GET' || event.request.url.includes('supabase.co')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
