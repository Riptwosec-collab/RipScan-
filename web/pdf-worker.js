const VERSION = '4.0.0';
const cancelled = new Set();
let libraryPromise = null;

async function libraries() {
  if (!libraryPromise) {
    libraryPromise = Promise.all([
      import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm'),
      import('https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/+esm').catch(() => null),
    ]).then(([pdfLib, fontkitModule]) => ({ pdfLib, fontkit: fontkitModule?.default || fontkitModule || null }));
  }
  return libraryPromise;
}

function abortIfNeeded(jobId) {
  if (cancelled.has(jobId)) throw new Error('PDF_JOB_CANCELLED');
}

function progress(jobId, completed, total, label, extra = {}) {
  postMessage({ type: 'progress', jobId, completed, total, label, ...extra });
}

function asUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('INVALID_BINARY_INPUT');
}

function bytesFromDataUrl(value) {
  const match = String(value || '').match(/^data:([^;,]+)?(?:;base64)?,(.*)$/u);
  if (!match) return null;
  const payload = match[2] || '';
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mime: match[1] || 'application/octet-stream', bytes };
}

function pageSize(name, width, height, imageWidth = 794, imageHeight = 1123) {
  const presets = {
    A4: [595.28, 841.89],
    A5: [419.53, 595.28],
    Letter: [612, 792],
    Legal: [612, 1008],
  };
  if (name === 'fit-image') return [Math.max(1, imageWidth * .75), Math.max(1, imageHeight * .75)];
  if (name === 'custom') return [Math.max(1, Number(width) || 595.28), Math.max(1, Number(height) || 841.89)];
  return presets[name] || presets.A4;
}

function containRect(sourceWidth, sourceHeight, boxWidth, boxHeight, mode = 'contain') {
  const scale = mode === 'cover'
    ? Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight)
    : mode === 'stretch'
      ? null
      : Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  const width = scale === null ? boxWidth : sourceWidth * scale;
  const height = scale === null ? boxHeight : sourceHeight * scale;
  return { width, height, x: (boxWidth - width) / 2, y: (boxHeight - height) / 2 };
}

async function embedImage(pdf, bytes, mime) {
  const lower = String(mime || '').toLowerCase();
  if (lower.includes('png')) return pdf.embedPng(bytes);
  return pdf.embedJpg(bytes);
}

async function inspectPdf(payload, jobId) {
  const { PDFDocument } = (await libraries()).pdfLib;
  const bytes = asUint8Array(payload.bytes);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  abortIfNeeded(jobId);
  return {
    pageCount: pdf.getPageCount(),
    title: pdf.getTitle() || '',
    author: pdf.getAuthor() || '',
    subject: pdf.getSubject() || '',
    producer: pdf.getProducer() || '',
    pageSizes: pdf.getPages().map(page => ({ width: page.getWidth(), height: page.getHeight(), rotation: page.getRotation().angle || 0 })),
  };
}

async function compressPreserve(payload, jobId) {
  const { PDFDocument } = (await libraries()).pdfLib;
  const bytes = asUint8Array(payload.bytes);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const total = pdf.getPageCount();
  if (payload.options?.removeMetadata !== false) {
    pdf.setTitle('');
    pdf.setAuthor('');
    pdf.setSubject('');
    pdf.setKeywords([]);
    pdf.setProducer('RipScan Browser PDF Tools');
    pdf.setCreator('RipScan');
  }
  for (let index = 0; index < total; index += 1) {
    abortIfNeeded(jobId);
    progress(jobId, index + 1, total, `ตรวจหน้า ${index + 1}/${total}`);
  }
  const output = await pdf.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 20, updateFieldAppearances: false });
  return { bytes: output, pageCount: total, preserveTextLayer: true };
}

