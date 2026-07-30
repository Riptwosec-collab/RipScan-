import { modelToDocxBlob, modelToXlsxBlob } from './editor-export.mjs';
import { ocrRowsToDocumentModel, tableRecordsToBlock } from './ocr-layout.mjs';

const results = document.querySelector('#results');
const languageSelect = document.querySelector('#language');
const statusBox = document.querySelector('#status');
const statusText = document.querySelector('#statusText');
const errorBox = document.querySelector('#error');
const managed = new Map();
const urls = new Set();
let dragInfo = null;

const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const safeName = value => String(value || 'ripscan').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-');
const showError = message => { errorBox.textContent = message; errorBox.hidden = false; };
const clearError = () => { errorBox.hidden = true; };
const busy = (active, text = '') => { statusBox.hidden = !active; if (text) statusText.textContent = text; };
const remember = url => { if (url?.startsWith('blob:')) urls.add(url); return url; };

function pageText(page) { return page.textarea?.value || ''; }
function pageImage(page) { return page.image?.src || ''; }
function getState(card) { return managed.get(card); }
function selectedPages(state, onlySelected = false) { return onlySelected ? state.pages.filter(page => page.selected) : state.pages; }
function downloadBlob(blob, filename) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.hidden = true; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }
function downloadText(text, filename, type = 'text/plain;charset=utf-8') { downloadBlob(new Blob([text], { type }), filename); }
function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }

function makePage(card, pageCard, index) {
  const id = crypto.randomUUID?.() || `managed-${Date.now()}-${index}`;
  pageCard.dataset.managedId = id;
  return {
    id,
    card: pageCard,
    textarea: pageCard.querySelector('textarea.page-text'),
    image: pageCard.querySelector('img.page-preview'),
    ocrPage: window.__ripscanOcrPages?.get(pageCard) || null,
    selected: true,
    originalPage: index + 1,
  };
}

function upgradeCard(card) {
  if (card.dataset.pageManagerReady) return;
  const pageList = card.querySelector('.page-list');
  if (!pageList || !pageList.querySelector('.page-card')) return;
  card.dataset.pageManagerReady = 'true';
  const pages = [...pageList.querySelectorAll('.page-card')].map((pageCard, index) => makePage(card, pageCard, index));
  const filename = card.querySelector('.result-head h2')?.textContent?.trim() || 'ripscan-document';
  const state = { card, pages, filename, activeId: pages[0].id, crop: null };
  managed.set(card, state);

  card.querySelector('.page-tabs')?.classList.add('legacy-hidden');
  card.querySelector('.document-actions')?.classList.add('legacy-hidden');

  const exportBar = document.createElement('div');
  exportBar.className = 'export-bar managed-export';
  exportBar.innerHTML = `<label>รูปแบบส่งออก<select class="managed-format"><option value="txt">TXT</option><option value="md">Markdown</option><option value="html">HTML</option><option value="csv">CSV</option><option value="json">JSON</option><option value="docx">DOCX</option><option value="xlsx">XLSX</option><option value="pdf">PDF ค้นหาข้อความได้</option></select></label><div class="actions"><button data-managed-action="copy-all">คัดลอกทั้งหมด</button><button data-managed-action="export-selected">ส่งออกหน้าที่เลือก</button><button data-managed-action="export-all">ส่งออกทั้งหมด</button><button data-managed-action="download-images">รูปหน้าที่เลือก ZIP</button></div>`;
  card.querySelector('.result-head').after(exportBar);

  const workspace = document.createElement('div');
  workspace.className = 'document-workspace managed-workspace';
  const manager = document.createElement('aside');
  manager.className = 'page-manager';
  const reviewArea = document.createElement('div');
  reviewArea.className = 'review-area';
  pageList.parentNode.insertBefore(workspace, pageList);
  workspace.append(manager, reviewArea);
  reviewArea.append(pageList);
  state.manager = manager;
  state.reviewArea = reviewArea;

  for (const page of pages) addPageTools(state, page);
  renderManager(state);
  showPage(state, state.activeId);
}

