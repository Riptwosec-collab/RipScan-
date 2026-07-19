export const OCR_PERFORMANCE_VERSION = '2.2.0';

export const OCR_LIMITS = Object.freeze({
  fastPassMaxSide: 2200,
  fastPageDpi: 180,
  retryPageDpi: 300,
  regionTimeoutMs: 15_000,
  retryTimeoutMs: 20_000,
  pageTimeoutMs: 60_000,
  watchdogMs: 10_000,
  progressThrottleMs: 160,
  maxRetry: 1,
  maxHistory: 80,
});

export const NON_TEXT_TYPES = new Set([
  'illustration', 'character_art', 'animal', 'animal_art', 'ship', 'ship_art',
  'logo', 'emblem', 'icon', 'badge', 'decorative_frame', 'ornament',
  'background_shape', 'photograph', 'cartoon', 'separator',
]);

const clamp01 = value => Math.max(0, Math.min(1, Number(value || 0)));
const normalize = value => String(value || '').replace(/\r\n?/g, '\n').trim();

export function isMobileProfile(profile = {}) {
  const memory = Number(profile.deviceMemory || 0);
  const cores = Number(profile.hardwareConcurrency || 2);
  const width = Number(profile.screenWidth || 0);
  const coarse = profile.pointerCoarse === true;
  return coarse || (width > 0 && width < 820) || (memory > 0 && memory <= 4) || cores <= 2;
}

export function concurrencyFor(profile = {}) {
  const mobile = isMobileProfile(profile);
  return Object.freeze({
    mobile,
    ocrWorkers: mobile ? 1 : 2,
    preprocessWorkers: mobile ? 1 : 2,
  });
}

export function textEvidence(region = {}) {
  const flags = {
    baseline: clamp01(region.baselineEvidence) >= 0.35,
    horizontalGlyphs: clamp01(region.horizontalGlyphScore ?? region.glyphAlignment) >= 0.35,
    connectedComponents: clamp01(region.connectedComponentScore) >= 0.35,
    regularSpacing: clamp01(region.spacingConsistency) >= 0.35,
    scriptCandidate: Boolean(region.hasThaiCandidate || region.hasLatinCandidate || region.scriptCandidate),
    detectorCandidate: Boolean(region.hasOcrCandidate || Number(region.ocrCandidateCount || 0) > 0),
    lineAspect: Number(region.width || region.bbox?.width || 0) >= Math.max(20, Number(region.height || region.bbox?.height || 1) * 1.35),
    foregroundContrast: clamp01(region.foregroundContrast) >= 0.28,
  };
  const count = Object.values(flags).filter(Boolean).length;
  return { flags, count, passes: count >= 2 };
}

export function shouldOcrRegion(region = {}, context = {}) {
  const type = String(region.regionType || region.type || 'unknown').toLowerCase();
  const cover = context.isCover === true;
  const topIllustration = cover && String(region.zone || '') === 'top_illustration' && region.manualTextRegion !== true;
  if (NON_TEXT_TYPES.has(type) || topIllustration || region.doNotEmitTokens === true) {
    return { allow: false, reason: topIllustration ? 'cover_top_illustration' : `non_text_${type}`, evidence: textEvidence(region) };
  }
  const evidence = textEvidence(region);
  if (type === 'text' && evidence.count >= 1) return { allow: true, reason: 'explicit_text', evidence };
  if (evidence.passes) return { allow: true, reason: 'multi_signal_text_evidence', evidence };
  return { allow: false, reason: 'insufficient_text_evidence', evidence };
}

export function variantPlan(region = {}, phase = 'fast') {
  if (NON_TEXT_TYPES.has(String(region.regionType || region.type || '').toLowerCase())) return [];
  const small = region.smallText === true || Number(region.estimatedTextHeight || 99) < 14;
  const decorative = region.decorativeFont === true || ['main_title', 'subtitle'].includes(region.zone);
  const saraAm = region.brokenSaraAm === true || region.saraAmSuspected === true;
  if (phase === 'fast') return ['original', 'upscale2'];
  if (saraAm) return ['upscale4', 'small_mark'];
  if (decorative) return ['upscale4', 'clahe', 'color_isolation'].slice(0, 3);
  if (small) return ['upscale4', 'small_mark'];
  return ['upscale4', 'clahe'];
}

export function maxVariantsFor(region = {}) {
  if (NON_TEXT_TYPES.has(String(region.regionType || region.type || '').toLowerCase())) return 0;
  if (region.decorativeFont === true || ['main_title', 'subtitle'].includes(region.zone)) return 5;
  if (region.lowConfidence === true || region.brokenSaraAm === true || region.saraAmSuspected === true) return 4;
  return 2;
}

