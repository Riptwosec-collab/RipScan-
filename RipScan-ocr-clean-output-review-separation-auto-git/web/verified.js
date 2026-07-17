import {
  assessEmptyCell,
  confidenceBreakdown,
  detectCellContamination,
  difficultThaiIssues,
  exportDelimited,
  inferColumnType,
  normalizeThaiUnicode,
  segmentMixedLanguage,
  strictPreservationKind,
  validateStrictNumber,
} from './ocr-core.mjs';
import {
  DEFAULT_OUTPUT_MODE,
  DOMAIN_DICTIONARY,
  OUTPUT_MODES,
  REVIEW_STATUSES,
  cleanTextForItem,
  createReviewRecord,
  detectGibberish,
  normalizeReviewMetadata,
  sanitizeTextForExport,
  suggestDomainCandidate,
  validatePhoneNumber,
} from './ocr-output-cleaner.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const results = $('#results');
const statusBox = $('#status');
const statusText = $('#statusText');
const errorBox = $('#error');
const enhanced = new WeakSet();
const cards = new WeakSet();
let sequence = 0;

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const showError = message => { if (errorBox) { errorBox.textContent = message; errorBox.hidden = false; } };
const busy = (active, message = '') => { if (statusBox) statusBox.hidden = !active; if (statusText && message) statusText.textContent = message; };

function config() {
  return {
    tableMode: localStorage.getItem('ripscan-table-mode') || 'accurate',
    outputMode: localStorage.getItem('ripscan-output-mode') || DEFAULT_OUTPUT_MODE,
    delimiter: localStorage.getItem('ripscan-delimiter') || ',',
    includeReviewMetadata: localStorage.getItem('ripscan-json-review-metadata') !== 'false',
  };
}

function installControls() {
  const anchor = $('.advanced-controls');
  if (!anchor || $('#tableMode')) return;
  const current = config();
  const panel = document.createElement('div');
  panel.className = 'verified-controls';
  panel.innerHTML = `
    <label>โหมดตาราง
      <select id="tableMode">
        <option value="auto">Auto Detect</option>
        <option value="accurate">Table Accurate</option>
        <option value="ultra">Table Ultra Verified</option>
        <option value="manual">Manual Grid</option>
      </select>
    </label>
    <label>Output Mode
      <select id="verifiedOutputMode">
        <option value="verified_only">Clean Verified Only</option>
        <option value="verified_reviewed">Clean Verified + Reviewed</option>
        <option value="include_unverified">Include Unverified</option>
        <option value="debug">Debug OCR Output</option>
      </select>
    </label>
    <label>CSV
      <select id="verifiedDelimiter"><option value=",">Comma</option><option value=";">Semicolon</option><option value="\t">Tab</option></select>
    </label>
    <label><input id="jsonReviewMetadata" type="checkbox"> JSON เก็บ Review Metadata</label>
    <small>ข้อความจริงและสถานะ Review แยกกัน · Copy/Export ปกติไม่มีป้าย [โปรดตรวจสอบ:]</small>`;
  anchor.after(panel);
  $('#tableMode').value = current.tableMode;
  $('#verifiedOutputMode').value = current.outputMode;
  $('#verifiedDelimiter').value = current.delimiter;
  $('#jsonReviewMetadata').checked = current.includeReviewMetadata;
  $('#tableMode').onchange = event => localStorage.setItem('ripscan-table-mode', event.target.value);
  $('#verifiedOutputMode').onchange = event => {
    const mode = event.target.value;
    localStorage.setItem('ripscan-output-mode', mode);
    if (mode === OUTPUT_MODES.DEBUG) showError('Debug OCR Output ใช้สำหรับตรวจสอบภายในเท่านั้น ไม่ควรใช้ Copy ปกติ');
    scan();
  };
  $('#verifiedDelimiter').onchange = event => localStorage.setItem('ripscan-delimiter', event.target.value);
  $('#jsonReviewMetadata').onchange = event => localStorage.setItem('ripscan-json-review-metadata', String(event.target.checked));
}

function contentNode(cell) {
  return $('span', cell) || $('[contenteditable]', cell) || cell;
}

function cellText(cell) {
  return sanitizeTextForExport(contentNode(cell)?.textContent ?? '', { trim: false });
}

function setCellText(cell, text) {
  const node = contentNode(cell);
  if (node) node.textContent = sanitizeTextForExport(text, { trim: false });
}

