const ADV_VERSION = '1.4.0';
const OCR_POOL_LIMIT = 2;
const activeWorkers = new Set();
const tableAnalyses = new WeakMap();
let cancelGeneration = 0;
let deferredInstallPrompt = null;
let performanceMode = localStorage.getItem('ripscan-performance-mode') || 'auto';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const resultsRoot = $('#results');
const statusBox = $('#status');
const statusText = $('#statusText');
const errorBox = $('#error');
const languageSelect = $('#language');
const runButton = $('#runButton');

function setError(message) {
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  if (errorBox) errorBox.hidden = true;
}

function setBusy(active, message = '') {
  if (statusBox) statusBox.hidden = !active;
  if (statusText && message) statusText.textContent = message;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.ceil(seconds)} วินาที`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} นาที ${Math.ceil(seconds % 60)} วินาที`;
}

function currentLanguages() {
  const value = languageSelect?.value || 'auto';
  if (value === 'en') return ['eng'];
  if (value === 'th') return ['tha'];
  return ['tha', 'eng'];
}

function selectedWorkerCount(jobCount = 1) {
  if (performanceMode === 'eco') return 1;
  const hardware = Math.max(1, Number(navigator.hardwareConcurrency || 2));
  const auto = hardware >= 6 ? 2 : 1;
  const requested = performanceMode === 'turbo' ? 2 : auto;
  return Math.max(1, Math.min(OCR_POOL_LIMIT, requested, jobCount));
}

function installPerformanceControls() {
  const controls = $('.controls');
  if (!controls || $('#performanceMode')) return;
  const group = document.createElement('div');
  group.className = 'advanced-controls';
  group.innerHTML = `
    <label>ประสิทธิภาพ OCR
      <select id="performanceMode">
        <option value="auto">อัตโนมัติ</option>
        <option value="turbo">Turbo · 2 Workers</option>
        <option value="eco">ประหยัด RAM · 1 Worker</option>
      </select>
    </label>
    <button id="cancelOcrButton" class="secondary danger-button" type="button" disabled>ยกเลิก OCR</button>
    <small id="ocrMetrics">Tesseract.js 7 · Worker reuse · จำกัดพร้อมกัน 2 งาน</small>`;
  controls.parentNode.insertBefore(group, controls.nextSibling);
  const mode = $('#performanceMode');
  mode.value = performanceMode;
  mode.addEventListener('change', () => {
    performanceMode = mode.value;
    localStorage.setItem('ripscan-performance-mode', performanceMode);
    $('#ocrMetrics').textContent = performanceMode === 'turbo'
      ? 'Turbo ใช้สูงสุด 2 Workers ตามจำนวนหน้าจริง'
      : performanceMode === 'eco'
        ? 'โหมดประหยัด RAM ใช้ 1 Worker'
        : 'โหมดอัตโนมัติปรับตามจำนวน Core ของอุปกรณ์';
  });
  $('#cancelOcrButton').addEventListener('click', cancelAllOcr);
}

function setCancelEnabled(enabled) {
  const button = $('#cancelOcrButton');
  if (button) button.disabled = !enabled;
}

async function cancelAllOcr() {
  cancelGeneration += 1;
  const workers = [...activeWorkers];
  setBusy(true, 'กำลังยกเลิก OCR…');
  await Promise.allSettled(workers.map(worker => worker.terminate?.()));
  activeWorkers.clear();
  setCancelEnabled(false);
  setBusy(false);
  setError('ยกเลิกงาน OCR แล้ว ข้อความที่ทำเสร็จก่อนยกเลิกยังคงอยู่');
}

