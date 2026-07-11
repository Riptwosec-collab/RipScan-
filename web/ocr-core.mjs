const THAI_RE = /[\u0E00-\u0E7F]/u;
const EN_RE = /[A-Za-z]/;
const DIGIT_RE = /[0-9๐-๙]/u;
const MARK_RE = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/u;
const EMAIL_RE = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const URL_RE = /^(?:https?:\/\/|www\.)[^\s]+$/i;
const CODE_RE = /^(?=.*[A-Za-z0-9])[A-Za-z0-9][A-Za-z0-9._:/\\#-]*$/;
const PHONE_RE = /^\+?[0-9๐-๙][0-9๐-๙\s().-]{5,}$/u;

const THAI_LEADING_VOWELS = new Set(['เ', 'แ', 'โ', 'ใ', 'ไ']);
const THAI_TONE_MARKS = new Set(['่', '้', '๊', '๋']);
const THAI_UPPER_VOWELS = new Set(['ั', 'ิ', 'ี', 'ึ', 'ื', '็']);
const THAI_LOWER_VOWELS = new Set(['ุ', 'ู']);
const THAI_SPECIAL_MARKS = new Set(['์', 'ํ', 'ฺ']);
const DIFFICULT_THAI_WORDS = new Set([
  'เทคโนโลยี', 'อิเล็กทรอนิกส์', 'ประสิทธิภาพ', 'สิทธิประโยชน์', 'พระราชบัญญัติ',
  'ทรัพย์สิน', 'พาณิชย์', 'อัตลักษณ์', 'ยุทธศาสตร์', 'สาธารณูปโภค', 'วิเคราะห์',
  'อนุมัติ', 'หลักเกณฑ์', 'เจ้าหน้าที่', 'ผู้รับผิดชอบ',
]);

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function normalizeThaiUnicode(input) {
  const rawText = String(input ?? '');
  const changes = [];
  let normalizedText = rawText.normalize('NFC');
  if (normalizedText !== rawText) changes.push({ type: 'unicode_nfc', before: rawText, after: normalizedText });

  const withoutZeroWidth = normalizedText.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
  if (withoutZeroWidth !== normalizedText) {
    changes.push({ type: 'remove_zero_width', before: normalizedText, after: withoutZeroWidth });
    normalizedText = withoutZeroWidth;
  }

  const dedupedMarks = normalizedText.replace(/([่้๊๋์ํ])\1+/gu, '$1');
  if (dedupedMarks !== normalizedText) {
    changes.push({ type: 'dedupe_combining_mark', before: normalizedText, after: dedupedMarks });
    normalizedText = dedupedMarks;
  }

  return { rawText, normalizedText, displayText: normalizedText, normalizationChanges: changes };
}

export function thaiGraphemes(text) {
  const value = String(text ?? '');
  if (!value) return [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('th', { granularity: 'grapheme' });
    return [...segmenter.segment(value)].map(item => item.segment);
  }
  const result = [];
  for (const char of value) {
    if (MARK_RE.test(char) && result.length) result[result.length - 1] += char;
    else result.push(char);
  }
  return result;
}

export function analyzeThaiGraphemes(text) {
  const graphemes = thaiGraphemes(text);
  const issues = [];
  for (let index = 0; index < graphemes.length; index += 1) {
    const grapheme = graphemes[index];
    const chars = [...grapheme];
    const toneCount = chars.filter(char => THAI_TONE_MARKS.has(char)).length;
    const upperCount = chars.filter(char => THAI_UPPER_VOWELS.has(char)).length;
    const lowerCount = chars.filter(char => THAI_LOWER_VOWELS.has(char)).length;
    const specialCount = chars.filter(char => THAI_SPECIAL_MARKS.has(char)).length;
    const baseCount = chars.filter(char => /[ก-ฮ]/u.test(char)).length;
    if (toneCount > 1) issues.push({ index, grapheme, type: 'multiple_tone_marks' });
    if (upperCount > 1) issues.push({ index, grapheme, type: 'multiple_upper_vowels' });
    if (lowerCount > 1) issues.push({ index, grapheme, type: 'multiple_lower_vowels' });
    if (specialCount > 1) issues.push({ index, grapheme, type: 'multiple_special_marks' });
    if ((toneCount || upperCount || lowerCount || specialCount) && baseCount === 0) {
      issues.push({ index, grapheme, type: 'mark_without_base' });
    }
  }
  return { graphemes, issues, valid: issues.length === 0 };
}

export function classifyToken(token) {
  const value = String(token ?? '');
  const compact = value.trim();
  if (!compact) return 'space';
  if (EMAIL_RE.test(compact)) return 'email';
  if (URL_RE.test(compact)) return 'url';
  if (PHONE_RE.test(compact)) return 'phone';
  if (CODE_RE.test(compact) && /[-_./\\:#]/.test(compact)) return 'document_code';
  const hasThai = THAI_RE.test(compact);
  const hasEnglish = EN_RE.test(compact);
  const hasNumber = DIGIT_RE.test(compact);
  if (hasThai && hasEnglish) return 'mixed_th_en';
  if (hasThai) return 'thai';
  if (hasEnglish) return 'english';
  if (hasNumber && !/[A-Za-z\u0E00-\u0E7F]/u.test(compact)) return 'number';
  if (/^[\p{P}\p{S}]+$/u.test(compact)) return 'punctuation';
  return 'unknown';
}

function tokenizePreservingSpaces(text) {
  return String(text ?? '').match(/\s+|https?:\/\/[^\s]+|www\.[^\s]+|[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+|[A-Za-z0-9]+(?:[-_./:#\\][A-Za-z0-9]+)+|[\u0E00-\u0E7F]+|[A-Za-z]+(?:[.'’-][A-Za-z]+)*|[0-9๐-๙]+(?:[.,:/-][0-9๐-๙]+)*|[^\s]/giu) || [];
}

export function segmentMixedLanguage(text) {
  const tokens = tokenizePreservingSpaces(text);
  const segments = [];
  for (const token of tokens) {
    const type = classifyToken(token);
    const previous = segments.at(-1);
    const mergeable = previous && previous.type === type && !['space', 'email', 'url', 'document_code'].includes(type);
    if (mergeable) previous.text += token;
    else segments.push({ text: token, type, language: type === 'thai' ? 'th' : type === 'english' ? 'en' : type });
  }
  return segments;
}

export function joinSegments(segments) {
  return (segments || []).map(segment => segment.text).join('');
}

export function strictPreservationKind(text) {
  const value = String(text ?? '').trim();
  if (EMAIL_RE.test(value)) return 'email';
  if (URL_RE.test(value)) return 'url';
  if (PHONE_RE.test(value)) return 'phone';
  if (CODE_RE.test(value) && /[-_./\\:#]/.test(value)) return 'document_code';
  if (/^(?:[A-Za-z]:\\|\/)[^\n]+$/.test(value)) return 'file_path';
  if (/^\d+(?:\.\d+){1,4}$/.test(value)) return 'version';
  return null;
}

export function validateStrictNumber(value, type = 'number') {
  const raw = String(value ?? '').trim();
  const normalizedDigits = raw.replace(/[๐-๙]/g, char => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(char)));
  const patterns = {
    integer: /^[-+]?\d+$/,
    decimal: /^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/,
    currency: /^(?:฿|THB|USD|EUR|\$|€)?\s*(?:-?\d+|-?\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$|^\((?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?\)$/i,
    percentage: /^[-+]?(?:\d+|\d+\.\d+)\s*%$/,
    date: /^(?:0?[1-9]|[12]\d|3[01])[\/.\-](?:0?[1-9]|1[0-2])[\/.\-](?:\d{2}|\d{4})$/,
    time: /^(?:[01]?\d|2[0-3])[:.]?[0-5]\d(?:\s*น\.)?$/u,
    number: /^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/,
  };
  const pattern = patterns[type] || patterns.number;
  const valid = pattern.test(normalizedDigits);
  const ambiguous = /[OIlSBZG]/.test(raw) || /[oI|]/.test(raw);
  return {
    raw,
    normalizedDigits,
    type,
    valid,
    ambiguous,
    status: valid && !ambiguous ? 'verified' : ambiguous ? 'manual_review_required' : 'review_recommended',
  };
}

export function inferColumnType(header, values = []) {
  const normalizedHeader = String(header ?? '').trim().toLowerCase();
  const text = [normalizedHeader, ...values.map(value => String(value ?? '').trim())].filter(Boolean);
  const candidates = [
    ['running_number', /(ลำดับ|ที่|no\.?|number)/i],
    ['name', /(ชื่อ|name|นามสกุล|surname)/i],
    ['organization', /(หน่วยงาน|ฝ่าย|กอง|แผนก|department|organization)/i],
    ['date', /(วันที่|date)/i],
    ['time', /(เวลา|time)/i],
    ['currency', /(จำนวนเงิน|ยอด|ราคา|บาท|amount|price|total)/i],
    ['percentage', /(ร้อยละ|เปอร์เซ็นต์|percent|%)/i],
    ['email', /(อีเมล|email)/i],
    ['phone', /(โทรศัพท์|เบอร์|phone|tel)/i],
    ['document_code', /(เลขที่|รหัส|code|ticket|reference|ref\.?)/i],
    ['status', /(สถานะ|status)/i],
    ['description', /(รายละเอียด|คำอธิบาย|description|remark|หมายเหตุ)/i],
  ];
  for (const [type, pattern] of candidates) if (pattern.test(normalizedHeader)) return { type, confidence: 0.96, reason: 'header_match' };

  const nonEmpty = text.slice(1);
  if (!nonEmpty.length) return { type: 'mixed_text', confidence: 0.2, reason: 'no_values' };
  const ratios = {
    email: nonEmpty.filter(value => EMAIL_RE.test(value)).length / nonEmpty.length,
    phone: nonEmpty.filter(value => PHONE_RE.test(value)).length / nonEmpty.length,
    date: nonEmpty.filter(value => validateStrictNumber(value, 'date').valid).length / nonEmpty.length,
    currency: nonEmpty.filter(value => validateStrictNumber(value, 'currency').valid).length / nonEmpty.length,
    percentage: nonEmpty.filter(value => validateStrictNumber(value, 'percentage').valid).length / nonEmpty.length,
    integer: nonEmpty.filter(value => validateStrictNumber(value, 'integer').valid).length / nonEmpty.length,
    decimal: nonEmpty.filter(value => validateStrictNumber(value, 'decimal').valid).length / nonEmpty.length,
    document_code: nonEmpty.filter(value => strictPreservationKind(value) === 'document_code').length / nonEmpty.length,
  };
  const [type, ratio] = Object.entries(ratios).sort((a, b) => b[1] - a[1])[0];
  if (ratio >= 0.75) return { type, confidence: clamp(0.55 + ratio * 0.4), reason: 'value_pattern' };
  return { type: 'mixed_text', confidence: 0.55, reason: 'mixed_values' };
}

export function assessEmptyCell({ text = '', foregroundRatio = null, connectedComponents = null, wordCount = null, checkbox = false } = {}) {
  if (checkbox) return { isEmpty: false, status: 'checkbox', confidence: 0.99 };
  const trimmed = String(text).trim();
  const suspiciousPlaceholder = /^(?:[-–—_.|]|0|O)$/i.test(trimmed);
  let score = 0;
  if (!trimmed) score += 0.55;
  if (suspiciousPlaceholder) score += 0.25;
  if (Number.isFinite(foregroundRatio)) score += foregroundRatio < 0.012 ? 0.28 : foregroundRatio < 0.025 ? 0.12 : -0.2;
  if (Number.isFinite(connectedComponents)) score += connectedComponents <= 1 ? 0.12 : connectedComponents <= 3 ? 0.04 : -0.12;
  if (Number.isFinite(wordCount)) score += wordCount === 0 ? 0.18 : -0.18;
  score = clamp(score);
  const isEmpty = score >= 0.78;
  const possiblyEmpty = !isEmpty && score >= 0.52;
  return { isEmpty, confidence: score, status: isEmpty ? 'empty' : possiblyEmpty ? 'possibly_empty' : 'not_empty', preserveOriginalText: !isEmpty };
}

export function detectCellContamination({ text = '', bbox = null, cellBox = null, neighboringTexts = [], columnType = 'mixed_text', confidence = 1 } = {}) {
  const reasons = [];
  if (bbox && cellBox) {
    const centerX = (bbox.x0 + bbox.x1) / 2;
    const centerY = (bbox.y0 + bbox.y1) / 2;
    if (centerX < cellBox.x || centerX > cellBox.x + cellBox.width || centerY < cellBox.y || centerY > cellBox.y + cellBox.height) reasons.push('word_center_outside_cell');
    const overflow = bbox.x0 < cellBox.x - 2 || bbox.x1 > cellBox.x + cellBox.width + 2 || bbox.y0 < cellBox.y - 2 || bbox.y1 > cellBox.y + cellBox.height + 2;
    if (overflow) reasons.push('bounding_box_overflow');
  }
  const normalized = String(text).trim().toLowerCase();
  if (normalized && neighboringTexts.some(value => String(value).trim().toLowerCase() === normalized)) reasons.push('duplicates_neighbor');
  if (['integer', 'decimal', 'currency', 'percentage', 'date', 'time', 'running_number'].includes(columnType)) {
    const strictType = columnType === 'running_number' ? 'integer' : columnType;
    if (!validateStrictNumber(text, strictType).valid) reasons.push('column_type_mismatch');
  }
  if (Number(confidence) < 0.55) reasons.push('low_confidence');
  return { contaminated: reasons.length > 0, reasons, status: reasons.length ? 'contaminated' : 'verified' };
}

export function validateRowConsistency(rows) {
  const normalized = (rows || []).map((row, rowIndex) => ({ rowIndex, cells: row.cells || row }));
  const widths = normalized.map(row => row.cells.length);
  const expectedColumns = widths.length ? widths.sort((a, b) => a - b)[Math.floor(widths.length / 2)] : 0;
  const issues = [];
  for (const row of normalized) {
    if (row.cells.length !== expectedColumns) issues.push({ rowIndex: row.rowIndex, type: row.cells.length < expectedColumns ? 'missing_cell' : 'extra_cell', actual: row.cells.length, expected: expectedColumns });
    row.cells.forEach((cell, columnIndex) => {
      if (cell?.rowShiftSuspected) issues.push({ rowIndex: row.rowIndex, columnIndex, type: 'row_shift' });
      if (cell?.columnShiftSuspected) issues.push({ rowIndex: row.rowIndex, columnIndex, type: 'column_shift' });
    });
  }
  return { expectedColumns, issues, valid: issues.length === 0 };
}

export function detectRepeatedHeader(firstHeader, candidateHeader, threshold = 0.88) {
  const a = (firstHeader || []).map(value => String(value).trim().toLowerCase());
  const b = (candidateHeader || []).map(value => String(value).trim().toLowerCase());
  if (!a.length || a.length !== b.length) return { repeated: false, similarity: 0 };
  let score = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) score += 1;
    else if (a[index] && b[index] && (a[index].includes(b[index]) || b[index].includes(a[index]))) score += 0.65;
  }
  const similarity = score / a.length;
  return { repeated: similarity >= threshold, similarity };
}

export function detectTableContinuation(previous, next) {
  if (!previous || !next) return { continuation: false, confidence: 0, reasons: ['missing_table'] };
  const reasons = [];
  let score = 0;
  if (previous.columnCount === next.columnCount) { score += 0.35; reasons.push('same_column_count'); }
  if (Array.isArray(previous.columnWidths) && Array.isArray(next.columnWidths) && previous.columnWidths.length === next.columnWidths.length) {
    const widthAgreement = previous.columnWidths.reduce((sum, width, index) => {
      const other = next.columnWidths[index] || 1;
      return sum + Math.max(0, 1 - Math.abs(width - other) / Math.max(width, other, 1));
    }, 0) / Math.max(1, previous.columnWidths.length);
    score += widthAgreement * 0.25;
    if (widthAgreement > 0.85) reasons.push('column_widths_match');
  }
  const header = detectRepeatedHeader(previous.header || [], next.header || []);
  if (header.repeated) { score += 0.25; reasons.push('repeated_header'); }
  if (Number.isFinite(previous.lastRunningNumber) && Number.isFinite(next.firstRunningNumber) && next.firstRunningNumber === previous.lastRunningNumber + 1) {
    score += 0.15; reasons.push('running_number_continues');
  }
  return { continuation: score >= 0.68, confidence: clamp(score), reasons };
}

export function confidenceBreakdown(evidence = {}, entityType = 'general') {
  const weights = {
    ocrConfidence: 0.31,
    providerAgreement: 0.2,
    scriptConfidence: 0.13,
    imageQuality: 0.1,
    dictionarySupport: 0.08,
    documentRepetitionSupport: 0.08,
    formatValidation: 0.1,
  };
  const normalized = {};
  let finalConfidence = 0;
  for (const [key, weight] of Object.entries(weights)) {
    normalized[key] = clamp(evidence[key] ?? 0);
    finalConfidence += normalized[key] * weight;
  }
  const thresholds = { general: 0.94, difficult_thai: 0.96, person_name: 0.98, numeric: 0.985, code: 0.985 };
  const threshold = thresholds[entityType] || thresholds.general;
  const requiresManualReview = finalConfidence < threshold || evidence.structureConflict === true || evidence.providerConflict === true;
  return { ...normalized, finalConfidence: clamp(finalConfidence), threshold, entityType, requiresManualReview };
}

export function rankCandidates(candidates, context = {}) {
  const allowed = new Set((candidates || []).map(candidate => candidate.text));
  const ranked = (candidates || []).map(candidate => {
    const evidence = candidate.evidence || {};
    let score = clamp(candidate.ocrConfidence ?? candidate.score ?? 0) * 0.42;
    score += clamp(evidence.providerAgreement) * 0.22;
    score += clamp(evidence.imageMatch) * 0.18;
    score += clamp(evidence.documentRepetition) * 0.08;
    score += clamp(evidence.dictionarySupport) * 0.05;
    score += clamp(evidence.formatValidation) * 0.05;
    if (context.strictPreservation && candidate.text !== context.originalText) score -= 0.25;
    if (context.personName && !evidence.imageMatch) score -= 0.2;
    return { ...candidate, score: clamp(score), allowed: allowed.has(candidate.text) };
  }).sort((a, b) => b.score - a.score);
  const selected = ranked[0];
  const runnerUp = ranked[1];
  const conflict = selected && runnerUp && selected.score - runnerUp.score < 0.08;
  return {
    candidates: ranked.slice(0, 5),
    selectedCandidate: selected && !conflict && selected.score >= (context.minimumScore ?? 0.82) ? selected.text : null,
    status: !selected || conflict || selected.score < (context.minimumScore ?? 0.82) ? 'needs_manual_review' : 'verified',
    needsManualReview: !selected || conflict || selected.score < (context.minimumScore ?? 0.82),
    reason: conflict ? 'candidate_scores_too_close' : selected ? 'ranked_from_existing_candidates_only' : 'no_candidate',
  };
}

export function difficultThaiIssues(text, { confidence = 1, nearTableLine = false, smallCell = false, dictionary = [] } = {}) {
  const tokens = String(text ?? '').match(/[\u0E00-\u0E7F]+/gu) || [];
  const dictionarySet = new Set(dictionary);
  const issues = [];
  for (const word of tokens) {
    const grapheme = analyzeThaiGraphemes(word);
    const difficult = DIFFICULT_THAI_WORDS.has(word) || [...word].some(char => MARK_RE.test(char)) || word.length >= 10;
    const reasons = [];
    if (confidence < 0.96) reasons.push('confidence_below_0_96');
    if (!grapheme.valid) reasons.push('grapheme_issue');
    if (nearTableLine) reasons.push('near_table_line');
    if (smallCell) reasons.push('small_cell');
    if (difficult && !dictionarySet.has(word)) reasons.push('difficult_or_unknown_word');
    if (reasons.length) issues.push({ word, reasons, status: confidence < 0.75 || !grapheme.valid ? 'manual_review_required' : 'review_recommended' });
  }
  return issues;
}

export function buildTableModel(matrix, options = {}) {
  const rows = (matrix || []).map((row, rowIndex) => ({
    rowIndex,
    cells: row.map((cell, columnIndex) => {
      const source = typeof cell === 'object' && cell !== null ? cell : { text: cell };
      return {
        cellId: source.cellId || `cell-r${rowIndex}-c${columnIndex}`,
        rowIndex,
        columnIndex,
        rowSpan: Number(source.rowSpan || source.rowspan || 1),
        columnSpan: Number(source.columnSpan || source.colspan || 1),
        text: String(source.text ?? ''),
        textWithLineBreaks: String(source.text ?? ''),
        singleLineText: String(source.text ?? '').replace(/\s*\n\s*/g, ' ').trim(),
        confidence: clamp(source.confidence ?? 0),
        status: source.status || 'unknown',
        cellType: source.cellType || (rowIndex === 0 ? 'header' : 'body'),
      };
    }),
  }));
  return { tableId: options.tableId || 'table-1', page: options.page || 1, rows };
}

export function exportDelimited(matrix, delimiter = ',', { bom = true } = {}) {
  const encode = value => {
    const text = String(value ?? '');
    const escaped = text.replace(/"/g, '""');
    return /["\r\n]/.test(text) || text.includes(delimiter) ? `"${escaped}"` : text;
  };
  const body = (matrix || []).map(row => row.map(encode).join(delimiter)).join('\r\n');
  return `${bom ? '\uFEFF' : ''}${body}`;
}

export function calculateTextMetrics(expected, actual) {
  const a = [...String(expected ?? '')];
  const b = [...String(actual ?? '')];
  const distance = levenshtein(a, b);
  const graphemeExpected = thaiGraphemes(expected);
  const graphemeActual = thaiGraphemes(actual);
  const graphemeDistance = levenshtein(graphemeExpected, graphemeActual);
  const expectedWords = String(expected ?? '').trim().split(/\s+/).filter(Boolean);
  const actualWords = String(actual ?? '').trim().split(/\s+/).filter(Boolean);
  const wordDistance = levenshtein(expectedWords, actualWords);
  return {
    cer: distance / Math.max(1, a.length),
    wer: wordDistance / Math.max(1, expectedWords.length),
    thaiGraphemeErrorRate: graphemeDistance / Math.max(1, graphemeExpected.length),
  };
}

function levenshtein(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}
