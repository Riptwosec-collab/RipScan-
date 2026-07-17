const VERSION = 'ripscan-pwa-v4.1.0';
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
  '/layout-cover.css',
  '/reference-scale.css',
  '/cover-recovery.css',
  '/performance-v22.css',
  '/document-studio.css',
  '/table-review-v31.css',
  '/book-ocr.css',
  '/table-auto.css',
  '/table-review-v31.css',
  '/document-studio.css',
  '/pdf-tools.css',
  '/app.js',
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
  '/book-ocr-browser-recovery.mjs',
  '/book-ocr-browser-hard-block.mjs',
  '/book-ocr-browser-performance.mjs',
  '/book-ocr-ui.js',
  '/cover-ocr-core.mjs',
  '/cover-ocr-rules.mjs',
  '/cover-recovery-core.mjs',
  '/cover-hard-block.mjs',
  '/cover-ocr-ui.js',
  '/cover-recovery-ui.js',
  '/sara-am-spacing.mjs',
  '/sara-am-recovery-v21.mjs',
  '/ocr-performance-core.mjs',
  '/ocr-preprocess-worker.js',
  '/performance-v22-ui.js',
  '/table-reconstruction-core.mjs',
  '/table-reconstruction-worker.js',
  '/table-review-v31.js',
  '/document-model.mjs',
  '/office-import.mjs',
  '/editor-export.mjs',
  '/document-studio.js',
  '/project-core.mjs',
  '/project-workspace.js',
  '/table-structure-core.mjs',
  '/table-auto-ui.js',
  '/table-reconstruction-core.mjs',
  '/table-reconstruction-worker.js',
  '/table-review-v312.js',
  '/document-model.mjs',
  '/office-import.mjs',
  '/editor-export.mjs',
  '/document-studio.js',
  '/pdf-utility-core.mjs',
  '/pdf-page-organizer.mjs',
  '/pdf-worker.js',
  '/pdf-tool-runtime.mjs',
  '/ripscan-project.mjs',
  '/roundtrip-export.mjs',
  '/pdf-tools-ui.js',
  '/theme-ui.js',
  '/manifest.webmanifest',
  '/icon-192.svg',
  '/icon-512.svg',
  '/fonts/NotoSansThai.ttf',
  '/fonts/OFL-NotoSansThai.txt',
  '/quality-core.mjs',
  '/quality-center.js',
  '/quality-center.css',
];
const OFFLINE_REMOTE = [
  'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-lstm.wasm.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm',
  'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/+esm',
  'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosansthai/NotoSansThai-Regular.ttf',
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
    const request = new Request(url, { mode: 'cors', credentials: 'omit' });
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
    || url.pathname.endsWith('.ttf')
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