async function mergeDocuments(payload, jobId) {
  const { PDFDocument, degrees } = (await libraries()).pdfLib;
  const output = await PDFDocument.create();
  const sources = payload.sources || [];
  const items = (payload.items || []).filter(item => !item.deleted);
  const loaded = new Map();
  let completed = 0;
  for (const item of items) {
    abortIfNeeded(jobId);
    const source = sources[item.sourceIndex];
    if (!source) throw new Error(`SOURCE_NOT_FOUND:${item.sourceIndex}`);
    if (source.kind === 'pdf') {
      let document = loaded.get(item.sourceIndex);
      if (!document) {
        document = await PDFDocument.load(asUint8Array(source.bytes), { updateMetadata: false });
        loaded.set(item.sourceIndex, document);
      }
      const [page] = await output.copyPages(document, [Number(item.pageIndex) || 0]);
      if (item.rotation) page.setRotation(degrees(Number(item.rotation) || 0));
      output.addPage(page);
    } else {
      const image = await embedImage(output, asUint8Array(source.bytes), source.mime);
      let width = image.width;
      let height = image.height;
      if ([90, 270].includes((Number(item.rotation) || 0) % 360)) [width, height] = [height, width];
      const page = output.addPage([width, height]);
      page.drawImage(image, { x: 0, y: 0, width, height, rotate: degrees(Number(item.rotation) || 0) });
    }
    completed += 1;
    progress(jobId, completed, items.length, `รวมหน้า ${completed}/${items.length}`);
  }
  const bytes = await output.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 20 });
  return { bytes, pageCount: output.getPageCount() };
}

async function splitDocument(payload, jobId) {
  const { PDFDocument } = (await libraries()).pdfLib;
  const source = await PDFDocument.load(asUint8Array(payload.bytes), { updateMetadata: false });
  const groups = payload.groups || [];
  const outputs = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    abortIfNeeded(jobId);
    const pages = groups[groupIndex].map(Number);
    const pdf = await PDFDocument.create();
    const copied = await pdf.copyPages(source, pages);
    copied.forEach(page => pdf.addPage(page));
    outputs.push({ pages, bytes: await pdf.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 20 }) });
    progress(jobId, groupIndex + 1, groups.length, `แยกไฟล์ ${groupIndex + 1}/${groups.length}`);
  }
  return { outputs, sourcePageCount: source.getPageCount() };
}

async function imagesToPdf(payload, jobId) {
  const { PDFDocument, degrees, rgb } = (await libraries()).pdfLib;
  const pdf = await PDFDocument.create();
  const images = payload.images || [];
  const options = payload.options || {};
  for (let index = 0; index < images.length; index += 1) {
    abortIfNeeded(jobId);
    const source = images[index];
    const image = await embedImage(pdf, asUint8Array(source.bytes), source.mime);
    let [width, height] = pageSize(options.pageSize, options.width, options.height, image.width, image.height);
    if (options.autoOrientation !== false) {
      const imageLandscape = image.width > image.height;
      const pageLandscape = width > height;
      if (imageLandscape !== pageLandscape) [width, height] = [height, width];
    } else if (options.orientation === 'landscape' && height > width) [width, height] = [height, width];
    const page = pdf.addPage([width, height]);
    const margin = Math.max(0, Number(options.margin) || 0);
    const background = String(options.background || '#ffffff').replace('#', '');
    const red = parseInt(background.slice(0, 2) || 'ff', 16) / 255;
    const green = parseInt(background.slice(2, 4) || 'ff', 16) / 255;
    const blue = parseInt(background.slice(4, 6) || 'ff', 16) / 255;
    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(red, green, blue) });
    const boxWidth = Math.max(1, width - margin * 2);
    const boxHeight = Math.max(1, height - margin * 2);
    const rect = containRect(image.width, image.height, boxWidth, boxHeight, options.fit || 'contain');
    page.drawImage(image, {
      x: margin + rect.x,
      y: margin + rect.y,
      width: rect.width,
      height: rect.height,
      rotate: degrees(Number(source.rotation) || 0),
    });
    if (options.pageNumbers) page.drawText(String(index + 1), { x: width / 2 - 4, y: 12, size: 9 });
    progress(jobId, index + 1, images.length, `สร้าง PDF จากรูป ${index + 1}/${images.length}`);
  }
  return { bytes: await pdf.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 20 }), pageCount: images.length };
}

