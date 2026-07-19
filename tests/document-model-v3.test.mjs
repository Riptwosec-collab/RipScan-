import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_MODEL_VERSION,
  createDocument,
  createPage,
  createTextBlock,
  createTableBlock,
  createTableCell,
  addTableRow,
  deleteTableRow,
  addTableColumn,
  deleteTableColumn,
  mergeTableCells,
  splitTableCell,
  getTableCell,
  validateDocumentModel,
  documentToPlainText,
} from '../web/document-model.mjs';

test('Document Model stores positioned editable blocks and validates', () => {
  const documentModel = createDocument({ name: 'ตัวอย่าง', sourceType: 'docx' });
  const page = createPage({ number: 1, width: 794, height: 1123 });
  page.blocks.push(createTextBlock({ x: 40, y: 40, width: 400, height: 60, text: 'หัวข้อเอกสาร', role: 'heading', style: { fontSize: 28, fontWeight: 700 } }));
  page.blocks.push(createTableBlock({ rows: 2, columns: 2, x: 40, y: 120, width: 500, height: 100 }));
  documentModel.pages.push(page);
  const result = validateDocumentModel(documentModel);
  assert.equal(DOCUMENT_MODEL_VERSION, '3.0.0');
  assert.equal(result.valid, true);
  assert.equal(page.blocks[0].x, 40);
  assert.equal(page.blocks[0].style.fontSize, 28);
});

test('table add/delete row and column keeps a complete editable grid', () => {
  const table = createTableBlock({ rows: 2, columns: 2, width: 400, height: 100 });
  addTableRow(table, 1);
  addTableColumn(table, 1);
  assert.equal(table.rows, 3);
  assert.equal(table.columns, 3);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) assert.ok(getTableCell(table, row, column), `missing ${row}:${column}`);
  }
  deleteTableRow(table, 1);
  deleteTableColumn(table, 1);
  assert.equal(table.rows, 2);
  assert.equal(table.columns, 2);
});

test('merge and split cells preserve the anchor text without leaking into neighbors', () => {
  const table = createTableBlock({
    rows: 2,
    columns: 3,
    width: 600,
    height: 100,
    cells: [
      createTableCell({ row: 0, column: 0, text: 'หน่วย' }),
      createTableCell({ row: 0, column: 1, text: 'การดำเนินการ' }),
      createTableCell({ row: 0, column: 2, text: 'ติดต่อ' }),
      createTableCell({ row: 1, column: 0, text: 'การเงิน' }),
      createTableCell({ row: 1, column: 1, text: 'จัดเตรียมข้อมูล' }),
      createTableCell({ row: 1, column: 2, text: '094-359-3926' }),
    ],
  });
  const result = mergeTableCells(table, [{ row: 0, column: 0 }, { row: 1, column: 0 }]);
  assert.equal(result.merged, true);
  assert.equal(getTableCell(table, 0, 0).rowSpan, 2);
  assert.match(getTableCell(table, 0, 0).text, /หน่วย/);
  assert.match(getTableCell(table, 0, 0).text, /การเงิน/);
  assert.equal(getTableCell(table, 0, 1).text, 'การดำเนินการ');
  assert.equal(getTableCell(table, 1, 2).text, '094-359-3926');
  const split = splitTableCell(table, result.anchor.id);
  assert.equal(split.split, true);
  assert.equal(getTableCell(table, 0, 0).rowSpan, 1);
  assert.ok(getTableCell(table, 1, 0));
});

test('plain text export keeps tables as tab-separated rows', () => {
  const documentModel = createDocument({ name: 'Inventory', sourceType: 'xlsx' });
  const page = createPage({ number: 1 });
  page.blocks.push(createTableBlock({
    rows: 2,
    columns: 4,
    cells: [
      createTableCell({ row: 0, column: 0, text: 'ลำดับที่' }),
      createTableCell({ row: 0, column: 1, text: 'MAC Address' }),
      createTableCell({ row: 0, column: 2, text: 'S/N Number' }),
      createTableCell({ row: 0, column: 3, text: 'เจ้าของเครื่อง' }),
      createTableCell({ row: 1, column: 0, text: '1.' }),
      createTableCell({ row: 1, column: 1, text: '24-6A-0E-DE-EF-9D' }),
      createTableCell({ row: 1, column: 2, text: '5CD43979HO' }),
      createTableCell({ row: 1, column: 3, text: 'คุณเสวนีย์' }),
    ],
  }));
  documentModel.pages.push(page);
  const text = documentToPlainText(documentModel);
  assert.match(text, /ลำดับที่\tMAC Address\tS\/N Number\tเจ้าของเครื่อง/u);
  assert.match(text, /24-6A-0E-DE-EF-9D\t5CD43979HO/u);
});
