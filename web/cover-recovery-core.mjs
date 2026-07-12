export const COVER_RECOVERY_VERSION = '2.0.0';

export const REVIEW_FIRST_STATUSES = Object.freeze([
  'verified',
  'review_required',
  'possible_text',
  'likely_non_text',
  'confirmed_non_text',
]);

export const REVIEW_FIRST_THRESHOLDS = Object.freeze({
  verifiedText: 0.88,
  possibleText: 0.45,
  confirmedNonText: 0.15,
  decorativeFontPossible: 0.30,
  smallTextPossible: 0.25,
});

export const COVER_ZONE_ORDER = Object.freeze([
  'top_illustration',
  'main_title',
  'subtitle',
  'class_level',
  'author_name',
  'school_name',
  'organization_name',
  'footer_text',
]);

const COVER_TYPES = new Set(['cover_page', 'worksheet_cover', 'book_cover', 'poster', 'certificate_cover', 'illustrated_document']);
const TEXT_ZONES = new Set(COVER_ZONE_ORDER.filter(zone => zone !== 'top_illustration'));
const PROTECTED_TYPES = new Set(['person_name', 'school_name', 'organization_name', 'class_level']);

const clamp01 = value => Math.max(0, Math.min(1, Number(value || 0)));
const bool = value => value === true || Number(value || 0) > 0;

export function coverZoneForBox(bbox = {}, page = {}) {
  const height = Math.max(1, Number(page.height || 1));
  const top = Number(bbox.top ?? bbox.y ?? 0);
  const boxHeight = Math.max(1, Number(bbox.height || 1));
  const center = (top + boxHeight / 2) / height;
  if (center < 0.24) return 'top_illustration';
  if (center < 0.42) return 'main_title';
  if (center < 0.52) return 'subtitle';
  if (center < 0.61) return 'class_level';
  if (center < 0.71) return 'author_name';
  if (center < 0.80) return 'school_name';
  if (center < 0.92) return 'organization_name';
  return 'footer_text';
}

export function expectedCoverZones(page = {}) {
  const width = Math.max(1, Number(page.width || 1));
  const height = Math.max(1, Number(page.height || 1));
  const make = (name, top, bottom, inset = 0.08) => ({
    name,
    bbox: {
      left: Math.round(width * inset),
      top: Math.round(height * top),
      width: Math.round(width * (1 - inset * 2)),
      height: Math.max(1, Math.round(height * (bottom - top))),
    },
  });
  return [
    make('top_illustration', 0.00, 0.24, 0.04),
    make('main_title', 0.22, 0.43, 0.08),
    make('subtitle', 0.40, 0.53, 0.10),
    make('class_level', 0.50, 0.62, 0.10),
    make('author_name', 0.59, 0.72, 0.10),
    make('school_name', 0.69, 0.81, 0.08),
    make('organization_name', 0.78, 0.93, 0.06),
    make('footer_text', 0.90, 1.00, 0.04),
  ];
}

export function collectTextEvidence(features = {}, context = {}) {
  const zone = context.zone || features.zone || coverZoneForBox(features.bbox || {}, context.page || {});
  const bbox = features.bbox || {};
  const width = Number(bbox.width || features.width || 0);
  const height = Math.max(1, Number(bbox.height || features.height || 1));
  const aspect = width / height;
  const checks = {
    baseline: clamp01(features.baselineEvidence ?? features.baselineScore) >= 0.34,
    glyphPattern: clamp01(features.glyphAlignment) >= 0.30 || Number(features.glyphCount || 0) >= 2,
    horizontalComponents: clamp01(features.connectedComponentScore) >= 0.24 || clamp01(features.horizontalComponentScore) >= 0.30,
    ocrCandidate: Number(features.ocrCandidateCount || 0) > 0 || bool(features.hasOcrCandidate),
    thaiScript: clamp01(features.thaiScriptConfidence ?? features.thaiScriptScore) >= 0.10 || bool(features.hasThaiCandidate),
    heightConsistency: clamp01(features.heightConsistency) >= 0.30,
    spacingConsistency: clamp01(features.spacingConsistency) >= 0.26,
    expectedPosition: TEXT_ZONES.has(zone) || bool(features.positionPrior),
    foregroundContrast: clamp01(features.foregroundContrast ?? features.colorContrast) >= 0.16,
    lineLikeBox: aspect >= 1.8 || bool(features.lineLikeBox),
  };
  const passed = Object.entries(checks).filter(([, value]) => value).map(([key]) => key);
  return { zone, checks, passed, count: passed.length };
}

