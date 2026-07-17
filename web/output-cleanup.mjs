export const OUTPUT_CLEANUP_VERSION = '4.2.0';

export const OUTPUT_MODES = Object.freeze({
  VERIFIED_ONLY: 'clean_verified_only',
  VERIFIED_REVIEWED: 'clean_verified_reviewed',
  INCLUDE_UNVERIFIED: 'include_unverified',
  DEBUG: 'debug_ocr_output',
});

const LEGACY_MARKER = /^\[(โปรดตรวจสอบ|อาจเป็นข้อความ|อ่านไม่ชัด|Review|Possible text)\s*:\s*([\s\S]*)\]$/iu;
const BLOCKED_STATUSES = new Set(['confirmed_non_text', 'gibberish', 'rejected', 'rejected_as_non_text']);
const REVIEW_LABELS = Object.freeze({
  verified: '',
  review_required: 'โปรดตรวจสอบ',
  possible_text: 'อาจเป็นข้อความ',
  likely_non_text: 'อาจพลาดข้อความ',
  gibberish: 'ข้อความมั่ว',
  confirmed_non_text: 'ไม่ใช่ข้อความ',
  rejected: 'ถูกปฏิเสธ',
});
const THAI_DIGITS = Object.freeze({ '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4', '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9' });

const normalizeWhitespace = value => String(value ?? '')
  .replace(/\r\n?/gu, '\n')
  .replace(/[\t ]+/gu, ' ')
  .replace(/ *\n */gu, '\n')
  .replace(/\n{3,}/gu, '\n\n')
  .trim();

export function stripReviewMarkers(value) {
  let text = normalizeWhitespace(value);
  for (let pass = 0; pass < 3; pass += 1) {
    const match = text.match(LEGACY_MARKER);
    if (!match) break;
    text = normalizeWhitespace(match[2]);
  }
  return text;
}

function markerStatus(label = '') {
  return /อาจเป็นข้อความ|Possible text/iu.test(label) ? 'possible_text' : 'review_required';
}

export function migrateLegacyReviewMarkers(input = {}) {
  const source = typeof input === 'string' ? { text: input } : { ...input };
  const raw = normalizeWhitespace(source.text ?? source.value ?? '');
  const match = raw.match(LEGACY_MARKER);
  if (!match) return {
    ...source,
    text: stripReviewMarkers(raw),
    status: source.status || source.reviewStatus || (source.userConfirmed ? 'verified' : 'review_required'),
    legacyMarkerMigrated: false,
  };
  const status = source.userConfirmed ? 'verified' : markerStatus(match[1]);
  return {
    ...source,
    text: stripReviewMarkers(match[2]),
    status,
    reviewStatus: status,
    displayLabel: REVIEW_LABELS[status] || match[1],
    issueType: source.issueType || (status === 'possible_text' ? 'possible_gibberish' : 'legacy_review_marker'),
    includeInExport: status === 'verified',
    legacyMarkerMigrated: true,
    legacyMarkerLabel: match[1],
  };
}

export function normalizeDomainCandidate(value) {
  let text = stripReviewMarkers(value);
  text = text
    .replace(/เจ้าหน้าที(?!่)/gu, 'เจ้าหน้าที่')
    .replace(/\be\s*-?\s*smart\s+office\b/giu, 'e-Smart Office')
    .replace(/\brd\s*noc\b/giu, 'RDNOC')
    .replace(/^[-–—]?\s*\[[^\]\n]{1,24}\]\s*(?=(?:ระบบ\s+)?e-Smart Office\b)/iu, '')
    .replace(/^[-–—]\s*/u, '');
  return normalizeWhitespace(text);
}

export function normalizePhoneCandidate(value) {
  return String(value ?? '')
    .replace(/[๐-๙]/gu, digit => THAI_DIGITS[digit] || digit)
    .replace(/(?<=\d)[Oo](?=\d)|(?<=\d)[Oo]\b|\b[Oo](?=\d)/gu, '0')
    .replace(/(?<=\d)[Il](?=\d)|(?<=\d)[Il]\b|\b[Il](?=\d)/gu, '1');
}

