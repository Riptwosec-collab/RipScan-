import {
  classifyCoverDocument,
  classifyProtectedText,
  confidenceGate,
  decorativeVariantPlan,
  detectGibberish,
} from './cover-ocr-core.mjs';
import { analyzeThaiGraphemes, preserveTextSymbols } from './book-ocr-core.mjs';
import { loadTesseract } from './lazy-libraries.mjs';

const pageState = new WeakMap();
let regionSequence = 0;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function createState(pageCard) {
  const state = {
    regions: [],
    activeRegionId: null,
    drawing: false,
    drawStart: null,
    objectUrl: null,
    documentMode: null,
  };
  pageState.set(pageCard, state);
  return state;
}

function stateFor(pageCard) {
  return pageState.get(pageCard) || createState(pageCard);
}

function pageImage(pageCard) {
  return $('.page-preview', pageCard) || $('img', pageCard);
}

function pageTextArea(pageCard) {
  return $('.page-text', pageCard) || $('textarea', pageCard);
}

function normalizedPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
  };
}

function regionLabel(region) {
  const names = {
    title: 'หัวข้อ',
    person_name: 'ชื่อบุคคล',
    school_name: 'ชื่อโรงเรียน',
    organization_name: 'ชื่อหน่วยงาน',
    class_level: 'ชั้นเรียน',
    paragraph: 'เนื้อหา',
    unknown: 'ข้อความทั่วไป',
    illustration: 'รูปประกอบ',
  };
  return names[region.type] || region.type;
}

function syncCanvas(panel, pageCard) {
  const image = pageImage(pageCard);
  const canvas = $('.cover-region-canvas', panel);
  if (!image || !canvas) return;
  const rect = image.getBoundingClientRect();
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  drawRegions(panel, pageCard);
}

function drawRegions(panel, pageCard) {
  const canvas = $('.cover-region-canvas', panel);
  if (!canvas) return;
  const state = stateFor(pageCard);
  const context = canvas.getContext('2d');
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (const region of state.regions) {
    const x = region.x * canvas.width;
    const y = region.y * canvas.height;
    const width = region.width * canvas.width;
    const height = region.height * canvas.height;
    const active = region.id === state.activeRegionId;
    const excluded = region.regionType !== 'text';
    context.save();
    context.strokeStyle = excluded ? '#f59e0b' : active ? '#22d3ee' : '#a855f7';
    context.fillStyle = excluded ? 'rgba(245,158,11,.12)' : active ? 'rgba(34,211,238,.14)' : 'rgba(168,85,247,.1)';
    context.lineWidth = (active ? 3 : 2) * ratio;
    context.setLineDash(active ? [] : [6 * ratio, 4 * ratio]);
    context.fillRect(x, y, width, height);
    context.strokeRect(x, y, width, height);
    context.setLineDash([]);
    context.font = `${11 * ratio}px system-ui`;
    context.textBaseline = 'top';
    const label = `${regionLabel(region)} ${region.status === 'accepted' ? '✓' : region.status === 'rejected_as_non_text' ? '×' : ''}`;
    const labelWidth = context.measureText(label).width + 12 * ratio;
    context.fillStyle = excluded ? '#b45309' : active ? '#0369a1' : '#6d28d9';
    context.fillRect(x, Math.max(0, y - 20 * ratio), labelWidth, 19 * ratio);
    context.fillStyle = '#fff';
    context.fillText(label, x + 6 * ratio, Math.max(1, y - 18 * ratio));
    context.restore();
  }
}

