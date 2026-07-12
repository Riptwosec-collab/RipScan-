export const COVER_OCR_VERSION = '1.9.0';

export const COVER_DOCUMENT_TYPES = Object.freeze([
  'cover_page',
  'worksheet_cover',
  'book_cover',
  'poster',
  'certificate_cover',
  'infographic',
  'illustrated_document',
  'normal_document',
]);

export const COVER_REGION_TYPES = Object.freeze([
  'text',
  'photograph',
  'illustration',
  'cartoon',
  'logo',
  'icon',
  'decorative_frame',
  'ornament',
  'separator',
  'background_shape',
  'barcode',
  'qr_code',
  'unknown',
]);

export const COVER_CONFIDENCE_THRESHOLDS = Object.freeze({
  textRegion: 0.9,
  ocr: 0.9,
  script: 0.92,
  grapheme: 0.94,
  protectedText: 0.97,
});

const THAI = /[\u0E00-\u0E7F]/u;
const THAI_LETTER = /[\u0E01-\u0E2E]/u;
const LATIN = /[A-Za-z]/;
const DIGIT = /[0-9๐-๙]/u;
const SUSPICIOUS_SYMBOL = /[|\[\]+@#{}<>\\]/u;
const DOCUMENT_CODE = /^(?:[A-Z0-9]{2,}[-_/]){1,}[A-Z0-9._/-]+$/i;
const PHONE = /^(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,3}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}$/;
const URL_OR_EMAIL = /(?:https?:\/\/|www\.|\b[^\s@]+@[^\s@]+\.[^\s@]+)/i;
const TITLE_WORDS = /(?:ใบกิจกรรม|วรรณคดี|ชั้นมัธยมศึกษา|แบบฝึกหัด|ใบงาน|บทเรียน|ประกาศ|เกียรติบัตร|หนังสือ|รายงาน)/u;
const NAME_PREFIX = /^(?:นาย|นาง|นางสาว|เด็กชาย|เด็กหญิง|ดร\.|ศ\.|รศ\.|ผศ\.)\s*/u;
const SCHOOL_WORDS = /(?:โรงเรียน|มหาวิทยาลัย|วิทยาลัย|สำนักงาน|เขตพื้นที่|สถานศึกษา|ศูนย์การศึกษา|สำนักพิมพ์)/u;
const THAI_SYLLABLE_HINT = /(?:[เแโใไ]?[ก-ฮ]+[ะาิีึืุูำไใเแโั็่้๊๋์]?|[ก-ฮ]+[รรลว][ก-ฮ]?)/u;

const clamp01 = value => Math.max(0, Math.min(1, Number(value || 0)));

function safeRatio(numerator, denominator, fallback = 0) {
  return denominator ? numerator / denominator : fallback;
}

function scriptRuns(token) {
  let previous = '';
  let runs = 0;
  for (const character of String(token ?? '')) {
    const current = THAI.test(character) ? 'thai' : LATIN.test(character) ? 'latin' : DIGIT.test(character) ? 'digit' : /\p{P}|\p{S}/u.test(character) ? 'symbol' : 'other';
    if (current === 'other') continue;
    if (current !== previous) {
      runs += 1;
      previous = current;
    }
  }
  return runs;
}

function levenshtein(leftValue, rightValue) {
  const left = Array.isArray(leftValue) ? leftValue : [...String(leftValue ?? '')];
  const right = Array.isArray(rightValue) ? rightValue : [...String(rightValue ?? '')];
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[right.length];
}

