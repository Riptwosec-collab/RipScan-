import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectBrokenInternalThaiSpace,
  resolveSaraAmAcrossVariants,
  saraAmRecoveryMetrics,
} from '../web/sara-am-recovery-v21.mjs';

const cases = [
  ['บทร าพัน', 'บทรำพัน'],
  ['การน าเสนอ', 'การนำเสนอ'],
  ['ค าแนะน า', 'คำแนะนำ'],
  ['ส านักงาน', 'สำนักงาน'],
  ['จ านวน', 'จำนวน'],
  ['ส าคัญ', 'สำคัญ'],
];

test('detects all required Broken Sara Am internal spaces', () => {
  for (const [raw] of cases) {
    const detected = detectBrokenInternalThaiSpace(raw);
    assert.equal(detected.detected, true, raw);
    assert.ok(detected.matches.length >= 1, raw);
  }
});

test('proposes the correct whole-word Sara Am candidate', () => {
  for (const [raw, expected] of cases) {
    const result = resolveSaraAmAcrossVariants(raw, [
      { name: 'Original', text: raw, confidence: .92 },
      { name: 'Upscale 4x', text: expected, confidence: .95 },
      { name: 'Small-dot Preservation', text: expected, confidence: .96 },
    ], { confidence: .96, bboxSupport: true, imageEvidence: .92, providerAgreement: .67 });
    assert.equal(result.type, 'broken_sara_am_review');
    assert.equal(result.suggestedText, expected, raw);
    assert.equal(result.requiresReview, true, raw);
    assert.equal(result.autoFix, false, raw);
  }
});

test('safe auto-fix requires high visual evidence and variant agreement', () => {
  const raw = 'บทร าพัน';
  const expected = 'บทรำพัน';
  const result = resolveSaraAmAcrossVariants(raw, [
    { name: 'Upscale 4x', text: expected, confidence: .99 },
    { name: 'Upscale 6x', text: expected, confidence: .99 },
    { name: 'Small-dot Preservation', text: expected, confidence: .99 },
  ], { confidence: .99, bboxSupport: true, imageEvidence: .99, providerAgreement: 1 });
  assert.equal(result.autoFix, true);
  assert.equal(result.correctedText, expected);
  assert.equal(result.requiresReview, false);
});

test('proper names are never silently auto-fixed', () => {
  const result = resolveSaraAmAcrossVariants('นางสาวร าไพ', [
    { name: 'Upscale 4x', text: 'นางสาวรำไพ', confidence: .99 },
    { name: 'Upscale 6x', text: 'นางสาวรำไพ', confidence: .99 },
  ], { confidence: .99, bboxSupport: true, imageEvidence: .99, providerAgreement: 1, properNoun: true, type: 'person_name' });
  assert.equal(result.autoFix, false);
  assert.equal(result.requiresReview, true);
});

test('plain Thai words without broken spacing remain unchanged', () => {
  for (const word of ['นา', 'ดา', 'ลา', 'อา', 'ตา']) {
    const result = resolveSaraAmAcrossVariants(word, [{ text: word, confidence: .99 }], { confidence: .99, bboxSupport: true, imageEvidence: 1, providerAgreement: 1 });
    assert.equal(result.issueCount, 0, word);
    assert.equal(result.correctedText, word, word);
    assert.equal(result.autoFix, false, word);
  }
});

test('Sara Am v2.1 metrics separate recovered review and false merge', () => {
  const metrics = saraAmRecoveryMetrics([
    {
      rawText: 'บทร าพัน',
      expected: 'บทรำพัน',
      attempts: [
        { text: 'บทรำพัน', confidence: .99 },
        { text: 'บทรำพัน', confidence: .99 },
      ],
      evidence: { confidence: .99, bboxSupport: true, imageEvidence: .99, providerAgreement: 1 },
    },
    {
      rawText: 'การน าเสนอ',
      expected: 'การนำเสนอ',
      attempts: [{ text: 'การนำเสนอ', confidence: .90 }],
      evidence: { confidence: .90, bboxSupport: true, imageEvidence: .5, providerAgreement: .5 },
    },
  ]);
  assert.equal(metrics.detected, 2);
  assert.equal(metrics.recovered, 1);
  assert.equal(metrics.review, 1);
  assert.equal(metrics.falseMerge, 0);
});
