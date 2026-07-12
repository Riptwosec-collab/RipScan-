import {
  DEFAULT_BOOK_OCR_OPTIONS,
  normalizeThaiUnicodeDetailed,
  preserveTextSymbols,
} from './book-ocr-core.mjs';
import { cancelBookCoverOcr, processBookCoverCanvas } from './book-ocr-browser.mjs';

const STORAGE_KEY = 'ripscan-book-ocr-options-v1';
const processedPages = new WeakSet();
let pageResults = new WeakMap();
let queue = Promise.resolve();
let currentRunToken = 0;

function ensureStylesheet() {
  if (document.querySelector('link[href="/book-ocr.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/book-ocr.css';
  document.head.append(link);
}

function loadOptions() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULT_BOOK_OCR_OPTIONS, ...stored };
  } catch {
    return { ...DEFAULT_BOOK_OCR_OPTIONS };
  }
}

let options = loadOptions();

function saveOptions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
}

function readControlOptions(root) {
  if (!root) return options;
  options = {
    ...options,
    mode: root.querySelector('#bookOcrMode')?.value || 'text_only',
    readTextOnImages: Boolean(root.querySelector('#readTextOnImages')?.checked),
    skipLogoAndIcons: Boolean(root.querySelector('#skipLogoAndIcons')?.checked),
    detailedSaraAm: Boolean(root.querySelector('#detailedSaraAm')?.checked),
    validateToneMarks: Boolean(root.querySelector('#validateToneMarks')?.checked),
    validateUpperLowerVowels: Boolean(root.querySelector('#validateUpperLowerVowels')?.checked),
    validateDifficultThai: Boolean(root.querySelector('#validateDifficultThai')?.checked),
    validateProperNouns: Boolean(root.querySelector('#validateProperNouns')?.checked),
    preserveThaiDigits: Boolean(root.querySelector('#preserveThaiDigits')?.checked),
    preserveDashes: Boolean(root.querySelector('#preserveDashes')?.checked),
    preserveSeparators: Boolean(root.querySelector('#preserveSeparators')?.checked),
    preserveLineBreaks: Boolean(root.querySelector('#preserveLineBreaks')?.checked),
    preserveHeadings: Boolean(root.querySelector('#preserveHeadings')?.checked),
    preserveLists: Boolean(root.querySelector('#preserveLists')?.checked),
  };
  saveOptions();
  return options;
}