export function classifyCoverDocument(features = {}) {
  const illustrationRatio = clamp01(features.illustrationRatio);
  const photographRatio = clamp01(features.photographRatio);
  const decorativeRatio = clamp01(features.decorativeRatio);
  const textAreaRatio = clamp01(features.textAreaRatio);
  const titleProminence = clamp01(features.titleProminence);
  const textBlockCount = Math.max(0, Number(features.textBlockCount || 0));
  const repeatedRows = Math.max(0, Number(features.repeatedRows || 0));
  const certificateSignals = clamp01(features.certificateSignals);
  const infographicSignals = clamp01(features.infographicSignals);

  if (certificateSignals >= 0.72) return { type: 'certificate_cover', confidence: certificateSignals };
  if (infographicSignals >= 0.72) return { type: 'infographic', confidence: infographicSignals };
  if (illustrationRatio + photographRatio >= 0.56 && textAreaRatio <= 0.34) {
    const type = titleProminence >= 0.62 ? 'book_cover' : 'illustrated_document';
    return { type, confidence: clamp01((illustrationRatio + photographRatio) * 0.62 + titleProminence * 0.38) };
  }
  if (decorativeRatio >= 0.42 && titleProminence >= 0.54 && textBlockCount <= 12) {
    return { type: 'poster', confidence: clamp01(decorativeRatio * 0.48 + titleProminence * 0.52) };
  }
  if (titleProminence >= 0.58 && repeatedRows <= 2 && textBlockCount <= 9) {
    return { type: features.firstPage === false ? 'cover_page' : 'worksheet_cover', confidence: clamp01(titleProminence * 0.72 + (1 - textAreaRatio) * 0.28) };
  }
  return { type: 'normal_document', confidence: clamp01(0.62 + textAreaRatio * 0.28) };
}

export function evaluateTextLineEvidence(features = {}) {
  const baseline = clamp01(features.baselineEvidence ?? features.baselineScore);
  const connectedComponents = clamp01(features.connectedComponentScore);
  const glyphAlignment = clamp01(features.glyphAlignment);
  const heightConsistency = clamp01(features.heightConsistency);
  const spacingConsistency = clamp01(features.spacingConsistency);
  const textLineScore = clamp01(features.textLineScore);
  const glyphCount = Math.max(0, Number(features.glyphCount || 0));
  const glyphCountScore = glyphCount >= 4 ? 1 : glyphCount >= 2 ? 0.58 : glyphCount ? 0.24 : 0;
  const score = clamp01(
    baseline * 0.24
    + connectedComponents * 0.2
    + glyphAlignment * 0.16
    + heightConsistency * 0.14
    + spacingConsistency * 0.1
    + textLineScore * 0.1
    + glyphCountScore * 0.06,
  );
  const hasBaseline = baseline >= 0.52 || (textLineScore >= 0.66 && glyphAlignment >= 0.54);
  const hasCharacters = connectedComponents >= 0.42 && glyphCount >= 2;
  return {
    score,
    hasBaseline,
    hasCharacters,
    accepted: score >= 0.72 && hasBaseline && hasCharacters,
    components: { baseline, connectedComponents, glyphAlignment, heightConsistency, spacingConsistency, textLineScore, glyphCountScore },
  };
}

