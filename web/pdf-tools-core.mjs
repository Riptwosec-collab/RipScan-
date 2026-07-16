import { loadExternalScript, safeFilename } from './editor-export.mjs';
import { parsePageSelection, splitGroupsByMode } from './pdf-page-organizer.mjs';

export const PDF_TOOLS_VERSION = '3.2.0';
export const PDF_LIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
export const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
export const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

export const PDF_TOOL_LIMITS = Object.freeze({
  maxFileBytes: 500 * 1024 * 1024,
  maxPages: 1000,
  maxRenderPixels: 42_000_000,
  desktopConcurrency: 2,
  mobileConcurrency: 1,
});

let pdfjsPromise = null;
let sequence = 0;

function nextJobId(prefix = 'pdf-tool') {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export function compressionSummary(originalBytes, outputBytes) {
  const original = Math.max(0, Number(originalBytes) || 0);
  const output = Math.max(0, Number(outputBytes) || 0);
  const reducedBytes = Math.max(0, original - output);
  const reducedPercent = original ? reducedBytes / original * 100 : 0;
  return {
    originalBytes: original,
    outputBytes: output,
    reducedBytes,
    reducedPercent,
    grew: output > original,
    originalLabel: formatBytes(original),
    outputLabel: formatBytes(output),
    reducedLabel: formatBytes(reducedBytes),
  };
}

export function normalizeCompressionOptions(options = {}) {
  const level = options.level || 'standard';
  const presets = {
    low: { quality: .92, dpi: 220, downscale: true },
    standard: { quality: .82, dpi: 160, downscale: true },
    high: { quality: .62, dpi: 110, downscale: true },
  };
  const preset = presets[level] || presets.standard;
  return {
    level,
    mode: options.mode || 'preserve',
    quality: clamp(options.quality ?? preset.quality, .1, 1),
    dpi: clamp(options.dpi ?? preset.dpi, 72, 600),
    downscale: options.downscale ?? preset.downscale,
    removeMetadata: options.removeMetadata !== false,
    recompressJpeg: options.recompressJpeg !== false,
    convertBitmapToJpeg: options.convertBitmapToJpeg !== false,
    grayscale: Boolean(options.grayscale),
    flattenAnnotations: Boolean(options.flattenAnnotations),
    preserveTextLayer: options.preserveTextLayer !== false,
    preserveLinks: options.preserveLinks !== false,
    preservePageSize: options.preservePageSize !== false,
    preserveBookmarks: options.preserveBookmarks !== false,
  };
}

export function assertNotCancelled(signal) {
  if (signal?.aborted) throw new DOMException('ผู้ใช้ยกเลิก', 'AbortError');
}

export async function readFileHeader(file, length = 16) {
  const blob = file.slice(0, Math.max(1, length));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function validatePdfFile(file, options = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('ไม่พบไฟล์ PDF');
  const maxBytes = Number(options.maxBytes) || PDF_TOOL_LIMITS.maxFileBytes;
  if (file.size > maxBytes) throw new Error(`ไฟล์ใหญ่เกินกำหนด ${formatBytes(maxBytes)}`);
  const header = await readFileHeader(file, 8);
  const signature = new TextDecoder('ascii').decode(header);
  if (!signature.startsWith('%PDF-')) throw new Error('ไฟล์นี้ไม่มี PDF Header ที่ถูกต้อง');
  return { valid: true, signature: signature.slice(0, 8), size: file.size, mime: file.type || 'application/pdf' };
}

export async function validateImageFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('ไม่พบไฟล์รูปภาพ');
  const header = await readFileHeader(file, 16);
  const ascii = new TextDecoder('ascii').decode(header);
  const png = header[0] === 0x89 && ascii.slice(1, 4) === 'PNG';
  const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const webp = ascii.slice(0, 4) === 'RIFF' && ascii.slice(8, 12) === 'WEBP';
  const bmp = ascii.slice(0, 2) === 'BM';
  const tiff = (ascii.slice(0, 4) === 'II*\u0000') || (ascii.slice(0, 4) === 'MM\u0000*');
  if (!(png || jpeg || webp || bmp || tiff || file.type.startsWith('image/'))) throw new Error('รูปภาพมี File Signature ที่ไม่รองรับ');
  return { valid: true, format: png ? 'png' : jpeg ? 'jpg' : webp ? 'webp' : bmp ? 'bmp' : tiff ? 'tiff' : file.type.split('/')[1] || 'image' };
}

export async function ensurePdfLib() {
  if (!globalThis.PDFLib?.PDFDocument) await loadExternalScript(PDF_LIB_URL, 'PDFLib');
  if (!globalThis.PDFLib?.PDFDocument) throw new Error('โหลด pdf-lib ไม่สำเร็จ');
  return globalThis.PDFLib;
}

export async function ensurePdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_URL).then(module => {
      module.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return module;
    });
  }
  return pdfjsPromise;
}

