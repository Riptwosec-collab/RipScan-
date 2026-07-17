export const OUTPUT_MODES = Object.freeze({
  CLEAN_VERIFIED_ONLY: 'verified_only',
  CLEAN_VERIFIED_REVIEWED: 'verified_reviewed',
  INCLUDE_UNVERIFIED: 'include_unverified',
  DEBUG: 'debug',
});

export const DEFAULT_OUTPUT_MODE = OUTPUT_MODES.CLEAN_VERIFIED_REVIEWED;

export const REVIEW_STATUSES = Object.freeze({
  VERIFIED: 'verified',
  REVIEW_REQUIRED: 'review_required',
  POSSIBLE_TEXT: 'possible_text',
  CONFIRMED_NON_TEXT: 'confirmed_non_text',
  GIBBERISH: 'gibberish',
  REJECTED: 'rejected',
});

export const DOMAIN_DICTIONARY = Object.freeze([
  'e-Smart Office',
  'RDNOC',
  'ติดต่อเจ้าหน้าที่',
  'เบอร์',
  'โทร',
  'โทรศัพท์',
  'หมายเลข',
  'ระบบ',
  'เจ้าหน้าที่',
]);

const LEGACY_MARKER_RE = /^\s*\[(โปรดตรวจสอบ|อาจเป็นข้อความ|อ่านไม่ชัด|Review|Possible text)\s*:\s*([\s\S]*)\]\s*$/iu;
const PHONE_CONTEXT_RE = /(?:เบอร์|เบอร|โทรศัพท์|โทร|ติดต่อ|phone|tel)/iu;
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const REVIEW_LABELS = Object.freeze({
  verified: 'ยืนยันแล้ว',
  review_required: 'โปรดตรวจสอบ',
  possible_text: 'อาจเป็นข้อความ',
  confirmed_non_text: 'ไม่ใช่ข้อความ',
  gibberish: 'ข้อความไม่สมบูรณ์',
  rejected: 'ไม่รวม',
});

const LEGACY_STATUS = Object.freeze({
  'โปรดตรวจสอบ': REVIEW_STATUSES.REVIEW_REQUIRED,
  Review: REVIEW_STATUSES.REVIEW_REQUIRED,
  'อ่านไม่ชัด': REVIEW_STATUSES.POSSIBLE_TEXT,
  'อาจเป็นข้อความ': REVIEW_STATUSES.POSSIBLE_TEXT,
  'Possible text': REVIEW_STATUSES.POSSIBLE_TEXT,
});

const STATUS_ALIASES = Object.freeze({
  verified: REVIEW_STATUSES.VERIFIED,
  approved: REVIEW_STATUSES.VERIFIED,
  confirmed: REVIEW_STATUSES.VERIFIED,
  review_required: REVIEW_STATUSES.REVIEW_REQUIRED,
  review_recommended: REVIEW_STATUSES.REVIEW_REQUIRED,
  manual_review_required: REVIEW_STATUSES.REVIEW_REQUIRED,
  needs_manual_review: REVIEW_STATUSES.REVIEW_REQUIRED,
  contaminated: REVIEW_STATUSES.REVIEW_REQUIRED,
  possibly_empty: REVIEW_STATUSES.REVIEW_REQUIRED,
  possible_text: REVIEW_STATUSES.POSSIBLE_TEXT,
  unreadable: REVIEW_STATUSES.POSSIBLE_TEXT,
  gibberish: REVIEW_STATUSES.GIBBERISH,
  confirmed_non_text: REVIEW_STATUSES.CONFIRMED_NON_TEXT,
  non_text: REVIEW_STATUSES.CONFIRMED_NON_TEXT,
  rejected: REVIEW_STATUSES.REJECTED,
  empty: REVIEW_STATUSES.VERIFIED,
  unknown: REVIEW_STATUSES.REVIEW_REQUIRED,
});

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function canonicalReviewStatus(status, fallback = REVIEW_STATUSES.VERIFIED) {
  const key = String(status || '').trim();
  return STATUS_ALIASES[key] || fallback;
}

