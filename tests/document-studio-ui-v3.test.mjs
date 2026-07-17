import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Document Studio exposes visual and structured editable views', async () => {
  const source = await read('web/document-studio.js');
  for (const required of [
    'Document Studio', 'data-studio-view="visual"', 'data-studio-view="structure"', 'contenteditable',
    'studio-block-handle', 'studio-resize-handle', 'addTableRow', 'addTableColumn',
    'mergeTableCells', 'splitTableCell', 'undo()', 'redo()', 'indexedDB.open',
  ]) assert.ok(source.includes(required), `missing ${required}`);
});

test('Document Studio imports Office files and intercepts them before plain OCR', async () => {
  const source = await read('web/document-studio.js');
  for (const required of [
    'FILE_ACCEPT', '.docx', '.xlsx', '.pptx', 'importStructuredFile',
    "event.target.id !== 'fileInput'", 'event.stopImmediatePropagation()',
    'เปิดแก้ไขแบบต้นฉบับ', 'modelFromResultCard',
  ]) assert.ok(source.includes(required), `missing ${required}`);
});

test('existing Convert Center still supports PDF JPG PNG resize quality and page options', async () => {
  const source = await read('web/document-studio.js');
  for (const required of [
    'Convert Center', 'searchable-pdf', '<option value="png">PNG</option>', '<option value="jpg">JPG</option>',
    'convertWidth', 'convertHeight', 'convertKeepAspect', 'convertDpi', 'convertQuality',
    'convertPageSize', 'convertOrientation', 'runConversion', 'cancel-task',
  ]) assert.ok(source.includes(required), `missing ${required}`);
});

test('Document Studio CSS provides three-panel WYSIWYG layout and responsive UI', async () => {
  const css = await read('web/document-studio.css');
  for (const required of [
    'grid-template-columns: 210px minmax(0, 1fr) 300px', '.studio-page-canvas',
    '.studio-properties-panel', '.studio-editable-table', '.convert-center-shell',
    '@media (max-width: 820px)', '@media (max-width: 560px)', '@media (prefers-reduced-motion: reduce)',
  ]) assert.ok(css.includes(required), `missing ${required}`);
});

test('production build keeps existing Studio Table-first PDF Tools and adds patch history virtualization', async () => {
  const build = await read('build.mjs');
  for (const required of [
    '/document-studio.css', '/document-studio.js', '/document-model.mjs', '/office-import.mjs',
    '/editor-export.mjs', '/table-review-v31.css', '/table-review-v312.js',
    '/table-reconstruction-core.mjs', '/table-reconstruction-worker.js',
    '/pdf-tools.css', '/pdf-tools-ui.js', '/pdf-worker.js', '/roundtrip-export.mjs',
    '/document-patch-history.mjs', '/studio-virtualization.mjs',
    'ripscan-pwa-v5.0.0', 'Table-first Reconstruction v3.1.2',
  ]) assert.ok(build.includes(required), `missing ${required}`);
  const packageJson = JSON.parse(await read('package.json'));
  assert.equal(packageJson.version, '5.0.0');
  for (const required of ['document-model.mjs', 'document-patch-history.mjs', 'office-import.mjs', 'editor-export.mjs', 'document-studio.js', 'studio-virtualization.mjs', 'table-reconstruction-core.mjs', 'table-reconstruction-worker.js', 'table-review-v312.js', 'pdf-tools-ui.js']) assert.ok(packageJson.scripts.check.includes(required), `missing check ${required}`);
});
