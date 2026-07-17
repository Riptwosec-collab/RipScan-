import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTPUT_MODES,
  REVIEW_STATUSES,
  buildCleanExportText,
  buildExportPreview,
  buildJsonExportPayload,
  createReviewRecord,
  detectGibberish,
  filterExportBlocks,
  migrateLegacyReviewMarkers,
  sanitizeDocumentModelForExport,
  sanitizeTextForExport,
  stripReviewMarkers,
  suggestDomainCandidate,
  validatePhoneNumber,
} from '../web/ocr-output-cleaner.mjs';

function textBlock(text, review = {}) {
  return {
    id: Math.random().toString(36),
    type: 'text',
    text,
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    metadata: { review },
  };
}

function model(blocks) {
  return { pages: [{ width: 100, height: 100, blocks }] };
}

test('Review Marker is not stored in migrated text', () => {
  const migrated = migrateLegacyReviewMarkers('[โปรดตรวจสอบ: ติดต่อเจ้าหน้าที RDNOC]');
  assert.equal(migrated.text, 'ติดต่อเจ้าหน้าที RDNOC');
  assert.equal(migrated.status, REVIEW_STATUSES.REVIEW_REQUIRED);
  assert.ok(!migrated.text.includes('[โปรดตรวจสอบ:'));
});

test('clean copy has no review marker', () => {
  assert.equal(stripReviewMarkers('[โปรดตรวจสอบ: ติดต่อเจ้าหน้าที่ RDNOC]'), 'ติดต่อเจ้าหน้าที่ RDNOC');
  assert.ok(!sanitizeTextForExport('[โปรดตรวจสอบ: ติดต่อเจ้าหน้าที่ RDNOC]').includes('[โปรดตรวจสอบ:'));
});

test('clean copy has no possible text marker', () => {
  assert.equal(stripReviewMarkers('[อาจเป็นข้อความ: เบอร์ 02-123-4567]'), 'เบอร์ 02-123-4567');
});

test('verified block is exported', () => {
  const block = textBlock('ระบบ e-Smart Office', { status: 'verified', confirmed: true, includeInExport: true });
  assert.equal(buildCleanExportText(model([block])), 'ระบบ e-Smart Office');
});

test('unconfirmed review block is not exported', () => {
  const block = textBlock('ติดต่อเจ้าหน้าที่ RDNOC', { status: 'review_required', confirmed: false, includeInExport: false });
  assert.equal(buildCleanExportText(model([block])), '');
});

test('confirmed review block is exported', () => {
  const block = textBlock('ติดต่อเจ้าหน้าที RDNOC', { status: 'review_required', confirmed: true, includeInExport: true, candidate: 'ติดต่อเจ้าหน้าที่ RDNOC' });
  assert.equal(buildCleanExportText(model([block])), 'ติดต่อเจ้าหน้าที่ RDNOC');
});

test('possible text is not exported by default', () => {
  const block = textBlock('เบอร บ2 2/2 0950691-54', { status: 'possible_text' });
  assert.equal(buildCleanExportText(model([block])), '');
});

test('gibberish is not exported by default', () => {
  const block = textBlock('ดดตอเจาหนาท “บพบยบ', { status: 'gibberish' });
  assert.equal(buildCleanExportText(model([block])), '');
});

test('include unverified uses raw text without marker', () => {
  const block = textBlock('[โปรดตรวจสอบ: ติดต่อเจ้าหน้าที่ RDNOC]', { status: 'review_required', confirmed: false });
  const output = buildCleanExportText(model([block]), { mode: OUTPUT_MODES.INCLUDE_UNVERIFIED });
  assert.equal(output, 'ติดต่อเจ้าหน้าที่ RDNOC');
});

test('legacy marker migration handles possible text', () => {
  const migrated = migrateLegacyReviewMarkers('[อาจเป็นข้อความ: เบอร บ2 2/2 0950691-54]');
  assert.equal(migrated.status, REVIEW_STATUSES.POSSIBLE_TEXT);
  assert.equal(migrated.includeInExport, false);
});