async function ensureJsZip() {
  if (!globalThis.JSZip) await loadExternalScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'JSZip');
  if (!globalThis.JSZip) throw new Error('โหลดระบบ ZIP ไม่สำเร็จ');
  return globalThis.JSZip;
}

export class PdfToolWorkerClient {
  constructor(url = '/pdf-tools-worker.js') {
    this.worker = new Worker(url);
    this.pending = new Map();
    this.worker.addEventListener('message', event => {
      const message = event.data || {};
      const entry = this.pending.get(message.jobId);
      if (!entry) return;
      this.pending.delete(message.jobId);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(message.error || 'PDF_TOOL_WORKER_FAILED'));
    });
  }

  run(type, payload, options = {}) {
    const jobId = nextJobId('pdf-worker');
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 45_000);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(jobId);
        this.worker.postMessage({ type: 'cancel', jobId });
        reject(new Error('งานประมวลผลรูปใช้เวลานานเกินไป'));
      }, timeoutMs);
      const abort = () => {
        clearTimeout(timer);
        this.pending.delete(jobId);
        this.worker.postMessage({ type: 'cancel', jobId });
        reject(new DOMException('ผู้ใช้ยกเลิก', 'AbortError'));
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(jobId, {
        resolve: value => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); resolve(value); },
        reject: error => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); reject(error); },
      });
      this.worker.postMessage({ type, jobId, payload });
    });
  }

  dispose() {
    this.worker.postMessage({ type: 'dispose' });
    this.worker.terminate();
    for (const entry of this.pending.values()) entry.reject(new Error('PDF_TOOL_WORKER_DISPOSED'));
    this.pending.clear();
  }
}

export class PdfTaskQueue extends EventTarget {
  constructor({ concurrency } = {}) {
    super();
    const mobile = typeof matchMedia === 'function' && (matchMedia('(pointer: coarse)').matches || innerWidth <= 720);
    this.concurrency = Math.max(1, Math.min(2, Number(concurrency) || (mobile ? PDF_TOOL_LIMITS.mobileConcurrency : PDF_TOOL_LIMITS.desktopConcurrency)));
    this.queue = [];
    this.running = 0;
    this.cancelled = false;
  }

  add(task, metadata = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, metadata, resolve, reject });
      this.dispatchEvent(new CustomEvent('queued', { detail: { queued: this.queue.length, running: this.running, metadata } }));
      this.drain();
    });
  }

  async drain() {
    while (!this.cancelled && this.running < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      this.running += 1;
      this.dispatchEvent(new CustomEvent('start', { detail: { queued: this.queue.length, running: this.running, metadata: job.metadata } }));
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
        this.running -= 1;
        this.dispatchEvent(new CustomEvent('settled', { detail: { queued: this.queue.length, running: this.running, metadata: job.metadata } }));
        this.drain();
      });
    }
  }

  cancel(reason = 'ผู้ใช้ยกเลิก') {
    this.cancelled = true;
    const error = new DOMException(reason, 'AbortError');
    for (const job of this.queue.splice(0)) job.reject(error);
    this.dispatchEvent(new CustomEvent('cancelled'));
  }
}

function pdfLoadOptions(password = '') {
  return {
    ignoreEncryption: false,
    updateMetadata: false,
    password: password || undefined,
  };
}

function friendlyPdfError(error) {
  const message = String(error?.message || error || '');
  if (/password|encrypted/i.test(message)) return new Error('PDF มีรหัสผ่านหรือใช้การเข้ารหัสที่ไม่รองรับ');
  if (/parse|header|xref|invalid/i.test(message)) return new Error('PDF เสียหายหรือโครงสร้างไม่ถูกต้อง');
  return error instanceof Error ? error : new Error(message || 'เปิด PDF ไม่สำเร็จ');
}

