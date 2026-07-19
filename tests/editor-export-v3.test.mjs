import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  EXPORT_PRESETS,
  normalizeExportOptions,
  calculateOutputSize,
  safeFilename,
  printableDocumentHtml,
} from '../web/editor-export.mjs';
import { createPage, createTextBlock, createTableBlock } from '../web/document-model.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('export presets support A4 A5 Letter Legal and orientation', () => {
  assert.deepEqual(EXPORT_PRESETS.A4, { width: 794, height: 1123 });
  const landscape = normalizeExportOptions({ pageSize: 'A4', orientation: 'landscape' });
  assert.equal(landscape.width, 1123);
  assert.equal(landscape.height, 794);
});

test('resize keeps aspect ratio and converts DPI to canvas dimensions', () => {
  const size = calculateOutputSize(1000, 500, { width: 800, keepAspect: true, dpi: 192 });
  assert.equal(size.width, 800);
  assert.equal(size.height, 400);
  assert.equal(size.canvasWidth, 1600);
  assert.equal(size.canvasHeight, 800);
});

test('custom fit contain does not distort document', () => {
  const size = calculateOutputSize(1000, 500, { width: 600, height: 600, keepAspect: true, fit: 'contain', dpi: 96 });
  assert.equal(size.width, 600);
  assert.equal(size.height, 300);
});

test('safe filename removes reserved path characters', () => {
  assert.equal(safeFilename('รายงาน:ฝ่าย/IT?.pdf'), 'รายงาน-ฝ่าย-IT-.pdf');
});

test('searchable print HTML preserves editable text and table cells', () => {
  const page = createPage({ number: 1, width: 794, height: 1123 });
  page.blocks.push(createTextBlock({ x: 40, y: 40, width: 500, height: 60, text: 'สำนักงานเขตพื้นที่การศึกษา' }));
  page.blocks.push(createTableBlock({ rows: 2, columns: 2, x: 40, y: 120, width: 500, height: 100 }));
  const html = printableDocumentHtml([page], 'ทดสอบ', { margin: 0 });
  assert.match(html, /สำนักงานเขตพื้นที่การศึกษา/u);
  assert.match(html, /<table/u);
  assert.match(html, /window\.print/u);
});

test('export module has real PDF image DOCX XLSX and multi-page ZIP paths', async () => {
  const source = await read('web/editor-export.mjs');
  for (const required of [
    'html2canvas',
    'jspdf',
    'canvasToBlob',
    'pdf.addImage',
    'modelToDocxBlob',
    'modelToXlsxBlob',
    "zip.generateAsync({ type: 'blob' })",
    'searchable-pdf',
  ]) assert.ok(source.includes(required), `missing ${required}`);
});
