import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COVER_CONFIDENCE_THRESHOLDS,
  calculateCoverMetrics,
  classifyCoverDocument,
  classifyCoverRegion,
  classifyProtectedText,
  confidenceGate,
  decorativeVariantPlan,
  detectGibberish,
  evaluateTextLineEvidence,
  filterCoverOutput,
  groupCoverTextBlocks,
} from '../web/cover-ocr-rules.mjs';

test('cover classifier selects illustrated cover instead of normal document', () => {
  const result = classifyCoverDocument({ illustrationRatio: .62, photographRatio: .08, textAreaRatio: .24, titleProminence: .78, textBlockCount: 4 });
  assert.equal(result.type, 'book_cover');
  assert.ok(result.confidence > .6);
});

test('normal dense text page stays normal document', () => {
  const result = classifyCoverDocument({ illustrationRatio: .05, photographRatio: .02, decorativeRatio: .04, textAreaRatio: .78, titleProminence: .22, textBlockCount: 18, repeatedRows: 8 });
  assert.equal(result.type, 'normal_document');
});

test('text line evidence requires baseline, components, and multiple glyphs', () => {
  const accepted = evaluateTextLineEvidence({ baselineEvidence: .92, connectedComponentScore: .88, glyphAlignment: .91, heightConsistency: .9, spacingConsistency: .82, textLineScore: .9, glyphCount: 9 });
  const rejected = evaluateTextLineEvidence({ baselineEvidence: .18, connectedComponentScore: .72, glyphAlignment: .2, heightConsistency: .26, spacingConsistency: .22, textLineScore: .3, glyphCount: 1 });
  assert.equal(accepted.accepted, true);
  assert.equal(rejected.accepted, false);
});

test('clear illustration and ornament consensus are skipped before text OCR', () => {
  const illustration = classifyCoverRegion({ objectScore: .92, texture: .82, colorVariance: .76, textLineScore: .08, connectedComponentScore: .08, baselineEvidence: .05, glyphAlignment: .08, heightConsistency: .1, spacingConsistency: .1, glyphCount: 0 });
  const ornament = classifyCoverRegion({ ornamentScore: .84, curvedEdgeDensity: .88, symmetry: .74, areaRatio: .28, textLineScore: .05, connectedComponentScore: .05, baselineEvidence: .04, glyphCount: 0 });
  assert.equal(illustration.action, 'skip_text_ocr');
  assert.equal(illustration.status, 'confirmed_non_text');
  assert.equal(illustration.regionType, 'illustration');
  assert.equal(ornament.regionType, 'ornament');
  assert.equal(ornament.status, 'confirmed_non_text');
});

test('strong text region is accepted for OCR', () => {
  const result = classifyCoverRegion({ baselineEvidence: .93, connectedComponentScore: .9, glyphAlignment: .88, heightConsistency: .86, spacingConsistency: .8, textLineScore: .9, glyphCount: 12, foregroundContrast: .8 });
  assert.equal(result.regionType, 'text');
  assert.equal(result.action, 'text_ocr');
  assert.equal(result.status, 'verified');
  assert.ok(result.confidence >= .88);
});

test('gibberish detector still identifies non-text-like candidates', () => {
  for (const sample of ['| 3ร5ณส้ ๕๕ (0', 'คศั 7ฝ7@ [กงหด7', '[]++ || @#']) {
    const result = detectGibberish(sample, { confidence: .31, hasBaseline: false, boundingBoxFit: false });
    assert.equal(result.status, 'rejected_as_non_text', sample);
    assert.equal(result.rejected, true);
  }
});

test('document codes and phone numbers are not rejected as gibberish', () => {
  assert.notEqual(detectGibberish('INC-2569-001', { confidence: .94 }).status, 'rejected_as_non_text');
  assert.notEqual(detectGibberish('02-218-1000', { confidence: .94 }).status, 'rejected_as_non_text');
});

test('protected text identifies names schools class levels titles and paragraphs', () => {
  assert.equal(classifyProtectedText('นางสาวชญาณี จิตต์ซื่อ'), 'person_name');
  assert.equal(classifyProtectedText('โรงเรียนตัวอย่าง กรุงเทพมหานคร'), 'school_name');
  assert.equal(classifyProtectedText('ชั้นมัธยมศึกษาปีที่ ๑'), 'class_level');
  assert.equal(classifyProtectedText('ใบกิจกรรมวรรณคดี'), 'title');
  assert.equal(classifyProtectedText('เนื้อหายาวสำหรับอธิบายการทำงานของเอกสารในย่อหน้าและมีรายละเอียดครบถ้วน'), 'paragraph');
});

