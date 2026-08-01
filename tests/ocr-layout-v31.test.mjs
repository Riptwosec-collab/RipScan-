import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  OCR_LAYOUT_VERSION,
  extractTesseractLayout,
  layoutFromPdfItems,
  scoreOcrCandidate,
  ocrRowsToDocumentModel,
  tableRecordsToBlock,
} from '../web/ocr-layout.mjs';
import { createTextBlock } from '../web/document-model.mjs';
import { modelToDocxBlob, modelToXlsxBlob } from '../web/editor-export.mjs';

test('Tesseract layout retains line and word coordinates in reading order', () => {
  const layout = extractTesseractLayout({
    blocks: [{
      confidence: 94,
      paragraphs: [{
        lines: [
          {
            text: 'หัวข้อเอกสาร',
            confidence: 96,
            bbox: { x0: 40, y0: 30, x1: 310, y1: 72 },
            words: [{ text: 'หัวข้อเอกสาร', confidence: 96, bbox: { x0: 40, y0: 30, x1: 310, y1: 72 } }],
          },
          {
            text: 'เลขที่ A-001',
            confidence: 91,
            bbox: { x0: 42, y0: 100, x1: 240, y1: 128 },
            words: [
              { text: 'เลขที่', confidence: 91, bbox: { x0: 42, y0: 100, x1: 105, y1: 128 } },
              { text: 'A-001', confidence: 92, bbox: { x0: 120, y0: 100, x1: 240, y1: 128 } },
            ],
          },
        ],
      }],
    }],
  }, 800, 1100);

  assert.equal(layout.version, OCR_LAYOUT_VERSION);
  assert.equal(layout.lines.length, 2);
  assert.equal(layout.words.length, 3);
  assert.equal(layout.lines[0].bbox.left, 40);
  assert.match(layout.text, /หัวข้อเอกสาร\nเลขที่ A-001/u);
});

test('PDF text items are converted from bottom-left coordinates to page layout', () => {
  const layout = layoutFromPdfItems([
    { str: 'ด้านบน', width: 80, height: 14, transform: [1, 0, 0, 14, 30, 700] },
    { str: 'ด้านล่าง', width: 90, height: 14, transform: [1, 0, 0, 14, 30, 100] },
  ], 600, 800, 1);
  assert.equal(layout.lines.length, 2);
  assert.ok(layout.lines[0].bbox.top < layout.lines[1].bbox.top);
  assert.match(layout.text, /^ด้านบน/u);
});

test('candidate scoring rewards bounded layout and penalizes corrupt Unicode', () => {
  const good = scoreOcrCandidate({
    text: 'สำนักงานเขตพื้นที่การศึกษา A-001',
    confidence: .91,
    layout: { lines: [{}, {}], words: Array.from({ length: 12 }, () => ({})) },
  });
  const corrupt = scoreOcrCandidate({
    text: '\uFFFD\uFFFD\uFFFD',
    confidence: .99,
    layout: { lines: [], words: [] },
  });
  assert.ok(good > corrupt);
});

test('OCR rows become positioned editable blocks and detected tables become real cells', () => {
  const table = tableRecordsToBlock([
    { rowIndex: 0, columnIndex: 0, rowSpan: 1, columnSpan: 2, text: 'รายการ' },
    { rowIndex: 1, columnIndex: 0, rowSpan: 1, columnSpan: 1, text: '1' },
    { rowIndex: 1, columnIndex: 1, rowSpan: 1, columnSpan: 1, text: 'ทดสอบ' },
  ], { width: 500, height: 100 });
  const model = ocrRowsToDocumentModel([{
    originalPage: 1,
    text: 'รายการ',
    width: 800,
    height: 1100,
    layout: {
      version: OCR_LAYOUT_VERSION,
      source: 'tesseract',
      width: 800,
      height: 1100,
      lines: [{ text: 'รายการ', confidence: .95, bbox: { left: 40, top: 30, width: 220, height: 38 }, words: [] }],
    },
    tables: [table],
  }], 'Layout');
  assert.equal(model.pages[0].blocks[0].type, 'table');
  assert.equal(model.pages[0].blocks[0].cells[0].columnSpan, 2);
});

