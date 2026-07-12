import { analyzeBrokenSaraAm } from './sara-am-spacing.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const resultsByPage = new WeakMap();
const overlayByPage = new WeakMap();

const STATUS_LABELS = Object.freeze({
  verified: 'ยืนยันแล้ว',
  review_required: 'ต้องตรวจ',
  possible_text: 'อาจเป็นข้อความ',
  likely_non_text: 'อาจไม่ใช่ข้อความ',
  confirmed_non_text: 'ยืนยันว่าไม่ใช่ข้อความ',
});

const STATUS_COLORS = Object.freeze({
  verified: '#22c55e',
  review_required: '#eab308',
  possible_text: '#f97316',
  likely_non_text: '#94a3b8',
  confirmed_non_text: '#64748b',
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function blockStatus(block) {
  if (block.userConfirmed) return 'verified';
  if (block.status) return block.status;
  if (block.requiresReview) return block.confidence < .45 ? 'possible_text' : 'review_required';
  return 'verified';
}

function currentFilter(pageCard) {
  return $('.recovery-overlay-filter', pageCard)?.value || 'all';
}

function shouldDraw(status, filter) {
  if (status === 'confirmed_non_text') return false;
  if (filter === 'verified') return status === 'verified';
  if (filter === 'possible') return ['review_required', 'possible_text'].includes(status);
  if (filter === 'non_text') return status === 'likely_non_text';
  return true;
}

function ensureOverlay(pageCard) {
  const image = $('.page-preview', pageCard);
  if (!image) return null;
  const parent = image.parentElement;
  if (!parent) return null;
  parent.classList.add('recovery-overlay-host');
  let canvas = $('.recovery-block-overlay', parent);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'recovery-block-overlay';
    canvas.setAttribute('aria-label', 'กรอบข้อความที่ระบบตรวจพบ');
    parent.append(canvas);
  }
  overlayByPage.set(pageCard, canvas);
  return canvas;
}

function drawOverlay(pageCard) {
  const result = resultsByPage.get(pageCard);
  const image = $('.page-preview', pageCard);
  const canvas = ensureOverlay(pageCard);
  if (!result || !image || !canvas || !image.naturalWidth || !image.naturalHeight) return;
  const rect = image.getBoundingClientRect();
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  const filter = currentFilter(pageCard);
  for (const block of result.blocks || []) {
    const status = blockStatus(block);
    if (!shouldDraw(status, filter)) continue;
    const box = block.bbox || {};
    const x = Number(box.left || box.x || 0) / image.naturalWidth * canvas.width;
    const y = Number(box.top || box.y || 0) / image.naturalHeight * canvas.height;
    const width = Number(box.width || 0) / image.naturalWidth * canvas.width;
    const height = Number(box.height || 0) / image.naturalHeight * canvas.height;
    if (width < 2 || height < 2) continue;
    const color = STATUS_COLORS[status] || STATUS_COLORS.review_required;
    context.save();
    context.strokeStyle = color;
    context.fillStyle = `${color}22`;
    context.lineWidth = 2 * ratio;
    context.setLineDash(status === 'verified' ? [] : [5 * ratio, 3 * ratio]);
    context.fillRect(x, y, width, height);
    context.strokeRect(x, y, width, height);
    context.setLineDash([]);
    const label = `${STATUS_LABELS[status] || status}${block.zone ? ` · ${block.zone}` : ''}`;
    context.font = `${10 * ratio}px system-ui`;
    const labelWidth = Math.min(width, context.measureText(label).width + 12 * ratio);
    context.fillStyle = color;
    context.fillRect(x, Math.max(0, y - 18 * ratio), labelWidth, 17 * ratio);
    context.fillStyle = '#fff';
    context.fillText(label, x + 5 * ratio, Math.max(1, y - 16 * ratio));
    context.restore();
  }
}

function ensureOverlayControls(pageCard) {
  const panel = $('.book-review-panel', pageCard);
  if (!panel || $('.recovery-overlay-controls', panel)) return;
  const controls = document.createElement('div');
  controls.className = 'recovery-overlay-controls';
  controls.innerHTML = `
    <label>กรอบบนเอกสาร
      <select class="recovery-overlay-filter">
        <option value="all">แสดงข้อความทั้งหมด</option>
        <option value="verified">เฉพาะข้อความยืนยันแล้ว</option>
        <option value="possible">พื้นที่ที่ควรตรวจ</option>
        <option value="non_text">Non-Text ที่ยังไม่ยืนยัน</option>
      </select>
    </label>
    <span><i class="status-dot verified"></i>ยืนยัน</span>
    <span><i class="status-dot review_required"></i>ต้องตรวจ</span>
    <span><i class="status-dot possible_text"></i>อาจเป็นข้อความ</span>
    <span><i class="status-dot likely_non_text"></i>อาจไม่ใช่ข้อความ</span>`;
  $('.book-summary-grid', panel)?.insertAdjacentElement('afterend', controls);
  controls.addEventListener('change', () => drawOverlay(pageCard));
}

function appendStatusToCard(card, block) {
  const status = blockStatus(block);
  card.classList.remove('status-verified', 'status-review_required', 'status-possible_text', 'status-likely_non_text');
  card.classList.add(`status-${status}`);
  card.dataset.recoveryStatus = status;
  let badge = $('.recovery-status-badge', card);
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'recovery-status-badge';
    card.querySelector('header')?.append(badge);
  }
  badge.textContent = STATUS_LABELS[status] || status;
}

