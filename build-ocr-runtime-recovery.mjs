import { readFile, writeFile } from 'node:fs/promises';

const uiPath = 'dist/performance-v22-ui.js';
let ui = await readFile(uiPath, 'utf8');

const replacements = [
  ["const UI_VERSION = '2.3.0';", "const UI_VERSION = '2.4.0';"],
  ['const HARD_WATCHDOG_MS = 70_000;', 'const HARD_WATCHDOG_MS = 150_000;'],
  ['const WORKER_START_TIMEOUT_MS = 45_000;', 'const WORKER_START_TIMEOUT_MS = 90_000;'],
  ['const RECOGNIZE_TIMEOUT_MS = 60_000;', 'const RECOGNIZE_TIMEOUT_MS = 90_000;'],
  ["label: 'อ่านข้อความเกิน 60 วินาที · กำลังหยุด Worker'", "label: 'อ่านข้อความเกิน 90 วินาที · กำลังหยุด Worker'"],
  ["label: 'เริ่ม OCR Worker เกิน 45 วินาที'", "label: 'เริ่ม OCR Worker เกิน 90 วินาที'"],
];
for (const [before, after] of replacements) {
  if (!ui.includes(before) && !ui.includes(after)) throw new Error(`OCR runtime recovery transform missing pattern: ${before}`);
  ui = ui.replace(before, after);
}

const progressListener = "window.addEventListener('ripscan:ocr-progress', event => scheduleRender(event.detail || {}));";
const heartbeatListener = `window.addEventListener('ripscan:ocr-heartbeat', event => {
  if (!state.busy) return;
  state.lastProgressAt = performance.now();
  state.watchdogWarned = false;
  state.hardWatchdogWarned = false;
  const detail = event.detail || {};
  const title = $('#ocrProgressTitle');
  const status = $('#ocrProgressDetail');
  if (title && detail.label) title.textContent = detail.label;
  if (status) status.textContent = \`${'${detail.stage || \'worker\'}'} · Worker ยังตอบสนอง\`;
});
${progressListener}`;
if (!ui.includes("ripscan:ocr-heartbeat', event =>")) {
  if (!ui.includes(progressListener)) throw new Error('OCR progress listener was not found for heartbeat installation');
  ui = ui.replace(progressListener, heartbeatListener);
}

await writeFile(uiPath, ui, 'utf8');
console.log('RipScan OCR runtime recovery: 4s worker heartbeat, 90s bounded operations, 150s no-response watchdog');
