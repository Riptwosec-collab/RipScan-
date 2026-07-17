import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('grayscale compression applies a real Canvas filter before PDF.js renders the page', async () => {
  const runtime = await read('web/pdf-tool-runtime.mjs');
  assert.ok(runtime.includes("PDF_RUNTIME_VERSION = '4.0.1'"));
  assert.ok(runtime.includes("if (options.grayscale) context.filter = 'grayscale(1)'"));
  const filter = runtime.indexOf("context.filter = 'grayscale(1)'");
  const render = runtime.indexOf('const renderTask = page.render');
  assert.ok(filter > 0 && filter < render, 'grayscale filter must be active before page rendering');
  assert.ok(runtime.includes('grayscale: Boolean(options.grayscale)'));
  assert.ok(runtime.includes('grayscale: normalized.grayscale'));
});