function confidence(cell) {
  const fromDataset = Number(cell.dataset.confidence);
  if (Number.isFinite(fromDataset)) return Math.max(0, Math.min(1, fromDataset > 1 ? fromDataset / 100 : fromDataset));
  const number = Number($('small', cell)?.textContent?.match(/[\d.]+/)?.[0]);
  return Number.isFinite(number) ? number / 100 : .5;
}

function tableRecords(table) {
  const records = [];
  const grid = [];
  [...table.rows].forEach((row, rowIndex) => {
    grid[rowIndex] ||= [];
    let columnIndex = 0;
    [...row.cells].forEach(cell => {
      while (grid[rowIndex][columnIndex]) columnIndex += 1;
      const rowSpan = Math.max(1, Number(cell.rowSpan || 1));
      const columnSpan = Math.max(1, Number(cell.colSpan || 1));
      if (!cell.dataset.cellId) cell.dataset.cellId = `review-cell-${Date.now().toString(36)}-${++sequence}`;
      const record = { cell, rowIndex, columnIndex, rowSpan, columnSpan, text: cellText(cell), confidence: confidence(cell) };
      records.push(record);
      for (let r = 0; r < rowSpan; r += 1) {
        grid[rowIndex + r] ||= [];
        for (let c = 0; c < columnSpan; c += 1) grid[rowIndex + r][columnIndex + c] = record;
      }
      columnIndex += columnSpan;
    });
  });
  return { records, grid, rows: grid.length, columns: Math.max(0, ...grid.map(row => row.length)) };
}

function customDictionary() {
  try { return JSON.parse(localStorage.getItem('ripscan-custom-dictionary') || '[]'); }
  catch { return []; }
}

function dictionary() {
  return [...new Set([...DOMAIN_DICTIONARY, ...customDictionary()])];
}

function addDictionary(word) {
  const words = customDictionary();
  if (!words.includes(word)) words.push(word);
  localStorage.setItem('ripscan-custom-dictionary', JSON.stringify(words.slice(-1000)));
}

function persistedReview(cell) {
  return normalizeReviewMetadata({
    status: cell.dataset.reviewStatus || cell.dataset.verifiedStatus,
    confidence: confidence(cell),
    issueType: cell.dataset.issueType,
    displayLabel: cell.dataset.displayLabel,
    includeInExport: cell.dataset.includeInExport === '' ? undefined : cell.dataset.includeInExport === 'true',
    confirmed: cell.dataset.confirmed === 'true',
    reviewed: cell.dataset.reviewed === 'true',
    userOverride: cell.dataset.exportOverride === 'true',
    candidate: cell.dataset.candidate || '',
    rawText: cell.dataset.rawOcr || cellText(cell),
    imageCrop: cell.dataset.imageCrop || null,
  }, { text: cellText(cell), confidence: confidence(cell) });
}

function applyReviewDataset(cell, review) {
  cell.dataset.reviewStatus = review.status;
  cell.dataset.verifiedStatus = review.status;
  cell.dataset.issueType = review.issueType || '';
  cell.dataset.displayLabel = review.displayLabel || '';
  cell.dataset.confidence = String(review.confidence ?? confidence(cell));
  cell.dataset.includeInExport = String(Boolean(review.includeInExport));
  cell.dataset.confirmed = String(Boolean(review.confirmed));
  cell.dataset.reviewed = String(Boolean(review.reviewed));
  cell.dataset.exportOverride = String(Boolean(review.userOverride));
  cell.dataset.candidate = review.candidate || '';
  if (!cell.dataset.rawOcr) cell.dataset.rawOcr = review.rawText || cellText(cell);
  cell.classList.toggle('verified-cell', review.status === REVIEW_STATUSES.VERIFIED);
  cell.classList.toggle('review-cell', review.status === REVIEW_STATUSES.REVIEW_REQUIRED);
  cell.classList.toggle('possible-cell', review.status === REVIEW_STATUSES.POSSIBLE_TEXT);
  cell.classList.toggle('manual-cell', review.status === REVIEW_STATUSES.GIBBERISH);
  cell.classList.toggle('excluded-cell', [REVIEW_STATUSES.CONFIRMED_NON_TEXT, REVIEW_STATUSES.REJECTED].includes(review.status));
}