test('editable DOCX exposes positioned text boxes without flattening the source image', async () => {
  globalThis.JSZip = JSZip;
  globalThis.XLSX = XLSX;
  const model = ocrRowsToDocumentModel([{
    originalPage: 1,
    text: 'หัวข้อ',
    width: 800,
    height: 1100,
    image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n3cAAAAASUVORK5CYII=',
    layout: {
      version: OCR_LAYOUT_VERSION,
      source: 'tesseract',
      width: 800,
      height: 1100,
      lines: [{
        text: 'หัวข้อ',
        confidence: .97,
        bbox: { left: 40, top: 30, width: 300, height: 42, x1: 340, y1: 72 },
        words: [],
      }],
    },
  }], 'Positioned');
  model.pages[0].blocks.push(createTextBlock({
    x: 40,
    y: 120,
    width: 300,
    height: 42,
    text: 'VISIBLE USER NOTE',
    metadata: { userCreated: true },
  }));

  const docx = await modelToDocxBlob(model, { officeMode: 'editable' });
  const zip = await JSZip.loadAsync(await docx.arrayBuffer());
  const documentXml = await zip.file('word/document.xml').async('text');
  assert.match(documentXml, /xmlns:v="urn:schemas-microsoft-com:vml"/u);
  assert.match(documentXml, /margin-left:30pt/u);
  assert.match(documentXml, /margin-top:22.5pt/u);
  assert.match(documentXml, /w:pgSz w:w="12000" w:h="16500"/u);
  assert.match(documentXml, /<v:textbox/u);
  assert.doesNotMatch(documentXml, /<w:vanish\/>/u);
  const visibleTextIndex = documentXml.indexOf('VISIBLE USER NOTE');
  const visiblePropertiesStart = documentXml.lastIndexOf('<w:rPr>', visibleTextIndex);
  const visiblePropertiesEnd = documentXml.indexOf('</w:rPr>', visiblePropertiesStart);
  assert.doesNotMatch(documentXml.slice(visiblePropertiesStart, visiblePropertiesEnd), /w:vanish/u);
  assert.match(documentXml, /w:line="1" w:lineRule="exact"/u);
  assert.doesNotMatch(documentXml, /<v:imagedata/u);
  assert.equal(zip.file('word/media/page-background-1.png'), null);

  const xlsx = await modelToXlsxBlob(model, { officeMode: 'editable' });
  const workbook = XLSX.read(await xlsx.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const values = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }).flat();
  assert.ok(values.includes('หัวข้อ'));
  assert.ok(values.includes('VISIBLE USER NOTE'));
  assert.ok(sheet['!merges']?.length >= 1);
  assert.equal(workbook.Props.Subject, 'Editable OCR cells');
});

test('DOCX source-image mode hides OCR table borders and text without hiding user blocks', async () => {
  globalThis.JSZip = JSZip;
  const table = tableRecordsToBlock([
    { rowIndex: 0, columnIndex: 0, rowSpan: 1, columnSpan: 1, text: 'OCR CELL' },
  ], { x: 40, y: 80, width: 300, height: 60 });
  const model = ocrRowsToDocumentModel([{
    originalPage: 1,
    width: 800,
    height: 1100,
    image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n3cAAAAASUVORK5CYII=',
    tables: [table],
  }], 'Hidden table');
  model.pages[0].blocks.push(createTextBlock({
    x: 40,
    y: 180,
    width: 300,
    height: 42,
    text: 'VISIBLE USER NOTE',
  }));

  const docx = await modelToDocxBlob(model, { officeMode: 'original' });
  const zip = await JSZip.loadAsync(await docx.arrayBuffer());
  const documentXml = await zip.file('word/document.xml').async('text');
  assert.match(documentXml, /<w:top w:val="nil"/u);
  assert.match(documentXml, /<w:insideV w:val="nil"/u);
  assert.match(documentXml, /<w:vanish\/>/u);
  assert.match(documentXml, /<v:imagedata r:id="rIdImage1"/u);
  assert.ok(zip.file('word/media/page-background-1.png'));
  const visibleTextIndex = documentXml.indexOf('VISIBLE USER NOTE');
  const visiblePropertiesStart = documentXml.lastIndexOf('<w:rPr>', visibleTextIndex);
  const visiblePropertiesEnd = documentXml.indexOf('</w:rPr>', visiblePropertiesStart);
  assert.doesNotMatch(documentXml.slice(visiblePropertiesStart, visiblePropertiesEnd), /w:vanish/u);
});

test('XLSX merged cells keep text only in the editable anchor cell', async () => {
  globalThis.XLSX = XLSX;
  const table = tableRecordsToBlock([
    { rowIndex: 0, columnIndex: 0, rowSpan: 1, columnSpan: 2, text: 'MERGED HEADER' },
    { rowIndex: 1, columnIndex: 0, rowSpan: 1, columnSpan: 1, text: 'A-001' },
    { rowIndex: 1, columnIndex: 1, rowSpan: 1, columnSpan: 1, text: 'Editable value' },
  ], { width: 500, height: 100 });
  const model = ocrRowsToDocumentModel([{ width: 800, height: 1100, tables: [table] }], 'Editable table');
  const xlsx = await modelToXlsxBlob(model, { officeMode: 'editable' });
  const workbook = XLSX.read(await xlsx.arrayBuffer(), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  assert.equal(sheet.A1.v, 'MERGED HEADER');
  assert.equal(sheet.B1?.v || '', '');
  assert.equal(sheet.A2.v, 'A-001');
  assert.equal(sheet.B2.v, 'Editable value');
  assert.deepEqual(sheet['!merges'][0], { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } });
});