function patchTesseractWorkers() {
  if (!window.Tesseract?.createWorker || window.Tesseract.__ripscanPatched) return;
  const originalCreateWorker = window.Tesseract.createWorker.bind(window.Tesseract);
  window.Tesseract.createWorker = async function patchedCreateWorker(langs, oem, options = {}, config) {
    const originalLogger = options?.logger;
    const startedAt = performance.now();
    const wrappedOptions = {
      ...options,
      workerPath: options?.workerPath || window.__ripscanOcrRuntime?.workerPath,
      corePath: options?.corePath || window.__ripscanOcrRuntime?.corePath,
      cacheMethod: options?.cacheMethod || 'write',
      logger(message) {
        originalLogger?.(message);
        if (message?.status === 'recognizing text' && Number(message.progress) > 0) {
          const elapsed = (performance.now() - startedAt) / 1000;
          const eta = elapsed * (1 - message.progress) / message.progress;
          const metric = $('#ocrMetrics');
          if (metric) metric.textContent = `OCR ${Math.round(message.progress * 100)}% · ETA จากความคืบหน้าจริง ${formatDuration(eta)}`;
        }
      },
    };
    const worker = await originalCreateWorker(langs, oem, wrappedOptions, config);
    activeWorkers.add(worker);
    setCancelEnabled(true);
    const terminate = worker.terminate?.bind(worker);
    worker.terminate = async (...args) => {
      try {
        return await terminate?.(...args);
      } finally {
        activeWorkers.delete(worker);
        if (!activeWorkers.size) setCancelEnabled(false);
      }
    };
    return worker;
  };
  window.Tesseract.__ripscanPatched = true;
}

function getManagedPages(card, selectedOnly = false) {
  const selectedIds = new Set(
    $$('.thumbnail-card', card)
      .filter(item => item.querySelector('input[type="checkbox"]')?.checked)
      .map(item => item.dataset.pageId),
  );
  return $$('.page-card', card)
    .map((pageCard, index) => ({
      id: pageCard.dataset.managedId || `page-${index}`,
      index,
      card: pageCard,
      image: $('.page-preview', pageCard),
      textarea: $('.page-text', pageCard),
    }))
    .filter(page => !selectedOnly || selectedIds.has(page.id));
}

async function makeScheduler(jobCount, label) {
  if (!window.Tesseract?.createScheduler) throw new Error('เบราว์เซอร์โหลดระบบ Worker Pool ไม่สำเร็จ');
  const token = cancelGeneration;
  const scheduler = window.Tesseract.createScheduler();
  const count = selectedWorkerCount(jobCount);
  const workers = [];
  const startedAt = performance.now();
  let latestProgress = 0;
  for (let index = 0; index < count; index += 1) {
    const worker = await window.Tesseract.createWorker(currentLanguages(), 1, {
      cacheMethod: 'write',
      logger(message) {
        if (token !== cancelGeneration) return;
        if (message?.status === 'recognizing text') {
          latestProgress = Math.max(latestProgress, Number(message.progress || 0));
          const elapsed = (performance.now() - startedAt) / 1000;
          const eta = latestProgress > 0 ? elapsed * (1 - latestProgress) / latestProgress : NaN;
          setBusy(true, `${label} · ${Math.round(latestProgress * 100)}% · ETA ${formatDuration(eta)}`);
        }
      },
    });
    await worker.setParameters?.({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
    scheduler.addWorker(worker);
    workers.push(worker);
  }
  return { scheduler, workers, token, count };
}

async function turboReOcrSelected(card) {
  const pages = getManagedPages(card, true);
  if (!pages.length) return setError('กรุณาเลือกอย่างน้อย 1 หน้า');
  clearError();
  const pool = await makeScheduler(pages.length, `OCR ${pages.length} หน้าแบบ Worker Pool`);
  const startedAt = performance.now();
  let completed = 0;
  try {
    const jobs = pages.map(async page => {
      const response = await pool.scheduler.addJob('recognize', page.image.src, {}, { text: true });
      if (pool.token !== cancelGeneration) throw new Error('OCR_CANCELLED');
      page.textarea.value = String(response.data.text || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      page.textarea.dispatchEvent(new Event('input', { bubbles: true }));
      completed += 1;
      const elapsed = (performance.now() - startedAt) / 1000;
      const eta = completed ? elapsed / completed * (pages.length - completed) : NaN;
      setBusy(true, `เสร็จ ${completed}/${pages.length} หน้า · เหลือประมาณ ${formatDuration(eta)}`);
      return response;
    });
    await Promise.all(jobs);
    const seconds = (performance.now() - startedAt) / 1000;
    const metric = $('#ocrMetrics');
    if (metric) metric.textContent = `เสร็จ ${pages.length} หน้าใน ${formatDuration(seconds)} · ใช้ ${pool.count} Worker`;
  } catch (error) {
    if (error?.message !== 'OCR_CANCELLED') throw error;
  } finally {
    await pool.scheduler.terminate();
    setBusy(false);
  }
}

async function imageToCanvas(src, maxSide = 1600) {
  const blob = await fetch(src).then(response => {
    if (!response.ok) throw new Error('โหลดภาพสำหรับวิเคราะห์ไม่สำเร็จ');
    return response.blob();
  });
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

function otsuThreshold(gray) {
  const histogram = new Uint32Array(256);
  for (const value of gray) histogram[value] += 1;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];
  let sumBackground = 0;
  let weightBackground = 0;
  let bestVariance = -1;
  let threshold = 160;
  for (let i = 0; i < 256; i += 1) {
    weightBackground += histogram[i];
    if (!weightBackground) continue;
    const weightForeground = total - weightBackground;
    if (!weightForeground) break;
    sumBackground += i * histogram[i];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = i;
    }
  }
  return threshold;
}

function makeBinary(canvas) {
  const { width, height } = canvas;
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    gray[pixel] = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
  }
  const threshold = Math.min(210, Math.max(80, otsuThreshold(gray)));
  const binary = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) binary[i] = gray[i] < threshold ? 1 : 0;
  return { binary, width, height, threshold };
}