function nonTextConsensus(features = {}) {
  const glyphCount = Number(features.glyphCount || 0);
  const componentScore = clamp01(features.connectedComponentScore);
  const checks = {
    clearObject: clamp01(features.objectScore) >= 0.78 || bool(features.clearObject),
    photograph: clamp01(features.photoScore ?? features.texture) >= 0.74 && clamp01(features.colorVariance) >= 0.55,
    ornament: clamp01(features.ornamentScore) >= 0.78,
    frame: clamp01(features.frameScore) >= 0.78,
    noBaseline: clamp01(features.baselineEvidence ?? features.baselineScore) <= 0.12,
    noGlyphs: glyphCount <= 1 && componentScore <= 0.15,
    noCandidate: Number(features.ocrCandidateCount || 0) === 0 && !bool(features.hasOcrCandidate),
  };
  const passed = Object.entries(checks).filter(([, value]) => value).map(([key]) => key);
  return { checks, passed, count: passed.length };
}

export function classifyReviewFirstRegion(features = {}, context = {}) {
  const barcodeScore = clamp01(features.barcodeScore);
  const qrScore = clamp01(features.qrScore);
  if (barcodeScore >= 0.72 || qrScore >= 0.72) {
    return {
      status: 'confirmed_non_text',
      regionType: qrScore > barcodeScore ? 'qr_code' : 'barcode',
      action: 'barcode_reader',
      confidence: Math.max(barcodeScore, qrScore),
      requiresReview: false,
      textEvidence: collectTextEvidence(features, context),
      reasons: ['machine_readable_code'],
    };
  }

  if (features.userConfirmedNonText === true || features.confirmedNonText === true) {
    return {
      status: 'confirmed_non_text',
      regionType: features.regionType || 'illustration',
      action: 'skip_text_ocr',
      confidence: 1,
      requiresReview: false,
      textEvidence: collectTextEvidence(features, context),
      reasons: ['user_or_detector_confirmed_non_text'],
    };
  }

  const evidence = collectTextEvidence(features, context);
  const nonText = nonTextConsensus(features);
  const textScore = clamp01(
    clamp01(features.textRegionConfidence ?? features.regionConfidence ?? features.textLineScore) * 0.42
    + clamp01(features.ocrConfidence ?? features.confidence) * 0.20
    + Math.min(1, evidence.count / 6) * 0.28
    + clamp01(features.foregroundContrast ?? features.colorContrast) * 0.10,
  );
  const decorative = bool(features.decorativeFont) || clamp01(features.decorativeFontScore) >= 0.35 || clamp01(features.shadowScore) >= 0.35;
  const smallText = bool(features.smallText) || Number(features.estimatedTextHeight || Infinity) < 14;
  const possibleThreshold = decorative
    ? REVIEW_FIRST_THRESHOLDS.decorativeFontPossible
    : smallText
      ? REVIEW_FIRST_THRESHOLDS.smallTextPossible
      : REVIEW_FIRST_THRESHOLDS.possibleText;

  if (textScore >= REVIEW_FIRST_THRESHOLDS.verifiedText && evidence.count >= 3) {
    return { status: 'verified', regionType: 'text', action: 'text_ocr', confidence: textScore, requiresReview: false, textEvidence: evidence, reasons: [] };
  }
  if ((decorative || smallText) && textScore >= possibleThreshold && textScore < REVIEW_FIRST_THRESHOLDS.verifiedText) {
    return {
      status: 'possible_text',
      regionType: 'text',
      action: 'secondary_text_detection',
      confidence: textScore,
      requiresReview: true,
      textEvidence: evidence,
      reasons: decorative ? ['decorative_text_candidate'] : ['small_text_candidate'],
    };
  }
  if (textScore >= REVIEW_FIRST_THRESHOLDS.possibleText && evidence.count >= 2) {
    return { status: 'review_required', regionType: 'text', action: 'text_ocr', confidence: textScore, requiresReview: true, textEvidence: evidence, reasons: ['confidence_below_verified_threshold'] };
  }
  if (textScore >= possibleThreshold || evidence.count >= 2 || evidence.checks.ocrCandidate || evidence.checks.thaiScript) {
    return {
      status: 'possible_text',
      regionType: 'text',
      action: 'secondary_text_detection',
      confidence: Math.max(textScore, possibleThreshold),
      requiresReview: true,
      textEvidence: evidence,
      reasons: decorative ? ['decorative_text_candidate'] : smallText ? ['small_text_candidate'] : ['partial_text_evidence'],
    };
  }

  const canConfirmNonText = textScore < REVIEW_FIRST_THRESHOLDS.confirmedNonText
    && evidence.count === 0
    && nonText.count >= 3
    && nonText.checks.noCandidate
    && nonText.checks.noGlyphs;
  if (canConfirmNonText) {
    return {
      status: 'confirmed_non_text',
      regionType: features.regionType || (nonText.checks.ornament ? 'ornament' : nonText.checks.frame ? 'decorative_frame' : nonText.checks.photograph ? 'photograph' : 'illustration'),
      action: 'skip_text_ocr',
      confidence: Math.max(0.85, 1 - textScore),
      requiresReview: false,
      textEvidence: evidence,
      nonTextEvidence: nonText,
      reasons: ['multi_pass_non_text_consensus'],
    };
  }
  return {
    status: 'likely_non_text',
    regionType: features.regionType || 'unknown',
    action: 'secondary_text_detection',
    confidence: Math.max(0.2, 1 - textScore),
    requiresReview: true,
    textEvidence: evidence,
    nonTextEvidence: nonText,
    reasons: ['non_text_not_confirmed'],
  };
}

