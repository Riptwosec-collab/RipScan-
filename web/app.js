const PDFJS_URL = '/vendor/pdf.min.mjs';
const PDFJS_WORKER_URL = '/vendor/pdf.worker.min.mjs';
let pdfJsPromise = null;

function withLoadTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

async function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = withLoadTimeout(import(PDFJS_URL), 20_000, 'โหลดระบบ PDF นานเกิน 20 วินาที กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่')
      .then(pdfjs => {
        pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return pdfjs;
      })
      .catch(error => {
        pdfJsPromise = null;
        throw error;
      });
  }
  return pdfJsPromise;
}

const MAX_FILES = 10;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MAX_CANVAS_SIDE = 2800;
const LANGUAGE_MAP = {
  auto: ['tha', 'eng'],
  th: ['tha'],
  en: ['eng'],
  'th+en': ['tha', 'eng'],
};

const state = {
  files: [],
  documents: [],
  worker: null,
  progressContext: '',
  pasteSequence: 0,
  objectUrls: new Set(),
  histories: new Map(),
  viewers: new Map(),
  searches: new Map(),
};

const input = document.querySelector('#fileInput');
const dropzone = document.querySelector('#dropzone');
const pasteButton = document.querySelector('#pasteButton');
const clearButton = document.querySelector('#clearButton');
const fileList = document.querySelector('#fileList');
const runButton = document.querySelector('#runButton');
const language = document.querySelector('#language');
const statusBox = document.querySelector('#status');
const statusText = document.querySelector('#statusText');
const errorBox = document.querySelector('#error');
const results = document.querySelector('#results');
const health = document.querySelector('#health');

const formatBytes = bytes => bytes < 1024 * 1024
  ? `${(bytes / 1024).toFixed(1)} KB`
  : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

const pageKey = (documentIndex, pageIndex) => `${documentIndex}:${pageIndex}`;

function isSupported(file) {
  return file.type === 'application/pdf'
    || file.type.startsWith('image/')
    || /\.(pdf|png|jpe?g|webp|tiff?|bmp)$/i.test(file.name);
}

function updateFileControls() {
  const hasFiles = state.files.length > 0;
  runButton.disabled = !hasFiles;
  clearButton.disabled = !hasFiles;
}

function renderFileList() {
  fileList.innerHTML = state.files.map((file, index) => `
    <div class="file-row">
      <span class="file-type">${file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'PDF' : 'IMG'}</span>
      <span class="file-name"><strong>${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}${file.__fromClipboard ? ' · จากคลิปบอร์ด' : ''}</small></span>
      <button class="remove" data-index="${index}" aria-label="ลบไฟล์">×</button>
    </div>`).join('');
  updateFileControls();
}

