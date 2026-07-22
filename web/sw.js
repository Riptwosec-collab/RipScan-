const VERSION = 'ripscan-pwa-v2.3.0';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/upgrade.css',
  '/advanced.css',
  '/verified.css',
  '/redesign.css',
  '/compact-home.css',
  '/book-ocr.css',
  '/table-auto.css',
  '/app.js',
  '/ocr-runtime-guard.js',
  '/upgrade.js',
  '/advanced.js',
  '/ocr-core.mjs',
  '/verified.js',
  '/verified-ui-fix.js',
  '/heading-auto.js',
  '/heading-structure.mjs',
  '/book-ocr-core.mjs',
  '/book-ocr-rules.mjs',
  '/book-ocr-browser.mjs',
  '/book-ocr-ui.js',
  '/table-structure-core.mjs',
  '/table-auto-ui.js',
  '/theme-ui.js',
  '/manifest.webmanifest',
  '/icon-192.svg',
  '/icon-512.svg',
];
const OFFLINE_REMOTE = [
  '/vendor/tesseract.min.js',
  '/vendor/worker.min.js',
  '/vendor/tessdata/tha.traineddata.gz',
  '/vendor/tessdata/eng.traineddata.gz',
  '/vendor/jszip.min.js',
  '/vendor/pdf.min.mjs',
  '/vendor/pdf.worker.min.mjs',
  '/vendor/xlsx.full.min.js',
  '/vendor/html2canvas.min.js',
  '/vendor/jspdf.umd.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('ripscan-pwa-') && ![SHELL_CACHE, RUNTIME_CACHE].includes(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function cacheRemote(urls) {
  const cache = await caches.open(RUNTIME_CACHE);
  await Promise.allSettled(urls.map(async url => {
    const request = new Request(new URL(url, self.location.origin), { credentials: 'same-origin' });
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
  }));
}

self.addEventListener('message', event => {
  if (event.data?.type === 'CACHE_SHELL') event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(APP_SHELL)));
  if (event.data?.type === 'CACHE_OFFLINE_PACK') event.waitUntil(cacheRemote(OFFLINE_REMOTE));
});

function shouldRuntimeCache(url) {
  return url.hostname.endsWith('jsdelivr.net')
    || url.hostname.includes('tessdata')
    || url.pathname.endsWith('.traineddata.gz')
    || url.pathname.endsWith('.wasm')
    || url.pathname.endsWith('.wasm.js')
    || url.pathname.endsWith('/worker.min.js');
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put('/index.html', response.clone());
    return response;
  } catch {
    return await cache.match('/index.html') || await cache.match('/');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(request.url.startsWith(self.location.origin) ? SHELL_CACHE : RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await network || new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (url.origin === self.location.origin || shouldRuntimeCache(url)) event.respondWith(staleWhileRevalidate(request));
});
