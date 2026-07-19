const sources = Object.freeze({
  tesseract: '/vendor/tesseract.min.js',
  pdfjs: '/vendor/pdf.min.mjs',
  pdfWorker: '/vendor/pdf.worker.min.mjs',
  jszip: '/vendor/jszip.min.js',
});

const pending = new Map();
const LIBRARY_TIMEOUT_MS = 15_000;

function waitForLibrary(promise, key) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`LIBRARY_LOAD_TIMEOUT:${key}`)), LIBRARY_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

function loadScript(key, url, ready) {
  if (ready()) return Promise.resolve(ready());
  if (pending.has(key)) return pending.get(key);
  const promise = waitForLibrary(new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-ripscan-library="${key}"]`);
    const script = existing || document.createElement('script');
    const complete = () => ready() ? resolve(ready()) : reject(new Error(`LIBRARY_NOT_READY:${key}`));
    if (!existing) {
      script.src = url;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.ripscanLibrary = key;
      document.head.append(script);
    }
    script.addEventListener('load', complete, { once: true });
    script.addEventListener('error', () => reject(new Error(`LIBRARY_LOAD_FAILED:${key}`)), { once: true });
    if (existing?.dataset.loaded === 'true') complete();
    script.addEventListener('load', () => { script.dataset.loaded = 'true'; }, { once: true });
  }), key).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

export function loadTesseract() {
  return loadScript('tesseract', sources.tesseract, () => globalThis.Tesseract);
}

export function loadJsZip() {
  return loadScript('jszip', sources.jszip, () => globalThis.JSZip);
}

export async function loadPdfJs() {
  if (pending.has('pdfjs')) return pending.get('pdfjs');
  const promise = waitForLibrary(import(sources.pdfjs).then(module => {
    module.GlobalWorkerOptions.workerSrc = sources.pdfWorker;
    return module;
  }), 'pdfjs').finally(() => pending.delete('pdfjs'));
  pending.set('pdfjs', promise);
  return promise;
}

export function preloadLibrary(name) {
  if (name === 'tesseract') return loadTesseract();
  if (name === 'pdfjs') return loadPdfJs();
  if (name === 'jszip') return loadJsZip();
  return Promise.reject(new Error(`UNKNOWN_LIBRARY:${name}`));
}

export const RipScanLazyLibraries = Object.freeze({ loadTesseract, loadJsZip, loadPdfJs, preloadLibrary });