export function needsCoverRecovery(documentType, blocks = []) {
  if (!COVER_TYPES.has(documentType)) return { required: false, reasons: [], missingZones: [] };
  const textBlocks = blocks.filter(block => !['confirmed_non_text', 'rejected_as_non_text'].includes(block.status) && (block.regionType || 'text') === 'text');
  const zones = new Set(textBlocks.map(block => block.zone || coverZoneForBox(block.bbox || {}, block.page || {})));
  const missingZones = ['main_title', 'class_level', 'author_name', 'school_name', 'organization_name'].filter(zone => !zones.has(zone));
  const reasons = [];
  if (textBlocks.length < 3) reasons.push('cover_has_fewer_than_three_text_blocks');
  if (!zones.has('main_title')) reasons.push('main_title_missing');
  if (!zones.has('school_name') && !zones.has('organization_name')) reasons.push('bottom_identity_text_missing');
  return { required: reasons.length > 0, reasons, missingZones, detectedTextBlocks: textBlocks.length };
}

export function buildCoverRecoveryPlan(page = {}, blocks = [], documentType = 'cover_page') {
  const recovery = needsCoverRecovery(documentType, blocks);
  if (!recovery.required) return { ...recovery, zones: [] };
  const expected = expectedCoverZones(page);
  const requested = new Set(recovery.missingZones);
  if (recovery.detectedTextBlocks < 3) ['main_title', 'subtitle', 'class_level', 'author_name', 'school_name', 'organization_name', 'footer_text'].forEach(zone => requested.add(zone));
  return {
    ...recovery,
    zones: expected.filter(zone => requested.has(zone.name)).map(zone => ({
      ...zone,
      language: 'tha',
      ocrMode: ['main_title', 'subtitle'].includes(zone.name) ? 'decorative_line' : ['organization_name', 'footer_text'].includes(zone.name) ? 'small_text_lines' : 'single_line',
      variants: ['Original', 'Padded Crop', 'Upscale 4x', 'Upscale 6x', 'Color Isolation', 'Grayscale', 'CLAHE', 'Background Removal', 'Edge-preserving Sharpen', 'Soft Binary Mask'],
    })),
  };
}

