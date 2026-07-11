import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

const MAX_FILES = 10;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const LANGUAGE_MAP = {
  auto: ['tha', 'eng'],
  th: ['tha'],
  en: ['eng'],
  'th+en': ['tha', 'eng'],
};

const state = { files: [], documents: [], worker: null, progressContext: '' };
const input = document.querySelector('#fileInput');
const dropzone = document.querySelector('#dropzone');
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

function isSupported(file) {
  return file.type === 'application/pdf'
    || file.type.startsWith('image/')
    || /\.(pdf|png|jpe?g|webp|tiff?|bmp)$/i.test(file.name);
}

function setFiles(files) {
  const selected = [...files].filter(isSupported).slice(0, MAX_FILES);
  const oversized = selected.find(file => file.size > MAX_FILE_SIZE);
  if (oversized) {
    showError(`ไฟล์ ${oversized.name} ใหญ่เกิน 50 MB`);
    return;
  }
  state.files = selected;
  fileList.innerHTML = state.files.map((file, index) => `
    <div class="file-row">
      <span class="file-type">${file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'PDF' : 'IMG'}</span>
      <span class="file-name"><strong>${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}</small></span>
      <button class="remove" data-index="${index}" aria-label="ลบไฟล์">×</button>
    </div>`).join('');
  runButton.disabled = !state.files.length;
  errorBox.hidden = true;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function setBusy(busy, text = 'กำลังประมวลผล…') {
  statusBox.hidden = !busy;
  statusText.textContent = text;
  runButton.disabled = busy || !state.files.length;
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

async function recognizeImage(source, label) {
  state.progressContext = label;
  const worker = await ensureWorker();
  const response = await worker.recognize(source);
  const text = (response.data.text || '').trim();
  return {
    text,
    confidence: Math.max(0, Math.min(1, Number(response.data.confidence || 0) / 100)),
    source: 'ocr-browser',
  };
}

async function processImage(file, fileIndex) {
  const result = await recognizeImage(file, `ไฟล์ ${fileIndex + 1}/${state.files.length} · ${file.name}`);
  return {
    filename: file.name,
    mimeType: file.type || 'image/*',
    pageCount: 1,
    fullText: result.text,
    confidence: result.confidence,
    pages: [{ page: 1, ...result }],
  };
}

async function processPdf(file, fileIndex) {
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
      state.progressContext = `ไฟล์ ${fileIndex + 1}/${state.files.length} · หน้า ${pageNumber}/${pdf.numPages}`;
      statusText.textContent = `${state.progressContext} · กำลังอ่านข้อความ`;
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const textLayer = textContent.items
        .map(item => typeof item.str === 'string' ? item.str : '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (textLayer.length >= 12) {
        pages.push({ page: pageNumber, text: textLayer, confidence: 1, source: 'pdf-text' });
        page.cleanup();
        continue;
      }

      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2.2, 3200 / Math.max(1, baseViewport.width));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { alpha: false });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      await page.render({ canvasContext: context, viewport }).promise;
      const result = await recognizeImage(canvas, state.progressContext);
      pages.push({ page: pageNumber, ...result });
      canvas.width = 1;
      canvas.height = 1;
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

function renderResults(documents) {
  state.documents = documents;
  results.innerHTML = documents.map((document, index) => {
    const confidence = Math.round(document.confidence * 100);
    const scoreClass = confidence >= 85 ? 'good' : confidence >= 65 ? 'warn' : 'bad';
    return `<article class="panel result-card">
      <div class="result-head">
        <div><p class="eyebrow">ผลลัพธ์ ${index + 1}</p><h2>${escapeHtml(document.filename)}</h2><p>${document.pageCount} หน้า · ความมั่นใจเฉลี่ย ${confidence}%</p></div>
        <span class="score ${scoreClass}">${confidence}%</span>
      </div>
      <textarea id="text-${index}" spellcheck="false">${escapeHtml(document.fullText)}</textarea>
      <div class="actions">
        <button data-action="copy" data-index="${index}">คัดลอก</button>
        <button data-action="download" data-index="${index}">ดาวน์โหลด TXT</button>
      </div>
      <details><summary>ดูรายละเอียดแต่ละหน้า</summary>${document.pages.map(page => `
        <div class="page-detail"><strong>หน้า ${page.page}</strong><span>${page.source === 'pdf-text' ? 'อ่านข้อความจาก PDF' : 'OCR ในเบราว์เซอร์'} · ${Math.round(page.confidence * 100)}%</span></div>`).join('')}</details>
    </article>`;
  }).join('');
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function cleanupWorker() {
  if (!state.worker) return;
  await state.worker.terminate();
  state.worker = null;
}

dropzone.addEventListener('click', () => input.click());
dropzone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') input.click();
});
input.addEventListener('change', () => setFiles(input.files));
['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, event => {
  event.preventDefault();
  dropzone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, event => {
  event.preventDefault();
  dropzone.classList.remove('dragging');
}));
dropzone.addEventListener('drop', event => setFiles(event.dataTransfer.files));

fileList.addEventListener('click', event => {
  const button = event.target.closest('.remove');
  if (!button) return;
  state.files.splice(Number(button.dataset.index), 1);
  setFiles(state.files);
});

language.addEventListener('change', cleanupWorker);

runButton.addEventListener('click', async () => {
  errorBox.hidden = true;
  results.innerHTML = '';
  state.documents = [];
  setBusy(true, 'กำลังเตรียมเอกสาร…');
  try {
    const documents = [];
    for (let index = 0; index < state.files.length; index += 1) {
      documents.push(await processFile(state.files[index], index));
    }
    renderResults(documents);
  } catch (error) {
    console.error(error);
    showError(error?.message || 'แปลงไฟล์ไม่สำเร็จ');
  } finally {
    await cleanupWorker();
    setBusy(false);
  }
});

results.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const index = Number(button.dataset.index);
  const area = document.querySelector(`#text-${index}`);
  if (!area) return;
  if (button.dataset.action === 'copy') {
    await navigator.clipboard.writeText(area.value);
    const original = button.textContent;
    button.textContent = 'คัดลอกแล้ว';
    setTimeout(() => { button.textContent = original; }, 1200);
    return;
  }
  const filename = state.documents[index]?.filename || `document-${index + 1}`;
  const blob = new Blob([area.value], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename.replace(/\.[^.]+$/, '')}-ocr.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
});

health.classList.add('ready');
health.querySelector('span:last-child').textContent = 'พร้อมใช้งาน · OCR บนอุปกรณ์';