function validate(panel) {
  const table = $('.detected-table', panel);
  if (!table) return null;
  const structure = tableRecords(table);
  const headers = Array.from({ length: structure.columns }, (_, column) => structure.grid[0]?.[column]?.text || '');
  const types = headers.map((header, column) => inferColumnType(header, structure.grid.slice(1).map(row => row?.[column]?.text || '')));
  const issues = [];
  structure.records.forEach(record => {
    const text = normalizeThaiUnicode(record.text).normalizedText;
    const columnType = types[record.columnIndex]?.type || 'mixed_text';
    const neighbors = structure.records.filter(other => Math.abs(other.rowIndex - record.rowIndex) + Math.abs(other.columnIndex - record.columnIndex) === 1).map(other => other.text);
    const empty = assessEmptyCell({ text, wordCount: text ? text.split(/\s+/u).length : 0 });
    const contamination = detectCellContamination({ text, neighboringTexts: neighbors, columnType, confidence: record.confidence });
    const strictType = columnType === 'running_number' ? 'integer' : columnType;
    const numeric = ['integer', 'decimal', 'currency', 'percentage', 'date', 'time'].includes(strictType) ? validateStrictNumber(text, strictType) : null;
    const phone = validatePhoneNumber(text);
    const thai = difficultThaiIssues(text, { confidence: record.confidence, nearTableLine: true, smallCell: text.length > 30, dictionary: dictionary() });
    const segments = segmentMixedLanguage(text);
    const strictKind = strictPreservationKind(text);
    const breakdown = confidenceBreakdown({
      ocrConfidence: record.confidence,
      providerAgreement: record.confidence,
      scriptConfidence: segments.some(segment => segment.type === 'unknown') ? .55 : .96,
      imageQuality: record.confidence,
      dictionarySupport: thai.length ? .5 : 1,
      documentRepetitionSupport: .6,
      formatValidation: numeric ? (numeric.valid && !numeric.ambiguous ? 1 : .2) : strictKind ? 1 : .9,
      structureConflict: contamination.contaminated,
    }, numeric ? 'numeric' : strictKind ? 'code' : thai.length ? 'difficult_thai' : 'general');

    const generated = createReviewRecord({
      text,
      confidence: breakdown.finalConfidence,
      providerAgreement: record.confidence,
      boundingBoxConsistent: !contamination.reasons.includes('bounding_box_overflow'),
      rawText: record.cell.dataset.rawOcr || text,
      imageCrop: record.cell.dataset.imageCrop || null,
    });
    const previous = persistedReview(record.cell);
    const suggestion = suggestDomainCandidate(text);
    const gibberish = detectGibberish(text, { confidence: breakdown.finalConfidence, providerAgreement: record.confidence, boundingBoxConsistent: !contamination.contaminated });
    const reasons = [];
    let review = { ...generated };

    if (empty.isEmpty && !text) review = { ...review, status: REVIEW_STATUSES.VERIFIED, confirmed: true, reviewed: true, includeInExport: true, issueType: 'empty_cell', candidate: '' };
    if (contamination.contaminated && review.status === REVIEW_STATUSES.VERIFIED) {
      review.status = REVIEW_STATUSES.REVIEW_REQUIRED;
      review.issueType = 'cell_contamination';
      reasons.push('อาจมีข้อความข้าม Cell หรือ Bounding Box ไม่สอดคล้อง');
    }
    if (numeric && (!numeric.valid || numeric.ambiguous)) {
      review.status = REVIEW_STATUSES.REVIEW_REQUIRED;
      review.issueType = numeric.ambiguous ? 'ambiguous_digit' : 'invalid_numeric_pattern';
      review.includeInExport = false;
      reasons.push(numeric.ambiguous ? 'O/0 หรือ I/1 ยังตัดสินไม่ได้' : `รูปแบบ ${strictType} ไม่ถูกต้อง`);
    }
    if (phone.context && !phone.valid) {
      review.status = REVIEW_STATUSES.POSSIBLE_TEXT;
      review.issueType = 'invalid_phone_pattern';
      review.includeInExport = false;
      reasons.push('รูปแบบหมายเลขโทรศัพท์ไม่ถูกต้อง');
    }
    if (gibberish.status === REVIEW_STATUSES.GIBBERISH) {
      review.status = REVIEW_STATUSES.GIBBERISH;
      review.issueType = gibberish.issueType;
      review.includeInExport = false;
      reasons.push('ข้อความมีรูปแบบ OCR มั่วสูง');
    }
    if (thai.length && review.status === REVIEW_STATUSES.VERIFIED) {
      review.status = REVIEW_STATUSES.REVIEW_REQUIRED;
      review.issueType = 'difficult_thai';
      review.includeInExport = false;
      reasons.push('คำไทยยากหรือวรรณยุกต์อยู่ใกล้เส้น');
    }
    if (breakdown.requiresManualReview && review.status === REVIEW_STATUSES.VERIFIED) {
      review.status = REVIEW_STATUSES.REVIEW_REQUIRED;
      review.issueType = review.issueType || 'low_confidence';
      review.includeInExport = false;
      reasons.push('Confidence ยังไม่ถึงเกณฑ์ยืนยัน');
    }
    if (suggestion.changed) review.candidate = suggestion.candidate;

    if (previous.reviewed || previous.userOverride || previous.confirmed) {
      review = {
        ...review,
        status: previous.status,
        confirmed: previous.confirmed,
        reviewed: previous.reviewed,
        includeInExport: previous.includeInExport,
        userOverride: previous.userOverride,
        candidate: previous.candidate || review.candidate,
      };
    }

    review.displayLabel = {
      verified: 'ยืนยันแล้ว',
      review_required: 'ต้องตรวจสอบ',
      possible_text: 'อาจเป็นข้อความ',
      gibberish: 'ข้อความมั่ว',
      confirmed_non_text: 'ไม่ใช่ข้อความ',
      rejected: 'ไม่รวม',
    }[review.status] || review.status;
    review.confidence = breakdown.finalConfidence;
    review.rawText = record.cell.dataset.rawOcr || text;
    applyReviewDataset(record.cell, review);
    issues.push({ ...record, text, review, reasons, columnType, thai, segments, phone, finalConfidence: breakdown.finalConfidence });
  });
  return { table, structure, types, issues };
}

