import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  STRUCTURED_EXTENSIONS,
  extensionOf,
  isStructuredDocumentFile,
  parseCsv,
  rtfToText,
  csvToDocument,
  textToDocument,
} from '../web/office-import.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('structured importer recognizes Word Excel PowerPoint and text formats', () => {
  for (const extension of ['docx', 'xlsx', 'pptx', 'txt', 'csv', 'html', 'rtf', 'odt', 'ods', 'odp']) assert.ok(STRUCTURED_EXTENSIONS.has(extension), extension);
  assert.equal(extensionOf('report.DOCX'), 'docx');
  assert.equal(isStructuredDocumentFile({ name: 'inventory.xlsx', type: '' }), true);
  assert.equal(isStructuredDocumentFile({ name: 'scan.png', type: 'image/png' }), false);
});

test('CSV parser preserves quoted delimiters line breaks and empty cells', () => {
  const rows = parseCsv('Name,Note,Empty\n"A, B","line 1\nline 2",\nC,Normal,');
  assert.deepEqual(rows[0], ['Name', 'Note', 'Empty']);
  assert.equal(rows[1][0], 'A, B');
  assert.equal(rows[1][1], 'line 1\nline 2');
  assert.equal(rows[1][2], '');
  assert.equal(rows[2][2], '');
});

test('CSV import creates a real editable table model', () => {
  const model = csvToDocument('ลำดับที่,MAC Address,S/N Number,เจ้าของเครื่อง\n1.,24-6A-0E-DE-EF-9D,5CD43979HO,คุณเสวนีย์', { name: 'inventory.csv' });
  const table = model.pages[0].blocks.find(block => block.type === 'table');
  assert.ok(table);
  assert.equal(table.rows, 2);
  assert.equal(table.columns, 4);
  assert.equal(table.cells.find(cell => cell.row === 1 && cell.column === 1).text, '24-6A-0E-DE-EF-9D');
});

test('RTF conversion keeps paragraphs tabs and Unicode characters', () => {
  const text = rtfToText('{\\rtf1\\ansi หัวข้อ\\par รายการ\\tab 1\\par \\u3585?}');
  assert.match(text, /หัวข้อ/u);
  assert.match(text, /รายการ\t1/u);
  assert.ok(text.includes(String.fromCharCode(3585)));
});

test('plain text import creates editable positioned text blocks', () => {
  const model = textToDocument('หัวข้อ\n\nย่อหน้าที่หนึ่ง\nย่อหน้าที่สอง', { name: 'note.txt' });
  assert.equal(model.sourceType, 'txt');
  assert.ok(model.pages.length >= 1);
  assert.ok(model.pages[0].blocks.every(block => block.type === 'text'));
  assert.match(model.pages[0].blocks.map(block => block.text).join('\n'), /ย่อหน้าที่หนึ่ง/u);
});

test('Office adapters include DOCX tables/images XLSX merges and PPTX positioned blocks', async () => {
  const source = await read('web/office-import.mjs');
  for (const required of [
    'importDocx',
    'word/document.xml',
    'docxTableData',
    'docxParagraphImages',
    'importXlsx',
    "sheet['!merges']",
    "sheet['!cols']",
    'importPptx',
    'pptxTransform',
    'zipImageDataUrl',
    'importOpenDocument',
  ]) assert.ok(source.includes(required), `missing ${required}`);
});
