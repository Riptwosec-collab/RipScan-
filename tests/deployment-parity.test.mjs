import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('raw FastAPI frontend and production build source expose the same 3.3 entrypoints', async () => {
  const [index, dockerfile, serviceWorker, build, advanced] = await Promise.all([read('web/index.html'), read('Dockerfile'), read('web/sw.js'), read('build.mjs'), read('web/advanced.js')]);
  for (const asset of ['/quality-center.js', '/project-workspace.js', '/document-studio.js', '/quality-center.css', '/document-studio.css']) {
    assert.ok(index.includes(asset), `web/index.html missing ${asset}`);
    assert.ok(serviceWorker.includes(asset), `web/sw.js missing ${asset}`);
  }
  assert.match(dockerfile, /FROM node:20-slim AS frontend/u);
  assert.match(dockerfile, /COPY --from=frontend \/frontend\/dist \.\/web/u);
  assert.ok(index.includes('__ripscanOcrRuntime'));
  assert.ok(advanced.includes('workerPath: options?.workerPath || window.__ripscanOcrRuntime?.workerPath'));
  for (const asset of ['worker.min.js', 'tesseract-core-lstm.wasm.js']) {
    assert.ok(build.includes(asset), `build.mjs missing local OCR asset ${asset}`);
    assert.ok(serviceWorker.includes(asset), `web/sw.js missing local OCR asset ${asset}`);
  }
});
