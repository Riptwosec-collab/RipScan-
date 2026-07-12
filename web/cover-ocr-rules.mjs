import * as core from './cover-ocr-core.mjs';
import {
  REVIEW_FIRST_THRESHOLDS,
  classifyReviewFirstRegion,
  coverZoneForBox,
  filterReviewFirstOutput,
  isProtectedCoverText,
} from './cover-recovery-core.mjs';

export * from './cover-ocr-core.mjs';
export * from './cover-recovery-core.mjs';

const clamp01 = value => Math.max(0, Math.min(1, Number(value || 0)));
const THAI = /[ก-๙]/u;
const EXPLICIT_NON_TEXT = new Set(['image', 'logo', 'icon', 'illustration', 'photograph', 'cartoon', 'decorative_frame', 'ornament', 'background_shape']);

export function classifyCoverRegion(features = {}) {
  const ornamentScore = clamp01(features.ornamentScore);
  const curvedEdgeDensity = clamp01(features.curvedEdgeDensity);
  const symmetry = clamp01(features.symmetry);
  const areaRatio = clamp01(features.areaRatio);
  const textLineScore = clamp01(features.textLineScore);
  const connectedComponentScore = clamp01(features.connectedComponentScore);
  const inferred = {
    ...features,
    baselineEvidence: features.baselineEvidence ?? Math.min(1, textLineScore * 1.08),
    glyphAlignment: features.glyphAlignment ?? Math.min(1, textLineScore * 0.94 + connectedComponentScore * 0.18),
    heightConsistency: features.heightConsistency ?? Math.min(1, connectedComponentScore * 0.82 + textLineScore * 0.22),
    spacingConsistency: features.spacingConsistency ?? Math.min(1, textLineScore * 0.72 + connectedComponentScore * 0.24),
    glyphCount: features.glyphCount ?? Math.round(connectedComponentScore * 12),
    foregroundContrast: features.foregroundContrast ?? Math.max(textLineScore, clamp01(features.colorContrast)),
    ocrCandidateCount: features.ocrCandidateCount ?? (features.hasOcrCandidate ? 1 : 0),
  };

  if (ornamentScore >= 0.6 || (curvedEdgeDensity >= 0.7 && symmetry >= 0.45 && areaRatio >= 0.08 && textLineScore < 0.4 && connectedComponentScore < 0.4)) {
    inferred.regionType = 'ornament';
    inferred.ornamentScore = Math.max(ornamentScore, curvedEdgeDensity);
  }

  const result = classifyReviewFirstRegion(inferred, {
    zone: features.zone,
    page: features.page,
  });
  return {
    ...result,
    hasText: ['verified', 'review_required', 'possible_text'].includes(result.status),
    confidence: result.confidence,
  };
}

export function classifyProtectedText(value, box = {}, page = {}) {
  const text = String(value ?? '').trim();
  const namePrefix = /^(?:นาย|นาง|นางสาว|เด็กชาย|เด็กหญิง|ดร\.|ศ\.|รศ\.|ผศ\.)\s*/u;
  const schoolWords = /(?:โรงเรียน|มหาวิทยาลัย|วิทยาลัย|สำนักงาน|เขตพื้นที่|สถานศึกษา|ศูนย์การศึกษา|สำนักพิมพ์)/u;
  const titleWords = /(?:ใบกิจกรรม|วรรณคดี|ชั้นมัธยมศึกษา|แบบฝึกหัด|ใบงาน|บทเรียน|ประกาศ|เกียรติบัตร|หนังสือ|รายงาน)/u;
  if (!text) return 'unknown';
  if (namePrefix.test(text) && text.replace(namePrefix, '').trim().split(/\s+/u).length >= 1) return 'person_name';
  if (schoolWords.test(text)) return /โรงเรียน|สถานศึกษา/u.test(text) ? 'school_name' : 'organization_name';
  if (/^(?:ชั้น|ระดับชั้น)\s*(?:มัธยม|ประถม|อนุบาล)/u.test(text)) return 'class_level';
  if (titleWords.test(text)) return 'title';
  if (page.height && box.height) {
    const yRatio = Number(box.top || box.y || 0) / page.height;
    const heightRatio = Number(box.height || 0) / page.height;
    if (yRatio < 0.36 && heightRatio >= 0.034 && text.length <= 90) return 'title';
  }
  if (text.length >= 55 || /[.!?。！？]$/u.test(text)) return 'paragraph';
  return 'unknown';
}