export function countScriptSwitches(value) {
  const text = normalize(value);
  let previous = '';
  let switches = 0;
  for (const character of text) {
    const script = /[ก-๙]/u.test(character) ? 'th' : /[A-Za-z]/u.test(character) ? 'en' : /[0-9๐-๙]/u.test(character) ? 'num' : '';
    if (!script) continue;
    if (previous && previous !== script) switches += 1;
    previous = script;
  }
  return switches;
}

export function gibberishAssessment(value, options = {}) {
  const text = normalize(value);
  if (!text) return { gibberish: false, score: 0, reasons: [] };
  const chars = [...text].filter(character => !/\s/u.test(character));
  const symbols = chars.filter(character => /[^\p{L}\p{N}]/u.test(character)).length;
  const symbolRatio = chars.length ? symbols / chars.length : 0;
  const switches = countScriptSwitches(text);
  const confidence = clamp01(options.confidence);
  const regionType = String(options.regionType || 'text').toLowerCase();
  const hasPattern = /(?:ISBN|https?:\/\/|[\w.+-]+@[\w.-]+|\d{2}[./:-]\d{2}|[A-Z]{2,}-\d+)/iu.test(text);
  const thaiSyllable = /[ก-ฮ][ะ-ูเ-ไำ][ก-ฮ]?/u.test(text) || /[ก-ฮ]{2,}/u.test(text);
  const englishWord = /\b[A-Za-z]{2,}\b/u.test(text);
  const reasons = [];
  if (symbolRatio > 0.30) reasons.push('symbol_ratio_over_30_percent');
  if (switches >= 4 && !hasPattern) reasons.push('excessive_script_switches');
  if (!thaiSyllable && !englishWord && !hasPattern && chars.length >= 3) reasons.push('no_valid_language_or_format_pattern');
  if (confidence > 0 && confidence < 0.35) reasons.push('confidence_below_035');
  if (NON_TEXT_TYPES.has(regionType)) reasons.push('non_text_region');
  if (options.hasBaseline === false) reasons.push('missing_baseline');
  if (options.exceedsBoundingBox === true) reasons.push('text_exceeds_bounding_box');
  const score = clamp01(reasons.length / 4 + symbolRatio * 0.45);
  const hardReject = NON_TEXT_TYPES.has(regionType) || options.doNotEmitTokens === true;
  return { gibberish: hardReject || reasons.length >= 2, hardReject, score, reasons };
}

export function stableRegionHash(input = {}) {
  const bbox = input.bbox || {};
  const raw = [
    input.fileHash || input.fileName || 'job',
    Number(input.pageNumber || 1),
    Math.round(Number(bbox.left ?? bbox.x ?? 0)),
    Math.round(Number(bbox.top ?? bbox.y ?? 0)),
    Math.round(Number(bbox.width || 0)),
    Math.round(Number(bbox.height || 0)),
    input.variant || 'original',
    input.language || 'tha',
  ].join('|');
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `r${(hash >>> 0).toString(16)}`;
}

export class CircuitBreaker {
  constructor({ failureThreshold = 3, cooldownMs = 30_000, now = () => Date.now() } = {}) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.state = 'closed';
    this.failures = 0;
    this.openedAt = 0;
  }
  canRun() {
    if (this.state !== 'open') return true;
    if (this.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'half_open';
      return true;
    }
    return false;
  }
  success() {
    this.state = 'closed';
    this.failures = 0;
  }
  failure() {
    this.failures += 1;
    if (this.state === 'half_open' || this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }
  snapshot() { return { state: this.state, failures: this.failures, openedAt: this.openedAt }; }
}

export function createJobMetrics(seed = {}) {
  return {
    startedAt: Number(seed.startedAt || Date.now()),
    finishedAt: 0,
    regionsDetected: 0,
    regionsOcr: 0,
    regionsSkipped: 0,
    retries: 0,
    variantsCreated: 0,
    cacheHits: 0,
    workerRestarts: 0,
    timedOut: 0,
    cancelled: false,
    completedPages: 0,
    mainThreadLongTaskMs: 0,
    peakMemoryBytes: null,
  };
}

export function finishJobMetrics(metrics, now = Date.now()) {
  return {
    ...metrics,
    finishedAt: now,
    durationMs: Math.max(0, now - Number(metrics.startedAt || now)),
  };
}

export function progressivePercent(stage, completed = 0, total = 1) {
  const ratio = Math.max(0, Math.min(1, Number(completed || 0) / Math.max(1, Number(total || 1))));
  const ranges = {
    document_type: [0.01, 0.06],
    region_detection: [0.06, 0.18],
    fast_pass: [0.18, 0.68],
    retry: [0.68, 0.90],
    sara_am: [0.90, 0.96],
    merge: [0.96, 1],
  };
  const [start, end] = ranges[stage] || [0, 1];
  return start + (end - start) * ratio;
}

export async function withTimeout(factory, timeoutMs, onTimeout) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(factory),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          const error = new Error('OCR_TIMEOUT');
          error.code = 'OCR_TIMEOUT';
          reject(error);
        }, Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
