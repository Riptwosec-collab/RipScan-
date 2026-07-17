import { applyTemplateToModel, collectReviewItems, computeQualityReport, createRedactionReport, createTemplate, recognizeFormLayout, redactBlock, testTemplateMatch, validateField, validateTemplate } from './quality-core.mjs';
import { analyzeExportCompatibility } from './editor-export.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
let context = null;

document.addEventListener('ripscan:studio-model', event => { context = event.detail; });

function ensureCenter() {
  if ($('#qualityCenter')) return $('#qualityCenter');
  const dialog = document.createElement('dialog');
  dialog.id = 'qualityCenter';
  dialog.className = 'quality-center';
  dialog.setAttribute('aria-labelledby', 'qualityCenterTitle');
  dialog.innerHTML = `<form method="dialog" class="quality-card"><header><div><strong id="qualityCenterTitle">Review & Quality Center</strong><small>คะแนนคำนวณจากข้อมูลจริงใน Document Model</small></div><button value="close" aria-label="ปิด">×</button></header><nav role="tablist" aria-label="Quality Center"><button type="button" role="tab" aria-selected="true" data-quality-tab="review" class="active">Review</button><button type="button" role="tab" aria-selected="false" data-quality-tab="compare">Visual Compare</button><button type="button" role="tab" aria-selected="false" data-quality-tab="forms">Forms</button><button type="button" role="tab" aria-selected="false" data-quality-tab="templates">Templates</button><button type="button" role="tab" aria-selected="false" data-quality-tab="projects">Projects</button><button type="button" role="tab" aria-selected="false" data-quality-tab="exports">Export Check</button><button type="button" role="tab" aria-selected="false" data-quality-tab="versions">Versions</button><button type="button" role="tab" aria-selected="false" data-quality-tab="privacy">Privacy</button></nav><main id="qualityBody" aria-live="polite"></main><input id="templateImport" type="file" accept="application/json,.json" hidden></form>`;
  document.body.append(dialog);
  dialog.addEventListener('click', handleClick);
  dialog.addEventListener('input', handleInput);
  dialog.addEventListener('change', handleChange);
  return dialog;
}

function model() { return context?.model; }

function deleteLocalDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve(name);
    request.onerror = () => reject(request.error || new Error(`ลบฐานข้อมูล ${name} ไม่สำเร็จ`));
    request.onblocked = () => reject(new Error(`ฐานข้อมูล ${name} ยังถูกใช้งานอยู่ กรุณาปิดแท็บอื่นแล้วลองใหม่`));
  });
}

function statusLabel(status) {
  return ({ verified: '✓ ยืนยันแล้ว', review_required: '⚠ ต้องตรวจ', possible_text: '? อาจเป็นข้อความ', contaminated: '⛔ ปนเปื้อน' })[status] || `• ${status}`;
}

function renderReview() {
  const items = collectReviewItems(model());
  const counts = items.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] || 0) + 1 }), {});
  $('#qualityBody').innerHTML = `<section class="quality-summary"><article><strong>${items.length}</strong><span>ต้องตรวจทั้งหมด</span></article><article><strong>${counts.review_required || 0}</strong><span>Review Required</span></article><article><strong>${items.filter(item => item.confidence < .45).length}</strong><span>Confidence ต่ำ</span></article></section><div class="review-actions"><button type="button" data-quality-action="confirm-high">ยืนยันรายการ ≥ 95%</button><button type="button" data-quality-action="export-review">Export รายการค้าง</button></div><div class="review-list">${items.length ? items.map(item => `<article class="review-item" data-review-id="${escapeHtml(item.id)}"><header><strong>หน้า ${item.pageNumber} · ${escapeHtml(item.type)}</strong><span>${statusLabel(item.status)} · ${Math.round(item.confidence * 100)}%</span></header><label>ผล OCR<input data-review-value="${escapeHtml(item.id)}" value="${escapeHtml(item.text)}"></label>${item.candidates.length ? `<div class="review-candidates">${item.candidates.slice(0, 4).map((candidate, index) => `<button type="button" data-candidate="${index}" data-review-id="${escapeHtml(item.id)}">${index + 1}. ${escapeHtml(candidate.text || candidate)}</button>`).join('')}</div>` : ''}<small>${escapeHtml(item.reasons.join(' · ') || 'confidence/status จาก OCR pipeline')}</small><footer><button type="button" data-quality-action="select" data-review-id="${escapeHtml(item.id)}">เปิด Block</button><button type="button" data-quality-action="confirm" data-review-id="${escapeHtml(item.id)}">ยืนยัน</button><button type="button" data-quality-action="non-text" data-review-id="${escapeHtml(item.id)}">ไม่ใช่ข้อความ</button><button type="button" class="danger" data-quality-action="redact" data-review-id="${escapeHtml(item.id)}">ปิดบังถาวร</button></footer></article>`).join('') : '<p class="quality-empty">ไม่มีรายการที่ต้องตรวจ</p>'}</div>`;
}

