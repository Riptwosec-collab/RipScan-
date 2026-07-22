import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');

test('production build keeps OCR hard block and adds Document Studio v3', async () => {
  const build = await read('build.mjs');
  assert.match(build, /book-ocr-browser-performance\.mjs/);
  assert.match(build, /ripscan-pwa-v3\.0\.2/);
  assert.match(build, /cover-hard-block\.mjs/);
  assert.match(build, /sara-am-recovery-v21\.mjs/);
  assert.match(build, /ocr-preprocess-worker\.js/);
  assert.match(build, /table-auto-ui\.js/);
  assert.match(build, /document-studio\.js/);
});

test('syntax check includes OCR table and document reconstruction modules', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  assert.match(packageJson.scripts.check, /book-ocr-browser-performance\.mjs/);
  assert.match(packageJson.scripts.check, /ocr-performance-core\.mjs/);
  assert.match(packageJson.scripts.check, /ocr-preprocess-worker\.js/);
  assert.match(packageJson.scripts.check, /book-ocr-browser-hard-block\.mjs/);
  assert.match(packageJson.scripts.check, /cover-hard-block\.mjs/);
  assert.match(packageJson.scripts.check, /sara-am-recovery-v21\.mjs/);
  assert.match(packageJson.scripts.check, /table-structure-core\.mjs/);
  assert.match(packageJson.scripts.check, /table-auto-ui\.js/);
  assert.match(packageJson.scripts.check, /document-model\.mjs/);
  assert.match(packageJson.scripts.check, /office-import\.mjs/);
  assert.match(packageJson.scripts.check, /editor-export\.mjs/);
  assert.match(packageJson.scripts.check, /document-studio\.js/);
  assert.match(packageJson.scripts.check, /ocr-runtime-guard\.js/);
  assert.equal(packageJson.version, '3.0.0');
});