export function parseLegacyReviewMarker(value) {
  const rawText = String(value ?? '');
  const match = rawText.match(LEGACY_MARKER_RE);
  if (!match) return null;
  const [, label, inner] = match;
  const status = LEGACY_STATUS[label] || REVIEW_STATUSES.REVIEW_REQUIRED;
  return {
    rawText,
    text: String(inner || '').trim(),
    status,
    displayLabel: label,
    issueType: status === REVIEW_STATUSES.POSSIBLE_TEXT ? 'possible_gibberish' : 'legacy_review_marker',
    includeInExport: false,
    reviewed: false,
    confirmed: false,
    legacyMarker: true,
  };
}

export function stripReviewMarkers(value, { preserveInner = true } = {}) {
  const input = String(value ?? '').replace(/[\u200B\u200C\u200D\uFEFF]/gu, '');
  const whole = parseLegacyReviewMarker(input);
  if (whole) return preserveInner ? whole.text : '';
  return input.split(/\r?\n/u).map(line => {
    const parsed = parseLegacyReviewMarker(line);
    return parsed ? (preserveInner ? parsed.text : '') : line;
  }).join('\n');
}

export function sanitizeTextForExport(value, options = {}) {
  const text = stripReviewMarkers(value, { preserveInner: options.preserveLegacyInner !== false })
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t ]+$/gmu, '')
    .replace(/\n{3,}/gu, '\n\n');
  return options.trim === false ? text : text.trim();
}

function reviewSource(item = {}) {
  return item.review || item.metadata?.review || {};
}

function explicitText(item = {}) {
  if (item.type === 'field') return item.value ?? '';
  return item.text ?? '';
}

export function normalizePhoneDigits(value) {
  const substitutions = [];
  let normalized = String(value ?? '').normalize('NFC');
  normalized = normalized.replace(/[๐-๙]/gu, character => String(THAI_DIGITS.indexOf(character)));
  normalized = normalized.replace(/[Oo]/gu, character => { substitutions.push({ from: character, to: '0' }); return '0'; });
  normalized = normalized.replace(/[Il|]/gu, character => { substitutions.push({ from: character, to: '1' }); return '1'; });
  return { normalized, substitutions };
}

