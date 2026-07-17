import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  analyzeExportCompatibility,
  EXPORT_PRESETS,
  normalizeExportOptions,
  calculateOutputSize,
  safeFilename,
  collectSearchableTextLayer,
  blockToWordPositionedXml,
  tableToWordXml,
  tableToWorksheet,
} from '../web/editor-export.mjs';
import { createPage, createTextBlock, createTableBlock, mergeTableCells } from '../web/document-model.mjs';

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

test('direct searchable PDF text layer excludes unverified and redacted text by default', () => {
  const page = createPage({ number: 1, width: 794, height: 1123 });
  page.blocks.push(createTextBlock({ x: 40, y: 40, width: 500, height: 60, text: 'สำนักงานเขตพื้นที่การศึกษา' }));
  page.blocks[0].reviewStatus = 'verified';
  page.blocks.push(createTextBlock({ x: 40, y: 100, width: 500, height: 60, text: 'ยังต้องตรวจ', reviewStatus: 'review_required' }));
  page.blocks.push(createTextBlock({ x: 40, y: 160, width: 500, height: 60, text: 'ข้อมูลลับ', reviewStatus: 'verified', redacted: true }));
  const layer = collectSearchableTextLayer(page);
  assert.deepEqual(layer.map(item => item.text), ['สำนักงานเขตพื้นที่การศึกษา']);
  assert.equal(collectSearchableTextLayer(page, true).some(item => item.text === 'ยังต้องตรวจ'), true);
});

test('compatibility report identifies the remaining fidelity limits before export', () => {
  const model = { pages: [{ blocks: [
    { type: 'text', x: 0, y: 0, width: 20, height: 20 },
    { type: 'image', x: 0, y: 30, width: 20, height: 20 },
    { type: 'table', x: 0, y: 60, width: 20, height: 20 },
  ] }] };
  const docx = analyzeExportCompatibility(model, 'docx');
  assert.equal(docx.findings.some(item => item.feature === 'embedded_images' && item.level === 'supported'), true);
  assert.equal(docx.findings.some(item => item.feature === 'positioned_layout' && item.level === 'partial'), true);
  const xlsx = analyzeExportCompatibility(model, 'xlsx');
  assert.equal(xlsx.findings.some(item => item.feature === 'tables' && item.level === 'supported'), true);
});

test('DOCX table XML emits vertical merge continuations and never writes redacted cell text', () => {
  const table = createTableBlock({ rows: 2, columns: 2 });
  table.cells.find(cell => cell.row === 0 && cell.column === 0).text = 'anchor';
  mergeTableCells(table, [{ row: 0, column: 0 }, { row: 1, column: 0 }]);
  const secret = table.cells.find(cell => !cell.hidden && cell.row === 0 && cell.column === 1);
  secret.text = 'SECRET'; secret.redacted = true;
  const xml = tableToWordXml(table);
  assert.match(xml, /<w:vMerge w:val="restart"\/>/u);
  assert.match(xml, /<w:vMerge\/>/u);
  assert.equal(xml.includes('SECRET'), false);
});

test('DOCX uses positioned editable containers and XLSX preserves a styled cell grid', () => {
  const table = createTableBlock({ rows: 1, columns: 2, width: 240, height: 32, columnWidths: [80, 160] });
  table.cells[0].text = 'category';
  table.cells[1].text = 'value';
  const positioned = blockToWordPositionedXml({ id: 'box', type: 'text', text: 'placed', x: 20, y: 30, width: 120, height: 30, style: { fontSize: 16 } });
  assert.match(positioned, /position:absolute/u);
  assert.match(positioned, /w:txbxContent/u);
  const XLSX = { utils: { aoa_to_sheet: rows => ({ A1: { t: 's', v: rows[0][0] } }), encode_cell: ({ r, c }) => `${String.fromCharCode(65 + c)}${r + 1}` } };
  const sheet = tableToWorksheet(table, XLSX);
  assert.equal(sheet.A1.v, 'category');
  assert.equal(sheet.A1.z, '@');
  assert.equal(sheet['!cols'][1].wpx, 160);
  assert.equal(sheet.B1.s.alignment.wrapText, true);
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
    'renderingMode: \'invisible\'',
    'NotoSansThai.ttf',
  ]) assert.ok(source.includes(required), `missing ${required}`);
});
