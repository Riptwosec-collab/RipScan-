import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_FIRST_THRESHOLDS,
  buildCoverRecoveryPlan,
  calculateRecoveryMetrics,
  classifyReviewFirstRegion,
  filterReviewFirstOutput,
  needsCoverRecovery,
  reviewAwareOutput,
} from '../web/cover-recovery-core.mjs';

test('review-first thresholds match recovery specification', () => {
  assert.equal(REVIEW_FIRST_THRESHOLDS.verifiedText, 0.88);
  assert.equal(REVIEW_FIRST_THRESHOLDS.possibleText, 0.45);
  assert.equal(REVIEW_FIRST_THRESHOLDS.confirmedNonText, 0.15);
  assert.equal(REVIEW_FIRST_THRESHOLDS.decorativeFontPossible, 0.30);
  assert.equal(REVIEW_FIRST_THRESHOLDS.smallTextPossible, 0.25);
});

test('strong text becomes verified', () => {
  const result = classifyReviewFirstRegion({
    textRegionConfidence: .94,
    ocrConfidence: .95,
    baselineEvidence: .88,
    connectedComponentScore: .82,
    glyphAlignment: .8,
    heightConsistency: .76,
    spacingConsistency: .72,
    glyphCount: 14,
    hasOcrCandidate: true,
    thaiScriptConfidence: .96,
    foregroundContrast: .7,
    bbox: { width: 420, height: 44 },
  }, { zone: 'main_title', page: { width: 1000, height: 1400 } });
  assert.equal(result.status, 'verified');
  assert.equal(result.action, 'text_ocr');
});

test('decorative and small text are retained as possible text', () => {
  const decorative = classifyReviewFirstRegion({
    textRegionConfidence: .31,
    ocrConfidence: .28,
    baselineEvidence: .34,
    connectedComponentScore: .28,
    glyphAlignment: .32,
    glyphCount: 4,
    hasOcrCandidate: true,
    decorativeFont: true,
    foregroundContrast: .34,
    bbox: { width: 360, height: 55 },
  }, { zone: 'main_title' });
  assert.equal(decorative.status, 'possible_text');
  assert.notEqual(decorative.action, 'skip_text_ocr');

  const small = classifyReviewFirstRegion({
    textRegionConfidence: .27,
    ocrConfidence: .24,
    baselineEvidence: .30,
    connectedComponentScore: .26,
    glyphCount: 3,
    hasThaiCandidate: true,
    smallText: true,
    estimatedTextHeight: 8,
    foregroundContrast: .24,
    bbox: { width: 300, height: 18 },
  }, { zone: 'organization_name' });
  assert.equal(small.status, 'possible_text');
});

test('only multi-pass non-text consensus becomes confirmed non-text', () => {
  const ambiguous = classifyReviewFirstRegion({
    textRegionConfidence: .08,
    baselineEvidence: .08,
    connectedComponentScore: .08,
    glyphCount: 0,
    objectScore: .65,
    texture: .6,
    colorVariance: .5,
    ocrCandidateCount: 0,
  }, { zone: 'school_name' });
  assert.equal(ambiguous.status, 'likely_non_text');
  assert.equal(ambiguous.action, 'secondary_text_detection');

  const confirmed = classifyReviewFirstRegion({
    textRegionConfidence: .02,
    baselineEvidence: .02,
    connectedComponentScore: .02,
    glyphCount: 0,
    objectScore: .92,
    texture: .88,
    colorVariance: .75,
    photoScore: .9,
    ocrCandidateCount: 0,
  }, { zone: 'top_illustration' });
  assert.equal(confirmed.status, 'confirmed_non_text');
  assert.equal(confirmed.action, 'skip_text_ocr');
});

test('cover with fewer than three blocks triggers zone recovery', () => {
  const before = [{
    id: 'one',
    type: 'person_name',
    regionType: 'text',
    status: 'review_required',
    text: 'นางสาวชญาณี จิตต์ซื่อ',
    bbox: { left: 100, top: 800, width: 500, height: 40 },
    page: { width: 1000, height: 1400 },
  }];
  const need = needsCoverRecovery('worksheet_cover', before);
  assert.equal(need.required, true);
  assert.ok(need.reasons.includes('cover_has_fewer_than_three_text_blocks'));
  const plan = buildCoverRecoveryPlan({ width: 1000, height: 1400 }, before, 'worksheet_cover');
  assert.ok(plan.zones.some(zone => zone.name === 'main_title'));
  assert.ok(plan.zones.some(zone => zone.name === 'school_name'));
  assert.ok(plan.zones.some(zone => zone.name === 'organization_name'));
});

test('regression fixture recovers at least five expected cover blocks', () => {
  const expected = [
    'ใบกิจกรรมวรรณคดี',
    'ชั้นมัธยมศึกษาปีที่ ๑',
    'นางสาวชญาณี จิตต์ซื่อ',
    'โรงเรียนภูเก็ตวิทยาลัย',
    'สำนักงานเขตพื้นที่การศึกษา มัธยมศึกษาพังงา ภูเก็ต ระนอง',
  ];
  const before = [{ text: expected[2], status: 'review_required', regionType: 'text' }];
  const after = expected.map((text, index) => ({
    text,
    status: index === 0 ? 'verified' : index < 3 ? 'review_required' : 'possible_text',
    regionType: 'text',
  }));
  const metrics = calculateRecoveryMetrics(before, after, expected);
  assert.equal(metrics.beforeTextBlockCount, 1);
  assert.equal(metrics.afterTextBlockCount, 5);
  assert.equal(metrics.recoveredBlockCount, 4);
  assert.equal(metrics.expectedRecallAfter, 1);
});

test('editor output retains review and possible text instead of discarding it', () => {
  const blocks = [
    { text: 'ใบกิจกรรมวรรณคดี', status: 'verified', bbox: { top: 10 } },
    { text: 'โรงเรียนภูเก็ตวิทยาลัย', status: 'review_required', bbox: { top: 20 } },
    { text: 'สำนักงานเขตพื้นที่การศึกษา', status: 'possible_text', bbox: { top: 30 } },
    { text: 'ลายกรอบ', status: 'confirmed_non_text', bbox: { top: 40 } },
  ];
  const output = reviewAwareOutput(blocks);
  assert.ok(output.includes('ใบกิจกรรมวรรณคดี'));
  assert.ok(output.includes('[โปรดตรวจสอบ: โรงเรียนภูเก็ตวิทยาลัย]'));
  assert.ok(output.includes('[อาจเป็นข้อความ: สำนักงานเขตพื้นที่การศึกษา]'));
  assert.ok(!output.includes('ลายกรอบ'));
  const grouped = filterReviewFirstOutput(blocks);
  assert.equal(grouped.verified.length, 1);
  assert.equal(grouped.review.length, 1);
  assert.equal(grouped.possible.length, 1);
  assert.equal(grouped.confirmedNonText.length, 1);
});