function addPageTools(state, page) {
  const actions = page.card.querySelector('.page-actions');
  if (actions && !actions.querySelector('[data-managed-page-action]')) {
    actions.insertAdjacentHTML('beforeend', `<button data-managed-page-action="download-image" data-page-id="${page.id}">รูปภาพ</button><button data-managed-page-action="rerun" data-page-id="${page.id}">OCR ใหม่</button><button data-managed-page-action="rotate" data-page-id="${page.id}">หมุนหน้า</button><button data-managed-page-action="crop" data-page-id="${page.id}">ครอป</button>`);
  }
  const stage = page.card.querySelector('.image-stage');
  if (stage && !stage.querySelector('.managed-crop-box')) {
    const box = document.createElement('div');
    box.className = 'crop-box managed-crop-box';
    box.hidden = true;
    stage.append(box);
  }
}

function renderManager(state) {
  state.manager.innerHTML = `<div class="manager-head"><div><strong>จัดการหน้า</strong><small>เลือก <span class="managed-selected-count">0</span>/${state.pages.length}</small></div><div class="manager-actions"><button data-managed-action="select-all">ทั้งหมด</button><button data-managed-action="select-none">ไม่เลือก</button></div></div><div class="bulk-actions actions"><button data-managed-action="ocr-selected">OCR หน้าที่เลือกใหม่</button><button class="danger-button" data-managed-action="delete-selected">ลบหน้าที่เลือก</button></div><div class="thumbnail-list"></div>`;
  const list = state.manager.querySelector('.thumbnail-list');
  state.pages.forEach((page, index) => {
    const item = document.createElement('div');
    item.className = `thumbnail-card ${page.id === state.activeId ? 'active' : ''}`;
    item.draggable = true;
    item.dataset.pageId = page.id;
    item.innerHTML = `<label class="select-page"><input type="checkbox" ${page.selected ? 'checked' : ''}><span>เลือก</span></label><button class="thumb-open"><img src="${escapeHtml(pageImage(page))}" alt="ตัวอย่างหน้า ${index + 1}"><span>หน้า ${index + 1}</span><small>ต้นฉบับ ${page.originalPage}</small></button><div class="thumb-actions"><button data-thumb-action="up" title="เลื่อนขึ้น">↑</button><button data-thumb-action="down" title="เลื่อนลง">↓</button><button data-thumb-action="rotate" title="หมุนหน้า">↻</button><button class="danger-button" data-thumb-action="delete" title="ลบหน้า">×</button></div>`;
    item.querySelector('input').addEventListener('change', event => { page.selected = event.target.checked; updateSelectedCount(state); });
    item.querySelector('.thumb-open').addEventListener('click', () => showPage(state, page.id));
    item.querySelector('[data-thumb-action="up"]').addEventListener('click', () => movePage(state, page.id, -1));
    item.querySelector('[data-thumb-action="down"]').addEventListener('click', () => movePage(state, page.id, 1));
    item.querySelector('[data-thumb-action="rotate"]').addEventListener('click', () => rotatePage(state, page));
    item.querySelector('[data-thumb-action="delete"]').addEventListener('click', () => deletePages(state, [page.id]));
    item.addEventListener('dragstart', () => { dragInfo = { state, pageId: page.id }; item.classList.add('dragging'); });
    item.addEventListener('dragend', () => { dragInfo = null; item.classList.remove('dragging'); });
    item.addEventListener('dragover', event => event.preventDefault());
    item.addEventListener('drop', event => { event.preventDefault(); if (dragInfo?.state === state) reorderPage(state, dragInfo.pageId, page.id); });
    list.append(item);
  });
  updateSelectedCount(state);
}

