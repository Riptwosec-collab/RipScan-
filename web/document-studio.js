import {
  cloneValue,
  createDocument,
  createPage,
  createTextBlock,
  createTableBlock,
  createTableCell,
  createImageBlock,
  createShapeBlock,
  createFieldBlock,
  normalizeDocumentModel,
  validateDocumentModel,
  findBlock,
  getTableCell,
  addTableRow,
  deleteTableRow,
  addTableColumn,
  deleteTableColumn,
  mergeTableCells,
  splitTableCell,
  documentToPlainText,
} from './document-model.mjs';
import {
  STRUCTURED_EXTENSIONS,
  extensionOf,
  isStructuredDocumentFile,
  importStructuredFile,
} from './office-import.mjs';
import {
  normalizeExportOptions,
  ensureStudioLibraries,
  exportPageElements,
  safeFilename,
  downloadBlob,
} from './editor-export.mjs';

const STUDIO_VERSION = '3.0.0';
const FILE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.docx,.xlsx,.xls,.pptx,.txt,.csv,.html,.htm,.rtf,.odt,.ods,.odp,.json';
const DB_NAME = 'ripscan-document-studio';
const DB_STORE = 'documents';
const DB_VERSIONS = 'versions';
const MAX_HISTORY = 50;
const AUTOSAVE_DELAY = 2500;
let autosaveTimer = 0;

const state = {
  model: null,
  activePage: 0,
  selectedBlockId: null,
  selectedCellIds: new Set(),
  zoom: 1,
  viewMode: 'visual',
  history: [],
  future: [],
  importToken: 0,
  exportToken: 0,
  editingSnapshot: null,
  dirty: false,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

function showGlobalStatus(message, busy = true) {
  const box = $('#status');
  const text = $('#statusText');
  if (box) box.hidden = !busy;
  if (text) text.textContent = message;
}

function showGlobalError(message) {
  const box = $('#error');
  if (!box) return;
  box.hidden = false;
  box.textContent = message;
}

function hideGlobalError() {
  const box = $('#error');
  if (box) box.hidden = true;
}

function currentPage() {
  return state.model?.pages?.[state.activePage] || null;
}

function selectedBlock() {
  if (!state.model || !state.selectedBlockId) return null;
  return findBlock(state.model, state.selectedBlockId)?.block || null;
}

function snapshot(label = 'แก้ไข') {
  if (!state.model) return;
  state.history.push({ label, model: cloneValue(state.model), activePage: state.activePage, selectedBlockId: state.selectedBlockId });
  if (state.history.length > MAX_HISTORY) state.history.shift();
  state.future = [];
  state.dirty = true;
  updateHistoryButtons();
  scheduleAutosave();
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  const status = $('#studioProgressText');
  if (status) status.textContent = navigator.onLine ? 'มีการแก้ไข · รอบันทึกอัตโนมัติ' : 'ออฟไลน์ · รอบันทึกในเครื่อง';
  autosaveTimer = setTimeout(() => saveDocumentLocal().then(() => {
    if (status) status.textContent = `บันทึกอัตโนมัติแล้ว ${new Date().toLocaleTimeString('th-TH')}`;
  }).catch(error => {
    if (status) status.textContent = `บันทึกอัตโนมัติไม่สำเร็จ: ${error.message}`;
  }), AUTOSAVE_DELAY);
}

function undo() {
  const previous = state.history.pop();
  if (!previous || !state.model) return;
  state.future.push({ label: previous.label, model: cloneValue(state.model), activePage: state.activePage, selectedBlockId: state.selectedBlockId });
  state.model = normalizeDocumentModel(previous.model);
  state.activePage = Math.min(previous.activePage, state.model.pages.length - 1);
  state.selectedBlockId = previous.selectedBlockId;
  state.selectedCellIds.clear();
  state.dirty = true;
  renderStudio();
}

function redo() {
  const next = state.future.pop();
  if (!next || !state.model) return;
  state.history.push({ label: next.label, model: cloneValue(state.model), activePage: state.activePage, selectedBlockId: state.selectedBlockId });
  state.model = normalizeDocumentModel(next.model);
  state.activePage = Math.min(next.activePage, state.model.pages.length - 1);
  state.selectedBlockId = next.selectedBlockId;
  state.selectedCellIds.clear();
  state.dirty = true;
  renderStudio();
}

function updateHistoryButtons() {
  const undoButton = $('[data-studio-action="undo"]');
  const redoButton = $('[data-studio-action="redo"]');
  if (undoButton) undoButton.disabled = !state.history.length;
  if (redoButton) redoButton.disabled = !state.future.length;
}

async function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DB_STORE)) database.createObjectStore(DB_STORE, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(DB_VERSIONS)) database.createObjectStore(DB_VERSIONS, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('เปิดฐานข้อมูลในเบราว์เซอร์ไม่สำเร็จ'));
  });
}

async function saveDocumentLocal() {
  if (!state.model) return;
  const validation = validateDocumentModel(state.model);
  if (!validation.valid) throw new Error(`Document Model ไม่สมบูรณ์: ${validation.errors.slice(0, 4).join(', ')}`);
  state.model.updatedAt = new Date().toISOString();
  const database = await openDb();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(DB_STORE, 'readwrite');
    transaction.objectStore(DB_STORE).put(cloneValue(state.model));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  state.dirty = false;
  const button = $('[data-studio-action="save"]');
  if (button) {
    const label = button.textContent;
    button.textContent = 'บันทึกแล้ว';
    setTimeout(() => { button.textContent = label; }, 1200);
  }
}

async function loadLatestDocument() {
  const database = await openDb();
  const documents = await new Promise((resolve, reject) => {
    const transaction = database.transaction(DB_STORE, 'readonly');
    const request = transaction.objectStore(DB_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  database.close();
  const latest = documents.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
  if (!latest) throw new Error('ยังไม่มีเอกสารที่บันทึกไว้ในเบราว์เซอร์นี้');
  openModel(latest);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.readAsDataURL(file);
  });
}

function imageInfo(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    image.onerror = () => reject(new Error('เปิดรูปภาพไม่สำเร็จ'));
    image.src = src;
  });
}

async function importImageFile(file, { onProgress = () => {} } = {}) {
  onProgress({ progress: .2, label: 'กำลังอ่านรูปภาพ' });
  const src = await fileToDataUrl(file);
  const size = await imageInfo(src);
  const scale = Math.min(1, 1400 / Math.max(size.width, size.height));
  const width = Math.max(320, Math.round(size.width * scale));
  const height = Math.max(240, Math.round(size.height * scale));
  const documentModel = createDocument({ name: file.name, sourceType: extensionOf(file) || 'image', metadata: { visualSource: true } });
  documentModel.pages.push(createPage({ number: 1, width, height, backgroundImage: src, metadata: { sourceWidth: size.width, sourceHeight: size.height } }));
  onProgress({ progress: 1, label: 'นำเข้ารูปภาพเสร็จแล้ว' });
  return normalizeDocumentModel(documentModel);
}

