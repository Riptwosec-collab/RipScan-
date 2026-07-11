import {
  assessEmptyCell,
  buildTableModel,
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

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const results = $('#results');
const statusBox = $('#status');
const statusText = $('#statusText');
const errorBox = $('#error');
const language = $('#language');
const enhanced = new WeakSet();
const cards = new WeakSet();

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const showError = message => { errorBox.textContent = message; errorBox.hidden = false; };
const busy = (active, message = '') => { statusBox.hidden = !active; if (message) statusText.textContent = message; };

function config() {
  return {
    tableMode: localStorage.getItem('ripscan-table-mode') || 'accurate',
    exportPolicy: localStorage.getItem('ripscan-export-policy') || 'mark_review',
    delimiter: localStorage.getItem('ripscan-delimiter') || ',',
  };
}

function installControls() {
  const anchor = $('.advanced-controls');
  if (!anchor || $('#tableMode')) return;
  const current = config();
  const panel = document.createElement('div');
  panel.className = 'verified-controls';
  panel.innerHTML = `<label>โหมดตาราง<select id="tableMode"><option value="auto">Auto Detect</option><option value="accurate">Table Accurate</option><option value="ultra">Table Ultra Verified</option><option value="manual">Manual Grid</option></select></label><label>ส่งออก<select id="verifiedExportPolicy"><option value="all">ทั้งหมด</option><option value="verified_only">เฉพาะที่ยืนยันแล้ว</option><option value="mark_review">ทำเครื่องหมายจุดต้องตรวจ</option><option value="block_red">ห้ามส่งออกเมื่อมีสีแดง</option></select></label><label>CSV<select id="verifiedDelimiter"><option value=",">Comma</option><option value=";">Semicolon</option><option value="\t">Tab</option></select></label><small>ไม่ย้ายข้อความข้าม Cell · ไม่เติม Cell ว่าง · ไม่เดาชื่อ ตัวเลข หรือรหัส</small>`;
  anchor.after(panel);
  $('#tableMode').value = current.tableMode;
  $('#verifiedExportPolicy').value = current.exportPolicy;
  $('#verifiedDelimiter').value = current.delimiter;
  $('#tableMode').onchange = event => localStorage.setItem('ripscan-table-mode', event.target.value);
  $('#verifiedExportPolicy').onchange = event => localStorage.setItem('ripscan-export-policy', event.target.value);
  $('#verifiedDelimiter').onchange = event => localStorage.setItem('ripscan-delimiter', event.target.value);
}

function cellText(cell) { return $('span', cell)?.textContent ?? ''; }
function confidence(cell) { const number = Number($('small', cell)?.textContent?.match(/[\d.]+/)?.[0]); return Number.isFinite(number) ? number / 100 : .5; }

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

function dictionary() {
  try { return JSON.parse(localStorage.getItem('ripscan-custom-dictionary') || '[]'); }
  catch { return []; }
}

function addDictionary(word) {
  const words = dictionary();
  if (!words.includes(word)) words.push(word);
  localStorage.setItem('ripscan-custom-dictionary', JSON.stringify(words.slice(-1000)));
}

function validate(panel) {
  const table = $('.detected-table', panel);
  const structure = tableRecords(table);
  const headers = Array.from({ length: structure.columns }, (_, column) => structure.grid[0]?.[column]?.text || '');
  const types = headers.map((header, column) => inferColumnType(header, structure.grid.slice(1).map(row => row?.[column]?.text || '')));
  const issues = [];
  structure.records.forEach(record => {
    const text = normalizeThaiUnicode(record.text).normalizedText;
    const columnType = types[record.columnIndex]?.type || 'mixed_text';
    const neighbors = structure.records.filter(other => Math.abs(other.rowIndex - record.rowIndex) + Math.abs(other.columnIndex - record.columnIndex) === 1).map(other => other.text);
    const empty = assessEmptyCell({ text, wordCount: text ? text.split(/\s+/).length : 0 });
    const contamination = detectCellContamination({ text, neighboringTexts: neighbors, columnType, confidence: record.confidence });
    const strictType = columnType === 'running_number' ? 'integer' : columnType;
    const numeric = ['integer', 'decimal', 'currency', 'percentage', 'date', 'time'].includes(strictType) ? validateStrictNumber(text, strictType) : null;
    const thai = difficultThaiIssues(text, { confidence: record.confidence, nearTableLine: true, smallCell: text.length > 30, dictionary: dictionary() });
    const segments = segmentMixedLanguage(text);
    const strictKind = strictPreservationKind(text);
    const breakdown = confidenceBreakdown({ ocrConfidence: record.confidence, providerAgreement: record.confidence, scriptConfidence: segments.some(segment => segment.type === 'unknown') ? .55 : .96, imageQuality: record.confidence, dictionarySupport: thai.length ? .5 : 1, documentRepetitionSupport: .6, formatValidation: numeric ? (numeric.valid && !numeric.ambiguous ? 1 : .2) : strictKind ? 1 : .9, structureConflict: contamination.contaminated }, numeric ? 'numeric' : strictKind ? 'code' : thai.length ? 'difficult_thai' : 'general');
    let status = 'verified';
    const reasons = [];
    if (empty.isEmpty) status = 'empty';
    else if (empty.status === 'possibly_empty') { status = 'possibly_empty'; reasons.push('Cell อาจว่าง ระบบไม่เติมค่าให้'); }
    if (contamination.contaminated) { status = 'contaminated'; reasons.push('อาจมีข้อความข้าม Cell หรือผิดประเภทคอลัมน์'); }
    if (numeric && (!numeric.valid || numeric.ambiguous)) { status = 'manual_review_required'; reasons.push(numeric.ambiguous ? 'O/0 หรือ I/1 ยังตัดสินไม่ได้' : `รูปแบบ ${strictType} ไม่ถูกต้อง`); }
    if (thai.length && status === 'verified') { status = 'review_recommended'; reasons.push('คำไทยยากหรือวรรณยุกต์อยู่ใกล้เส้น'); }
    if (breakdown.requiresManualReview && status === 'verified') status = 'review_recommended';
    record.cell.dataset.verifiedStatus = status;
    record.cell.dataset.columnType = columnType;
    record.cell.classList.toggle('verified-cell', status === 'verified');
    record.cell.classList.toggle('empty-cell', status === 'empty');
    record.cell.classList.toggle('review-cell', ['possibly_empty', 'review_recommended'].includes(status));
    record.cell.classList.toggle('manual-cell', ['contaminated', 'manual_review_required'].includes(status));
    issues.push({ ...record, text, status, reasons, columnType, thai, segments, finalConfidence: breakdown.finalConfidence });
  });
  return { table, structure, types, issues };
}

function outputText(issue) {
  const policy = config().exportPolicy;
  const verified = ['verified', 'empty'].includes(issue.status);
  if (policy === 'verified_only' && !verified) return '';
  if (policy === 'mark_review' && !verified) return `[โปรดตรวจสอบ: ${issue.text || 'อ่านไม่ชัด'}]`;
  if (policy === 'block_red' && ['contaminated', 'manual_review_required'].includes(issue.status)) throw new Error('ยังมี Cell สีแดง กรุณาตรวจก่อนส่งออก');
  return issue.text;
}

function exportData(validation, format) {
  try {
    const matrix = Array.from({ length: validation.structure.rows }, () => Array.from({ length: validation.structure.columns }, () => ''));
    validation.issues.forEach(issue => { matrix[issue.rowIndex][issue.columnIndex] = outputText(issue); });
    const model = buildTableModel(matrix, { tableId: 'table-1', page: 1 });
    validation.issues.forEach(issue => {
      const cell = model.rows[issue.rowIndex]?.cells[issue.columnIndex];
      if (!cell) return;
      cell.rowSpan = issue.rowSpan; cell.columnSpan = issue.columnSpan; cell.status = issue.status; cell.confidence = issue.finalConfidence; cell.columnType = issue.columnType; cell.languageSegments = issue.segments;
    });
    const blob = format === 'csv' ? new Blob([exportDelimited(matrix, config().delimiter, { bom: true })], { type: 'text/csv;charset=utf-8' }) : new Blob([JSON.stringify(model, null, 2)], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `ripscan-verified-table.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  } catch (error) { showError(error.message); }
}

function renderReview(panel) {
  const validation = validate(panel);
  panel.querySelector('.verified-review')?.remove();
  const review = document.createElement('section');
  review.className = 'verified-review';
  const warnings = validation.issues.filter(issue => !['verified', 'empty'].includes(issue.status));
  const difficult = validation.issues.flatMap(issue => issue.thai.map(word => ({ ...word, issue })));
  review.innerHTML = `<div class="verified-head"><div><strong>ตรวจสอบตาราง</strong><small>Column Type · Empty Cell · Numeric Strict · ไทย–อังกฤษ · Cross-Cell</small></div><div class="verified-metrics"><span>Cell ${validation.issues.length}</span><span>ต้องตรวจ ${warnings.length}</span><span>สีแดง ${warnings.filter(issue => ['contaminated','manual_review_required'].includes(issue.status)).length}</span></div></div><div class="verified-tabs"><button class="active" data-tab="issues">จุดต้องตรวจ</button><button data-tab="thai">คำไทยอ่านยาก</button><button data-tab="export">ส่งออก</button></div><div data-view="issues" class="verified-list">${warnings.length ? warnings.map(issue => `<button data-cell="${escapeHtml(issue.cell.dataset.cellId || '')}"><strong>แถว ${issue.rowIndex + 1} คอลัมน์ ${issue.columnIndex + 1}</strong><span>${escapeHtml(issue.text || '[ว่าง]')}</span><small>${escapeHtml(issue.reasons.join(' · ') || issue.status)}</small></button>`).join('') : '<p>ไม่พบ Cell ที่ผิดกฎ แต่ยังควรตรวจเทียบต้นฉบับ</p>'}</div><div data-view="thai" hidden class="verified-words">${difficult.length ? difficult.map(item => `<div><button data-cell="${escapeHtml(item.issue.cell.dataset.cellId || '')}"><strong>${escapeHtml(item.word)}</strong><small>${escapeHtml(item.reasons.join(', '))}</small></button><button data-word="${escapeHtml(item.word)}">เพิ่มพจนานุกรม</button></div>`).join('') : '<p>ไม่พบคำไทยที่เข้าเกณฑ์ตรวจเข้ม</p>'}</div><div data-view="export" hidden><p>CSV รองรับ UTF-8 BOM, Empty Cell, Line Break และเลขศูนย์นำหน้า ส่วน JSON เก็บ Row/Column Span และ Confidence</p><div class="actions"><button data-export="csv">CSV</button><button data-export="json">JSON</button></div></div>`;
  panel.append(review);
  review.onclick = event => {
    const tab = event.target.closest('[data-tab]');
    if (tab) { $$('[data-tab]', review).forEach(button => button.classList.toggle('active', button === tab)); $$('[data-view]', review).forEach(view => { view.hidden = view.dataset.view !== tab.dataset.tab; }); }
    const focus = event.target.closest('[data-cell]');
    if (focus) { const cell = panel.querySelector(`[data-cell-id="${CSS.escape(focus.dataset.cell)}"]`); cell?.scrollIntoView({ behavior: 'smooth', block: 'center' }); cell?.classList.add('verified-flash'); setTimeout(() => cell?.classList.remove('verified-flash'), 1200); }
    const word = event.target.closest('[data-word]');
    if (word) { addDictionary(word.dataset.word); word.textContent = 'เพิ่มแล้ว'; renderReview(panel); }
    const format = event.target.closest('[data-export]')?.dataset.export;
    if (format) exportData(validation, format);
  };
}

function enhancePanel(panel) {
  if (enhanced.has(panel) || !$('.detected-table', panel)) return;
  enhanced.add(panel);
  renderReview(panel);
  $('.detected-table', panel).addEventListener('input', () => { clearTimeout(panel.__reviewTimer); panel.__reviewTimer = setTimeout(() => renderReview(panel), 250); });
}

function enhanceCard(card) {
  if (cards.has(card) || !card.dataset.pageManagerReady) return;
  cards.add(card);
  const bulk = $('.bulk-actions', card);
  if (bulk) bulk.insertAdjacentHTML('afterbegin', '<button data-verified-action="mixed">ตรวจไทย–อังกฤษหน้าที่เลือก</button>');
  $$('.page-card', card).forEach(page => $('.page-actions', page)?.insertAdjacentHTML('beforeend', '<button data-verified-page="mixed">ตรวจไทย–อังกฤษ</button>'));
}

function mixedReview(page) {
  const text = $('.page-text', page)?.value || '';
  const normalized = normalizeThaiUnicode(text);
  const segments = segmentMixedLanguage(normalized.normalizedText);
  const thai = difficultThaiIssues(normalized.normalizedText, { confidence: .9, dictionary: dictionary() });
  page.querySelector('.mixed-review')?.remove();
  const view = document.createElement('section'); view.className = 'mixed-review';
  view.innerHTML = `<div class="verified-head"><div><strong>ตรวจภาษาไทย–อังกฤษผสม</strong><small>ไม่แปล ไม่เรียบเรียง และไม่แก้ชื่อ/ตัวเลขจากบริบท</small></div></div><div class="segments">${segments.map(segment => `<span class="segment-${escapeHtml(segment.type)}">${escapeHtml(segment.text || '␠')}</span>`).join('')}</div><p>พบคำไทยที่ควรตรวจ ${thai.length} จุด · Unicode changes ${normalized.normalizationChanges.length}</p>${thai.length ? `<div class="verified-words">${thai.map(item => `<div><strong>${escapeHtml(item.word)}</strong><small>${escapeHtml(item.reasons.join(', '))}</small><button data-word="${escapeHtml(item.word)}">เพิ่มพจนานุกรม</button></div>`).join('')}</div>` : ''}<label>ภาษาเฉพาะหน้านี้<select class="page-language"><option value="auto">อัตโนมัติ</option><option value="th">ไทย</option><option value="en">อังกฤษ</option><option value="mixed">ไทยและอังกฤษ</option><option value="numeric">ตัวเลขและรหัส</option></select></label>`;
  $('.page-language', view).value = page.dataset.languageOverride || 'auto';
  $('.page-language', view).onchange = event => { page.dataset.languageOverride = event.target.value; };
  view.onclick = event => { const button = event.target.closest('[data-word]'); if (button) { addDictionary(button.dataset.word); button.textContent = 'เพิ่มแล้ว'; } };
  page.append(view);
}

function selectedPages(card) {
  const ids = new Set($$('.thumbnail-card', card).filter(item => $('input', item)?.checked).map(item => item.dataset.pageId));
  return $$('.page-card', card).filter(page => ids.has(page.dataset.managedId));
}

results.addEventListener('click', event => {
  const bulk = event.target.closest('[data-verified-action="mixed"]');
  if (bulk) { const pages = selectedPages(bulk.closest('.result-card')); if (!pages.length) return showError('กรุณาเลือกอย่างน้อย 1 หน้า'); pages.forEach(mixedReview); }
  const pageButton = event.target.closest('[data-verified-page="mixed"]');
  if (pageButton) mixedReview(pageButton.closest('.page-card'));
});

function scan() { installControls(); $$('.result-card', results).forEach(enhanceCard); $$('.analysis-panel', results).forEach(enhancePanel); }
new MutationObserver(scan).observe(results, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-page-manager-ready'] });
scan();
document.documentElement.dataset.verifiedVersion = '1.5.0';