function updateSelectedCount(state) {
  const label = state.manager.querySelector('.managed-selected-count');
  if (label) label.textContent = state.pages.filter(page => page.selected).length;
}
function renumberPages(state) {
  state.pages.forEach((page, index) => {
    page.card.dataset.managedOrder = index + 1;
    const title = page.card.querySelector('.page-head strong');
    if (title) title.textContent = `หน้า ${index + 1}`;
  });
}
function showPage(state, pageId) {
  state.activeId = pageId;
  state.pages.forEach(page => { page.card.hidden = page.id !== pageId; });
  state.manager.querySelectorAll('.thumbnail-card').forEach(item => item.classList.toggle('active', item.dataset.pageId === pageId));
}
function movePage(state, pageId, delta) {
  const from = state.pages.findIndex(page => page.id === pageId);
  const to = Math.max(0, Math.min(state.pages.length - 1, from + delta));
  if (from < 0 || from === to) return;
  const [page] = state.pages.splice(from, 1);
  state.pages.splice(to, 0, page);
  reorderDom(state);
}
function reorderPage(state, sourceId, targetId) {
  if (sourceId === targetId) return;
  const from = state.pages.findIndex(page => page.id === sourceId);
  const to = state.pages.findIndex(page => page.id === targetId);
  if (from < 0 || to < 0) return;
  const [page] = state.pages.splice(from, 1);
  state.pages.splice(to, 0, page);
  reorderDom(state);
}
function reorderDom(state) {
  const pageList = state.reviewArea.querySelector('.page-list');
  state.pages.forEach(page => pageList.append(page.card));
  renumberPages(state);
  renderManager(state);
  showPage(state, state.activeId);
}
function deletePages(state, ids) {
  if (!ids.length) return showError('กรุณาเลือกอย่างน้อย 1 หน้า');
  if (state.pages.length - ids.length < 1) return showError('เอกสารต้องเหลืออย่างน้อย 1 หน้า');
  for (const page of state.pages.filter(item => ids.includes(item.id))) page.card.remove();
  state.pages = state.pages.filter(page => !ids.includes(page.id));
  if (ids.includes(state.activeId)) state.activeId = state.pages[0].id;
  reorderDom(state);
}

async function imageToCanvas(src) {
  const blob = await fetch(src).then(response => response.blob());
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close();
  return canvas;
}
async function canvasUrl(canvas) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .94));
  return remember(URL.createObjectURL(blob));
}
async function rotatePage(state, page) {
  busy(true, 'กำลังหมุนหน้า…');
  try {
    const source = await imageToCanvas(pageImage(page));
    const output = document.createElement('canvas'); output.width = source.height; output.height = source.width;
    const ctx = output.getContext('2d'); ctx.translate(output.width / 2, output.height / 2); ctx.rotate(Math.PI / 2); ctx.drawImage(source, -source.width / 2, -source.height / 2);
    page.image.src = await canvasUrl(output);
    renderManager(state); showPage(state, page.id);
  } finally { busy(false); }
}

