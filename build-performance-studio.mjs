import { readFile, writeFile } from 'node:fs/promises';

function replaceRequired(source, search, replacement, label) {
  const result = source.replace(search, replacement);
  if (result === source) throw new Error(`Studio performance patch failed: ${label}`);
  return result;
}

const path = 'dist/document-studio.js';
let source = await readFile(path, 'utf8');

source = replaceRequired(
  source,
  "const MAX_HISTORY = 50;",
  "const MAX_HISTORY = 50;\nconst SAFE_HISTORY = 20;\nconst THUMBNAIL_WINDOW = 12;",
  'studio limits',
);

const snapshotPattern = /function snapshot\(label = 'แก้ไข'\) \{[\s\S]*?\n\}\n\nfunction undo\(\) \{[\s\S]*?\n\}\n\nfunction redo\(\) \{[\s\S]*?\n\}/;
const snapshotReplacement = [
  "function historyLimit() { return window.RipScanPerformanceRuntime?.state?.safeMode ? SAFE_HISTORY : MAX_HISTORY; }",
  '',
  "function fullHistoryRequired(label = '') { return /เพิ่มหน้า|ลบหน้า|ย้ายหน้า|รวมเอกสาร|นำเข้า/u.test(label); }",
  '',
  "function captureHistory(label = 'แก้ไข', kind = fullHistoryRequired(label) ? 'model' : 'page', pageIndex = state.activePage) {",
  '  if (!state.model) return null;',
  "  if (kind === 'model') return { kind, label, model: cloneValue(state.model), activePage: state.activePage, selectedBlockId: state.selectedBlockId };",
  '  const page = state.model.pages[pageIndex];',
  '  return page ? { kind, label, pageIndex, page: cloneValue(page), activePage: state.activePage, selectedBlockId: state.selectedBlockId } : null;',
  '}',
  '',
  'function pushHistory(target, entry) {',
  '  if (!entry) return;',
  '  target.push(entry);',
  '  const limit = historyLimit();',
  '  if (target.length > limit) target.splice(0, target.length - limit);',
  '}',
  '',
  "function snapshot(label = 'แก้ไข') {",
  '  if (!state.model) return;',
  '  pushHistory(state.history, captureHistory(label));',
  '  state.future = [];',
  '  state.dirty = true;',
  '  updateHistoryButtons();',
  '}',
  '',
  'function applyHistory(entry) {',
  '  if (!entry || !state.model) return;',
  "  if (entry.kind === 'model') state.model = normalizeDocumentModel(entry.model);",
  '  else if (state.model.pages[entry.pageIndex]) state.model.pages[entry.pageIndex] = cloneValue(entry.page);',
  '  state.activePage = Math.max(0, Math.min(entry.activePage, state.model.pages.length - 1));',
  '  state.selectedBlockId = entry.selectedBlockId;',
  '  state.selectedCellIds.clear();',
  '  state.dirty = true;',
  '  renderStudio();',
  '}',
  '',
  'function undo() {',
  '  const previous = state.history.pop();',
  '  if (!previous || !state.model) return;',
  '  pushHistory(state.future, captureHistory(previous.label, previous.kind, previous.pageIndex ?? state.activePage));',
  '  applyHistory(previous);',
  '}',
  '',
  'function redo() {',
  '  const next = state.future.pop();',
  '  if (!next || !state.model) return;',
  '  pushHistory(state.history, captureHistory(next.label, next.kind, next.pageIndex ?? state.activePage));',
  '  applyHistory(next);',
  '}',
].join('\n');
source = replaceRequired(source, snapshotPattern, snapshotReplacement, 'page-level patch history');

source = replaceRequired(
  source,
  "    if (event.target.matches('[contenteditable=\"true\"]') && state.model) state.editingSnapshot = cloneValue(state.model);",
  "    if (event.target.matches('[contenteditable=\"true\"]') && state.model) state.editingSnapshot = captureHistory('แก้ข้อความ', 'page', state.activePage);",
  'editing page snapshot',
);
source = replaceRequired(
  source,
  [
    "    const before = JSON.stringify(state.editingSnapshot);",
    "    const after = JSON.stringify(state.model);",
    "    if (before !== after) {",
    "      state.history.push({ label: 'แก้ข้อความ', model: state.editingSnapshot, activePage: state.activePage, selectedBlockId: state.selectedBlockId });",
    "      if (state.history.length > MAX_HISTORY) state.history.shift();",
    "      state.future = [];",
    "      state.dirty = true;",
    "      updateHistoryButtons();",
    "    }",
  ].join('\n'),
  [
    '    const before = JSON.stringify(state.editingSnapshot.page);',
    '    const after = JSON.stringify(currentPage());',
    '    if (before !== after) {',
    '      pushHistory(state.history, state.editingSnapshot);',
    '      state.future = [];',
    '      state.dirty = true;',
    '      updateHistoryButtons();',
    '    }',
  ].join('\n'),
  'editing history comparison',
);