function clusterPositions(values, tolerance = 4) {
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

function longestRun(binary, width, height, position, horizontal) {
  const length = horizontal ? width : height;
  let best = 0;
  let current = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const index = horizontal ? position * width + offset : offset * width + position;
    if (binary[index]) {
      current += 1;
      best = Math.max(best, current);
    } else current = 0;
  }
  return best;
}

function pixelNear(binary, width, height, x, y, radius = 1) {
  let dark = 0;
  let count = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      dark += binary[py * width + px];
      count += 1;
    }
  }
  return count ? dark / count : 0;
}

function detectGrid(binaryInfo) {
  const { binary, width, height } = binaryInfo;
  const horizontalCandidates = [];
  const verticalCandidates = [];
  for (let y = 0; y < height; y += 1) if (longestRun(binary, width, height, y, true) >= width * 0.22) horizontalCandidates.push(y);
  for (let x = 0; x < width; x += 1) if (longestRun(binary, width, height, x, false) >= height * 0.22) verticalCandidates.push(x);
  let rows = clusterPositions(horizontalCandidates, Math.max(2, Math.round(height / 500)));
  let columns = clusterPositions(verticalCandidates, Math.max(2, Math.round(width / 500)));
  rows = rows.filter(y => columns.filter(x => pixelNear(binary, width, height, x, y, 2) > 0.25).length >= Math.min(2, columns.length));
  columns = columns.filter(x => rows.filter(y => pixelNear(binary, width, height, x, y, 2) > 0.25).length >= Math.min(2, rows.length));
  if (rows.length < 2 || columns.length < 2) return null;
  rows = clusterPositions(rows, 5);
  columns = clusterPositions(columns, 5);
  const rowGaps = rows.slice(1).map((value, index) => value - rows[index]);
  const columnGaps = columns.slice(1).map((value, index) => value - columns[index]);
  if (!rowGaps.some(gap => gap >= 10) || !columnGaps.some(gap => gap >= 18)) return null;
  return { rows, columns };
}

function borderDensity(binaryInfo, orientation, position, start, end) {
  const { binary, width, height } = binaryInfo;
  let dark = 0;
  let count = 0;
  for (let main = Math.max(0, Math.round(start)); main <= Math.min(orientation === 'vertical' ? height - 1 : width - 1, Math.round(end)); main += 1) {
    for (let offset = -1; offset <= 1; offset += 1) {
      const x = orientation === 'vertical' ? Math.round(position + offset) : main;
      const y = orientation === 'vertical' ? main : Math.round(position + offset);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      dark += binary[y * width + x];
      count += 1;
    }
  }
  return count ? dark / count : 0;
}

