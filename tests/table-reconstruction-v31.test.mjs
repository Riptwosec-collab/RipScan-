import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TABLE_RECONSTRUCTION_VERSION,
  CELL_OCR_VARIANTS,
  buildTableStructure,
  gibberishAssessment,
  strictFieldAssessment,
  selectCellCandidate,
  tableToDocumentBlockSpec,
  updateCellText,
  workerConcurrency,
} from '../web/table-reconstruction-core.mjs';

const PAGE = { width: 437, height: 558, pageNumber: 2 };
const horizontalLines = [51, 88, 233, 347, 379, 412, 461];
const verticalLines = [46, 94, 267, 305, 360, 419];
const horizontalSegments = [
  { position: 51, start: 46, end: 419 },
  { position: 88, start: 46, end: 419 },
  { position: 233, start: 94, end: 305 },
  { position: 347, start: 46, end: 305 },
  { position: 379, start: 46, end: 305 },
  { position: 412, start: 46, end: 419 },
  { position: 461, start: 46, end: 419 },
];
const verticalSegments = verticalLines.map(position => ({ position, start: 51, end: 461 }));

function fixture() {
  return buildTableStructure({ ...PAGE, horizontalLines, verticalLines, horizontalSegments, verticalSegments });
}

test('actual government-table geometry reconstructs five editable columns before OCR', () => {
  const table = fixture();
  assert.equal(TABLE_RECONSTRUCTION_VERSION, '3.1.0');
  assert.equal(table.columnCount, 5);
  assert.equal(table.rowCount, 6);
  assert.deepEqual(table.columnWidths, [48, 173, 38, 55, 59]);
  assert.ok(table.cells.some(cell => cell.rowSpan > 1), 'expected merged vertical cells');
  assert.ok(table.cells.some(cell => cell.rowIndex === 1 && cell.columnIndex === 3 && cell.rowSpan === 4));
  assert.equal(table.metadata.tableFirst, true);
});

test('multiline text remains in one cell and exports as a real table cell model', () => {
  const table = fixture();
  const cell = table.cells.find(item => item.rowIndex === 1 && item.columnIndex === 1);
  updateCellText(cell, {
    text: '5) ปฏิบัติงานตามมติ\nพ.ศ. 2568 และ พ.ศ. 2569\nโดยเจ้าหน้าที่ผู้ตรวจ',
    confidence: .94,
    status: 'verified',
    candidates: [],
  });
  const block = tableToDocumentBlockSpec(table);
  const exported = block.cells.find(item => item.id === cell.cellId);
  assert.equal(exported.text.split('\n').length, 3);
  assert.equal(exported.row, 1);
  assert.equal(exported.column, 1);
  assert.equal(block.columns, 5);
  assert.equal(block.metadata.tableFirst, true);
});

test('gibberish and cross-script table line leakage never becomes verified text', () => {
  const result = gibberishAssessment('อหง โทร๒อ๕๓1อห1หส oo th | | |', { confidence: .18, providerAgreement: .2 });
  assert.equal(result.gibberish, true);
  assert.ok(result.reasons.includes('table_line_tokens'));
  const selected = selectCellCandidate([
    { text: 'อหง โทร๒อ๕๓1อห1หส oo th | | |', confidence: .18, providerAgreement: .2, variant: 'original' },
    { text: 'จัดเตรียมข้อมูลในวันแรกของการเข้าตรวจ', confidence: .81, providerAgreement: .75, variant: 'upscale3' },
  ], { columnType: 'process' });
  assert.notEqual(selected.text, 'อหง โทร๒อ๕๓1อห1หส oo th | | |');
});

test('strict contact and attachment validation preserves punctuation and leading zeroes', () => {
  assert.deepEqual(strictFieldAssessment('094-359-3926', 'contact').type, 'phone');
  assert.deepEqual(strictFieldAssessment('Secretary.inspector1@rd.go.th', 'contact').type, 'email');
  assert.deepEqual(strictFieldAssessment('แบบ 12', 'attachment_code').type, 'attachment_code');
  assert.equal(strictFieldAssessment('แบบ 123456', 'attachment_code').valid, false);
});

test('cell OCR has at most four variants and worker limits are mobile one desktop two', () => {
  assert.deepEqual(CELL_OCR_VARIANTS, ['original', 'upscale3', 'line_soft', 'contrast_soft']);
  assert.equal(workerConcurrency({ mobile: true, hardwareConcurrency: 8 }), 1);
  assert.equal(workerConcurrency({ mobile: false, hardwareConcurrency: 8 }), 2);
});