export async function inspectPdf(file, options = {}) {
  await validatePdfFile(file, options);
  const PDFLib = await ensurePdfLib();
  try {
    const bytes = await file.arrayBuffer();
    const document = await PDFLib.PDFDocument.load(bytes, pdfLoadOptions(options.password));
    const pageCount = document.getPageCount();
    if (pageCount > (options.maxPages || PDF_TOOL_LIMITS.maxPages)) throw new Error(`PDF มี ${pageCount} หน้า เกินค่าที่กำหนด`);
    const pages = document.getPages().map((page, index) => ({
      index,
      number: index + 1,
      width: page.getWidth(),
      height: page.getHeight(),
      rotation: page.getRotation()?.angle || 0,
    }));
    return {
      fileName: file.name,
      size: file.size,
      pageCount,
      pages,
      title: document.getTitle?.() || '',
      author: document.getAuthor?.() || '',
      subject: document.getSubject?.() || '',
      encrypted: false,
    };
  } catch (error) {
    throw friendlyPdfError(error);
  }
}

function clearPdfMetadata(document) {
  document.setTitle?.('');
  document.setAuthor?.('');
  document.setSubject?.('');
  document.setKeywords?.([]);
  document.setProducer?.('RipScan');
  document.setCreator?.('RipScan');
}

async function preserveCompress(file, options, hooks) {
  const PDFLib = await ensurePdfLib();
  const bytes = await file.arrayBuffer();
  assertNotCancelled(hooks.signal);
  hooks.onProgress({ completed: 0, total: 1, label: 'กำลังปรับโครงสร้าง PDF' });
  let document;
  try {
    document = await PDFLib.PDFDocument.load(bytes, pdfLoadOptions(hooks.password));
  } catch (error) {
    throw friendlyPdfError(error);
  }
  if (options.removeMetadata) clearPdfMetadata(document);
  if (options.flattenAnnotations) {
    try { document.getForm().flatten(); }
    catch { hooks.onWarning('ไม่สามารถ Flatten annotation บางรายการได้'); }
  }
  assertNotCancelled(hooks.signal);
  const output = await document.save({
    useObjectStreams: true,
    addDefaultPage: false,
    objectsPerTick: 20,
    updateFieldAppearances: false,
  });
  hooks.onProgress({ completed: 1, total: 1, label: 'บีบอัดแบบรักษา Text Layer เสร็จแล้ว' });
  return {
    blob: new Blob([output], { type: 'application/pdf' }),
    pageCount: document.getPageCount(),
    textLayerPreserved: true,
    linksPreserved: options.preserveLinks,
    bookmarksPreserved: options.preserveBookmarks,
    mode: 'preserve',
    warnings: [],
  };
}

function safeRenderScale(viewport, dpi) {
  const scale = dpi / 72;
  const pixels = viewport.width * viewport.height * scale * scale;
  if (pixels <= PDF_TOOL_LIMITS.maxRenderPixels) return scale;
  return Math.sqrt(PDF_TOOL_LIMITS.maxRenderPixels / Math.max(1, viewport.width * viewport.height));
}

async function canvasBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('สร้างภาพหน้า PDF ไม่สำเร็จ')), mime, quality));
}

