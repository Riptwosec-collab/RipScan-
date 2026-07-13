import {
  TABLE_RECONSTRUCTION_VERSION,
  CELL_OCR_VARIANTS,
  applyHeaderColumnTypes,
  buildTableStructure,
  crossCellContamination,
  emptyCellAssessment,
  gibberishAssessment,
  selectCellCandidate,
  strictFieldAssessment,
  tableProgress,
  tableToDocumentBlockSpec,
  updateCellText,
  workerConcurrency,
} from './table-reconstruction-core.mjs';
import {
  createDocument,
  createPage,
  createTableBlock,
  createTextBlock,
  normalizeDocumentModel,
} from './document-model.mjs';

const VERSION = TABLE_RECONSTRUCTION_VERSION;
const results = document.querySelector('#results');
const pageStates = new WeakMap();
const scheduled = new WeakSet();
let sequence = 0;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

class TableWorkerClient {
  constructor() {
    this.worker = new Worker('/table-reconstruction-worker.js');
    this.pending = new Map();
    this.worker.addEventListener('message', event => {
      const message = event.data || {};
      const entry = this.pending.get(message.jobId);
      if (!entry) return;
      this.pending.delete(message.jobId);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(message.error || 'TABLE_WORKER_FAILED'));
    });
  }
  run(type, payload, timeoutMs = 30000) {
    const jobId = `table-${Date.now()}-${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(jobId);
        this.worker.postMessage({ type: 'cancel', jobId });
        reject(new Error('TABLE_WORKER_TIMEOUT'));
      }, timeoutMs);
      this.pending.set(jobId, {
        resolve: result => { clearTimeout(timer); resolve(result); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      this.worker.postMessage({ type, jobId, payload });
    });
  }
  cancel(jobId) { this.worker.postMessage({ type: 'cancel', jobId }); }
  dispose() { this.worker.postMessage({ type: 'dispose' }); this.worker.terminate(); this.pending.clear(); }
}

class CellOcrPool {
  constructor(onProgress = () => {}) {
    this.onProgress = onProgress;
    this.workers = [];
    this.waiters = [];
    this.disposed = false;
  }
  async init() {
    if (!globalThis.Tesseract?.createWorker) throw new Error('โหลดระบบ OCR ไม่สำเร็จ');
    const mobile = matchMedia('(pointer: coarse)').matches || innerWidth <= 720;
    const count = workerConcurrency({ mobile, hardwareConcurrency: navigator.hardwareConcurrency || 4 });
    for (let index = 0; index < count; index += 1) {
      const worker = await globalThis.Tesseract.createWorker(['tha', 'eng'], 1, {
        logger: message => this.onProgress({ ...message, worker: index + 1 }),
      });
      await worker.setParameters?.({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '6' });
      this.workers.push({ worker, busy: false, index });
    }
    return this;
  }
  async acquire() {
    const available = this.workers.find(item => !item.busy);
    if (available) { available.busy = true; return available; }
    return new Promise(resolve => this.waiters.push(resolve));
  }
  release(item) {
    if (this.disposed || !item) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else item.busy = false;
  }
  async recognize(blob, context = {}) {
    const item = await this.acquire();
    if (!item) throw new Error('TABLE_OCR_CANCELLED');
    try {
      const result = await item.worker.recognize(blob, {}, { text: true, blocks: true, hocr: false, tsv: false });
      const data = result?.data || {};
      return {
        text: String(data.text || '').trim(),
        confidence: Math.max(0, Math.min(1, Number(data.confidence || 0) / 100)),
        words: (data.words || []).map(word => ({ text: word.text, confidence: Number(word.confidence || 0) / 100, x: word.bbox?.x0 || 0, y: word.bbox?.y0 || 0, width: (word.bbox?.x1 || 0) - (word.bbox?.x0 || 0), height: (word.bbox?.y1 || 0) - (word.bbox?.y0 || 0) })),
        variant: context.variant,
      };
    } finally {
      this.release(item);
    }
  }
  async terminate() {
    this.disposed = true;
    await Promise.allSettled(this.workers.map(item => item.worker.terminate()));
    this.workers = [];
    this.waiters.splice(0).forEach(resolve => resolve(null));
  }
}

function imageReady(image) {
  if (image.complete && image.naturalWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', reject, { once: true });
  });
}

async function sourceBlob(image) {
  await imageReady(image);
  const response = await fetch(image.currentSrc || image.src);
  if (!response.ok) throw new Error('โหลดภาพตารางไม่สำเร็จ');
  return response.blob();
}

function lineSupport(segments, position, total, tolerance = 5) {
  return segments.filter(segment => Math.abs(segment.position - position) <= tolerance)
    .reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0) / Math.max(1, total);
}

function selectTableEvidence(detection) {
  const verticalLines = detection.verticalLines.filter(position => lineSupport(detection.verticalSegments, position, detection.height) >= .28);
  const horizontalLines = detection.horizontalLines.filter(position => lineSupport(detection.horizontalSegments, position, detection.width) >= .12);
  const v = verticalLines.length >= 3 ? verticalLines : detection.verticalLines;
  const h = horizontalLines.length >= 3 ? horizontalLines : detection.horizontalLines;
  return { ...detection, verticalLines: v, horizontalLines: h };
}

function extractExistingCells(pageCard) {
  const table = $('.analysis-panel .detected-table', pageCard);
  if (!table) return [];
  const occupancy = [];
  const records = [];
  [...table.rows].forEach((row, rowIndex) => {
    occupancy[rowIndex] ||= [];
    let columnIndex = 0;
    [...row.cells].forEach(cell => {
      while (occupancy[rowIndex][columnIndex]) columnIndex += 1;
      const rowSpan = Math.max(1, Number(cell.rowSpan || 1));
      const columnSpan = Math.max(1, Number(cell.colSpan || 1));
      const confidenceText = $('small', cell)?.textContent?.match(/[\d.]+/u)?.[0];
      records.push({
        rowIndex,
        columnIndex,
        rowSpan,
        columnSpan,
        text: $('span', cell)?.textContent || cell.textContent || '',
        confidence: confidenceText ? Number(confidenceText) / 100 : .72,
      });
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        occupancy[rowIndex + rowOffset] ||= [];
        for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) occupancy[rowIndex + rowOffset][columnIndex + columnOffset] = true;
      }
      columnIndex += columnSpan;
    });
  });
  return records;
}

function overlapScore(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  const area = Math.max(0, right - left) * Math.max(0, bottom - top);
  return area / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

function hydrateFromExistingTable(table, pageCard) {
  const existing = extractExistingCells(pageCard);
  if (!existing.length) return;
  for (const cell of table.cells) {
    const record = existing.find(item => item.rowIndex === cell.rowIndex && item.columnIndex === cell.columnIndex)
      || existing.find(item => item.rowIndex <= cell.rowIndex && item.rowIndex + item.rowSpan > cell.rowIndex && item.columnIndex <= cell.columnIndex && item.columnIndex + item.columnSpan > cell.columnIndex);
    if (!record) continue;
    updateCellText(cell, {
      text: record.text,
      confidence: record.confidence,
      status: record.confidence >= .88 ? 'verified' : 'review_required',
      candidates: [{ text: record.text, confidence: record.confidence, variant: 'existing-cell-ocr', providerAgreement: 1 }],
    });
  }
  applyHeaderColumnTypes(table);
}

function statusClass(status) { return `cell-status-${String(status || 'review_required').replace(/_/gu, '-')}`; }

function tableHtml(table, selectedCellId = '') {
  const columns = table.columnWidths.map(width => `<col style="width:${Math.max(24, width)}px">`).join('');
  const rows = Array.from({ length: table.rowCount }, (_, rowIndex) => {
    const cells = table.cells.filter(cell => cell.rowIndex === rowIndex).sort((a, b) => a.columnIndex - b.columnIndex).map(cell => `
      <td contenteditable="true" spellcheck="false" data-review-cell="${cell.cellId}" rowspan="${cell.rowSpan}" colspan="${cell.columnSpan}" class="${statusClass(cell.status)} ${selectedCellId === cell.cellId ? 'selected' : ''}" style="text-align:${cell.alignment};vertical-align:${cell.verticalAlignment};background:${cell.fillColor};font-size:${cell.fontSize}px;font-weight:${cell.fontWeight}">${escapeHtml(cell.textWithLineBreaks || cell.text).replace(/\n/gu, '<br>')}</td>`).join('');
    return `<tr style="height:${Math.max(22, table.rowHeights[rowIndex] || 38)}px">${cells}</tr>`;
  }).join('');
  return `<table class="table-review-editable"><colgroup>${columns}</colgroup><tbody>${rows}</tbody></table>`;
}

function overlayHtml(table, selectedCellId = '') {
  const cells = table.cells.map(cell => `<rect data-overlay-cell="${cell.cellId}" x="${cell.boundingBox.left}" y="${cell.boundingBox.top}" width="${cell.boundingBox.width}" height="${cell.boundingBox.height}" class="${statusClass(cell.status)} ${selectedCellId === cell.cellId ? 'selected' : ''}"><title>${escapeHtml(cell.text || `${cell.rowIndex + 1}:${cell.columnIndex + 1}`)}</title></rect>`).join('');
  const vertical = table.verticalLines.map((x, index) => `<line class="grid-line vertical" data-grid-axis="vertical" data-grid-index="${index}" x1="${x}" x2="${x}" y1="${table.bounds.top}" y2="${table.bounds.bottom}"></line>`).join('');
  const horizontal = table.horizontalLines.map((y, index) => `<line class="grid-line horizontal" data-grid-axis="horizontal" data-grid-index="${index}" x1="${table.bounds.left}" x2="${table.bounds.right}" y1="${y}" y2="${y}"></line>`).join('');
  return `${cells}${vertical}${horizontal}`;
}

function issueListHtml(table) {
  const issues = table.cells.filter(cell => !['verified', 'empty'].includes(cell.status));
  if (!issues.length) return '<p class="table-no-issues">ทุก Cell ผ่านการตรวจ</p>';
  return issues.map(cell => `<button type="button" data-select-review-cell="${cell.cellId}" class="table-issue ${statusClass(cell.status)}"><strong>แถว ${cell.rowIndex + 1} · คอลัมน์ ${cell.columnIndex + 1}</strong><span>${escapeHtml(cell.text || 'ยังไม่อ่านข้อความ')}</span><small>${cell.status} · ${Math.round(cell.confidence * 100)}%</small></button>`).join('');
}

function cellDetailHtml(state) {
  const cell = state.table.cells.find(item => item.cellId === state.selectedCellId) || state.table.cells[0];
  if (!cell) return '<p>ยังไม่มี Cell</p>';
  const candidates = (cell.candidates || []).slice(0, 6).map(candidate => `<li><strong>${escapeHtml(candidate.variant || 'OCR')}</strong><span>${escapeHtml(candidate.text || '')}</span><em>${Math.round(Number(candidate.confidence || 0) * 100)}%</em></li>`).join('');
  return `<div class="table-cell-detail" data-detail-cell="${cell.cellId}">
    <div class="table-cell-detail-head"><div><strong>Cell ${cell.rowIndex + 1}:${cell.columnIndex + 1}</strong><small>${cell.columnType} · ${cell.status}</small></div><button type="button" data-table-review-action="ocr-cell">OCR ใหม่เฉพาะ Cell</button></div>
    ${cell.cropUrl ? `<div class="table-cell-crops"><img src="${escapeHtml(cell.cropUrl)}" alt="Cell ต้นฉบับ"><img src="${escapeHtml(cell.enhancedUrl || cell.cropUrl)}" alt="Cell ขยาย"></div>` : ''}
    <label>ข้อความ<textarea data-cell-detail-text="${cell.cellId}">${escapeHtml(cell.textWithLineBreaks || cell.text)}</textarea></label>
    <div class="table-cell-meta"><label>สถานะ<select data-cell-status="${cell.cellId}">${['verified','review_required','possible_text','contaminated','structure_conflict','empty','possibly_empty'].map(status => `<option value="${status}" ${cell.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><label>Confidence<input type="number" min="0" max="100" value="${Math.round(cell.confidence * 100)}" data-cell-confidence="${cell.cellId}"></label></div>
    <ul class="table-candidate-list">${candidates || '<li>ยังไม่มี Candidate</li>'}</ul>
  </div>`;
}

function progressText(table, active = '') {
  const progress = tableProgress(table);
  return `พบตาราง 1 ตาราง · ${progress.columns} คอลัมน์ · ${progress.rows} แถว · ${progress.cells} เซลล์ · OCR สำเร็จ ${progress.completed} เซลล์ · ต้องตรวจ ${progress.review} เซลล์${active ? ` · ${active}` : ''}`;
}

function ensureReviewPanel(pageCard, state) {
  let panel = $('.table-review-v31', pageCard);
  if (!panel) {
    panel = document.createElement('section');
    panel.className = 'table-review-v31';
    const textarea = $('textarea.page-text', pageCard);
    textarea?.insertAdjacentElement('afterend', panel);
    if (textarea) { textarea.hidden = true; textarea.dataset.replacedByEditableTable = 'true'; }
  }
  state.panel = panel;
  renderReview(pageCard, state);
  return panel;
}

function renderReview(pageCard, state) {
  const panel = state.panel;
  if (!panel) return;
  const image = $('.page-preview', pageCard);
  const table = state.table;
  panel.innerHTML = `
    <header class="table-review-head"><div><strong>ตรวจสอบตาราง · Table-first ${VERSION}</strong><small data-table-progress>${progressText(table, state.busyLabel)}</small></div><div class="table-review-actions"><button type="button" data-table-review-action="ocr-all">อ่านทุก Cell</button><button type="button" data-table-review-action="open-studio" class="primary">เปิดแก้ไขใน Document Studio</button><button type="button" data-table-review-action="cancel" ${state.busy ? '' : 'hidden'}>ยกเลิก</button></div></header>
    <div class="table-review-toolbar">
      <button type="button" data-grid-mode="select" class="${state.gridMode === 'select' ? 'active' : ''}">เลือก Cell</button>
      <button type="button" data-grid-mode="add-horizontal" class="${state.gridMode === 'add-horizontal' ? 'active' : ''}">+ เส้นแนวนอน</button>
      <button type="button" data-grid-mode="add-vertical" class="${state.gridMode === 'add-vertical' ? 'active' : ''}">+ เส้นแนวตั้ง</button>
      <button type="button" data-table-review-action="delete-line">ลบเส้นที่เลือก</button>
      <button type="button" data-table-review-action="lock-grid">${table.metadata.gridLocked ? 'ปลดล็อก Grid' : 'ล็อก Grid'}</button>
      <button type="button" data-table-review-action="add-row">+ แถว</button>
      <button type="button" data-table-review-action="add-column">+ คอลัมน์</button>
      <button type="button" data-table-review-action="delete-row">− แถว</button>
      <button type="button" data-table-review-action="delete-column">− คอลัมน์</button>
    </div>
    <div class="table-review-layout">
      <div class="table-review-source"><div class="table-source-stage" style="aspect-ratio:${state.imageWidth}/${state.imageHeight}"><img src="${escapeHtml(image.currentSrc || image.src)}" alt="ต้นฉบับ"><svg viewBox="0 0 ${state.imageWidth} ${state.imageHeight}" preserveAspectRatio="xMidYMid meet">${overlayHtml(table, state.selectedCellId)}</svg></div><div class="table-source-zoom"><label>Zoom <input type="range" min="75" max="250" value="${state.zoom}" data-table-zoom></label><span>${state.zoom}%</span></div></div>
      <div class="table-review-editor"><div class="table-scroll">${tableHtml(table, state.selectedCellId)}</div><div class="table-cell-detail-wrap">${cellDetailHtml(state)}</div></div>
      <aside class="table-review-issues"><h3>Cell ที่ต้องตรวจ</h3><div>${issueListHtml(table)}</div></aside>
    </div>`;
  const stage = $('.table-source-stage', panel);
  stage.style.setProperty('--table-zoom', String(state.zoom / 100));
}

function nearestCellText(oldTable, newCell) {
  let best = null;
  let bestScore = 0;
  for (const old of oldTable.cells) {
    const score = overlapScore(old.boundingBox, newCell.boundingBox);
    if (score > bestScore) { best = old; bestScore = score; }
  }
  return bestScore >= .32 ? best : null;
}

function rebuildFromLines(pageCard, state) {
  const previous = state.table;
  const rebuilt = buildTableStructure({
    pageNumber: previous.page,
    width: state.imageWidth,
    height: state.imageHeight,
    horizontalLines: previous.horizontalLines,
    verticalLines: previous.verticalLines,
    horizontalSegments: state.detection.horizontalSegments,
    verticalSegments: state.detection.verticalSegments,
  });
  for (const cell of rebuilt.cells) {
    const source = nearestCellText(previous, cell);
    if (source) Object.assign(cell, { text: source.text, textWithLineBreaks: source.textWithLineBreaks, plainText: source.plainText, lines: source.lines, confidence: source.confidence, status: source.status, reviewStatus: source.reviewStatus, candidates: source.candidates, columnType: source.columnType });
  }
  rebuilt.metadata.gridLocked = previous.metadata.gridLocked;
  state.table = rebuilt;
  state.selectedCellId = rebuilt.cells[0]?.cellId || '';
  renderReview(pageCard, state);
}

async function createCropVariant(state, cell, variant) {
  const result = await state.worker.run('crop-cell', { blob: state.blob, box: cell.boundingBox, padding: 6, variant }, 25000);
  return result.blob;
}

function providerAgreement(candidates) {
  if (!candidates.length) return 0;
  const counts = new Map();
  for (const candidate of candidates) {
    const key = candidate.text.replace(/\s+/gu, ' ').trim();
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Math.max(0, ...counts.values()) / candidates.length;
}

async function ocrSingleCell(pageCard, state, cell, pool) {
  if (state.cancelled) throw new Error('TABLE_OCR_CANCELLED');
  const fast = CELL_OCR_VARIANTS.slice(0, 2);
  const candidates = [];
  for (const variant of fast) {
    const blob = await createCropVariant(state, cell, variant);
    if (!cell.cropUrl && variant === 'original') cell.cropUrl = URL.createObjectURL(blob);
    if (variant === 'upscale3') cell.enhancedUrl = URL.createObjectURL(blob);
    const result = await pool.recognize(blob, { variant });
    candidates.push(result);
  }
  let agreement = providerAgreement(candidates);
  let selected = selectCellCandidate(candidates.map(candidate => ({ ...candidate, providerAgreement: agreement })), { columnType: cell.columnType, providerAgreement: agreement });
  if (selected.status !== 'verified' || gibberishAssessment(selected.text, { confidence: selected.confidence, columnType: cell.columnType, providerAgreement: agreement }).gibberish) {
    for (const variant of CELL_OCR_VARIANTS.slice(2)) {
      const blob = await createCropVariant(state, cell, variant);
      const result = await pool.recognize(blob, { variant });
      candidates.push(result);
    }
    agreement = providerAgreement(candidates);
    selected = selectCellCandidate(candidates.map(candidate => ({ ...candidate, providerAgreement: agreement })), { columnType: cell.columnType, providerAgreement: agreement });
  }
  const contamination = crossCellContamination({ text: selected.text, wordBoxes: selected.candidates?.[0]?.words || [], cellBox: cell.boundingBox, columnType: cell.columnType, confidence: selected.confidence });
  if (contamination.contaminated) selected.status = 'contaminated';
  if (!selected.text) {
    const empty = emptyCellAssessment({ pixelDensity: 0, connectedComponents: 0, wordCount: 0, lineDensity: .1 });
    selected.status = empty.status;
  }
  const strict = strictFieldAssessment(selected.text, cell.columnType);
  if (!strict.valid && selected.status === 'verified') selected.status = 'review_required';
  updateCellText(cell, selected);
  return cell;
}

async function runCellOcr(pageCard, state, cells = state.table.cells) {
  if (state.busy) return;
  state.busy = true;
  state.cancelled = false;
  state.busyLabel = 'กำลังเตรียม Worker';
  renderReview(pageCard, state);
  const pool = await new CellOcrPool(message => {
    if (message.status === 'recognizing text') {
      state.busyLabel = `OCR ${Math.round((message.progress || 0) * 100)}%`;
      const progress = $('[data-table-progress]', state.panel);
      if (progress) progress.textContent = progressText(state.table, state.busyLabel);
    }
  }).init();
  state.pool = pool;
  try {
    for (let index = 0; index < cells.length; index += 1) {
      if (state.cancelled) throw new Error('TABLE_OCR_CANCELLED');
      const cell = cells[index];
      state.busyLabel = `Cell ${index + 1}/${cells.length}`;
      const progress = $('[data-table-progress]', state.panel);
      if (progress) progress.textContent = progressText(state.table, state.busyLabel);
      await ocrSingleCell(pageCard, state, cell, pool);
      applyHeaderColumnTypes(state.table);
      if (index % 3 === 0) { renderReview(pageCard, state); await wait(0); }
    }
  } catch (error) {
    if (error.message !== 'TABLE_OCR_CANCELLED') console.warn('Cell OCR failed', error);
  } finally {
    await pool.terminate();
    state.pool = null;
    state.busy = false;
    state.busyLabel = '';
    renderReview(pageCard, state);
  }
}

function stateFor(pageCard) { return pageStates.get(pageCard); }

function footerBlocks(pageCard, page, scale) {
  const raw = $('textarea.page-text', pageCard)?.value || '';
  const lines = raw.split(/\r?\n/gu).map(line => line.trim()).filter(Boolean);
  const footers = lines.filter(line => /หมายเหตุ|@[A-Za-z0-9.-]+|\b\d+\s*\/\s*\d+\b/u.test(line)).slice(-6);
  return footers.map((text, index) => createTextBlock({
    x: page.width * .08,
    y: Math.min(page.height - 30, (stateFor(pageCard)?.table?.bounds?.bottom || page.height * .82) * scale + 12 + index * 22),
    width: page.width * .84,
    height: 22,
    text,
    style: { fontSize: 11, backgroundColor: 'rgba(255,255,255,.9)', padding: 1 },
    source: 'table-footer-v31',
    reviewStatus: 'review_required',
  }));
}

function openInStudio(pageCard, state) {
  const image = $('.page-preview', pageCard);
  const scale = Math.min(1, 1200 / Math.max(state.imageWidth, state.imageHeight));
  const documentModel = createDocument({ name: 'RipScan Editable Table', sourceType: 'ocr-table', metadata: { tableFirst: true, version: VERSION } });
  const page = createPage({ number: 1, width: state.imageWidth * scale, height: state.imageHeight * scale, backgroundImage: image.currentSrc || image.src, metadata: { originalWidth: state.imageWidth, originalHeight: state.imageHeight } });
  const spec = tableToDocumentBlockSpec(state.table, { pageScale: scale, x: state.table.bounds.left, y: state.table.bounds.top });
  page.blocks.push(createTableBlock(spec));
  page.blocks.push(...footerBlocks(pageCard, page, scale));
  documentModel.pages.push(page);
  globalThis.RipScanDocumentStudio?.openModel(normalizeDocumentModel(documentModel));
}

function changeGridLine(pageCard, state, axis, index, value) {
  if (state.table.metadata.gridLocked) return;
  const lines = axis === 'vertical' ? state.table.verticalLines : state.table.horizontalLines;
  if (index <= 0 || index >= lines.length - 1) return;
  lines[index] = Math.max(lines[index - 1] + 4, Math.min(lines[index + 1] - 4, value));
  rebuildFromLines(pageCard, state);
}

function installPanelEvents(pageCard, state) {
  if (state.eventsInstalled) return;
  state.eventsInstalled = true;
  state.panel.addEventListener('input', event => {
    const cellElement = event.target.closest('[data-review-cell]');
    if (cellElement) {
      const cell = state.table.cells.find(item => item.cellId === cellElement.dataset.reviewCell);
      if (cell) { cell.text = cellElement.innerText; cell.textWithLineBreaks = cell.text; cell.plainText = cell.text.replace(/\s*\n\s*/gu, ' '); cell.lines = cell.text.split('\n'); cell.status = 'review_required'; cell.reviewStatus = cell.status; }
      return;
    }
    if (event.target.matches('[data-cell-detail-text]')) {
      const cell = state.table.cells.find(item => item.cellId === event.target.dataset.cellDetailText);
      if (cell) { cell.text = event.target.value; cell.textWithLineBreaks = cell.text; cell.plainText = cell.text.replace(/\s*\n\s*/gu, ' '); cell.lines = cell.text.split('\n'); cell.status = 'review_required'; }
      return;
    }
    if (event.target.matches('[data-table-zoom]')) {
      state.zoom = Number(event.target.value) || 100;
      const stage = $('.table-source-stage', state.panel);
      stage?.style.setProperty('--table-zoom', String(state.zoom / 100));
      const value = event.target.closest('.table-source-zoom')?.querySelector('span');
      if (value) value.textContent = `${state.zoom}%`;
    }
  });
  state.panel.addEventListener('change', event => {
    if (event.target.matches('[data-cell-status]')) {
      const cell = state.table.cells.find(item => item.cellId === event.target.dataset.cellStatus);
      if (cell) { cell.status = event.target.value; cell.reviewStatus = cell.status; renderReview(pageCard, state); }
    }
    if (event.target.matches('[data-cell-confidence]')) {
      const cell = state.table.cells.find(item => item.cellId === event.target.dataset.cellConfidence);
      if (cell) cell.confidence = Math.max(0, Math.min(1, Number(event.target.value) / 100));
    }
  });
  state.panel.addEventListener('click', event => {
    const cellElement = event.target.closest('[data-review-cell],[data-select-review-cell],[data-overlay-cell]');
    if (cellElement) {
      state.selectedCellId = cellElement.dataset.reviewCell || cellElement.dataset.selectReviewCell || cellElement.dataset.overlayCell;
      renderReview(pageCard, state);
      return;
    }
    const mode = event.target.closest('[data-grid-mode]')?.dataset.gridMode;
    if (mode) { state.gridMode = mode; renderReview(pageCard, state); return; }
    const action = event.target.closest('[data-table-review-action]')?.dataset.tableReviewAction;
    if (!action) return;
    if (action === 'ocr-all') runCellOcr(pageCard, state);
    if (action === 'ocr-cell') {
      const cell = state.table.cells.find(item => item.cellId === state.selectedCellId);
      if (cell) runCellOcr(pageCard, state, [cell]);
    }
    if (action === 'cancel') { state.cancelled = true; state.pool?.terminate(); }
    if (action === 'open-studio') openInStudio(pageCard, state);
    if (action === 'lock-grid') { state.table.metadata.gridLocked = !state.table.metadata.gridLocked; renderReview(pageCard, state); }
    if (action === 'delete-line' && state.selectedLine) {
      const lines = state.selectedLine.axis === 'vertical' ? state.table.verticalLines : state.table.horizontalLines;
      if (state.selectedLine.index > 0 && state.selectedLine.index < lines.length - 1) lines.splice(state.selectedLine.index, 1);
      state.selectedLine = null; rebuildFromLines(pageCard, state);
    }
    const selected = state.table.cells.find(item => item.cellId === state.selectedCellId) || state.table.cells[0];
    if (action === 'add-row' && selected && !state.table.metadata.gridLocked) {
      state.table.horizontalLines.splice(selected.rowIndex + 1, 0, Math.round((selected.boundingBox.top + selected.boundingBox.bottom) / 2)); rebuildFromLines(pageCard, state);
    }
    if (action === 'add-column' && selected && !state.table.metadata.gridLocked) {
      state.table.verticalLines.splice(selected.columnIndex + 1, 0, Math.round((selected.boundingBox.left + selected.boundingBox.right) / 2)); rebuildFromLines(pageCard, state);
    }
    if (action === 'delete-row' && state.table.horizontalLines.length > 3 && selected && !state.table.metadata.gridLocked) {
      state.table.horizontalLines.splice(Math.min(state.table.horizontalLines.length - 2, selected.rowIndex + 1), 1); rebuildFromLines(pageCard, state);
    }
    if (action === 'delete-column' && state.table.verticalLines.length > 3 && selected && !state.table.metadata.gridLocked) {
      state.table.verticalLines.splice(Math.min(state.table.verticalLines.length - 2, selected.columnIndex + 1), 1); rebuildFromLines(pageCard, state);
    }
  });
  let drag = null;
  state.panel.addEventListener('pointerdown', event => {
    const line = event.target.closest('[data-grid-axis]');
    if (line) {
      event.preventDefault();
      state.selectedLine = { axis: line.dataset.gridAxis, index: Number(line.dataset.gridIndex) };
      if (!state.table.metadata.gridLocked && state.selectedLine.index > 0) drag = { ...state.selectedLine, pointerId: event.pointerId };
      line.setPointerCapture?.(event.pointerId);
      line.classList.add('selected');
      return;
    }
    const svg = event.target.closest('.table-source-stage svg');
    if (!svg || state.table.metadata.gridLocked || !state.gridMode.startsWith('add-')) return;
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM().inverse());
    if (state.gridMode === 'add-horizontal') state.table.horizontalLines.push(Math.round(transformed.y));
    else state.table.verticalLines.push(Math.round(transformed.x));
    state.table.horizontalLines.sort((a, b) => a - b); state.table.verticalLines.sort((a, b) => a - b);
    rebuildFromLines(pageCard, state);
  });
  state.panel.addEventListener('pointermove', event => {
    if (!drag) return;
    const svg = $('.table-source-stage svg', state.panel);
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM().inverse());
    changeGridLine(pageCard, state, drag.axis, drag.index, drag.axis === 'vertical' ? transformed.x : transformed.y);
  });
  state.panel.addEventListener('pointerup', () => { drag = null; });
}

async function detectPage(pageCard) {
  if (scheduled.has(pageCard)) return;
  scheduled.add(pageCard);
  const image = $('.page-preview', pageCard);
  if (!image) return;
  try {
    const blob = await sourceBlob(image);
    const worker = new TableWorkerClient();
    const detection = selectTableEvidence(await worker.run('detect-grid', { blob }, 30000));
    if (detection.verticalLines.length < 3 || detection.horizontalLines.length < 3) { worker.dispose(); return; }
    const table = buildTableStructure({
      pageNumber: Number($('.page-index', pageCard)?.textContent?.match(/\d+/u)?.[0] || 1),
      width: detection.width,
      height: detection.height,
      horizontalLines: detection.horizontalLines,
      verticalLines: detection.verticalLines,
      horizontalSegments: detection.horizontalSegments,
      verticalSegments: detection.verticalSegments,
    });
    if (table.columnCount < 2 || table.rowCount < 2) { worker.dispose(); return; }
    hydrateFromExistingTable(table, pageCard);
    const state = { worker, blob, detection, table, imageWidth: detection.width, imageHeight: detection.height, selectedCellId: table.cells[0]?.cellId || '', gridMode: 'select', selectedLine: null, zoom: 100, busy: false, busyLabel: '', cancelled: false, pool: null, panel: null, eventsInstalled: false };
    pageStates.set(pageCard, state);
    pageCard.dataset.tableFirstVersion = VERSION;
    ensureReviewPanel(pageCard, state);
    installPanelEvents(pageCard, state);
    const badgeTarget = $('.page-head > div:first-child', pageCard);
    if (badgeTarget && !$('.table-first-badge', badgeTarget)) {
      const badge = document.createElement('span'); badge.className = 'table-first-badge'; badge.textContent = `Editable Table ${table.rowCount}×${table.columnCount}`; badgeTarget.append(badge);
    }
  } catch (error) {
    console.warn('Table-first detection skipped', error);
  }
}

function scan() {
  if (!results) return;
  $$('.page-card', results).forEach(pageCard => detectPage(pageCard));
}

if (results) {
  new MutationObserver(scan).observe(results, { childList: true, subtree: true });
  scan();
}

document.documentElement.dataset.tableReconstructionVersion = VERSION;