function pageResultHtml(page) {
  return `<div class="compare-result-page" style="aspect-ratio:${page.width}/${page.height}">${(page.blocks || []).filter(block => !block.hidden).map(block => `<span class="compare-block ${block.reviewStatus === 'verified' ? '' : 'issue'}" style="left:${block.x / page.width * 100}%;top:${block.y / page.height * 100}%;width:${block.width / page.width * 100}%;height:${block.height / page.height * 100}%">${escapeHtml(block.type === 'field' ? block.value : block.text || '')}</span>`).join('')}</div>`;
}

function renderCompare() {
  const page = model().pages[context.activePage || 0];
  const report = computeQualityReport(model());
  $('#qualityBody').innerHTML = `<section class="quality-scores"><article><strong>${Math.round(report.textAccuracy * 100)}</strong><span>Text Accuracy</span></article><article><strong>${Math.round(report.layoutSimilarity * 100)}</strong><span>Layout Similarity</span></article><article><strong>${Math.round(report.tableAccuracy * 100)}</strong><span>Table Accuracy</span></article><article><strong>${Math.round(report.overall * 100)}</strong><span>Overall</span></article></section><details><summary>สูตรคะแนน</summary><code>${report.formula}</code><p>Text ใช้ confidence จริง, Layout ตรวจ bounding box อยู่ในหน้า, Table ใช้ cell confidence/status; จำนวนตัวอย่าง ${report.sampleSize.blocks} blocks / ${report.sampleSize.tableCells} cells</p></details><div class="compare-controls"><button type="button" data-compare-mode="side" class="active">Side-by-side</button><button type="button" data-compare-mode="overlay">Overlay</button><button type="button" data-compare-mode="slider">Before/After</button></div><div class="visual-compare side" id="visualCompare"><figure><figcaption>Original</figcaption>${page.backgroundImage ? `<img src="${escapeHtml(page.backgroundImage)}" alt="เอกสารต้นฉบับ">` : '<p>หน้านี้ไม่มีภาพต้นฉบับ</p>'}</figure><figure class="result"><figcaption>Reconstructed</figcaption>${pageResultHtml(page)}</figure><input id="compareSlider" type="range" min="0" max="100" value="50" aria-label="สัดส่วนภาพต้นฉบับและผลลัพธ์"></div>`;
}

async function renderPrivacy() {
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  const cachesList = 'caches' in window ? await caches.keys() : [];
  const externalOrigins = [...new Set(performance.getEntriesByType?.('resource')?.map(entry => { try { return new URL(entry.name).origin; } catch { return ''; } }).filter(origin => origin && origin !== location.origin) || [])];
  const usesCdnRuntime = externalOrigins.some(origin => origin.includes('jsdelivr.net'));
  $('#qualityBody').innerHTML = `<section class="privacy-grid"><article><strong>Local</strong><span>Processing mode</span><small>ไฟล์ผู้ใช้ไม่ถูกส่งออกใน browser OCR flow</small></article><article><strong>Tesseract.js</strong><span>OCR engine</span><small>${usesCdnRuntime ? 'โหลด runtime จาก CDN แบบระบุเวอร์ชัน' : 'ใช้ runtime ที่ bundle มากับ production build'}</small></article><article><strong>${estimate ? `${(estimate.usage / 1048576).toFixed(1)} MB` : 'ไม่ทราบ'}</strong><span>Storage usage</span><small>IndexedDB + Cache Storage</small></article><article><strong>${externalOrigins.length}</strong><span>External origins observed</span><small>${escapeHtml(externalOrigins.join(', ') || 'ไม่มี')}</small></article></section><div class="privacy-actions"><button type="button" data-quality-action="export-data">Export Document Data</button><button type="button" data-quality-action="export-redaction-report">Redaction Report</button><button type="button" data-quality-action="clear-cache">ลบ Cache</button><button type="button" class="danger" data-quality-action="delete-project">ลบ Project ปัจจุบัน</button><button type="button" class="danger" data-quality-action="delete-all-local">ลบข้อมูล Local ทั้งหมด</button></div><p class="privacy-note">Production build ใช้ library bundle จาก same-origin ส่วนโหมด source fallback อนุญาต cdn.jsdelivr.net และ tessdata.projectnaptha.com ไม่มี Cloud OCR เปิดใช้งานโดยค่าเริ่มต้น รายการ observed มาจาก browser session นี้</p>`;
}

