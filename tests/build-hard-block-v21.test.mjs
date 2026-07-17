import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');

test('production build keeps OCR hard block and responsive Table-first while adding PDF Tools v4', async () => {
  const build = await read('build.mjs');
  assert.match(build, /book-ocr-browser-performance\.mjs/);
  assert.match(build, /ripscan-pwa-v4\.0\.1/);
  assert.match(build, /cover-hard-block\.mjs/);
  assert.match(build, /sara-am-recovery-v21\.mjs/);
  assert.match(build, /ocr-preprocess-worker\.js/);
  assert.match(build, /table-auto-ui\.js/);
  assert.match(build, /document-studio\.js/);
  assert.match(build, /table-reconstruction-core\.mjs/);
  assert.match(build, /table-reconstruction-worker\.js/);
  assert.match(build, /table-review-v312\.js/);
  assert.match(build, /pdf-tools-ui\.js/);
  assert.match(build, /pdf-worker\.js/);
});

test('syntax check includes OCR table document reconstruction and PDF tool modules', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  for (const required of [
    'book-ocr-browser-performance.mjs', 'ocr-performance-core.mjs', 'ocr-preprocess-worker.js',
    'book-ocr-browser-hard-block.mjs', 'cover-hard-block.mjs', 'sara-am-recovery-v21.mjs',
    'table-structure-core.mjs', 'table-auto-ui.js', 'table-reconstruction-core.mjs',
    'table-reconstruction-worker.js', 'table-review-v312.js', 'document-model.mjs',
    'office-import.mjs', 'editor-export.mjs', 'document-studio.js', 'pdf-utility-core.mjs',
    'pdf-page-organizer.mjs', 'pdf-worker.js', 'pdf-tool-runtime.mjs', 'ripscan-project.mjs',
    'roundtrip-export.mjs', 'pdf-tools-ui.js',
  ]) assert.match(packageJson.scripts.check, new RegExp(required.replaceAll('.', '\\.')), `missing ${required}`);
  assert.equal(packageJson.version, '4.0.1');
});
