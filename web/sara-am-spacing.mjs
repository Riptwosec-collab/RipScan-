export const SARA_AM_SPACING_VERSION = '2.0.0';

const THAI_CONSONANT = '[ก-ฮ]';
const THAI_MARKS = '[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]*';
const BROKEN_SPACING = new RegExp(`(${THAI_CONSONANT})(${THAI_MARKS})(\\s{1,3})(?:ํ\\s*)?า`, 'gu');
const BROKEN_COMPOSED_SPACING = new RegExp(`(${THAI_CONSONANT})(${THAI_MARKS})(\\s{1,3})ำ`, 'gu');
const DECOMPOSED_SARA_AM = /ํ\s*า/gu;
const THAI_WORD = /[ก-๙]+/gu;

const SARA_AM_WORDS = new Set([
  'ดำเนินการ', 'ดำเนินงาน', 'จำนวน', 'สำนักงาน', 'คำแนะนำ', 'ชำนาญ', 'สำคัญ',
  'กำหนด', 'ตำแหน่ง', 'สำเร็จ', 'อำเภอ', 'สำหรับ', 'ลำดับ', 'นำเสนอ', 'จำเป็น',
  'อำนาจ', 'กำลัง', 'บำรุง', 'คุณธรรม', 'วัฒนธรรม', 'ธรรมาภิบาล', 'คำสั่ง',
]);

const PLAIN_CONFUSIONS = Object.freeze({
  'การนาเสนอ': ['การนำเสนอ'],
  'การดาเนินงาน': ['การดำเนินงาน'],
  'การดาเนินการ': ['การดำเนินการ'],
  'จานวน': ['จำนวน'],
  'สานักงาน': ['สำนักงาน'],
  'คาแนะนา': ['คำแนะนำ'],
  'ชานาญ': ['ชำนาญ'],
  'สาคัญ': ['สำคัญ'],
  'กาหนด': ['กำหนด'],
  'ตาแหน่ง': ['ตำแหน่ง'],
  'สาเร็จ': ['สำเร็จ'],
  'อาเภอ': ['อำเภอ'],
  'สาหรับ': ['สำหรับ'],
  'ลาดับ': ['ลำดับ'],
});

const clamp01 = value => Math.max(0, Math.min(1, Number(value || 0)));

export function classifyThaiGap(gap, medianCharacterWidth) {
  const width = Math.max(0.0001, Number(medianCharacterWidth || 1));
  const ratio = Math.max(0, Number(gap || 0)) / width;
  if (ratio < 0.35) return { type: 'internal_grapheme_gap', ratio };
  if (ratio < 0.75) return { type: 'internal_word_gap', ratio };
  return { type: 'word_space', ratio };
}

export function saraAmCropPadding(bbox = {}) {
  const width = Math.max(1, Number(bbox.width || 1));
  const height = Math.max(1, Number(bbox.height || 1));
  return {
    top: Math.max(6, Math.round(height * 0.30)),
    bottom: Math.max(4, Math.round(height * 0.15)),
    left: Math.max(4, Math.round(width * 0.15)),
    right: Math.max(4, Math.round(width * 0.15)),
  };
}

function isProperNounContext(evidence = {}) {
  return evidence.properNoun === true
    || ['person_name', 'school_name', 'organization_name', 'place_name'].includes(evidence.type)
    || /(?:นาย|นาง|นางสาว|โรงเรียน|วิทยาลัย|มหาวิทยาลัย|สำนักงาน|จังหวัด|อำเภอ)/u.test(String(evidence.context || ''));
}

