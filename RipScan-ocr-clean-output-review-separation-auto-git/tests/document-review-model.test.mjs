import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_MODEL_VERSION,
  createDocument,
  createPage,
  createTableBlock,
  createTextBlock,
  documentToPlainText,
  normalizeDocumentModel,
} from '../web/document-model.mjs';
import { OUTPUT_MODES } from '../web/ocr-output-cleaner.mjs';

test('document model stores review metadata separately from text', () => {
  const block = createTextBlock({ text: '[โปรดตรวจสอบ: ติดต่อเจ้าหน้าที RDNOC]', confidence: 0.72 });
  assert.equal(block.text, 'ติดต่อเจ้าหน้าที RDNOC');
  assert.equal(block.status, 'review_required');
  assert.equal(block.metadata.review.displayLabel, 'โปรดตรวจสอบ');
  assert.equal(block.includeInExport, false);
});

test('inline decorations do not mutate text', () => {
  const block = createTextBlock({
    text: 'ติดต่อเจ้าหน้าที่ RDNOC',
    decorations: [{ start: 0, end: 10, status: 'review_required', color: 'yellow' }],
  });
  assert.equal(block.text, 'ติดต่อเจ้าหน้าที่ RDNOC');
  assert.equal(block.decorations.length, 1);
  assert.ok(!block.text.includes('[โปรดตรวจสอบ:'));
});

test('normalization migrates legacy table cell markers', () => {
  const document = createDocument();
  document.pages.push(createPage({
    blocks: [createTableBlock({
      rows: 1,
      columns: 1,
      cells: [{ row: 0, column: 0, text: '[อาจเป็นข้อความ: เบอร บ2 2/2 0950691-54]' }],
    })],
  }));
  const normalized = normalizeDocumentModel(document);
  const cell = normalized.pages[0].blocks[0].cells[0];
  assert.equal(cell.text, 'เบอร บ2 2/2 0950691-54');
  assert.equal(cell.status, 'possible_text');
  assert.equal(cell.includeInExport, false);
});

test('documentToPlainText defaults to clean verified and reviewed', () => {
  const document = createDocument();
  document.pages.push(createPage({ blocks: [
    createTextBlock({ text: 'ยืนยันแล้ว', status: 'verified', confirmed: true }),
    createTextBlock({ text: 'ยังไม่ยืนยัน', status: 'review_required', confirmed: false, includeInExport: false, y: 30 }),
  ] }));
  assert.equal(documentToPlainText(document), 'ยืนยันแล้ว');
  assert.equal(documentToPlainText(document, { mode: OUTPUT_MODES.INCLUDE_UNVERIFIED }), 'ยืนยันแล้ว\n\nยังไม่ยืนยัน');
});

test('document model version is upgraded', () => {
  assert.equal(DOCUMENT_MODEL_VERSION, '4.1.0');
});