function checkbox(id, label, checked) {
  return `<label class="book-option-check"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
}

function installOptions() {
  const settings = document.querySelector('.settings-panel');
  const controls = settings?.querySelector('.compact-controls, .controls');
  if (!settings || !controls || document.querySelector('#bookOcrOptions')) return;

  const clearButton = document.querySelector('#clearButton');
  if (clearButton && !document.querySelector('#clearScanPagesButton')) {
    const button = document.createElement('button');
    button.id = 'clearScanPagesButton';
    button.type = 'button';
    button.className = 'secondary clear-scan-pages';
    button.textContent = 'ล้างหน้าสแกน';
    button.disabled = true;
    clearButton.insertAdjacentElement('afterend', button);
  }

  const details = document.createElement('details');
  details.id = 'bookOcrOptions';
  details.className = 'book-ocr-options';
  details.innerHTML = `
    <summary><span>การอ่านขั้นสูง</span><small>Text Only · สระอำ · ขีด · เส้นคั่น</small></summary>
    <div class="book-options-grid">
      <label class="book-option-select">โหมดการอ่าน
        <select id="bookOcrMode">
          <option value="text_only">อ่านเฉพาะข้อความ</option>
          <option value="text_on_images">อ่านข้อความบนรูปด้วย</option>
          <option value="table_only">อ่านเฉพาะตาราง</option>
          <option value="all">อ่านทั้งหมด</option>
        </select>
      </label>
      ${checkbox('readTextOnImages', 'อ่านข้อความบนรูปภาพด้วย', options.readTextOnImages)}
      ${checkbox('skipLogoAndIcons', 'ข้ามรูป โลโก้ และไอคอน', options.skipLogoAndIcons)}
      ${checkbox('detailedSaraAm', 'ตรวจสระอำแบบละเอียด', options.detailedSaraAm)}
      ${checkbox('validateToneMarks', 'ตรวจวรรณยุกต์', options.validateToneMarks)}
      ${checkbox('validateUpperLowerVowels', 'ตรวจสระบนและล่าง', options.validateUpperLowerVowels)}
      ${checkbox('validateDifficultThai', 'ตรวจคำไทยยาก', options.validateDifficultThai)}
      ${checkbox('validateProperNouns', 'ตรวจชื่อเฉพาะ', options.validateProperNouns)}
      ${checkbox('preserveThaiDigits', 'รักษาเลขไทย', options.preserveThaiDigits)}
      ${checkbox('preserveDashes', 'รักษาเครื่องหมายขีด', options.preserveDashes)}
      ${checkbox('preserveSeparators', 'รักษาเส้นคั่น', options.preserveSeparators)}
      ${checkbox('preserveLineBreaks', 'รักษาการขึ้นบรรทัด', options.preserveLineBreaks)}
      ${checkbox('preserveHeadings', 'รักษาหัวข้อ', options.preserveHeadings)}
      ${checkbox('preserveLists', 'รักษารายการ', options.preserveLists)}
    </div>`;
  settings.insertBefore(details, settings.querySelector('#status'));
  details.querySelector('#bookOcrMode').value = options.mode;
  details.addEventListener('change', () => readControlOptions(details));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

async function imageToCanvas(image) {
  if (!image.complete) await new Promise((resolve, reject) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', reject, { once: true });
  });
  const response = await fetch(image.currentSrc || image.src);
  if (!response.ok) throw new Error('โหลดภาพหน้าเอกสารเพื่อวิเคราะห์ไม่สำเร็จ');
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

function updateGlobalStatus(message, busy = true) {
  const status = document.querySelector('#status');
  const statusText = document.querySelector('#statusText');
  if (!status || !statusText) return;
  status.hidden = !busy;
  statusText.textContent = message;
}

function currentPageNumber(pageCard) {
  const text = pageCard.querySelector('.page-head strong')?.textContent || '';
  return Number(text.match(/\d+/)?.[0] || 1);
}

function isPdfTextLayer(pageCard) {
  return /PDF Text Layer|อ่านข้อความจาก PDF/u.test(pageCard.querySelector('.processing-summary')?.textContent || pageCard.querySelector('.page-head')?.textContent || '');
}

function setPageText(pageCard, value) {
  const textarea = pageCard.querySelector('textarea.page-text');
  if (!textarea) return;
  textarea.value = preserveTextSymbols(value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function metricBadge(label, value, warning = false) {
  const percent = Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';
  return `<span class="book-metric ${warning ? 'warning' : ''}"><small>${escapeHtml(label)}</small><strong>${percent}</strong></span>`;
}

function renderBarcode(barcode) {
  return `<div class="barcode-result"><strong>${escapeHtml(barcode.format || barcode.type || 'Barcode')}</strong><code>${escapeHtml(barcode.value || 'ตรวจพบบริเวณบาร์โค้ด แต่เบราว์เซอร์ยังถอดรหัสไม่ได้')}</code>${barcode.isbn ? `<span>ISBN: ${escapeHtml(barcode.isbn)}</span>` : ''}${barcode.price ? `<span>ราคา: ${escapeHtml(barcode.price)}</span>` : ''}</div>`;
}

function blockCard(block, pageIndex) {
  const confidence = block.confidenceSummary || {};
  const attempts = block.attempts?.length
    ? block.attempts.map((attempt, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(attempt.name)}</td><td>${escapeHtml(attempt.language || block.language)}</td><td>${Math.round((attempt.confidence || 0) * 100)}%</td><td>${escapeHtml(attempt.text || '—')}</td></tr>`).join('')
    : '<tr><td colspan="5">ยังไม่มีผล Variant</td></tr>';
  const candidates = block.candidates?.length
    ? block.candidates.map(candidate => `<button type="button" class="candidate-chip" data-book-action="apply-candidate" data-page-index="${pageIndex}" data-block-id="${escapeHtml(block.id)}" data-candidate="${escapeHtml(candidate.text)}"><span>${escapeHtml(candidate.text)}</span><small>${Math.round(candidate.score * 100)}%${candidate.dictionarySupport ? ' · Dictionary' : ''}</small></button>`).join('')
    : '<span class="book-empty">ไม่มี Candidate ที่มีหลักฐานเพียงพอ</span>';
  return `<article class="book-review-block ${block.requiresReview ? 'needs-review' : 'verified'}" data-book-block="${escapeHtml(block.id)}">
    <header><div><strong>${escapeHtml(block.type || 'unknown')}</strong><small>ภาษา ${escapeHtml(block.language || 'tha')} · ${Math.round((block.confidence || 0) * 100)}%</small></div><span class="review-state">${block.lowResolution ? 'Low Resolution' : block.requiresReview ? 'ควรตรวจสอบ' : 'ผ่าน'}</span></header>
    <div class="book-crops">
      <figure><img src="${escapeHtml(block.originalCropUrl || '')}" alt="Original Crop"><figcaption>Original Crop</figcaption></figure>
      <figure><img src="${escapeHtml(block.enhancedCropUrl || block.originalCropUrl || '')}" alt="Enhanced Crop"><figcaption>Enhanced Crop</figcaption></figure>
      <figure><img src="${escapeHtml(block.upscaleCropUrl || block.enhancedCropUrl || '')}" alt="Upscale Crop"><figcaption>Upscale Crop</figcaption></figure>
    </div>
    <div class="book-confidence-row">
      ${metricBadge('Text Region', confidence.textRegionConfidence ?? block.regionConfidence, (confidence.textRegionConfidence ?? 0) < .8)}
      ${metricBadge('Thai Script', confidence.thaiScriptConfidence, (confidence.thaiScriptConfidence ?? 1) < .9)}
      ${metricBadge('Grapheme', confidence.graphemeConfidence, (confidence.graphemeConfidence ?? 1) < .96)}
      ${metricBadge('สระอำ', confidence.saraAmConfidence, (confidence.saraAmConfidence ?? 1) < .96)}
      ${metricBadge('Final', confidence.finalConfidence ?? block.confidence, (confidence.finalConfidence ?? block.confidence) < .96)}
    </div>
    <label class="book-current-text">ผลที่เลือก<textarea data-book-edit="${escapeHtml(block.id)}">${escapeHtml(block.text || '')}</textarea></label>
    <div class="book-candidates"><strong>Candidate</strong><div>${candidates}</div></div>
    <details class="variant-details"><summary>OCR แต่ละ Variant (${block.attempts?.length || 0})</summary><div class="variant-table-wrap"><table><thead><tr><th>#</th><th>Variant</th><th>ภาษา</th><th>Confidence</th><th>ผล OCR</th></tr></thead><tbody>${attempts}</tbody></table></div></details>
    ${block.failureSignals?.length ? `<p class="failure-signals">เหตุผล: ${block.failureSignals.map(escapeHtml).join(' · ')}</p>` : ''}
    <div class="book-block-actions">
      <button type="button" data-book-action="confirm" data-page-index="${pageIndex}" data-block-id="${escapeHtml(block.id)}">ยืนยัน</button>
      <button type="button" data-book-action="apply-edit" data-page-index="${pageIndex}" data-block-id="${escapeHtml(block.id)}">ใช้ข้อความที่แก้ไข</button>
      <button type="button" data-book-action="focus-page-text" data-page-index="${pageIndex}" data-block-id="${escapeHtml(block.id)}">แก้ในข้อความหน้า</button>
      <select data-book-language="${escapeHtml(block.id)}" aria-label="กำหนดภาษาสำหรับ Block">
        <option value="tha" ${block.language === 'tha' ? 'selected' : ''}>ไทย</option>
        <option value="tha+eng" ${block.language === 'tha+eng' ? 'selected' : ''}>ไทย + English</option>
        <option value="eng" ${block.language === 'eng' ? 'selected' : ''}>English</option>
        <option value="number" ${block.language === 'number' ? 'selected' : ''}>ตัวเลข / ISBN</option>
      </select>
      <button type="button" data-book-action="rerun-block" data-page-index="${pageIndex}" data-block-id="${escapeHtml(block.id)}">อ่านใหม่</button>
    </div>
  </article>`;
}