function addFiles(files, { replace = false } = {}) {
  const incoming = [...files].filter(isSupported);
  if (!incoming.length) return showError('ไม่พบรูปภาพหรือ PDF ที่รองรับ');
  const oversized = incoming.find(file => file.size > MAX_FILE_SIZE);
  if (oversized) return showError(`ไฟล์ ${oversized.name} ใหญ่เกิน 50 MB`);
  const current = replace ? [] : state.files;
  const available = Math.max(0, MAX_FILES - current.length);
  if (!available) return showError(`เพิ่มได้สูงสุด ${MAX_FILES} ไฟล์ต่อครั้ง`);
  state.files = [...current, ...incoming.slice(0, available)];
  if (incoming.length > available) showError(`รับเพิ่มได้ ${available} ไฟล์ ระบบตัดไฟล์ส่วนเกินออก`);
  else errorBox.hidden = true;
  renderFileList();
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function setBusy(busy, text = 'กำลังประมวลผล…') {
  statusBox.hidden = !busy;
  statusText.textContent = text;
  runButton.disabled = busy || !state.files.length;
  clearButton.disabled = busy || !state.files.length;
  pasteButton.disabled = busy;
}

function updateProgress(message) {
  if (message.status === 'recognizing text') {
    const percent = Math.round((message.progress || 0) * 100);
    statusText.textContent = `${state.progressContext} · OCR ${percent}%`;
  } else if (message.status) {
    statusText.textContent = `${state.progressContext} · ${message.status}`;
  }
}

async function ensureWorker() {
  if (state.worker) return state.worker;
  if (!window.Tesseract?.createWorker) throw new Error('โหลดระบบ OCR ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วรีเฟรชหน้า');
  state.progressContext = 'กำลังเตรียมภาษา OCR';
  const languages = LANGUAGE_MAP[language.value] || LANGUAGE_MAP.auto;
  state.worker = await window.Tesseract.createWorker(languages, 1, { logger: updateProgress });
  return state.worker;
}

function normalizeOcrLayout(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatPdfText(items) {
  const tokens = items
    .filter(item => typeof item.str === 'string' && item.str.trim())
    .map(item => ({
      text: item.str.trim(),
      x: Number(item.transform?.[4] || 0),
      y: Number(item.transform?.[5] || 0),
      width: Math.max(0, Number(item.width || 0)),
      height: Math.max(1, Number(item.height || Math.abs(item.transform?.[3] || 10))),
    }))
    .sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);

  if (!tokens.length) return '';
  const lines = [];
  for (const token of tokens) {
    const tolerance = Math.max(2.5, token.height * 0.45);
    let line = lines.find(candidate => Math.abs(candidate.y - token.y) <= tolerance);
    if (!line) {
      line = { y: token.y, height: token.height, tokens: [] };
      lines.push(line);
    }
    line.tokens.push(token);
    line.height = Math.max(line.height, token.height);
  }
  lines.sort((a, b) => b.y - a.y);

  const output = [];
  let previousLine = null;
  for (const line of lines) {
    line.tokens.sort((a, b) => a.x - b.x);
    let text = '';
    let previousToken = null;
    for (const token of line.tokens) {
      if (previousToken) {
        const gap = token.x - (previousToken.x + previousToken.width);
        const expectedSpace = Math.max(2.5, previousToken.height * 0.18);
        if (gap > expectedSpace && !/^[,.;:!?%)\]}]/.test(token.text)) text += ' ';
      }
      text += token.text;
      previousToken = token;
    }
    if (previousLine) {
      const verticalGap = previousLine.y - line.y;
      const paragraphThreshold = Math.max(previousLine.height, line.height) * 1.75;
      if (verticalGap > paragraphThreshold) output.push('');
    }
    output.push(text.trim());
    previousLine = line;
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
}

async function loadBitmap(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(`เปิดรูป ${file.name} ไม่สำเร็จ`));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawBitmapToCanvas(bitmap) {
  const maxSide = Math.max(bitmap.width, bitmap.height);
  let scale = 1;
  if (maxSide < 1500) scale = Math.min(2, 1500 / Math.max(1, maxSide));
  if (maxSide > MAX_CANVAS_SIDE) scale = MAX_CANVAS_SIDE / maxSide;
  const canvas = createCanvas(bitmap.width * scale, bitmap.height * scale);
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

function grayscaleData(imageData) {
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const value = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  return imageData;
}

function otsuThreshold(imageData) {
  const histogram = new Uint32Array(256);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) histogram[data[index]] += 1;
  const total = data.length / 4;
  let sum = 0;
  for (let level = 0; level < 256; level += 1) sum += level * histogram[level];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let maxVariance = -1;
  let threshold = 160;
  for (let level = 0; level < 256; level += 1) {
    backgroundWeight += histogram[level];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += level * histogram[level];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = level;
    }
  }
  return threshold;
}

function projectionScore(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const rows = new Float64Array(canvas.height);
  let totalDark = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    let count = 0;
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4;
      const gray = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
      if (gray < 165) count += 1;
    }
    rows[y] = count;
    totalDark += count;
  }
  if (totalDark < canvas.width * canvas.height * 0.003) return 0;
  const mean = totalDark / rows.length;
  let variance = 0;
  for (const value of rows) variance += (value - mean) ** 2;
  return variance / rows.length;
}

