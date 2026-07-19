import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('initial page defers OCR and ZIP scripts until they are requested', async () => {
  const [index, app, advanced, upgrade] = await Promise.all([
    read('web/index.html'), read('web/app.js'), read('web/advanced.js'), read('web/upgrade.js'),
  ]);
  assert.doesNotMatch(index, /tesseract\.min\.js|jszip\.min\.js/u);
  assert.match(app, /import \{ loadPdfJs, loadTesseract \} from '\.\/lazy-libraries\.mjs';/u);
  assert.match(app, /const tesseract = await loadTesseract\(\);/u);
  assert.match(advanced, /import \{ loadJsZip, loadTesseract \} from '\.\/lazy-libraries\.mjs';/u);
  assert.doesNotMatch(advanced, /function patchTesseractWorkers/u);
  assert.match(upgrade, /import \{ loadJsZip, loadTesseract \} from '\.\/lazy-libraries\.mjs';/u);
});

test('all on-demand OCR tools use the shared cancellable runtime', async () => {
  const paths = [
    'web/book-ocr-browser.mjs', 'web/book-ocr-browser-recovery.mjs',
    'web/book-ocr-browser-hard-block.mjs', 'web/book-ocr-browser-performance.mjs',
    'web/book-ocr-ui.js', 'web/cover-ocr-ui.js', 'web/table-review-v31.js', 'web/table-review-v312.js',
  ];
  const sources = await Promise.all(paths.map(read));
  for (const source of sources) {
    assert.match(source, /loadTesseract/u);
    assert.doesNotMatch(source, /(?:window|globalThis)\.Tesseract\.createWorker/u);
  }
});