function renderReviewPanel(pageCard, result) {
  const pageIndex = Number(pageCard.querySelector('.page-text')?.dataset.page || 0);
  let panel = pageCard.querySelector('.book-review-panel');
  if (!panel) {
    panel = document.createElement('section');
    panel.className = 'book-review-panel';
    panel.hidden = true;
    pageCard.append(panel);
  }
  panel.innerHTML = `
    <header class="book-review-head"><div><strong>ข้อความขนาดเล็กและคำไทยยาก</strong><small>Text Only · Block OCR · สระอำ · ขีด · Barcode</small></div><button type="button" data-book-action="rerun-page" data-page-index="${pageIndex}">อ่านหน้านี้ใหม่</button></header>
    <div class="book-summary-grid">
      <span><small>Text Blocks</small><strong>${result.blocks.length}</strong></span>
      <span><small>ต้องตรวจ</small><strong>${result.review.count}</strong></span>
      <span><small>ข้าม Image</small><strong>${result.skippedImageRegions}</strong></span>
      <span><small>Barcode</small><strong>${result.barcodes.length}</strong></span>
      <span><small>Confidence</small><strong>${Math.round(result.confidence * 100)}%</strong></span>
    </div>
    ${result.barcodes.length ? `<section class="barcode-results"><h4>Barcode / ISBN</h4>${result.barcodes.map(renderBarcode).join('')}</section>` : ''}
    <div class="book-review-list">${result.review.blocks.length ? result.review.blocks.map(block => blockCard(block, pageIndex)).join('') : '<p class="book-pass">ไม่พบ Block ที่ต้องตรวจเพิ่มเติม</p>'}</div>`;

  let toggle = pageCard.querySelector('[data-book-action="toggle-review"]');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.dataset.bookAction = 'toggle-review';
    toggle.dataset.pageIndex = String(pageIndex);
    toggle.className = 'book-review-toggle';
    pageCard.querySelector('.page-actions')?.append(toggle);
  }
  toggle.textContent = `ข้อความขนาดเล็กและคำไทยยาก${result.review.count ? ` (${result.review.count})` : ''}`;
  toggle.classList.toggle('has-review', result.review.count > 0);
}

