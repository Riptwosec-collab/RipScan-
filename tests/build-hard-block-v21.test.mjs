import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');

test('production build switches Book OCR to Worker Queue v2.2 with Cover Hard Block', async () => {
  const build = await read('build.mjs');
  assert.match(build, /book-ocr-browser-performance\.mjs/);
  assert.match(build, /ripscan-pwa-v2\.2\.0/);
  assert.match(build, /cover-hard-block\.mjs/);
  assert.match(build, /sara-am-recovery-v21\.mjs/);
  assert.match(build, /ocr-preprocess-worker\.js/);
});

test('syntax check includes worker performance hard-block and Sara Am modules', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  assert.match(packageJson.scripts.check, /book-ocr-browser-performance\.mjs/);
  assert.match(packageJson.scripts.check, /ocr-performance-core\.mjs/);
  assert.match(packageJson.scripts.check, /ocr-preprocess-worker\.js/);
  assert.match(packageJson.scripts.check, /book-ocr-browser-hard-block\.mjs/);
  assert.match(packageJson.scripts.check, /cover-hard-block\.mjs/);
  assert.match(packageJson.scripts.check, /sara-am-recovery-v21\.mjs/);
  assert.equal(packageJson.version, '2.2.0');
});
