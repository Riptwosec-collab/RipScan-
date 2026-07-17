import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { applyNamingRule, createRedactionReport, redactBlock, validateField } from '../web/quality-core.mjs';
import { createImageBlock, createTableBlock, createTableCell, documentToPlainText, normalizeDocumentModel } from '../web/document-model.mjs';
import { collectSearchableTextLayer } from '../web/editor-export.mjs';

test('ambiguous OCR digits are candidates and never silently normalized', () => {
  const result = validateField('O81-598-2746', 'phone');
  assert.equal(result.valid, false);
  assert.equal(result.normalizedValue, 'O81-598-2746');
  assert.ok(result.candidateValues.includes('081-598-2746'));
});

test('filename rule removes reserved path characters', () => {
  assert.equal(applyNamingRule('{project}/{originalName}', { project: 'A:B', originalName: 'x?.pdf' }), 'A-B-x-.pdf');
});

test('redaction removes text and metadata content from export model', () => {
  const source = { pages: [{ blocks: [{ id: 'secret', text: 'private', metadata: { candidates: ['private'] } }] }], reviewIssues: [] };
  const output = redactBlock(source, 'secret');
  assert.equal(JSON.stringify(output).includes('private'), false);
});

test('redaction removes image payloads and plain-text export skips all redacted content', () => {
  const source = {
    pages: [{ blocks: [
      createImageBlock({ id: 'scan', src: 'data:image/png;base64,PRIVATE_IMAGE', alt: 'private alt' }),
      { id: 'secret-text', type: 'text', text: 'private text', x: 0, y: 0, width: 20, height: 20, metadata: { candidates: ['private text'] } },
    ] }],
    reviewIssues: [{ blockId: 'scan', text: 'private alt' }],
  };
  const imageRedacted = redactBlock(source, 'scan');
  const output = redactBlock(imageRedacted, 'secret-text');
  assert.equal(JSON.stringify(output).includes('PRIVATE_IMAGE'), false);
  assert.equal(JSON.stringify(output).includes('private alt'), false);
  assert.equal(JSON.stringify(output).includes('private text'), false);
  assert.equal(documentToPlainText(output).includes('private'), false);
});

test('redaction audit report contains geometry but never removed content', () => {
  const redacted = redactBlock({ id: 'doc-1', pages: [{ number: 1, blocks: [{ id: 'secret', type: 'text', text: 'classified', value: '', x: 10, y: 20, width: 30, height: 40, metadata: {} }] }], reviewIssues: [] }, 'secret');
  const report = createRedactionReport(redacted);
  assert.equal(report.redactionCount, 1);
  assert.equal(report.containsRedactedText, false);
  assert.equal(JSON.stringify(report).includes('classified'), false);
  assert.deepEqual([report.entries[0].x, report.entries[0].y], [10, 20]);
});

test('redacted table cells are scrubbed during normalization and never enter PDF text layer', () => {
  const table = createTableBlock({ rows: 1, columns: 1, cells: [createTableCell({ row: 0, column: 0, text: 'SECRET', redacted: true, metadata: { candidates: ['SECRET'] } })] });
  const model = normalizeDocumentModel({ version: '3.3.0', pages: [{ width: 100, height: 100, blocks: [table] }] });
  const cell = model.pages[0].blocks[0].cells[0];
  assert.equal(cell.text, '');
  assert.equal(JSON.stringify(cell.metadata).includes('SECRET'), false);
  assert.equal(collectSearchableTextLayer(model.pages[0], true).length, 0);
});

test('contaminated and possible issue text is excluded from direct PDF by default', () => {
  const page = { blocks: [
    { id: 'ok', type: 'text', text: 'verified', x: 0, y: 0, width: 10, height: 10, reviewStatus: 'verified' },
    { id: 'bad', type: 'text', text: 'contaminated', x: 0, y: 20, width: 10, height: 10, reviewStatus: 'contaminated' },
    { id: 'issue', type: 'text', text: 'issue', x: 0, y: 40, width: 10, height: 10, reviewStatus: 'possible_issue' },
  ] };
  assert.deepEqual(collectSearchableTextLayer(page).map(item => item.text), ['verified']);
});

test('deployment defines restrictive baseline headers', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const headers = Object.fromEntries(config.headers[0].headers.map(item => [item.key, item.value]));
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/u);
  assert.equal(headers['X-Frame-Options'], 'DENY');
});
