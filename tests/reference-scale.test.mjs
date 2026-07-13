import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');

test('desktop landing scale matches the approved compact reference', async () => {
  const css = await read('web/reference-scale.css');
  assert.match(css, /width:\s*min\(100%,\s*1320px\)/);
  assert.match(css, /font-size:\s*clamp\(56px,\s*3\.8vw,\s*72px\)/);
  assert.match(css, /min-height:\s*312px/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1\.05fr\)/);
  assert.match(css, /width:\s*min\(100%,\s*760px\)/);
});

test('reference scale performance table and Document Studio assets are injected and cached', async () => {
  const build = await read('build.mjs');
  assert.ok(build.includes('/reference-scale.css'));
  assert.ok(build.includes('/performance-v22.css'));
  assert.ok(build.includes('/table-auto.css'));
  assert.ok(build.includes('/table-auto-ui.js'));
  assert.ok(build.includes('/document-studio.css'));
  assert.ok(build.includes('/document-studio.js'));
  assert.ok(build.includes('/table-review-v31.css'));
  assert.ok(build.includes('/table-review-v31.js'));
  assert.ok(build.includes('ripscan-pwa-v3.1.0'));
  assert.ok(build.includes('Table-first Reconstruction v3.1'));
});