export function validatePhoneText(value) {
  const normalized = normalizePhoneCandidate(value);
  const hasKeyword = /(?:เบอร์|โทรศัพท์|โทร|ติดต่อ)/u.test(normalized);
  const candidates = normalized.match(/(?:\+?66|0)[\d\s\-/]{7,16}/gu) || [];
  const valid = candidates.find(candidate => {
    const digits = candidate.replace(/^\+66/u, '0').replace(/\D/gu, '');
    return (/^0[689]\d{8}$/u.test(digits) || /^0[2-7]\d{7}$/u.test(digits));
  });
  return {
    normalized,
    hasKeyword,
    valid: Boolean(valid),
    phone: valid ? valid.replace(/\s+/gu, '') : '',
    issueType: hasKeyword && !valid ? 'invalid_phone_pattern' : '',
  };
}

function scriptSwitches(text) {
  let previous = '';
  let count = 0;
  for (const character of text) {
    const script = /[ก-๙]/u.test(character) ? 'th' : /[A-Za-z]/u.test(character) ? 'en' : /[0-9]/u.test(character) ? 'num' : '';
    if (!script) continue;
    if (previous && previous !== script) count += 1;
    previous = script;
  }
  return count;
}

export function assessOutputGibberish(value, options = {}) {
  const text = normalizeDomainCandidate(value);
  const phone = validatePhoneText(text);
  const chars = [...text].filter(character => !/\s/u.test(character));
  const symbols = chars.filter(character => /[^\p{L}\p{N}]/u.test(character)).length;
  const symbolRatio = chars.length ? symbols / chars.length : 0;
  const thaiWords = text.match(/[ก-๙]+/gu) || [];
  const validThaiGroups = thaiWords.filter(word => /[ก-ฮ][ะ-ูเ-ไำ]|[ก-ฮ]{2,}/u.test(word)).length;
  const invalidThaiRatio = thaiWords.length ? 1 - validThaiGroups / thaiWords.length : 0;
  const reasons = [];
  if (symbolRatio > 0.28) reasons.push('symbol_ratio_high');
  if (scriptSwitches(text) >= 5 && !/e-Smart Office|RDNOC/iu.test(text)) reasons.push('unnatural_script_switches');
  if (/[ก-๙][“”"'][ก-๙]/u.test(text)) reasons.push('quote_inside_thai_word');
  if (thaiWords.length >= 2 && invalidThaiRatio > 0.62) reasons.push('thai_syllable_validity_low');
  if (phone.issueType) reasons.push(phone.issueType);
  if (Number(options.confidence ?? 1) < 0.35) reasons.push('confidence_below_035');
  if (/(?:ดดตอเจาหนาท|บพบยบ|อหง\s*โทร|แทเล)/u.test(text)) reasons.push('known_noise_pattern');
  const hardNoise = reasons.includes('known_noise_pattern') || (reasons.length >= 3 && !phone.hasKeyword);
  return {
    text,
    phone,
    reasons,
    score: Math.min(1, reasons.length / 4 + symbolRatio * 0.4),
    status: hardNoise ? 'gibberish' : phone.issueType ? 'possible_text' : reasons.length >= 2 ? 'possible_text' : '',
  };
}

function isConfirmed(block = {}) {
  return block.userConfirmed === true
    || block.confirmed === true
    || block.reviewStatus === 'confirmed'
    || block.reviewStatus === 'verified'
    || block.metadata?.userConfirmed === true;
}

export function normalizeReviewBlock(input = {}) {
  const migrated = migrateLegacyReviewMarkers(input);
  const text = normalizeDomainCandidate(migrated.confirmedText ?? migrated.text ?? '');
  const confirmed = isConfirmed(migrated);
  let status = confirmed ? 'verified' : (migrated.status || migrated.reviewStatus || (migrated.requiresReview ? 'review_required' : 'verified'));
  const assessment = assessOutputGibberish(text, { confidence: migrated.confidence });
  let issueType = migrated.issueType || assessment.phone.issueType || migrated.failureSignals?.[0] || '';
  if (!confirmed && assessment.status === 'gibberish') {
    status = 'gibberish';
    issueType = issueType || 'possible_gibberish';
  } else if (!confirmed && assessment.status === 'possible_text' && status === 'verified') {
    status = 'possible_text';
    issueType = issueType || assessment.phone.issueType || 'possible_gibberish';
  }
  const includeInExport = migrated.includeInExport === true
    || status === 'verified'
    || (status === 'review_required' && confirmed);
  return {
    ...migrated,
    text,
    status,
    reviewStatus: status,
    issueType,
    displayLabel: migrated.displayLabel || REVIEW_LABELS[status] || '',
    includeInExport: !BLOCKED_STATUSES.has(status) && includeInExport,
    requiresReview: !['verified', 'confirmed_non_text', 'gibberish', 'rejected'].includes(status),
    gibberishReasons: assessment.reasons,
  };
}

export function sanitizeTextForExport(value) {
  return normalizeDomainCandidate(stripReviewMarkers(value));
}

export function filterExportBlocks(blocks = [], options = {}) {
  const mode = options.mode || OUTPUT_MODES.VERIFIED_REVIEWED;
  const normalized = blocks.map(normalizeReviewBlock);
  return normalized.filter(block => {
    if (!sanitizeTextForExport(block.text) || BLOCKED_STATUSES.has(block.status) || block.doNotEmitTokens || block.emitToExport === false) return false;
    if (mode === OUTPUT_MODES.DEBUG) return true;
    if (mode === OUTPUT_MODES.INCLUDE_UNVERIFIED) return !BLOCKED_STATUSES.has(block.status);
    if (mode === OUTPUT_MODES.VERIFIED_ONLY) return block.status === 'verified';
    return block.status === 'verified' || (block.status === 'review_required' && isConfirmed(block));
  });
}

export function buildCleanExportText(blocks = [], options = {}) {
  const mode = options.mode || OUTPUT_MODES.VERIFIED_REVIEWED;
  const separator = options.separator ?? '\n\n';
  const ordered = [...blocks].sort((a, b) => Number(a.bbox?.top ?? a.y ?? 0) - Number(b.bbox?.top ?? b.y ?? 0) || Number(a.bbox?.left ?? a.x ?? 0) - Number(b.bbox?.left ?? b.x ?? 0));
  return filterExportBlocks(ordered, { mode }).map(block => {
    const text = sanitizeTextForExport(block.confirmedText ?? block.text ?? '');
    return mode === OUTPUT_MODES.DEBUG ? `[${block.status}] ${text}` : text;
  }).filter(Boolean).join(separator).replace(/\n{3,}/gu, '\n\n').trim();
}

export function buildExportPreview(blocks = [], options = {}) {
  const normalized = blocks.map(normalizeReviewBlock);
  const ready = filterExportBlocks(normalized, options);
  const count = status => normalized.filter(block => block.status === status).length;
  return {
    total: normalized.length,
    ready: ready.length,
    verified: count('verified'),
    reviewed: normalized.filter(block => block.status === 'review_required' && isConfirmed(block)).length,
    reviewRequired: count('review_required'),
    possibleText: count('possible_text'),
    gibberish: count('gibberish'),
    excluded: normalized.length - ready.length,
    excludedBlocks: normalized.filter(block => !ready.some(item => item.id && item.id === block.id)),
  };
}

function cleanCell(cell, options) {
  const normalized = normalizeReviewBlock(cell);
  const included = filterExportBlocks([normalized], options).length > 0;
  return {
    ...cell,
    text: included ? sanitizeTextForExport(normalized.text) : '',
    reviewStatus: normalized.status,
    status: normalized.status,
    issueType: normalized.issueType,
    displayLabel: normalized.displayLabel,
    includeInExport: included,
  };
}

export function cleanDocumentModelForExport(documentModel, options = {}) {
  const clone = typeof structuredClone === 'function'
    ? structuredClone(documentModel || {})
    : JSON.parse(JSON.stringify(documentModel || {}));
  clone.pages = (clone.pages || []).map(page => ({
    ...page,
    blocks: (page.blocks || []).map(block => {
      if (block.type === 'table') return { ...block, cells: (block.cells || []).map(cell => cleanCell(cell, options)) };
      if (block.type === 'field') {
        const normalized = normalizeReviewBlock({ ...block, text: block.value, status: block.status || block.reviewStatus });
        const included = filterExportBlocks([normalized], options).length > 0;
        return { ...block, value: included ? sanitizeTextForExport(normalized.text) : '', status: normalized.status, reviewStatus: normalized.status, includeInExport: included };
      }
      if (!('text' in block)) return block;
      const normalized = normalizeReviewBlock(block);
      const included = filterExportBlocks([normalized], options).length > 0;
      return { ...block, text: included ? sanitizeTextForExport(normalized.text) : '', status: normalized.status, reviewStatus: normalized.status, issueType: normalized.issueType, displayLabel: normalized.displayLabel, includeInExport: included };
    }),
  }));
  if (options.includeReviewMetadata === false) clone.reviewIssues = [];
  return clone;
}