async function processPage(pageCard, force = false) {
  if ((!force && processedPages.has(pageCard)) || isPdfTextLayer(pageCard)) return;
  processedPages.add(pageCard);
  const token = currentRunToken;
  const image = pageCard.querySelector('img.page-preview');
  if (!image) return;
  const originalButton = pageCard.querySelector('[data-action="preview-original"]');
  originalButton?.click();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const pageNumber = currentPageNumber(pageCard);
  updateGlobalStatus(`หน้า ${pageNumber} · กำลังแยกข้อความออกจากรูปและบาร์โค้ด…`, true);
  const canvas = await imageToCanvas(image);
  try {
    const result = await processBookCoverCanvas(canvas, {
      options: readControlOptions(document.querySelector('#bookOcrOptions')),
      onProgress(message) {
        if (token !== currentRunToken) return;
        const percent = Math.round((message.progress || 0) * 100);
        updateGlobalStatus(`หน้า ${pageNumber} · ${message.label || message.status} · ${percent}%`, true);
      },
    });
    if (token !== currentRunToken) return;
    pageResults.set(pageCard, result);
    const lowResolutionOnly = !result.text && result.review.blocks.some(block => block.lowResolution);
    if (result.text) setPageText(pageCard, result.text);
    else if (lowResolutionOnly) setPageText(pageCard, '[โปรดตรวจสอบ: ภาพความละเอียดต่ำ ระบบไม่เดาข้อความ]');
    renderReviewPanel(pageCard, result);
  } catch (error) {
    if (error?.message !== 'BOOK_OCR_CANCELLED') {
      console.error(error);
      pageCard.dataset.bookOcrError = error?.message || 'Book OCR failed';
    }
  } finally {
    canvas.width = 1;
    canvas.height = 1;
    updateGlobalStatus('', false);
  }
}

function enqueuePage(pageCard, force = false) {
  queue = queue.then(() => processPage(pageCard, force)).catch(error => console.error(error));
  return queue;
}

function enhanceResults() {
  const pageCards = [...document.querySelectorAll('.page-card')];
  const clearPages = document.querySelector('#clearScanPagesButton');
  if (clearPages) clearPages.disabled = pageCards.length === 0;
  pageCards.forEach(pageCard => enqueuePage(pageCard));
}

