import { loadTesseract } from './lazy-libraries.mjs';
import {
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
} from './table-reconstruction-core.mjs';
import {
  createDocument,
  createPage,
  createTableBlock,
  createTextBlock,
  normalizeDocumentModel,
} from './document-model.mjs';

const VERSION = '3.1.2';
const MAX_PARALLEL_TABLE_DETECTIONS = 1;
const results = document.querySelector('#results');
const pageStates = new WeakMap();
const observedPages = new WeakSet();
const queuedPages = new WeakSet();
const completedPages = new WeakSet();
const detectionQueue = [];
let detectionRunning = false;
let scanScheduled = false;
let sequence = 0;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function idleYield(timeout = 600) {
  return new Promise(resolve => {
    if ('requestIdleCallback' in globalThis) requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, 32);
  });
}

class SerialTableWorker {
  constructor() {
    this.worker = new Worker('/table-reconstruction-worker.js');
    this.pending = new Map();
    this.queue = Promise.resolve();
    this.worker.addEventListener('message', event => {
      const message = event.data || {};
      const entry = this.pending.get(message.jobId);
      if (!entry) return;
      this.pending.delete(message.jobId);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(message.error || 'TABLE_WORKER_FAILED'));
    });
  }

  run(type, payload, timeoutMs = 25000) {
    const execute = () => this.execute(type, payload, timeoutMs);
    const task = this.queue.then(execute, execute);
    this.queue = task.catch(() => undefined);
    return task;
  }

  execute(type, payload, timeoutMs) {
    const jobId = `table-v312-${Date.now()}-${++sequence}`;
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

  dispose() {
    this.worker.postMessage({ type: 'dispose' });
    this.worker.terminate();
    for (const entry of this.pending.values()) entry.reject(new Error('TABLE_WORKER_DISPOSED'));
    this.pending.clear();
  }
}

const sharedTableWorker = new SerialTableWorker();

class CellOcrPool {
  constructor(onProgress = () => {}) {
    this.onProgress = onProgress;
    this.worker = null;
    this.disposed = false;
  }

  async init() {
    const tesseract = await loadTesseract();
    this.worker = await tesseract.createWorker(['tha', 'eng'], 1, {
      logger: message => this.onProgress(message),
    });
    await this.worker.setParameters?.({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '6' });
    return this;
  }

  async recognize(blob, context = {}) {
    if (this.disposed || !this.worker) throw new Error('TABLE_OCR_CANCELLED');
    const result = await this.worker.recognize(blob, {}, { text: true, blocks: true, hocr: false, tsv: false });
    const data = result?.data || {};
    return {
      text: String(data.text || '').trim(),
      confidence: Math.max(0, Math.min(1, Number(data.confidence || 0) / 100)),
      words: (data.words || []).map(word => ({
        text: word.text,
        confidence: Number(word.confidence || 0) / 100,
        x: word.bbox?.x0 || 0,
        y: word.bbox?.y0 || 0,
        width: (word.bbox?.x1 || 0) - (word.bbox?.x0 || 0),
        height: (word.bbox?.y1 || 0) - (word.bbox?.y0 || 0),
      })),
      variant: context.variant,
    };
  }

  async terminate() {
    this.disposed = true;
    await this.worker?.terminate?.();
    this.worker = null;
  }
}

function imageReady(image) {
  if (image.complete && image.naturalWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', reject, { once: true });
  });
}

