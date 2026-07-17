import { readFile, writeFile } from 'node:fs/promises';

function replaceRequired(source, search, replacement, label) {
  source = source.replace(/\r\n/g, '\n');
  const result = source.replace(search, replacement);
  if (result === source) throw new Error(`Performance review patch failed: ${label}`);
  return result;
}

const appPath = 'dist/app.js';
let app = await readFile(appPath, 'utf8');
app = replaceRequired(
  app,
  '    performance: result.performance,\n  };',
  [
    '    performance: result.performance,',
    '    blocks: result.blocks || [],',
    '    review: result.review || { blocks: [], count: 0 },',
    '    skippedImageRegions: Number(result.skippedImageRegions || 0),',
    '    barcodes: result.barcodes || [],',
    '    documentType: result.documentType || \'auto\',',
    '    workerProcessed: true,',
    '  };',
  ].join('\n'),
  'retain worker OCR blocks',
);
app = replaceRequired(
  app,
  '  state.documents = documents;\n  initializeReviewState(documents);',
  [
    '  state.documents = documents;',
    '  window.__ripscanPrecomputedPageResults = new Map();',
    '  documents.forEach((documentData, documentIndex) => documentData.pages.forEach((page, pageIndex) => {',
    '    if (!page.workerProcessed) return;',
    "    window.__ripscanPrecomputedPageResults.set(documentIndex + ':' + pageIndex, {",
    '      text: page.text, confidence: page.confidence, blocks: page.blocks || [],',
    '      review: page.review || { blocks: [], count: 0 },',
    '      skippedImageRegions: Number(page.skippedImageRegions || 0),',
    '      barcodes: page.barcodes || [], documentType: page.documentType || \'auto\',',
    '    });',
    '  }));',
    '  initializeReviewState(documents);',
  ].join('\n'),
  'precomputed result registry',
);
app = replaceRequired(
  app,
  '<section class="page-card" data-page-card="${pageIndex}" ${pageIndex === 0 ? \'\' : \'hidden\'}>',
  '<section class="page-card" data-page-card="${pageIndex}" data-worker-ocr="${page.workerProcessed ? \'true\' : \'false\'}" ${pageIndex === 0 ? \'\' : \'hidden\'}>',
  'worker page marker',
);
await writeFile(appPath, app, 'utf8');

const bookUiPath = 'dist/book-ocr-ui.js';
let bookUi = await readFile(bookUiPath, 'utf8');
bookUi = replaceRequired(
  bookUi,
  "import { cancelBookCoverOcr, processBookCoverCanvas } from './book-ocr-browser-emergency.mjs';",
  "import { cancelBookCoverOcr, processBookCoverCanvas } from './book-ocr-browser-emergency.mjs';\nimport { loadTesseract } from './lazy-libraries.mjs';",
  'lazy manual retry OCR',
);
bookUi = replaceRequired(
  bookUi,
  'function enhanceResults() {\n  const pageCards = [...document.querySelectorAll(\'.page-card\')];\n  const clearPages = document.querySelector(\'#clearScanPagesButton\');\n  if (clearPages) clearPages.disabled = pageCards.length === 0;\n  pageCards.forEach(pageCard => enqueuePage(pageCard));\n}',
  [
    'function enhanceResults() {',
    "  const pageCards = [...document.querySelectorAll('.page-card')];",
    "  const clearPages = document.querySelector('#clearScanPagesButton');",
    '  if (clearPages) clearPages.disabled = pageCards.length === 0;',
    '  pageCards.forEach(pageCard => {',
    "    const textarea = pageCard.querySelector('.page-text');",
    "    const key = (textarea?.dataset.document || '0') + ':' + (textarea?.dataset.page || '0');",
    '    const precomputed = window.__ripscanPrecomputedPageResults?.get?.(key);',
    '    if (precomputed && !processedPages.has(pageCard)) {',
    '      processedPages.add(pageCard);',
    '      pageResults.set(pageCard, precomputed);',
    '      renderReviewPanel(pageCard, precomputed);',
    '      return;',
    '    }',
    "    if (pageCard.dataset.workerOcr === 'true') return;",
    '    enqueuePage(pageCard);',
    '  });',
    '}',
  ].join('\n'),
  'reuse precomputed OCR review',
);
bookUi = replaceRequired(
  bookUi,
  "    worker = await window.Tesseract.createWorker(langs, 1, { cacheMethod: 'write' });",
  "    if (!window.Tesseract?.createWorker) await loadTesseract();\n    worker = await window.Tesseract.createWorker(langs, 1, { cacheMethod: 'write' });",
  'lazy retry worker',
);
bookUi = bookUi.replaceAll('canvas.width = 1;\n    canvas.height = 1;', 'canvas.width = 0;\n    canvas.height = 0;');
bookUi = bookUi.replace('canvas.width = 1; canvas.height = 1; crop.width = 1; crop.height = 1;', 'canvas.width = 0; canvas.height = 0; crop.width = 0; crop.height = 0;');
await writeFile(bookUiPath, bookUi, 'utf8');

console.log('RipScan OCR review reuses precomputed worker blocks and prevents duplicate automatic page OCR');