function rotateCanvas(source, angleDegrees, expand = true) {
  if (Math.abs(angleDegrees) < 0.01) {
    const clone = createCanvas(source.width, source.height);
    clone.getContext('2d', { alpha: false }).drawImage(source, 0, 0);
    return clone;
  }
  const radians = angleDegrees * Math.PI / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const width = expand ? source.width * cos + source.height * sin : source.width;
  const height = expand ? source.width * sin + source.height * cos : source.height;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(radians);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function detectDeskewAngle(source) {
  const scale = Math.min(1, 720 / Math.max(source.width, source.height));
  const sample = createCanvas(source.width * scale, source.height * scale);
  const sampleContext = sample.getContext('2d', { alpha: false });
  sampleContext.fillStyle = '#fff';
  sampleContext.fillRect(0, 0, sample.width, sample.height);
  sampleContext.drawImage(source, 0, 0, sample.width, sample.height);

  let bestAngle = 0;
  let bestScore = -1;
  for (let angle = -4; angle <= 4; angle += 1) {
    const candidate = rotateCanvas(sample, angle, false);
    const score = projectionScore(candidate);
    releaseCanvas(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  releaseCanvas(sample);
  return Math.abs(bestAngle) < 1 ? 0 : bestAngle;
}

function makeEnhancedCanvas(source) {
  const downScale = Math.min(1, 1800 / Math.max(source.width, source.height));
  const denoise = createCanvas(source.width * Math.max(0.78, downScale), source.height * Math.max(0.78, downScale));
  const denoiseContext = denoise.getContext('2d', { alpha: false });
  denoiseContext.filter = 'grayscale(1) contrast(1.5) brightness(1.06)';
  denoiseContext.imageSmoothingEnabled = true;
  denoiseContext.imageSmoothingQuality = 'high';
  denoiseContext.drawImage(source, 0, 0, denoise.width, denoise.height);

  const enhanced = createCanvas(source.width, source.height);
  const enhancedContext = enhanced.getContext('2d', { alpha: false });
  enhancedContext.fillStyle = '#fff';
  enhancedContext.fillRect(0, 0, enhanced.width, enhanced.height);
  enhancedContext.imageSmoothingEnabled = true;
  enhancedContext.imageSmoothingQuality = 'high';
  enhancedContext.drawImage(denoise, 0, 0, enhanced.width, enhanced.height);
  releaseCanvas(denoise);
  return enhanced;
}

function makeThresholdCanvas(source) {
  const canvas = createCanvas(source.width, source.height);
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.drawImage(source, 0, 0);
  const imageData = grayscaleData(context.getImageData(0, 0, canvas.width, canvas.height));
  const threshold = otsuThreshold(imageData);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const value = data[index] > threshold ? 255 : 0;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

async function canvasToObjectUrl(canvas, type = 'image/jpeg', quality = 0.9) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, type, quality));
  if (!blob) return canvas.toDataURL(type, quality);
  const url = URL.createObjectURL(blob);
  state.objectUrls.add(url);
  return url;
}

async function fileToObjectUrl(file) {
  const url = URL.createObjectURL(file);
  state.objectUrls.add(url);
  return url;
}

function scoreOcrResult(result) {
  const compactLength = result.text.replace(/\s/g, '').length;
  const contentScore = Math.min(1, compactLength / 100);
  const lineScore = Math.min(1, result.text.split('\n').filter(Boolean).length / 8);
  return result.confidence * 0.76 + contentScore * 0.18 + lineScore * 0.06;
}

async function recognizeCanvas(canvas, label, variant) {
  state.progressContext = `${label} · ${variant}`;
  const worker = await ensureWorker();
  const response = await worker.recognize(canvas);
  return {
    text: normalizeOcrLayout(response.data.text),
    confidence: Math.max(0, Math.min(1, Number(response.data.confidence || 0) / 100)),
    source: 'ocr-browser',
    variant,
  };
}

async function recognizeWithAutoEnhancement(sourceCanvas, label) {
  statusText.textContent = `${label} · กำลังวิเคราะห์ภาพเอียง`;
  const deskewAngle = detectDeskewAngle(sourceCanvas);
  const corrected = rotateCanvas(sourceCanvas, deskewAngle, true);
  const enhanced = makeEnhancedCanvas(corrected);
  const variants = [
    { name: deskewAngle ? 'ต้นฉบับ + ปรับเอียง' : 'ต้นฉบับ', canvas: corrected },
    { name: 'ลด Noise + Contrast', canvas: enhanced },
  ];

  const recognized = [];
  for (const variant of variants) recognized.push({ ...await recognizeCanvas(variant.canvas, label, variant.name), canvas: variant.canvas });
  let currentBest = [...recognized].sort((a, b) => scoreOcrResult(b) - scoreOcrResult(a))[0];

  if (currentBest.confidence < 0.88 || currentBest.text.replace(/\s/g, '').length < 40) {
    const thresholdCanvas = makeThresholdCanvas(enhanced);
    recognized.push({ ...await recognizeCanvas(thresholdCanvas, label, 'Threshold ขาวดำ'), canvas: thresholdCanvas });
    currentBest = [...recognized].sort((a, b) => scoreOcrResult(b) - scoreOcrResult(a))[0];
  }

  const enhancedPreviewUrl = await canvasToObjectUrl(currentBest.canvas);
  for (const result of recognized) {
    if (result.canvas !== currentBest.canvas) releaseCanvas(result.canvas);
  }
  if (currentBest.canvas !== corrected) releaseCanvas(corrected);
  if (currentBest.canvas !== enhanced) releaseCanvas(enhanced);
  releaseCanvas(currentBest.canvas);

  return {
    text: currentBest.text,
    confidence: currentBest.confidence,
    source: 'ocr-browser',
    bestVariant: currentBest.variant,
    deskewAngle,
    enhancedPreviewUrl,
    attempts: recognized.map(item => ({ name: item.variant, confidence: item.confidence })),
  };
}

async function processImage(file, fileIndex) {
  const bitmap = await loadBitmap(file);
  const sourceCanvas = drawBitmapToCanvas(bitmap);
  const originalPreviewUrl = await fileToObjectUrl(file);
  const result = await recognizeWithAutoEnhancement(sourceCanvas, `ไฟล์ ${fileIndex + 1}/${state.files.length} · ${file.name}`);
  releaseCanvas(sourceCanvas);
  return {
    filename: file.name,
    mimeType: file.type || 'image/*',
    pageCount: 1,
    fullText: result.text,
    confidence: result.confidence,
    pages: [{ page: 1, originalPreviewUrl, ...result }],
  };
}

async function renderPdfPage(page) {
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2.25, MAX_CANVAS_SIDE / Math.max(1, baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

async function processPdf(file, fileIndex) {
  const pdfjsLib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  if (pdf.numPages > MAX_PDF_PAGES) {
    await pdf.destroy();
    throw new Error(`PDF ${file.name} มีมากกว่า ${MAX_PDF_PAGES} หน้า`);
  }

  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const label = `ไฟล์ ${fileIndex + 1}/${state.files.length} · หน้า ${pageNumber}/${pdf.numPages}`;
      state.progressContext = label;
      statusText.textContent = `${label} · กำลังอ่านและจัดหน้า`;
      const page = await pdf.getPage(pageNumber);
      const [textContent, canvas] = await Promise.all([
        page.getTextContent(),
        renderPdfPage(page),
      ]);
      const textLayer = formatPdfText(textContent.items);
      const originalPreviewUrl = await canvasToObjectUrl(canvas);

      if (textLayer.replace(/\s/g, '').length >= 12) {
        pages.push({
          page: pageNumber,
          text: textLayer,
          confidence: 1,
          source: 'pdf-text',
          bestVariant: 'PDF Text Layer',
          deskewAngle: 0,
          originalPreviewUrl,
          enhancedPreviewUrl: null,
          attempts: [],
        });
        releaseCanvas(canvas);
        page.cleanup();
        continue;
      }

      const result = await recognizeWithAutoEnhancement(canvas, label);
      pages.push({ page: pageNumber, originalPreviewUrl, ...result });
      releaseCanvas(canvas);
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }

  const confidences = pages.filter(page => page.text).map(page => page.confidence);
  return {
    filename: file.name,
    mimeType: 'application/pdf',
    pageCount: pages.length,
    fullText: pages.map(page => page.text).join('\n\n').trim(),
    confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0,
    pages,
  };
}

async function processFile(file, index) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  return isPdf ? processPdf(file, index) : processImage(file, index);
}

function pageSourceLabel(page) {
  return page.source === 'pdf-text' ? 'อ่านข้อความจาก PDF' : `OCR · ${page.bestVariant || 'อัตโนมัติ'}`;
}

function initializeReviewState(documents) {
  state.histories.clear();
  state.viewers.clear();
  state.searches.clear();
  documents.forEach((documentData, documentIndex) => {
    documentData.pages.forEach((page, pageIndex) => {
      const key = pageKey(documentIndex, pageIndex);
      state.histories.set(key, { current: page.text, undo: [], redo: [] });
      state.viewers.set(key, {
        zoom: 1,
        rotation: 0,
        mode: page.enhancedPreviewUrl ? 'enhanced' : 'original',
      });
      state.searches.set(key, { query: '', index: 0 });
    });
  });
}

function renderResults(documents) {
  state.documents = documents;
  initializeReviewState(documents);
  results.innerHTML = documents.map((documentData, documentIndex) => {
    const confidence = Math.round(documentData.confidence * 100);
    const scoreClass = confidence >= 85 ? 'good' : confidence >= 65 ? 'warn' : 'bad';
    return `<article class="panel result-card" data-document="${documentIndex}">
      <div class="result-head">
        <div><p class="eyebrow">ผลลัพธ์ ${documentIndex + 1}</p><h2>${escapeHtml(documentData.filename)}</h2><p>${documentData.pageCount} หน้า · ความมั่นใจเฉลี่ย ${confidence}%</p></div>
        <span class="score ${scoreClass}">${confidence}%</span>
      </div>
      <div class="document-actions actions">
        <button data-action="copy-document" data-document="${documentIndex}">คัดลอกทั้งหมด</button>
        <button data-action="copy-separated" data-document="${documentIndex}">คัดลอกแบบแยกหน้า</button>
        <button data-action="download-document" data-document="${documentIndex}">ดาวน์โหลด TXT แยกหน้า</button>
      </div>
      <nav class="page-tabs" aria-label="เลือกหน้าที่ต้องการตรวจ">
        ${documentData.pages.map((page, pageIndex) => `<button class="page-tab ${pageIndex === 0 ? 'active' : ''}" data-action="switch-page" data-document="${documentIndex}" data-page="${pageIndex}">หน้า ${page.page}</button>`).join('')}
      </nav>
      <div class="page-list">${documentData.pages.map((page, pageIndex) => renderPageReview(page, documentIndex, pageIndex)).join('')}</div>
    </article>`;
  }).join('');
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPageReview(page, documentIndex, pageIndex) {
  const attempts = page.attempts?.length
    ? page.attempts.map(item => `${escapeHtml(item.name)} ${Math.round(item.confidence * 100)}%`).join(' · ')
    : 'ใช้ Text Layer โดยตรง';
  const imageUrl = page.enhancedPreviewUrl || page.originalPreviewUrl;
  return `<section class="page-card" data-page-card="${pageIndex}" ${pageIndex === 0 ? '' : 'hidden'}>
    <div class="page-head">
      <div><strong>หน้า ${page.page}</strong><span>${pageSourceLabel(page)} · ${Math.round(page.confidence * 100)}%</span></div>
      <div class="page-actions actions">
        <button data-action="copy-page" data-document="${documentIndex}" data-page="${pageIndex}">คัดลอกหน้านี้</button>
        <button data-action="download-page" data-document="${documentIndex}" data-page="${pageIndex}">ดาวน์โหลด TXT</button>
      </div>
    </div>
    <div class="review-grid">
      <section class="viewer-panel" aria-label="ภาพต้นฉบับหน้า ${page.page}">
        <div class="viewer-toolbar">
          <div class="toolbar-group">
            <button data-action="preview-original" data-document="${documentIndex}" data-page="${pageIndex}" class="${page.enhancedPreviewUrl ? '' : 'active'}">ต้นฉบับ</button>
            ${page.enhancedPreviewUrl ? `<button data-action="preview-enhanced" data-document="${documentIndex}" data-page="${pageIndex}" class="active">ภาพที่ใช้ OCR</button>` : ''}
          </div>
          <div class="toolbar-group">
            <button data-action="zoom-out" data-document="${documentIndex}" data-page="${pageIndex}" aria-label="ย่อภาพ">−</button>
            <span class="zoom-label" data-zoom-label="${documentIndex}:${pageIndex}">100%</span>
            <button data-action="zoom-in" data-document="${documentIndex}" data-page="${pageIndex}" aria-label="ขยายภาพ">+</button>
            <button data-action="fit-image" data-document="${documentIndex}" data-page="${pageIndex}">พอดี</button>
            <button data-action="rotate-image" data-document="${documentIndex}" data-page="${pageIndex}">หมุน 90°</button>
          </div>
        </div>
        <div class="image-stage" data-image-stage="${documentIndex}:${pageIndex}">
          <img class="page-preview" data-page-image="${documentIndex}:${pageIndex}" src="${escapeHtml(imageUrl)}" alt="ภาพเอกสารหน้า ${page.page}">
        </div>
        <div class="processing-summary">
          <span>${page.deskewAngle ? `ปรับเอียง ${page.deskewAngle > 0 ? '+' : ''}${page.deskewAngle}°` : 'ภาพตรงแล้ว'}</span>
          <span>${escapeHtml(page.bestVariant || 'ต้นฉบับ')}</span>
          <small>${attempts}</small>
        </div>
      </section>
      <section class="editor-panel" aria-label="ข้อความหน้า ${page.page}">
        <div class="editor-toolbar">
          <div class="toolbar-group">
            <button data-action="undo" data-document="${documentIndex}" data-page="${pageIndex}" disabled>↶ Undo</button>
            <button data-action="redo" data-document="${documentIndex}" data-page="${pageIndex}" disabled>↷ Redo</button>
          </div>
          <label class="search-box">
            <span class="sr-only">ค้นหาในหน้านี้</span>
            <input class="page-search" data-document="${documentIndex}" data-page="${pageIndex}" type="search" placeholder="ค้นหาในหน้านี้">
            <small data-search-count="${documentIndex}:${pageIndex}">0 จุด</small>
          </label>
        </div>
        <textarea class="page-text" data-document="${documentIndex}" data-page="${pageIndex}" spellcheck="false" aria-label="ข้อความหน้า ${page.page}">${escapeHtml(page.text)}</textarea>
        <div class="editor-footer">
          <span data-text-stats="${documentIndex}:${pageIndex}">${textStats(page.text)}</span>
          <span>แก้ไขข้อความได้ทันที · Undo/Redo ได้สูงสุด 80 ขั้น</span>
        </div>
      </section>
    </div>
  </section>`;
}

function textStats(text) {
  const value = String(text || '');
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  return `${value.length.toLocaleString('th-TH')} ตัวอักษร · ${words.toLocaleString('th-TH')} คำ`;
}

function currentPageText(documentIndex, pageIndex) {
  return document.querySelector(`textarea.page-text[data-document="${documentIndex}"][data-page="${pageIndex}"]`)?.value || '';
}

function buildDocumentText(documentIndex, separated = false) {
  const documentData = state.documents[documentIndex];
  if (!documentData) return '';
  return documentData.pages.map((page, pageIndex) => {
    const text = currentPageText(documentIndex, pageIndex).trim();
    return separated ? `===== หน้า ${page.page} =====\n\n${text}` : text;
  }).join('\n\n').trim();
}

async function writeClipboard(text, button) {
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = 'คัดลอกแล้ว';
  setTimeout(() => { button.textContent = original; }, 1200);
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

async function cleanupWorker() {
  if (!state.worker) return;
  await state.worker.terminate();
  state.worker = null;
}

function cleanupObjectUrls() {
  for (const url of state.objectUrls) URL.revokeObjectURL(url);
  state.objectUrls.clear();
}

function clipboardFilename(type, index = 1) {
  const extension = type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  state.pasteSequence += 1;
  return `clipboard-${stamp}-${state.pasteSequence + index - 1}.${extension}`;
}

function makeClipboardFile(blob, index = 1) {
  const file = new File([blob], clipboardFilename(blob.type || 'image/png', index), { type: blob.type || 'image/png' });
  Object.defineProperty(file, '__fromClipboard', { value: true });
  return file;
}

async function pasteFromClipboardButton() {
  if (!navigator.clipboard?.read) return showError('เบราว์เซอร์นี้ไม่รองรับปุ่มวางรูป กรุณาคัดลอกรูปแล้วกด Ctrl+V หรือ ⌘+V');
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const item of items) {
      const imageType = item.types.find(type => type.startsWith('image/'));
      if (imageType) files.push(makeClipboardFile(await item.getType(imageType), files.length + 1));
    }
    if (!files.length) throw new Error('คลิปบอร์ดยังไม่มีรูปภาพ');
    addFiles(files);
  } catch (error) {
    showError(error?.message === 'Read permission denied.'
      ? 'เบราว์เซอร์ไม่อนุญาตให้อ่านคลิปบอร์ด กรุณากด Ctrl+V หรือ ⌘+V แทน'
      : (error?.message || 'ไม่สามารถวางรูปจากคลิปบอร์ดได้'));
  }
}

function handlePasteEvent(event) {
  if (event.target.closest('textarea, input, select, [contenteditable="true"]')) return;
  const items = [...(event.clipboardData?.items || [])];
  const imageItems = items.filter(item => item.kind === 'file' && item.type.startsWith('image/'));
  if (!imageItems.length) return;
  event.preventDefault();
  const files = imageItems.map((item, index) => {
    const blob = item.getAsFile();
    return blob ? makeClipboardFile(blob, index + 1) : null;
  }).filter(Boolean);
  addFiles(files);
}

function getViewer(documentIndex, pageIndex) {
  return state.viewers.get(pageKey(documentIndex, pageIndex));
}

function updateViewer(documentIndex, pageIndex) {
  const key = pageKey(documentIndex, pageIndex);
  const viewer = getViewer(documentIndex, pageIndex);
  const page = state.documents[documentIndex]?.pages[pageIndex];
  const image = document.querySelector(`[data-page-image="${key}"]`);
  const label = document.querySelector(`[data-zoom-label="${key}"]`);
  if (!viewer || !page || !image) return;
  image.src = viewer.mode === 'enhanced' && page.enhancedPreviewUrl ? page.enhancedPreviewUrl : page.originalPreviewUrl;
  image.style.width = `${Math.round(viewer.zoom * 100)}%`;
  image.style.transform = `rotate(${viewer.rotation}deg)`;
  if (label) label.textContent = `${Math.round(viewer.zoom * 100)}%`;
  const card = image.closest('.page-card');
  card?.querySelector('[data-action="preview-original"]')?.classList.toggle('active', viewer.mode === 'original');
  card?.querySelector('[data-action="preview-enhanced"]')?.classList.toggle('active', viewer.mode === 'enhanced');
}

function switchPage(documentIndex, pageIndex) {
  const card = results.querySelector(`.result-card[data-document="${documentIndex}"]`);
  if (!card) return;
  card.querySelectorAll('.page-card').forEach((pageCard, index) => { pageCard.hidden = index !== pageIndex; });
  card.querySelectorAll('.page-tab').forEach((tab, index) => tab.classList.toggle('active', index === pageIndex));
  updateViewer(documentIndex, pageIndex);
}

function updateHistoryButtons(documentIndex, pageIndex) {
  const key = pageKey(documentIndex, pageIndex);
  const history = state.histories.get(key);
  const card = document.querySelector(`textarea.page-text[data-document="${documentIndex}"][data-page="${pageIndex}"]`)?.closest('.page-card');
  if (!history || !card) return;
  card.querySelector('[data-action="undo"]').disabled = !history.undo.length;
  card.querySelector('[data-action="redo"]').disabled = !history.redo.length;
}

function setEditorValue(documentIndex, pageIndex, value) {
  const key = pageKey(documentIndex, pageIndex);
  const textarea = document.querySelector(`textarea.page-text[data-document="${documentIndex}"][data-page="${pageIndex}"]`);
  const history = state.histories.get(key);
  if (!textarea || !history) return;
  textarea.value = value;
  history.current = value;
  document.querySelector(`[data-text-stats="${key}"]`).textContent = textStats(value);
  updateHistoryButtons(documentIndex, pageIndex);
  updateSearch(documentIndex, pageIndex, false);
}

function recordEditorInput(textarea) {
  const documentIndex = Number(textarea.dataset.document);
  const pageIndex = Number(textarea.dataset.page);
  const key = pageKey(documentIndex, pageIndex);
  const history = state.histories.get(key);
  if (!history || textarea.value === history.current) return;
  history.undo.push(history.current);
  if (history.undo.length > 80) history.undo.shift();
  history.current = textarea.value;
  history.redo = [];
  document.querySelector(`[data-text-stats="${key}"]`).textContent = textStats(textarea.value);
  updateHistoryButtons(documentIndex, pageIndex);
  updateSearch(documentIndex, pageIndex, false);
}

function undo(documentIndex, pageIndex) {
  const history = state.histories.get(pageKey(documentIndex, pageIndex));
  if (!history?.undo.length) return;
  history.redo.push(history.current);
  const previous = history.undo.pop();
  setEditorValue(documentIndex, pageIndex, previous);
}

function redo(documentIndex, pageIndex) {
  const history = state.histories.get(pageKey(documentIndex, pageIndex));
  if (!history?.redo.length) return;
  history.undo.push(history.current);
  const next = history.redo.pop();
  setEditorValue(documentIndex, pageIndex, next);
}

function findMatches(text, query) {
  if (!query) return [];
  const source = text.toLocaleLowerCase('th');
  const needle = query.toLocaleLowerCase('th');
  const matches = [];
  let position = 0;
  while ((position = source.indexOf(needle, position)) !== -1) {
    matches.push(position);
    position += Math.max(1, needle.length);
  }
  return matches;
}

function updateSearch(documentIndex, pageIndex, selectNext = false) {
  const key = pageKey(documentIndex, pageIndex);
  const searchInput = document.querySelector(`input.page-search[data-document="${documentIndex}"][data-page="${pageIndex}"]`);
  const textarea = document.querySelector(`textarea.page-text[data-document="${documentIndex}"][data-page="${pageIndex}"]`);
  const countLabel = document.querySelector(`[data-search-count="${key}"]`);
  const searchState = state.searches.get(key);
  if (!searchInput || !textarea || !countLabel || !searchState) return;
  const query = searchInput.value.trim();
  const matches = findMatches(textarea.value, query);
  if (query !== searchState.query) {
    searchState.query = query;
    searchState.index = 0;
  }
  countLabel.textContent = `${matches.length.toLocaleString('th-TH')} จุด`;
  if (selectNext && matches.length) {
    const matchIndex = matches[searchState.index % matches.length];
    textarea.focus();
    textarea.setSelectionRange(matchIndex, matchIndex + query.length);
    searchState.index = (searchState.index + 1) % matches.length;
  }
}

dropzone.addEventListener('click', event => { if (!event.target.closest('button')) input.click(); });
dropzone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') input.click(); });
input.addEventListener('change', () => addFiles(input.files));
pasteButton.addEventListener('click', pasteFromClipboardButton);
clearButton.addEventListener('click', () => {
  state.files = [];
  input.value = '';
  renderFileList();
  errorBox.hidden = true;
});
document.addEventListener('paste', handlePasteEvent);

['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => {
  event.preventDefault();
  dropzone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, event => {
  event.preventDefault();
  dropzone.classList.remove('dragging');
}));
dropzone.addEventListener('drop', event => addFiles(event.dataTransfer.files));