async function renderPdfPage(page, options, signal) {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = safeRenderScale(baseViewport, options.dpi);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d', { alpha: options.transparent === true });
  if (!options.transparent) {
    context.fillStyle = options.background || '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const renderTask = page.render({ canvasContext: context, viewport, background: options.transparent ? undefined : options.background || '#ffffff' });
  const abort = () => renderTask.cancel();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await renderTask.promise;
    assertNotCancelled(signal);
    return { canvas, viewport, baseViewport };
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

async function rasterCompress(file, options, hooks) {
  const PDFLib = await ensurePdfLib();
  const pdfjs = await ensurePdfJs();
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer(), password: hooks.password || undefined });
  const abort = () => loadingTask.destroy();
  hooks.signal?.addEventListener('abort', abort, { once: true });
  let source;
  try {
    source = await loadingTask.promise;
  } catch (error) {
    throw friendlyPdfError(error);
  }
  const output = await PDFLib.PDFDocument.create();
  const worker = typeof Worker !== 'undefined' ? new PdfToolWorkerClient() : null;
  const warnings = ['โหมดบีบอัดภาพจะสร้างหน้า PDF ใหม่จากภาพและไม่รักษา Text Layer เดิม'];
  try {
    for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
      assertNotCancelled(hooks.signal);
      hooks.onProgress({ completed: pageNumber - 1, total: source.numPages, label: `บีบอัดหน้า ${pageNumber} จาก ${source.numPages}` });
      const page = await source.getPage(pageNumber);
      const rendered = await renderPdfPage(page, { dpi: options.dpi, background: '#ffffff', transparent: false }, hooks.signal);
      let blob = await canvasBlob(rendered.canvas, 'image/jpeg', options.quality);
      if (worker && (options.downscale || options.grayscale)) {
        const resized = await worker.run('resize-image', {
          blob,
          width: rendered.canvas.width,
          height: rendered.canvas.height,
          keepAspect: true,
          mime: 'image/jpeg',
          quality: options.quality,
          grayscale: options.grayscale,
          background: '#ffffff',
        }, { signal: hooks.signal, timeoutMs: 60_000 });
        blob = resized.blob;
      }
      const image = await output.embedJpg(await blob.arrayBuffer());
      const pdfPage = output.addPage([rendered.baseViewport.width, rendered.baseViewport.height]);
      pdfPage.drawImage(image, { x: 0, y: 0, width: pdfPage.getWidth(), height: pdfPage.getHeight() });
      rendered.canvas.width = 1;
      rendered.canvas.height = 1;
      page.cleanup();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (options.removeMetadata) clearPdfMetadata(output);
    const bytes = await output.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 15 });
    hooks.onProgress({ completed: source.numPages, total: source.numPages, label: 'บีบอัด PDF เสร็จแล้ว' });
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      pageCount: source.numPages,
      textLayerPreserved: false,
      linksPreserved: false,
      bookmarksPreserved: false,
      mode: 'raster',
      warnings,
    };
  } finally {
    worker?.dispose();
    hooks.signal?.removeEventListener('abort', abort);
    await source?.destroy?.();
  }
}

export async function compressPdf(file, options = {}, hooks = {}) {
  await validatePdfFile(file);
  const normalized = normalizeCompressionOptions(options);
  const callbacks = {
    signal: hooks.signal,
    password: hooks.password || '',
    onProgress: hooks.onProgress || (() => {}),
    onWarning: hooks.onWarning || (() => {}),
  };
  if (normalized.mode === 'raster' && normalized.preserveTextLayer) throw new Error('โหมดภาพไม่สามารถรักษา Text Layer ได้ กรุณาปิด Preserve Text Layer หรือเลือกโหมดรักษาโครงสร้าง');
  const result = normalized.mode === 'raster'
    ? await rasterCompress(file, normalized, callbacks)
    : await preserveCompress(file, normalized, callbacks);
  result.summary = compressionSummary(file.size, result.blob.size);
  return result;
}

function extensionOf(file) {
  return String(file?.name || '').split('.').pop()?.toLowerCase() || String(file?.type || '').split('/').pop()?.toLowerCase() || '';
}

function isPdf(file) {
  return file?.type === 'application/pdf' || extensionOf(file) === 'pdf';
}

function isJpeg(file) {
  return ['jpg', 'jpeg'].includes(extensionOf(file)) || file?.type === 'image/jpeg';
}

function isPng(file) {
  return extensionOf(file) === 'png' || file?.type === 'image/png';
}

async function normalizeImageForPdf(file, worker, options = {}) {
  await validateImageFile(file);
  if (isJpeg(file)) return { bytes: await file.arrayBuffer(), format: 'jpg' };
  if (isPng(file)) return { bytes: await file.arrayBuffer(), format: 'png' };
  if (!worker) throw new Error('เบราว์เซอร์ไม่รองรับการแปลงรูปชนิดนี้');
  const result = await worker.run('resize-image', {
    blob: file,
    maxSide: options.maxSide || 6000,
    keepAspect: true,
    mime: options.preferJpeg ? 'image/jpeg' : 'image/png',
    quality: options.quality ?? .92,
    background: options.background || '#ffffff',
    transparent: !options.preferJpeg,
  }, { signal: options.signal, timeoutMs: 90_000 });
  return { bytes: await result.blob.arrayBuffer(), format: options.preferJpeg ? 'jpg' : 'png' };
}

