import {
  compressionReport,
  normalizeCompressionOptions,
  outputPageFilename,
  splitFilename,
  validatePdfBytes,
} from './pdf-utility-core.mjs';

export const PDF_RUNTIME_VERSION = '4.0.1';
const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

let pdfJsPromise = null;
let sequence = 0;

function idleYield(timeout = 300) {
  return new Promise(resolve => {
    if ('requestIdleCallback' in globalThis) requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, 16);
  });
}

async function ensurePdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import(PDFJS_URL).then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return pdfjs;
    });
  }
  return pdfJsPromise;
}

function abortError() {
  return new DOMException('ผู้ใช้ยกเลิก', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

export class PdfWorkerClient {
  constructor({ onProgress = () => {}, timeoutMs = 120_000 } = {}) {
    this.worker = new Worker('/pdf-worker.js', { type: 'module' });
    this.pending = new Map();
    this.onProgress = onProgress;
    this.timeoutMs = timeoutMs;
    this.disposed = false;
    this.worker.addEventListener('message', event => this.handleMessage(event.data || {}));
    this.worker.addEventListener('error', event => this.rejectAll(new Error(event.message || 'PDF_WORKER_CRASHED')));
  }

  handleMessage(message) {
    const entry = this.pending.get(message.jobId);
    if (!entry) return;
    if (message.type === 'progress') {
      this.onProgress(message);
      entry.onProgress?.(message);
      return;
    }
    if (message.type !== 'result') return;
    this.pending.delete(message.jobId);
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.abort);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error || 'PDF_WORKER_FAILED'));
  }

  run(type, payload, { signal, onProgress, transfer = [] } = {}) {
    if (this.disposed) return Promise.reject(new Error('PDF_WORKER_DISPOSED'));
    throwIfAborted(signal);
    const jobId = `pdf-v4-${Date.now()}-${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(jobId);
        this.worker.postMessage({ type: 'cancel', jobId });
        reject(new Error('PDF_WORKER_TIMEOUT'));
      }, this.timeoutMs);
      const abort = () => {
        this.pending.delete(jobId);
        clearTimeout(timer);
        this.worker.postMessage({ type: 'cancel', jobId });
        reject(abortError());
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(jobId, { resolve, reject, timer, signal, abort, onProgress });
      this.worker.postMessage({ type, jobId, payload }, transfer);
    });
  }

  rejectAll(error) {
    for (const [jobId, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.signal?.removeEventListener('abort', entry.abort);
      entry.reject(error);
      this.pending.delete(jobId);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.postMessage({ type: 'dispose' });
    this.worker.terminate();
    this.rejectAll(new Error('PDF_WORKER_DISPOSED'));
  }
}

export async function inspectPdfFile(file, options = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validatePdfBytes(bytes, options);
  if (!validation.valid) throw new Error(validation.errors[0]);
  const worker = options.worker || new PdfWorkerClient({ onProgress: options.onProgress });
  try {
    return await worker.run('inspect', { bytes }, { signal: options.signal, transfer: [bytes.buffer] });
  } finally {
    if (!options.worker) worker.dispose();
  }
}

async function imageBlobFromCanvas(canvas, format, quality) {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: format, quality });
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('IMAGE_EXPORT_FAILED')), format, quality));
}

async function createRenderCanvas(width, height, alpha = false) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha });
  if (!context) throw new Error('CANVAS_NOT_AVAILABLE');
  return canvas;
}

function releaseCanvas(canvas) {
  try { canvas.width = 1; canvas.height = 1; } catch {}
}

export async function renderPdfPages(fileOrBytes, options = {}) {
  const pdfjs = await ensurePdfJs();
  const bytes = fileOrBytes instanceof Uint8Array
    ? fileOrBytes
    : fileOrBytes instanceof ArrayBuffer
      ? new Uint8Array(fileOrBytes)
      : new Uint8Array(await fileOrBytes.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes, password: options.password || undefined });
  const pdf = await loadingTask.promise;
  const selected = Array.isArray(options.selectedPages) && options.selectedPages.length
    ? options.selectedPages.map(Number)
    : Array.from({ length: pdf.numPages }, (_, index) => index);
  const format = options.format === 'jpg' || options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const quality = Math.max(.1, Math.min(1, Number(options.quality) || .92));
  const dpi = Math.max(72, Math.min(600, Number(options.dpi) || 150));
  const scaleOption = Math.max(.1, Math.min(8, Number(options.scale) || 1));
  const output = [];
  try {
    for (let position = 0; position < selected.length; position += 1) {
      throwIfAborted(options.signal);
      const pageIndex = selected[position];
      const page = await pdf.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      let scale = dpi / 72 * scaleOption;
      if (options.width || options.height) {
        const widthScale = Number(options.width) > 0 ? Number(options.width) / base.width : Infinity;
        const heightScale = Number(options.height) > 0 ? Number(options.height) / base.height : Infinity;
        scale = options.keepAspect === false ? Math.min(widthScale, heightScale) : Math.min(widthScale, heightScale);
        if (!Number.isFinite(scale)) scale = dpi / 72 * scaleOption;
      }
      const maxPixels = Math.max(1_000_000, Number(options.maxPixels) || 28_000_000);
      let viewport = page.getViewport({ scale });
      if (viewport.width * viewport.height > maxPixels) {
        const correction = Math.sqrt(maxPixels / (viewport.width * viewport.height));
        viewport = page.getViewport({ scale: scale * correction });
      }
      const canvas = await createRenderCanvas(Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height)), format === 'image/png' && options.transparent);
      const context = canvas.getContext('2d', { alpha: format === 'image/png' && options.transparent });
      if (!options.transparent) {
        context.fillStyle = options.background || '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (options.grayscale) context.filter = 'grayscale(1)';
      const renderTask = page.render({ canvasContext: context, viewport, background: options.transparent ? undefined : options.background || '#ffffff' });
      const abort = () => renderTask.cancel();
      options.signal?.addEventListener('abort', abort, { once: true });
      try { await renderTask.promise; }
      finally { options.signal?.removeEventListener('abort', abort); }
      const blob = await imageBlobFromCanvas(canvas, format, quality);
      output.push({ pageIndex, blob, width: canvas.width, height: canvas.height, format, grayscale: Boolean(options.grayscale) });
      releaseCanvas(canvas);
      page.cleanup();
      options.onProgress?.({ completed: position + 1, total: selected.length, label: `แปลงหน้า ${position + 1}/${selected.length}`, pageIndex });
      await idleYield();
    }
  } finally {
    await pdf.destroy();
  }
  return output;
}

async function blobToJpegOrPng(file, options = {}) {
  const mime = file.type === 'image/png' || file.type === 'image/jpeg' ? file.type : 'image/png';
  if (file.type === mime) return { bytes: new Uint8Array(await file.arrayBuffer()), mime, name: file.name, rotation: Number(options.rotation) || 0 };
  const bitmap = await createImageBitmap(file);
  const canvas = await createRenderCanvas(bitmap.width, bitmap.height, true);
  const context = canvas.getContext('2d', { alpha: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await imageBlobFromCanvas(canvas, mime, Number(options.quality) || .92);
  releaseCanvas(canvas);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, name: file.name, rotation: Number(options.rotation) || 0 };
}

export async function compressPdf(file, options = {}) {
  const normalized = normalizeCompressionOptions(options);
  const originalBytes = new Uint8Array(await file.arrayBuffer());
  const validation = validatePdfBytes(originalBytes, options);
  if (!validation.valid) throw new Error(validation.errors[0]);
  const worker = new PdfWorkerClient({ onProgress: options.onProgress, timeoutMs: 180_000 });
  try {
    if (normalized.preserveTextLayer) {
      const result = await worker.run('compress-preserve', { bytes: originalBytes, options: normalized }, { signal: options.signal, transfer: [originalBytes.buffer] });
      const blob = new Blob([result.bytes], { type: 'application/pdf' });
      return { blob, report: compressionReport(file.size, blob.size, result.pageCount), preserveTextLayer: true };
    }
    const rendered = await renderPdfPages(originalBytes, {
      format: 'jpg',
      dpi: normalized.dpi,
      quality: normalized.quality,
      grayscale: normalized.grayscale,
      signal: options.signal,
      onProgress: message => options.onProgress?.({ ...message, label: `บีบอัด ${message.label}` }),
      maxPixels: options.maxPixels || 18_000_000,
    });
    const images = [];
    for (const page of rendered) images.push({ bytes: new Uint8Array(await page.blob.arrayBuffer()), mime: 'image/jpeg', rotation: 0 });
    const transfer = images.map(image => image.bytes.buffer);
    const result = await worker.run('images-to-pdf', { images, options: { pageSize: 'fit-image', margin: 0, fit: 'contain', autoOrientation: true } }, { signal: options.signal, transfer });
    const blob = new Blob([result.bytes], { type: 'application/pdf' });
    return { blob, report: compressionReport(file.size, blob.size, result.pageCount), preserveTextLayer: false };
  } finally {
    worker.dispose();
  }
}

export async function mergePdfSources(sources, organizerItems, options = {}) {
  const worker = new PdfWorkerClient({ onProgress: options.onProgress, timeoutMs: 180_000 });
  try {
    const payloadSources = [];
    const transfer = [];
    for (let index = 0; index < sources.length; index += 1) {
      throwIfAborted(options.signal);
      const source = sources[index];
      if (source.type === 'application/pdf' || /\.pdf$/iu.test(source.name)) {
        const bytes = new Uint8Array(await source.arrayBuffer());
        payloadSources.push({ kind: 'pdf', bytes, name: source.name, mime: source.type });
        transfer.push(bytes.buffer);
      } else {
        const image = await blobToJpegOrPng(source, options);
        payloadSources.push({ kind: 'image', ...image });
        transfer.push(image.bytes.buffer);
      }
    }
    const result = await worker.run('merge', { sources: payloadSources, items: organizerItems }, { signal: options.signal, transfer });
    return new Blob([result.bytes], { type: 'application/pdf' });
  } finally {
    worker.dispose();
  }
}

export async function splitPdf(file, groups, options = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const worker = new PdfWorkerClient({ onProgress: options.onProgress, timeoutMs: 180_000 });
  try {
    const result = await worker.run('split', { bytes, groups }, { signal: options.signal, transfer: [bytes.buffer] });
    return result.outputs.map(output => ({ pages: output.pages, blob: new Blob([output.bytes], { type: 'application/pdf' }), filename: splitFilename(file.name, output.pages) }));
  } finally {
    worker.dispose();
  }
}

export async function imageFilesToPdf(files, options = {}) {
  const images = [];
  const transfer = [];
  for (let index = 0; index < files.length; index += 1) {
    throwIfAborted(options.signal);
    const image = await blobToJpegOrPng(files[index], options.items?.[index] || options);
    images.push(image);
    transfer.push(image.bytes.buffer);
    options.onProgress?.({ completed: index, total: files.length, label: `เตรียมรูป ${index + 1}/${files.length}` });
  }
  const worker = new PdfWorkerClient({ onProgress: options.onProgress, timeoutMs: 180_000 });
  try {
    const result = await worker.run('images-to-pdf', { images, options }, { signal: options.signal, transfer });
    return new Blob([result.bytes], { type: 'application/pdf' });
  } finally {
    worker.dispose();
  }
}

export async function exportEditablePdf(documentModel, originalFile, options = {}) {
  const originalBytes = originalFile ? new Uint8Array(await originalFile.arrayBuffer()) : null;
  const worker = new PdfWorkerClient({ onProgress: options.onProgress, timeoutMs: 240_000 });
  try {
    const payload = { model: documentModel, originalBytes };
    const transfer = originalBytes ? [originalBytes.buffer] : [];
    const result = await worker.run('overlay-model', payload, { signal: options.signal, transfer });
    return { blob: new Blob([result.bytes], { type: 'application/pdf' }), thaiFontEmbedded: result.thaiFontEmbedded, pageCount: result.pageCount };
  } finally {
    worker.dispose();
  }
}

export async function packageImageResults(rendered, baseName, extension, zipFactory) {
  if (rendered.length === 1) return { blob: rendered[0].blob, filename: outputPageFilename(baseName, rendered[0].pageIndex, extension, 1) };
  const Zip = zipFactory || globalThis.JSZip;
  if (!Zip) throw new Error('ZIP_NOT_AVAILABLE');
  const zip = new Zip();
  rendered.forEach(item => zip.file(outputPageFilename(baseName, item.pageIndex, extension, rendered.length), item.blob));
  return { blob: await zip.generateAsync({ type: 'blob' }), filename: `${String(baseName || 'document').replace(/\.[^.]+$/u, '')}-${extension}-pages.zip` };
}
