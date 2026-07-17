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

test('reference scale keeps responsive assets while performance-heavy tools are lazy', async () => {
  const build = await read('build.mjs');
  for (const required of [
    '/reference-scale.css', '/performance-v22.css', '/table-auto.css', '/table-auto-ui.js',
    '/document-studio.css', '/document-studio.js', '/pdf-tools.css', '/pdf-tools-ui.js',
    '/table-review-v31.css', '/table-review-v312.js', 'ripscan-pwa-v5.0.0',
    'Performance Runtime v5.0.0', 'Table-first Reconstruction v3.1.2',
  ]) assert.ok(build.includes(required), `missing ${required}`);
});
