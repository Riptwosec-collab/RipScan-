import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

const fixtureData = JSON.parse(await readFile(new URL('./fixtures/government-table-page2.json', import.meta.url), 'utf8'));

function fixture() {
  return buildTableStructure({
    pageNumber: fixtureData.image.pageNumber,
    width: fixtureData.image.width,
    height: fixtureData.image.height,
    horizontalLines: fixtureData.horizontalLines,
    verticalLines: fixtureData.verticalLines,
    horizontalSegments: fixtureData.horizontalSegments,
    verticalSegments: fixtureData.verticalSegments,
  });
}

test('actual government-table geometry reconstructs five editable columns before OCR', () => {
  const table = fixture();
  assert.equal(TABLE_RECONSTRUCTION_VERSION, '3.1.0');
  assert.equal(table.columnCount, fixtureData.expected.columns);
  assert.equal(table.rowCount, fixtureData.expected.rows);
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
  assert.equal(block.columns, fixtureData.expected.columns);
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
  assert.deepEqual(strictFieldAssessment(fixtureData.expected.footerEmail, 'contact').type, 'email');
  assert.deepEqual(strictFieldAssessment('แบบ 12', 'attachment_code').type, 'attachment_code');
  assert.equal(strictFieldAssessment('แบบ 123456', 'attachment_code').valid, false);
});

test('cell OCR has at most four variants and worker limits are mobile one desktop two', () => {
  assert.deepEqual(CELL_OCR_VARIANTS, ['original', 'upscale3', 'line_soft', 'contrast_soft']);
  assert.equal(workerConcurrency({ mobile: true, hardwareConcurrency: 8 }), 1);
  assert.equal(workerConcurrency({ mobile: false, hardwareConcurrency: 8 }), 2);
});
