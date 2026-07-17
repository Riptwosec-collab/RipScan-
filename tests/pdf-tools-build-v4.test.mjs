import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('PDF Tools extend the existing Convert Center and Document Studio without duplicate shells', async () => {
  const ui = await read('web/pdf-tools-ui.js');
  for (const required of [
    "$('#convertCenter .convert-center-card')",
    'RipScanDocumentStudio',
    'PDF_TOOL_CATALOG',
    'PdfPageOrganizer',
    'compressPdf',
    'mergePdfSources',
    'splitPdf',
    'renderPdfPages',
    'imageFilesToPdf',
    'exportOriginalFormat',
    'modelToRipscanBlob',
    'ripscanBlobToModel',
    'AbortController',
    'ปิดทับภาพเท่านั้น ไม่ใช่ Secure Redaction',
  ]) assert.ok(ui.includes(required), `missing ${required}`);
  assert.ok(!ui.includes("dialog.id = 'convertCenter'"), 'must not create another Convert Center');
  assert.ok(!ui.includes("shell.id = 'documentStudio'"), 'must not create another Document Studio');
});

test('PDF worker provides real inspect compress merge split image and editable overlay tasks', async () => {
  const worker = await read('web/pdf-worker.js');
  for (const required of [
    'pdf-lib@1.17.1/+esm',
    '@pdf-lib/fontkit@1.1.1/+esm',
    'compress-preserve',
    'mergeDocuments',
    'splitDocument',
    'imagesToPdf',
    'overlayModel',
    "message.type === 'cancel'",
    "message.type === 'dispose'",
    'useObjectStreams: true',
    'copyPages',
    'embedPng',
    'embedJpg',
    'NotoSansThai-Regular.ttf',
  ]) assert.ok(worker.includes(required), `missing worker implementation ${required}`);
  assert.ok(!worker.includes('latest'));
});

test('PDF runtime queues jobs supports cancel sequential rendering and memory cleanup', async () => {
  const runtime = await read('web/pdf-tool-runtime.mjs');
  for (const required of [
    'class PdfWorkerClient',
    "this.worker = new Worker('/pdf-worker.js', { type: 'module' })",
    'AbortError',
    "this.worker.postMessage({ type: 'cancel'",
    'renderPdfPages',
    'for (let position = 0; position < selected.length; position += 1)',
    'page.cleanup()',
    'await pdf.destroy()',
    'releaseCanvas(canvas)',
    'worker.dispose()',
    'packageImageResults',
  ]) assert.ok(runtime.includes(required), `missing runtime guard ${required}`);
});

test('production build keeps PDF tools lazy after the existing Studio', async () => {
  const build = await read('build.mjs');
  const sw = await read('web/sw.js');
  const packageJson = JSON.parse(await read('package.json'));
  for (const required of [
    '/pdf-tools.css',
    '/pdf-tools-ui.js',
    '/pdf-utility-core.mjs',
    '/pdf-page-organizer.mjs',
    '/pdf-worker.js',
    '/pdf-tool-runtime.mjs',
    '/ripscan-project.mjs',
    '/roundtrip-export.mjs',
    'ripscan-pwa-v5.0.0',
    'PDF Tools v4.0.1 runtime guard',
    'Performance Runtime v5.0.0',
  ]) assert.ok(build.includes(required), `missing build asset ${required}`);
  assert.ok(build.indexOf("'/pdf-tools-ui.js'") < build.indexOf("'/document-studio.js'"), 'lazy catalog keeps PDF Tools dependency order');
  assert.ok(sw.includes('ripscan-pwa-v5.0.0'));
  for (const required of ["'/document-studio.js'", "'/pdf-tools-ui.js'", "'/pdf-worker.js'", "'/roundtrip-export.mjs'"]) assert.ok(sw.includes(required), `missing PWA lazy asset ${required}`);
  assert.equal(packageJson.version, '5.0.0');
  for (const required of ['pdf-utility-core.mjs', 'pdf-page-organizer.mjs', 'pdf-worker.js', 'pdf-tool-runtime.mjs', 'ripscan-project.mjs', 'roundtrip-export.mjs', 'pdf-tools-ui.js']) assert.ok(packageJson.scripts.check.includes(required), `missing syntax check ${required}`);
});