async function rerunPage(state, page) {
  if (!window.Tesseract?.createWorker) return showError('โหลดระบบ OCR ไม่สำเร็จ');
  busy(true, `กำลัง OCR หน้า ${state.pages.indexOf(page) + 1} ใหม่…`);
  let worker;
  try {
    const langs = languageSelect.value === 'en' ? ['eng'] : languageSelect.value === 'th' ? ['tha'] : ['tha', 'eng'];
    worker = await window.Tesseract.createWorker(langs, 1, { logger: message => { if (message.status === 'recognizing text') statusText.textContent = `OCR ใหม่ ${Math.round((message.progress || 0) * 100)}%`; } });
    const response = await worker.recognize(pageImage(page));
    page.textarea.value = String(response.data.text || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    page.textarea.dispatchEvent(new Event('input', { bubbles: true }));
  } finally { await worker?.terminate(); busy(false); }
}
async function rerunSelected(state) {
  const pages = selectedPages(state, true);
  if (!pages.length) return showError('กรุณาเลือกอย่างน้อย 1 หน้า');
  for (const page of pages) await rerunPage(state, page);
}

function startCrop(state, page) {
  cancelCrop(state);
  const stage = page.card.querySelector('.image-stage');
  const box = stage.querySelector('.managed-crop-box');
  state.crop = { page, stage, box, dragging: false, rect: null };
  stage.classList.add('crop-active'); box.hidden = true;
  const move = event => cropMove(state, event);
  const up = event => cropUp(state, event);
  const down = event => cropDown(state, event);
  state.crop.handlers = { move, up, down };
  stage.addEventListener('pointerdown', down);
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', up);
  const actions = page.card.querySelector('.page-actions');
  actions.insertAdjacentHTML('beforeend', `<button data-crop-control="apply">ใช้พื้นที่ครอป</button><button data-crop-control="cancel">ยกเลิก</button>`);
  actions.querySelector('[data-crop-control="apply"]').disabled = true;
  actions.querySelector('[data-crop-control="apply"]').onclick = () => applyCrop(state);
  actions.querySelector('[data-crop-control="cancel"]').onclick = () => cancelCrop(state);
}
function cropPoint(crop, event) {
  const image = crop.page.image, rect = image.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)), imageRect: rect };
}
function cropDown(state, event) { const crop = state.crop; if (!crop) return; const point = cropPoint(crop, event); crop.dragging = true; crop.start = point; crop.stage.setPointerCapture?.(event.pointerId); }
function cropMove(state, event) {
  const crop = state.crop; if (!crop?.dragging) return; const point = cropPoint(crop, event), left = Math.min(crop.start.x, point.x), top = Math.min(crop.start.y, point.y), width = Math.abs(point.x - crop.start.x), height = Math.abs(point.y - crop.start.y), stageRect = crop.stage.getBoundingClientRect();
  crop.rect = { x: left, y: top, width, height };
  crop.box.hidden = false; crop.box.style.left = `${point.imageRect.left - stageRect.left + left * point.imageRect.width}px`; crop.box.style.top = `${point.imageRect.top - stageRect.top + top * point.imageRect.height}px`; crop.box.style.width = `${width * point.imageRect.width}px`; crop.box.style.height = `${height * point.imageRect.height}px`;
}
function cropUp(state, event) { const crop = state.crop; if (!crop) return; cropMove(state, event); crop.dragging = false; const apply = crop.page.card.querySelector('[data-crop-control="apply"]'); if (apply) apply.disabled = !crop.rect || crop.rect.width < .03 || crop.rect.height < .03; }
function cancelCrop(state) {
  const crop = state.crop; if (!crop) return;
  crop.stage.classList.remove('crop-active'); crop.box.hidden = true;
  crop.stage.removeEventListener('pointerdown', crop.handlers.down); crop.stage.removeEventListener('pointermove', crop.handlers.move); crop.stage.removeEventListener('pointerup', crop.handlers.up);
  crop.page.card.querySelectorAll('[data-crop-control]').forEach(button => button.remove()); state.crop = null;
}
async function applyCrop(state) {
  const crop = state.crop; if (!crop?.rect) return;
  busy(true, 'กำลังครอปภาพ…');
  try {
    const source = await imageToCanvas(pageImage(crop.page));
    const { x, y, width, height } = crop.rect;
    const sx = Math.round(x * source.width), sy = Math.round(y * source.height), sw = Math.max(1, Math.round(width * source.width)), sh = Math.max(1, Math.round(height * source.height));
    const output = document.createElement('canvas'); output.width = sw; output.height = sh;
    output.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
    crop.page.image.src = await canvasUrl(output);
    const page = crop.page; cancelCrop(state); renderManager(state); showPage(state, page.id);
  } finally { busy(false); }
}

function tableRecords(table) {
  const occupancy = [];
  const records = [];
  [...table.rows].forEach((row, rowIndex) => {
    occupancy[rowIndex] ||= [];
    let columnIndex = 0;
    [...row.cells].forEach(cell => {
      while (occupancy[rowIndex][columnIndex]) columnIndex += 1;
      const rowSpan = Math.max(1, Number(cell.rowSpan || 1));
      const columnSpan = Math.max(1, Number(cell.colSpan || 1));
      const confidence = Math.max(0, Math.min(1, Number(cell.querySelector('small')?.textContent?.match(/[\d.]+/u)?.[0] || 100) / 100));
      records.push({
        rowIndex,
        columnIndex,
        rowSpan,
        columnSpan,
        text: cell.querySelector('span')?.textContent ?? cell.textContent ?? '',
        confidence,
        reviewStatus: cell.classList.contains('manual-cell') ? 'manual_review_required'
          : cell.classList.contains('review-cell') || cell.classList.contains('low-confidence') ? 'review_required'
            : 'verified',
      });
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        occupancy[rowIndex + rowOffset] ||= [];
        for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
          occupancy[rowIndex + rowOffset][columnIndex + columnOffset] = true;
        }
      }
      columnIndex += columnSpan;
    });
  });
  return records;
}

