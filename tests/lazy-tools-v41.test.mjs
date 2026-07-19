import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('tool loader dynamically loads Studio PDF table and review modules', async () => {
  const loader = await read('web/tool-lazy-loader.js');
  for (const required of [
    "loadModule('studio', '/document-studio.js'", "loadModule('pdf-tools', '/pdf-tools-ui.js'",
    "loadModule('book-review', '/book-ocr-ui.js'", "loadModule('table-auto', '/table-auto-ui.js'",
    "loadModule('cover-review', '/cover-ocr-ui.js'", 'stopImmediatePropagation()',
    "window.addEventListener('ripscan:job-end'", 'requestIdleCallback', 'resultsObserver?.disconnect()',
  ]) assert.ok(loader.includes(required), `missing lazy tool behavior ${required}`);
});

test('hover and focus use modulepreload without executing Studio or removing launchers', async () => {
  const loader = await read('web/tool-lazy-loader.js');
  for (const required of [
    "link.rel = 'modulepreload'", "button.addEventListener('pointerenter', preload",
    "button.addEventListener('focus', preload", "preloadModule('/document-studio.js'",
    "preloadModule('/pdf-tools-ui.js'",
  ]) assert.ok(loader.includes(required), `missing non-executing preload guard ${required}`);
  const loadStudioBody = loader.match(/async function loadStudio\(\) \{([\s\S]*?)\n\}/u)?.[1] || '';
  assert.ok(loadStudioBody.includes("loadModule('studio'"));
  assert.ok(loadStudioBody.includes('removeLazyLaunchers()'));
  assert.ok(!loader.includes("pointerenter', () => loadStudio"));
});

test('production lazy build removes heavy scripts styles and JSZip from initial HTML', async () => {
  const build = await read('build-performance-lazy.mjs');
  for (const required of [
    '/document-studio.js', '/pdf-tools-ui.js', '/table-auto-ui.js', '/book-ocr-ui.js',
    '/cover-ocr-ui.js', '/table-review-v312.js', '/tool-lazy-loader.js',
    '/document-studio.css', '/pdf-tools.css', '/table-auto.css', '/performance-v22.css',
  ]) assert.ok(build.includes(required), `missing lazy build rule ${required}`);
  assert.match(build, /jszip@3\\\.10\\\.1/u);
  assert.match(build, /vendor\\\/tesseract\\\.min\\\.js/u);
  assert.match(build, /vendor\\\/jszip\\\.min\\\.js/u);
});

test('static build audit measures before and after byte counts from the same build', async () => {
  const baseline = await read('build-performance-baseline.mjs');
  const audit = await read('build-performance-audit.mjs');
  for (const required of ['initialLocalScriptBytes', 'initialRemoteScriptCount', 'pwaPrecacheAssetCount']) {
    assert.ok(baseline.includes(required));
    assert.ok(audit.includes(required));
  }
  assert.ok(audit.includes('performance-build-report.json'));
  assert.ok(audit.includes('Static byte counts from the same Vercel production build'));
});