export function classifyCoverRegion(features = {}) {
  const barcodeScore = clamp01(features.barcodeScore);
  const qrScore = clamp01(features.qrScore);
  if (barcodeScore >= 0.72) return { regionType: 'barcode', action: 'barcode_reader', confidence: barcodeScore, hasText: false };
  if (qrScore >= 0.72) return { regionType: 'qr_code', action: 'barcode_reader', confidence: qrScore, hasText: false };

  const evidence = evaluateTextLineEvidence(features);
  if (evidence.accepted) {
    return { regionType: 'text', action: 'text_ocr', confidence: evidence.score, hasText: true, textEvidence: evidence };
  }

  const texture = clamp01(features.texture);
  const colorVariance = clamp01(features.colorVariance);
  const curvedEdgeDensity = clamp01(features.curvedEdgeDensity);
  const frameScore = clamp01(features.frameScore);
  const ornamentScore = clamp01(features.ornamentScore);
  const objectScore = clamp01(features.objectScore);
  const symmetry = clamp01(features.symmetry);
  const compactness = clamp01(features.compactness);
  const straightLineScore = clamp01(features.straightLineScore);
  const areaRatio = clamp01(features.areaRatio);

  if (straightLineScore >= 0.74 && evidence.score < 0.42 && areaRatio <= 0.16) {
    return { regionType: 'separator', action: 'skip_text_ocr', confidence: straightLineScore, hasText: false };
  }
  if (frameScore >= 0.64 || (curvedEdgeDensity >= 0.62 && areaRatio >= 0.18 && evidence.score < 0.44)) {
    return { regionType: 'decorative_frame', action: 'skip_text_ocr', confidence: Math.max(frameScore, curvedEdgeDensity), hasText: false };
  }
  if (ornamentScore >= 0.6 || (curvedEdgeDensity >= 0.7 && symmetry >= 0.45 && evidence.score < 0.4)) {
    return { regionType: 'ornament', action: 'skip_text_ocr', confidence: Math.max(ornamentScore, curvedEdgeDensity), hasText: false };
  }
  if (compactness >= 0.72 && symmetry >= 0.62 && areaRatio <= 0.12 && evidence.score < 0.52) {
    const regionType = features.brandLike ? 'logo' : 'icon';
    return { regionType, action: 'skip_text_ocr', confidence: clamp01(compactness * 0.52 + symmetry * 0.48), hasText: false };
  }
  if (objectScore >= 0.66 && evidence.score < 0.5) {
    const regionType = features.cartoonLike ? 'cartoon' : features.photoLike ? 'photograph' : 'illustration';
    return { regionType, action: 'skip_text_ocr', confidence: objectScore, hasText: false };
  }
  if (texture >= 0.58 && colorVariance >= 0.42 && evidence.score < 0.48) {
    return { regionType: features.photoLike ? 'photograph' : 'illustration', action: 'skip_text_ocr', confidence: clamp01(texture * 0.55 + colorVariance * 0.45), hasText: false };
  }
  if (colorVariance < 0.12 && texture < 0.12 && evidence.score < 0.3) {
    return { regionType: 'background_shape', action: 'skip_text_ocr', confidence: 0.82, hasText: false };
  }
  return { regionType: 'unknown', action: 'manual_review', confidence: clamp01(Math.max(0.35, evidence.score)), hasText: false, textEvidence: evidence };
}

