import {
  processBookCoverCanvas as processReviewFirstCover,
  cancelBookCoverOcr as cancelReviewFirstCover,
} from './book-ocr-browser-recovery.mjs';
import {
  coverOutputAudit,
  coverPageSanityCheck,
  hardBlockCoverBlocks,
  isCoverHardBlockDocument,
  looksLikeCoverIllustrationLeak,
  strictCoverEditorOutput,
} from './cover-hard-block.mjs';
import {
  expectedCoverZones,
} from './cover-recovery-core.mjs';
import {
  classifyBlockText,
  preserveTextSymbols,
  sortReadingOrder,
  summarizeBlockConfidence,
} from './book-ocr-rules.mjs';
import {
  resolveSaraAmAcrossVariants,
} from './sara-am-recovery-v21.mjs';

export const BOOK_COVER_HARD_BLOCK_PIPELINE = 'book-cover-hard-block-v2.1';

let activeRun = 0;
let hardBlockWorker = null;

const createCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const releaseCanvas = canvas => {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
};

function cropZone(source, bbox, topPaddingRatio = 0.30) {
  const topPadding = Math.max(8, Math.round(bbox.height * topPaddingRatio));
  const sidePadding = Math.max(6, Math.round(bbox.width * 0.08));
  const bottomPadding = Math.max(5, Math.round(bbox.height * 0.15));
  const left = Math.max(0, Math.floor(bbox.left - sidePadding));
  const top = Math.max(0, Math.floor(bbox.top - topPadding));
  const right = Math.min(source.width, Math.ceil(bbox.left + bbox.width + sidePadding));
  const bottom = Math.min(source.height, Math.ceil(bbox.top + bbox.height + bottomPadding));
  const canvas = createCanvas(right - left, bottom - top);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, left, top, right - left, bottom - top, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function resize(source, scale) {
  const canvas = createCanvas(source.width * scale, source.height * scale);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function filtered(source, filter) {
  const canvas = createCanvas(source.width, source.height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.filter = filter;
  context.drawImage(source, 0, 0);
  context.filter = 'none';
  return canvas;
}

function smallDotPreservingThreshold(source) {
  const canvas = filtered(source, 'grayscale(1) contrast(1.22) brightness(1.03)');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  let mean = 0;
  for (let index = 0; index < image.data.length; index += 4) mean += image.data[index];
  mean /= Math.max(1, image.data.length / 4);
  const threshold = mean - 8;
  for (let index = 0; index < image.data.length; index += 4) {
    const original = image.data[index];
    const value = original < threshold ? 0 : 255;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function colorIsolation(source) {
  const canvas = resize(source, 4);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const r = image.data[index];
    const g = image.data[index + 1];
    const b = image.data[index + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luminance = r * 0.299 + g * 0.587 + b * 0.114;
    const saturation = max ? (max - min) / max : 0;
    const gold = r > 100 && g > 60 && r >= g * 1.02 && g >= b * 1.08;
    const white = luminance > 170 && saturation < 0.34;
    const dark = luminance < 95;
    const value = gold || white || dark ? 0 : 255;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function recoveryVariants(crop) {
  const up4 = resize(crop, 4);
  const up6 = resize(crop, 6);
  return [
    { name: 'Original', canvas: resize(crop, 1) },
    { name: 'Upscale 4x', canvas: up4 },
    { name: 'Upscale 6x', canvas: up6 },
    { name: 'Color Isolation', canvas: colorIsolation(crop) },
    { name: 'Grayscale', canvas: filtered(up4, 'grayscale(1) contrast(1.18)') },
    { name: 'CLAHE-like', canvas: filtered(up4, 'grayscale(1) contrast(1.55) brightness(1.05)') },
    { name: 'Mild Sharpen', canvas: filtered(up4, 'contrast(1.30) saturate(.78)') },
    { name: 'Small-dot Preservation', canvas: smallDotPreservingThreshold(up4) },
  ];
}

function thaiRatio(text) {
  const glyphs = [...String(text || '')].filter(character => /[\p{L}\p{N}]/u.test(character));
  if (!glyphs.length) return 0;
  return glyphs.filter(character => /[ก-๙๐-๙]/u.test(character)).length / glyphs.length;
}

function overlap(a = {}, b = {}) {
  const left = Math.max(Number(a.left || 0), Number(b.left || 0));
  const top = Math.max(Number(a.top || 0), Number(b.top || 0));
  const right = Math.min(Number(a.left || 0) + Number(a.width || 0), Number(b.left || 0) + Number(b.width || 0));
  const bottom = Math.min(Number(a.top || 0) + Number(a.height || 0), Number(b.top || 0) + Number(b.height || 0));
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  return intersection / Math.max(1, Math.min(Number(a.width || 1) * Number(a.height || 1), Number(b.width || 1) * Number(b.height || 1)));
}

function typeForZone(zone, text, bbox, page) {
  const type = {
    main_title: 'title',
    subtitle: 'title',
    class_level: 'class_level',
    author_name: 'person_name',
    school_name: 'school_name',
    organization_name: 'organization_name',
    footer_text: 'organization_name',
  }[zone];
  return type || classifyBlockText(text, bbox, page);
}

async function getWorker() {
  if (hardBlockWorker) return hardBlockWorker;
  if (!window.Tesseract?.createWorker) throw new Error('ระบบ Cover Hard Block OCR ยังไม่พร้อม');
  hardBlockWorker = await window.Tesseract.createWorker(['tha', 'eng'], 1, { cacheMethod: 'write' });
  await hardBlockWorker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300', tessedit_pageseg_mode: '6' });
  return hardBlockWorker;
}

async function terminateWorker() {
  const worker = hardBlockWorker;
  hardBlockWorker = null;
  await worker?.terminate();
}

async function recoverZone(source, zone, page, runId, onProgress, index, total) {
  if (runId !== activeRun) throw new Error('BOOK_OCR_CANCELLED');
  const crop = cropZone(source, zone.bbox, 0.30);
  const variants = recoveryVariants(crop);
  const worker = await getWorker();
  const attempts = [];
  try {
    for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
      if (runId !== activeRun) throw new Error('BOOK_OCR_CANCELLED');
      const variant = variants[variantIndex];
      onProgress?.({
        status: 'cover_hard_block_recovery',
        progress: 0.88 + ((index + variantIndex / variants.length) / Math.max(1, total)) * 0.10,
        label: `Hard Block Recovery ${zone.name} · ${variant.name}`,
      });
      await worker.setParameters({ tessedit_pageseg_mode: ['main_title', 'subtitle'].includes(zone.name) ? '7' : '6' });
      const response = await worker.recognize(variant.canvas);
      const rawText = String(response.data.text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
      const confidence = Math.max(0, Math.min(1, Number(response.data.confidence || 0) / 100));
      attempts.push({ name: variant.name, rawText, text: rawText, confidence });
    }
  } finally {
    variants.forEach(item => releaseCanvas(item.canvas));
    releaseCanvas(crop);
  }

  attempts.forEach(attempt => {
    const noisePenalty = looksLikeCoverIllustrationLeak(attempt.text) ? 0.55 : 0;
    attempt.score = attempt.confidence * 0.54 + thaiRatio(attempt.text) * 0.28 + (attempt.text.length >= 3 ? 0.12 : 0) - noisePenalty;
  });
  attempts.sort((a, b) => b.score - a.score);
  const best = attempts[0] || { text: '', rawText: '', confidence: 0, score: 0 };
  const type = typeForZone(zone.name, best.text, zone.bbox, page);
  const saraReview = resolveSaraAmAcrossVariants(best.text, attempts, {
    bbox: zone.bbox,
    bboxSupport: true,
    type,
    context: best.text,
    properNoun: ['person_name', 'school_name', 'organization_name'].includes(type),
    confidence: best.confidence,
    imageEvidence: attempts.length ? attempts.filter(attempt => attempt.text).length / attempts.length : 0,
    providerAgreement: attempts.length ? attempts.filter(attempt => attempt.text === best.text).length / attempts.length : 0,
  });
  const text = preserveTextSymbols(saraReview.autoFix ? saraReview.correctedText : best.text);
  const status = text && best.confidence >= 0.88 && !saraReview.requiresReview ? 'verified' : text ? 'review_required' : 'likely_non_text';
  const block = {
    id: `hard-block-recovery-${zone.name}-${index + 1}`,
    type,
    regionType: 'text',
    zone: zone.name,
    bbox: zone.bbox,
    page,
    text,
    rawText: best.rawText,
    confidence: best.confidence,
    regionConfidence: Math.max(0.25, best.score),
    status,
    requiresReview: status !== 'verified',
    reviewStatus: saraReview.issueCount ? 'broken_sara_am_review' : status,
    failureSignals: [...new Set([...(saraReview.issueCount ? ['broken_sara_am', 'broken_sara_am_review'] : []), ...(looksLikeCoverIllustrationLeak(text) ? ['cover_gibberish_review'] : [])])],
    attempts,
    candidates: [...new Set([saraReview.suggestedText, ...attempts.map(attempt => attempt.text)].filter(Boolean))].map(candidate => ({ text: candidate })),
    saraAmV21Review: saraReview,
    confidenceSummary: summarizeBlockConfidence({ text, confidence: best.confidence, regionConfidence: Math.max(0.25, best.score), bbox: zone.bbox, page, type }),
    recovered: true,
    recoveryReason: 'cover_hard_block_zone_recovery',
    userConfirmed: false,
  };
  if (looksLikeCoverIllustrationLeak(text)) {
    block.emitToEditor = false;
    block.emitToExport = false;
  }
  return block;
}

function missingExpectedZones(blocks, page) {
  const existing = new Set(blocks.filter(block => block.text && !block.doNotEmitTokens).map(block => block.zone));
  return expectedCoverZones(page).filter(zone => zone.name !== 'top_illustration' && !existing.has(zone.name));
}

export async function processBookCoverCanvas(source, configuration = {}) {
  const runId = ++activeRun;
  const baseResult = await processReviewFirstCover(source, configuration);
  const page = { width: source.width, height: source.height };
  const documentType = configuration.documentType || baseResult.documentType || 'normal_document';
  let blocks = hardBlockCoverBlocks(baseResult.blocks || [], { documentType, page });
  let sanity = coverPageSanityCheck(blocks, { documentType, page });
  const recovered = [];

  if (isCoverHardBlockDocument(documentType) && sanity.required && configuration.options?.coverHardBlockRecovery !== false) {
    const zones = missingExpectedZones(blocks, page);
    try {
      for (let index = 0; index < zones.length; index += 1) {
        const zone = zones[index];
        if (zone.name === 'top_illustration') continue;
        if (blocks.some(block => block.text && !block.doNotEmitTokens && overlap(block.bbox || {}, zone.bbox) >= 0.55)) continue;
        recovered.push(await recoverZone(source, zone, page, runId, configuration.onProgress, index, zones.length));
      }
    } finally {
      await terminateWorker();
    }
  }

  blocks = hardBlockCoverBlocks(sortReadingOrder([...blocks, ...recovered]), { documentType, page });
  sanity = coverPageSanityCheck(blocks, { documentType, page });
  const text = isCoverHardBlockDocument(documentType)
    ? strictCoverEditorOutput(blocks, { includeMarkers: true })
    : baseResult.text;
  const reviewBlocks = blocks.filter(block => !block.doNotEmitTokens && block.status !== 'confirmed_non_text' && (block.status !== 'verified' || block.requiresReview || block.failureSignals?.length));
  const confidenceValues = blocks.filter(block => block.text && !block.doNotEmitTokens).map(block => Number(block.confidence || 0));
  const confidence = confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : 0;
  const audit = coverOutputAudit(blocks);

  return {
    ...baseResult,
    text,
    confidence,
    blocks,
    documentType,
    review: { blocks: reviewBlocks, count: reviewBlocks.length },
    layout: {
      ...baseResult.layout,
      coverHardBlock: isCoverHardBlockDocument(documentType),
      coverHardBlockedCount: audit.blockedRegionCount,
      coverHardBlockRecoveryTriggered: recovered.length > 0,
      coverHardBlockRecoveredCount: recovered.filter(block => block.text).length,
      coverSanity: sanity,
      readingOrder: blocks.filter(block => !block.doNotEmitTokens).map(block => block.id),
    },
    coverHardBlock: { enabled: isCoverHardBlockDocument(documentType), audit, sanity, recoveredBlocks: recovered.length },
    pipeline: BOOK_COVER_HARD_BLOCK_PIPELINE,
  };
}

export async function cancelBookCoverOcr() {
  activeRun += 1;
  await Promise.allSettled([cancelReviewFirstCover(), terminateWorker()]);
}