function detectedTableBlocks(page, width, height) {
  return [...page.card.querySelectorAll('.analysis-panel .detected-table')].map(table => {
    const records = tableRecords(table);
    const rows = Math.max(1, ...records.map(record => record.rowIndex + record.rowSpan));
    return tableRecordsToBlock(records, {
      x: 0,
      y: 0,
      width,
      height: Math.min(height, Math.max(rows * 38, height * .2)),
    });
  });
}

function records(state, onlySelected) {
  const pages = selectedPages(state, onlySelected);
  return pages.map((page, index) => {
    const layout = page.ocrPage?.layout || null;
    const width = Math.max(1, Number(layout?.width || page.image?.naturalWidth || 794));
    const height = Math.max(1, Number(layout?.height || page.image?.naturalHeight || 1123));
    return {
      document: state.filename,
      page: index + 1,
      originalPage: page.originalPage,
      confidence: page.ocrPage?.confidence ?? (page.card.querySelector('.page-head span')?.textContent || ''),
      text: pageText(page),
      image: pageImage(page),
      layout,
      width,
      height,
      tables: detectedTableBlocks(page, width, height),
    };
  });
}
function plain(rows) { return rows.map(row => `===== หน้า ${row.page} =====\n\n${row.text}`).join('\n\n').trim(); }
function markdown(rows, title) { return `# ${title}\n\n${rows.map(row => `## หน้า ${row.page}\n\n${row.text}`).join('\n\n---\n\n')}\n`; }
function html(rows, title) { return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,'Noto Sans Thai',sans-serif;max-width:900px;margin:40px auto;padding:0 20px;line-height:1.7}.page{page-break-after:always;border-bottom:1px solid #ddd;padding-bottom:30px;margin-bottom:30px}pre{white-space:pre-wrap;font:inherit}</style></head><body><h1>${escapeHtml(title)}</h1>${rows.map(row => `<section class="page"><h2>หน้า ${row.page}</h2><pre>${escapeHtml(row.text)}</pre></section>`).join('')}</body></html>`; }
function csv(rows) { return ['Document,Page,Original Page,Confidence,Text', ...rows.map(row => [row.document, row.page, row.originalPage, row.confidence, row.text].map(csvCell).join(','))].join('\r\n'); }
function printablePdf(rows, title) {
  const popup = window.open('', '_blank'); if (!popup) throw new Error('กรุณาอนุญาต Pop-up เพื่อบันทึก PDF');
  popup.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{size:A4;margin:12mm}body{font-family:system-ui,'Noto Sans Thai',sans-serif;color:#111}.page{page-break-after:always}.page:last-child{page-break-after:auto}img{max-width:100%;max-height:55vh;display:block;margin:0 auto 14px}pre{white-space:pre-wrap;font:12pt/1.55 system-ui,'Noto Sans Thai',sans-serif;border-top:1px solid #ddd;padding-top:12px}</style></head><body>${rows.map(row => `<section class="page"><h2>${escapeHtml(title)} · หน้า ${row.page}</h2><img src="${row.image}"><pre>${escapeHtml(row.text)}</pre></section>`).join('')}<script>window.onload=()=>setTimeout(()=>window.print(),400)<\/script></body></html>`); popup.document.close();
}
async function exportRows(state, onlySelected) {
  const rows = records(state, onlySelected); if (!rows.length) return showError('กรุณาเลือกอย่างน้อย 1 หน้า'); clearError();
  const format = state.card.querySelector('.managed-format').value, base = safeName(state.filename.replace(/\.[^.]+$/, ''));
  if (format === 'txt') return downloadText(plain(rows), `${base}.txt`);
  if (format === 'md') return downloadText(markdown(rows, state.filename), `${base}.md`, 'text/markdown;charset=utf-8');
  if (format === 'html') return downloadText(html(rows, state.filename), `${base}.html`, 'text/html;charset=utf-8');
  if (format === 'csv') return downloadText('\ufeff' + csv(rows), `${base}.csv`, 'text/csv;charset=utf-8');
  if (format === 'json') return downloadText(JSON.stringify({ document: state.filename, exportedAt: new Date().toISOString(), pages: rows }, null, 2), `${base}.json`, 'application/json;charset=utf-8');
  if (format === 'docx' || format === 'xlsx') {
    const documentModel = ocrRowsToDocumentModel(rows, state.filename);
    if (format === 'docx') return downloadBlob(await modelToDocxBlob(documentModel), `${base}.docx`);
    return downloadBlob(await modelToXlsxBlob(documentModel), `${base}.xlsx`);
  }
  if (format === 'pdf') return printablePdf(rows, state.filename);
}
async function imageZip(state) {
  const pages = selectedPages(state, true); if (!pages.length) return showError('กรุณาเลือกอย่างน้อย 1 หน้า'); if (!window.JSZip) return showError('โหลดระบบ ZIP ไม่สำเร็จ');
  busy(true, 'กำลังรวมรูปหน้าที่เลือก…');
  try { const zip = new window.JSZip(); for (let i = 0; i < pages.length; i += 1) zip.file(`page-${String(i + 1).padStart(3, '0')}.jpg`, await fetch(pageImage(pages[i])).then(r => r.blob())); downloadBlob(await zip.generateAsync({ type: 'blob' }), `${safeName(state.filename)}-pages.zip`); } finally { busy(false); }
}

results.addEventListener('click', async event => {
  const managedButton = event.target.closest('[data-managed-action]');
  if (managedButton) {
    const card = managedButton.closest('.result-card'), state = getState(card), action = managedButton.dataset.managedAction; if (!state) return;
    try {
      if (action === 'copy-all') return navigator.clipboard.writeText(plain(records(state, false)));
      if (action === 'export-selected') return exportRows(state, true);
      if (action === 'export-all') return exportRows(state, false);
      if (action === 'download-images') return imageZip(state);
      if (action === 'select-all' || action === 'select-none') { state.pages.forEach(page => { page.selected = action === 'select-all'; }); return renderManager(state); }
      if (action === 'ocr-selected') return rerunSelected(state);
      if (action === 'delete-selected') return deletePages(state, state.pages.filter(page => page.selected).map(page => page.id));
    } catch (error) { console.error(error); showError(error.message || 'ดำเนินการไม่สำเร็จ'); }
    return;
  }
  const pageButton = event.target.closest('[data-managed-page-action]');
  if (pageButton) {
    const card = pageButton.closest('.result-card'), state = getState(card), page = state?.pages.find(item => item.id === pageButton.dataset.pageId); if (!state || !page) return;
    try {
      if (pageButton.dataset.managedPageAction === 'download-image') return downloadBlob(await fetch(pageImage(page)).then(r => r.blob()), `${safeName(state.filename)}-page-${state.pages.indexOf(page) + 1}.jpg`);
      if (pageButton.dataset.managedPageAction === 'rerun') return rerunPage(state, page);
      if (pageButton.dataset.managedPageAction === 'rotate') return rotatePage(state, page);
      if (pageButton.dataset.managedPageAction === 'crop') return startCrop(state, page);
    } catch (error) { console.error(error); showError(error.message || 'ดำเนินการไม่สำเร็จ'); }
  }
});

const observer = new MutationObserver(() => document.querySelectorAll('.result-card').forEach(upgradeCard));
observer.observe(results, { childList: true, subtree: true });
document.querySelectorAll('.result-card').forEach(upgradeCard);
window.addEventListener('beforeunload', () => urls.forEach(url => URL.revokeObjectURL(url)));
