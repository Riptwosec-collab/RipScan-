export const BOOK_OCR_VERSION = '1.8.0';

export const THAI_DICTIONARIES = Object.freeze({
  academic: [
    'วรรณวิจัย', 'วรรณคดี', 'พระราชนิพนธ์', 'รัตนโกสินทร์', 'คณะอักษรศาสตร์',
    'จุฬาลงกรณ์มหาวิทยาลัย', 'บัณฑิตศึกษา', 'โครงการเผยแพร่ผลงานวิชาการ',
    'ศูนย์หนังสือแห่งจุฬาลงกรณ์มหาวิทยาลัย', 'เอกภาพ', 'พฤติกรรม',
    'ความคิดความเชื่อ', 'วรรณคดีโบราณ', 'การวิจัย', 'การศึกษา', 'ราชนิพนธ์',
  ],
  saraAm: [
    'ดำเนินการ', 'จำนวน', 'สำนักงาน', 'สำคัญ', 'กำหนด', 'คำสั่ง', 'คำแนะนำ',
    'ชำนาญ', 'อำนาจ', 'จำเป็น', 'นำเสนอ', 'ตำแหน่ง', 'สำเร็จ', 'สำหรับ',
    'กำลัง', 'บำรุง', 'ลำดับ', 'คุณธรรม', 'วัฒนธรรม', 'อำเภอ', 'ธรรมาภิบาล',
  ],
  government: ['สำนักงาน', 'ดำเนินการ', 'คำสั่ง', 'ประกาศ', 'หน่วยงาน', 'โครงการ'],
  it: ['เครือข่าย', 'ระบบ', 'เซิร์ฟเวอร์', 'อุปกรณ์', 'อินเทอร์เน็ต', 'ไวไฟ'],
});

export const DEFAULT_BOOK_OCR_OPTIONS = Object.freeze({
  mode: 'text_only',
  readTextOnImages: false,
  skipLogoAndIcons: true,
  skipStamp: true,
  tableTextOnly: false,
  detailedSaraAm: true,
  validateToneMarks: true,
  validateUpperLowerVowels: true,
  validateDifficultThai: true,
  validateProperNouns: true,
  preserveThaiDigits: true,
  preserveDashes: true,
  preserveSeparators: true,
  preserveLineBreaks: true,
  preserveHeadings: true,
  preserveLists: true,
});

const THAI_MARKS = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/u;
const THAI_LETTER = /[\u0E01-\u0E2E]/u;
const THAI_SCRIPT = /[\u0E00-\u0E7F]/u;
const LATIN = /[A-Za-z]/;
const SEPARATOR = /^(?:-{4,}|_{4,}|={4,}|─{4,}|━{4,}|═{4,})$/u;
const PHONE = /(?:\+?\d[\d\s()-]{7,}\d)/;
const ISBN = /(?:ISBN(?:-1[03])?\s*:?[\s-]*)?(?:97[89][\s-]?)?\d[\d\s-]{7,}\d[\dXx]?/;
const PRICE = /(?:฿|บาท|ราคา)\s*[0-9๐-๙,.]+|[0-9๐-๙,.]+\s*(?:บาท|฿)/u;
const ACADEMIC_SET = new Set(Object.values(THAI_DICTIONARIES).flat());

const SARA_AM_CONFUSIONS = Object.freeze({
  'ดาเนินการ': ['ดำเนินการ'], 'จานวน': ['จำนวน'], 'สานักงาน': ['สำนักงาน'],
  'ชานาญ': ['ชำนาญ'], 'กาาหนด': ['กำหนด'], 'กาหนด': ['กำหนด'],
  'คาแนะนา': ['คำแนะนำ'], 'สาคัญ': ['สำคัญ'], 'อาเภอ': ['อำเภอ'],
  'สาเร็จ': ['สำเร็จ'], 'ตาแหน่ง': ['ตำแหน่ง'], 'สาหรับ': ['สำหรับ'],
  'กาลัง': ['กำลัง'], 'บารุง': ['บำรุง'], 'ลาดับ': ['ลำดับ'],
});