test('confidence gate is strict for names and routes low evidence to review', () => {
  assert.equal(COVER_CONFIDENCE_THRESHOLDS.protectedText, .97);
  const result = confidenceGate({ text: 'นางสาวชญาณี จิตต์ซื่อ', type: 'person_name', textRegionConfidence: .96, ocrConfidence: .93, scriptConfidence: .99, graphemeConfidence: .99, baselineEvidence: .95 });
  assert.equal(result.status, 'review_required');
  assert.equal(result.requiresReview, true);
  assert.equal(result.reviewText, '[โปรดตรวจสอบชื่อบุคคล]');
});

test('gibberish text candidate is retained for review rather than silently discarded', () => {
  const result = confidenceGate({ text: '| 3ร5ณส้ ๕๕ (0', type: 'unknown', textRegionConfidence: .94, ocrConfidence: .35, scriptConfidence: .4, graphemeConfidence: .55, baselineEvidence: .1 });
  assert.equal(result.status, 'possible_text');
  assert.equal(result.accepted, false);
  assert.equal(result.requiresReview, true);
});

test('output filter includes verified and separates review from confirmed non-text', () => {
  const result = filterCoverOutput([
    { id: 'title', text: 'ใบกิจกรรมวรรณคดี', type: 'title', regionType: 'text', textRegionConfidence: .99, ocrConfidence: .98, scriptConfidence: .99, graphemeConfidence: .99, baselineEvidence: .98 },
    { id: 'name', text: 'นางสาวชญาณี จิตต์ซื่อ', type: 'person_name', regionType: 'text', textRegionConfidence: .95, ocrConfidence: .92, scriptConfidence: .99, graphemeConfidence: .98, baselineEvidence: .95 },
    { id: 'serpent', text: '', type: 'illustration', regionType: 'illustration' },
  ]);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.review.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.accepted[0].text, 'ใบกิจกรรมวรรณคดี');
});

test('decorative Thai font plan adds large upscales and color extraction', () => {
  const plan = decorativeVariantPlan({ estimatedTextHeight: 11, colorContrast: .3, shadowScore: .7, decorativeFontScore: .8 });
  for (const required of ['Upscale 4x', 'Upscale 6x', 'Color Isolation', 'Text Mask', 'HSV Foreground Extraction']) assert.ok(plan.includes(required), required);
});

test('text blocks group only when they share a visual line', () => {
  const grouped = groupCoverTextBlocks([
    { id: 'a', text: 'ใบกิจกรรม', type: 'title', confidence: .98, bbox: { left: 10, top: 10, width: 90, height: 30 } },
    { id: 'b', text: 'วรรณคดี', type: 'title', confidence: .97, bbox: { left: 110, top: 12, width: 75, height: 29 } },
    { id: 'c', text: 'ชั้นมัธยมศึกษาปีที่ ๑', type: 'class_level', confidence: .96, bbox: { left: 10, top: 80, width: 180, height: 25 } },
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].text, 'ใบกิจกรรม วรรณคดี');
  assert.equal(grouped[1].text, 'ชั้นมัธยมศึกษาปีที่ ๑');
});

test('cover metrics calculate region and non-text performance separately', () => {
  const truth = [
    { id: 'title', type: 'title', regionType: 'text', text: 'ใบกิจกรรมวรรณคดี', bbox: { left: 10, top: 10, width: 200, height: 40 } },
    { id: 'name', type: 'person_name', regionType: 'text', text: 'นางสาวชญาณี จิตต์ซื่อ', bbox: { left: 10, top: 70, width: 240, height: 30 } },
    { id: 'art', type: 'illustration', regionType: 'illustration', bbox: { left: 260, top: 10, width: 300, height: 400 } },
    { id: 'noise', type: 'illustration', regionType: 'illustration', gibberish: true, bbox: { left: 20, top: 130, width: 80, height: 30 } },
  ];
  const predicted = [
    { id: 'title', type: 'title', regionType: 'text', text: 'ใบกิจกรรมวรรณคดี', status: 'accepted', bbox: { left: 10, top: 10, width: 200, height: 40 } },
    { id: 'name', type: 'person_name', regionType: 'text', text: 'นางสาวชญาณี จิตต์ซื่อ', status: 'manual_review', bbox: { left: 10, top: 70, width: 240, height: 30 } },
    { id: 'art', type: 'illustration', regionType: 'illustration', status: 'rejected_as_non_text', bbox: { left: 260, top: 10, width: 300, height: 400 } },
    { id: 'noise', type: 'unknown', regionType: 'unknown', status: 'rejected_as_non_text', bbox: { left: 20, top: 130, width: 80, height: 30 } },
  ];
  const metrics = calculateCoverMetrics(predicted, truth);
  assert.equal(metrics.textRegionPrecision, 1);
  assert.equal(metrics.textRegionRecall, 1);
  assert.equal(metrics.nonTextRejectionAccuracy, 1);
  assert.equal(metrics.falseTextDetectionRate, 0);
  assert.equal(metrics.gibberishRejectionRate, 1);
  assert.equal(metrics.coverTitleAccuracy, 1);
});