function buildMergedCells(grid, binaryInfo) {
  const rowCount = grid.rows.length - 1;
  const columnCount = grid.columns.length - 1;
  const total = rowCount * columnCount;
  const parent = Array.from({ length: total }, (_, index) => index);
  const find = index => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const union = (a, b) => { const rootA = find(a); const rootB = find(b); if (rootA !== rootB) parent[rootB] = rootA; };
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const index = row * columnCount + column;
      const top = grid.rows[row];
      const bottom = grid.rows[row + 1];
      const left = grid.columns[column];
      const right = grid.columns[column + 1];
      if (column < columnCount - 1 && borderDensity(binaryInfo, 'vertical', right, top + 2, bottom - 2) < 0.28) union(index, index + 1);
      if (row < rowCount - 1 && borderDensity(binaryInfo, 'horizontal', bottom, left + 2, right - 2) < 0.28) union(index, index + columnCount);
    }
  }
  const groups = new Map();
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const root = find(row * columnCount + column);
      const group = groups.get(root) || { minRow: row, maxRow: row, minColumn: column, maxColumn: column };
      group.minRow = Math.min(group.minRow, row);
      group.maxRow = Math.max(group.maxRow, row);
      group.minColumn = Math.min(group.minColumn, column);
      group.maxColumn = Math.max(group.maxColumn, column);
      groups.set(root, group);
    }
  }
  return [...groups.values()].map((group, index) => ({
    id: index,
    row: group.minRow,
    column: group.minColumn,
    rowspan: group.maxRow - group.minRow + 1,
    colspan: group.maxColumn - group.minColumn + 1,
    rect: {
      left: grid.columns[group.minColumn] + 2,
      top: grid.rows[group.minRow] + 2,
      width: Math.max(1, grid.columns[group.maxColumn + 1] - grid.columns[group.minColumn] - 4),
      height: Math.max(1, grid.rows[group.maxRow + 1] - grid.rows[group.minRow] - 4),
    },
    text: '',
    confidence: 0,
  }));
}

function detectCheckboxes(binaryInfo) {
  const { binary, width, height } = binaryInfo;
  const visited = new Uint8Array(binary.length);
  const found = [];
  const queueX = [];
  const queueY = [];
  const maxDimension = Math.max(16, Math.min(70, Math.round(Math.min(width, height) * 0.08)));
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const start = y * width + x;
      if (!binary[start] || visited[start]) continue;
      queueX.length = 0;
      queueY.length = 0;
      queueX.push(x);
      queueY.push(y);
      visited[start] = 1;
      let cursor = 0;
      let minX = x; let maxX = x; let minY = y; let maxY = y; let pixels = 0;
      while (cursor < queueX.length && pixels < 5000) {
        const px = queueX[cursor];
        const py = queueY[cursor];
        cursor += 1;
        pixels += 1;
        minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        const neighbors = [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const index = ny * width + nx;
          if (binary[index] && !visited[index]) {
            visited[index] = 1;
            queueX.push(nx);
            queueY.push(ny);
          }
        }
      }
      const boxWidth = maxX - minX + 1;
      const boxHeight = maxY - minY + 1;
      const aspect = boxWidth / Math.max(1, boxHeight);
      const fill = pixels / Math.max(1, boxWidth * boxHeight);
      if (boxWidth < 8 || boxHeight < 8 || boxWidth > maxDimension || boxHeight > maxDimension || aspect < 0.75 || aspect > 1.25 || fill < 0.08 || fill > 0.72) continue;
      let borderDark = 0; let borderCount = 0; let innerDark = 0; let innerCount = 0;
      const border = Math.max(1, Math.round(Math.min(boxWidth, boxHeight) * 0.18));
      for (let py = minY; py <= maxY; py += 1) {
        for (let px = minX; px <= maxX; px += 1) {
          const dark = binary[py * width + px];
          const isBorder = px - minX < border || maxX - px < border || py - minY < border || maxY - py < border;
          if (isBorder) { borderDark += dark; borderCount += 1; }
          else { innerDark += dark; innerCount += 1; }
        }
      }
      const borderRatio = borderCount ? borderDark / borderCount : 0;
      const innerRatio = innerCount ? innerDark / innerCount : 0;
      if (borderRatio > 0.28) found.push({ x: minX, y: minY, width: boxWidth, height: boxHeight, checked: innerRatio > 0.17, innerRatio });
      if (found.length >= 40) return found;
    }
  }
  return found;
}

