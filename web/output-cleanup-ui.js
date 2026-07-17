import {
  OUTPUT_CLEANUP_VERSION,
  OUTPUT_MODES,
  buildCleanExportText,
  buildExportPreview,
  filterExportBlocks,
  normalizeReviewBlock,
  sanitizeTextForExport,
} from './output-cleanup.mjs';

const processedCards = new WeakSet();
const cardState = new WeakMap();
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function ensureStyles() {
  if (document.querySelector('link[data-output-cleanup-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/output-cleanup.css';
  link.dataset.outputCleanupStyle = OUTPUT_CLEANUP_VERSION;
  document.head.append(link);
}

function resultForCard(pageCard) {
  return globalThis.__ripscanBookResults?.get?.(pageCard) || pageCard.__ripscanBookResult || null;
}

function normalizeResult(pageCard) {
  const result = resultForCard(pageCard);
  if (!result) return null;
  const sourceBlocks = result.blocks || result.textBlocks || [];
  const blocks = sourceBlocks.map(normalizeReviewBlock);
  result.blocks = blocks;
  result.textBlocks = blocks;
  result.review = {
    blocks: blocks.filter(block => block.requiresReview || ['possible_text', 'gibberish'].includes(block.status)),
    count: blocks.filter(block => block.requiresReview || ['possible_text', 'gibberish'].includes(block.status)).length,
  };
  result.text = buildCleanExportText(blocks, { mode: OUTPUT_MODES.VERIFIED_REVIEWED });
  return result;
}

function renderEditor(pageCard, mode = OUTPUT_MODES.VERIFIED_REVIEWED) {
  const result = normalizeResult(pageCard);
  if (!result) return;
  const textarea = $('.page-text', pageCard);
  const text = buildCleanExportText(result.blocks, { mode });
  if (textarea && textarea.value !== text) textarea.value = text;
  const preview = buildExportPreview(result.blocks, { mode });
  const summary = $('[data-clean-export-summary]', pageCard);
  if (summary) summary.textContent = `พร้อมส่งออก ${preview.ready}/${preview.total} Block · ยังไม่ยืนยัน ${preview.reviewRequired + preview.possibleText} · กรองข้อความมั่ว ${preview.gibberish}`;
}

function reviewCard(block, index) {
  const candidate = sanitizeTextForExport(block.confirmedText || block.text || '');
  const raw = sanitizeTextForExport(block.rawText || block.text || '');
  return `<article class="ocr-review-item" data-review-index="${index}" data-review-status="${escapeHtml(block.status)}">
    <header><strong>${escapeHtml(block.displayLabel || block.status)}</strong><span>${Math.round(Number(block.confidence || 0) * 100)}%</span></header>
    <div class="ocr-review-columns"><div><small>Raw OCR</small><p>${escapeHtml(raw || '—')}</p></div><div><small>Candidate</small><textarea data-review-candidate>${escapeHtml(candidate)}</textarea></div></div>
    <footer><span>${escapeHtml(block.issueType || block.failureSignals?.[0] || 'low_confidence')}</span><button type="button" data-review-action="confirm">ยืนยัน</button><button type="button" data-review-action="reject">ไม่ใช่ข้อความ</button><button type="button" data-review-action="include">รวมในการส่งออก</button></footer>
  </article>`;
}

function renderReviewPanel(pageCard) {
  const result = normalizeResult(pageCard);
  if (!result) return;
  const issues = result.blocks.filter(block => block.status !== 'verified' && block.status !== 'confirmed_non_text');
  let panel = $('.ocr-review-separation', pageCard);
  if (!panel) {
    panel = document.createElement('section');
    panel.className = 'ocr-review-separation';
    const editor = $('.editor-panel', pageCard) || pageCard;
    editor.insertAdjacentElement('afterend', panel);
  }
  panel.hidden = issues.length === 0;
  panel.innerHTML = `<header><div><strong>ข้อความที่ต้องตรวจสอบ</strong><small>สถานะอยู่ใน Metadata และไม่ถูกฝังในข้อความจริง</small></div><span>${issues.length} จุด</span></header><div class="ocr-review-list">${issues.map((block, index) => reviewCard(block, result.blocks.indexOf(block))).join('')}</div>`;
}

function installCleanActions(pageCard) {
  const actions = $('.page-actions', pageCard);
  if (!actions || actions.querySelector('[data-clean-copy]')) return;
  const clean = document.createElement('button');
  clean.type = 'button';
  clean.dataset.cleanCopy = 'verified-reviewed';
  clean.textContent = 'คัดลอกข้อความสะอาด';
  const unverified = document.createElement('button');
  unverified.type = 'button';
  unverified.dataset.cleanCopy = 'include-unverified';
  unverified.textContent = 'คัดลอกพร้อมข้อความที่ยังไม่ยืนยัน';
  actions.prepend(unverified);
  actions.prepend(clean);
  const summary = document.createElement('small');
  summary.dataset.cleanExportSummary = '';
  summary.className = 'clean-export-summary';
  actions.insertAdjacentElement('afterend', summary);
}

async function copyPage(pageCard, mode, button) {
  const result = normalizeResult(pageCard);
  if (!result) return;
  const preview = buildExportPreview(result.blocks, { mode });
  if (mode === OUTPUT_MODES.INCLUDE_UNVERIFIED && preview.excluded > 0) {
    const accepted = globalThis.confirm?.(`ยังมีข้อความ ${preview.reviewRequired + preview.possibleText} จุดที่ไม่ได้ยืนยัน ข้อความเหล่านี้อาจไม่ถูกต้อง\n\nต้องการคัดลอกต่อหรือไม่?`);
    if (accepted === false) return;
  }
  const text = buildCleanExportText(result.blocks, { mode });
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = 'คัดลอกแล้ว';
  setTimeout(() => { button.textContent = original; }, 1200);
}

function handleReviewAction(event) {
  const button = event.target.closest('[data-review-action]');
  if (!button) return false;
  const pageCard = button.closest('.page-card');
  const item = button.closest('[data-review-index]');
  const result = normalizeResult(pageCard);
  const block = result?.blocks?.[Number(item?.dataset.reviewIndex)];
  if (!block) return true;
  const candidate = $('[data-review-candidate]', item)?.value || block.text;
  if (button.dataset.reviewAction === 'confirm') {
    block.text = sanitizeTextForExport(candidate);
    block.confirmedText = block.text;
    block.userConfirmed = true;
    block.status = 'verified';
    block.reviewStatus = 'verified';
    block.includeInExport = true;
    block.requiresReview = false;
  } else if (button.dataset.reviewAction === 'reject') {
    block.status = 'confirmed_non_text';
    block.reviewStatus = 'confirmed_non_text';
    block.includeInExport = false;
    block.doNotEmitTokens = true;
    block.emitToEditor = false;
    block.emitToExport = false;
  } else if (button.dataset.reviewAction === 'include') {
    block.text = sanitizeTextForExport(candidate);
    block.includeInExport = true;
    block.userConfirmed = true;
    block.status = 'verified';
    block.reviewStatus = 'verified';
  }
  renderEditor(pageCard);
  renderReviewPanel(pageCard);
  return true;
}

function processPageCard(pageCard) {
  if (!pageCard || processedCards.has(pageCard)) return;
  const result = normalizeResult(pageCard);
  if (!result) return;
  processedCards.add(pageCard);
  cardState.set(pageCard, { version: OUTPUT_CLEANUP_VERSION });
  installCleanActions(pageCard);
  renderEditor(pageCard);
  renderReviewPanel(pageCard);
}

function scan(root = document) {
  if (root.matches?.('.page-card')) processPageCard(root);
  $$('.page-card', root).forEach(processPageCard);
}

ensureStyles();
scan();

const observer = new MutationObserver(records => {
  for (const record of records) for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) scan(node);
});
observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

document.addEventListener('click', event => {
  if (handleReviewAction(event)) return;
  const button = event.target.closest('[data-clean-copy]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const mode = button.dataset.cleanCopy === 'include-unverified' ? OUTPUT_MODES.INCLUDE_UNVERIFIED : OUTPUT_MODES.VERIFIED_REVIEWED;
  copyPage(button.closest('.page-card'), mode, button).catch(error => console.error('clean copy failed', error));
}, true);

window.addEventListener('ripscan:ocr-block-result', event => {
  const block = event.detail?.block;
  if (!block) return;
  Object.assign(block, normalizeReviewBlock(block));
});

window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
document.documentElement.dataset.outputCleanupVersion = OUTPUT_CLEANUP_VERSION;
globalThis.RipScanOutputCleanupUI = Object.freeze({ scan, renderEditor, renderReviewPanel, version: OUTPUT_CLEANUP_VERSION });