function imagePageSize(image, options = {}) {
  const presets = {
    A4: [595.28, 841.89],
    A5: [419.53, 595.28],
    Letter: [612, 792],
    Legal: [612, 1008],
  };
  if (options.pageSize === 'image' || options.pageSize === 'fit-image') return [image.width * 72 / 96, image.height * 72 / 96];
  let size = presets[options.pageSize || 'A4'] || [Math.max(72, Number(options.width) || 595.28), Math.max(72, Number(options.height) || 841.89)];
  const autoLandscape = options.autoOrientation && image.width > image.height;
  if (options.orientation === 'landscape' || autoLandscape) size = [Math.max(...size), Math.min(...size)];
  else size = [Math.min(...size), Math.max(...size)];
  return size;
}

function fitImageBox(image, pageWidth, pageHeight, options = {}) {
  const margin = Math.max(0, Number(options.margin) || 0);
  const availableWidth = Math.max(1, pageWidth - margin * 2);
  const availableHeight = Math.max(1, pageHeight - margin * 2);
  if (options.fit === 'stretch') return { x: margin, y: margin, width: availableWidth, height: availableHeight };
  const scale = options.fit === 'cover'
    ? Math.max(availableWidth / image.width, availableHeight / image.height)
    : Math.min(availableWidth / image.width, availableHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: margin + (availableWidth - width) / 2,
    y: margin + (availableHeight - height) / 2,
    width,
    height,
  };
}

async function embedImage(document, file, worker, options = {}) {
  const normalized = await normalizeImageForPdf(file, worker, options);
  const image = normalized.format === 'jpg'
    ? await document.embedJpg(normalized.bytes)
    : await document.embedPng(normalized.bytes);
  return image;
}

export async function imageFilesToPdf(files, options = {}, hooks = {}) {
  const list = [...files];
  if (!list.length) throw new Error('กรุณาเลือกรูปภาพอย่างน้อย 1 รูป');
  const PDFLib = await ensurePdfLib();
  const document = await PDFLib.PDFDocument.create();
  const worker = typeof Worker !== 'undefined' ? new PdfToolWorkerClient() : null;
  const ordered = Array.isArray(options.order)
    ? options.order.map(index => list[index]).filter(Boolean)
    : list;
  try {
    for (let index = 0; index < ordered.length; index += 1) {
      assertNotCancelled(hooks.signal);
      hooks.onProgress?.({ completed: index, total: ordered.length, label: `เพิ่มรูป ${index + 1} จาก ${ordered.length}` });
      const file = ordered[index];
      const image = await embedImage(document, file, worker, { ...options, signal: hooks.signal });
      const [pageWidth, pageHeight] = imagePageSize(image, options);
      const page = document.addPage([pageWidth, pageHeight]);
      const box = fitImageBox(image, pageWidth, pageHeight, options);
      page.drawImage(image, { ...box, rotate: PDFLib.degrees(Number(options.rotations?.[index]) || 0) });
      if (options.addPageNumber) page.drawText(String(index + 1), { x: pageWidth / 2 - 5, y: 14, size: 9, color: PDFLib.rgb(.25, .25, .25) });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const bytes = await document.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 15 });
    hooks.onProgress?.({ completed: ordered.length, total: ordered.length, label: 'สร้าง PDF จากรูปเสร็จแล้ว' });
    return new Blob([bytes], { type: 'application/pdf' });
  } finally {
    worker?.dispose();
  }
}

export function buildMergeItems(sources, metadata = []) {
  const items = [];
  sources.forEach((source, sourceIndex) => {
    const sourceId = metadata[sourceIndex]?.sourceId || `source-${sourceIndex + 1}`;
    const pageCount = metadata[sourceIndex]?.pageCount || (isPdf(source) ? 0 : 1);
    if (isPdf(source)) {
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) items.push({
        id: `${sourceId}-page-${pageIndex + 1}`,
        sourceId,
        sourceName: source.name,
        sourcePageIndex: pageIndex,
        sourcePageNumber: pageIndex + 1,
        rotation: 0,
      });
    } else items.push({ id: `${sourceId}-image`, sourceId, sourceName: source.name, sourcePageIndex: 0, sourcePageNumber: 1, rotation: 0 });
  });
  return items;
}