async function importPdfFile(file, { onProgress = () => {}, token } = {}) {
  const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const documentModel = createDocument({ name: file.name, sourceType: 'pdf', metadata: { visualSource: true, pageCount: pdf.numPages } });
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (token !== state.importToken) throw new Error('IMPORT_CANCELLED');
      const source = await pdf.getPage(pageNumber);
      const viewport = source.getViewport({ scale: 1.35 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      await source.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
      const backgroundImage = canvas.toDataURL('image/jpeg', .9);
      const textContent = await source.getTextContent().catch(() => ({ items: [] }));
      const blocks = [];
      for (const item of textContent.items || []) {
        if (!item.str?.trim()) continue;
        const x = Number(item.transform?.[4] || 0) * viewport.scale;
        const sourceY = Number(item.transform?.[5] || 0) * viewport.scale;
        const fontSize = Math.max(8, Math.abs(Number(item.transform?.[3] || 12)) * viewport.scale);
        const y = Math.max(0, viewport.height - sourceY - fontSize * 1.2);
        blocks.push(createTextBlock({
          x,
          y,
          width: Math.max(18, Number(item.width || item.str.length * fontSize * .55) * viewport.scale),
          height: fontSize * 1.45,
          text: item.str,
          style: { fontSize, backgroundColor: 'rgba(255,255,255,.78)', padding: 1 },
          source: 'pdf-text-layer',
          confidence: 1,
        }));
      }
      documentModel.pages.push(createPage({ number: pageNumber, width: viewport.width, height: viewport.height, backgroundImage, blocks, metadata: { textLayerBlocks: blocks.length } }));
      canvas.width = 1;
      canvas.height = 1;
      source.cleanup();
      onProgress({ progress: pageNumber / pdf.numPages, label: `นำเข้า PDF หน้า ${pageNumber}/${pdf.numPages}` });
      await nextFrame();
    }
  } finally {
    await pdf.destroy();
  }
  return normalizeDocumentModel(documentModel);
}

async function importAnyFile(file, options = {}) {
  const extension = extensionOf(file);
  if (isStructuredDocumentFile(file)) {
    if (['xlsx', 'xls'].includes(extension)) await ensureStudioLibraries({ xlsx: true });
    return importStructuredFile(file, options);
  }
  if (extension === 'pdf' || file.type === 'application/pdf') return importPdfFile(file, options);
  if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff'].includes(extension)) return importImageFile(file, options);
  throw new Error(`ยังไม่รองรับไฟล์ .${extension || 'unknown'}`);
}

async function importFiles(files) {
  const supported = [...files].filter(file => isStructuredDocumentFile(file) || file.type.startsWith('image/') || file.type === 'application/pdf' || ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff'].includes(extensionOf(file)));
  if (!supported.length) return showGlobalError('ไม่พบไฟล์ที่ Document Studio รองรับ');
  hideGlobalError();
  const token = ++state.importToken;
  showGlobalStatus('กำลังเตรียม Document Studio…', true);
  try {
    const models = [];
    for (let index = 0; index < supported.length; index += 1) {
      const file = supported[index];
      const model = await importAnyFile(file, {
        token,
        onProgress(message) {
          const percent = Math.round((index + Number(message.progress || 0)) / supported.length * 100);
          showGlobalStatus(`${message.label || 'กำลังนำเข้า'} · ${percent}%`, true);
          const studioProgress = $('#studioProgressText');
          if (studioProgress) studioProgress.textContent = `${message.label || 'กำลังนำเข้า'} · ${percent}%`;
        },
      });
      models.push(model);
      await nextFrame();
    }
    if (token !== state.importToken) return;
    const merged = models.length === 1 ? models[0] : mergeModels(models);
    openModel(merged);
  } catch (error) {
    if (error?.message !== 'IMPORT_CANCELLED') showGlobalError(error?.message || 'นำเข้าไฟล์ไม่สำเร็จ');
  } finally {
    showGlobalStatus('', false);
  }
}

function mergeModels(models) {
  const documentModel = createDocument({ name: `RipScan รวม ${models.length} ไฟล์`, sourceType: 'mixed', metadata: { sourceDocuments: models.map(model => model.name) } });
  for (const model of models) {
    for (const page of model.pages) documentModel.pages.push(createPage({ ...cloneValue(page), id: undefined, number: documentModel.pages.length + 1, name: `${model.name} · ${page.name}` }));
    documentModel.reviewIssues.push(...(model.reviewIssues || []));
  }
  return normalizeDocumentModel(documentModel);
}

function modelFromResultCard(card) {
  const name = $('.result-head h2', card)?.textContent?.trim() || 'OCR Document';
  const documentModel = createDocument({ name, sourceType: 'ocr-result', metadata: { reconstructedFromOcr: true } });
  const pageCards = $$('.page-card', card);
  pageCards.forEach((pageCard, pageIndex) => {
    const image = $('.page-preview', pageCard);
    const width = image?.naturalWidth || 794;
    const height = image?.naturalHeight || 1123;
    const scale = Math.min(1, 1200 / Math.max(width, height));
    const page = createPage({ number: pageIndex + 1, width: Math.max(320, width * scale), height: Math.max(420, height * scale), backgroundImage: image?.currentSrc || image?.src || '' });
    const structuredTable = $('.analysis-panel .detected-table', pageCard);
    if (structuredTable) {
      const occupancy = [];
      const cells = [];
      [...structuredTable.rows].forEach((row, rowIndex) => {
        occupancy[rowIndex] ||= [];
        let column = 0;
        [...row.cells].forEach(cell => {
          while (occupancy[rowIndex][column]) column += 1;
          const rowSpan = Math.max(1, Number(cell.rowSpan || 1));
          const columnSpan = Math.max(1, Number(cell.colSpan || 1));
          cells.push(createTableCell({ row: rowIndex, column, rowSpan, columnSpan, text: $('span', cell)?.textContent || cell.textContent || '', confidence: Number($('small', cell)?.textContent?.match(/[\d.]+/u)?.[0] || 100) / 100 }));
          for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
            occupancy[rowIndex + rowOffset] ||= [];
            for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) occupancy[rowIndex + rowOffset][column + columnOffset] = true;
          }
          column += columnSpan;
        });
      });
      const columns = Math.max(1, ...occupancy.map(row => row.length));
      page.blocks.push(createTableBlock({ rows: occupancy.length, columns, cells, x: page.width * .05, y: page.height * .08, width: page.width * .9, height: Math.min(page.height * .84, Math.max(120, occupancy.length * 40)), source: 'ocr-table', reviewStatus: 'review_required' }));
    } else {
      const bookResult = globalThis.__ripscanBookResults?.get?.(pageCard);
      const blocks = bookResult?.blocks || bookResult?.textBlocks || [];
      if (blocks.length) {
        for (const item of blocks) {
          if (!item.text || item.doNotEmitTokens) continue;
          const box = item.bbox || item.box || {};
          const normalized = box.x <= 1 && box.y <= 1 && box.width <= 1 && box.height <= 1;
          page.blocks.push(createTextBlock({
            x: normalized ? box.x * page.width : (box.x || box.left || page.width * .08),
            y: normalized ? box.y * page.height : (box.y || box.top || page.height * .08),
            width: normalized ? box.width * page.width : (box.width || page.width * .84),
            height: normalized ? box.height * page.height : (box.height || 52),
            text: item.text,
            style: { fontSize: Math.max(12, Number(item.estimatedFontSize) || 16), backgroundColor: 'rgba(255,255,255,.82)' },
            confidence: Number(item.confidence || 0),
            reviewStatus: item.status || 'review_required',
            source: 'ocr-layout-block',
          }));
        }
      } else {
        const text = $('.page-text', pageCard)?.value || '';
        if (text.trim()) page.blocks.push(createTextBlock({ x: page.width * .06, y: page.height * .06, width: page.width * .88, height: page.height * .88, text, style: { fontSize: 16, backgroundColor: 'rgba(255,255,255,.88)', padding: 12 }, reviewStatus: 'review_required', source: 'ocr-plain-text' }));
      }
    }
    documentModel.pages.push(page);
  });
  return normalizeDocumentModel(documentModel);
}