function renderSaraAmReview(card, block) {
  const fromSummary = block.confidenceSummary?.brokenSaraAm;
  const analysis = fromSummary?.issueCount ? fromSummary : analyzeBrokenSaraAm(block.text || '', {
    confidence: block.confidence,
    bbox: block.bbox,
    type: block.type,
    context: block.text,
    properNoun: ['person_name', 'school_name', 'organization_name'].includes(block.type),
  });
  card.querySelector('.sara-am-spacing-review')?.remove();
  if (!analysis?.issueCount) return;
  const candidate = analysis.decisions?.[0]?.candidate || analysis.candidates?.[0] || analysis.correctedText;
  const review = document.createElement('section');
  review.className = 'sara-am-spacing-review';
  review.innerHTML = `
    <header><strong>ตรวจช่องว่างสระอำ</strong><span>broken_sara_am</span></header>
    <div class="sara-am-comparison">
      <label>ต้นฉบับ OCR<code>${escapeHtml(analysis.rawText || block.rawText || block.text || '')}</code></label>
      <label>คำแนะนำ<code>${escapeHtml(candidate || 'ยังไม่มี Candidate')}</code></label>
    </div>
    <p>ตรวจพบช่องว่างภายใน Grapheme หรือรูปสระอำที่ต้องยืนยันจากภาพ ระบบไม่แก้ชื่อเฉพาะแบบเงียบ ๆ</p>
    <div class="sara-am-actions">
      <button type="button" data-sara-action="accept" data-block-id="${escapeHtml(block.id)}" data-candidate="${escapeHtml(candidate || '')}">ยืนยันคำแนะนำ</button>
      <button type="button" data-sara-action="keep" data-block-id="${escapeHtml(block.id)}">คงข้อความเดิม</button>
      <button type="button" data-sara-action="rerun" data-block-id="${escapeHtml(block.id)}">อ่านใหม่</button>
    </div>`;
  const candidates = $('.book-candidates', card);
  (candidates || card.querySelector('.book-current-text'))?.insertAdjacentElement('afterend', review);
}

function decorateReviewBlocks(pageCard, result) {
  for (const block of result.blocks || []) {
    const card = pageCard.querySelector(`[data-book-block="${CSS.escape(block.id)}"]`);
    if (!card) continue;
    appendStatusToCard(card, block);
    renderSaraAmReview(card, block);
  }
}

function updateSummary(pageCard, result) {
  const panel = $('.book-review-panel', pageCard);
  if (!panel) return;
  let recovery = $('.recovery-summary', panel);
  if (!recovery) {
    recovery = document.createElement('div');
    recovery.className = 'recovery-summary';
    $('.book-summary-grid', panel)?.insertAdjacentElement('afterend', recovery);
  }
  const statuses = result.blocks.reduce((counts, block) => {
    const status = blockStatus(block);
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const recovered = Number(result.layout?.recoveredBlockCount || result.recovery?.recoveredBlocks || 0);
  recovery.innerHTML = `
    <span>Recovery Scan <strong>${result.layout?.recoveryTriggered ? 'ทำงาน' : 'ไม่จำเป็น'}</strong></span>
    <span>กู้กลับมา <strong>${recovered} Block</strong></span>
    <span>ต้องตรวจ <strong>${Number(statuses.review_required || 0) + Number(statuses.possible_text || 0)}</strong></span>
    <span>อาจไม่ใช่ข้อความ <strong>${statuses.likely_non_text || 0}</strong></span>`;
}

function handleResult(pageCard, result) {
  resultsByPage.set(pageCard, result);
  ensureOverlayControls(pageCard);
  updateSummary(pageCard, result);
  decorateReviewBlocks(pageCard, result);
  const image = $('.page-preview', pageCard);
  if (image?.complete) requestAnimationFrame(() => drawOverlay(pageCard));
  else image?.addEventListener('load', () => drawOverlay(pageCard), { once: true });
}

document.addEventListener('ripscan:book-result', event => {
  const pageCard = event.target.closest?.('.page-card') || event.target;
  if (pageCard?.classList?.contains('page-card') && event.detail) handleResult(pageCard, event.detail);
});

document.addEventListener('click', event => {
  const control = event.target.closest('[data-sara-action]');
  if (!control) return;
  const pageCard = control.closest('.page-card');
  const card = control.closest('.book-review-block');
  const action = control.dataset.saraAction;
  if (action === 'accept') {
    const textarea = card?.querySelector(`[data-book-edit="${CSS.escape(control.dataset.blockId)}"]`);
    if (textarea && control.dataset.candidate) textarea.value = control.dataset.candidate;
    card?.querySelector(`[data-book-action="apply-edit"][data-block-id="${CSS.escape(control.dataset.blockId)}"]`)?.click();
    card?.classList.add('sara-am-confirmed');
  }
  if (action === 'keep') {
    card?.classList.add('sara-am-kept');
    control.closest('.sara-am-spacing-review')?.setAttribute('data-resolved', 'kept');
  }
  if (action === 'rerun') card?.querySelector(`[data-book-action="rerun-block"][data-block-id="${CSS.escape(control.dataset.blockId)}"]`)?.click();
});

const resizeObserver = new ResizeObserver(entries => {
  for (const entry of entries) {
    const pageCard = entry.target.closest('.page-card');
    if (pageCard && resultsByPage.has(pageCard)) drawOverlay(pageCard);
  }
});

const mutationObserver = new MutationObserver(() => {
  $$('.page-card').forEach(pageCard => {
    const image = $('.page-preview', pageCard);
    if (image && !image.dataset.recoveryObserved) {
      image.dataset.recoveryObserved = 'true';
      resizeObserver.observe(image);
    }
    const result = window.__ripscanBookResults?.get?.(pageCard);
    if (result) handleResult(pageCard, result);
  });
});

const results = $('#results');
if (results) mutationObserver.observe(results, { childList: true, subtree: true });