function renderRegionList(panel, pageCard) {
  const state = stateFor(pageCard);
  const list = $('.cover-region-list', panel);
  const summary = $('.cover-region-summary', panel);
  if (!list || !summary) return;
  const textCount = state.regions.filter(region => region.regionType === 'text').length;
  const skippedCount = state.regions.filter(region => region.regionType !== 'text').length;
  const autoBlocks = $$('.book-review-block', pageCard).length;
  const automaticSkipped = Number($('.book-review-panel', pageCard)?.dataset.skippedRegions || 0);
  summary.innerHTML = `<span>Text Block <strong>${textCount + autoBlocks}</strong></span><span>Non-Text ที่ข้าม <strong>${skippedCount + automaticSkipped}</strong></span><span>โหมด <strong>${escapeHtml(state.documentMode?.type || 'รอตรวจ')}</strong></span>`;
  if (!state.regions.length) {
    list.innerHTML = '<p class="cover-empty">ยังไม่มีกรอบที่วาดเอง กด “วาดกรอบข้อความ” แล้วลากบนภาพ</p>';
    drawRegions(panel, pageCard);
    return;
  }
  list.innerHTML = state.regions.map(region => `
    <button class="cover-region-item ${region.id === state.activeRegionId ? 'active' : ''}" type="button" data-region-id="${region.id}">
      <span class="cover-region-index">${state.regions.indexOf(region) + 1}</span>
      <span><strong>${escapeHtml(regionLabel(region))}</strong><small>${escapeHtml(region.language || 'tha')} · ${region.status === 'accepted' ? 'ยืนยันแล้ว' : region.status === 'rejected_as_non_text' ? 'ข้ามรูป' : 'รอตรวจ'}</small></span>
      <span class="cover-region-confidence">${Number.isFinite(region.confidence) ? `${Math.round(region.confidence * 100)}%` : '—'}</span>
    </button>`).join('');
  drawRegions(panel, pageCard);
  renderSelectedRegion(panel, pageCard);
}

function renderSelectedRegion(panel, pageCard) {
  const state = stateFor(pageCard);
  const region = state.regions.find(item => item.id === state.activeRegionId);
  const detail = $('.cover-region-detail', panel);
  if (!detail) return;
  if (!region) {
    detail.innerHTML = '<p class="cover-empty">เลือกกรอบเพื่อกำหนดประเภท ภาษา หรืออ่านใหม่เฉพาะบริเวณ</p>';
    return;
  }
  const attempts = region.attempts?.length
    ? region.attempts.map(attempt => `<tr><td>${escapeHtml(attempt.variant)}</td><td>${Math.round((attempt.confidence || 0) * 100)}%</td><td>${escapeHtml(attempt.text || '—')}</td></tr>`).join('')
    : '<tr><td colspan="3">ยังไม่ได้ OCR กรอบนี้</td></tr>';
  const candidates = region.attempts?.filter(attempt => attempt.text).map(attempt => attempt.text) || [];
  detail.innerHTML = `
    <div class="cover-detail-grid">
      <label>ประเภท
        <select data-cover-field="type">
          <option value="title">หัวข้อ</option>
          <option value="person_name">ชื่อบุคคล</option>
          <option value="school_name">ชื่อโรงเรียน</option>
          <option value="organization_name">ชื่อหน่วยงาน</option>
          <option value="class_level">ชั้นเรียน</option>
          <option value="paragraph">เนื้อหา</option>
          <option value="unknown">ข้อความทั่วไป</option>
          <option value="illustration">รูป ไม่ใช่ข้อความ</option>
        </select>
      </label>
      <label>ภาษา
        <select data-cover-field="language">
          <option value="tha">ภาษาไทย</option>
          <option value="tha+eng">ไทย + English</option>
          <option value="eng">English</option>
          <option value="number">ตัวเลข / รหัส</option>
        </select>
      </label>
    </div>
    <label class="cover-output-label">ผลข้อความ
      <textarea data-cover-field="text" placeholder="ผล OCR จะแสดงที่นี่">${escapeHtml(region.text || '')}</textarea>
    </label>
    ${region.cropUrl ? `<div class="cover-crop-row"><figure><img src="${escapeHtml(region.cropUrl)}" alt="Crop กรอบข้อความ"><figcaption>Original Crop</figcaption></figure>${region.enhancedUrl ? `<figure><img src="${escapeHtml(region.enhancedUrl)}" alt="Enhanced Crop"><figcaption>Enhanced Crop</figcaption></figure>` : ''}</div>` : ''}
    <div class="cover-detail-status ${region.status || 'manual_review'}">
      <strong>${region.status === 'accepted' ? 'ผ่าน Confidence Gate' : region.status === 'rejected_as_non_text' ? 'ข้ามจาก Text OCR' : 'ต้องตรวจสอบ'}</strong>
      <span>${escapeHtml(region.reason || (candidates.length ? `Candidate ${candidates.length} ค่า` : 'ยังไม่มีผล OCR'))}</span>
    </div>
    <details class="cover-attempts"><summary>OCR Candidates และ Variant</summary><div><table><thead><tr><th>Variant</th><th>Confidence</th><th>ผล</th></tr></thead><tbody>${attempts}</tbody></table></div></details>
    <div class="cover-region-actions">
      <button type="button" data-cover-action="recognize">อ่านกรอบนี้</button>
      <button type="button" data-cover-action="apply">ยืนยันและเพิ่มเข้าเอกสาร</button>
      <button type="button" data-cover-action="mark-image">เป็นรูป ไม่ใช่ข้อความ</button>
      <button type="button" data-cover-action="delete">ลบกรอบ</button>
    </div>`;
  $('[data-cover-field="type"]', detail).value = region.type;
  $('[data-cover-field="language"]', detail).value = region.language || 'tha';
}