export function detectGibberish(value, options = {}) {
  const text = String(value ?? '').trim();
  const confidence = clamp01(options.confidence ?? 1);
  if (!text) return { status: 'rejected_as_non_text', rejected: true, score: 1, reasons: ['empty_text'] };
  if (DOCUMENT_CODE.test(text) || PHONE.test(text) || URL_OR_EMAIL.test(text)) {
    return { status: confidence >= 0.72 ? 'accepted' : 'manual_review', rejected: false, score: confidence >= 0.72 ? 0 : 0.35, reasons: confidence >= 0.72 ? [] : ['low_confidence_protected_pattern'] };
  }

  const characters = [...text].filter(character => !/\s/u.test(character));
  const symbols = characters.filter(character => /\p{P}|\p{S}/u.test(character));
  const symbolRatio = safeRatio(symbols.length, characters.length);
  const tokens = text.split(/\s+/u).filter(Boolean);
  const suspiciousTokens = tokens.filter(token => scriptRuns(token) >= 4 || (SUSPICIOUS_SYMBOL.test(token) && token.length <= 9));
  const thaiTokens = tokens.filter(token => THAI.test(token));
  const englishTokens = tokens.filter(token => LATIN.test(token) && !THAI.test(token));
  const thaiSyllableRate = thaiTokens.length ? thaiTokens.filter(token => THAI_SYLLABLE_HINT.test(token)).length / thaiTokens.length : 1;
  const englishPlausibility = englishTokens.length ? englishTokens.filter(token => /[AEIOUYaeiouy]/.test(token) || token.length <= 3).length / englishTokens.length : 1;
  const scatteredShort = tokens.length >= 3 && tokens.filter(token => token.length <= 2).length / tokens.length > 0.58;
  const suspiciousCharCount = (text.match(/[|\[\]+@#]/g) || []).length;
  const mixedNoise = /[ก-๙][A-Za-z0-9|\[\]+@#]{2,}[ก-๙]?|[A-Za-z][ก-๙][A-Za-z0-9]/u.test(text);
  const reasons = [];
  let score = 0;

  if (symbolRatio > 0.25) { score += 0.34; reasons.push('symbol_ratio_above_25_percent'); }
  if (suspiciousTokens.length) { score += Math.min(0.3, suspiciousTokens.length / Math.max(1, tokens.length) * 0.5); reasons.push('frequent_script_switches'); }
  if (thaiTokens.length && thaiSyllableRate < 0.5) { score += 0.25; reasons.push('implausible_thai_syllables'); }
  if (englishTokens.length && englishPlausibility < 0.45) { score += 0.16; reasons.push('implausible_english_tokens'); }
  if (confidence < 0.6) { score += 0.28; reasons.push('low_ocr_confidence'); }
  else if (confidence < 0.82) { score += 0.12; reasons.push('medium_ocr_confidence'); }
  if (suspiciousCharCount >= 3) { score += 0.24; reasons.push('repeated_noise_symbols'); }
  if (scatteredShort) { score += 0.18; reasons.push('scattered_short_tokens'); }
  if (mixedNoise) { score += 0.22; reasons.push('unstructured_mixed_script'); }
  if (options.hasBaseline === false) { score += 0.3; reasons.push('no_baseline_evidence'); }
  if (options.boundingBoxFit === false) { score += 0.22; reasons.push('bounding_box_mismatch'); }
  score = clamp01(score);

  if (score >= 0.58) return { status: 'rejected_as_non_text', rejected: true, score, reasons };
  if (score >= 0.28) return { status: 'manual_review', rejected: false, score, reasons };
  return { status: 'accepted', rejected: false, score, reasons };
}

export function classifyProtectedText(value, box = {}, page = {}) {
  const text = String(value ?? '').trim();
  const yRatio = page.height ? Number(box.top || box.y || 0) / page.height : 0;
  const heightRatio = page.height ? Number(box.height || 0) / page.height : 0;
  if (!text) return 'unknown';
  if (NAME_PREFIX.test(text) && text.replace(NAME_PREFIX, '').trim().split(/\s+/u).length >= 1) return 'person_name';
  if (SCHOOL_WORDS.test(text)) return /โรงเรียน|สถานศึกษา/u.test(text) ? 'school_name' : 'organization_name';
  if (/^(?:ชั้น|ระดับชั้น)\s*(?:มัธยม|ประถม|อนุบาล)/u.test(text)) return 'class_level';
  if (TITLE_WORDS.test(text) || (yRatio < 0.36 && heightRatio >= 0.034 && text.length <= 90)) return 'title';
  if (text.length >= 55 || /[.!?。！？]$/u.test(text)) return 'paragraph';
  return 'unknown';
}

export function decorativeVariantPlan({ estimatedTextHeight = 16, colorContrast = 0.5, shadowScore = 0, decorativeFontScore = 0 } = {}) {
  const variants = [
    'Original Crop',
    'Grayscale',
    'Contrast Soft',
    'CLAHE-like Contrast',
    'Background Flattened',
    'Edge-preserving Sharpen',
    'Color Isolation',
    'Text Mask',
  ];
  if (estimatedTextHeight < 18 || decorativeFontScore >= 0.48) variants.splice(1, 0, 'Upscale 4x', 'Upscale 6x');
  if (colorContrast < 0.42 || shadowScore >= 0.4) variants.push('HSV Foreground Extraction');
  return [...new Set(variants)];
}

export function confidenceGate(block = {}) {
  const text = String(block.text ?? '').trim();
  const type = block.type || classifyProtectedText(text, block.bbox, block.page);
  const protectedText = ['person_name', 'school_name', 'organization_name'].includes(type);
  const textRegionConfidence = clamp01(block.textRegionConfidence ?? block.regionConfidence);
  const ocrConfidence = clamp01(block.ocrConfidence ?? block.confidence);
  const scriptConfidence = clamp01(block.scriptConfidence ?? block.thaiScriptConfidence ?? 1);
  const graphemeConfidence = clamp01(block.graphemeConfidence ?? 1);
  const baselineEvidence = clamp01(block.baselineEvidence ?? 1);
  const gibberish = detectGibberish(text, {
    confidence: ocrConfidence,
    hasBaseline: baselineEvidence >= 0.52,
    boundingBoxFit: block.boundingBoxFit !== false,
  });
  const threshold = protectedText ? COVER_CONFIDENCE_THRESHOLDS.protectedText : COVER_CONFIDENCE_THRESHOLDS.ocr;
  const failures = [];
  if (textRegionConfidence < COVER_CONFIDENCE_THRESHOLDS.textRegion) failures.push('text_region_confidence');
  if (ocrConfidence < threshold) failures.push('ocr_confidence');
  if (scriptConfidence < COVER_CONFIDENCE_THRESHOLDS.script) failures.push('script_confidence');
  if (THAI.test(text) && graphemeConfidence < COVER_CONFIDENCE_THRESHOLDS.grapheme) failures.push('grapheme_confidence');
  if (baselineEvidence < 0.52) failures.push('baseline_evidence');
  if (gibberish.rejected) failures.push('gibberish_rejected');
  if (gibberish.status === 'manual_review') failures.push('gibberish_review');

  if (gibberish.rejected) {
    return { status: 'rejected_as_non_text', accepted: false, requiresReview: false, failures, gibberish, type };
  }
  if (failures.length) {
    return {
      status: 'manual_review',
      accepted: false,
      requiresReview: true,
      failures,
      gibberish,
      type,
      reviewText: type === 'person_name' ? '[โปรดตรวจสอบชื่อบุคคล]' : type === 'school_name' ? '[โปรดตรวจสอบชื่อโรงเรียน]' : '[โปรดตรวจสอบข้อความ]',
    };
  }
  return { status: 'accepted', accepted: true, requiresReview: false, failures: [], gibberish, type };
}

export function filterCoverOutput(blocks = []) {
  const accepted = [];
  const review = [];
  const rejected = [];
  for (const block of blocks) {
    const regionType = block.regionType || 'text';
    if (regionType !== 'text') {
      rejected.push({ ...block, status: 'rejected_as_non_text', reason: `region_${regionType}` });
      continue;
    }
    const gate = block.gate || confidenceGate(block);
    const enriched = { ...block, gate, status: gate.status, type: gate.type || block.type };
    if (gate.accepted) accepted.push(enriched);
    else if (gate.requiresReview) review.push(enriched);
    else rejected.push(enriched);
  }
  return { accepted, review, rejected };
}

export function groupCoverTextBlocks(blocks = []) {
  const sorted = [...blocks].sort((a, b) => {
    const topDifference = Number(a.bbox?.top || 0) - Number(b.bbox?.top || 0);
    const band = Math.max(8, Math.max(Number(a.bbox?.height || 0), Number(b.bbox?.height || 0)) * 0.5);
    if (Math.abs(topDifference) > band) return topDifference;
    return Number(a.bbox?.left || 0) - Number(b.bbox?.left || 0);
  });
  const groups = [];
  for (const block of sorted) {
    const previous = groups[groups.length - 1];
    const sameLine = previous
      && Math.abs(Number(previous.bbox?.top || 0) - Number(block.bbox?.top || 0)) <= Math.max(6, Number(block.bbox?.height || 0) * 0.42)
      && Math.abs(Number(previous.bbox?.height || 0) - Number(block.bbox?.height || 0)) <= Math.max(8, Number(block.bbox?.height || 0) * 0.48);
    if (sameLine && !['person_name', 'school_name', 'organization_name'].includes(block.type)) {
      const right = Math.max(Number(previous.bbox.left || 0) + Number(previous.bbox.width || 0), Number(block.bbox.left || 0) + Number(block.bbox.width || 0));
      previous.text = `${previous.text} ${block.text}`.replace(/\s+/g, ' ').trim();
      previous.bbox.width = right - Number(previous.bbox.left || 0);
      previous.confidence = Math.min(Number(previous.confidence || 0), Number(block.confidence || 0));
      previous.sourceIds = [...(previous.sourceIds || [previous.id]), block.id];
    } else groups.push({ ...block, bbox: { ...(block.bbox || {}) } });
  }
  return groups;
}

export function calculateCoverMetrics(predictedRegions = [], groundTruthRegions = []) {
  const predictedText = predictedRegions.filter(region => (region.regionType || region.type) === 'text' && region.status !== 'rejected_as_non_text');
  const predictedNonText = predictedRegions.filter(region => (region.regionType || region.type) !== 'text' || region.status === 'rejected_as_non_text');
  const truthText = groundTruthRegions.filter(region => (region.regionType || region.type) === 'text');
  const truthNonText = groundTruthRegions.filter(region => (region.regionType || region.type) !== 'text');
  const matches = (left, right) => {
    const leftBox = left.bbox || left;
    const rightBox = right.bbox || right;
    const x1 = Math.max(Number(leftBox.left || 0), Number(rightBox.left || 0));
    const y1 = Math.max(Number(leftBox.top || 0), Number(rightBox.top || 0));
    const x2 = Math.min(Number(leftBox.left || 0) + Number(leftBox.width || 0), Number(rightBox.left || 0) + Number(rightBox.width || 0));
    const y2 = Math.min(Number(leftBox.top || 0) + Number(leftBox.height || 0), Number(rightBox.top || 0) + Number(rightBox.height || 0));
    if (x2 <= x1 || y2 <= y1) return false;
    const intersection = (x2 - x1) * (y2 - y1);
    const union = Number(leftBox.width || 0) * Number(leftBox.height || 0) + Number(rightBox.width || 0) * Number(rightBox.height || 0) - intersection;
    return safeRatio(intersection, union) >= 0.35;
  };
  const matchedPredictedText = predictedText.filter(region => truthText.some(truth => matches(region, truth))).length;
  const matchedTruthText = truthText.filter(truth => predictedText.some(region => matches(region, truth))).length;
  const correctlyRejected = truthNonText.filter(truth => predictedNonText.some(region => matches(region, truth))).length;
  const falseText = predictedText.filter(region => truthNonText.some(truth => matches(region, truth))).length;
  const gibberishTruth = groundTruthRegions.filter(region => region.gibberish === true);
  const gibberishRejected = gibberishTruth.filter(truth => predictedRegions.some(region => matches(region, truth) && region.status === 'rejected_as_non_text')).length;
  const truthTextValue = truthText.map(region => region.text || '').filter(Boolean).join('\n');
  const predictedTextValue = predictedText.map(region => region.text || '').filter(Boolean).join('\n');
  const titleTruth = truthText.filter(region => region.type === 'title').map(region => region.text || '').join(' ');
  const titlePrediction = predictedText.filter(region => region.type === 'title').map(region => region.text || '').join(' ');
  const namesTruth = truthText.filter(region => region.type === 'person_name').map(region => region.text || '').join(' ');
  const namesPrediction = predictedText.filter(region => region.type === 'person_name').map(region => region.text || '').join(' ');
  const schoolTruth = truthText.filter(region => ['school_name', 'organization_name'].includes(region.type)).map(region => region.text || '').join(' ');
  const schoolPrediction = predictedText.filter(region => ['school_name', 'organization_name'].includes(region.type)).map(region => region.text || '').join(' ');
  const accuracy = (prediction, truth) => truth.length ? Math.max(0, 1 - levenshtein(prediction, truth) / truth.length) : 1;
  return {
    textRegionPrecision: safeRatio(matchedPredictedText, predictedText.length, 1),
    textRegionRecall: safeRatio(matchedTruthText, truthText.length, 1),
    nonTextRejectionAccuracy: safeRatio(correctlyRejected, truthNonText.length, 1),
    falseTextDetectionRate: safeRatio(falseText, predictedText.length, 0),
    coverTextAccuracy: accuracy(predictedTextValue, truthTextValue),
    decorativeThaiFontCER: truthTextValue.length ? levenshtein(predictedTextValue, truthTextValue) / truthTextValue.length : 0,
    coverTitleAccuracy: accuracy(titlePrediction, titleTruth),
    nameAccuracy: accuracy(namesPrediction, namesTruth),
    schoolNameAccuracy: accuracy(schoolPrediction, schoolTruth),
    gibberishRejectionRate: safeRatio(gibberishRejected, gibberishTruth.length, 1),
  };
}