test('domain dictionary fixes เจ้าหน้าที', () => {
  const result = suggestDomainCandidate('ติดต่อเจ้าหน้าที RDNOC');
  assert.equal(result.candidate, 'ติดต่อเจ้าหน้าที่ RDNOC');
});

test('domain dictionary removes known noise before e-Smart Office', () => {
  const result = suggestDomainCandidate('- [แทเล]ระบบ e-Smart Office');
  assert.equal(result.candidate, 'ระบบ e-Smart Office');
});

test('phone validator accepts supported Thai phone formats', () => {
  assert.equal(validatePhoneNumber('02-123-4567').valid, true);
  assert.equal(validatePhoneNumber('081-234-5678').valid, true);
  assert.equal(validatePhoneNumber('094-359-3926').valid, true);
  assert.equal(validatePhoneNumber('0950691154').valid, true);
});

test('phone validator flags malformed OCR phone', () => {
  const result = validatePhoneNumber('เบอร บ2 2/2 0950691-54');
  assert.equal(result.valid, false);
  assert.equal(result.issueType, 'invalid_phone_pattern');
});

test('gibberish classifier rejects severe Thai noise', () => {
  const result = detectGibberish('ดดตอเจาหนาท “บพบยบ', { confidence: 0.28, providerAgreement: 0.2 });
  assert.equal(result.status, REVIEW_STATUSES.GIBBERISH);
});

test('invalid phone OCR is possible_text, not normal review', () => {
  const result = createReviewRecord({ text: '[อาจเป็นข้อความ: เบอร บ2 2/2 0950691-54]', confidence: 0.38 });
  assert.equal(result.status, REVIEW_STATUSES.POSSIBLE_TEXT);
  assert.equal(result.issueType, 'possible_gibberish');
  const direct = detectGibberish('เบอร บ2 2/2 0950691-54', { confidence: 0.38 });
  assert.equal(direct.issueType, 'invalid_phone_pattern');
});

test('export preview counts included and filtered blocks', () => {
  const preview = buildExportPreview(model([
    textBlock('A', { status: 'verified', confirmed: true }),
    textBlock('B', { status: 'review_required', confirmed: true, includeInExport: true }),
    textBlock('C', { status: 'review_required', confirmed: false }),
    textBlock('D', { status: 'possible_text' }),
    textBlock('E', { status: 'gibberish' }),
  ]));
  assert.deepEqual({ total: preview.total, ready: preview.ready, excluded: preview.excluded }, { total: 5, ready: 2, excluded: 3 });
  assert.equal(preview.possibleText, 1);
  assert.equal(preview.gibberish, 1);
});

test('JSON can preserve metadata while clean formats remove markers', () => {
  const source = model([textBlock('[โปรดตรวจสอบ: ติดต่อเจ้าหน้าที่ RDNOC]', { status: 'review_required', confidence: 0.72 })]);
  const json = buildJsonExportPayload(source, { mode: OUTPUT_MODES.INCLUDE_UNVERIFIED, includeReviewMetadata: true });
  assert.equal(json.pages[0].blocks[0].text, 'ติดต่อเจ้าหน้าที่ RDNOC');
  assert.equal(json.pages[0].blocks[0].metadata.review.status, 'review_required');
  const clean = sanitizeDocumentModelForExport(source, { mode: OUTPUT_MODES.INCLUDE_UNVERIFIED, includeReviewMetadata: false });
  assert.equal(clean.pages[0].blocks[0].metadata?.review, undefined);
});

test('filterExportBlocks never adds UI labels to text', () => {
  const block = textBlock('ติดต่อเจ้าหน้าที่ RDNOC', { status: 'review_required', confirmed: true, candidate: 'ติดต่อเจ้าหน้าที่ RDNOC' });
  const result = filterExportBlocks([block]);
  assert.equal(result.included[0].text, 'ติดต่อเจ้าหน้าที่ RDNOC');
  assert.ok(!result.included[0].text.includes('โปรดตรวจสอบ'));
});