fileList.addEventListener('click', event => {
  const button = event.target.closest('.remove');
  if (!button) return;
  state.files.splice(Number(button.dataset.index), 1);
  renderFileList();
});

language.addEventListener('change', cleanupWorker);

runButton.addEventListener('click', async () => {
  errorBox.hidden = true;
  results.innerHTML = '';
  state.documents = [];
  cleanupObjectUrls();
  setBusy(true, 'กำลังเตรียมเอกสารและปรับภาพอัตโนมัติ…');
  try {
    const documents = [];
    for (let index = 0; index < state.files.length; index += 1) documents.push(await processFile(state.files[index], index));
    renderResults(documents);
  } catch (error) {
    console.error(error);
    showError(error?.message || 'แปลงไฟล์ไม่สำเร็จ');
  } finally {
    await cleanupWorker();
    setBusy(false);
  }
});

results.addEventListener('input', event => {
  if (event.target.matches('textarea.page-text')) recordEditorInput(event.target);
  if (event.target.matches('input.page-search')) updateSearch(Number(event.target.dataset.document), Number(event.target.dataset.page), false);
});

results.addEventListener('keydown', event => {
  if (event.target.matches('input.page-search') && event.key === 'Enter') {
    event.preventDefault();
    updateSearch(Number(event.target.dataset.document), Number(event.target.dataset.page), true);
  }
  if (event.target.matches('textarea.page-text') && (event.ctrlKey || event.metaKey)) {
    const documentIndex = Number(event.target.dataset.document);
    const pageIndex = Number(event.target.dataset.page);
    if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      undo(documentIndex, pageIndex);
    } else if (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)) {
      event.preventDefault();
      redo(documentIndex, pageIndex);
    }
  }
});

