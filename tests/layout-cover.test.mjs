import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('production build injects balanced layout cover review and hero support', async () => {
  const build = await read('build.mjs');
  for (const required of [
    '/layout-cover.css',
    '/reference-scale.css',
    '/cover-recovery.css',
    '/cover-ocr-ui.js',
    '/cover-recovery-ui.js',
    '/book-ocr-ui.js',
    'class="hero-support"',
    'ripscan-pwa-v2.0.0',
    'cover-ocr-core.mjs',
    'cover-recovery-core.mjs',
    'sara-am-spacing.mjs',
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

test('cover review UI exposes manual region drawing and non-text marking', async () => {
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