function parseFormFields(text) {
  const fields = [];
  for (const line of String(text || '').split('\n').map(value => value.trim()).filter(Boolean)) {
    const match = line.match(/^(.{2,60}?)(?:\s*[:：]\s*|\.{2,}|_{2,})(.+)$/u);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (key && value) fields.push({ key, value });
  }
  return fields.slice(0, 80);
}

function extractWordNodes(blocks) {
  const words = [];
  const walk = node => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.words) return walk(node.words);
    const bbox = node.bbox;
    const text = typeof node.text === 'string' ? node.text.trim() : '';
    if (bbox && text && Number.isFinite(bbox.x0) && Number.isFinite(bbox.y0)) {
      words.push({ text, confidence: Number(node.confidence ?? node.conf ?? 0), bbox });
      return;
    }
    for (const key of ['blocks', 'paragraphs', 'lines', 'symbols']) walk(node[key]);
  };
  walk(blocks);
  return words;
}

function formRegions(words, canvas) {
  const top = words.filter(word => (word.bbox.y0 + word.bbox.y1) / 2 < canvas.height * 0.13).map(word => word.text).join(' ');
  const bottom = words.filter(word => (word.bbox.y0 + word.bbox.y1) / 2 > canvas.height * 0.87).map(word => word.text).join(' ');
  return { header: top.trim(), footer: bottom.trim() };
}