const BLOCK_PRIORITY = Object.freeze({
  title: 0, numbered_list: 1, paragraph: 2, publisher_info: 3, address: 4,
  phone: 5, isbn: 6, barcode: 7, price: 8, unknown: 9,
});

export function segmentGraphemes(value) {
  const text = String(value ?? '');
  if (globalThis.Intl?.Segmenter) return [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(text)].map(item => item.segment);
  const output = [];
  for (const char of text) {
    if (THAI_MARKS.test(char) && output.length) output[output.length - 1] += char;
    else output.push(char);
  }
  return output;
}

export function normalizeThaiUnicodeDetailed(value) {
  const rawText = String(value ?? '');
  const changes = [];
  let normalizedText = rawText.replace(/\u0E4D\u0E32/gu, (match, offset) => {
    changes.push({ offset, from: match, to: 'ำ', type: 'sara_am_normalization' });
    return 'ำ';
  });
  normalizedText = normalizedText.normalize('NFC');
  return { rawText, normalizedText, changes, changed: rawText !== normalizedText };
}

export function analyzeThaiGraphemes(value) {
  const text = String(value ?? '');
  const graphemes = segmentGraphemes(text);
  const issues = [];
  graphemes.forEach((cluster, index) => {
    const marks = [...cluster].filter(char => THAI_MARKS.test(char));
    const bases = [...cluster].filter(char => THAI_LETTER.test(char));
    const tones = [...cluster].filter(char => /[่้๊๋]/u.test(char));
    if (marks.length && !bases.length) issues.push({ index, cluster, type: 'floating_mark' });
    if (tones.length > 1) issues.push({ index, cluster, type: 'duplicate_tone_mark' });
    if ((cluster.match(/ำ/gu) || []).length > 1) issues.push({ index, cluster, type: 'duplicate_sara_am' });
    if (/าํ/u.test(cluster)) issues.push({ index, cluster, type: 'invalid_sara_am_order' });
  });
  const thaiCharacters = [...text].filter(char => THAI_SCRIPT.test(char)).length;
  const latinCharacters = [...text].filter(char => LATIN.test(char)).length;
  const thaiScriptConfidence = thaiCharacters + latinCharacters ? thaiCharacters / (thaiCharacters + latinCharacters) : 1;
  return { graphemes, issues, valid: issues.length === 0, thaiScriptConfidence, graphemeConfidence: Math.max(0, 1 - issues.length / Math.max(1, graphemes.length)) };
}

export function analyzeSaraAm(value, confidence = 1) {
  const text = String(value ?? '');
  const normalized = normalizeThaiUnicodeDetailed(text);
  const flagged = [];
  normalized.normalizedText.split(/(\s+)/u).forEach((word, index) => {
    const clean = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
    const candidates = SARA_AM_CONFUSIONS[clean] || [];
    if (candidates.length) flagged.push({ index, originalOCR: clean, candidates, status: 'review_recommended', reason: 'possible_missing_sara_am' });
  });
  const saraAmCount = (normalized.normalizedText.match(/ำ/gu) || []).length;
  const requiresReview = flagged.length > 0 || (saraAmCount > 0 && confidence < 0.96);
  return { ...normalized, saraAmCount, flagged, saraAmConfidence: requiresReview ? Math.min(confidence, 0.95) : confidence, requiresReview };
}

export function classifyDashSymbol(symbol, context = '') {
  const value = String(symbol ?? '');
  const text = String(context ?? '');
  const typeMap = { '-': 'hyphen', '–': 'en_dash', '—': 'em_dash', '−': 'minus_sign', '_': 'underscore', '/': 'slash', '|': 'vertical_bar' };
  let role = 'text_symbol';
  if (SEPARATOR.test(value)) role = 'section_separator';
  else if (/\d\s*[–-]\s*\d/u.test(text)) role = 'range';
  else if (/[A-Za-z0-9]+[-_/][A-Za-z0-9]+/.test(text)) role = 'document_code';
  else if (value === '—') role = 'sentence_separator';
  else if (value === '−') role = 'mathematical_minus';
  return { symbol: value, type: SEPARATOR.test(value) ? 'separator_line' : (typeMap[value] || 'unknown'), role };
}

