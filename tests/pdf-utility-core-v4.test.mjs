import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PDF_TOOL_CATALOG,
  buildSplitGroups,
  compatibilityReport,
  compressionReport,
  detectFileSignature,
  estimateCompressedSize,
  fidelityScore,
  normalizeCompressionOptions,
  outputPageFilename,
  parsePageRanges,
  sourceFormatMetadata,
  splitFilename,
  validatePdfBytes,
} from '../web/pdf-utility-core.mjs';
import {
  createDocument,
  createImageBlock,
  createPage,
  createTableBlock,
  createTextBlock,
} from '../web/document-model.mjs';

const bytes = text => new TextEncoder().encode(text);

test('PDF tool catalog exposes the eight tools inside the existing Convert Center', () => {
  assert.deepEqual(PDF_TOOL_CATALOG.map(tool => tool.id), [
    'compress', 'merge', 'split', 'organize', 'edit', 'pdf-to-jpg', 'pdf-to-png', 'image-to-pdf',
  ]);
});

test('compression presets keep text in low and standard modes and report actual saving', () => {
  const standard = normalizeCompressionOptions({ level: 'standard' });
  assert.equal(standard.preserveTextLayer, true);
  assert.equal(standard.dpi, 150);
  const high = normalizeCompressionOptions({ level: 'high' });
  assert.equal(high.preserveTextLayer, false);
  assert.ok(estimateCompressedSize(18_400_000, 24, high) < estimateCompressedSize(18_400_000, 24, standard));
  const report = compressionReport(18_400_000, 6_100_000, 24, [14]);
  assert.equal(report.completedPages, 23);
  assert.ok(report.savedPercent > 66 && report.savedPercent < 67);
});

test('PDF signature and corruption validation reject invalid headers and missing EOF', () => {
  assert.equal(detectFileSignature(bytes('%PDF-1.7\nbody\n%%EOF')), 'pdf');
  assert.equal(validatePdfBytes(bytes('%PDF-1.7\nbody\n%%EOF')).valid, true);
  assert.deepEqual(validatePdfBytes(bytes('not a pdf')).errors, ['PDF_INVALID_HEADER', 'PDF_EOF_NOT_FOUND']);
  assert.ok(validatePdfBytes(bytes('%PDF-1.7\nbody')).errors.includes('PDF_EOF_NOT_FOUND'));
});

test('page range parser validates ranges duplicates bounds and reversed values', () => {
  assert.deepEqual(parsePageRanges('1-3, 5, 7-9', 10), [0, 1, 2, 4, 6, 7, 8]);
  assert.throws(() => parsePageRanges('1-3,3', 10), /DUPLICATE_PAGE:3/u);
  assert.throws(() => parsePageRanges('5-2', 10), /REVERSED_PAGE_RANGE/u);
  assert.throws(() => parsePageRanges('11', 10), /PAGE_OUT_OF_RANGE/u);
});

test('split builder supports every page ranges N pages odd and even', () => {
  assert.deepEqual(buildSplitGroups('every-page', 3), [[0], [1], [2]]);
  assert.deepEqual(buildSplitGroups('ranges', 10, { ranges: '1-3,5,7-9' }), [[0, 1, 2], [4], [6, 7, 8]]);
  assert.deepEqual(buildSplitGroups('every-n', 5, { everyN: 2 }), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(buildSplitGroups('even', 6), [[1, 3, 5]]);
  assert.deepEqual(buildSplitGroups('odd', 6), [[0, 2, 4]]);
});

test('output filenames are stable and page padded', () => {
  assert.equal(outputPageFilename('document.pdf', 0, 'png', 20), 'document_page_001.png');
  assert.equal(splitFilename('document.pdf', [0, 1, 2]), 'document_pages_1-3.pdf');
  assert.equal(splitFilename('document.pdf', [7]), 'document_page_8.pdf');
});

test('source metadata compatibility and fidelity use the structured document model', () => {
  const metadata = sourceFormatMetadata({ name: 'report.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  assert.equal(metadata.preferredRoundTripFormat, 'docx');
  const model = createDocument({ name: 'report.docx', sourceType: 'docx', metadata });
  const page = createPage({ number: 1 });
  page.blocks.push(createTextBlock({ text: 'ภาษาไทยและสระอำ', source: 'docx_paragraph' }));
  page.blocks.push(createTableBlock({ rows: 2, columns: 2, source: 'docx_table' }));
  page.blocks.push(createImageBlock({ src: 'data:image/png;base64,AA==', source: 'docx_image' }));
  model.pages.push(page);
  const compatibility = compatibilityReport(model, 'docx');
  assert.equal(compatibility.counts.text, 1);
  assert.equal(compatibility.counts.table, 1);
  assert.equal(compatibility.counts.image, 1);
  assert.equal(compatibility.canExport, true);
  const fidelity = fidelityScore(model);
  assert.ok(fidelity.overallScore <= 1 && fidelity.overallScore >= .5);
});