export function validatePhoneNumber(value) {
  const raw = String(value ?? '').trim();
  const { normalized, substitutions } = normalizePhoneDigits(raw);
  const context = PHONE_CONTEXT_RE.test(normalized);
  const withoutWords = normalized
    .replace(/(?:เบอร์|เบอร|โทรศัพท์|โทร|ติดต่อ|phone|tel)\s*[:：.-]?/giu, ' ')
    .replace(/[^0-9+()\s.-]/gu, ' ')
    .trim();
  const groups = withoutWords.match(/\d+/gu) || [];
  const digits = groups.join('');
  const validLength = digits.length === 9 || digits.length === 10;
  const validPrefix = /^0\d/u.test(digits);
  const validMobile = digits.length !== 10 || /^0[689]\d{8}$/u.test(digits);
  const validLandline = digits.length !== 9 || /^0[2-7]\d{7}$/u.test(digits);
  const malformedSeparators = /(?:\/|\d-\d{1,2}-\d{1,2}(?:\D|$))/u.test(withoutWords)
    || groups.length > 4
    || /\d\s+[A-Za-zก-ฮ]\s*\d/u.test(normalized);
  const valid = validLength && validPrefix && validMobile && validLandline && !malformedSeparators;
  let formatted = digits;
  if (valid && digits.length === 10) formatted = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (valid && digits.length === 9) formatted = `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  return {
    raw,
    normalized,
    digits,
    formatted,
    valid,
    context,
    ambiguous: substitutions.length > 0,
    substitutions,
    issueType: valid ? null : 'invalid_phone_pattern',
  };
}

export function suggestDomainCandidate(value) {
  const raw = sanitizeTextForExport(value, { trim: false });
  let candidate = raw;
  const corrections = [];
  const replace = (pattern, replacement, reason) => {
    const next = candidate.replace(pattern, replacement);
    if (next !== candidate) {
      corrections.push({ before: candidate, after: next, reason });
      candidate = next;
    }
  };
  replace(/เจ้าหน้าที(?!่)/gu, 'เจ้าหน้าที่', 'domain_dictionary');
  replace(/\bRDN0C\b/giu, 'RDNOC', 'domain_dictionary');
  replace(/เบอร(?!์)/gu, 'เบอร์', 'domain_dictionary');
  replace(/\be\s*[-–—]?\s*Smart\s+Office\b/giu, 'e-Smart Office', 'domain_dictionary');
  if (/e-Smart Office/iu.test(candidate)) {
    replace(/^\s*-?\s*\[แทเล\]\s*/u, '', 'remove_known_noise_token');
  }
  candidate = candidate.replace(/[ \t]{2,}/gu, ' ').trim();
  return {
    raw,
    candidate,
    changed: candidate !== raw,
    corrections,
    dictionarySupport: corrections.length ? Math.min(1, 0.72 + corrections.length * 0.08) : 0,
  };
}

function thaiVowelRatio(text) {
  const thai = [...String(text || '')].filter(character => /[ก-๙]/u.test(character));
  if (!thai.length) return 1;
  const vowels = thai.filter(character => /[ะาำิีึืุูเแโใไั็่้๊๋์]/u.test(character));
  return vowels.length / thai.length;
}

export function detectGibberish(value, evidence = {}) {
  const text = sanitizeTextForExport(value);
  const reasons = [];
  let score = 0;
  if (!text) return { status: REVIEW_STATUSES.CONFIRMED_NON_TEXT, issueType: 'empty', score: 1, reasons: ['empty'] };

  const confidence = clamp(evidence.confidence ?? evidence.ocrConfidence ?? 0.5);
  const providerAgreement = clamp(evidence.providerAgreement ?? 0.5);
  const phone = validatePhoneNumber(text);
  const hasPhoneContext = phone.context;
  const compact = text.replace(/\s+/gu, '');
  const thaiRatio = thaiVowelRatio(text);
  const quoteNoise = /[“”"']/u.test(text) && /[ก-ฮ]/u.test(text);
  const mixedToken = /(?:[ก-ฮ][0-9]|[0-9][ก-ฮ])/u.test(compact);
  const symbolIntrusion = /[ก-ฮ][“”"'`][ก-ฮ]/u.test(compact) || /[\/]{1,2}/u.test(text);
  const longLowVowelThai = /[ก-ฮ]{5,}/u.test(compact) && thaiRatio < 0.16;
  const repeatedConsonant = /([ก-ฮ])\1{1,}/u.test(compact);
  const unknownShort = /^(?:แทเล|อหง)$/u.test(text.trim());

  if (confidence < 0.45) { score += 0.25; reasons.push('low_confidence'); }
  else if (confidence < 0.7) { score += 0.12; reasons.push('moderate_confidence'); }
  if (providerAgreement < 0.45) { score += 0.2; reasons.push('provider_disagreement'); }
  if (evidence.boundingBoxConsistent === false) { score += 0.18; reasons.push('bounding_box_inconsistent'); }
  if (quoteNoise) { score += 0.16; reasons.push('quote_inside_ocr_phrase'); }
  if (mixedToken) { score += 0.22; reasons.push('unnatural_script_digit_mix'); }
  if (symbolIntrusion) { score += 0.16; reasons.push('symbol_intrusion'); }
  if (longLowVowelThai) { score += 0.28; reasons.push('low_thai_syllable_validity'); }
  if (repeatedConsonant) { score += 0.12; reasons.push('repeated_consonant'); }
  if (unknownShort) { score += 0.38; reasons.push('unknown_noise_token'); }
  if (hasPhoneContext && !phone.valid) { score += 0.34; reasons.push('invalid_phone_pattern'); }

  score = clamp(score);
  if (hasPhoneContext && !phone.valid) {
    return { status: REVIEW_STATUSES.POSSIBLE_TEXT, issueType: 'invalid_phone_pattern', score, reasons, phone };
  }
  if (score >= 0.68) return { status: REVIEW_STATUSES.GIBBERISH, issueType: 'possible_gibberish', score, reasons, phone };
  if (score >= 0.35) return { status: REVIEW_STATUSES.POSSIBLE_TEXT, issueType: 'possible_gibberish', score, reasons, phone };
  return { status: REVIEW_STATUSES.VERIFIED, issueType: null, score, reasons, phone };
}