async function loadThaiFont(pdf, fontkit) {
  if (!fontkit || !pdf.registerFontkit) return null;
  try {
    pdf.registerFontkit(fontkit);
    const response = await fetch('https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosansthai/NotoSansThai-Regular.ttf');
    if (!response.ok) return null;
    return pdf.embedFont(await response.arrayBuffer(), { subset: true });
  } catch {
    return null;
  }
}

function toPdfPoint(page, block, scaleX, scaleY) {
  return {
    x: Number(block.x || 0) * scaleX,
    y: page.getHeight() - (Number(block.y || 0) + Number(block.height || 0)) * scaleY,
    width: Math.max(1, Number(block.width || 1) * scaleX),
    height: Math.max(1, Number(block.height || 1) * scaleY),
  };
}

async function drawModelBlock(pdf, page, block, modelPage, fonts, pdfLib) {
  const { rgb, degrees } = pdfLib;
  const scaleX = page.getWidth() / Math.max(1, Number(modelPage.width) || page.getWidth());
  const scaleY = page.getHeight() / Math.max(1, Number(modelPage.height) || page.getHeight());
  const box = toPdfPoint(page, block, scaleX, scaleY);
  const style = block.style || {};
  if (block.type === 'image') {
    const data = bytesFromDataUrl(block.src);
    if (!data) return;
    const image = await embedImage(pdf, data.bytes, data.mime);
    page.drawImage(image, { ...box, opacity: Number(block.opacity ?? 1), rotate: degrees(Number(block.rotation) || 0) });
    return;
  }
  if (block.type === 'shape' || block.type === 'line') {
    const stroke = String(style.stroke || '#111827').replace('#', '');
    const color = rgb(parseInt(stroke.slice(0, 2) || '11', 16) / 255, parseInt(stroke.slice(2, 4) || '18', 16) / 255, parseInt(stroke.slice(4, 6) || '27', 16) / 255);
    if (block.type === 'line' || block.shape === 'line' || block.shape === 'arrow') page.drawLine({ start: { x: box.x, y: box.y }, end: { x: box.x + box.width, y: box.y + box.height }, thickness: Math.max(.5, Number(style.strokeWidth) || 1), color });
    else page.drawRectangle({ ...box, borderColor: color, borderWidth: Math.max(.5, Number(style.strokeWidth) || 1), opacity: Number(style.opacity ?? 1) });
    return;
  }
  if (block.type === 'table') {
    const rowHeight = box.height / Math.max(1, block.rows);
    const colWidth = box.width / Math.max(1, block.columns);
    for (const cell of block.cells || []) {
      if (cell.hidden) continue;
      const cellX = box.x + cell.column * colWidth;
      const cellY = box.y + box.height - (cell.row + cell.rowSpan) * rowHeight;
      const cellW = cell.columnSpan * colWidth;
      const cellH = cell.rowSpan * rowHeight;
      page.drawRectangle({ x: cellX, y: cellY, width: cellW, height: cellH, borderColor: rgb(.4, .45, .52), borderWidth: .7 });
      if (cell.text) page.drawText(cell.text, { x: cellX + 3, y: cellY + cellH - 12, size: Math.max(6, Number(cell.style?.fontSize || 10) * .75), font: fonts.thai || fonts.fallback, maxWidth: Math.max(4, cellW - 6), lineHeight: 11 });
    }
    return;
  }
  const text = String(block.text ?? block.value ?? '');
  if (!text) return;
  const background = style.backgroundColor;
  if (background && background !== 'transparent' && background !== 'rgba(255,255,255,.78)' && background !== 'rgba(255,255,255,.82)') page.drawRectangle({ ...box, color: rgb(1, 1, 1), opacity: .95 });
  const original = block.metadata?.originalText;
  if (block.source === 'pdf-text-layer' && original !== undefined && original !== text) page.drawRectangle({ ...box, color: rgb(1, 1, 1), opacity: .98 });
  page.drawText(text, {
    x: box.x,
    y: box.y + Math.max(1, box.height - Math.max(7, Number(style.fontSize || 12) * scaleY)),
    size: Math.max(6, Number(style.fontSize || 12) * scaleY),
    font: fonts.thai || fonts.fallback,
    maxWidth: box.width,
    lineHeight: Math.max(7, Number(style.fontSize || 12) * scaleY * Number(style.lineHeight || 1.25)),
    rotate: degrees(Number(block.rotation) || 0),
  });
}