async function rerunBlock(pageCard, blockId) {
  const result = pageResults.get(pageCard);
  const block = result?.blocks.find(item => item.id === blockId);
  if (!block) return;
  const language = pageCard.querySelector(`[data-book-language="${CSS.escape(blockId)}"]`)?.value || 'tha';
  const image = pageCard.querySelector('img.page-preview');
  const canvas = await imageToCanvas(image);
  const crop = document.createElement('canvas');
  const padding = Math.max(6, Math.round(block.bbox.height * .18));
  const left = Math.max(0, Math.floor(block.bbox.left - padding));
  const top = Math.max(0, Math.floor(block.bbox.top - padding));
  const width = Math.min(canvas.width - left, Math.ceil(block.bbox.width + padding * 2));
  const height = Math.min(canvas.height - top, Math.ceil(block.bbox.height + padding * 2));
  crop.width = Math.max(1, width * 3);
  crop.height = Math.max(1, height * 3);
  crop.getContext('2d', { alpha: false }).drawImage(canvas, left, top, width, height, 0, 0, crop.width, crop.height);
  let worker;
  try {
    updateGlobalStatus('กำลังอ่าน Block ใหม่ตามภาษาที่เลือก…', true);
    const langs = language === 'eng' || language === 'number' ? ['eng'] : language === 'tha+eng' ? ['tha', 'eng'] : ['tha'];
    worker = await window.Tesseract.createWorker(langs, 1, { cacheMethod: 'write' });
    await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300', tessedit_pageseg_mode: '6' });
    if (language === 'number') await worker.setParameters({ tessedit_char_whitelist: '0123456789๐๑๒๓๔๕๖๗๘๙ISBNisbnXx-–—−_/|:.,()฿ บาท' });
    const response = await worker.recognize(crop);
    const normalized = normalizeThaiUnicodeDetailed(response.data.text || '');
    block.text = preserveTextSymbols(normalized.normalizedText);
    block.rawText = String(response.data.text || '');
    block.confidence = Math.max(0, Math.min(1, Number(response.data.confidence || 0) / 100));
    block.language = language;
    block.requiresReview = block.confidence < .96;
    const pageText = pageCard.querySelector('.page-text');
    const oldText = pageText?.value || '';
    if (pageText && block.text && oldText.includes(block.rawText.trim())) setPageText(pageCard, oldText.replace(block.rawText.trim(), block.text));
    renderReviewPanel(pageCard, result);
  } finally {
    await worker?.terminate();
    canvas.width = 1; canvas.height = 1; crop.width = 1; crop.height = 1;
    updateGlobalStatus('', false);
  }
}

function applyBlockText(pageCard, blockId, value) {
  const result = pageResults.get(pageCard);
  const block = result?.blocks.find(item => item.id === blockId);
  const textarea = pageCard.querySelector('.page-text');
  if (!block || !textarea) return;
  const next = preserveTextSymbols(value);
  const source = textarea.value;
  if (block.text && source.includes(block.text)) setPageText(pageCard, source.replace(block.text, next));
  else setPageText(pageCard, `${source.trim()}\n\n${next}`.trim());
  block.text = next;
  block.requiresReview = false;
  renderReviewPanel(pageCard, result);
}

async function clearScanPages() {
  currentRunToken += 1;
  await cancelBookCoverOcr();
  document.querySelector('#results').innerHTML = '';
  pageResults = new WeakMap();
  document.querySelector('#clearScanPagesButton')?.setAttribute('disabled', '');
  updateGlobalStatus('', false);
}

function handleBookAction(event) {
  const control = event.target.closest('[data-book-action]');
  if (!control) return;
  const pageCard = control.closest('.page-card');
  const action = control.dataset.bookAction;
  if (action === 'toggle-review') {
    const panel = pageCard?.querySelector('.book-review-panel');
    if (panel) panel.hidden = !panel.hidden;
    control.classList.toggle('active', panel && !panel.hidden);
    return;
  }
  if (!pageCard) return;
  const blockId = control.dataset.blockId;
  if (action === 'rerun-page') {
    processedPages.delete(pageCard);
    enqueuePage(pageCard, true);
  }
  if (action === 'rerun-block') rerunBlock(pageCard, blockId).catch(console.error);
  if (action === 'confirm') {
    const result = pageResults.get(pageCard);
    const block = result?.blocks.find(item => item.id === blockId);
    if (block) { block.requiresReview = false; renderReviewPanel(pageCard, result); }
  }
  if (action === 'apply-candidate') applyBlockText(pageCard, blockId, control.dataset.candidate || '');
  if (action === 'apply-edit') applyBlockText(pageCard, blockId, pageCard.querySelector(`[data-book-edit="${CSS.escape(blockId)}"]`)?.value || '');
  if (action === 'focus-page-text') {
    const textarea = pageCard.querySelector('.page-text');
    const block = pageResults.get(pageCard)?.blocks.find(item => item.id === blockId);
    textarea?.focus();
    const position = block?.text ? textarea?.value.indexOf(block.text) : -1;
    if (position >= 0) textarea.setSelectionRange(position, position + block.text.length);
  }
}

ensureStylesheet();
installOptions();
document.addEventListener('change', event => {
  if (event.target.closest('#bookOcrOptions')) readControlOptions(document.querySelector('#bookOcrOptions'));
});
document.addEventListener('click', event => {
  if (event.target.closest('#clearScanPagesButton')) clearScanPages();
  handleBookAction(event);
});

const resultObserver = new MutationObserver(enhanceResults);
const results = document.querySelector('#results');
if (results) resultObserver.observe(results, { childList: true, subtree: true });
enhanceResults();

window.RipScanBookOCR = Object.freeze({
  getOptions: () => ({ ...options }),
  clearScanPages,
  processVisiblePages: enhanceResults,
  cancel: cancelBookCoverOcr,
});