function defaultInclude(status, confirmed) {
  if (status === REVIEW_STATUSES.VERIFIED) return true;
  if (status === REVIEW_STATUSES.REVIEW_REQUIRED && confirmed) return true;
  return false;
}

export function normalizeReviewMetadata(input = {}, item = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const legacy = parseLegacyReviewMarker(explicitText(item));
  const rawStatus = source.status || item.status || item.reviewStatus || legacy?.status || REVIEW_STATUSES.VERIFIED;
  const status = canonicalReviewStatus(rawStatus, legacy?.status || REVIEW_STATUSES.VERIFIED);
  const confirmed = Boolean(source.confirmed ?? item.confirmed ?? source.reviewed ?? item.reviewed ?? false);
  const userOverride = Boolean(source.userOverride ?? item.userOverride ?? false);
  const explicitInclude = typeof source.includeInExport === 'boolean'
    ? source.includeInExport
    : typeof item.includeInExport === 'boolean' ? item.includeInExport : undefined;
  return {
    status,
    confidence: clamp(source.confidence ?? item.confidence ?? 1),
    issueType: source.issueType || item.issueType || legacy?.issueType || '',
    displayLabel: source.displayLabel || item.displayLabel || legacy?.displayLabel || REVIEW_LABELS[status] || '',
    includeInExport: explicitInclude ?? defaultInclude(status, confirmed),
    confirmed,
    reviewed: Boolean(source.reviewed ?? item.reviewed ?? confirmed),
    userOverride,
    rawText: String(source.rawText ?? item.rawText ?? legacy?.rawText ?? explicitText(item) ?? ''),
    candidate: String(source.candidate ?? item.candidate ?? ''),
    imageCrop: source.imageCrop ?? item.imageCrop ?? null,
    providerAgreement: clamp(source.providerAgreement ?? item.providerAgreement ?? 0),
    legacyMarker: Boolean(source.legacyMarker ?? legacy?.legacyMarker),
  };
}

export function migrateLegacyReviewMarkers(input) {
  if (typeof input === 'string') {
    const parsed = parseLegacyReviewMarker(input);
    if (!parsed) return {
      text: sanitizeTextForExport(input),
      status: REVIEW_STATUSES.VERIFIED,
      confidence: 1,
      issueType: '',
      displayLabel: REVIEW_LABELS.verified,
      includeInExport: true,
      confirmed: true,
      reviewed: true,
      rawText: input,
    };
    const suggestion = suggestDomainCandidate(parsed.text);
    return {
      ...parsed,
      text: parsed.text,
      candidate: suggestion.changed ? suggestion.candidate : '',
      confidence: 0,
    };
  }

  const item = clone(input || {});
  const key = item.type === 'field' ? 'value' : 'text';
  const parsed = parseLegacyReviewMarker(item[key]);
  const existing = reviewSource(item);
  const review = normalizeReviewMetadata({ ...parsed, ...existing }, item);
  if (parsed) item[key] = parsed.text;
  else item[key] = sanitizeTextForExport(item[key] ?? '', { trim: false });
  const suggestion = suggestDomainCandidate(item[key]);
  if (!review.candidate && suggestion.changed) review.candidate = suggestion.candidate;
  item.status = review.status;
  item.reviewStatus = review.status;
  item.issueType = review.issueType;
  item.displayLabel = review.displayLabel;
  item.includeInExport = review.includeInExport;
  item.confirmed = review.confirmed;
  item.reviewed = review.reviewed;
  item.metadata = { ...(item.metadata || {}), review };
  return item;
}

