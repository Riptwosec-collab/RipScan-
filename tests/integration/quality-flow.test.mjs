import test from 'node:test';
import assert from 'node:assert/strict';
import { collectReviewItems, computeQualityReport, redactBlock } from '../../web/quality-core.mjs';

const model = { version: '3.0.0', pages: [{ number: 1, width: 1000, height: 1400, blocks: [
  { id: 'verified', type: 'text', x: 50, y: 50, width: 400, height: 50, text: 'ข้อความถูกต้อง', confidence: .99, reviewStatus: 'verified' },
  { id: 'review', type: 'text', x: 50, y: 130, width: 400, height: 50, text: 'O81-598-2746', confidence: .62, reviewStatus: 'review_required' },
] }], reviewIssues: [{ blockId: 'review' }] };

test('document review flows into quality report and irreversible export redaction state', () => {
  assert.equal(collectReviewItems(model).length, 1);
  const report = computeQualityReport(model);
  assert.ok(report.textAccuracy > 0 && report.textAccuracy < 1);
  const redacted = redactBlock(model, 'review');
  assert.equal(redacted.pages[0].blocks[1].text, '');
  assert.equal(redacted.pages[0].blocks[1].redacted, true);
  assert.equal(redacted.reviewIssues.length, 0);
  assert.equal(model.pages[0].blocks[1].redacted, undefined, 'source model remains untouched');
});