async function renderVersions() {
  const versions = await globalThis.RipScanStudioVersions?.list?.() || [];
  $('#qualityBody').innerHTML = `<div class="review-actions"><button type="button" data-quality-action="save-version">บันทึก Version ปัจจุบัน</button></div><div class="review-list">${versions.length ? versions.map(version => `<article class="review-item" data-version-id="${escapeHtml(version.id)}"><header><strong>${escapeHtml(version.label)}</strong><span>${new Date(version.createdAt).toLocaleString('th-TH')}</span></header><footer><button type="button" data-quality-action="restore-version" data-version-id="${escapeHtml(version.id)}">Restore</button><button type="button" class="danger" data-quality-action="delete-version" data-version-id="${escapeHtml(version.id)}">ลบ</button></footer></article>`).join('') : '<p class="quality-empty">ยังไม่มี Version ที่บันทึกไว้</p>'}</div>`;
}

function readTemplates() { try { return JSON.parse(localStorage.getItem('ripscan-templates') || '[]'); } catch { return []; } }
function writeTemplates(templates) { localStorage.setItem('ripscan-templates', JSON.stringify(templates)); }
function renderTemplates() {
  const templates = readTemplates();
  $('#qualityBody').innerHTML = `<div class="review-actions"><button type="button" data-quality-action="save-template">บันทึก Layout/Field</button><button type="button" data-quality-action="import-template">Import Template</button></div><div class="review-list">${templates.length ? templates.map(template => { const match = testTemplateMatch(model(), template); return `<article class="review-item"><header><strong>${escapeHtml(template.name)}</strong><span>${template.pages.length} หน้า · Match ${Math.round(match.confidence * 100)}%</span></header><small>เก็บเฉพาะ geometry/schema ไม่มีข้อความหรือภาพต้นฉบับ</small><footer><button type="button" data-quality-action="apply-template" data-template-id="${escapeHtml(template.id)}" ${match.compatible ? '' : 'disabled'}>Apply</button><button type="button" data-quality-action="export-template" data-template-id="${escapeHtml(template.id)}">Export</button><button type="button" class="danger" data-quality-action="delete-template" data-template-id="${escapeHtml(template.id)}">ลบ</button></footer></article>`; }).join('') : '<p class="quality-empty">ยังไม่มี Template</p>'}</div>`;
}

function renderForms() {
  const fields = (model().pages || []).flatMap(page => page.blocks || []).filter(block => ['field', 'checkbox', 'radio', 'signature', 'stamp', 'barcode', 'qr', 'label', 'value'].includes(block.type));
  const invalid = fields.filter(block => block.validation && !block.validation.valid);
  $('#qualityBody').innerHTML = `<section class="quality-summary"><article><strong>${fields.length}</strong><span>Form blocks</span></article><article><strong>${invalid.length}</strong><span>Validation issues</span></article><article><strong>${fields.filter(block => block.source === 'form-recognition').length}</strong><span>Recognized</span></article></section><div class="review-actions"><button type="button" data-quality-action="recognize-forms">ตรวจ Label/Value และ Checkbox</button></div><div class="review-list">${fields.length ? fields.map(block => `<article class="review-item"><header><strong>${escapeHtml(block.label || block.type)}</strong><span>${escapeHtml(block.fieldType || block.type)}</span></header><small>${escapeHtml(block.value || (block.checked ? 'checked' : ''))} · ${block.validation ? (block.validation.valid ? 'valid' : `ต้องตรวจ: ${(block.validation.warnings || []).join(', ') || 'format'}`) : 'ยังไม่มีกฎตรวจสอบ'}</small></article>`).join('') : '<p class="quality-empty">ยังไม่พบ Form block ใช้การตรวจจับกับผล OCR ปัจจุบันได้</p>'}</div>`;
}

