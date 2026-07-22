import {
  buildCellMatrix,
  matrixToMarkdown,
  pageActionPolicy,
  tableEvidence,
} from './table-structure-core.mjs';

const TABLE_AUTO_VERSION = '2.3.0';
const results = document.querySelector('#results');
const scheduledPages = new WeakSet();
const structuredTables = new WeakSet();
const activeTasks = new WeakMap();
let autoQueue = Promise.resolve();

const TECHNICAL_LABELS = new Set([
  'รูปภาพ',
  'OCR ใหม่',
  'หมุนหน้า',
  'ครอป',
  'ตาราง/ฟอร์ม',
  'ตรวจไทย–อังกฤษ',
  'ตรวจข้อความจากหน้าปก',
  'ปิดเครื่องมือตรวจหน้าปก',
]);

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clusterPositions(values, tolerance = 3) {
  if (!values.length) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const groups = [[sorted[0]]];
  for (const value of sorted.slice(1)) {
    const group = groups[groups.length - 1];
    if (value - group[group.length - 1] <= tolerance) group.push(value);
    else groups.push([value]);
  }
  return groups.map(group => Math.round(group.reduce((sum, value) => sum + value, 0) / group.length));
}

function otsuThreshold(gray) {
  const histogram = new Uint32Array(256);
  for (const value of gray) histogram[value] += 1;
  const total = gray.length;
  let weighted = 0;
  for (let index = 0; index < 256; index += 1) weighted += index * histogram[index];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 160;
  for (let index = 0; index < 256; index += 1) {
    backgroundWeight += histogram[index];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += index * histogram[index];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weighted - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = index;
    }
  }
  return Math.max(70, Math.min(220, threshold));
}

function longestDarkRun(binary, width, height, position, horizontal, gapTolerance = 2) {
  const length = horizontal ? width : height;
  let best = 0;
  let current = 0;
  let gaps = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const index = horizontal ? position * width + offset : offset * width + position;
    if (binary[index]) {
      current += 1 + gaps;
      gaps = 0;
      best = Math.max(best, current);
    } else if (current && gaps < gapTolerance) {
      gaps += 1;
    } else {
      current = 0;
      gaps = 0;
    }
  }
  return best;
}

async function imageGridEvidence(image) {
  if (!image) return { likelyTable: false, score: 0, horizontalCount: 0, verticalCount: 0 };
  if (!image.complete) await new Promise((resolve, reject) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', reject, { once: true });
  });
  const response = await fetch(image.currentSrc || image.src);
  if (!response.ok) throw new Error('โหลดภาพเพื่อตรวจเส้นตารางไม่สำเร็จ');
  const bitmap = await createImageBitmap(await response.blob());
  const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let source = 0, target = 0; source < pixels.length; source += 4, target += 1) {
    gray[target] = Math.round(pixels[source] * 0.299 + pixels[source + 1] * 0.587 + pixels[source + 2] * 0.114);
  }
  const threshold = otsuThreshold(gray);
  const binary = new Uint8Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) binary[index] = gray[index] < threshold ? 1 : 0;

  const horizontalCandidates = [];
  const verticalCandidates = [];
  for (let y = 0; y < canvas.height; y += 1) {
    if (longestDarkRun(binary, canvas.width, canvas.height, y, true) >= canvas.width * 0.52) horizontalCandidates.push(y);
  }
  for (let x = 0; x < canvas.width; x += 1) {
    if (longestDarkRun(binary, canvas.width, canvas.height, x, false) >= canvas.height * 0.42) verticalCandidates.push(x);
  }

  const horizontalLines = clusterPositions(horizontalCandidates, Math.max(2, Math.round(canvas.height / 450)));
  const verticalLines = clusterPositions(verticalCandidates, Math.max(2, Math.round(canvas.width / 450)));
  const evidence = tableEvidence({ horizontalLines, verticalLines, width: canvas.width, height: canvas.height });
  canvas.width = 1;
  canvas.height = 1;
  return evidence;
}

function looksLikeFormText(pageCard) {
  const text = pageCard.querySelector('textarea.page-text')?.value || '';
  const lines = text.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  const fields = lines.filter(line => /^.{2,60}?(?:\s*[:：]\s*|\.{3,}|_{2,}).+/u.test(line));
  return fields.length >= 3;
}

function actionName(button) {
  if (button.dataset.action) return button.dataset.action;
  if (button.dataset.managedPageAction) return button.dataset.managedPageAction;
  if (button.dataset.advancedPageAction) return button.dataset.advancedPageAction;
  if (button.dataset.verifiedPage) return button.dataset.verifiedPage;
  if (button.classList.contains('cover-review-toggle')) return 'cover-review';
  return '';
}

function simplifyPageActions(pageCard) {
  const actions = pageCard.querySelector('.page-actions');
  if (!actions) return;
  for (const button of [...actions.querySelectorAll('button')]) {
    const action = actionName(button);
    const label = button.textContent.trim();
    const policy = pageActionPolicy(action);
    if (action === 'analyze' || button.dataset.advancedPageAction === 'analyze') {
      button.hidden = true;
      button.dataset.automaticOnly = 'true';
      continue;
    }
    if (policy === 'background' || TECHNICAL_LABELS.has(label)) button.remove();
  }
  actions.dataset.compactActions = 'true';
  pageCard.dataset.backgroundOcrTools = 'auto-retry,auto-language,auto-cover-filter,auto-table';
}

