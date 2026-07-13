import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('production build injects layout OCR table and Document Studio assets', async () => {
  const build = await read('build.mjs');
  for (const required of [
    '/layout-cover.css',
    '/reference-scale.css',
    '/cover-recovery.css',
    '/performance-v22.css',
    '/table-auto.css',
    '/document-studio.css',
    '/cover-ocr-ui.js',
    '/cover-recovery-ui.js',
    '/performance-v22-ui.js',
    '/table-auto-ui.js',
    '/document-studio.js',
    '/book-ocr-ui.js',
    'class="hero-support"',
    'ripscan-pwa-v3.0.0',
    'cover-ocr-core.mjs',
    'cover-recovery-core.mjs',
    'cover-hard-block.mjs',
    'sara-am-spacing.mjs',
    'sara-am-recovery-v21.mjs',
    'ocr-performance-core.mjs',
    'ocr-preprocess-worker.js',
    'table-structure-core.mjs',
    'document-model.mjs',
    'office-import.mjs',
    'editor-export.mjs',
  ]) assert.ok(build.includes(required), `missing ${required}`);
});

test('balanced layout expands workspace and prevents overflow', async () => {
  const css = await read('web/layout-cover.css');
  assert.ok(css.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 1.08fr)'));
  assert.ok(css.includes('min-height: 390px'));
  assert.ok(css.includes('grid-column: 1 / -1'));
  assert.ok(css.includes('overflow-wrap: anywhere'));
  assert.ok(css.includes('@media (max-width: 820px)'));
  assert.ok(css.includes('@media (max-width: 560px)'));
});

test('cover review UI still supports manual recovery although its page toolbar button is hidden', async () => {
  const js = await read('web/cover-ocr-ui.js');
  for (const required of [
    'ตรวจข้อความจากหน้าปก',
    'วาดกรอบข้อความ',
    'เป็นรูป ไม่ใช่ข้อความ',
    'อ่านกรอบนี้',
    'person_name',
    'school_name',
    'pointerdown',
    'pointerup',
  ]) assert.ok(js.includes(required), `missing ${required}`);
  const compact = await read('web/table-auto-ui.js');
  assert.ok(compact.includes("'ตรวจข้อความจากหน้าปก'"));
  assert.ok(compact.includes("'cover-review'"));
});

test('cover review CSS keeps controls readable and responsive', async () => {
  const css = await read('web/layout-cover.css');
  for (const selector of [
    '.cover-review-panel',
    '.cover-review-grid',
    '.cover-preview-stage',
    '.cover-region-list',
    '.cover-region-detail',
    '.cover-region-actions',
  ]) assert.ok(css.includes(selector), `missing ${selector}`);
  assert.ok(css.includes('grid-template-columns: minmax(300px, .9fr) minmax(360px, 1.1fr)'));
});
