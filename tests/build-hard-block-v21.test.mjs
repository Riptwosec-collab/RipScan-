import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');

test('production build switches Book OCR to Cover Hard Block v2.1', async () => {
  const build = await read('build.mjs');
  assert.match(build, /book-ocr-browser-hard-block\.mjs/);
  assert.match(build, /ripscan-pwa-v2\.1\.0/);
  assert.match(build, /cover-hard-block\.mjs/);
  assert.match(build, /sara-am-recovery-v21\.mjs/);
});

test('syntax check includes new hard-block and Sara Am recovery modules', async () => {
  const packageJson = JSON.parse(await read('package.json'));
  assert.match(packageJson.scripts.check, /book-ocr-browser-hard-block\.mjs/);
  assert.match(packageJson.scripts.check, /cover-hard-block\.mjs/);
  assert.match(packageJson.scripts.check, /sara-am-recovery-v21\.mjs/);
  assert.equal(packageJson.version, '2.1.0');
});