async function renderProjects() {
  const projects = await globalThis.RipScanProjects?.list?.() || [];
  const current = await globalThis.RipScanProjects?.active?.();
  $('#qualityBody').innerHTML = `<div class="review-actions"><button type="button" data-quality-action="new-project">สร้าง Project</button></div><div class="review-list">${projects.length ? projects.map(project => { const summary = globalThis.RipScanProjects.summary(project); return `<article class="review-item"><header><strong>${escapeHtml(project.name)}</strong><span>${summary.total} jobs · ${Math.round(summary.progress * 100)}%</span></header><small>Queued ${summary.counts.queued || 0} · Running ${summary.counts.processing || 0} · Done ${summary.counts.completed || 0} · Failed ${summary.counts.failed || 0}</small><footer><button type="button" data-quality-action="select-project" data-project-id="${project.id}" ${current?.id === project.id ? 'disabled' : ''}>${current?.id === project.id ? 'ใช้งานอยู่' : 'เลือก'}</button><button type="button" data-quality-action="export-project" data-project-id="${project.id}">Export report</button><button type="button" class="danger" data-quality-action="delete-saved-project" data-project-id="${project.id}">ลบ</button></footer></article>`; }).join('') : '<p class="quality-empty">เพิ่มไฟล์ OCR เพื่อสร้าง Project อัตโนมัติ หรือกดสร้าง Project</p>'}</div><p class="privacy-note">Project เก็บเฉพาะ metadata, สถานะ และข้อความผล OCR ใน IndexedDB ไม่เก็บไฟล์หรือภาพต้นฉบับอัตโนมัติ</p>`;
}

function renderExportCheck() {
  const reports = ['docx', 'xlsx'].map(format => analyzeExportCompatibility(model(), format));
  $('#qualityBody').innerHTML = `<div class="review-list">${reports.map(report => `<article class="review-item"><header><strong>${report.format.toUpperCase()}</strong><span>${escapeHtml(report.label)} · risk ${Math.round(report.risk * 100)}%</span></header>${report.findings.map(finding => `<small><b>${escapeHtml(finding.level)}</b> · ${escapeHtml(finding.feature)} — ${escapeHtml(finding.detail)}</small>`).join('')}<footer><button type="button" data-quality-action="export-compatibility" data-export-format="${report.format}">Export report</button></footer></article>`).join('')}</div><p class="privacy-note">รายงานนี้อธิบายสิ่งที่ exporter ปัจจุบันรองรับจริงก่อนดาวน์โหลด ไม่ใช่คะแนนรับประกันความเหมือนต้นฉบับ</p>`;
}

function replace(next, label, item = {}) { document.dispatchEvent(new CustomEvent('ripscan:replace-model', { detail: { model: next, label, blockId: item.blockId, pageIndex: item.pageIndex } })); context = { ...context, model: next }; }

function findItem(id) { return collectReviewItems(model()).find(item => item.id === id); }

function updateReviewItem(item, changes) {
  const next = structuredClone(model());
  const block = next.pages[item.pageIndex].blocks.find(candidate => candidate.id === item.blockId);
  const target = item.cellId ? block.cells.find(cell => cell.id === item.cellId) : block;
  Object.assign(target, changes);
  replace(next, 'Review Center', item);
}