async function analyzePage(page, card, preloaded = null) {
  clearError();
  const pageNumber = getManagedPages(card).findIndex(item => item.card === page.card) + 1;
  setBusy(true, `หน้า ${pageNumber} · ตรวจโครงสร้างก่อน OCR…`);
  const canvas = preloaded?.canvas || await imageToCanvas(page.image.src);
  const binaryInfo = makeBinary(canvas);
  const grid = detectGrid(binaryInfo);
  const checkboxes = detectCheckboxes(binaryInfo);
  const token = cancelGeneration;
  let table = null;
  let fullText = page.textarea?.value || '';
  let words = [];

  if (grid) {
    const cells = buildMergedCells(grid, binaryInfo);
    const pool = await makeScheduler(cells.length, `หน้า ${pageNumber} · อ่านตารางทีละช่อง`);
    try {
      let completed = 0;
      const startedAt = performance.now();
      const jobs = cells.map(async cell => {
        const response = await pool.scheduler.addJob('recognize', canvas, { rectangle: cell.rect }, { text: true, blocks: true });
        if (token !== cancelGeneration) throw new Error('OCR_CANCELLED');
        cell.text = String(response.data.text || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        cell.confidence = Math.max(0, Math.min(100, Number(response.data.confidence || 0)));
        completed += 1;
        const elapsed = (performance.now() - startedAt) / 1000;
        const eta = completed ? elapsed / completed * (cells.length - completed) : NaN;
        setBusy(true, `หน้า ${pageNumber} · ช่อง ${completed}/${cells.length} · ETA ${formatDuration(eta)}`);
      });
      await Promise.all(jobs);
      table = { rows: grid.rows.length - 1, columns: grid.columns.length - 1, cells };
    } finally {
      await pool.scheduler.terminate();
    }
  } else {
    const pool = await makeScheduler(1, `หน้า ${pageNumber} · วิเคราะห์แบบฟอร์ม`);
    try {
      const response = await pool.scheduler.addJob('recognize', canvas, {}, { text: true, blocks: true });
      if (token !== cancelGeneration) throw new Error('OCR_CANCELLED');
      fullText = String(response.data.text || fullText).trim();
      words = extractWordNodes(response.data.blocks);
    } finally {
      await pool.scheduler.terminate();
    }
  }

  const analysis = {
    analyzedAt: new Date().toISOString(),
    page: pageNumber,
    table,
    checkboxes,
    fields: parseFormFields(fullText),
    regions: formRegions(words, canvas),
    sourceWidth: canvas.width,
    sourceHeight: canvas.height,
  };
  tableAnalyses.set(page.card, analysis);
  renderAnalysis(page, analysis);
  setBusy(false);
  return analysis;
}

function tableMatrix(table) {
  if (!table) return [];
  const matrix = Array.from({ length: table.rows }, () => Array.from({ length: table.columns }, () => ''));
  for (const cell of table.cells) matrix[cell.row][cell.column] = cell.text;
  return matrix;
}

function analysisCsv(analysis) {
  if (!analysis.table) {
    return ['Type,Key,Value', ...analysis.fields.map(field => ['Field', field.key, field.value]), ...analysis.checkboxes.map((item, index) => ['Checkbox', index + 1, item.checked ? 'checked' : 'unchecked'])]
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
  }
  return tableMatrix(analysis.table).map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

function analysisJson(analysis) {
  return JSON.stringify(analysis, null, 2);
}

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

function downloadText(text, filename, type) {
  downloadBlob(new Blob([text], { type }), filename);
}

function xmlEscape(value) {
  return String(value).replace(/[<>&'"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[character]));
}

async function analysisXlsx(analysis) {
  if (!window.JSZip) throw new Error('โหลดระบบ XLSX ไม่สำเร็จ');
  const matrix = analysis.table ? tableMatrix(analysis.table) : [['Field', 'Value'], ...analysis.fields.map(field => [field.key, field.value])];
  const zip = new window.JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder('xl').file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="OCR Table" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.folder('xl').folder('_rels').file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  const columnName = index => {
    let name = '';
    for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
    return name;
  };
  const rows = matrix.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''))}</t></is></c>`).join('')}</row>`).join('');
  const merges = analysis.table?.cells.filter(cell => cell.rowspan > 1 || cell.colspan > 1).map(cell => {
    const start = `${columnName(cell.column)}${cell.row + 1}`;
    const end = `${columnName(cell.column + cell.colspan - 1)}${cell.row + cell.rowspan}`;
    return `<mergeCell ref="${start}:${end}"/>`;
  }) || [];
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : '';
  zip.folder('xl').folder('worksheets').file('sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData>${mergeXml}</worksheet>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function renderAnalysis(page, analysis) {
  page.card.querySelector('.analysis-panel')?.remove();
  const panel = document.createElement('section');
  panel.className = 'analysis-panel';
  const tableHtml = analysis.table
    ? `<div class="table-scroll"><table class="detected-table"><tbody>${Array.from({ length: analysis.table.rows }, (_, row) => `<tr>${analysis.table.cells.filter(cell => cell.row === row).sort((a, b) => a.column - b.column).map(cell => `<td contenteditable="true" data-cell-id="${cell.id}" rowspan="${cell.rowspan}" colspan="${cell.colspan}" class="${cell.confidence < 65 ? 'low-confidence' : ''}"><span>${escapeHtml(cell.text)}</span><small>${Math.round(cell.confidence)}%</small></td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<p class="empty-analysis">ไม่พบเส้นตารางที่น่าเชื่อถือ ระบบไม่สร้างตารางสมมติ</p>';
  const fieldsHtml = analysis.fields.length
    ? `<dl class="field-list">${analysis.fields.map(field => `<div><dt>${escapeHtml(field.key)}</dt><dd>${escapeHtml(field.value)}</dd></div>`).join('')}</dl>`
    : '<p class="empty-analysis">ไม่พบคู่หัวข้อ–ค่าที่แยกได้อย่างปลอดภัย</p>';
  const checkboxHtml = analysis.checkboxes.length
    ? `<div class="checkbox-list">${analysis.checkboxes.map((item, index) => `<label><input type="checkbox" ${item.checked ? 'checked' : ''} disabled><span>ช่อง ${index + 1} · ${item.checked ? 'ทำเครื่องหมาย' : 'ว่าง'}</span></label>`).join('')}</div>`
    : '<p class="empty-analysis">ไม่พบ Checkbox ที่ผ่านเกณฑ์รูปทรง</p>';
  panel.innerHTML = `
    <div class="analysis-head"><div><strong>โครงสร้างตารางและแบบฟอร์ม</strong><small>${analysis.table ? `${analysis.table.rows} แถว × ${analysis.table.columns} คอลัมน์ · อ่านแยก Cell` : 'Form detection · ไม่เดาข้อมูลที่ไม่ชัด'}</small></div><div class="actions"><button data-analysis-export="csv">CSV</button><button data-analysis-export="xlsx">XLSX</button><button data-analysis-export="json">JSON</button></div></div>
    <div class="analysis-tabs"><button class="active" data-analysis-tab="table">ตาราง</button><button data-analysis-tab="form">แบบฟอร์ม</button><button data-analysis-tab="raw">โครงสร้าง JSON</button></div>
    <div data-analysis-view="table">${tableHtml}</div>
    <div data-analysis-view="form" hidden><h4>ฟิลด์ที่ตรวจพบ</h4>${fieldsHtml}<h4>Checkbox</h4>${checkboxHtml}<h4>หัว/ท้ายเอกสาร</h4><p><strong>หัว:</strong> ${escapeHtml(analysis.regions.header || '—')}</p><p><strong>ท้าย:</strong> ${escapeHtml(analysis.regions.footer || '—')}</p></div>
    <pre data-analysis-view="raw" hidden>${escapeHtml(analysisJson(analysis))}</pre>`;
  page.card.append(panel);
  panel.addEventListener('input', event => {
    const cell = event.target.closest('[data-cell-id]');
    if (!cell || !analysis.table) return;
    const target = analysis.table.cells.find(item => String(item.id) === cell.dataset.cellId);
    if (target) target.text = cell.querySelector('span')?.textContent || '';
  });
  panel.addEventListener('click', async event => {
    const tab = event.target.closest('[data-analysis-tab]');
    if (tab) {
      const name = tab.dataset.analysisTab;
      $$('[data-analysis-tab]', panel).forEach(button => button.classList.toggle('active', button === tab));
      $$('[data-analysis-view]', panel).forEach(view => { view.hidden = view.dataset.analysisView !== name; });
      return;
    }
    const exportButton = event.target.closest('[data-analysis-export]');
    if (!exportButton) return;
    const base = `ripscan-page-${analysis.page}`;
    if (exportButton.dataset.analysisExport === 'csv') downloadText('\ufeff' + analysisCsv(analysis), `${base}.csv`, 'text/csv;charset=utf-8');
    if (exportButton.dataset.analysisExport === 'json') downloadText(analysisJson(analysis), `${base}.json`, 'application/json;charset=utf-8');
    if (exportButton.dataset.analysisExport === 'xlsx') downloadBlob(await analysisXlsx(analysis), `${base}.xlsx`);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

async function analyzeSelected(card) {
  const pages = getManagedPages(card, true);
  if (!pages.length) return setError('กรุณาเลือกอย่างน้อย 1 หน้า');
  for (const page of pages) await analyzePage(page, card);
}

function enhanceResultCard(card) {
  if (card.dataset.advancedReady) return;
  if (!card.dataset.pageManagerReady) return;
  card.dataset.advancedReady = 'true';
  const bulkActions = $('.bulk-actions', card);
  if (bulkActions) {
    const analyzeButton = document.createElement('button');
    analyzeButton.type = 'button';
    analyzeButton.dataset.advancedAction = 'analyze-selected';
    analyzeButton.textContent = 'วิเคราะห์ตารางหน้าที่เลือก';
    bulkActions.prepend(analyzeButton);
  }
  for (const page of getManagedPages(card)) {
    const actions = $('.page-actions', page.card);
    if (!actions || $('[data-advanced-page-action="analyze"]', actions)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.advancedPageAction = 'analyze';
    button.textContent = 'ตาราง/ฟอร์ม';
    actions.append(button);
  }
}

function observeResults() {
  const observer = new MutationObserver(() => $$('.result-card', resultsRoot).forEach(enhanceResultCard));
  observer.observe(resultsRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-page-manager-ready'] });
  $$('.result-card', resultsRoot).forEach(enhanceResultCard);

  resultsRoot.addEventListener('click', async event => {
    const turbo = event.target.closest('[data-managed-action="ocr-selected"]');
    if (turbo) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const card = turbo.closest('.result-card');
      try { await turboReOcrSelected(card); } catch (error) { console.error(error); setError(error.message || 'OCR แบบ Worker Pool ไม่สำเร็จ'); setBusy(false); }
      return;
    }
    const advanced = event.target.closest('[data-advanced-action="analyze-selected"]');
    if (advanced) {
      try { await analyzeSelected(advanced.closest('.result-card')); } catch (error) { console.error(error); if (error.message !== 'OCR_CANCELLED') setError(error.message || 'วิเคราะห์เอกสารไม่สำเร็จ'); setBusy(false); }
      return;
    }
    const pageButton = event.target.closest('[data-advanced-page-action="analyze"]');
    if (pageButton) {
      const card = pageButton.closest('.result-card');
      const pageCard = pageButton.closest('.page-card');
      const page = getManagedPages(card).find(item => item.card === pageCard);
      try { await analyzePage(page, card); } catch (error) { console.error(error); if (error.message !== 'OCR_CANCELLED') setError(error.message || 'วิเคราะห์หน้าไม่สำเร็จ'); setBusy(false); }
    }
  }, true);
}

function installPwaControls() {
  const topbar = $('.topbar');
  if (!topbar || $('.pwa-controls')) return;
  const controls = document.createElement('div');
  controls.className = 'pwa-controls';
  controls.innerHTML = `<span id="networkState" class="network-state">${navigator.onLine ? 'ออนไลน์' : 'ออฟไลน์'}</span><button id="offlinePackButton" class="secondary" type="button">เตรียมใช้งานออฟไลน์</button><button id="installAppButton" class="secondary" type="button" hidden>ติดตั้งแอป</button>`;
  topbar.append(controls);
  const updateNetwork = () => {
    const state = $('#networkState');
    if (!state) return;
    state.textContent = navigator.onLine ? 'ออนไลน์' : 'ออฟไลน์';
    state.classList.toggle('offline', !navigator.onLine);
  };
  window.addEventListener('online', updateNetwork);
  window.addEventListener('offline', updateNetwork);
  $('#offlinePackButton').addEventListener('click', prepareOfflinePack);
  $('#installAppButton').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $('#installAppButton').hidden = true;
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: 'CACHE_SHELL' });
  } catch (error) {
    console.warn('Service worker registration failed', error);
  }
}

async function prepareOfflinePack() {
  const button = $('#offlinePackButton');
  button.disabled = true;
  clearError();
  setBusy(true, 'กำลัง Cache ตัวโปรแกรมและ OCR ภาษาไทย–อังกฤษ…');
  let worker;
  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: 'CACHE_OFFLINE_PACK' });
    worker = await window.Tesseract.createWorker(['tha', 'eng'], 1, { cacheMethod: 'write' });
    await worker.setParameters?.({ user_defined_dpi: '300' });
    button.textContent = 'ออฟไลน์พร้อมใช้งาน';
    localStorage.setItem('ripscan-offline-ready', new Date().toISOString());
  } catch (error) {
    setError(`เตรียมโหมดออฟไลน์ไม่สำเร็จ: ${error.message || error}`);
    button.textContent = 'ลองเตรียมออฟไลน์ใหม่';
  } finally {
    await worker?.terminate();
    button.disabled = false;
    setBusy(false);
  }
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  const button = $('#installAppButton');
  if (button) button.hidden = false;
});

runButton?.addEventListener('click', () => {
  cancelGeneration += 1;
  clearError();
}, true);

patchTesseractWorkers();
installPerformanceControls();
installPwaControls();
observeResults();
registerServiceWorker();

if (localStorage.getItem('ripscan-offline-ready')) {
  const button = $('#offlinePackButton');
  if (button) button.textContent = 'ออฟไลน์พร้อมใช้งาน';
}

document.documentElement.dataset.advancedVersion = ADV_VERSION;