export function confidenceGate(block = {}) {
  const text = String(block.text ?? '').trim();
  const type = block.type || classifyProtectedText(text, block.bbox, block.page);
  const protectedText = isProtectedCoverText(type);
  const textRegionConfidence = clamp01(block.textRegionConfidence ?? block.regionConfidence);
  const ocrConfidence = clamp01(block.ocrConfidence ?? block.confidence);
  const scriptConfidence = clamp01(block.scriptConfidence ?? block.thaiScriptConfidence ?? (THAI.test(text) ? 0.7 : 1));
  const graphemeConfidence = clamp01(block.graphemeConfidence ?? 1);
  const baselineEvidence = clamp01(block.baselineEvidence ?? block.bbox?.baselineEvidence ?? 0.5);
  const gibberish = core.detectGibberish(text, {
    confidence: ocrConfidence,
    hasBaseline: baselineEvidence >= 0.34,
    boundingBoxFit: block.boundingBoxFit !== false,
  });
  const zone = block.zone || coverZoneForBox(block.bbox || {}, block.page || {});
  const region = classifyReviewFirstRegion({
    ...block,
    bbox: block.bbox,
    zone,
    textRegionConfidence,
    ocrConfidence,
    baselineEvidence,
    glyphAlignment: block.glyphAlignment ?? Math.max(0.28, textRegionConfidence * 0.82),
    connectedComponentScore: block.connectedComponentScore ?? Math.max(0.24, textRegionConfidence * 0.76),
    heightConsistency: block.heightConsistency ?? 0.5,
    spacingConsistency: block.spacingConsistency ?? 0.5,
    glyphCount: block.glyphCount ?? Math.max(0, [...text].filter(character => /[\p{L}\p{N}]/u.test(character)).length),
    hasOcrCandidate: Boolean(text),
    ocrCandidateCount: text ? Math.max(1, Number(block.ocrCandidateCount || block.attempts?.filter(attempt => attempt.text)?.length || 1)) : 0,
    hasThaiCandidate: THAI.test(text),
    thaiScriptConfidence: scriptConfidence,
    foregroundContrast: block.foregroundContrast ?? block.colorContrast ?? (text ? 0.35 : 0),
    decorativeFont: block.decorativeFont || type === 'title',
    smallText: block.smallText || Number(block.estimatedTextHeight || Infinity) < 14,
    userConfirmedNonText: block.userConfirmedNonText || block.status === 'confirmed_non_text',
  }, { zone, page: block.page });

  const failures = [];
  if (textRegionConfidence < REVIEW_FIRST_THRESHOLDS.verifiedText) failures.push('text_region_below_verified_threshold');
  if (ocrConfidence < (protectedText ? 0.97 : REVIEW_FIRST_THRESHOLDS.verifiedText)) failures.push('ocr_confidence');
  if (scriptConfidence < (THAI.test(text) ? 0.82 : 0.68)) failures.push('script_confidence');
  if (THAI.test(text) && graphemeConfidence < 0.90) failures.push('grapheme_confidence');
  if (baselineEvidence < 0.34) failures.push('baseline_evidence');
  if (gibberish.rejected) failures.push('gibberish_candidate_requires_review');
  else if (gibberish.status === 'manual_review') failures.push('gibberish_review');

  let status = region.status;
  if (block.userConfirmed === true) status = 'verified';
  else if (status === 'verified' && failures.length) status = protectedText || gibberish.rejected ? 'review_required' : 'possible_text';
  else if (status === 'confirmed_non_text' && text.length >= 3) status = 'possible_text';
  else if (gibberish.rejected && text.length >= 3 && status !== 'confirmed_non_text') status = 'possible_text';
  if (!text && status !== 'confirmed_non_text') status = 'likely_non_text';

  const accepted = status === 'verified';
  const requiresReview = ['review_required', 'possible_text', 'likely_non_text'].includes(status);
  return {
    status,
    accepted,
    requiresReview,
    failures: [...new Set([...failures, ...(region.reasons || [])])],
    gibberish,
    type,
    zone,
    confidence: region.confidence,
    textEvidence: region.textEvidence,
    reviewText: type === 'person_name'
      ? '[โปรดตรวจสอบชื่อบุคคล]'
      : type === 'school_name'
        ? '[โปรดตรวจสอบชื่อโรงเรียน]'
        : type === 'organization_name'
          ? '[โปรดตรวจสอบชื่อหน่วยงาน]'
          : '[โปรดตรวจสอบข้อความ]',
  };
}

export function filterCoverOutput(blocks = []) {
  const normalized = blocks.map(block => {
    if (block.status && ['verified', 'review_required', 'possible_text', 'likely_non_text', 'confirmed_non_text'].includes(block.status)) return block;
    const regionType = block.regionType || block.type;
    const hasEvidence = Number.isFinite(Number(block.textRegionConfidence)) || Number.isFinite(Number(block.regionConfidence)) || Number.isFinite(Number(block.ocrConfidence)) || Number.isFinite(Number(block.confidence));
    if (EXPLICIT_NON_TEXT.has(regionType) && !String(block.text || '').trim() && !hasEvidence) {
      return { ...block, status: 'confirmed_non_text', gate: { status: 'confirmed_non_text', accepted: false, requiresReview: false, failures: [`legacy_explicit_${regionType}`] } };
    }
    const gate = block.gate || confidenceGate(block);
    return { ...block, gate, status: gate.status, type: gate.type || block.type };
  });
  const grouped = filterReviewFirstOutput(normalized);
  return {
    accepted: grouped.verified,
    review: [...grouped.review, ...grouped.possible, ...grouped.likelyNonText],
    rejected: grouped.confirmedNonText,
    possible: grouped.possible,
    likelyNonText: grouped.likelyNonText,
    confirmedNonText: grouped.confirmedNonText,
  };
}