results.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  const documentIndex = Number(button.dataset.document);
  const pageIndex = Number(button.dataset.page);
  const documentData = state.documents[documentIndex];
  if (!documentData) return;

  if (action === 'switch-page') return switchPage(documentIndex, pageIndex);
  if (action === 'copy-page') return writeClipboard(currentPageText(documentIndex, pageIndex), button);
  if (action === 'copy-document') return writeClipboard(buildDocumentText(documentIndex, false), button);
  if (action === 'copy-separated') return writeClipboard(buildDocumentText(documentIndex, true), button);
  if (action === 'download-page') {
    const pageNumber = documentData.pages[pageIndex]?.page || pageIndex + 1;
    const base = documentData.filename.replace(/\.[^.]+$/, '');
    return downloadText(currentPageText(documentIndex, pageIndex), `${base}-page-${pageNumber}.txt`);
  }
  if (action === 'download-document') {
    const base = documentData.filename.replace(/\.[^.]+$/, '');
    return downloadText(buildDocumentText(documentIndex, true), `${base}-ocr-separated-pages.txt`);
  }
  if (action === 'undo') return undo(documentIndex, pageIndex);
  if (action === 'redo') return redo(documentIndex, pageIndex);

  const viewer = getViewer(documentIndex, pageIndex);
  if (!viewer) return;
  if (action === 'preview-original') viewer.mode = 'original';
  if (action === 'preview-enhanced') viewer.mode = 'enhanced';
  if (action === 'zoom-out') viewer.zoom = Math.max(0.5, Number((viewer.zoom - 0.25).toFixed(2)));
  if (action === 'zoom-in') viewer.zoom = Math.min(3, Number((viewer.zoom + 0.25).toFixed(2)));
  if (action === 'fit-image') viewer.zoom = 1;
  if (action === 'rotate-image') viewer.rotation = (viewer.rotation + 90) % 360;
  updateViewer(documentIndex, pageIndex);
});

window.addEventListener('beforeunload', cleanupObjectUrls);
health.classList.add('ready');
health.querySelector('span:last-child').textContent = 'พร้อมใช้งาน · ปรับภาพอัตโนมัติ · Review แบบคู่';