function graphemeLooksValid(text) {
  const marksWithoutBase = /(?:^|[^ก-ฮ])[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/u.test(text);
  const duplicateTone = /[่้๊๋]{2,}/u.test(text);
  return !marksWithoutBase && !duplicateTone;
}

function candidateDictionarySupport(candidate) {
  const words = String(candidate || '').match(THAI_WORD) || [];
  return words.some(word => SARA_AM_WORDS.has(word)) || [...SARA_AM_WORDS].some(word => String(candidate || '').includes(word));
}

function safeAutoFixAllowed(candidate, evidence = {}) {
  const votes = Number(evidence.variantVotes?.[candidate] ?? evidence.variantVotes ?? 0);
  const imageEvidence = clamp01(evidence.imageEvidence?.[candidate] ?? evidence.imageEvidence);
  const bboxSupport = evidence.bboxSupport === true || clamp01(evidence.bboxSupport) >= 0.98;
  const dictionarySupport = evidence.dictionarySupport?.[candidate] === true || candidateDictionarySupport(candidate);
  const syllableValid = evidence.syllableValid !== false;
  const providerAgreement = clamp01(evidence.providerAgreement?.[candidate] ?? evidence.providerAgreement);
  const confidence = clamp01(evidence.confidence?.[candidate] ?? evidence.confidence);
  return votes >= 2
    && imageEvidence >= 0.98
    && bboxSupport
    && dictionarySupport
    && graphemeLooksValid(candidate)
    && syllableValid
    && providerAgreement >= 0.66
    && confidence >= 0.98
    && !isProperNounContext(evidence);
}

function surroundingToken(text, start, end) {
  let left = start;
  let right = end;
  while (left > 0 && /[ก-๙]/u.test(text[left - 1])) left -= 1;
  while (right < text.length && /[ก-๙]/u.test(text[right])) right += 1;
  return { start: left, end: right, text: text.slice(left, right) };
}

function spacingIssues(text, pattern, evidence) {
  const issues = [];
  for (const match of text.matchAll(pattern)) {
    const full = match[0];
    const consonant = match[1];
    const marks = match[2] || '';
    const start = Number(match.index || 0);
    const end = start + full.length;
    const token = surroundingToken(text, start, end);
    const replacement = `${consonant}${marks}ำ`;
    const candidateText = `${text.slice(0, start)}${replacement}${text.slice(end)}`;
    const gapInfo = classifyThaiGap(
      Number(evidence.gaps?.[start] ?? evidence.gap ?? 0),
      Number(evidence.medianCharacterWidth || 1),
    );
    issues.push({
      type: 'broken_sara_am',
      detectedPattern: 'broken_sara_am_spacing',
      start,
      end,
      raw: full,
      token: token.text,
      replacement,
      candidateText,
      candidateToken: `${token.text.slice(0, start - token.start)}${replacement}${token.text.slice(end - token.start)}`,
      gap: gapInfo,
      reason: 'thai_consonant_space_sara_am_pattern',
      requiresImageCheck: true,
    });
  }
  return issues;
}

function applyAllSpacingCandidates(text, issues) {
  let output = text;
  for (const issue of [...issues].filter(item => item.start !== undefined).sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, issue.start)}${issue.replacement}${output.slice(issue.end)}`;
  }
  return output;
}

export function buildBrokenSaraAmCandidates(value, evidence = {}) {
  const rawText = String(value ?? '');
  const normalizedUnicode = rawText.replace(DECOMPOSED_SARA_AM, 'ำ').normalize('NFC');
  const issues = [
    ...spacingIssues(normalizedUnicode, BROKEN_SPACING, evidence),
    ...spacingIssues(normalizedUnicode, BROKEN_COMPOSED_SPACING, evidence),
  ].sort((a, b) => a.start - b.start);

  if (!issues.some(issue => issue.type === 'broken_sara_am')) {
    const compact = normalizedUnicode.replace(/\s+/gu, '');
    for (const [confusion, candidates] of Object.entries(PLAIN_CONFUSIONS)) {
      if (!compact.includes(confusion)) continue;
      for (const candidate of candidates) {
        issues.push({
          type: 'possible_missing_sara_am',
          detectedPattern: 'plain_sara_aa_confusion',
          raw: confusion,
          candidateText: normalizedUnicode.includes(confusion) ? normalizedUnicode.replace(confusion, candidate) : candidate,
          candidateToken: candidate,
          replacement: candidate,
          reason: 'dictionary_supported_confusion_requires_image',
          requiresImageCheck: true,
        });
      }
    }
  }

  const combinedCandidate = applyAllSpacingCandidates(normalizedUnicode, issues.filter(issue => issue.type === 'broken_sara_am'));
  return {
    rawText,
    normalizedUnicode,
    issues,
    combinedCandidate,
    candidates: [...new Set([combinedCandidate, ...issues.map(issue => issue.candidateText)].filter(candidate => candidate && candidate !== normalizedUnicode))],
  };
}

export function analyzeBrokenSaraAm(value, evidence = {}) {
  const built = buildBrokenSaraAmCandidates(value, evidence);
  const decisions = built.issues.map(issue => {
    const candidate = issue.type === 'broken_sara_am' ? built.combinedCandidate : issue.candidateText;
    const autoFix = safeAutoFixAllowed(candidate, evidence);
    return {
      ...issue,
      candidate,
      autoFix,
      status: autoFix ? 'auto_fixed' : 'review_required',
      confidence: autoFix ? 0.99 : Math.min(0.97, clamp01(evidence.confidence?.[candidate] ?? evidence.confidence ?? 0.5)),
      reasons: autoFix
        ? ['two_or_more_variants_agree', 'image_evidence_high', 'bbox_support', 'valid_thai_grapheme', 'dictionary_support']
        : ['broken_grapheme_detected', 'image_confirmation_required'],
    };
  });
  const spacingDecisions = decisions.filter(decision => decision.type === 'broken_sara_am');
  const allSpacingSafe = spacingDecisions.length > 0 && spacingDecisions.every(decision => decision.autoFix);
  let correctedText = allSpacingSafe ? built.combinedCandidate : built.normalizedUnicode;
  const safePlain = decisions.find(decision => decision.type === 'possible_missing_sara_am' && decision.autoFix);
  if (!spacingDecisions.length && safePlain) correctedText = safePlain.candidate;

  const unicodeChanged = built.rawText !== built.normalizedUnicode;
  const unresolved = decisions.filter(decision => !decision.autoFix);
  return {
    rawText: built.rawText,
    normalizedText: built.normalizedUnicode,
    correctedText,
    unicodeChanged,
    normalizationType: unicodeChanged ? 'sara_am_unicode_normalization' : null,
    decisions,
    candidates: built.candidates,
    requiresReview: unresolved.length > 0,
    issueCount: decisions.length,
    safeFixCount: decisions.filter(decision => decision.autoFix).length,
    reviewCount: unresolved.length,
    saraAmConfidence: unresolved.length ? Math.min(0.95, clamp01(evidence.confidence ?? 0.5)) : clamp01(evidence.confidence ?? 1),
  };
}

export function createSaraAmReviewItem(value, evidence = {}) {
  const analysis = analyzeBrokenSaraAm(value, evidence);
  if (!analysis.issueCount) return null;
  return {
    type: 'broken_sara_am',
    rawText: analysis.rawText,
    normalizedText: analysis.normalizedText,
    suggestedText: analysis.correctedText !== analysis.normalizedText ? analysis.correctedText : analysis.candidates[0] || analysis.normalizedText,
    confidence: analysis.saraAmConfidence,
    requiresReview: analysis.requiresReview,
    reasons: analysis.decisions.flatMap(decision => decision.reasons),
    cropPadding: saraAmCropPadding(evidence.bbox || {}),
    variants: ['Original', 'Upscale 4x', 'Upscale 6x', 'CLAHE', 'Mild Sharpen', 'Thin-stroke Preservation', 'Small-dot Preservation', 'Soft Adaptive Threshold', 'Background Flattening', 'Top-padded Crop'],
  };
}

function levenshtein(a, b) {
  const left = [...String(a ?? '')];
  const right = [...String(b ?? '')];
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[right.length];
}

export function calculateSaraAmSpacingMetrics(predicted, groundTruth, reviewDecisions = []) {
  const prediction = String(predicted ?? '');
  const truth = String(groundTruth ?? '');
  const truthBrokenOpportunities = (truth.match(/ำ/gu) || []).length;
  const predictedBroken = buildBrokenSaraAmCandidates(prediction).issues.filter(issue => issue.type === 'broken_sara_am').length;
  const truthWords = truth.trim() ? truth.trim().split(/\s+/u) : [];
  const predictedWords = prediction.trim() ? prediction.trim().split(/\s+/u) : [];
  const fixedCorrectly = reviewDecisions.filter(item => item.result === 'correct').length;
  const notFixed = reviewDecisions.filter(item => item.result === 'not_fixed').length;
  const fixedWrong = reviewDecisions.filter(item => item.result === 'wrong').length;
  const sentToReview = reviewDecisions.filter(item => item.status === 'review_required').length;
  return {
    saraAmSpacingErrorRate: truthBrokenOpportunities ? predictedBroken / truthBrokenOpportunities : 0,
    brokenSaraAmDetectionAccuracy: reviewDecisions.length ? reviewDecisions.filter(item => item.detected === true).length / reviewDecisions.length : 1,
    saraAmRecoveryAccuracy: fixedCorrectly + fixedWrong ? fixedCorrectly / (fixedCorrectly + fixedWrong) : 1,
    falseSaraAmMergeRate: reviewDecisions.length ? fixedWrong / reviewDecisions.length : 0,
    thaiGraphemeInternalSpaceError: predictedBroken,
    thaiCer: truth.length ? levenshtein(prediction, truth) / truth.length : 0,
    thaiWer: truthWords.length ? levenshtein(predictedWords, truthWords) / truthWords.length : 0,
    counts: { fixedCorrectly, notFixed, fixedWrong, sentToReview },
  };
}

export function saraAmDictionaryHas(value) {
  return SARA_AM_WORDS.has(String(value || ''));
}