export async function mergePdfSources(sources, organizerItems, options = {}, hooks = {}) {
  const list = [...sources];
  if (!list.length) throw new Error('กรุณาเลือก PDF หรือรูปภาพอย่างน้อย 1 ไฟล์');
  const PDFLib = await ensurePdfLib();
  const output = await PDFLib.PDFDocument.create();
  const sourceMap = new Map();
  const worker = typeof Worker !== 'undefined' ? new PdfToolWorkerClient() : null;
  try {
    for (let index = 0; index < list.length; index += 1) {
      const file = list[index];
      const id = options.sourceIds?.[index] || `source-${index + 1}`;
      if (isPdf(file)) {
        await validatePdfFile(file);
        let document;
        try { document = await PDFLib.PDFDocument.load(await file.arrayBuffer(), pdfLoadOptions(options.passwords?.[index])); }
        catch (error) { throw friendlyPdfError(error); }
        sourceMap.set(id, { file, type: 'pdf', document });
      } else {
        await validateImageFile(file);
        sourceMap.set(id, { file, type: 'image' });
      }
    }
    const items = (organizerItems || []).filter(item => !item.deleted);
    if (!items.length) throw new Error('ไม่มีหน้าที่เลือกสำหรับรวมไฟล์');
    for (let index = 0; index < items.length; index += 1) {
      assertNotCancelled(hooks.signal);
      const item = items[index];
      const source = sourceMap.get(item.sourceId);
      if (!source) throw new Error(`ไม่พบไฟล์ต้นทางของหน้า ${index + 1}`);
      hooks.onProgress?.({ completed: index, total: items.length, label: `รวมหน้า ${index + 1} จาก ${items.length}` });
      if (source.type === 'pdf') {
        if (item.sourcePageIndex >= source.document.getPageCount()) throw new Error(`หน้า ${item.sourcePageNumber} เกินจำนวนหน้าของ ${source.file.name}`);
        const [page] = await output.copyPages(source.document, [item.sourcePageIndex]);
        if (item.rotation) page.setRotation(PDFLib.degrees(((page.getRotation()?.angle || 0) + item.rotation) % 360));
        output.addPage(page);
      } else {
        const image = await embedImage(output, source.file, worker, { ...options, signal: hooks.signal });
        const [width, height] = imagePageSize(image, options.imagePage || { pageSize: 'fit-image' });
        const page = output.addPage([width, height]);
        const box = fitImageBox(image, width, height, options.imagePage || { pageSize: 'fit-image', fit: 'contain' });
        page.drawImage(image, { ...box, rotate: PDFLib.degrees(Number(item.rotation) || 0) });
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (options.removeMetadata !== false) clearPdfMetadata(output);
    const bytes = await output.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 15 });
    hooks.onProgress?.({ completed: items.length, total: items.length, label: 'รวม PDF เสร็จแล้ว' });
    return new Blob([bytes], { type: 'application/pdf' });
  } finally {
    worker?.dispose();
  }
}

export async function splitPdf(file, groups, options = {}, hooks = {}) {
  await validatePdfFile(file);
  const PDFLib = await ensurePdfLib();
  let source;
  try { source = await PDFLib.PDFDocument.load(await file.arrayBuffer(), pdfLoadOptions(options.password)); }
  catch (error) { throw friendlyPdfError(error); }
  const normalizedGroups = Array.isArray(groups) && groups.length
    ? groups
    : splitGroupsByMode(options.mode || 'every-page', source.getPageCount(), options);
  if (!normalizedGroups.length) throw new Error('ไม่พบช่วงหน้าสำหรับแยก PDF');
  const results = [];
  const base = safeFilename(file.name.replace(/\.pdf$/iu, ''));
  for (let index = 0; index < normalizedGroups.length; index += 1) {
    assertNotCancelled(hooks.signal);
    const group = normalizedGroups[index];
    const pages = [...new Set(group.pages.map(Number))];
    if (!pages.length || pages.some(page => page < 0 || page >= source.getPageCount())) throw new Error(`ช่วงหน้าไม่ถูกต้อง: ${group.label || index + 1}`);
    hooks.onProgress?.({ completed: index, total: normalizedGroups.length, label: `สร้างไฟล์ ${index + 1} จาก ${normalizedGroups.length}` });
    const document = await PDFLib.PDFDocument.create();
    const copied = await document.copyPages(source, pages);
    copied.forEach(page => document.addPage(page));
    const bytes = await document.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 15 });
    const label = group.label || pages.map(page => page + 1).join('-');
    const filename = pages.length === 1
      ? `${base}_page_${pages[0] + 1}.pdf`
      : `${base}_pages_${safeFilename(label, pages.map(page => page + 1).join('-'))}.pdf`;
    results.push({ filename, pages, blob: new Blob([bytes], { type: 'application/pdf' }) });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  hooks.onProgress?.({ completed: normalizedGroups.length, total: normalizedGroups.length, label: 'แยก PDF เสร็จแล้ว' });
  return results;
}

