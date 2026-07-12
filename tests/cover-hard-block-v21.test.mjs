import test from 'node:test';
import assert from 'node:assert/strict';

import {
  coverOutputAudit,
  coverPageSanityCheck,
  hardBlockCoverBlock,
  hardBlockCoverBlocks,
  looksLikeCoverIllustrationLeak,
  strictCoverEditorOutput,
} from '../web/cover-hard-block.mjs';

const page = { width: 1000, height: 1400 };
const cover = { documentType: 'worksheet_cover', page };

test('top illustration is hard blocked and emits no OCR tokens', () => {
  const block = hardBlockCoverBlock({
    id: 'serpent-art',
    regionType: 'text',
    zone: 'top_illustration',
    text: '| CAR A\nCH ” =\n0002\n<= 5',
    bbox: { left: 80, top: 40, width: 840, height: 300 },
  }, cover);
  assert.equal(block.status, 'confirmed_non_text');
  assert.equal(block.action, 'skip_text_ocr');
  assert.equal(block.doNotEmitTokens, true);
  assert.equal(block.emitToEditor, false);
  assert.equal(block.emitToExport, false);
  assert.equal(block.text, '');
  assert.match(block.suppressedText, /CAR A/);
});

test('characters animals ships badges emblems and ornaments are hard blocked', () => {
  for (const regionType of ['character_art', 'animal_art', 'ship_art', 'badge', 'emblem', 'ornament', 'decorative_frame', 'background_shape']) {
    const block = hardBlockCoverBlock({ regionType, text: 'OCR NOISE', zone: 'main_title' }, cover);
    assert.equal(block.status, 'confirmed_non_text', regionType);
    assert.equal(block.doNotEmitTokens, true, regionType);
    assert.equal(block.text, '', regionType);
  }
});

test('real cover text outside illustration zone remains available for review', () => {
  const block = hardBlockCoverBlock({
    id: 'title',
    regionType: 'text',
    type: 'title',
    zone: 'main_title',
    text: 'ใบกิจกรรมวรรณคดี',
    status: 'review_required',
  }, cover);
  assert.equal(block.text, 'ใบกิจกรรมวรรณคดี');
  assert.equal(block.status, 'review_required');
  assert.notEqual(block.doNotEmitTokens, true);
});

test('strict cover output cannot leak illustration tokens', () => {
  const blocks = hardBlockCoverBlocks([
    { id: 'art', regionType: 'illustration', zone: 'top_illustration', text: '| - TR uf 3 @ |' },
    { id: 'title', regionType: 'text', zone: 'main_title', text: 'ใบกิจกรรมวรรณคดี', status: 'verified' },
    { id: 'class', regionType: 'text', zone: 'class_level', text: 'ชั้นมัธยมศึกษาปีที่ ๑', status: 'review_required' },
    { id: 'school', regionType: 'text', zone: 'school_name', text: 'โรงเรียนภูเก็ตวิทยาลัย', status: 'verified' },
  ], cover);
  const output = strictCoverEditorOutput(blocks);
  assert.match(output, /ใบกิจกรรมวรรณคดี/);
  assert.match(output, /ชั้นมัธยมศึกษาปีที่ ๑/);
  assert.match(output, /โรงเรียนภูเก็ตวิทยาลัย/);
  assert.doesNotMatch(output, /TR uf|CAR A|0002/);
  assert.deepEqual(coverOutputAudit(blocks), {
    blockedRegionCount: 1,
    blockedTokenCount: 7,
    outputLeakCount: 0,
    passed: true,
  });
});

test('cover sanity triggers recovery after illustration tokens are removed', () => {
  const result = coverPageSanityCheck([
    { regionType: 'text', zone: 'top_illustration', text: 'CAR A', bbox: { left: 0, top: 0, width: 900, height: 300 } },
    { regionType: 'text', zone: 'author_name', text: 'นางสาวชญาณี จิตต์ซื่อ', status: 'review_required' },
  ], cover);
  assert.equal(result.required, true);
  assert.ok(result.reasons.includes('cover_has_fewer_than_three_emittable_text_blocks'));
  assert.ok(result.reasons.includes('main_title_missing_after_hard_block'));
  assert.ok(result.reasons.includes('bottom_identity_text_missing_after_hard_block'));
  assert.equal(result.leakedTopIllustrationBlocks, 1);
});

test('cover gibberish patterns from illustrations are detected', () => {
  for (const sample of ['| CAR A', 'CH ” =', '@ @ @ 2', '<= 5', '| - TR uf 3 @ |']) {
    assert.equal(looksLikeCoverIllustrationLeak(sample), true, sample);
  }
  assert.equal(looksLikeCoverIllustrationLeak('สำนักงานเขตพื้นที่การศึกษา'), false);
});
