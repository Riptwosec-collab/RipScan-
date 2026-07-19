import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CircuitBreaker,
  OCR_LIMITS,
  concurrencyFor,
  gibberishAssessment,
  maxVariantsFor,
  progressivePercent,
  shouldOcrRegion,
  stableRegionHash,
  textEvidence,
  variantPlan,
  withTimeout,
} from '../web/ocr-performance-core.mjs';

test('desktop uses at most two workers and mobile uses one', () => {
  assert.deepEqual(concurrencyFor({ hardwareConcurrency: 8, deviceMemory: 16, screenWidth: 1440, pointerCoarse: false }), { mobile: false, ocrWorkers: 2, preprocessWorkers: 2 });
  assert.deepEqual(concurrencyFor({ hardwareConcurrency: 4, deviceMemory: 4, screenWidth: 390, pointerCoarse: true }), { mobile: true, ocrWorkers: 1, preprocessWorkers: 1 });
});

test('adaptive variants never create every variant for every region', () => {
  assert.deepEqual(variantPlan({ regionType: 'text' }, 'fast'), ['original', 'upscale2']);
  assert.deepEqual(variantPlan({ regionType: 'text', saraAmSuspected: true }, 'retry'), ['upscale4', 'small_mark']);
  assert.equal(maxVariantsFor({ regionType: 'text' }), 2);
  assert.equal(maxVariantsFor({ regionType: 'text', brokenSaraAm: true }), 4);
  assert.equal(maxVariantsFor({ regionType: 'text', decorativeFont: true }), 5);
  assert.equal(maxVariantsFor({ regionType: 'illustration' }), 0);
});

test('cover illustration and ornament are blocked before OCR', () => {
  const art = shouldOcrRegion({ regionType: 'illustration', zone: 'top_illustration' }, { isCover: true });
  const ornament = shouldOcrRegion({ regionType: 'ornament', zone: 'main_title' }, { isCover: true });
  assert.equal(art.allow, false);
  assert.equal(ornament.allow, false);
});

test('text needs at least two independent evidence signals unless explicitly text', () => {
  const weak = textEvidence({ width: 20, height: 20, baselineEvidence: .1 });
  assert.equal(weak.passes, false);
  const strong = textEvidence({ width: 200, height: 30, baselineEvidence: .6, connectedComponentScore: .7 });
  assert.equal(strong.passes, true);
  assert.equal(shouldOcrRegion({ regionType: 'unknown', width: 200, height: 30, baselineEvidence: .6, connectedComponentScore: .7 }, {}).allow, true);
});

test('gibberish from image regions is rejected but low confidence text remains reviewable', () => {
  const imageNoise = gibberishAssessment('| - TR uf 3 @ |', { regionType: 'illustration', confidence: .12, hasBaseline: false });
  assert.equal(imageNoise.hardReject, true);
  assert.equal(imageNoise.gibberish, true);
  const lowText = gibberishAssessment('โรงเรียนภูเก็ตวิทยาลัย', { regionType: 'text', confidence: .30, hasBaseline: true });
  assert.equal(lowText.hardReject, false);
});

test('duplicate OCR key is stable and changes by variant language or box', () => {
  const base = { fileHash: 'abc', pageNumber: 1, bbox: { left: 10, top: 20, width: 100, height: 30 }, variant: 'original', language: 'tha' };
  assert.equal(stableRegionHash(base), stableRegionHash({ ...base }));
  assert.notEqual(stableRegionHash(base), stableRegionHash({ ...base, variant: 'upscale4' }));
  assert.notEqual(stableRegionHash(base), stableRegionHash({ ...base, bbox: { ...base.bbox, left: 11 } }));
});

test('circuit breaker opens and half-opens after cooldown', () => {
  let now = 1000;
  const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 500, now: () => now });
  breaker.failure();
  assert.equal(breaker.state, 'closed');
  breaker.failure();
  assert.equal(breaker.state, 'open');
  assert.equal(breaker.canRun(), false);
  now += 501;
  assert.equal(breaker.canRun(), true);
  assert.equal(breaker.state, 'half_open');
  breaker.success();
  assert.equal(breaker.state, 'closed');
});

test('timeout stops stalled provider instead of waiting forever', async () => {
  let timedOut = false;
  await assert.rejects(() => withTimeout(() => new Promise(() => {}), 10, () => { timedOut = true; }), /OCR_TIMEOUT/);
  assert.equal(timedOut, true);
});

test('progress stages are monotonic and worker limits match spec', () => {
  const values = [
    progressivePercent('document_type', 1, 1),
    progressivePercent('region_detection', 1, 1),
    progressivePercent('fast_pass', 1, 1),
    progressivePercent('retry', 1, 1),
    progressivePercent('sara_am', 1, 1),
    progressivePercent('merge', 1, 1),
  ];
  for (let index = 1; index < values.length; index += 1) assert.ok(values[index] >= values[index - 1]);
  assert.equal(OCR_LIMITS.fastPassMaxSide, 2200);
  assert.equal(OCR_LIMITS.regionTimeoutMs, 15_000);
  assert.equal(OCR_LIMITS.retryTimeoutMs, 20_000);
  assert.equal(OCR_LIMITS.watchdogMs, 10_000);
});