async function fetchSourceBlob(sourceUrl) {
  const response = await fetch(sourceUrl);
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
  return {
    ...detection,
    verticalLines: verticalLines.length >= 3 ? verticalLines : detection.verticalLines,
    horizontalLines: horizontalLines.length >= 3 ? horizontalLines : detection.horizontalLines,
  };
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

function statusClass(status) {
  return `cell-status-${String(status || 'review_required').replace(/_/gu, '-')}`;
}

function tableRecords(table) {
  return table.cells.filter(cell => !cell.hidden).map(cell => ({
    rowIndex: cell.rowIndex,
    columnIndex: cell.columnIndex,
    rowSpan: cell.rowSpan,
    columnSpan: cell.columnSpan,
    text: cell.textWithLineBreaks || cell.text || '',
    confidence: cell.confidence,
    status: cell.status,
  }));
}

function publishStructuredTable(pageCard, state) {
  const records = tableRecords(state.table);
  pageCard.dataset.tableRows = String(state.table.rowCount);
  pageCard.dataset.tableColumns = String(state.table.columnCount);
  pageCard.dataset.tableCellSeparated = 'true';
  pageCard.dataset.tableOutputMode = 'structured-event';
  pageCard.dispatchEvent(new CustomEvent('ripscan:structured-table-ready', {
    bubbles: true,
    detail: {
      records,
      rows: state.table.rowCount,
      columns: state.table.columnCount,
      output: 'editable-table',
      version: VERSION,
    },
  }));
}

function progressText(table, active = '') {
  const progress = tableProgress(table);
  return `พบตาราง 1 ตาราง · ${progress.columns} คอลัมน์ · ${progress.rows} แถว · ${progress.cells} เซลล์ · OCR สำเร็จ ${progress.completed} เซลล์ · ต้องตรวจ ${progress.review} เซลล์${active ? ` · ${active}` : ''}`;
}

function tableHtml(table, selectedCellId = '') {
  const columns = table.columnWidths.map(width => `<col style="width:${Math.max(24, width)}px">`).join('');
  const rows = Array.from({ length: table.rowCount }, (_, rowIndex) => {
    const cells = table.cells.filter(cell => cell.rowIndex === rowIndex && !cell.hidden)
      .sort((a, b) => a.columnIndex - b.columnIndex)
      .map(cell => `<td contenteditable="true" spellcheck="false" data-review-cell="${cell.cellId}" rowspan="${cell.rowSpan}" colspan="${cell.columnSpan}" class="${statusClass(cell.status)} ${selectedCellId === cell.cellId ? 'selected' : ''}" style="text-align:${cell.alignment};vertical-align:${cell.verticalAlignment};background:${cell.fillColor};font-size:${cell.fontSize}px;font-weight:${cell.fontWeight}">${escapeHtml(cell.textWithLineBreaks || cell.text).replace(/\n/gu, '<br>')}</td>`).join('');
    return `<tr style="height:${Math.max(22, table.rowHeights[rowIndex] || 38)}px">${cells}</tr>`;
  }).join('');
  return `<table class="table-review-editable"><colgroup>${columns}</colgroup><tbody>${rows}</tbody></table>`;
}

function overlayHtml(table, selectedCellId = '') {
  const cells = table.cells.filter(cell => !cell.hidden).map(cell => `<rect data-overlay-cell="${cell.cellId}" x="${cell.boundingBox.left}" y="${cell.boundingBox.top}" width="${cell.boundingBox.width}" height="${cell.boundingBox.height}" class="${statusClass(cell.status)} ${selectedCellId === cell.cellId ? 'selected' : ''}"><title>${escapeHtml(cell.text || `${cell.rowIndex + 1}:${cell.columnIndex + 1}`)}</title></rect>`).join('');
  const vertical = table.verticalLines.map((x, index) => `<line class="grid-line vertical" data-grid-axis="vertical" data-grid-index="${index}" x1="${x}" x2="${x}" y1="${table.bounds.top}" y2="${table.bounds.bottom}"></line>`).join('');
  const horizontal = table.horizontalLines.map((y, index) => `<line class="grid-line horizontal" data-grid-axis="horizontal" data-grid-index="${index}" x1="${table.bounds.left}" x2="${table.bounds.right}" y1="${y}" y2="${y}"></line>`).join('');
  return `${cells}${vertical}${horizontal}`;
}

function issueListHtml(table) {
  const issues = table.cells.filter(cell => !cell.hidden && !['verified', 'empty'].includes(cell.status));
  if (!issues.length) return '<p class="table-no-issues">ทุก Cell ผ่านการตรวจ</p>';
  return issues.slice(0, 100).map(cell => `<button type="button" data-select-review-cell="${cell.cellId}" class="table-issue ${statusClass(cell.status)}"><strong>แถว ${cell.rowIndex + 1} · คอลัมน์ ${cell.columnIndex + 1}</strong><span>${escapeHtml(cell.text || 'ยังไม่อ่านข้อความ')}</span><small>${cell.status} · ${Math.round(cell.confidence * 100)}%</small></button>`).join('');
}

function cellDetailHtml(state) {
  const cell = state.table.cells.find(item => item.cellId === state.selectedCellId) || state.table.cells[0];
  if (!cell) return '<p>ยังไม่มี Cell</p>';
  const candidates = (cell.candidates || []).slice(0, 4).map(candidate => `<li><strong>${escapeHtml(candidate.variant || 'OCR')}</strong><span>${escapeHtml(candidate.text || '')}</span><em>${Math.round(Number(candidate.confidence || 0) * 100)}%</em></li>`).join('');
  return `<div class="table-cell-detail" data-detail-cell="${cell.cellId}">
    <div class="table-cell-detail-head"><div><strong>Cell ${cell.rowIndex + 1}:${cell.columnIndex + 1}</strong><small>${cell.columnType} · ${cell.status}</small></div><button type="button" data-table-review-action="ocr-cell">OCR ใหม่เฉพาะ Cell</button></div>
    ${cell.cropUrl ? `<div class="table-cell-crops"><img src="${escapeHtml(cell.cropUrl)}" alt="Cell ต้นฉบับ"><img src="${escapeHtml(cell.enhancedUrl || cell.cropUrl)}" alt="Cell ขยาย"></div>` : ''}
    <label>ข้อความ<textarea data-cell-detail-text="${cell.cellId}">${escapeHtml(cell.textWithLineBreaks || cell.text)}</textarea></label>
    <div class="table-cell-meta"><label>สถานะ<select data-cell-status="${cell.cellId}">${['verified','review_required','possible_text','contaminated','structure_conflict','empty','possibly_empty'].map(status => `<option value="${status}" ${cell.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><label>Confidence<input type="number" min="0" max="100" value="${Math.round(cell.confidence * 100)}" data-cell-confidence="${cell.cellId}"></label></div>
    <ul class="table-candidate-list">${candidates || '<li>ยังไม่มี Candidate</li>'}</ul>
  </div>`;
}

function renderSummary(pageCard, state) {
  state.panel.innerHTML = `<header class="table-review-head"><div><strong>ตรวจพบตาราง · Worker ${VERSION}</strong><small>${progressText(state.table)}</small></div><div class="table-review-actions"><button type="button" data-table-review-action="expand" class="primary">เปิดตารางแก้ไข</button><button type="button" data-table-review-action="open-studio">เปิดแก้ไขใน Document Studio</button></div></header>`;
  state.panel.dataset.collapsed = 'true';
}

function renderReview(pageCard, state) {
  if (!state.panel) return;
  if (!state.expanded) return renderSummary(pageCard, state);
  const image = $('.page-preview', pageCard);
  const table = state.table;
  state.panel.dataset.collapsed = 'false';
  state.panel.innerHTML = `
    <header class="table-review-head"><div><strong>ตรวจสอบตาราง · Table-first ${VERSION}</strong><small data-table-progress>${progressText(table, state.busyLabel)}</small></div><div class="table-review-actions"><button type="button" data-table-review-action="ocr-all">อ่านทุก Cell</button><button type="button" data-table-review-action="open-studio" class="primary">เปิดแก้ไขใน Document Studio</button><button type="button" data-table-review-action="collapse">ย่อ</button><button type="button" data-table-review-action="cancel" ${state.busy ? '' : 'hidden'}>ยกเลิก</button></div></header>
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
      <div class="table-review-source"><div class="table-source-stage" style="aspect-ratio:${state.imageWidth}/${state.imageHeight}"><img src="${escapeHtml(image.currentSrc || image.src)}" alt="ต้นฉบับ"><svg viewBox="0 0 ${state.imageWidth} ${state.imageHeight}" preserveAspectRatio="xMidYMid meet">${overlayHtml(table, state.selectedCellId)}</svg></div></div>
      <div class="table-review-editor"><div class="table-scroll">${tableHtml(table, state.selectedCellId)}</div><div class="table-cell-detail-wrap">${cellDetailHtml(state)}</div></div>
      <aside class="table-review-issues"><h3>Cell ที่ต้องตรวจ</h3><div>${issueListHtml(table)}</div></aside>
    </div>`;
}

function ensureReviewPanel(pageCard, state) {
  let panel = $('.table-review-v31', pageCard);
  if (!panel) {
    panel = document.createElement('section');
    panel.className = 'table-review-v31';
    const textarea = $('textarea.page-text', pageCard);
    textarea?.insertAdjacentElement('afterend', panel);
  }
  state.panel = panel;
  renderReview(pageCard, state);
}

function overlapScore(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  const area = Math.max(0, right - left) * Math.max(0, bottom - top);
  return area / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
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
    let source = null;
    let score = 0;
    for (const old of previous.cells) {
      const current = overlapScore(old.boundingBox, cell.boundingBox);
      if (current > score) { source = old; score = current; }
    }
    if (source && score >= .32) Object.assign(cell, {
      text: source.text,
      textWithLineBreaks: source.textWithLineBreaks,
      plainText: source.plainText,
      lines: source.lines,
      confidence: source.confidence,
      status: source.status,
      reviewStatus: source.reviewStatus,
      candidates: source.candidates,
      columnType: source.columnType,
    });
  }
  rebuilt.metadata.gridLocked = previous.metadata.gridLocked;
  state.table = rebuilt;
  state.selectedCellId = rebuilt.cells[0]?.cellId || '';
  publishStructuredTable(pageCard, state);
  renderReview(pageCard, state);
}

async function ensureOcrBlob(state) {
  if (!state.blob) state.blob = await fetchSourceBlob(state.sourceUrl);
  return state.blob;
}

async function createCropVariant(state, cell, variant) {
  const blob = await ensureOcrBlob(state);
  const result = await sharedTableWorker.run('crop-cell', { blob, box: cell.boundingBox, padding: 6, variant }, 20000);
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

function replaceCellUrl(cell, key, blob) {
  if (cell[key]) URL.revokeObjectURL(cell[key]);
  cell[key] = URL.createObjectURL(blob);
}

async function ocrSingleCell(state, cell, pool) {
  if (state.cancelled) throw new Error('TABLE_OCR_CANCELLED');
  const candidates = [];
  for (const variant of CELL_OCR_VARIANTS.slice(0, 2)) {
    const blob = await createCropVariant(state, cell, variant);
    if (variant === 'original') replaceCellUrl(cell, 'cropUrl', blob);
    if (variant === 'upscale3') replaceCellUrl(cell, 'enhancedUrl', blob);
    candidates.push(await pool.recognize(blob, { variant }));
  }
  let agreement = providerAgreement(candidates);
  let selected = selectCellCandidate(candidates.map(candidate => ({ ...candidate, providerAgreement: agreement })), { columnType: cell.columnType, providerAgreement: agreement });
  if (selected.status !== 'verified' || gibberishAssessment(selected.text, { confidence: selected.confidence, columnType: cell.columnType, providerAgreement: agreement }).gibberish) {
    for (const variant of CELL_OCR_VARIANTS.slice(2)) {
      const blob = await createCropVariant(state, cell, variant);
      candidates.push(await pool.recognize(blob, { variant }));
    }
    agreement = providerAgreement(candidates);
    selected = selectCellCandidate(candidates.map(candidate => ({ ...candidate, providerAgreement: agreement })), { columnType: cell.columnType, providerAgreement: agreement });
  }
  const contamination = crossCellContamination({ text: selected.text, wordBoxes: selected.words || [], cellBox: cell.boundingBox, columnType: cell.columnType, confidence: selected.confidence });
  if (contamination.contaminated) selected.status = 'contaminated';
  if (!selected.text) selected.status = emptyCellAssessment({ pixelDensity: 0, connectedComponents: 0, wordCount: 0, lineDensity: .1 }).status;
  const strict = strictFieldAssessment(selected.text, cell.columnType);
  if (!strict.valid && selected.status === 'verified') selected.status = 'review_required';
  selected.candidates = candidates;
  updateCellText(cell, selected);
}

async function runCellOcr(pageCard, state, cells = state.table.cells) {
  if (state.busy) return;
  state.busy = true;
  state.cancelled = false;
  state.busyLabel = 'กำลังเตรียม Worker';
  renderReview(pageCard, state);
  const pool = await new CellOcrPool(message => {
    if (message.status !== 'recognizing text') return;
    state.busyLabel = `OCR ${Math.round((message.progress || 0) * 100)}%`;
    const progress = $('[data-table-progress]', state.panel);
    if (progress) progress.textContent = progressText(state.table, state.busyLabel);
  }).init();
  state.pool = pool;
  try {
    for (let index = 0; index < cells.length; index += 1) {
      if (state.cancelled) throw new Error('TABLE_OCR_CANCELLED');
      state.busyLabel = `Cell ${index + 1}/${cells.length}`;
      const progress = $('[data-table-progress]', state.panel);
      if (progress) progress.textContent = progressText(state.table, state.busyLabel);
      await ocrSingleCell(state, cells[index], pool);
      applyHeaderColumnTypes(state.table);
      publishStructuredTable(pageCard, state);
      await idleYield(120);
      if (index % 6 === 5) renderReview(pageCard, state);
    }
  } catch (error) {
    if (error.message !== 'TABLE_OCR_CANCELLED') console.warn('Cell OCR failed', error);
  } finally {
    await pool.terminate();
    state.pool = null;
    state.blob = null;
    state.busy = false;
    state.busyLabel = '';
    renderReview(pageCard, state);
  }
}

function footerBlocks(pageCard, page, scale, state) {
  const raw = $('textarea.page-text', pageCard)?.value || '';
  const lines = raw.split(/\r?\n/gu).map(line => line.trim()).filter(Boolean);
  return lines.filter(line => /หมายเหตุ|@[A-Za-z0-9.-]+|\b\d+\s*\/\s*\d+\b/u.test(line)).slice(-6).map((text, index) => createTextBlock({
    x: page.width * .08,
    y: Math.min(page.height - 30, (state.table.bounds.bottom || page.height * .82) * scale + 12 + index * 22),
    width: page.width * .84,
    height: 22,
    text,
    style: { fontSize: 11, backgroundColor: 'rgba(255,255,255,.9)', padding: 1 },
    source: 'table-footer-v312',
    reviewStatus: 'review_required',
  }));
}

function openInStudio(pageCard, state) {
  const image = $('.page-preview', pageCard);
  const scale = Math.min(1, 1200 / Math.max(state.imageWidth, state.imageHeight));
  const documentModel = createDocument({ name: 'RipScan Editable Table', sourceType: 'ocr-table', metadata: { tableFirst: true, version: VERSION } });
  const page = createPage({ number: 1, width: state.imageWidth * scale, height: state.imageHeight * scale, backgroundImage: image.currentSrc || image.src, metadata: { originalWidth: state.imageWidth, originalHeight: state.imageHeight } });
  page.blocks.push(createTableBlock(tableToDocumentBlockSpec(state.table, { pageScale: scale, x: state.table.bounds.left, y: state.table.bounds.top })));
  page.blocks.push(...footerBlocks(pageCard, page, scale, state));
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
      if (cell) {
        cell.text = cellElement.innerText;
        cell.textWithLineBreaks = cell.text;
        cell.plainText = cell.text.replace(/\s*\n\s*/gu, ' ');
        cell.lines = cell.text.split('\n');
        cell.status = 'review_required';
        publishStructuredTable(pageCard, state);
      }
      return;
    }
    if (event.target.matches('[data-cell-detail-text]')) {
      const cell = state.table.cells.find(item => item.cellId === event.target.dataset.cellDetailText);
      if (cell) {
        cell.text = event.target.value;
        cell.textWithLineBreaks = cell.text;
        cell.plainText = cell.text.replace(/\s*\n\s*/gu, ' ');
        cell.lines = cell.text.split('\n');
        cell.status = 'review_required';
        publishStructuredTable(pageCard, state);
      }
    }
  });

  state.panel.addEventListener('change', event => {
    if (event.target.matches('[data-cell-status]')) {
      const cell = state.table.cells.find(item => item.cellId === event.target.dataset.cellStatus);
      if (cell) { cell.status = event.target.value; publishStructuredTable(pageCard, state); renderReview(pageCard, state); }
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
    if (action === 'expand') {
      state.expanded = true;
      const textarea = $('textarea.page-text', pageCard);
      if (textarea) { textarea.hidden = true; textarea.dataset.replacedByEditableTable = 'true'; }
      renderReview(pageCard, state);
    }
    if (action === 'collapse') {
      state.expanded = false;
      const textarea = $('textarea.page-text', pageCard);
      if (textarea) textarea.hidden = false;
      renderReview(pageCard, state);
    }
    if (action === 'ocr-all') runCellOcr(pageCard, state);
    if (action === 'ocr-cell') {
      const cell = state.table.cells.find(item => item.cellId === state.selectedCellId);
      if (cell) runCellOcr(pageCard, state, [cell]);
    }
    if (action === 'cancel') { state.cancelled = true; state.pool?.terminate(); }
    if (action === 'open-studio') openInStudio(pageCard, state);
    if (action === 'lock-grid') { state.table.metadata.gridLocked = !state.table.metadata.gridLocked; renderReview(pageCard, state); }
    const selected = state.table.cells.find(item => item.cellId === state.selectedCellId) || state.table.cells[0];
    if (action === 'delete-line' && state.selectedLine) {
      const lines = state.selectedLine.axis === 'vertical' ? state.table.verticalLines : state.table.horizontalLines;
      if (state.selectedLine.index > 0 && state.selectedLine.index < lines.length - 1) lines.splice(state.selectedLine.index, 1);
      state.selectedLine = null;
      rebuildFromLines(pageCard, state);
    }
    if (action === 'add-row' && selected && !state.table.metadata.gridLocked) {
      state.table.horizontalLines.splice(selected.rowIndex + 1, 0, Math.round((selected.boundingBox.top + selected.boundingBox.bottom) / 2));
      rebuildFromLines(pageCard, state);
    }
    if (action === 'add-column' && selected && !state.table.metadata.gridLocked) {
      state.table.verticalLines.splice(selected.columnIndex + 1, 0, Math.round((selected.boundingBox.left + selected.boundingBox.right) / 2));
      rebuildFromLines(pageCard, state);
    }
    if (action === 'delete-row' && state.table.horizontalLines.length > 3 && selected && !state.table.metadata.gridLocked) {
      state.table.horizontalLines.splice(Math.min(state.table.horizontalLines.length - 2, selected.rowIndex + 1), 1);
      rebuildFromLines(pageCard, state);
    }
    if (action === 'delete-column' && state.table.verticalLines.length > 3 && selected && !state.table.metadata.gridLocked) {
      state.table.verticalLines.splice(Math.min(state.table.verticalLines.length - 2, selected.columnIndex + 1), 1);
      rebuildFromLines(pageCard, state);
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
      return;
    }
    const svg = event.target.closest('.table-source-stage svg');
    if (!svg || state.table.metadata.gridLocked || !state.gridMode.startsWith('add-')) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM().inverse());
    if (state.gridMode === 'add-horizontal') state.table.horizontalLines.push(Math.round(transformed.y));
    else state.table.verticalLines.push(Math.round(transformed.x));
    state.table.horizontalLines.sort((a, b) => a - b);
    state.table.verticalLines.sort((a, b) => a - b);
    rebuildFromLines(pageCard, state);
  });
  state.panel.addEventListener('pointermove', event => {
    if (!drag) return;
    const svg = $('.table-source-stage svg', state.panel);
    if (!svg) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM().inverse());
    changeGridLine(pageCard, state, drag.axis, drag.index, drag.axis === 'vertical' ? transformed.x : transformed.y);
  });
  state.panel.addEventListener('pointerup', () => { drag = null; });
}

async function detectPage(pageCard) {
  if (completedPages.has(pageCard)) return;
  completedPages.add(pageCard);
  const image = $('.page-preview', pageCard);
  if (!image) return;
  try {
    await imageReady(image);
    const sourceUrl = image.currentSrc || image.src;
    const blob = await fetchSourceBlob(sourceUrl);
    const detection = selectTableEvidence(await sharedTableWorker.run('detect-grid', { blob }, 22000));
    if (detection.verticalLines.length < 3 || detection.horizontalLines.length < 3) return;
    const table = buildTableStructure({
      pageNumber: Number($('.page-index', pageCard)?.textContent?.match(/\d+/u)?.[0] || 1),
      width: detection.width,
      height: detection.height,
      horizontalLines: detection.horizontalLines,
      verticalLines: detection.verticalLines,
      horizontalSegments: detection.horizontalSegments,
      verticalSegments: detection.verticalSegments,
    });
    if (table.columnCount < 2 || table.rowCount < 2) return;
    hydrateFromExistingTable(table, pageCard);
    const state = {
      sourceUrl,
      blob: null,
      detection,
      table,
      imageWidth: detection.width,
      imageHeight: detection.height,
      selectedCellId: table.cells[0]?.cellId || '',
      gridMode: 'select',
      selectedLine: null,
      expanded: false,
      busy: false,
      busyLabel: '',
      cancelled: false,
      pool: null,
      panel: null,
      eventsInstalled: false,
    };
    pageStates.set(pageCard, state);
    pageCard.dataset.tableFirstVersion = VERSION;
    ensureReviewPanel(pageCard, state);
    installPanelEvents(pageCard, state);
    publishStructuredTable(pageCard, state);
    const badgeTarget = $('.page-head > div:first-child', pageCard);
    if (badgeTarget && !$('.table-first-badge', badgeTarget)) {
      const badge = document.createElement('span');
      badge.className = 'table-first-badge';
      badge.textContent = `Editable Table ${table.rowCount}×${table.columnCount}`;
      badgeTarget.append(badge);
    }
  } catch (error) {
    console.warn('Table-first detection skipped', error);
  }
}

function enqueuePage(pageCard) {
  if (queuedPages.has(pageCard) || completedPages.has(pageCard)) return;
  queuedPages.add(pageCard);
  detectionQueue.push(pageCard);
  drainDetectionQueue();
}

async function waitUntilVisible() {
  if (!document.hidden) return;
  await new Promise(resolve => document.addEventListener('visibilitychange', resolve, { once: true }));
}

async function drainDetectionQueue() {
  if (detectionRunning) return;
  detectionRunning = true;
  try {
    while (detectionQueue.length) {
      await waitUntilVisible();
      await idleYield();
      const pageCard = detectionQueue.shift();
      if (!pageCard?.isConnected) continue;
      await detectPage(pageCard);
      await wait(120);
    }
  } finally {
    detectionRunning = false;
  }
}

const pageObserver = 'IntersectionObserver' in globalThis
  ? new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) enqueuePage(entry.target);
    }, { rootMargin: '600px 0px', threshold: .01 })
  : null;

function scan() {
  scanScheduled = false;
  if (!results) return;
  const pages = $$('.page-card', results);
  pages.forEach((pageCard, index) => {
    if (observedPages.has(pageCard)) return;
    observedPages.add(pageCard);
    if (pageObserver) pageObserver.observe(pageCard);
    if (!pageObserver || index < 2) enqueuePage(pageCard);
  });
}

function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  if ('requestIdleCallback' in globalThis) requestIdleCallback(scan, { timeout: 700 });
  else setTimeout(scan, 80);
}

if (results) {
  new MutationObserver(scheduleScan).observe(results, { childList: true, subtree: true });
  scheduleScan();
}

addEventListener('pagehide', () => {
  pageObserver?.disconnect();
  sharedTableWorker.dispose();
  for (const pageCard of $$('.page-card', results || document)) {
    const state = pageStates.get(pageCard);
    if (!state) continue;
    state.pool?.terminate();
    for (const cell of state.table.cells) {
      if (cell.cropUrl) URL.revokeObjectURL(cell.cropUrl);
      if (cell.enhancedUrl) URL.revokeObjectURL(cell.enhancedUrl);
    }
    state.blob = null;
  }
});

document.documentElement.dataset.tableReconstructionVersion = VERSION;
document.documentElement.dataset.tableDetectionConcurrency = String(MAX_PARALLEL_TABLE_DETECTIONS);