async function imageBitmapFor(image) {
  if (!image.complete) await new Promise((resolve, reject) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', reject, { once: true });
  });
  const response = await fetch(image.currentSrc || image.src);
  if (!response.ok) throw new Error('โหลดภาพสำหรับวาดกรอบไม่สำเร็จ');
  return createImageBitmap(await response.blob());
}

function canvasFromBitmap(bitmap, region, scale = 1) {
  const left = Math.round(region.x * bitmap.width);
  const top = Math.round(region.y * bitmap.height);
  const width = Math.max(1, Math.round(region.width * bitmap.width));
  const height = Math.max(1, Math.round(region.height * bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, left, top, width, height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function grayscaleCanvas(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d', { alpha: false });
  context.filter = 'grayscale(1) contrast(1.16)';
  context.drawImage(source, 0, 0);
  context.filter = 'none';
  return canvas;
}

function textMaskCanvas(source) {
  const canvas = grayscaleCanvas(source);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  for (let index = 0; index < data.data.length; index += 4) sum += data.data[index];
  const mean = sum / Math.max(1, data.data.length / 4);
  for (let index = 0; index < data.data.length; index += 4) {
    const value = Math.abs(data.data[index] - mean) > 28 ? (data.data[index] < mean ? 0 : 255) : 255;
    data.data[index] = value;
    data.data[index + 1] = value;
    data.data[index + 2] = value;
  }
  context.putImageData(data, 0, 0);
  return canvas;
}

function scriptConfidence(text, language) {
  const characters = [...String(text || '')].filter(character => /[\p{L}\p{N}]/u.test(character));
  if (!characters.length) return 0;
  const thai = characters.filter(character => /[ก-๙]/u.test(character)).length;
  const latin = characters.filter(character => /[A-Za-z]/.test(character)).length;
  if (language === 'tha') return thai / characters.length;
  if (language === 'eng') return latin / characters.length;
  return (thai + latin) / characters.length;
}

async function recognizeRegion(panel, pageCard, region) {
  const image = pageImage(pageCard);
  if (!image) throw new Error('ไม่พบภาพสำหรับ OCR');
  const button = $('[data-cover-action="recognize"]', panel);
  if (button) { button.disabled = true; button.textContent = 'กำลังอ่าน…'; }
  const bitmap = await imageBitmapFor(image);
  const original = canvasFromBitmap(bitmap, region, 1);
  const up4 = canvasFromBitmap(bitmap, region, 4);
  const up6 = canvasFromBitmap(bitmap, region, 6);
  bitmap.close();
  const grayscale = grayscaleCanvas(up4);
  const mask = textMaskCanvas(up4);
  const plan = decorativeVariantPlan({ estimatedTextHeight: original.height, decorativeFontScore: region.type === 'title' ? 0.72 : 0.35 });
  const variants = [
    { variant: 'Original Crop', canvas: original },
    { variant: 'Upscale 4x', canvas: up4 },
    { variant: 'Upscale 6x', canvas: up6 },
    { variant: 'Grayscale', canvas: grayscale },
    { variant: 'Text Mask', canvas: mask },
  ].filter(item => plan.includes(item.variant));
  const langs = region.language === 'eng' || region.language === 'number' ? ['eng'] : region.language === 'tha+eng' ? ['tha', 'eng'] : ['tha'];
  const worker = await (await loadTesseract()).createWorker(langs, 1, { cacheMethod: 'write' });
  await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300', tessedit_pageseg_mode: '7' });
  if (region.language === 'number') await worker.setParameters({ tessedit_char_whitelist: '0123456789๐๑๒๓๔๕๖๗๘๙ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-–—−_/|:.,()' });
  const attempts = [];
  try {
    for (const item of variants) {
      const response = await worker.recognize(item.canvas);
      const text = preserveTextSymbols(String(response.data.text || ''));
      const confidence = Math.max(0, Math.min(1, Number(response.data.confidence || 0) / 100));
      const gibberish = detectGibberish(text, { confidence, hasBaseline: true, boundingBoxFit: true });
      attempts.push({ variant: item.variant, text, confidence, gibberish });
    }
  } finally {
    await worker.terminate();
    [original, up4, up6, grayscale, mask].forEach(canvas => { canvas.width = 1; canvas.height = 1; });
  }
  attempts.sort((a, b) => {
    const aScore = a.confidence - a.gibberish.score * 0.72;
    const bScore = b.confidence - b.gibberish.score * 0.72;
    return bScore - aScore;
  });
  const best = attempts[0] || { text: '', confidence: 0, gibberish: { status: 'manual_review', score: 1, reasons: ['no_candidate'] } };
  const grapheme = analyzeThaiGraphemes(best.text);
  const inferredType = region.type === 'unknown' ? classifyProtectedText(best.text, {}, {}) : region.type;
  const gate = confidenceGate({
    text: best.text,
    type: inferredType,
    textRegionConfidence: 1,
    ocrConfidence: best.confidence,
    scriptConfidence: scriptConfidence(best.text, region.language),
    graphemeConfidence: grapheme.graphemeConfidence,
    baselineEvidence: 1,
    boundingBoxFit: true,
  });
  region.type = inferredType;
  region.text = best.text;
  region.confidence = best.confidence;
  region.status = gate.status;
  region.reason = gate.failures?.join(' · ') || 'ผ่านหลักฐานภาพและภาษา';
  region.attempts = attempts;
  region.cropUrl = original.toDataURL?.('image/jpeg', .88) || '';
  region.enhancedUrl = up4.toDataURL?.('image/jpeg', .88) || '';
  renderRegionList(panel, pageCard);
  if (button) { button.disabled = false; button.textContent = 'อ่านกรอบนี้'; }
}

function appendAcceptedText(pageCard, region) {
  const textarea = pageTextArea(pageCard);
  if (!textarea) return;
  const value = preserveTextSymbols(region.text || '');
  if (!value) return;
  const existing = textarea.value.trim();
  textarea.value = existing ? `${existing}\n\n${value}` : value;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function installPointerDrawing(panel, pageCard) {
  const canvas = $('.cover-region-canvas', panel);
  if (!canvas || canvas.dataset.ready) return;
  canvas.dataset.ready = 'true';
  canvas.addEventListener('pointerdown', event => {
    const state = stateFor(pageCard);
    if (!state.drawing) return;
    canvas.setPointerCapture(event.pointerId);
    state.drawStart = normalizedPoint(event, canvas);
  });
  canvas.addEventListener('pointermove', event => {
    const state = stateFor(pageCard);
    if (!state.drawing || !state.drawStart) return;
    const point = normalizedPoint(event, canvas);
    const draft = {
      id: '__draft__',
      x: Math.min(state.drawStart.x, point.x),
      y: Math.min(state.drawStart.y, point.y),
      width: Math.abs(point.x - state.drawStart.x),
      height: Math.abs(point.y - state.drawStart.y),
      type: 'unknown',
      regionType: 'text',
      status: 'manual_review',
    };
    const previous = state.regions.findIndex(region => region.id === '__draft__');
    if (previous >= 0) state.regions[previous] = draft;
    else state.regions.push(draft);
    drawRegions(panel, pageCard);
  });
  canvas.addEventListener('pointerup', event => {
    const state = stateFor(pageCard);
    if (!state.drawing || !state.drawStart) return;
    const point = normalizedPoint(event, canvas);
    state.regions = state.regions.filter(region => region.id !== '__draft__');
    const region = {
      id: `manual-${++regionSequence}`,
      x: Math.min(state.drawStart.x, point.x),
      y: Math.min(state.drawStart.y, point.y),
      width: Math.abs(point.x - state.drawStart.x),
      height: Math.abs(point.y - state.drawStart.y),
      type: 'unknown',
      regionType: 'text',
      language: 'tha',
      status: 'manual_review',
      text: '',
      confidence: NaN,
    };
    state.drawStart = null;
    if (region.width >= .018 && region.height >= .012) {
      state.regions.push(region);
      state.activeRegionId = region.id;
    }
    state.drawing = false;
    canvas.classList.remove('drawing');
    const button = $('[data-cover-action="draw"]', panel);
    if (button) button.textContent = 'วาดกรอบข้อความ';
    renderRegionList(panel, pageCard);
  });
}

function installPanelEvents(panel, pageCard) {
  panel.addEventListener('click', async event => {
    const regionButton = event.target.closest('[data-region-id]');
    if (regionButton) {
      stateFor(pageCard).activeRegionId = regionButton.dataset.regionId;
      renderRegionList(panel, pageCard);
      return;
    }
    const action = event.target.closest('[data-cover-action]')?.dataset.coverAction;
    if (!action) return;
    const state = stateFor(pageCard);
    const region = state.regions.find(item => item.id === state.activeRegionId);
    if (action === 'draw') {
      state.drawing = !state.drawing;
      const canvas = $('.cover-region-canvas', panel);
      canvas?.classList.toggle('drawing', state.drawing);
      event.target.textContent = state.drawing ? 'ลากกรอบบนภาพ…' : 'วาดกรอบข้อความ';
      return;
    }
    if (action === 'refresh-summary') {
      renderRegionList(panel, pageCard);
      return;
    }
    if (!region) return;
    if (action === 'recognize') {
      try { await recognizeRegion(panel, pageCard, region); }
      catch (error) {
        region.status = 'manual_review';
        region.reason = error.message || 'อ่านกรอบไม่สำเร็จ';
        renderRegionList(panel, pageCard);
      }
    }
    if (action === 'apply') {
      const text = $('[data-cover-field="text"]', panel)?.value || region.text;
      region.text = preserveTextSymbols(text);
      if (!region.text) return;
      region.status = 'accepted';
      region.regionType = 'text';
      appendAcceptedText(pageCard, region);
      renderRegionList(panel, pageCard);
    }
    if (action === 'mark-image') {
      region.regionType = 'illustration';
      region.type = 'illustration';
      region.status = 'rejected_as_non_text';
      region.text = '';
      region.reason = 'ผู้ใช้ยืนยันว่าเป็นรูป ไม่ใช่ข้อความ';
      renderRegionList(panel, pageCard);
    }
    if (action === 'delete') {
      state.regions = state.regions.filter(item => item.id !== region.id);
      state.activeRegionId = null;
      renderRegionList(panel, pageCard);
    }
  });
  panel.addEventListener('change', event => {
    const field = event.target.dataset.coverField;
    if (!field) return;
    const state = stateFor(pageCard);
    const region = state.regions.find(item => item.id === state.activeRegionId);
    if (!region) return;
    region[field] = event.target.value;
    if (field === 'type') region.regionType = event.target.value === 'illustration' ? 'illustration' : 'text';
    renderRegionList(panel, pageCard);
  });
}

function createCoverPanel(pageCard) {
  const panel = document.createElement('section');
  panel.className = 'cover-review-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <header class="cover-review-head">
      <div><strong>ตรวจข้อความจากหน้าปก</strong><small>เลือกเฉพาะข้อความจริง รูปและลวดลายจะไม่ถูกส่งออก</small></div>
      <div class="cover-review-actions"><button type="button" data-cover-action="draw">วาดกรอบข้อความ</button><button type="button" data-cover-action="refresh-summary">ตรวจใหม่</button></div>
    </header>
    <div class="cover-region-summary"></div>
    <div class="cover-review-grid">
      <div class="cover-preview-column">
        <div class="cover-preview-stage"><img class="cover-source-preview" alt="ภาพต้นฉบับสำหรับตรวจหน้าปก"><canvas class="cover-region-canvas" aria-label="พื้นที่ลากกรอบข้อความ"></canvas></div>
        <p class="cover-help">กด “วาดกรอบข้อความ” แล้วลากครอบเฉพาะบรรทัดที่ต้องการอ่าน สามารถกำหนดเป็นหัวข้อ ชื่อบุคคล หรือชื่อโรงเรียนได้</p>
      </div>
      <div class="cover-review-column"><div class="cover-region-list"></div><div class="cover-region-detail"></div></div>
    </div>`;
  pageCard.append(panel);
  const source = pageImage(pageCard);
  const preview = $('.cover-source-preview', panel);
  if (source && preview) preview.src = source.currentSrc || source.src;
  const state = stateFor(pageCard);
  state.documentMode = classifyCoverDocument({
    illustrationRatio: .58,
    textAreaRatio: .26,
    decorativeRatio: .42,
    titleProminence: .68,
    textBlockCount: $$('.book-review-block', pageCard).length || 4,
    firstPage: true,
  });
  installPointerDrawing(panel, pageCard);
  installPanelEvents(panel, pageCard);
  const resizeObserver = new ResizeObserver(() => syncCanvas(panel, pageCard));
  if (source) resizeObserver.observe(source);
  requestAnimationFrame(() => {
    syncCanvas(panel, pageCard);
    renderRegionList(panel, pageCard);
  });
  return panel;
}

function enhancePage(pageCard) {
  if (pageCard.dataset.coverReviewReady) return;
  pageCard.dataset.coverReviewReady = 'true';
  const actions = $('.page-actions', pageCard) || $('.page-head', pageCard);
  if (!actions) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cover-review-toggle';
  button.textContent = 'ตรวจข้อความจากหน้าปก';
  actions.append(button);
  let panel;
  button.addEventListener('click', () => {
    panel ||= createCoverPanel(pageCard);
    panel.hidden = !panel.hidden;
    button.classList.toggle('active', !panel.hidden);
    button.textContent = panel.hidden ? 'ตรวจข้อความจากหน้าปก' : 'ปิดเครื่องมือตรวจหน้าปก';
    if (!panel.hidden) requestAnimationFrame(() => syncCanvas(panel, pageCard));
  });
}

const results = $('#results');
if (results) {
  const observer = new MutationObserver(() => $$('.page-card', results).forEach(enhancePage));
  observer.observe(results, { childList: true, subtree: true });
  $$('.page-card', results).forEach(enhancePage);
}
