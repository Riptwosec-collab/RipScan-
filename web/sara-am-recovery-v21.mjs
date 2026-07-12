import {
  analyzeBrokenSaraAm,
  buildBrokenSaraAmCandidates,
  saraAmCropPadding,
} from './sara-am-spacing.mjs';

export const SARA_AM_RECOVERY_VERSION = '2.1.0';

export const SARA_AM_ACADEMIC_WORDS = Object.freeze([
  'บทรำพัน',
  'กิจกรรม',
  'วรรณคดี',
  'ชั้นมัธยมศึกษา',
  'นำเสนอ',
  'คำแนะนำ',
  'สำนักงาน',
  'จำนวน',
  'สำคัญ',
  'กำหนด',
  'ชำนาญ',
  'สำหรับ',
  'ลำดับ',
  'ตำแหน่ง',
  'สำเร็จ',
]);

const DICTIONARY = new Set(SARA_AM_ACADEMIC_WORDS);
const BROKEN_INTERNAL_SPACE = /[ก-ฮ][\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]*\s{1,3}(?:ํ\s*)?า/gu;

const clamp01 = value => Math.max(0, Math.min(1, Number(value || 0)));
const normalize = value => String(value || '').replace(/\r\n?/g, '\n').normalize('NFC').trim();

function dictionarySupport(candidate) {
  const text = normalize(candidate);
  return [...DICTIONARY].some(word => text.includes(word));
}

function confidenceOf(attempt) {
  const raw = Number(attempt?.confidence || 0);
  return raw > 1 ? clamp01(raw / 100) : clamp01(raw);
}

export function detectBrokenInternalThaiSpace(value) {
  const text = normalize(value);
  const matches = [...text.matchAll(BROKEN_INTERNAL_SPACE)].map(match => ({
    raw: match[0],
    index: match.index || 0,
    type: 'broken_internal_space_candidate',
  }));
  return { detected: matches.length > 0, matches };
}

export function collectSaraAmVariantEvidence(attempts = [], context = {}) {
  const candidateVotes = new Map();
  const candidateConfidence = new Map();
  const analyses = [];

  for (const attempt of attempts) {
    const text = normalize(attempt?.text || attempt?.rawText);
    if (!text) continue;
    const built = buildBrokenSaraAmCandidates(text, {
      bbox: context.bbox,
      gap: attempt?.gap,
      gaps: attempt?.gaps,
      medianCharacterWidth: attempt?.medianCharacterWidth,
    });
    const candidates = built.candidates.length ? built.candidates : [built.normalizedUnicode];
    analyses.push({ name: attempt?.name || 'variant', text, candidates, confidence: confidenceOf(attempt) });
    for (const candidate of candidates) {
      const normalizedCandidate = normalize(candidate);
      if (!normalizedCandidate || normalizedCandidate === text && !built.issues.length) continue;
      candidateVotes.set(normalizedCandidate, (candidateVotes.get(normalizedCandidate) || 0) + 1);
      candidateConfidence.set(normalizedCandidate, Math.max(candidateConfidence.get(normalizedCandidate) || 0, confidenceOf(attempt)));
    }
  }

  const ranked = [...candidateVotes.entries()].map(([text, votes]) => {
    const agreement = attempts.length ? votes / attempts.length : 0;
    const confidence = candidateConfidence.get(text) || 0;
    const score = votes * 0.38 + agreement * 0.28 + confidence * 0.22 + (dictionarySupport(text) ? 0.12 : 0);
    return { text, votes, agreement, confidence, dictionarySupport: dictionarySupport(text), score };
  }).sort((a, b) => b.score - a.score);

  return { analyses, ranked, totalVariants: attempts.length };
}

export function resolveSaraAmAcrossVariants(rawText, attempts = [], evidence = {}) {
  const raw = normalize(rawText);
  const base = analyzeBrokenSaraAm(raw, {
    ...evidence,
    confidence: clamp01(evidence.confidence || Math.max(0, ...attempts.map(confidenceOf))),
  });
  const variantEvidence = collectSaraAmVariantEvidence(attempts, evidence);
  const best = variantEvidence.ranked[0];
  const candidate = best?.text || base.candidates?.[0] || base.normalizedText;
  const properNoun = evidence.properNoun === true || ['person_name', 'school_name', 'organization_name', 'place_name'].includes(evidence.type);
  const bboxSupport = evidence.bboxSupport === true || clamp01(evidence.bboxSupport) >= 0.98;
  const visualSupport = best ? best.votes >= 2 && best.agreement >= 0.5 : false;
  const imageEvidence = clamp01(evidence.imageEvidence || best?.agreement || 0);
  const providerAgreement = clamp01(evidence.providerAgreement || best?.agreement || 0);
  const highConfidence = clamp01(evidence.confidence || best?.confidence || 0) >= 0.98;
  const autoFix = Boolean(
    base.issueCount
    && candidate
    && candidate !== base.normalizedText
    && visualSupport
    && imageEvidence >= 0.98
    && providerAgreement >= 0.66
    && bboxSupport
    && highConfidence
    && best?.dictionarySupport
    && !properNoun
  );

  return {
    type: 'broken_sara_am_review',
    rawText: raw,
    normalizedText: base.normalizedText,
    suggestedText: candidate,
    correctedText: autoFix ? candidate : base.normalizedText,
    autoFix,
    requiresReview: base.issueCount > 0 && !autoFix,
    issueCount: base.issueCount,
    internalSpace: detectBrokenInternalThaiSpace(raw),
    evidence: variantEvidence,
    confidence: autoFix ? 0.99 : Math.min(0.97, Math.max(base.saraAmConfidence || 0, best?.confidence || 0)),
    reasons: autoFix
      ? ['variant_agreement', 'image_evidence', 'bbox_support', 'dictionary_support', 'high_confidence']
      : base.issueCount
        ? ['broken_internal_thai_space', 'sara_am_image_confirmation_required']
        : [],
    cropPadding: saraAmCropPadding(evidence.bbox || {}),
    variants: ['Original', 'Upscale 4x', 'Upscale 6x', 'Top-padded Crop', 'CLAHE', 'Mild Sharpen', 'Small-dot Preservation', 'Soft Adaptive Threshold', 'Background Flattening', 'Grayscale'],
  };
}

export function applyConfirmedSaraAm(value, review = {}, confirmedText = '') {
  const original = normalize(value);
  const confirmed = normalize(confirmedText || review.suggestedText);
  if (!confirmed || review.userConfirmed !== true) return original;
  return confirmed;
}

export function saraAmRecoveryMetrics(cases = []) {
  const totals = { detected: 0, recovered: 0, review: 0, falseMerge: 0, unchanged: 0 };
  for (const item of cases) {
    const result = resolveSaraAmAcrossVariants(item.rawText, item.attempts || [], item.evidence || {});
    if (result.issueCount) totals.detected += 1;
    if (result.autoFix && result.correctedText === item.expected) totals.recovered += 1;
    else if (result.requiresReview) totals.review += 1;
    else totals.unchanged += 1;
    if (result.autoFix && item.expected && result.correctedText !== item.expected) totals.falseMerge += 1;
  }
  return {
    ...totals,
    detectionAccuracy: cases.length ? totals.detected / cases.length : 1,
    recoveryAccuracy: cases.length ? totals.recovered / cases.length : 1,
    falseMergeRate: cases.length ? totals.falseMerge / cases.length : 0,
  };
}
