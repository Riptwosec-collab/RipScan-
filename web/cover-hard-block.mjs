import {
  coverZoneForBox,
  reviewAwareOutput,
} from './cover-recovery-core.mjs';

export const COVER_HARD_BLOCK_VERSION = '2.1.0';

export const COVER_HARD_BLOCK_DOCUMENT_TYPES = Object.freeze([
  'cover_page',
  'worksheet_cover',
  'illustrated_cover',
  'illustrated_document',
  'poster_cover',
  'poster',
  'book_cover',
  'certificate_cover',
]);

export const COVER_HARD_BLOCK_REGION_TYPES = Object.freeze([
  'illustration',
  'character_art',
  'animal_art',
  'ship_art',
  'decorative_frame',
  'ornament',
  'logo',
  'icon',
  'badge',
  'emblem',
  'background_shape',
  'photograph',
  'cartoon',
]);

const COVER_TYPES = new Set(COVER_HARD_BLOCK_DOCUMENT_TYPES);
const HARD_BLOCK_TYPES = new Set(COVER_HARD_BLOCK_REGION_TYPES);
const NON_EMIT_STATUSES = new Set(['confirmed_non_text', 'rejected_as_non_text']);
const COVER_NOISE = /(?:^|\s)(?:CAR\s*A|CH\s*[”"'=]*|0{3,}\d*|<=\s*\d+|\|\s*-?\s*TR\b|(?:[|\[\]+@#]{2,})|(?:[A-Za-z0-9@#|]+\s*){5,})(?:$|\s)/iu;

const normalizeType = value => String(value || '').trim().toLowerCase();
const normalizeText = value => String(value || '').replace(/\r\n?/g, '\n').trim();

export function isCoverHardBlockDocument(documentType) {
  return COVER_TYPES.has(String(documentType || '').trim());
}

export function isCoverHardBlockRegion(regionType) {
  return HARD_BLOCK_TYPES.has(normalizeType(regionType));
}

export function looksLikeCoverIllustrationLeak(value) {
  const text = normalizeText(value);
  if (!text) return false;
  const symbols = [...text].filter(character => /[|\[\]+@#<>_=]/u.test(character)).length;
  const meaningful = [...text].filter(character => /[\p{L}\p{N}]/u.test(character)).length;
  const shortNoiseLines = text.split('\n').filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    const letters = [...trimmed].filter(character => /[\p{L}\p{N}]/u.test(character)).length;
    const punctuation = [...trimmed].filter(character => /[^\p{L}\p{N}\s]/u.test(character)).length;
    return trimmed.length <= 18 && (punctuation >= letters || /^(?:[A-Z0-9@#|<>=_\-]+\s*)+$/u.test(trimmed));
  }).length;
  return COVER_NOISE.test(text)
    || (symbols >= 3 && symbols > meaningful * 0.35)
    || shortNoiseLines >= 2;
}

export function hardBlockCoverBlock(block = {}, context = {}) {
  const documentType = context.documentType || block.documentType || 'normal_document';
  const page = context.page || block.page || {};
  const zone = block.zone || coverZoneForBox(block.bbox || {}, page);
  const regionType = normalizeType(block.regionType || block.type || 'unknown');
  const isCover = isCoverHardBlockDocument(documentType);
  const explicitNonText = isCoverHardBlockRegion(regionType);
  const topIllustration = isCover && zone === 'top_illustration' && block.manualTextRegion !== true;
  const alreadyBlocked = block.doNotEmitTokens === true || NON_EMIT_STATUSES.has(block.status);
  const hardBlocked = alreadyBlocked || (isCover && (explicitNonText || topIllustration));

  if (!hardBlocked) {
    const text = normalizeText(block.text);
    const leakedNoise = isCover && looksLikeCoverIllustrationLeak(text)
      && (zone === 'top_illustration' || regionType !== 'text');
    if (!leakedNoise) return { ...block, zone };
  }

  const suppressedText = normalizeText(block.suppressedText || block.text || block.rawText);
  return {
    ...block,
    zone,
    regionType: explicitNonText ? regionType : (regionType === 'text' ? 'illustration' : regionType || 'illustration'),
    type: explicitNonText ? (block.type || regionType) : (block.type === 'text' ? 'illustration' : block.type),
    text: '',
    rawText: '',
    confirmedText: '',
    suppressedText,
    status: 'confirmed_non_text',
    action: 'skip_text_ocr',
    doNotEmitTokens: true,
    emitToEditor: false,
    emitToExport: false,
    requiresReview: false,
    hardBlockReason: topIllustration ? 'cover_top_illustration_hard_block' : explicitNonText ? `cover_${regionType}_hard_block` : 'cover_non_text_no_output_leak',
    failureSignals: [...new Set([...(block.failureSignals || []), 'cover_image_hard_block', 'do_not_emit_tokens'])],
  };
}

export function hardBlockCoverBlocks(blocks = [], context = {}) {
  return blocks.map(block => hardBlockCoverBlock(block, context));
}

export function coverPageSanityCheck(blocks = [], context = {}) {
  const documentType = context.documentType || 'normal_document';
  const page = context.page || {};
  if (!isCoverHardBlockDocument(documentType)) {
    return { required: false, reasons: [], textBlocks: 0, hardBlockedBlocks: 0, leakedTopIllustrationBlocks: 0 };
  }

  const normalized = hardBlockCoverBlocks(blocks, { documentType, page });
  const emitted = normalized.filter(block => !block.doNotEmitTokens && !NON_EMIT_STATUSES.has(block.status) && normalizeText(block.text));
  const textZones = new Set(emitted.map(block => block.zone || coverZoneForBox(block.bbox || {}, page)));
  const leakedTopIllustrationBlocks = blocks.filter(block => {
    const zone = block.zone || coverZoneForBox(block.bbox || {}, page);
    return zone === 'top_illustration' && normalizeText(block.text);
  }).length;
  const gibberishBlocks = emitted.filter(block => looksLikeCoverIllustrationLeak(block.text)).length;
  const reasons = [];
  if (emitted.length < 3) reasons.push('cover_has_fewer_than_three_emittable_text_blocks');
  if (!textZones.has('main_title')) reasons.push('main_title_missing_after_hard_block');
  if (!textZones.has('author_name')) reasons.push('author_name_missing_after_hard_block');
  if (!textZones.has('school_name') && !textZones.has('organization_name')) reasons.push('bottom_identity_text_missing_after_hard_block');
  if (leakedTopIllustrationBlocks > 0) reasons.push('top_illustration_tokens_detected');
  if (gibberishBlocks > 0) reasons.push('cover_gibberish_detected');

  return {
    required: reasons.length > 0,
    reasons,
    textBlocks: emitted.length,
    hardBlockedBlocks: normalized.filter(block => block.doNotEmitTokens).length,
    leakedTopIllustrationBlocks,
    gibberishBlocks,
    textZones: [...textZones],
  };
}

export function strictCoverEditorOutput(blocks = [], options = {}) {
  const safeBlocks = blocks.filter(block => {
    if (block.doNotEmitTokens || block.emitToEditor === false || NON_EMIT_STATUSES.has(block.status)) return false;
    if (!normalizeText(block.text)) return false;
    if (looksLikeCoverIllustrationLeak(block.text) && block.userConfirmed !== true) return false;
    return true;
  });
  return reviewAwareOutput(safeBlocks, { includeMarkers: options.includeMarkers !== false });
}

export function coverOutputAudit(blocks = []) {
  const blocked = blocks.filter(block => block.doNotEmitTokens || NON_EMIT_STATUSES.has(block.status));
  const leaked = blocked.filter(block => normalizeText(block.text) || block.emitToEditor !== false || block.emitToExport !== false);
  return {
    blockedRegionCount: blocked.length,
    blockedTokenCount: blocked.reduce((sum, block) => sum + normalizeText(block.suppressedText || block.text).split(/\s+/u).filter(Boolean).length, 0),
    outputLeakCount: leaked.length,
    passed: leaked.length === 0,
  };
}