export function createReviewRecord({ text = '', confidence = 0, providerAgreement = 0, boundingBoxConsistent = true, rawText = '', imageCrop = null } = {}) {
  const legacy = parseLegacyReviewMarker(text);
  const cleanText = legacy?.text ?? sanitizeTextForExport(text);
  const suggestion = suggestDomainCandidate(cleanText);
  const gibberish = detectGibberish(cleanText, { confidence, providerAgreement, boundingBoxConsistent });
  let status = legacy?.status || gibberish.status;
  let issueType = legacy?.issueType || gibberish.issueType || '';
  if (status === REVIEW_STATUSES.VERIFIED && suggestion.changed) {
    status = confidence >= 0.88 && providerAgreement >= 0.75 ? REVIEW_STATUSES.VERIFIED : REVIEW_STATUSES.REVIEW_REQUIRED;
    issueType = 'domain_candidate';
  } else if (status === REVIEW_STATUSES.VERIFIED && confidence < 0.82) {
    status = REVIEW_STATUSES.REVIEW_REQUIRED;
    issueType = 'low_confidence';
  }
  const confirmed = status === REVIEW_STATUSES.VERIFIED && !suggestion.changed;
  return {
    text: cleanText,
    status,
    confidence: clamp(confidence),
    issueType,
    displayLabel: REVIEW_LABELS[status] || '',
    includeInExport: defaultInclude(status, confirmed),
    confirmed,
    reviewed: confirmed,
    userOverride: false,
    rawText: String(rawText || legacy?.rawText || text),
    candidate: suggestion.changed ? suggestion.candidate : cleanText,
    imageCrop,
    providerAgreement: clamp(providerAgreement),
    evidence: { gibberish, domain: suggestion },
  };
}

function modeOf(options = {}) {
  return options.mode || options.outputMode || DEFAULT_OUTPUT_MODE;
}

export function shouldIncludeInExport(item, options = {}) {
  const review = normalizeReviewMetadata(reviewSource(item), item);
  const mode = modeOf(options);
  if (review.userOverride && typeof review.includeInExport === 'boolean') return review.includeInExport;
  if (mode === OUTPUT_MODES.DEBUG) return true;
  if (mode === OUTPUT_MODES.CLEAN_VERIFIED_ONLY) return review.status === REVIEW_STATUSES.VERIFIED;
  if (mode === OUTPUT_MODES.INCLUDE_UNVERIFIED) {
    return ![REVIEW_STATUSES.CONFIRMED_NON_TEXT, REVIEW_STATUSES.GIBBERISH, REVIEW_STATUSES.REJECTED].includes(review.status);
  }
  return review.status === REVIEW_STATUSES.VERIFIED
    || (review.status === REVIEW_STATUSES.REVIEW_REQUIRED && review.confirmed && review.includeInExport !== false);
}

export function cleanTextForItem(item, options = {}) {
  const review = normalizeReviewMetadata(reviewSource(item), item);
  if (!shouldIncludeInExport(item, options)) return '';
  const sourceText = review.confirmed && review.candidate ? review.candidate : explicitText(item);
  const clean = sanitizeTextForExport(sourceText, { preserveLegacyInner: true });
  if (modeOf(options) === OUTPUT_MODES.DEBUG && options.debugLabels) {
    return `${review.displayLabel || review.status}: ${clean}`;
  }
  return clean;
}

export function filterExportBlocks(blocks = [], options = {}) {
  const included = [];
  const excluded = [];
  for (const item of blocks) {
    const review = normalizeReviewMetadata(reviewSource(item), item);
    const text = cleanTextForItem(item, options);
    const record = { item, review, text };
    if (shouldIncludeInExport(item, options) && (text || item.type === 'image' || item.type === 'shape' || item.type === 'line')) included.push(record);
    else excluded.push(record);
  }
  return { included, excluded };
}

export function collectExportBlocks(documentModel) {
  const records = [];
  for (const [pageIndex, page] of (documentModel?.pages || []).entries()) {
    for (const block of (page.blocks || [])) {
      if (block.hidden) continue;
      if (block.type === 'table') {
        for (const cell of (block.cells || []).filter(cell => !cell.hidden)) records.push({ ...cell, type: 'table_cell', pageIndex, blockId: block.id });
      } else if (['text', 'header', 'footer', 'field'].includes(block.type)) records.push({ ...block, pageIndex });
    }
  }
  return records;
}

