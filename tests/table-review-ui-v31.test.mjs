import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Table Review uses table-first grid cell OCR and Document Studio instead of pipe text', async () => {
  const source = await read('web/table-review-v31.js');
  for (const required of [
    'buildTableStructure',
    'CellOcrPool',
    'CELL_OCR_VARIANTS.slice(0, 2)',
    'CELL_OCR_VARIANTS.slice(2)',
    'OCR ใหม่เฉพาะ Cell',
    'เปิดแก้ไขใน Document Studio',
    'globalThis.RipScanDocumentStudio?.openModel',
    'data-review-cell',
    'data-grid-mode="add-horizontal"',
    'data-grid-mode="add-vertical"',
    'delete-line',
    'lock-grid',
    'ยกเลิก',
    'OCR สำเร็จ',
  ]) assert.ok(source.includes(required), `missing ${required}`);
  assert.ok(!source.includes('matrixToMarkdown'));
});

test('table worker detects grid and releases memory', async () => {
  const source = await read('web/table-reconstruction-worker.js');
  for (const required of [
    'OffscreenCanvas',
    "message.type === 'detect-grid'",
    "message.type === 'crop-cell'",
    "message.type === 'cancel'",
    "message.type === 'dispose'",
    'horizontalSegments',
    'verticalSegments',
    'convertToBlob',
    'image.data.fill(0)',
    'releaseCanvas',
  ]) assert.ok(source.includes(required), `missing ${required}`);
});

test('table review CSS contains status colors three-panel review and responsive rules', async () => {
  const css = await read('web/table-review-v31.css');
  for (const required of [
    'grid-template-columns:minmax(300px,.86fr) minmax(420px,1.3fr) minmax(220px,.58fr)',
    '.cell-status-verified',
    '.cell-status-review-required',
    '.cell-status-possible-text',
    '.cell-status-contaminated',
    '.cell-status-structure-conflict',
    '.cell-status-empty',
    '@media(max-width:820px)',
    '@media(max-width:560px)',
  ]) assert.ok(css.includes(required), `missing ${required}`);
});
