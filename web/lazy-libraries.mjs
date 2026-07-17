const sources = Object.freeze({
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js',
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs',
  pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
  jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
});

const pending = new Map();

function loadScript(key, url, ready) {
  if (ready()) return Promise.resolve(ready());
  if (pending.has(key)) return pending.get(key);
  const promise = new Promise((resolve, reject) => {
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
  }).finally(() => pending.delete(key));
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
  const promise = import(sources.pdfjs).then(module => {
    module.GlobalWorkerOptions.workerSrc = sources.pdfWorker;
    return module;
  }).finally(() => pending.delete('pdfjs'));
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