function reviewItem(issue) {
  return {
    type: 'table_cell',
    text: issue.text,
    confidence: issue.review.confidence,
    status: issue.review.status,
    reviewStatus: issue.review.status,
    metadata: { review: issue.review },
  };
}

function outputText(issue, mode = config().outputMode) {
  return cleanTextForItem(reviewItem(issue), { mode, debugLabels: mode === OUTPUT_MODES.DEBUG });
}

function matrixFor(validation, mode) {
  const matrix = Array.from({ length: validation.structure.rows }, () => Array.from({ length: validation.structure.columns }, () => ''));
  validation.issues.forEach(issue => { matrix[issue.rowIndex][issue.columnIndex] = outputText(issue, mode); });
  return matrix;
}

function preview(validation, mode = config().outputMode) {
  const reviews = validation.issues.map(issue => issue.review);
  const ready = validation.issues.filter(issue => outputText(issue, mode) || issue.text === '').length;
  return {
    total: reviews.length,
    ready,
    excluded: reviews.length - ready,
    verified: reviews.filter(review => review.status === REVIEW_STATUSES.VERIFIED).length,
    reviewed: reviews.filter(review => review.status === REVIEW_STATUSES.REVIEW_REQUIRED && review.confirmed).length,
    unverified: reviews.filter(review => review.status === REVIEW_STATUSES.REVIEW_REQUIRED && !review.confirmed).length,
    possibleText: reviews.filter(review => review.status === REVIEW_STATUSES.POSSIBLE_TEXT).length,
    gibberish: reviews.filter(review => review.status === REVIEW_STATUSES.GIBBERISH).length,
  };
}

async function copyValidation(validation, includeUnverified = false) {
  const mode = includeUnverified ? OUTPUT_MODES.INCLUDE_UNVERIFIED : DEFAULT_OUTPUT_MODE;
  const stats = preview(validation, mode);
  if (includeUnverified && (stats.unverified + stats.possibleText + stats.gibberish) > 0) {
    const count = stats.unverified + stats.possibleText + stats.gibberish;
    if (!window.confirm(`ยังมีข้อความ ${count} จุดที่ไม่ได้ยืนยัน ข้อความเหล่านี้อาจไม่ถูกต้อง\n\nต้องการคัดลอกต่อหรือไม่?`)) return;
  }
  const text = matrixFor(validation, mode).map(row => row.join('\t')).join('\n');
  await navigator.clipboard.writeText(text);
  busy(true, includeUnverified ? 'คัดลอกพร้อมข้อความที่ยังไม่ยืนยันแล้ว' : 'คัดลอกข้อความสะอาดแล้ว');
  setTimeout(() => busy(false), 1000);
}