source = replaceRequired(
  source,
  "  const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');\n  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';",
  "  const pdfjs = await import('./lazy-libraries.mjs').then(module => module.loadPdfJs());",
  'Studio lazy PDF.js',
);
source = replaceRequired(
  source,
  "  const documentModel = createDocument({ name: file.name, sourceType: 'pdf', metadata: { visualSource: true, pageCount: pdf.numPages } });\n  try {\n    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {",
  [
    "  const safeMode = window.RipScanPerformanceRuntime?.state?.safeMode || file.size > 20 * 1024 * 1024 || pdf.numPages > 20;",
    "  if (safeMode) window.RipScanPerformanceRuntime?.enterSafeMode?.('studio_large_pdf', { pageCount: pdf.numPages, fileSize: file.size });",
    '  const pageLimit = safeMode ? 1 : pdf.numPages;',
    "  const documentModel = createDocument({ name: file.name, sourceType: 'pdf', metadata: { visualSource: true, pageCount: pdf.numPages, importedPages: pageLimit, safeMode, hasRemainingPages: pageLimit < pdf.numPages } });",
    '  try {',
    '    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {',
  ].join('\n'),
  'Studio progressive PDF import',
);
source = source.replace('      canvas.width = 1;\n      canvas.height = 1;', '      canvas.width = 0;\n      canvas.height = 0;');

source = replaceRequired(
  source,
  "  $('#studioPageList').innerHTML = state.model.pages.map(pageThumbnailHtml).join('');",
  [
    '  const thumbStart = Math.max(0, state.activePage - THUMBNAIL_WINDOW);',
    '  const thumbEnd = Math.min(state.model.pages.length, state.activePage + THUMBNAIL_WINDOW + 1);',
    "  $('#studioPageList').innerHTML = state.model.pages.slice(thumbStart, thumbEnd).map((page, offset) => pageThumbnailHtml(page, thumbStart + offset)).join('');",
  ].join('\n'),
  'thumbnail virtualization',
);

const pointerPattern = /function startBlockPointer\(event, mode\) \{[\s\S]*?\n\}/;
const pointerReplacement = [
  'function startBlockPointer(event, mode) {',
  '  event.preventDefault(); event.stopPropagation();',
  "  const element = event.target.closest('.studio-block');",
  '  const block = findBlock(state.model, element?.dataset.blockId)?.block;',
  '  if (!element || !block || block.locked) return;',
  "  snapshot(mode === 'move' ? 'ย้าย Block' : 'ปรับขนาด Block');",
  '  state.selectedBlockId = block.id;',
  '  const start = { x: event.clientX, y: event.clientY, blockX: block.x, blockY: block.y, width: block.width, height: block.height };',
  '  event.target.setPointerCapture?.(event.pointerId);',
  '  let frame = 0;',
  '  let latest = event;',
  '  const paint = () => {',
  '    frame = 0;',
  '    const dx = (latest.clientX - start.x) / state.zoom;',
  '    const dy = (latest.clientY - start.y) / state.zoom;',
  "    if (mode === 'move') { block.x = Math.max(0, start.blockX + dx); block.y = Math.max(0, start.blockY + dy); }",
  '    else { block.width = Math.max(24, start.width + dx); block.height = Math.max(20, start.height + dy); }',
  "    element.style.transform = 'translate3d(' + (block.x - start.blockX) + 'px,' + (block.y - start.blockY) + 'px,0)';",
  "    if (mode === 'resize') { element.style.width = block.width + 'px'; element.style.height = block.height + 'px'; }",
  '  };',
  '  const move = moveEvent => { latest = moveEvent; if (!frame) frame = requestAnimationFrame(paint); };',
  '  const up = () => {',
  "    window.removeEventListener('pointermove', move);",
  "    window.removeEventListener('pointerup', up);",
  '    if (frame) { cancelAnimationFrame(frame); paint(); }',
  "    element.style.transform = 'rotate(' + (block.rotation || 0) + 'deg)';",
  "    element.style.left = block.x + 'px'; element.style.top = block.y + 'px';",
  '    state.dirty = true;',
  '    renderProperties();',
  '  };',
  "  window.addEventListener('pointermove', move, { passive: true });",
  "  window.addEventListener('pointerup', up, { once: true });",
  '}',
].join('\n');
source = replaceRequired(source, pointerPattern, pointerReplacement, 'rAF drag resize');

source = replaceRequired(
  source,
  "function renderExportPages() {\n  const stage = $('#studioExportStage');\n  stage.innerHTML = state.model.pages.map(page => renderPageElement(page, { exportMode: true })).join('');",
  "function renderExportPages(selectedPages = state.model.pages.map((_, index) => index)) {\n  const stage = $('#studioExportStage');\n  stage.innerHTML = selectedPages.map(index => state.model.pages[index]).filter(Boolean).map(page => renderPageElement(page, { exportMode: true })).join('');",
  'selected export pages only',
);
source = replaceRequired(source, '    const elements = renderExportPages();', '    const elements = renderExportPages(options.selectedPages);', 'export selected call');

source = replaceRequired(
  source,
  "function closeStudio() {\n  if (state.dirty && !confirm('มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการปิด Document Studio หรือไม่?')) return;\n  $('#documentStudio').hidden = true;\n  document.body.classList.remove('studio-open');\n}",
  [
    'function closeStudio() {',
    "  if (state.dirty && !confirm('มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการปิด Document Studio หรือไม่?')) return;",
    "  $('#documentStudio').hidden = true;",
    "  document.body.classList.remove('studio-open');",
    '  state.history = []; state.future = []; state.editingSnapshot = null;',
    "  window.dispatchEvent(new CustomEvent('ripscan:document-close'));",
    '}',
  ].join('\n'),
  'Studio close cleanup',
);

await writeFile(path, source, 'utf8');
console.log('RipScan Document Studio performance patch: page-level history, safe PDF import, virtual thumbnails, rAF drag and selected-page export');