async function waitForAnalyzeButton(pageCard, timeoutMs = 8000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const button = pageCard.querySelector('[data-advanced-page-action="analyze"]');
    if (button) return button;
    await wait(100);
  }
  return null;
}

async function waitForAnalysisTable(pageCard, timeoutMs = 60000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const table = pageCard.querySelector('.analysis-panel .detected-table');
    if (table) return table;
    if (pageCard.querySelector('.analysis-panel .empty-analysis')) return null;
    await wait(180);
  }
  return null;
}

function recordsFromHtmlTable(table) {
  const occupancy = [];
  const records = [];
  [...table.rows].forEach((row, rowIndex) => {
    occupancy[rowIndex] ||= [];
    let columnIndex = 0;
    [...row.cells].forEach(cell => {
      while (occupancy[rowIndex][columnIndex]) columnIndex += 1;
      const rowSpan = Math.max(1, Number(cell.rowSpan || 1));
      const columnSpan = Math.max(1, Number(cell.colSpan || 1));
      const text = cell.querySelector('span')?.textContent ?? cell.textContent ?? '';
      records.push({ rowIndex, columnIndex, rowSpan, columnSpan, text });
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

function applyStructuredTable(pageCard, table, force = false) {
  const textarea = pageCard.querySelector('textarea.page-text');
  if (!textarea || (!force && textarea.dataset.userEdited === 'true')) return;
  const model = buildCellMatrix(recordsFromHtmlTable(table));
  if (model.rows < 2 || model.columns < 2) return;
  const markdown = matrixToMarkdown(model.matrix);
  if (!markdown || textarea.value === markdown) return;
  textarea.value = markdown;
  textarea.dataset.tableStructured = 'true';
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  pageCard.dataset.tableRows = String(model.rows);
  pageCard.dataset.tableColumns = String(model.columns);
  pageCard.dataset.tableCellSeparated = 'true';

  const heading = pageCard.querySelector('.page-head > div:first-child');
  if (heading && !heading.querySelector('.auto-table-badge')) {
    const badge = document.createElement('span');
    badge.className = 'auto-table-badge';
    badge.textContent = `ตาราง ${model.rows}×${model.columns} · แยกแต่ละช่องแล้ว`;
    heading.append(badge);
  }
}

function bindTableEditing(pageCard, table) {
  if (structuredTables.has(table)) return;
  structuredTables.add(table);
  applyStructuredTable(pageCard, table);
  let timer;
  table.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => applyStructuredTable(pageCard, table, true), 180);
  });
}

async function autoAnalyzePage(pageCard) {
  if (activeTasks.has(pageCard)) return activeTasks.get(pageCard);
  const task = (async () => {
    simplifyPageActions(pageCard);
    const readingMode = document.querySelector('#bookOcrMode')?.value || 'text_only';
    if (readingMode !== 'table_only' && readingMode !== 'all') return;
    const image = pageCard.querySelector('img.page-preview');
    const evidence = await imageGridEvidence(image).catch(() => ({ likelyTable: false, score: 0 }));
    pageCard.dataset.tableEvidence = Number(evidence.score || 0).toFixed(3);
    const shouldAnalyze = evidence.likelyTable || looksLikeFormText(pageCard);
    if (!shouldAnalyze) return;

    const button = await waitForAnalyzeButton(pageCard);
    if (!button) return;
    button.hidden = true;
    button.dataset.automaticOnly = 'true';
    pageCard.dataset.autoStructureStatus = 'analyzing';
    button.click();
    const table = await waitForAnalysisTable(pageCard);
    if (table) {
      bindTableEditing(pageCard, table);
      pageCard.dataset.autoStructureStatus = 'table-ready';
    } else {
      pageCard.dataset.autoStructureStatus = 'form-ready';
    }
  })().finally(() => activeTasks.delete(pageCard));
  activeTasks.set(pageCard, task);
  return task;
}

function schedulePage(pageCard) {
  simplifyPageActions(pageCard);
  if (scheduledPages.has(pageCard)) return;
  scheduledPages.add(pageCard);
  autoQueue = autoQueue.then(() => autoAnalyzePage(pageCard)).catch(error => {
    console.warn('Automatic table analysis skipped', error);
    pageCard.dataset.autoStructureStatus = 'error';
  });
}

function scan() {
  if (!results) return;
  results.querySelectorAll('.page-card').forEach(schedulePage);
  results.querySelectorAll('.analysis-panel .detected-table').forEach(table => {
    const pageCard = table.closest('.page-card');
    if (pageCard) bindTableEditing(pageCard, table);
  });
}

results?.addEventListener('input', event => {
  if (event.isTrusted && event.target.matches('textarea.page-text')) event.target.dataset.userEdited = 'true';
});

document.addEventListener('change', event => {
  if (event.target.id !== 'bookOcrMode' || !['table_only', 'all'].includes(event.target.value)) return;
  results?.querySelectorAll('.page-card').forEach(pageCard => {
    scheduledPages.delete(pageCard);
    schedulePage(pageCard);
  });
});

if (results) {
  const observer = new MutationObserver(scan);
  observer.observe(results, { childList: true, subtree: true });
  scan();
}

document.documentElement.dataset.tableAutoVersion = TABLE_AUTO_VERSION;