export function extractDashElements(value) {
  const elements = [];
  String(value ?? '').split('\n').forEach((line, lineIndex) => {
    if (SEPARATOR.test(line.trim())) {
      elements.push({ ...classifyDashSymbol(line.trim(), line), line: lineIndex + 1, length: line.trim().length, position: 'between_blocks' });
      return;
    }
    [...line.matchAll(/[-–—−_/|]+/gu)].forEach(match => elements.push({ ...classifyDashSymbol(match[0], line), line: lineIndex + 1, column: match.index + 1, length: match[0].length }));
  });
  return elements;
}

export function preserveTextSymbols(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').split('\n').map(line => SEPARATOR.test(line.trim()) ? line.trim() : line.replace(/[\t ]+$/g, '')).join('\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

export function detectFailureSignals(value, box = null, confidence = 1) {
  const text = String(value ?? '');
  const signals = [];
  if (/[ก-๙][A-Za-z]+[ก-๙]|[A-Za-z]+[ก-๙]+[A-Za-z]+/u.test(text)) signals.push('latin_inside_thai_word');
  if (/\b(?:dos|wi|io|Tn\.)\b/i.test(text) && /[ก-๙]/u.test(text)) signals.push('english_noise_in_thai');
  if (/(?:\|\s*){3,}|(?:\[\s*){3,}|(?:\+\s*){3,}/u.test(text)) signals.push('repeated_barcode_symbols');
  if (/[A-Za-z]\d[A-Za-z]\d|\d[A-Za-z]\d[A-Za-z]/.test(text) && !/[A-Za-z0-9]+[-_/][A-Za-z0-9]+/.test(text)) signals.push('unstructured_alphanumeric');
  if (box?.width && text.length > Math.max(12, box.width / 2)) signals.push('text_longer_than_box');
  if (confidence < 0.6) signals.push('low_confidence');
  if (!analyzeThaiGraphemes(text).valid) signals.push('invalid_thai_grapheme');
  if (analyzeSaraAm(text, confidence).requiresReview) signals.push('sara_am_review');
  return [...new Set(signals)];
}

export function classifyBlockText(value, box = {}, page = {}) {
  const text = String(value ?? '').trim();
  const yRatio = page.height ? (box.top || box.y || 0) / page.height : 0;
  const heightRatio = page.height ? (box.height || 0) / page.height : 0;
  if (!text) return 'unknown';
  if (ISBN.test(text)) return 'isbn';
  if (PHONE.test(text)) return 'phone';
  if (PRICE.test(text)) return 'price';
  if (/^(?:\d+|[ก-ฮ])[.)]\s+/u.test(text)) return 'numbered_list';
  if (/(?:ถนน|แขวง|เขต|ตำบล|อำเภอ|จังหวัด|เลขที่|ซอย|โทรศัพท์|โทร\.)/u.test(text) && text.length > 15) return 'address';
  if (/(?:สำนักพิมพ์|ศูนย์หนังสือ|จัดพิมพ์|เผยแพร่|มหาวิทยาลัย)/u.test(text)) return 'publisher_info';
  if (yRatio < 0.32 && (heightRatio > 0.035 || text.length < 80) && !/[.!?。！？]$/u.test(text)) return 'title';
  if (text.length >= 70 || /[.!?。！？]$/u.test(text)) return 'paragraph';
  return 'unknown';
}

export function languageForBlock(type, value = '') {
  const text = String(value ?? '');
  if (type === 'barcode') return 'barcode';
  if (type === 'isbn' || type === 'phone' || type === 'price') return 'number';
  const hasThai = /[ก-๙]/u.test(text);
  const hasLatin = /[A-Za-z]/.test(text);
  if ((type === 'address' || type === 'publisher_info') && hasLatin) return 'tha+eng';
  if (hasThai && hasLatin) return 'tha+eng';
  if (hasThai || ['title', 'paragraph', 'numbered_list', 'address', 'publisher_info'].includes(type)) return 'tha';
  return hasLatin ? 'eng' : 'tha';
}

export function sortReadingOrder(blocks) {
  return [...blocks].sort((a, b) => {
    const ay = a.bbox?.top ?? a.bbox?.y ?? 0;
    const by = b.bbox?.top ?? b.bbox?.y ?? 0;
    const ah = a.bbox?.height || 1;
    const bh = b.bbox?.height || 1;
    const sameBand = Math.abs(ay - by) <= Math.max(ah, bh) * 0.55;
    if (!sameBand) return ay - by;
    const typeDifference = (BLOCK_PRIORITY[a.type] ?? 9) - (BLOCK_PRIORITY[b.type] ?? 9);
    if (typeDifference) return typeDifference;
    return (a.bbox?.left ?? a.bbox?.x ?? 0) - (b.bbox?.left ?? b.bbox?.x ?? 0);
  });
}

export function rankCandidates(candidates, evidence = {}) {
  return [...new Set((candidates || []).map(String).filter(Boolean))].map(text => {
    const confidence = Number(evidence.confidences?.[text] ?? 0);
    const providerAgreement = Number(evidence.providerAgreement?.[text] ?? 0);
    const imageEvidence = Number(evidence.imageEvidence?.[text] ?? 0);
    const dictionarySupport = ACADEMIC_SET.has(text) ? 1 : 0;
    const grapheme = analyzeThaiGraphemes(text).graphemeConfidence;
    const contextSupport = Math.min(1, Number(evidence.contextSupport?.[text] ?? 0));
    const score = confidence * 0.34 + imageEvidence * 0.28 + providerAgreement * 0.16 + grapheme * 0.12 + dictionarySupport * 0.07 + contextSupport * 0.03;
    return { text, score, confidence, imageEvidence, providerAgreement, dictionarySupport, graphemeConfidence: grapheme };
  }).sort((a, b) => b.score - a.score);
}

export function analyzeRegionFeatures(features = {}) {
  const textLineScore = Number(features.textLineScore || 0);
  const connectedComponentScore = Number(features.connectedComponentScore || 0);
  const texture = Number(features.texture || 0);
  const colorVariance = Number(features.colorVariance || 0);
  const barcodeScore = Number(features.barcodeScore || 0);
  const qrScore = Number(features.qrScore || 0);
  if (barcodeScore >= 0.72) return { regionType: 'barcode', action: 'barcode_reader', confidence: barcodeScore };
  if (qrScore >= 0.72) return { regionType: 'qr_code', action: 'barcode_reader', confidence: qrScore };
  if (textLineScore >= 0.48 && connectedComponentScore >= 0.34) return { regionType: 'text', action: 'text_ocr', confidence: Math.min(1, textLineScore * 0.58 + connectedComponentScore * 0.42) };
  if (texture >= 0.58 && colorVariance >= 0.42 && textLineScore < 0.38) return { regionType: 'image', action: 'skip_text_ocr', confidence: Math.min(1, texture * 0.55 + colorVariance * 0.45) };
  return { regionType: 'unknown', action: textLineScore >= 0.34 ? 'manual_review' : 'skip_text_ocr', confidence: 0.5 };
}

export function shouldRetryBlock(block) {
  const confidence = Number(block.confidence ?? 0);
  const signals = detectFailureSignals(block.text, block.bbox, confidence);
  const longAcademic = String(block.text || '').split(/\s+/u).some(word => word.length >= 12 && /[ก-๙]/u.test(word));
  const properNoun = block.type === 'publisher_info' || /มหาวิทยาลัย|สำนักงาน|สำนักพิมพ์/u.test(block.text || '');
  return { retry: confidence < 0.96 || signals.length > 0 || longAcademic || properNoun, signals, threshold: properNoun ? 0.98 : 0.96 };
}

export function buildStructuredText(blocks) {
  const ordered = sortReadingOrder(blocks).filter(block => !['barcode', 'qr_code', 'image', 'logo', 'icon', 'decorative_shape'].includes(block.regionType || block.type));
  const lines = [];
  let previous = null;
  for (const block of ordered) {
    const text = preserveTextSymbols(block.text || '');
    if (!text) continue;
    const needsGap = previous && (block.type !== previous.type || ['title', 'paragraph', 'publisher_info', 'address'].includes(block.type));
    if (needsGap && lines[lines.length - 1] !== '') lines.push('');
    lines.push(text);
    previous = block;
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function levenshtein(a, b) {
  const left = Array.isArray(a) ? a : [...String(a ?? '')];
  const right = Array.isArray(b) ? b : [...String(b ?? '')];
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[right.length];
}

export function calculateTextMetrics(predicted, groundTruth) {
  const prediction = String(predicted ?? '');
  const truth = String(groundTruth ?? '');
  const truthWords = truth.trim() ? truth.trim().split(/\s+/u) : [];
  const predictedWords = prediction.trim() ? prediction.trim().split(/\s+/u) : [];
  const truthSaraAm = (truth.match(/ำ/gu) || []).length;
  const predictedSaraAm = (prediction.match(/ำ/gu) || []).length;
  const truthDashes = extractDashElements(truth).map(item => item.symbol);
  const predictedDashes = extractDashElements(prediction).map(item => item.symbol);
  const dashMatches = truthDashes.filter((symbol, index) => predictedDashes[index] === symbol).length;
  const truthGraphemes = segmentGraphemes(truth);
  const predictedGraphemes = segmentGraphemes(prediction);
  return {
    cer: truth.length ? levenshtein(prediction, truth) / truth.length : 0,
    wer: truthWords.length ? levenshtein(predictedWords, truthWords) / truthWords.length : 0,
    thaiGraphemeAccuracy: truthGraphemes.length ? Math.max(0, 1 - levenshtein(predictedGraphemes, truthGraphemes) / truthGraphemes.length) : 1,
    saraAmDetectionAccuracy: truthSaraAm ? Math.min(1, predictedSaraAm / truthSaraAm) : 1,
    saraAmMissingRate: truthSaraAm ? Math.max(0, (truthSaraAm - predictedSaraAm) / truthSaraAm) : 0,
    dashPreservationAccuracy: truthDashes.length ? dashMatches / truthDashes.length : 1,
  };
}

export function summarizeBlockConfidence(block) {
  const grapheme = analyzeThaiGraphemes(block.text || '');
  const saraAm = analyzeSaraAm(block.text || '', block.confidence || 0);
  const failureSignals = detectFailureSignals(block.text || '', block.bbox, block.confidence || 0);
  const imageExclusionConfidence = Number(block.regionConfidence ?? 1);
  return {
    textRegionConfidence: Number(block.regionConfidence ?? 0),
    thaiScriptConfidence: grapheme.thaiScriptConfidence,
    graphemeConfidence: grapheme.graphemeConfidence,
    saraAmConfidence: saraAm.saraAmConfidence,
    dashPreservationConfidence: 1,
    imageExclusionConfidence,
    finalConfidence: Math.max(0, Math.min(1, Number(block.confidence || 0) * 0.4 + grapheme.graphemeConfidence * 0.22 + saraAm.saraAmConfidence * 0.18 + imageExclusionConfidence * 0.2)),
    failureSignals,
    requiresReview: failureSignals.length > 0 || saraAm.requiresReview || Number(block.confidence || 0) < 0.96,
  };
}