function exportData(validation, format) {
  try {
    const current = config();
    const matrix = matrixFor(validation, current.outputMode);
    let payload;
    let type;
    if (format === 'csv') {
      payload = exportDelimited(matrix, current.delimiter, { bom: true });
      type = 'text/csv;charset=utf-8';
    } else {
      payload = JSON.stringify({
        tableId: 'table-1',
        page: 1,
        outputMode: current.outputMode,
        rows: validation.structure.rows,
        columns: validation.structure.columns,
        cells: validation.issues.map(issue => ({
          row: issue.rowIndex,
          column: issue.columnIndex,
          rowSpan: issue.rowSpan,
          columnSpan: issue.columnSpan,
          text: outputText(issue, current.outputMode),
          ...(current.includeReviewMetadata ? {
            status: issue.review.status,
            confidence: issue.review.confidence,
            issueType: issue.review.issueType,
            includeInExport: issue.review.includeInExport,
            confirmed: issue.review.confirmed,
            rawText: issue.review.rawText,
            candidate: issue.review.candidate,
          } : {}),
        })),
      }, null, 2);
      type = 'application/json;charset=utf-8';
    }
    const blob = new Blob([payload], { type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `ripscan-clean-table.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  } catch (error) { showError(error.message); }
}

function updateIssue(issue, patch) {
  const review = { ...issue.review, ...patch, reviewed: true };
  if (patch.confirmed === true && review.candidate) {
    setCellText(issue.cell, review.candidate);
    issue.text = review.candidate;
  }
  applyReviewDataset(issue.cell, review);
}

function issueCard(issue) {
  const crop = issue.review.imageCrop ? `<img src="${escapeHtml(issue.review.imageCrop)}" alt="Image crop">` : '';
  return `<article class="review-item" data-review-cell="${escapeHtml(issue.cell.dataset.cellId)}">
    <div class="review-item-head"><strong>แถว ${issue.rowIndex + 1} คอลัมน์ ${issue.columnIndex + 1}</strong><span>${escapeHtml(issue.review.displayLabel)}</span></div>
    ${crop}
    <dl>
      <div><dt>Raw OCR</dt><dd>${escapeHtml(issue.review.rawText || issue.text || '[ว่าง]')}</dd></div>
      <div><dt>Candidate</dt><dd>${escapeHtml(issue.review.candidate || issue.text || '[ไม่มี]')}</dd></div>
      <div><dt>Status</dt><dd>${escapeHtml(issue.review.status)}</dd></div>
      <div><dt>Confidence</dt><dd>${Math.round(issue.review.confidence * 100)}%</dd></div>
      <div><dt>Issue Type</dt><dd>${escapeHtml(issue.review.issueType || '-')}</dd></div>
    </dl>
    <div class="actions">
      <button data-review-action="confirm">ยืนยัน</button>
      <button data-review-action="edit">แก้ไข</button>
      <button data-review-action="non-text">ไม่ใช่ข้อความ</button>
      <button data-review-action="include">${issue.review.includeInExport ? 'ไม่รวมในการส่งออก' : 'รวมในการส่งออก'}</button>
    </div>
  </article>`;
}

function renderReview(panel) {
  const validation = validate(panel);
  if (!validation) return;
  panel.querySelector('.verified-review')?.remove();
  const review = document.createElement('section');
  review.className = 'verified-review';
  const warnings = validation.issues.filter(issue => issue.review.status !== REVIEW_STATUSES.VERIFIED || !issue.review.confirmed);
  const difficult = validation.issues.flatMap(issue => issue.thai.map(word => ({ ...word, issue })));
  const stats = preview(validation);
  review.innerHTML = `
    <div class="verified-head">
      <div><strong>Review Panel</strong><small>Raw OCR · Candidate · Status · Confidence · Crop แยกจากข้อความจริง</small></div>
      <div class="verified-metrics"><span>ทั้งหมด ${stats.total}</span><span>พร้อมส่งออก ${stats.ready}</span><span>ตัดออก ${stats.excluded}</span></div>
    </div>
    <div class="export-preview">
      <strong>Export Preview</strong>
      <span>Verified ${stats.verified}</span><span>Reviewed ${stats.reviewed}</span><span>ยังไม่ยืนยัน ${stats.unverified}</span><span>Possible ${stats.possibleText}</span><span>Gibberish ${stats.gibberish}</span>
    </div>
    <div class="verified-tabs"><button class="active" data-tab="issues">จุดต้องตรวจ</button><button data-tab="thai">คำไทยอ่านยาก</button><button data-tab="export">Copy / Export</button></div>
    <div data-view="issues" class="verified-list">${warnings.length ? warnings.map(issueCard).join('') : '<p>ข้อความทั้งหมดพร้อมส่งออก</p>'}</div>
    <div data-view="thai" hidden class="verified-words">${difficult.length ? difficult.map(item => `<div><button data-focus-cell="${escapeHtml(item.issue.cell.dataset.cellId)}"><strong>${escapeHtml(item.word)}</strong><small>${escapeHtml(item.reasons.join(', '))}</small></button><button data-word="${escapeHtml(item.word)}">เพิ่มพจนานุกรม</button></div>`).join('') : '<p>ไม่พบคำไทยที่เข้าเกณฑ์ตรวจเข้ม</p>'}</div>
    <div data-view="export" hidden>
      <p>ค่าเริ่มต้นส่งออกเฉพาะ Verified และ Review ที่ยืนยันแล้ว โดยไม่มี Review Marker ในข้อความ</p>
      <div class="actions">
        <button data-copy="clean">คัดลอกข้อความสะอาด</button>
        <button data-copy="unverified">คัดลอกพร้อมข้อความที่ยังไม่ยืนยัน</button>
        <button data-export="csv">CSV</button>
        <button data-export="json">JSON</button>
      </div>
    </div>`;
  panel.append(review);

  review.onclick = async event => {
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      $$('[data-tab]', review).forEach(button => button.classList.toggle('active', button === tab));
      $$('[data-view]', review).forEach(view => { view.hidden = view.dataset.view !== tab.dataset.tab; });
      return;
    }
    const word = event.target.closest('[data-word]');
    if (word) { addDictionary(word.dataset.word); word.textContent = 'เพิ่มแล้ว'; renderReview(panel); return; }
    const focus = event.target.closest('[data-focus-cell]');
    if (focus) {
      const cell = panel.querySelector(`[data-cell-id="${CSS.escape(focus.dataset.focusCell)}"]`);
      cell?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      cell?.classList.add('verified-flash');
      setTimeout(() => cell?.classList.remove('verified-flash'), 1200);
      return;
    }
    const item = event.target.closest('[data-review-cell]');
    const action = event.target.closest('[data-review-action]')?.dataset.reviewAction;
    if (item && action) {
      const issue = validation.issues.find(candidate => candidate.cell.dataset.cellId === item.dataset.reviewCell);
      if (!issue) return;
      if (action === 'confirm') updateIssue(issue, { confirmed: true, includeInExport: true, userOverride: true, status: issue.review.status === REVIEW_STATUSES.GIBBERISH ? REVIEW_STATUSES.REVIEW_REQUIRED : issue.review.status });
      if (action === 'edit') {
        const node = contentNode(issue.cell);
        node?.setAttribute?.('contenteditable', 'true');
        node?.focus?.();
        return;
      }
      if (action === 'non-text') updateIssue(issue, { status: REVIEW_STATUSES.CONFIRMED_NON_TEXT, confirmed: true, includeInExport: false, userOverride: true });
      if (action === 'include') updateIssue(issue, { includeInExport: !issue.review.includeInExport, userOverride: true, confirmed: issue.review.confirmed });
      renderReview(panel);
      return;
    }
    const copy = event.target.closest('[data-copy]')?.dataset.copy;
    if (copy) {
      try { await copyValidation(validation, copy === 'unverified'); }
      catch (error) { showError(error.message); }
      return;
    }
    const format = event.target.closest('[data-export]')?.dataset.export;
    if (format) exportData(validation, format);
  };
}

function enhancePanel(panel) {
  if (!panel || enhanced.has(panel) || !$('.detected-table', panel)) return;
  enhanced.add(panel);
  renderReview(panel);
  $('.detected-table', panel).addEventListener('input', () => {
    clearTimeout(panel.__reviewTimer);
    panel.__reviewTimer = setTimeout(() => renderReview(panel), 250);
  });
}

function enhanceCard(card) {
  if (!card || cards.has(card)) return;
  cards.add(card);
  const tables = $$('.detected-table', card);
  tables.forEach(table => enhancePanel(table.closest('.result-panel, .table-panel, section, article, div') || card));
}

function scan() {
  installControls();
  if (!results) return;
  $$('.result-card, .result-item, [data-result-card]', results).forEach(enhanceCard);
  $$('.detected-table', results).forEach(table => enhancePanel(table.closest('.result-panel, .table-panel, section, article, div') || table.parentElement));
}

if (results) new MutationObserver(scan).observe(results, { childList: true, subtree: true });
window.addEventListener('DOMContentLoaded', scan, { once: true });
scan();
