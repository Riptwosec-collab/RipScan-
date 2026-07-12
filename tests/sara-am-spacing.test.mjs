import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeBrokenSaraAm,
  buildBrokenSaraAmCandidates,
  calculateSaraAmSpacingMetrics,
  classifyThaiGap,
  saraAmCropPadding,
} from '../web/sara-am-spacing.mjs';

const cases = [
  ['การน าเสนอ', 'การนำเสนอ'],
  ['การด าเนินงาน', 'การดำเนินงาน'],
  ['จ านวน', 'จำนวน'],
  ['ส านักงาน', 'สำนักงาน'],
  ['ค าแนะน า', 'คำแนะนำ'],
  ['ช านาญ', 'ชำนาญ'],
  ['ส าคัญ', 'สำคัญ'],
  ['ก าหนด', 'กำหนด'],
  ['ต าแหน่ง', 'ตำแหน่ง'],
  ['ส าเร็จ', 'สำเร็จ'],
  ['อ าเภอ', 'อำเภอ'],
  ['ส าหรับ', 'สำหรับ'],
  ['ล าดับ', 'ลำดับ'],
];

test('detects Broken Sara Am spacing and proposes whole-word reconstruction', () => {
  for (const [raw, expected] of cases) {
    const result = buildBrokenSaraAmCandidates(raw, { gap: 2, medianCharacterWidth: 10 });
    assert.ok(result.issues.some(issue => issue.type === 'broken_sara_am'), `not detected: ${raw}`);
    assert.equal(result.combinedCandidate, expected, raw);
    assert.ok(result.candidates.includes(expected), raw);
  }
});

test('decomposed Sara Am Unicode is normalized safely', () => {
  const result = analyzeBrokenSaraAm('จํานวน', { confidence: 1 });
  assert.equal(result.normalizedText, 'จำนวน');
  assert.equal(result.unicodeChanged, true);
  assert.equal(result.requiresReview, false);
});

test('spaced composed Sara Am is detected', () => {
  const result = buildBrokenSaraAmCandidates('การน ำเสนอ');
  assert.equal(result.combinedCandidate, 'การนำเสนอ');
  assert.ok(result.issues.some(issue => issue.detectedPattern === 'broken_sara_am_spacing'));
});

test('safe auto-fix requires image evidence and agreement', () => {
  const raw = 'การน าเสนอ';
  const candidate = 'การนำเสนอ';
  const unsafe = analyzeBrokenSaraAm(raw, { confidence: .99 });
  assert.equal(unsafe.correctedText, raw);
  assert.equal(unsafe.requiresReview, true);

  const safe = analyzeBrokenSaraAm(raw, {
    confidence: { [candidate]: .99 },
    variantVotes: { [candidate]: 2 },
    imageEvidence: { [candidate]: .99 },
    providerAgreement: { [candidate]: .8 },
    bboxSupport: true,
    dictionarySupport: { [candidate]: true },
    syllableValid: true,
  });
  assert.equal(safe.correctedText, candidate);
  assert.equal(safe.requiresReview, false);
  assert.equal(safe.safeFixCount, 1);
});

test('proper names are never auto-fixed silently', () => {
  const candidate = 'สำนักงาน';
  const result = analyzeBrokenSaraAm('ส านักงาน', {
    confidence: { [candidate]: .99 },
    variantVotes: { [candidate]: 3 },
    imageEvidence: { [candidate]: 1 },
    providerAgreement: { [candidate]: 1 },
    bboxSupport: true,
    dictionarySupport: { [candidate]: true },
    syllableValid: true,
    type: 'organization_name',
    properNoun: true,
  });
  assert.equal(result.correctedText, 'ส านักงาน');
  assert.equal(result.requiresReview, true);
});

test('plain valid words are not changed to Sara Am automatically', () => {
  for (const word of ['นา', 'ดา', 'ลา', 'อา', 'ตา']) {
    const result = analyzeBrokenSaraAm(word, {
      confidence: 1,
      variantVotes: 4,
      imageEvidence: 1,
      providerAgreement: 1,
      bboxSupport: true,
    });
    assert.equal(result.correctedText, word);
    assert.equal(result.issueCount, 0);
  }
});

test('gap classifier separates grapheme word and normal spaces', () => {
  assert.equal(classifyThaiGap(3, 10).type, 'internal_grapheme_gap');
  assert.equal(classifyThaiGap(6, 10).type, 'internal_word_gap');
  assert.equal(classifyThaiGap(8, 10).type, 'word_space');
});

test('Sara Am crop keeps larger top padding for the small dot', () => {
  const padding = saraAmCropPadding({ width: 100, height: 40 });
  assert.equal(padding.top, 12);
  assert.equal(padding.bottom, 6);
  assert.equal(padding.left, 15);
  assert.equal(padding.right, 15);
  assert.ok(padding.top > padding.bottom);
});

test('metrics report fixed review and false-merge counts', () => {
  const metrics = calculateSaraAmSpacingMetrics('การนำเสนอ', 'การนำเสนอ', [
    { detected: true, result: 'correct', status: 'auto_fixed' },
    { detected: true, result: 'not_fixed', status: 'review_required' },
  ]);
  assert.equal(metrics.saraAmSpacingErrorRate, 0);
  assert.equal(metrics.brokenSaraAmDetectionAccuracy, 1);
  assert.equal(metrics.falseSaraAmMergeRate, 0);
  assert.equal(metrics.counts.fixedCorrectly, 1);
  assert.equal(metrics.counts.notFixed, 1);
  assert.equal(metrics.counts.sentToReview, 1);
});