export function reviewAwareOutput(blocks = [], options = {}) {
  const includeMarkers = options.includeMarkers !== false;
  const ordered = [...blocks].sort((a, b) => Number(a.bbox?.top || 0) - Number(b.bbox?.top || 0) || Number(a.bbox?.left || 0) - Number(b.bbox?.left || 0));
  const lines = [];
  for (const block of ordered) {
    const status = block.userConfirmed ? 'verified' : (block.status || (block.requiresReview ? 'review_required' : 'verified'));
    const text = String(block.confirmedText ?? block.text ?? '').trim();
    if (!text || status === 'confirmed_non_text') continue;
    if (status === 'verified') lines.push(text);
    else if (status === 'review_required') lines.push(includeMarkers ? `[โปรดตรวจสอบ: ${text}]` : text);
    else if (status === 'possible_text') lines.push(includeMarkers ? `[อาจเป็นข้อความ: ${text}]` : text);
    else if (status === 'likely_non_text') lines.push(includeMarkers ? `[อาจพลาดข้อความ: ${text}]` : text);
  }
  return lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function filterReviewFirstOutput(blocks = []) {
  const verified = [];
  const review = [];
  const possible = [];
  const likelyNonText = [];
  const confirmedNonText = [];
  for (const block of blocks) {
    const status = block.userConfirmed ? 'verified' : (block.status || 'review_required');
    const enriched = { ...block, status };
    if (status === 'verified') verified.push(enriched);
    else if (status === 'review_required') review.push(enriched);
    else if (status === 'possible_text') possible.push(enriched);
    else if (status === 'likely_non_text') likelyNonText.push(enriched);
    else confirmedNonText.push(enriched);
  }
  return { verified, review, possible, likelyNonText, confirmedNonText };
}

export function calculateRecoveryMetrics(beforeBlocks = [], afterBlocks = [], expectedTexts = []) {
  const textOf = blocks => blocks.filter(block => block.status !== 'confirmed_non_text').map(block => String(block.text || '').trim()).filter(Boolean);
  const before = textOf(beforeBlocks);
  const after = textOf(afterBlocks);
  const normalize = value => String(value || '').replace(/\s+/gu, '').normalize('NFC');
  const expected = expectedTexts.map(normalize);
  const found = (values, target) => values.some(value => normalize(value).includes(target) || target.includes(normalize(value)));
  const recovered = expected.filter(target => !found(before, target) && found(after, target));
  const stillMissing = expected.filter(target => !found(after, target));
  return {
    beforeTextBlockCount: before.length,
    afterTextBlockCount: after.length,
    recoveredBlockCount: recovered.length,
    recoveredTexts: recovered,
    stillMissing,
    expectedRecallBefore: expected.length ? expected.filter(target => found(before, target)).length / expected.length : 1,
    expectedRecallAfter: expected.length ? expected.filter(target => found(after, target)).length / expected.length : 1,
    statusCounts: Object.fromEntries(REVIEW_FIRST_STATUSES.map(status => [status, afterBlocks.filter(block => block.status === status).length])),
  };
}

export function isProtectedCoverText(type) {
  return PROTECTED_TYPES.has(type);
}
