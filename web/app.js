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

const state = { files: [], documents: [], worker: null, progressContext: '', pasteSequence: 0 };
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
  if (!incoming.length) {
    showError('ไม่พบรูปภาพหรือ PDF ที่รองรับ');
    return;
  }
  const oversized = incoming.find(file => file.size > MAX_FILE_SIZE);
  if (oversized) {
    showError(`ไฟล์ ${oversized.name} ใหญ่เกิน 50 MB`);
    return;
  }
  const current = replace ? [] : state.files;
  const available = Math.max(0, MAX_FILES - current.length);
  if (!available) {
    showError(`เพิ่มได้สูงสุด ${MAX_FILES} ไฟล์ต่อครั้ง`);
    return;
  }
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

async function recognizeImage(source, label) {
  state.progressContext = label;
  const worker = await ensureWorker();
  const response = await worker.recognize(source);
  return {
    text: normalizeOcrLayout(response.data.text),
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
      const textLayer = formatPdfText(textContent.items);

      if (textLayer.replace(/\s/g, '').length >= 12) {
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

function pageSourceLabel(page) {
  return page.source === 'pdf-text' ? 'อ่านข้อความจาก PDF' : 'OCR ในเบราว์เซอร์';
}

function renderResults(documents) {
  state.documents = documents;
  results.innerHTML = documents.map((document, documentIndex) => {
    const confidence = Math.round(document.confidence * 100);
    const scoreClass = confidence >= 85 ? 'good' : confidence >= 65 ? 'warn' : 'bad';
    return `<article class="panel result-card" data-document="${documentIndex}">
      <div class="result-head">
        <div><p class="eyebrow">ผลลัพธ์ ${documentIndex + 1}</p><h2>${escapeHtml(document.filename)}</h2><p>${document.pageCount} หน้า · ความมั่นใจเฉลี่ย ${confidence}%</p></div>
        <span class="score ${scoreClass}">${confidence}%</span>
      </div>
      <div class="document-actions actions">
        <button data-action="copy-document" data-document="${documentIndex}">คัดลอกทั้งหมด</button>
        <button data-action="copy-separated" data-document="${documentIndex}">คัดลอกแบบแยกหน้า</button>
        <button data-action="download-document" data-document="${documentIndex}">ดาวน์โหลด TXT แยกหน้า</button>
      </div>
      <div class="page-list">${document.pages.map((page, pageIndex) => `
        <section class="page-card" data-page-card="${pageIndex}">
          <div class="page-head">
            <div><strong>หน้า ${page.page}</strong><span>${pageSourceLabel(page)} · ${Math.round(page.confidence * 100)}%</span></div>
            <div class="page-actions actions">
              <button data-action="copy-page" data-document="${documentIndex}" data-page="${pageIndex}">คัดลอกหน้านี้</button>
              <button data-action="download-page" data-document="${documentIndex}" data-page="${pageIndex}">ดาวน์โหลดหน้า ${page.page}</button>
            </div>
          </div>
          <textarea class="page-text" data-document="${documentIndex}" data-page="${pageIndex}" spellcheck="false" aria-label="ข้อความหน้า ${page.page}">${escapeHtml(page.text)}</textarea>
        </section>`).join('')}</div>
    </article>`;
  }).join('');
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  link.click();
  URL.revokeObjectURL(link.href);
}

async function cleanupWorker() {
  if (!state.worker) return;
  await state.worker.terminate();
  state.worker = null;
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
  if (!navigator.clipboard?.read) {
    showError('เบราว์เซอร์นี้ไม่รองรับปุ่มวางรูป กรุณาคัดลอกรูปแล้วกด Ctrl+V หรือ ⌘+V');
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const item of items) {
      const imageType = item.types.find(type => type.startsWith('image/'));
      if (!imageType) continue;
      files.push(makeClipboardFile(await item.getType(imageType), files.length + 1));
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
  const files = imageItems
    .map((item, index) => {
      const blob = item.getAsFile();
      return blob ? makeClipboardFile(blob, index + 1) : null;
    })
    .filter(Boolean);
  addFiles(files);
}

dropzone.addEventListener('click', event => {
  if (event.target.closest('button')) return;
  input.click();
});
dropzone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') input.click();
});
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
  const documentIndex = Number(button.dataset.document);
  const pageIndex = Number(button.dataset.page);
  const documentData = state.documents[documentIndex];
  if (!documentData) return;

  if (button.dataset.action === 'copy-page') {
    await writeClipboard(currentPageText(documentIndex, pageIndex), button);
    return;
  }
  if (button.dataset.action === 'copy-document') {
    await writeClipboard(buildDocumentText(documentIndex, false), button);
    return;
  }
  if (button.dataset.action === 'copy-separated') {
    await writeClipboard(buildDocumentText(documentIndex, true), button);
    return;
  }
  if (button.dataset.action === 'download-page') {
    const pageNumber = documentData.pages[pageIndex]?.page || pageIndex + 1;
    const base = documentData.filename.replace(/\.[^.]+$/, '');
    downloadText(currentPageText(documentIndex, pageIndex), `${base}-page-${pageNumber}.txt`);
    return;
  }
  if (button.dataset.action === 'download-document') {
    const base = documentData.filename.replace(/\.[^.]+$/, '');
    downloadText(buildDocumentText(documentIndex, true), `${base}-ocr-separated-pages.txt`);
  }
});

health.classList.add('ready');
health.querySelector('span:last-child').textContent = 'พร้อมใช้งาน · วางรูปได้ · แยกหน้าอัตโนมัติ';