async function overlayModel(payload, jobId) {
  const librariesResult = await libraries();
  const { PDFDocument, StandardFonts } = librariesResult.pdfLib;
  const original = payload.originalBytes ? asUint8Array(payload.originalBytes) : null;
  const model = payload.model || { pages: [] };
  const pdf = original ? await PDFDocument.load(original, { updateMetadata: false }) : await PDFDocument.create();
  while (pdf.getPageCount() < model.pages.length) {
    const modelPage = model.pages[pdf.getPageCount()] || {};
    pdf.addPage([Math.max(1, Number(modelPage.width || 794) * .75), Math.max(1, Number(modelPage.height || 1123) * .75)]);
  }
  const fallback = await pdf.embedFont(StandardFonts.Helvetica);
  const thai = await loadThaiFont(pdf, librariesResult.fontkit);
  const fonts = { fallback, thai };
  for (let pageIndex = 0; pageIndex < model.pages.length; pageIndex += 1) {
    abortIfNeeded(jobId);
    const modelPage = model.pages[pageIndex];
    const page = pdf.getPage(pageIndex);
    for (const block of (modelPage.blocks || []).filter(item => !item.hidden).sort((a, b) => Number(a.zIndex || 1) - Number(b.zIndex || 1))) {
      if (block.source === 'pdf-text-layer' && block.metadata?.originalText === block.text) continue;
      await drawModelBlock(pdf, page, block, modelPage, fonts, librariesResult.pdfLib);
    }
    progress(jobId, pageIndex + 1, model.pages.length, `สร้าง Editable PDF หน้า ${pageIndex + 1}/${model.pages.length}`);
  }
  pdf.setProducer('RipScan Browser PDF Tools 4.0.0');
  return { bytes: await pdf.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 15 }), pageCount: pdf.getPageCount(), thaiFontEmbedded: Boolean(thai) };
}

const handlers = {
  inspect: inspectPdf,
  'compress-preserve': compressPreserve,
  merge: mergeDocuments,
  split: splitDocument,
  'images-to-pdf': imagesToPdf,
  'overlay-model': overlayModel,
};

self.addEventListener('message', async event => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    cancelled.add(message.jobId);
    return;
  }
  if (message.type === 'dispose') {
    cancelled.clear();
    close();
    return;
  }
  const handler = handlers[message.type];
  if (!handler) return postMessage({ type: 'result', jobId: message.jobId, ok: false, error: `UNSUPPORTED_PDF_TASK:${message.type}` });
  try {
    const result = await handler(message.payload || {}, message.jobId);
    abortIfNeeded(message.jobId);
    const transfer = [];
    if (result?.bytes?.buffer) transfer.push(result.bytes.buffer);
    for (const item of result?.outputs || []) if (item.bytes?.buffer) transfer.push(item.bytes.buffer);
    postMessage({ type: 'result', jobId: message.jobId, ok: true, result, version: VERSION }, transfer);
  } catch (error) {
    const text = String(error?.message || error || 'PDF_WORKER_FAILED');
    const mapped = /password|encrypted/i.test(text) ? 'PDF_PASSWORD_REQUIRED' : text;
    postMessage({ type: 'result', jobId: message.jobId, ok: false, error: mapped, version: VERSION });
  } finally {
    cancelled.delete(message.jobId);
  }
});
