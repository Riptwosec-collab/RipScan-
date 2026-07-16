import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('automatic table UI publishes structured cells without duplicate main-thread image analysis', async () => {
  const ui = await read('web/table-auto-ui.js');
  for (const required of [
    'buildCellMatrix',
    'publishStructuredTable',
    'ripscan:structured-table-ready',
    "output: 'editable-table'",
    'tableCellSeparated',
    'requestIdleCallback',
    'scheduleScan',
  ]) assert.ok(ui.includes(required), `missing ${required}`);
  for (const forbidden of [
    'matrixToMarkdown',
    'textarea.value = markdown',
    'createImageBitmap',
    'getImageData',
    'imageGridEvidence',
    'waitForAnalysisTable',
    'button.click()',
  ]) assert.ok(!ui.includes(forbidden), `main-thread table work leaked: ${forbidden}`);
});

test('technical page buttons are removed while copy and TXT remain untouched', async () => {
  const ui = await read('web/table-auto-ui.js');
  for (const label of [
    'รูปภาพ',
    'OCR ใหม่',
    'หมุนหน้า',
    'ครอป',
    'ตาราง/ฟอร์ม',
    'ตรวจไทย–อังกฤษ',
    'ตรวจข้อความจากหน้าปก',
  ]) assert.ok(ui.includes(`'${label}'`), `missing hidden label ${label}`);
  assert.ok(ui.includes("return 'cover-review'"));
  assert.ok(!ui.includes("TECHNICAL_LABELS.add('คัดลอกหน้านี้')"));
  assert.ok(!ui.includes("TECHNICAL_LABELS.add('ดาวน์โหลด TXT')"));
});

test('table stylesheet renders clear borders and responsive cells', async () => {
  const css = await read('web/table-auto.css');
  for (const required of [
    'border-collapse: collapse',
    'border: 1px solid #334155',
    'white-space: pre-wrap',
    'overflow-wrap: anywhere',
    '.auto-table-badge',
    '@media (max-width: 720px)',
  ]) assert.ok(css.includes(required), `missing ${required}`);
});
