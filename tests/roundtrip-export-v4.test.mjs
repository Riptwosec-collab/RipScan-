import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DOCUMENT_MODEL_VERSION,
  createDocument,
  createImageBlock,
  createPage,
  createTableBlock,
  createTextBlock,
  normalizeDocumentModel,
} from '../web/document-model.mjs';
import { attachSourceMetadata, roundTripReport } from '../web/roundtrip-export.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Document Model v4 retains source format dual representation and editable block provenance', () => {
  assert.equal(DOCUMENT_MODEL_VERSION, '4.0.0');
  const model = createDocument({ name: 'report.docx', sourceType: 'docx' });
  const textBlock = createTextBlock({ text: 'แก้ไขต่อได้', source: 'docx_paragraph' });
  const page = createPage({ number: 1, backgroundImage: 'data:image/png;base64,AA==', blocks: [textBlock] });
  model.pages.push(page);
  const enriched = attachSourceMetadata(model, { name: 'report.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  assert.equal(enriched.metadata.sourceFormat, 'docx');
  assert.equal(enriched.metadata.preferredRoundTripFormat, 'docx');
  assert.equal(enriched.metadata.dualRepresentation, true);
  assert.equal(enriched.pages[0].visualReference.backgroundImage, 'data:image/png;base64,AA==');
  assert.ok(enriched.pages[0].blocks[0].metadata.sourceElementId);
  assert.equal(enriched.pages[0].blocks[0].metadata.originalText, 'แก้ไขต่อได้');
  const normalized = normalizeDocumentModel(enriched);
  assert.equal(normalized.pages[0].editableLayer.blockIds.length, 1);
  assert.equal(normalized.pages[0].editableLayer.blockIds[0], normalized.pages[0].blocks[0].id);
});

test('round-trip report counts native editable text tables and images without 100 percent claims', () => {
  const model = createDocument({ name: 'layout.pptx', sourceType: 'pptx', metadata: { sourceFormat: 'pptx' } });
  const page = createPage({ number: 1, width: 1280, height: 720 });
  page.blocks.push(createTextBlock({ text: 'หัวข้อ', source: 'pptx_textbox' }));
  page.blocks.push(createTableBlock({ rows: 2, columns: 2, source: 'pptx_table' }));
  page.blocks.push(createImageBlock({ src: 'data:image/png;base64,AA==', source: 'pptx_image' }));
  model.pages.push(page);
  const report = roundTripReport(model, 'pptx');
  assert.equal(report.summary.editableTextBlocks, 1);
  assert.equal(report.summary.editableTables, 1);
  assert.equal(report.summary.imageObjects, 1);
  assert.ok(report.summary.overallPercent <= 100 && report.summary.overallPercent >= 50);
});

test('round-trip source implements native DOCX PPTX XLSX PDF and RipScan adapters', async () => {
  const source = await read('web/roundtrip-export.mjs');
  for (const required of [
    'modelToRoundTripDocx', '<w:tbl>', '<w:drawing>', '<w:rPr>', 'modelToXlsxBlob',
    'modelToRoundTripPptx', '<p:sp>', '<p:pic>', '<a:tbl>', 'exportEditablePdf',
    'modelToRipscanBlob', 'exportOriginalFormat', "format === 'docx'", "format === 'pdf'",
  ]) assert.ok(source.includes(required), `missing round-trip adapter ${required}`);
  assert.ok(!source.includes('flatten entire document'));
});

test('RipScan project package stores manifest document assets and thumbnails', async () => {
  const source = await read('web/ripscan-project.mjs');
  for (const required of [
    "const MANIFEST_PATH = 'manifest.json'", "const DOCUMENT_PATH = 'document.json'",
    'assets/background-', 'assets/image-', 'thumbnails/page-', 'modelToRipscanBlob',
    'ripscanBlobToModel', "format: 'ripscan-project'",
  ]) assert.ok(source.includes(required), `missing project feature ${required}`);
});