function cleanReviewFields(item, includeReviewMetadata) {
  if (includeReviewMetadata) return item;
  delete item.status;
  delete item.reviewStatus;
  delete item.issueType;
  delete item.displayLabel;
  delete item.includeInExport;
  delete item.confirmed;
  delete item.reviewed;
  if (item.metadata) {
    delete item.metadata.review;
    if (!Object.keys(item.metadata).length) delete item.metadata;
  }
  return item;
}

export function sanitizeDocumentModelForExport(documentModel, options = {}) {
  const includeReviewMetadata = Boolean(options.includeReviewMetadata);
  const model = clone(documentModel || { pages: [] });
  model.pages = (model.pages || []).map(page => ({
    ...page,
    blocks: (page.blocks || []).map(rawBlock => {
      const block = migrateLegacyReviewMarkers(rawBlock);
      if (block.type === 'table') {
        block.cells = (block.cells || []).map(rawCell => {
          const cell = migrateLegacyReviewMarkers(rawCell);
          cell.text = cleanTextForItem(cell, options);
          return cleanReviewFields(cell, includeReviewMetadata);
        });
      } else if (block.type === 'field') {
        block.value = cleanTextForItem(block, options);
        if (!block.value && !shouldIncludeInExport(block, options)) block.hidden = true;
      } else if (['text', 'header', 'footer'].includes(block.type)) {
        block.text = cleanTextForItem(block, options);
        if (!block.text && !shouldIncludeInExport(block, options)) block.hidden = true;
      }
      return cleanReviewFields(block, includeReviewMetadata);
    }),
  }));
  if (!includeReviewMetadata) model.reviewIssues = [];
  return model;
}

export function buildCleanExportText(documentOrBlocks, options = {}) {
  if (Array.isArray(documentOrBlocks)) {
    return filterExportBlocks(documentOrBlocks, options).included.map(record => record.text).filter(Boolean).join(options.separator || '\n');
  }
  const model = sanitizeDocumentModelForExport(documentOrBlocks, options);
  const pageTexts = (model.pages || []).map(page => (page.blocks || [])
    .filter(block => !block.hidden)
    .sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0))
    .map(block => {
      if (block.type === 'table') {
        return Array.from({ length: block.rows || 0 }, (_, row) => Array.from({ length: block.columns || 0 }, (_, column) => {
          const cell = (block.cells || []).find(item => !item.hidden
            && row >= item.row && row < item.row + item.rowSpan
            && column >= item.column && column < item.column + item.columnSpan);
          return cell?.text || '';
        }).join('\t')).join('\n');
      }
      if (block.type === 'field') return block.value ? `${block.label}${block.label ? ': ' : ''}${block.value}` : '';
      return block.text || '';
    }).filter(Boolean).join('\n\n'));
  return pageTexts.filter(Boolean).join(options.pageSeparator || '\n\n---\n\n');
}

export function buildExportPreview(documentModel, options = {}) {
  const blocks = collectExportBlocks(documentModel);
  const { included, excluded } = filterExportBlocks(blocks, options);
  const reviews = blocks.map(item => normalizeReviewMetadata(reviewSource(item), item));
  return {
    total: blocks.length,
    ready: included.length,
    excluded: excluded.length,
    verified: reviews.filter(review => review.status === REVIEW_STATUSES.VERIFIED).length,
    reviewed: reviews.filter(review => review.status === REVIEW_STATUSES.REVIEW_REQUIRED && review.confirmed).length,
    unverified: reviews.filter(review => review.status === REVIEW_STATUSES.REVIEW_REQUIRED && !review.confirmed).length,
    possibleText: reviews.filter(review => review.status === REVIEW_STATUSES.POSSIBLE_TEXT).length,
    gibberish: reviews.filter(review => review.status === REVIEW_STATUSES.GIBBERISH).length,
    excludedItems: excluded,
  };
}

export function buildJsonExportPayload(documentModel, options = {}) {
  return sanitizeDocumentModelForExport(documentModel, {
    ...options,
    includeReviewMetadata: options.includeReviewMetadata !== false,
  });
}