export async function splitPdfZip(file, groups, options = {}, hooks = {}) {
  const results = await splitPdf(file, groups, options, hooks);
  const Zip = await ensureJsZip();
  const zip = new Zip();
  for (const result of results) zip.file(result.filename, result.blob);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, metadata => {
    hooks.onZipProgress?.({ percent: metadata.percent, label: metadata.currentFile || '' });
  });
  return { blob, files: results };
}

export async function pdfToImages(file, options = {}, hooks = {}) {
  await validatePdfFile(file);
  const pdfjs = await ensurePdfJs();
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer(), password: options.password || undefined });
  const abort = () => loadingTask.destroy();
  hooks.signal?.addEventListener('abort', abort, { once: true });
  let pdf;
  try { pdf = await loadingTask.promise; }
  catch (error) { throw friendlyPdfError(error); }
  const selection = options.pages?.length
    ? { valid: true, pages: options.pages }
    : options.range
      ? parsePageSelection(options.range, pdf.numPages)
      : { valid: true, pages: Array.from({ length: pdf.numPages }, (_, index) => index) };
  if (!selection.valid || !selection.pages.length) throw new Error(selection.errors?.join(' · ') || 'ไม่มีหน้าที่เลือก');
  const format = options.format === 'jpg' || options.format === 'jpeg' ? 'jpg' : 'png';
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const worker = typeof Worker !== 'undefined' ? new PdfToolWorkerClient() : null;
  const outputs = [];
  const base = safeFilename(file.name.replace(/\.pdf$/iu, ''));
  try {
    for (let position = 0; position < selection.pages.length; position += 1) {
      assertNotCancelled(hooks.signal);
      const pageIndex = selection.pages[position];
      hooks.onProgress?.({ completed: position, total: selection.pages.length, label: `แปลง PDF เป็น ${format.toUpperCase()} หน้า ${position + 1} จาก ${selection.pages.length}` });
      const page = await pdf.getPage(pageIndex + 1);
      const rendered = await renderPdfPage(page, {
        dpi: clamp(options.dpi || 150, 72, 600),
        background: options.background || '#ffffff',
        transparent: format === 'png' && options.transparent,
      }, hooks.signal);
      let blob = await canvasBlob(rendered.canvas, mime, clamp(options.quality ?? .92, .1, 1));
      if (worker && (options.width || options.height || options.scale || options.grayscale)) {
        const scale = clamp(options.scale || 1, .1, 8);
        const resized = await worker.run('resize-image', {
          blob,
          width: Number(options.width) || Math.round(rendered.canvas.width * scale),
          height: Number(options.height) || 0,
          keepAspect: options.keepAspect !== false,
          fit: options.fit || 'contain',
          mime,
          quality: clamp(options.quality ?? .92, .1, 1),
          transparent: format === 'png' && options.transparent,
          background: options.background || '#ffffff',
          grayscale: Boolean(options.grayscale),
        }, { signal: hooks.signal, timeoutMs: 90_000 });
        blob = resized.blob;
      }
      const filename = `${base}_page_${String(pageIndex + 1).padStart(3, '0')}.${format}`;
      outputs.push({ pageIndex, pageNumber: pageIndex + 1, filename, blob });
      rendered.canvas.width = 1;
      rendered.canvas.height = 1;
      page.cleanup();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    hooks.onProgress?.({ completed: outputs.length, total: outputs.length, label: 'แปลง PDF เป็นรูปเสร็จแล้ว' });
    return outputs;
  } finally {
    worker?.dispose();
    hooks.signal?.removeEventListener('abort', abort);
    await pdf?.destroy?.();
  }
}

export async function imagesToZip(images, options = {}) {
  const Zip = await ensureJsZip();
  const zip = new Zip();
  for (const image of images) zip.file(image.filename, image.blob);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, metadata => options.onProgress?.(metadata));
}

export function pdfToolFilename(sourceName, suffix, extension = 'pdf') {
  const base = safeFilename(String(sourceName || 'document').replace(/\.[^.]+$/u, ''));
  return `${base}_${suffix}.${extension}`;
}