function openModel(model) {
  state.model = normalizeDocumentModel(model);
  if (!state.model.pages.length) state.model.pages.push(createPage({ number: 1 }));
  state.activePage = 0;
  state.selectedBlockId = state.model.pages[0].blocks[0]?.id || null;
  state.selectedCellIds.clear();
  state.zoom = 1;
  state.viewMode = 'visual';
  state.history = [];
  state.future = [];
  state.dirty = false;
  ensureShell();
  $('#documentStudio').hidden = false;
  document.body.classList.add('studio-open');
  renderStudio();
}

function closeStudio() {
  if (state.dirty && !confirm('มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการปิด Document Studio หรือไม่?')) return;
  $('#documentStudio').hidden = true;
  document.body.classList.remove('studio-open');
}

function ensureShell() {
  if ($('#documentStudio')) return;
  const shell = document.createElement('section');
  shell.id = 'documentStudio';
  shell.className = 'document-studio-shell';
  shell.hidden = true;
  shell.innerHTML = `
    <header class="studio-topbar">
      <div class="studio-title-group"><button type="button" data-studio-action="close" aria-label="ปิด">×</button><div><strong id="studioDocumentName">Document Studio</strong><small>Editable reconstruction · RipScan ${STUDIO_VERSION}</small></div></div>
      <div class="studio-toolbar">
        <button type="button" data-studio-action="import">นำเข้า</button>
        <button type="button" data-studio-action="save">บันทึก</button>
        <button type="button" data-studio-action="load-latest">เปิดล่าสุด</button>
        <span class="studio-toolbar-separator"></span>
        <button type="button" data-studio-action="undo" title="Undo">↶</button>
        <button type="button" data-studio-action="redo" title="Redo">↷</button>
        <button type="button" data-studio-action="add-text">+ ข้อความ</button>
        <button type="button" data-studio-action="add-table">+ ตาราง</button>
        <button type="button" data-studio-action="add-image">+ รูป</button>
        <button type="button" data-studio-action="add-page">+ หน้า</button>
        <span class="studio-toolbar-separator"></span>
        <button type="button" data-studio-view="visual" class="active">หน้าเอกสาร</button>
        <button type="button" data-studio-view="structure">โครงสร้าง</button>
        <label class="studio-zoom-control">ซูม <select id="studioZoom"><option value="0.5">50%</option><option value="0.75">75%</option><option value="1" selected>100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select></label>
        <button class="studio-primary" type="button" data-studio-action="convert">ส่งออก / แปลงไฟล์</button>
      </div>
    </header>
    <div class="studio-progress"><span id="studioProgressText">พร้อมแก้ไข</span><button type="button" data-studio-action="cancel-task" hidden>ยกเลิก</button></div>
    <div class="studio-layout">
      <aside class="studio-pages-panel"><div class="studio-panel-head"><strong>หน้าเอกสาร</strong><span id="studioPageCount"></span></div><div id="studioPageList" class="studio-page-list"></div></aside>
      <main class="studio-workspace"><div id="studioCanvasViewport" class="studio-canvas-viewport"></div><div id="studioStructureView" class="studio-structure-view" hidden></div></main>
      <aside class="studio-properties-panel"><div class="studio-panel-head"><strong>คุณสมบัติ</strong><span id="studioSelectionLabel">ยังไม่เลือก</span></div><div id="studioProperties"></div></aside>
    </div>
    <input id="studioFileInput" type="file" accept="${FILE_ACCEPT}" multiple hidden>
    <input id="studioImageInput" type="file" accept="image/*" hidden>
    <div id="studioExportStage" class="studio-export-stage" aria-hidden="true"></div>
  `;
  document.body.append(shell);
  installShellEvents(shell);
  ensureConvertCenter();
}

function installShellEvents(shell) {
  shell.addEventListener('click', handleStudioClick);
  shell.addEventListener('input', handleStudioInput);
  shell.addEventListener('change', handleStudioChange);
  shell.addEventListener('focusin', event => {
    if (event.target.matches('[contenteditable="true"]') && state.model) state.editingSnapshot = cloneValue(state.model);
  });
  shell.addEventListener('focusout', event => {
    if (!event.target.matches('[contenteditable="true"]') || !state.editingSnapshot || !state.model) return;
    const before = JSON.stringify(state.editingSnapshot);
    const after = JSON.stringify(state.model);
    if (before !== after) {
      state.history.push({ label: 'แก้ข้อความ', model: state.editingSnapshot, activePage: state.activePage, selectedBlockId: state.selectedBlockId });
      if (state.history.length > MAX_HISTORY) state.history.shift();
      state.future = [];
      state.dirty = true;
      updateHistoryButtons();
      scheduleAutosave();
    }
    state.editingSnapshot = null;
  });
  $('#studioFileInput', shell).addEventListener('change', event => { if (event.target.files?.length) importFiles(event.target.files); event.target.value = ''; });
  $('#studioImageInput', shell).addEventListener('change', async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !currentPage()) return;
    snapshot('เพิ่มรูป');
    const src = await fileToDataUrl(file);
    const info = await imageInfo(src);
    const width = Math.min(360, currentPage().width * .5, info.width);
    const height = width * info.height / Math.max(1, info.width);
    const block = createImageBlock({ x: 40, y: 40, width, height, src, alt: file.name, source: 'manual' });
    currentPage().blocks.push(block);
    state.selectedBlockId = block.id;
    renderStudio();
  });
}

function pageThumbnailHtml(page, index) {
  return `<button type="button" class="studio-page-thumb ${index === state.activePage ? 'active' : ''}" data-page-index="${index}"><span class="studio-thumb-sheet" style="aspect-ratio:${page.width}/${page.height};background:${escapeHtml(page.background || '#fff')}">${page.backgroundImage ? `<img src="${escapeHtml(page.backgroundImage)}" alt="">` : ''}<em>${page.blocks.length} blocks</em></span><strong>${escapeHtml(page.name || `หน้า ${index + 1}`)}</strong><small>${Math.round(page.width)}×${Math.round(page.height)}</small></button>`;
}

function blockPositionStyle(block) {
  return `left:${block.x}px;top:${block.y}px;width:${block.width}px;height:${block.height}px;z-index:${block.zIndex || 1};transform:rotate(${block.rotation || 0}deg);`;
}

function styleToCss(style = {}) {
  const unitless = new Set(['fontWeight', 'lineHeight', 'opacity', 'zIndex']);
  return Object.entries(style).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => {
    const property = key.replace(/[A-Z]/gu, character => `-${character.toLowerCase()}`);
    const rendered = typeof value === 'number' && !unitless.has(key) ? `${value}px` : value;
    return `${property}:${rendered}`;
  }).join(';');
}

