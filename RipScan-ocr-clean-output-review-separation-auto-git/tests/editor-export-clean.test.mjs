import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createPage, createTextBlock } from '../web/document-model.mjs';
import { getExportPreview, normalizeExportOptions, printableDocumentHtml } from '../web/editor-export.mjs';

test('export options default to clean verified plus reviewed', () => {
  assert.equal(normalizeExportOptions({}).outputMode, 'verified_reviewed');
});

test('export preview reports filtered review items', () => {
  const document = createDocument();
  document.pages.push(createPage({ blocks: [
    createTextBlock({ text: 'A', status: 'verified', confirmed: true }),
    createTextBlock({ text: 'B', status: 'review_required', confirmed: false, includeInExport: false, y: 40 }),
  ] }));
  const preview = getExportPreview(document);
  assert.equal(preview.total, 2);
  assert.equal(preview.ready, 1);
  assert.equal(preview.excluded, 1);
});

test('searchable print HTML contains no legacy review marker after clean model', () => {
  const document = createDocument();
  document.pages.push(createPage({ blocks: [
    createTextBlock({ text: '[โปรดตรวจสอบ: ติดต่อเจ้าหน้าที่ RDNOC]' }),
  ] }));
  const html = printableDocumentHtml(document.pages, 'test');
  assert.ok(!html.includes('[โปรดตรวจสอบ:'));
});