async function handleClick(event) {
  const tab = event.target.closest('[data-quality-tab]')?.dataset.qualityTab;
  if (tab) {
    document.querySelectorAll('[data-quality-tab]').forEach(button => { const active = button.dataset.qualityTab === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
    if (tab === 'review') renderReview(); else if (tab === 'compare') renderCompare(); else if (tab === 'forms') renderForms(); else if (tab === 'templates') renderTemplates(); else if (tab === 'projects') await renderProjects(); else if (tab === 'exports') renderExportCheck(); else if (tab === 'versions') await renderVersions(); else await renderPrivacy();
    return;
  }
  const mode = event.target.closest('[data-compare-mode]')?.dataset.compareMode;
  if (mode) {
    $('#visualCompare').className = `visual-compare ${mode}`;
    document.querySelectorAll('[data-compare-mode]').forEach(button => button.classList.toggle('active', button.dataset.compareMode === mode));
    return;
  }
  const action = event.target.closest('[data-quality-action]')?.dataset.qualityAction;
  const id = event.target.closest('[data-review-id]')?.dataset.reviewId;
  const item = id && findItem(id);
  if (action === 'select' && item) { document.dispatchEvent(new CustomEvent('ripscan:select-block', { detail: item })); ensureCenter().close(); }
  if (action === 'confirm' && item) { updateReviewItem(item, { reviewStatus: 'verified', confidence: Math.max(.95, item.confidence) }); renderReview(); }
  if (action === 'non-text' && item && confirm('ยืนยันว่าบริเวณนี้ไม่ใช่ข้อความ?')) { updateReviewItem(item, { reviewStatus: 'confirmed_non_text', text: '' }); renderReview(); }
  if (action === 'redact' && item && confirm('การส่งออกครั้งถัดไปจะ Burn-in พื้นที่นี้และลบ Text Layer ยืนยันหรือไม่?')) { const next = redactBlock(model(), item.blockId); replace(next, 'ปิดบังข้อมูล', item); renderReview(); }
  if (action === 'confirm-high') { const next = structuredClone(model()); for (const review of collectReviewItems(next).filter(candidate => candidate.confidence >= .95)) { const block = next.pages[review.pageIndex].blocks.find(candidate => candidate.id === review.blockId); const target = review.cellId ? block.cells.find(cell => cell.id === review.cellId) : block; target.reviewStatus = 'verified'; } replace(next, 'ยืนยัน Confidence สูง'); renderReview(); }
  if (action === 'export-review') { const blob = new Blob([JSON.stringify(collectReviewItems(model()), null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'ripscan-review-items.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
  if (action === 'export-data') { const blob = new Blob([JSON.stringify(model(), null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'ripscan-project-backup.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
  if (action === 'export-redaction-report') { const blob = new Blob([JSON.stringify(createRedactionReport(model()), null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'ripscan-redaction-report.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
  if (action === 'clear-cache' && confirm('ลบ PWA Cache ทั้งหมด?')) { await Promise.all((await caches.keys()).map(name => caches.delete(name))); await renderPrivacy(); }
  if (action === 'delete-project' && confirm('ลบ Project ปัจจุบันและรายงานผล OCR ที่บันทึกไว้ใน browser?')) { const project = await globalThis.RipScanProjects?.active?.(); if (project) await globalThis.RipScanProjects.remove(project.id); await renderPrivacy(); }
  if (action === 'delete-all-local' && confirm('ลบ Project, Document Studio, Versions, Templates และ Cache ทั้งหมดจาก browser นี้? การทำงานนี้ย้อนกลับไม่ได้')) {
    try {
      await Promise.all(['ripscan-project-workspace', 'ripscan-document-studio'].map(deleteLocalDatabase));
      localStorage.removeItem('ripscan-active-project'); localStorage.removeItem('ripscan-templates');
      if ('caches' in window) await Promise.all((await caches.keys()).map(name => caches.delete(name)));
      ensureCenter().close(); alert('ลบข้อมูล Local สำเร็จแล้ว กรุณารีเฟรชหน้า');
    } catch (error) { alert(`ยังลบข้อมูลไม่ครบ: ${error.message}`); }
  }
  if (action === 'save-version') { const label = prompt('ชื่อ Version', 'Named Version'); if (label) { await globalThis.RipScanStudioVersions.save(label); await renderVersions(); } }
  if (action === 'save-template') { const name = prompt('ชื่อ Template', model().name.replace(/\.[^.]+$/u, '')); if (name) { const templates = readTemplates(); templates.push(createTemplate(model(), name)); writeTemplates(templates); renderTemplates(); } }
  if (action === 'import-template') $('#templateImport')?.click();
  if (action === 'recognize-forms') { const result = recognizeFormLayout(model()); replace(result.model, 'Form Recognition'); renderForms(); }
  if (action === 'export-compatibility') { const format = event.target.dataset.exportFormat; const report = analyzeExportCompatibility(model(), format); const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `ripscan-${format}-compatibility.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
  if (action === 'new-project') { const name = prompt('ชื่อ Project', `Project ${new Date().toLocaleDateString('th-TH')}`); if (name) { await globalThis.RipScanProjects?.create(name); await renderProjects(); } }
  if (['select-project', 'export-project', 'delete-saved-project'].includes(action)) {
    const projectId = event.target.dataset.projectId;
    const projects = await globalThis.RipScanProjects?.list?.() || [];
    const project = projects.find(item => item.id === projectId);
    if (action === 'select-project' && project) { globalThis.RipScanProjects.select(projectId); await renderProjects(); }
    if (action === 'export-project' && project) { const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${project.name.replace(/[^\p{L}\p{N}._-]+/gu, '-')}-report.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
    if (action === 'delete-saved-project' && project && confirm(`ลบ Project ${project.name}?`)) { await globalThis.RipScanProjects.remove(projectId); await renderProjects(); }
  }
  if (action === 'export-template' || action === 'delete-template' || action === 'apply-template') {
    const templateId = event.target.dataset.templateId; const templates = readTemplates(); const template = templates.find(item => item.id === templateId);
    if (action === 'export-template' && template) { const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${template.name.replace(/[^\p{L}\p{N}._-]+/gu, '-')}.ripscan-template.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
    if (action === 'delete-template' && template && confirm(`ลบ Template ${template.name}?`)) { writeTemplates(templates.filter(item => item.id !== templateId)); renderTemplates(); }
    if (action === 'apply-template' && template) { const result = applyTemplateToModel(model(), template); if (result.applied) { replace(result.model, `Apply Template: ${template.name}`); alert(`เพิ่ม ${result.added} blocks จาก Template`); renderTemplates(); } }
  }
  if (action === 'restore-version' || action === 'delete-version') {
    const versionId = event.target.dataset.versionId;
    const versions = await globalThis.RipScanStudioVersions.list();
    const version = versions.find(item => item.id === versionId);
    if (action === 'restore-version' && version && confirm(`Restore ${version.label}?`)) { globalThis.RipScanStudioVersions.restore(version); context = { ...context, model: version.model }; ensureCenter().close(); }
    if (action === 'delete-version' && version && confirm(`ลบ ${version.label}?`)) { await globalThis.RipScanStudioVersions.remove(version.id); await renderVersions(); }
  }
}

async function handleChange(event) {
  if (event.target.id !== 'templateImport' || !event.target.files?.[0]) return;
  try {
    const template = JSON.parse(await event.target.files[0].text());
    const validation = validateTemplate(template);
    if (!validation.valid) throw new Error(validation.errors.join(', '));
    const templates = readTemplates();
    const fingerprint = JSON.stringify(template.pages);
    if (templates.some(item => JSON.stringify(item.pages) === fingerprint)) throw new Error('Template นี้มีอยู่แล้ว');
    template.id = template.id || `template-${crypto.randomUUID()}`;
    templates.push(template); writeTemplates(templates); renderTemplates();
  } catch (error) { alert(`Import Template ไม่สำเร็จ: ${error.message}`); }
  event.target.value = '';
}

function handleInput(event) {
  if (event.target.id === 'compareSlider') $('#visualCompare')?.style.setProperty('--split', `${event.target.value}%`);
  const id = event.target.dataset.reviewValue;
  if (!id) return;
  const item = findItem(id);
  if (item) updateReviewItem(item, { [item.type === 'field' ? 'value' : 'text']: event.target.value, reviewStatus: 'review_required' });
}

function installButton() {
  const header = $('.header-actions');
  if (!header) return;
  let button = $('#qualityCenterButton');
  if (!button) {
    button = document.createElement('button');
    button.id = 'qualityCenterButton'; button.type = 'button'; button.textContent = 'Review / Compare';
    button.addEventListener('click', () => {
      if (!model()) return alert('เปิดเอกสารใน Document Studio ก่อน');
      const center = ensureCenter(); renderReview(); center.showModal();
    });
    header.prepend(button);
  }
  const mobileNav = $('#mobileWorkflowNav');
  if (mobileNav && !mobileNav.querySelector('[data-mobile-action="review"]')) {
    const mobileButton = document.createElement('button');
    mobileButton.type = 'button'; mobileButton.dataset.mobileAction = 'review'; mobileButton.textContent = 'Review';
    mobileButton.addEventListener('click', () => button.click());
    mobileNav.append(mobileButton);
  }
}

installButton();
window.addEventListener('DOMContentLoaded', installButton);

export { validateField, createTemplate };