function tableHtml(block, interactive = true) {
  const rows = Array.from({ length: block.rows }, (_, row) => {
    const cells = block.cells.filter(cell => !cell.hidden && cell.row === row).sort((a, b) => a.column - b.column).map(cell => {
      const selected = state.selectedCellIds.has(cell.id);
      const attributes = interactive && !cell.redacted ? `contenteditable="true" data-table-cell="${cell.id}" data-block-id="${block.id}"` : '';
      return `<td ${attributes} rowspan="${cell.rowSpan}" colspan="${cell.columnSpan}" class="${selected ? 'selected-cell' : ''} ${cell.redacted ? 'studio-redaction' : ''}" style="${styleToCss(cell.style)}">${cell.redacted ? '<span class="sr-only">ข้อมูลถูกปิดบัง</span>' : escapeHtml(cell.text).replace(/\n/gu, '<br>')}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  const columns = (block.columnWidths || []).map(width => `<col style="width:${width}px">`).join('');
  return `<table class="studio-editable-table" style="${styleToCss(block.style)}"><colgroup>${columns}</colgroup><tbody>${rows}</tbody></table>`;
}

function blockHtml(block, { exportMode = false } = {}) {
  const selected = !exportMode && block.id === state.selectedBlockId;
  const common = `data-block-id="${block.id}" class="studio-block studio-block-${block.type} ${selected ? 'selected' : ''} ${block.locked ? 'locked' : ''}" style="${blockPositionStyle(block)}${block.hidden ? 'display:none;' : ''}"`;
  const controls = exportMode ? '' : '<button type="button" class="studio-block-handle" aria-label="ลากย้าย">⋮⋮</button><span class="studio-resize-handle" aria-hidden="true"></span>';
  if (block.redacted) return `<div ${common}>${controls}<div class="studio-redaction" role="img" aria-label="ข้อมูลถูกปิดบังถาวรในผลส่งออก"></div></div>`;
  if (block.type === 'table') return `<div ${common}>${controls}${tableHtml(block, !exportMode)}</div>`;
  if (block.type === 'image') return `<div ${common}>${controls}<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt || '')}" style="width:100%;height:100%;object-fit:${block.fit || 'contain'};opacity:${block.opacity ?? 1};${styleToCss(block.style)}"></div>`;
  if (block.type === 'shape' || block.type === 'line') return `<div ${common}>${controls}<div class="studio-shape" style="width:100%;height:100%;background:${block.style?.fill || 'transparent'};border:${block.style?.strokeWidth || 1}px ${block.style?.dash || 'solid'} ${block.style?.stroke || '#111827'};border-radius:${block.style?.borderRadius || 0}px"></div></div>`;
  if (['field', 'checkbox', 'radio', 'signature', 'stamp', 'barcode', 'qr', 'label', 'value'].includes(block.type)) {
    const control = ['checkbox', 'radio'].includes(block.type) ? `<input type="${block.type}" ${block.checked ? 'checked' : ''} disabled>`
      : ['signature', 'stamp'].includes(block.type) && block.src ? `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt || block.type)}" style="max-width:100%;max-height:100%;object-fit:contain">`
        : escapeHtml(block.value || (['label', 'value'].includes(block.type) ? block.label : ''));
    return `<div ${common}>${controls}<div class="studio-field-content studio-${block.type}" contenteditable="${!exportMode && !['checkbox', 'radio', 'signature', 'stamp'].includes(block.type)}" data-field-content="${block.id}" style="${styleToCss(block.style)}"><strong>${escapeHtml(!['value'].includes(block.type) ? block.label : '')}</strong>${block.label && !['label', 'value'].includes(block.type) ? ': ' : ''}${control}</div></div>`;
  }
  return `<div ${common}>${controls}<div class="studio-text-content" contenteditable="${!exportMode}" data-text-content="${block.id}" style="${styleToCss(block.style)}">${escapeHtml(block.text).replace(/\n/gu, '<br>')}</div></div>`;
}

function renderPageElement(page, { exportMode = false } = {}) {
  return `<section class="studio-page-canvas ${exportMode ? 'export-page' : ''}" data-studio-page="${page.id}" style="width:${page.width}px;height:${page.height}px;background:${escapeHtml(page.background || '#fff')}">${page.backgroundImage ? `<img class="studio-page-background" src="${escapeHtml(page.backgroundImage)}" alt="">` : ''}${page.blocks.filter(block => !block.hidden).sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1)).map(block => blockHtml(block, { exportMode })).join('')}</section>`;
}

function renderStudio() {
  if (!state.model || !$('#documentStudio')) return;
  $('#studioDocumentName').textContent = state.model.name;
  $('#studioPageCount').textContent = `${state.model.pages.length} หน้า`;
  $('#studioPageList').innerHTML = state.model.pages.map(pageThumbnailHtml).join('');
  const page = currentPage();
  const viewport = $('#studioCanvasViewport');
  const structure = $('#studioStructureView');
  viewport.hidden = state.viewMode !== 'visual';
  structure.hidden = state.viewMode !== 'structure';
  if (page) {
    viewport.innerHTML = `<div class="studio-page-scale" style="width:${page.width * state.zoom}px;height:${page.height * state.zoom}px"><div class="studio-page-transform" style="transform:scale(${state.zoom});transform-origin:top left">${renderPageElement(page)}</div></div>`;
    structure.innerHTML = renderStructureView(page);
  }
  $$('[data-studio-view]').forEach(button => button.classList.toggle('active', button.dataset.studioView === state.viewMode));
  $('#studioZoom').value = String(state.zoom);
  renderProperties();
  updateHistoryButtons();
  installBlockPointerHandlers();
  document.dispatchEvent(new CustomEvent('ripscan:studio-model', { detail: { model: state.model, activePage: state.activePage, selectedBlockId: state.selectedBlockId } }));
}

async function saveVersionLocal(label = 'Named Version') {
  if (!state.model) return;
  const database = await openDb();
  const version = { id: `${state.model.id}:${Date.now()}`, documentId: state.model.id, label, createdAt: new Date().toISOString(), model: cloneValue(state.model) };
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(DB_VERSIONS, 'readwrite');
    transaction.objectStore(DB_VERSIONS).put(version);
    transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  return version;
}

async function listVersionsLocal() {
  if (!state.model) return [];
  const database = await openDb();
  const versions = await new Promise((resolve, reject) => {
    const request = database.transaction(DB_VERSIONS, 'readonly').objectStore(DB_VERSIONS).getAll();
    request.onsuccess = () => resolve(request.result || []); request.onerror = () => reject(request.error);
  });
  database.close();
  return versions.filter(version => version.documentId === state.model.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function deleteVersionLocal(id) {
  const database = await openDb();
  await new Promise((resolve, reject) => { const transaction = database.transaction(DB_VERSIONS, 'readwrite'); transaction.objectStore(DB_VERSIONS).delete(id); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
  database.close();
}

function renderStructureView(page) {
  const blocks = page.blocks.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  return `<div class="structure-page-head"><div><strong>${escapeHtml(page.name)}</strong><small>${page.blocks.length} blocks · ${Math.round(page.width)}×${Math.round(page.height)}</small></div><button type="button" data-studio-action="add-text">+ ข้อความ</button></div><div class="structure-block-list">${blocks.map((block, index) => `<button type="button" class="structure-block-item ${block.id === state.selectedBlockId ? 'active' : ''}" data-select-block="${block.id}"><span>${index + 1}</span><div><strong>${escapeHtml(block.type)}</strong><small>x ${Math.round(block.x)} · y ${Math.round(block.y)} · ${Math.round(block.width)}×${Math.round(block.height)}</small><p>${escapeHtml(block.type === 'table' ? `ตาราง ${block.rows}×${block.columns}` : block.type === 'image' ? block.alt || 'รูปภาพ' : ['field', 'checkbox', 'radio', 'signature', 'stamp', 'barcode', 'qr', 'label', 'value'].includes(block.type) ? `${block.label}: ${block.value}` : block.text || '').slice(0, 180)}</p></div><em>${escapeHtml(block.reviewStatus || 'verified')}</em></button>`).join('')}</div>`;
}

function propertyInput(label, field, value, type = 'number', extra = '') {
  return `<label>${label}<input type="${type}" data-property="${field}" value="${escapeHtml(value)}" ${extra}></label>`;
}

function renderProperties() {
  const panel = $('#studioProperties');
  const label = $('#studioSelectionLabel');
  const block = selectedBlock();
  if (!block) {
    label.textContent = 'ยังไม่เลือก';
    const page = currentPage();
    panel.innerHTML = page ? `<div class="property-section"><h3>ตั้งค่าหน้า</h3>${propertyInput('ความกว้าง', 'page.width', Math.round(page.width))}${propertyInput('ความสูง', 'page.height', Math.round(page.height))}<label>พื้นหลัง<input type="color" data-property="page.background" value="${/^#[0-9a-f]{6}$/iu.test(page.background) ? page.background : '#ffffff'}"></label><button type="button" data-studio-action="clear-background">ลบภาพพื้นหลัง</button></div>` : '<p>ยังไม่มีหน้าเอกสาร</p>';
    return;
  }
  label.textContent = `${block.type} · ${block.id.slice(-8)}`;
  const common = `<div class="property-grid">${propertyInput('X', 'x', Math.round(block.x))}${propertyInput('Y', 'y', Math.round(block.y))}${propertyInput('กว้าง', 'width', Math.round(block.width))}${propertyInput('สูง', 'height', Math.round(block.height))}${propertyInput('หมุน', 'rotation', Number(block.rotation || 0))}${propertyInput('ลำดับชั้น', 'zIndex', Number(block.zIndex || 1))}</div><label>สถานะตรวจ<select data-property="reviewStatus"><option value="verified">verified</option><option value="review_required">review_required</option><option value="possible_issue">possible_issue</option></select></label><label class="property-check"><input type="checkbox" data-property="locked" ${block.locked ? 'checked' : ''}> ล็อกตำแหน่ง</label>`;
  let specific = '';
  if (['text', 'header', 'footer'].includes(block.type)) {
    specific = `<div class="property-section"><h3>ตัวอักษร</h3>${propertyInput('ขนาด', 'style.fontSize', Number(block.style?.fontSize || 16))}<label>น้ำหนัก<select data-property="style.fontWeight"><option value="400">ปกติ</option><option value="600">กึ่งหนา</option><option value="700">หนา</option></select></label><label>จัดแนว<select data-property="style.textAlign"><option value="left">ซ้าย</option><option value="center">กลาง</option><option value="right">ขวา</option><option value="justify">กระจาย</option></select></label><label>สีตัวอักษร<input type="color" data-property="style.color" value="${/^#[0-9a-f]{6}$/iu.test(block.style?.color) ? block.style.color : '#111827'}"></label><label>สีพื้น<input type="color" data-property="style.backgroundColor" value="${/^#[0-9a-f]{6}$/iu.test(block.style?.backgroundColor) ? block.style.backgroundColor : '#ffffff'}"></label></div>`;
  }
  if (block.type === 'image') specific = `<div class="property-section"><h3>รูปภาพ</h3><label>การวาง<select data-property="fit"><option value="contain">พอดีกรอบ</option><option value="cover">เต็มกรอบ</option><option value="fill">ยืดเต็ม</option></select></label>${propertyInput('ความทึบ', 'opacity', Number(block.opacity ?? 1), 'number', 'min="0" max="1" step="0.05"')}<label>คำอธิบาย<input type="text" data-property="alt" value="${escapeHtml(block.alt || '')}"></label></div>`;
  if (block.type === 'table') {
    specific = `<div class="property-section"><h3>ตาราง ${block.rows}×${block.columns}</h3><p class="property-help">คลิก Cell เพื่อเลือก กด Ctrl/Shift เพื่อเลือกหลายช่อง แล้ว Merge</p><div class="table-property-actions"><button type="button" data-table-action="add-row">+ แถว</button><button type="button" data-table-action="delete-row">− แถว</button><button type="button" data-table-action="add-column">+ คอลัมน์</button><button type="button" data-table-action="delete-column">− คอลัมน์</button><button type="button" data-table-action="merge">Merge</button><button type="button" data-table-action="split">Split</button></div><label>พื้นหลัง Cell<input type="color" data-cell-property="backgroundColor" value="#ffffff"></label><label>จัดแนว Cell<select data-cell-property="textAlign"><option value="left">ซ้าย</option><option value="center">กลาง</option><option value="right">ขวา</option></select></label></div>`;
  }
  if (block.type === 'shape' || block.type === 'line') specific = `<div class="property-section"><h3>เส้นและกรอบ</h3><label>สีเส้น<input type="color" data-property="style.stroke" value="${block.style?.stroke || '#111827'}"></label>${propertyInput('ความหนา', 'style.strokeWidth', Number(block.style?.strokeWidth || 1))}<label>สีพื้น<input type="color" data-property="style.fill" value="${/^#[0-9a-f]{6}$/iu.test(block.style?.fill) ? block.style.fill : '#ffffff'}"></label></div>`;
  panel.innerHTML = `<div class="property-section"><h3>ตำแหน่งและขนาด</h3>${common}</div>${specific}<div class="property-danger"><button type="button" data-studio-action="duplicate-block">ทำสำเนา</button><button type="button" data-studio-action="delete-block">ลบ Block</button></div>`;
  const status = $('[data-property="reviewStatus"]', panel); if (status) status.value = block.reviewStatus || 'verified';
  const weight = $('[data-property="style.fontWeight"]', panel); if (weight) weight.value = String(block.style?.fontWeight || 400);
  const align = $('[data-property="style.textAlign"]', panel); if (align) align.value = block.style?.textAlign || 'left';
  const fit = $('[data-property="fit"]', panel); if (fit) fit.value = block.fit || 'contain';
}

function setNested(target, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let cursor = target;
  for (const key of keys) cursor = cursor[key] ||= {};
  cursor[last] = value;
}

function handleStudioInput(event) {
  const block = selectedBlock();
  if (event.target.matches('[data-text-content]') && block) {
    block.text = event.target.innerText.replace(/\n{3,}/gu, '\n\n');
    state.dirty = true;
    return;
  }
  if (event.target.matches('[data-field-content]') && ['field', 'barcode', 'qr', 'label', 'value'].includes(block?.type)) {
    const text = event.target.innerText;
    block.value = block.label && text.startsWith(block.label) ? text.slice(block.label.length).replace(/^:\s*/u, '') : text;
    state.dirty = true;
    return;
  }
  const cellElement = event.target.closest('[data-table-cell]');
  if (cellElement) {
    const table = findBlock(state.model, cellElement.dataset.blockId)?.block;
    const cell = table?.cells.find(item => item.id === cellElement.dataset.tableCell);
    if (cell) { cell.text = cellElement.innerText.replace(/\n{3,}/gu, '\n\n'); state.dirty = true; }
  }
}

function handleStudioChange(event) {
  if (event.target.id === 'studioZoom') {
    state.zoom = Number(event.target.value) || 1;
    renderStudio();
    return;
  }
  const property = event.target.dataset.property;
  if (property) {
    const page = currentPage();
    const block = selectedBlock();
    const target = property.startsWith('page.') ? page : block;
    if (!target) return;
    snapshot(`แก้ ${property}`);
    const path = property.replace(/^page\./u, '');
    let value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    if (event.target.type === 'number' || ['x', 'y', 'width', 'height', 'rotation', 'zIndex', 'opacity', 'style.fontSize', 'style.fontWeight', 'style.strokeWidth', 'page.width', 'page.height'].includes(property)) value = Number(value);
    setNested(target, path, value);
    renderStudio();
    return;
  }
  const cellProperty = event.target.dataset.cellProperty;
  if (cellProperty) {
    const block = selectedBlock();
    if (block?.type !== 'table' || !state.selectedCellIds.size) return;
    snapshot(`แก้ Cell ${cellProperty}`);
    for (const cell of block.cells.filter(item => state.selectedCellIds.has(item.id))) cell.style[cellProperty] = event.target.value;
    renderStudio();
  }
}

async function handleStudioClick(event) {
  const pageButton = event.target.closest('[data-page-index]');
  if (pageButton) {
    state.activePage = Number(pageButton.dataset.pageIndex);
    state.selectedBlockId = currentPage()?.blocks[0]?.id || null;
    state.selectedCellIds.clear();
    renderStudio();
    return;
  }
  const structureBlock = event.target.closest('[data-select-block]');
  if (structureBlock) {
    state.selectedBlockId = structureBlock.dataset.selectBlock;
    state.selectedCellIds.clear();
    renderStudio();
    return;
  }
  const cellElement = event.target.closest('[data-table-cell]');
  if (cellElement) {
    state.selectedBlockId = cellElement.dataset.blockId;
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      if (state.selectedCellIds.has(cellElement.dataset.tableCell)) state.selectedCellIds.delete(cellElement.dataset.tableCell);
      else state.selectedCellIds.add(cellElement.dataset.tableCell);
    } else {
      state.selectedCellIds.clear();
      state.selectedCellIds.add(cellElement.dataset.tableCell);
    }
    renderProperties();
    $$('.studio-editable-table td').forEach(cell => cell.classList.toggle('selected-cell', state.selectedCellIds.has(cell.dataset.tableCell)));
    return;
  }
  const blockElement = event.target.closest('.studio-block');
  if (blockElement && !event.target.closest('.studio-block-handle,.studio-resize-handle')) {
    state.selectedBlockId = blockElement.dataset.blockId;
    state.selectedCellIds.clear();
    $$('.studio-block').forEach(element => element.classList.toggle('selected', element.dataset.blockId === state.selectedBlockId));
    renderProperties();
  }
  const viewButton = event.target.closest('[data-studio-view]');
  if (viewButton) { state.viewMode = viewButton.dataset.studioView; renderStudio(); return; }
  const tableAction = event.target.closest('[data-table-action]')?.dataset.tableAction;
  if (tableAction) { handleTableAction(tableAction); return; }
  const action = event.target.closest('[data-studio-action]')?.dataset.studioAction;
  if (!action) return;
  try {
    if (action === 'close') return closeStudio();
    if (action === 'import') return $('#studioFileInput').click();
    if (action === 'save') { await saveDocumentLocal(); await saveVersionLocal('Manual Save'); return; }
    if (action === 'load-latest') return await loadLatestDocument();
    if (action === 'undo') return undo();
    if (action === 'redo') return redo();
    if (action === 'add-text') return addTextBlock();
    if (action === 'add-table') return addTableBlock();
    if (action === 'add-image') return $('#studioImageInput').click();
    if (action === 'add-page') return addPage();
    if (action === 'duplicate-block') return duplicateSelectedBlock();
    if (action === 'delete-block') return deleteSelectedBlock();
    if (action === 'clear-background') { snapshot('ลบภาพพื้นหลัง'); currentPage().backgroundImage = ''; renderStudio(); return; }
    if (action === 'convert') return openConvertCenter();
    if (action === 'cancel-task') { state.importToken += 1; state.exportToken += 1; event.target.hidden = true; $('#studioProgressText').textContent = 'ยกเลิกงานแล้ว'; return; }
  } catch (error) {
    showGlobalError(error?.message || 'ดำเนินการไม่สำเร็จ');
  }
}

function addTextBlock() {
  const page = currentPage(); if (!page) return;
  snapshot('เพิ่มข้อความ');
  const block = createTextBlock({ x: 60, y: 60, width: Math.min(420, page.width - 120), height: 72, text: 'คลิกเพื่อแก้ไขข้อความ', style: { fontSize: 20, backgroundColor: 'transparent' }, source: 'manual' });
  page.blocks.push(block); state.selectedBlockId = block.id; state.viewMode = 'visual'; renderStudio();
}

function addTableBlock() {
  const page = currentPage(); if (!page) return;
  snapshot('เพิ่มตาราง');
  const block = createTableBlock({ rows: 3, columns: 3, x: 60, y: 100, width: Math.min(600, page.width - 120), height: 150, source: 'manual' });
  page.blocks.push(block); state.selectedBlockId = block.id; state.selectedCellIds.clear(); state.viewMode = 'visual'; renderStudio();
}

function addPage() {
  if (!state.model) return;
  snapshot('เพิ่มหน้า');
  const previous = currentPage();
  state.model.pages.push(createPage({ number: state.model.pages.length + 1, width: previous?.width || 794, height: previous?.height || 1123 }));
  state.activePage = state.model.pages.length - 1; state.selectedBlockId = null; renderStudio();
}

function duplicateSelectedBlock() {
  const page = currentPage(); const block = selectedBlock(); if (!page || !block) return;
  snapshot('ทำสำเนา Block');
  const copy = cloneValue(block); copy.id = `${block.type}-${crypto.randomUUID?.() || Date.now()}`; copy.x += 18; copy.y += 18;
  if (copy.type === 'table') copy.cells.forEach(cell => { cell.id = `cell-${crypto.randomUUID?.() || Math.random()}`; });
  page.blocks.push(copy); state.selectedBlockId = copy.id; renderStudio();
}

function deleteSelectedBlock() {
  const page = currentPage(); if (!page || !state.selectedBlockId) return;
  snapshot('ลบ Block');
  page.blocks = page.blocks.filter(block => block.id !== state.selectedBlockId);
  state.selectedBlockId = page.blocks[0]?.id || null; state.selectedCellIds.clear(); renderStudio();
}

function selectedTableCoordinates(table) {
  return table.cells.filter(cell => state.selectedCellIds.has(cell.id)).map(cell => ({ row: cell.row, column: cell.column }));
}

function handleTableAction(action) {
  const table = selectedBlock();
  if (table?.type !== 'table') return;
  snapshot(`แก้ตาราง ${action}`);
  const selectedCells = table.cells.filter(cell => state.selectedCellIds.has(cell.id));
  const row = selectedCells[0]?.row ?? table.rows - 1;
  const column = selectedCells[0]?.column ?? table.columns - 1;
  if (action === 'add-row') addTableRow(table, row + 1);
  if (action === 'delete-row') deleteTableRow(table, row);
  if (action === 'add-column') addTableColumn(table, column + 1);
  if (action === 'delete-column') deleteTableColumn(table, column);
  if (action === 'merge') {
    const result = mergeTableCells(table, selectedTableCoordinates(table));
    if (!result.merged) showGlobalError(result.reason === 'selection_must_be_rectangle' ? 'ต้องเลือก Cell เป็นพื้นที่สี่เหลี่ยมต่อเนื่อง' : 'เลือกอย่างน้อย 2 Cell ก่อน Merge');
    else { state.selectedCellIds.clear(); state.selectedCellIds.add(result.anchor.id); }
  }
  if (action === 'split') {
    const cellId = [...state.selectedCellIds][0];
    const result = splitTableCell(table, cellId);
    if (!result.split) showGlobalError('Cell ที่เลือกยังไม่ได้ Merge');
  }
  renderStudio();
}

function installBlockPointerHandlers() {
  const pageElement = $('.studio-page-canvas:not(.export-page)');
  if (!pageElement) return;
  pageElement.querySelectorAll('.studio-block-handle').forEach(handle => {
    handle.addEventListener('pointerdown', event => startBlockPointer(event, 'move'));
  });
  pageElement.querySelectorAll('.studio-resize-handle').forEach(handle => {
    handle.addEventListener('pointerdown', event => startBlockPointer(event, 'resize'));
  });
}

function startBlockPointer(event, mode) {
  event.preventDefault(); event.stopPropagation();
  const element = event.target.closest('.studio-block');
  const block = findBlock(state.model, element?.dataset.blockId)?.block;
  if (!element || !block || block.locked) return;
  snapshot(mode === 'move' ? 'ย้าย Block' : 'ปรับขนาด Block');
  state.selectedBlockId = block.id;
  const start = { x: event.clientX, y: event.clientY, blockX: block.x, blockY: block.y, width: block.width, height: block.height };
  event.target.setPointerCapture?.(event.pointerId);
  const move = moveEvent => {
    const dx = (moveEvent.clientX - start.x) / state.zoom;
    const dy = (moveEvent.clientY - start.y) / state.zoom;
    if (mode === 'move') { block.x = Math.max(0, start.blockX + dx); block.y = Math.max(0, start.blockY + dy); }
    else { block.width = Math.max(24, start.width + dx); block.height = Math.max(20, start.height + dy); }
    element.style.left = `${block.x}px`; element.style.top = `${block.y}px`; element.style.width = `${block.width}px`; element.style.height = `${block.height}px`;
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); state.dirty = true; renderProperties(); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up, { once: true });
}

function ensureConvertCenter() {
  if ($('#convertCenter')) return;
  const dialog = document.createElement('section');
  dialog.id = 'convertCenter';
  dialog.className = 'convert-center-shell';
  dialog.hidden = true;
  dialog.innerHTML = `
    <div class="convert-center-card">
      <header><div><strong>Convert Center</strong><small>PDF · Searchable PDF · JPG · PNG · DOCX · XLSX</small></div><button type="button" data-convert-action="close">×</button></header>
      <div class="convert-grid">
        <section><h3>เอกสารต้นทาง</h3><div class="convert-source"><strong id="convertSourceName">ยังไม่มีเอกสาร</strong><span id="convertSourceInfo">นำเข้าไฟล์หรือเปิดจาก Editor</span><button type="button" data-convert-action="import">เลือกไฟล์ใหม่</button></div><div id="convertPageSelection" class="convert-page-selection"></div></section>
        <section><h3>รูปแบบผลลัพธ์</h3><label>แปลงเป็น<select id="convertFormat"><option value="pdf">PDF แบบภาพ</option><option value="searchable-pdf">Searchable PDF ดาวน์โหลดตรง</option><option value="png">PNG</option><option value="jpg">JPG</option><option value="docx">DOCX</option><option value="xlsx">XLSX</option><option value="txt">TXT</option><option value="json">JSON Structured</option></select></label><label class="property-check"><input id="convertIncludeReview" type="checkbox"> รวมข้อความที่ยังต้องตรวจใน Text Layer</label><label>ขนาดหน้า<select id="convertPageSize"><option value="source">ตามต้นฉบับ</option><option value="A4">A4</option><option value="A5">A5</option><option value="Letter">Letter</option><option value="Legal">Legal</option><option value="custom">กำหนดเอง</option></select></label><label>แนวกระดาษ<select id="convertOrientation"><option value="portrait">แนวตั้ง</option><option value="landscape">แนวนอน</option></select></label></section>
        <section><h3>ขนาดและคุณภาพ</h3><div class="convert-size-grid"><label>กว้าง<input id="convertWidth" type="number" min="1" placeholder="ตามต้นฉบับ"></label><label>สูง<input id="convertHeight" type="number" min="1" placeholder="ตามต้นฉบับ"></label><label>Scale %<input id="convertScale" type="number" min="10" max="800" value="100"></label><label>DPI<input id="convertDpi" type="number" min="72" max="600" value="144"></label></div><label class="property-check"><input id="convertKeepAspect" type="checkbox" checked> รักษาสัดส่วน</label><label>Fit<select id="convertFit"><option value="contain">พอดีพื้นที่</option><option value="cover">เต็มพื้นที่</option></select></label><label>คุณภาพ <output id="convertQualityValue">92%</output><input id="convertQuality" type="range" min="10" max="100" value="92"></label><label>พื้นหลัง<input id="convertBackground" type="color" value="#ffffff"></label><label class="property-check"><input id="convertTransparent" type="checkbox"> พื้นหลังโปร่งใส (PNG)</label></section>
      </div>
      <div class="convert-progress"><progress id="convertProgress" max="100" value="0"></progress><span id="convertProgressText">พร้อมแปลงไฟล์</span></div>
      <footer><button type="button" data-convert-action="cancel" disabled>ยกเลิก</button><button class="studio-primary" type="button" data-convert-action="export">เริ่มแปลงไฟล์</button></footer>
    </div>`;
  document.body.append(dialog);
  dialog.addEventListener('click', handleConvertClick);
  $('#convertQuality', dialog).addEventListener('input', event => { $('#convertQualityValue', dialog).textContent = `${event.target.value}%`; });
  $('#convertPageSize', dialog).addEventListener('change', updateConvertPreset);
  $('#convertOrientation', dialog).addEventListener('change', updateConvertPreset);
}

function openConvertCenter() {
  if (!state.model) throw new Error('กรุณาเปิดเอกสารใน Editor ก่อน');
  const dialog = $('#convertCenter');
  dialog.hidden = false;
  $('#convertSourceName').textContent = state.model.name;
  $('#convertSourceInfo').textContent = `${state.model.pages.length} หน้า · ${state.model.sourceType}`;
  $('#convertPageSelection').innerHTML = state.model.pages.map((page, index) => `<label><input type="checkbox" data-convert-page="${index}" checked><span>${escapeHtml(page.name || `หน้า ${index + 1}`)}</span><small>${Math.round(page.width)}×${Math.round(page.height)}</small></label>`).join('');
  updateConvertPreset();
}

function updateConvertPreset() {
  const size = $('#convertPageSize')?.value;
  const orientation = $('#convertOrientation')?.value;
  const presets = { A4: [794, 1123], A5: [559, 794], Letter: [816, 1056], Legal: [816, 1344] };
  if (!presets[size]) { if (size === 'source') { $('#convertWidth').value = ''; $('#convertHeight').value = ''; } return; }
  let [width, height] = presets[size];
  if (orientation === 'landscape') [width, height] = [height, width];
  $('#convertWidth').value = width;
  $('#convertHeight').value = height;
}

async function handleConvertClick(event) {
  const action = event.target.closest('[data-convert-action]')?.dataset.convertAction;
  if (!action) return;
  if (action === 'close') { $('#convertCenter').hidden = true; return; }
  if (action === 'import') { $('#studioFileInput').click(); $('#convertCenter').hidden = true; return; }
  if (action === 'cancel') { state.exportToken += 1; event.target.disabled = true; $('#convertProgressText').textContent = 'ยกเลิกงานแล้ว'; return; }
  if (action === 'export') {
    try { await runConversion(); }
    catch (error) { showGlobalError(error?.message || 'แปลงไฟล์ไม่สำเร็จ'); $('#convertProgressText').textContent = error?.message || 'แปลงไฟล์ไม่สำเร็จ'; }
  }
}

function conversionOptions() {
  const selectedPages = $$('[data-convert-page]:checked').map(input => Number(input.dataset.convertPage));
  return normalizeExportOptions({
    format: $('#convertFormat').value,
    pageSize: $('#convertPageSize').value,
    orientation: $('#convertOrientation').value,
    width: Number($('#convertWidth').value) || 0,
    height: Number($('#convertHeight').value) || 0,
    scale: Number($('#convertScale').value || 100) / 100,
    dpi: Number($('#convertDpi').value || 144),
    quality: Number($('#convertQuality').value || 92) / 100,
    keepAspect: $('#convertKeepAspect').checked,
    fit: $('#convertFit').value,
    background: $('#convertBackground').value,
    transparent: $('#convertTransparent').checked,
    selectedPages,
    includeReviewRequired: $('#convertIncludeReview').checked,
  });
}

function renderExportPages() {
  const stage = $('#studioExportStage');
  stage.innerHTML = state.model.pages.map(page => renderPageElement(page, { exportMode: true })).join('');
  return $$('.export-page', stage);
}

async function runConversion() {
  if (!state.model) throw new Error('ไม่พบเอกสารต้นทาง');
  const options = conversionOptions();
  if (!options.selectedPages.length) throw new Error('กรุณาเลือกอย่างน้อย 1 หน้า');
  const token = ++state.exportToken;
  const exportButton = $('[data-convert-action="export"]');
  const cancelButton = $('[data-convert-action="cancel"]');
  exportButton.disabled = true; cancelButton.disabled = false;
  $('#convertProgress').value = 0;
  $('#convertProgressText').textContent = 'กำลังเตรียมหน้าเอกสาร…';
  try {
    const elements = renderExportPages();
    await nextFrame();
    await exportPageElements(elements, state.model.pages, { ...options, documentModel: state.model }, state.model.name, message => {
      if (token !== state.exportToken) throw new Error('EXPORT_CANCELLED');
      const percent = Math.round((message.completed || 0) / Math.max(1, message.total || 1) * 100);
      $('#convertProgress').value = percent;
      $('#convertProgressText').textContent = `${message.label || 'กำลังแปลง'} · ${percent}%`;
    });
    if (token === state.exportToken) { $('#convertProgress').value = 100; $('#convertProgressText').textContent = 'แปลงไฟล์เสร็จแล้ว'; }
  } catch (error) {
    if (error?.message !== 'EXPORT_CANCELLED') throw error;
  } finally {
    exportButton.disabled = false; cancelButton.disabled = true;
    $('#studioExportStage').innerHTML = '';
  }
}

function installEntryPoints() {
  const headerActions = $('.header-actions');
  if (headerActions && !$('#documentStudioButton')) {
    const studioButton = document.createElement('button');
    studioButton.id = 'documentStudioButton';
    studioButton.className = 'studio-entry-button';
    studioButton.type = 'button';
    studioButton.textContent = 'Document Studio';
    studioButton.addEventListener('click', () => {
      ensureShell();
      if (state.model) openModel(state.model);
      else $('#studioFileInput').click();
    });
    const convertButton = document.createElement('button');
    convertButton.id = 'convertCenterButton';
    convertButton.className = 'studio-entry-button';
    convertButton.type = 'button';
    convertButton.textContent = 'แปลงไฟล์';
    convertButton.addEventListener('click', () => {
      ensureShell();
      if (state.model) openConvertCenter();
      else $('#studioFileInput').click();
    });
    headerActions.prepend(convertButton);
    headerActions.prepend(studioButton);

    const mobileNav = document.createElement('nav');
    mobileNav.id = 'mobileWorkflowNav';
    mobileNav.className = 'mobile-workflow-nav';
    mobileNav.setAttribute('aria-label', 'ขั้นตอนทำงาน');
    mobileNav.innerHTML = '<button type="button" data-mobile-action="studio">Studio</button><button type="button" data-mobile-action="convert">Convert</button>';
    mobileNav.addEventListener('click', event => {
      const action = event.target.dataset.mobileAction;
      if (action === 'studio') studioButton.click();
      if (action === 'convert') convertButton.click();
    });
    document.body.append(mobileNav);
  }
  const mainInput = $('#fileInput');
  if (mainInput) mainInput.accept = FILE_ACCEPT;
  const uploadHint = $('#dropzone p');
  if (uploadHint) uploadHint.textContent = 'รองรับ PDF, รูปภาพ, Word, Excel, PowerPoint, TXT, CSV, HTML และ RTF';

  document.addEventListener('change', event => {
    if (event.target.id !== 'fileInput') return;
    const files = [...(event.target.files || [])];
    const structured = files.filter(isStructuredDocumentFile);
    if (!structured.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    importFiles(structured);
    event.target.value = '';
  }, true);

  const results = $('#results');
  if (results) {
    const scan = () => $$('.result-card', results).forEach(card => {
      if (card.dataset.studioReady) return;
      card.dataset.studioReady = 'true';
      const actions = $('.result-head', card);
      if (!actions) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'open-studio-result';
      button.textContent = 'เปิดแก้ไขแบบต้นฉบับ';
      button.addEventListener('click', () => openModel(modelFromResultCard(card)));
      actions.append(button);
    });
    new MutationObserver(scan).observe(results, { childList: true, subtree: true });
    scan();
  }
}

document.addEventListener('ripscan:replace-model', event => {
  if (!event.detail?.model) return;
  snapshot(event.detail.label || 'แก้จาก Quality Center');
  state.model = normalizeDocumentModel(event.detail.model);
  state.selectedBlockId = event.detail.blockId || state.selectedBlockId;
  state.activePage = Math.max(0, Math.min(Number(event.detail.pageIndex ?? state.activePage), state.model.pages.length - 1));
  renderStudio();
});

document.addEventListener('ripscan:select-block', event => {
  if (!state.model || !event.detail?.blockId) return;
  state.activePage = Math.max(0, Math.min(Number(event.detail.pageIndex || 0), state.model.pages.length - 1));
  state.selectedBlockId = event.detail.blockId;
  state.viewMode = 'visual';
  renderStudio();
});

globalThis.RipScanStudioVersions = {
  list: listVersionsLocal,
  save: saveVersionLocal,
  remove: deleteVersionLocal,
  restore(version) { if (!version?.model) throw new Error('Version ไม่สมบูรณ์'); openModel(version.model); },
};

window.addEventListener('keydown', event => {
  if ($('#documentStudio')?.hidden !== false) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveDocumentLocal().catch(error => showGlobalError(error.message)); }
  if (event.key === 'Delete' && !event.target.matches('input,textarea,[contenteditable="true"]')) deleteSelectedBlock();
  if (event.key === 'Escape' && $('#convertCenter')?.hidden === false) $('#convertCenter').hidden = true;
});

ensureShell();
installEntryPoints();
document.documentElement.dataset.documentStudioVersion = STUDIO_VERSION;
globalThis.RipScanDocumentStudio = {
  openModel,
  importFiles,
  getModel: () => state.model,
  exportPlainText: () => state.model ? documentToPlainText(state.model) : '',
};
