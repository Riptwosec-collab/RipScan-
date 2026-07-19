import { loadTesseract } from './lazy-libraries.mjs';
import {
  processBookCoverCanvas as processBaseBookCoverCanvas,
  cancelBookCoverOcr as cancelBaseBookCoverOcr,
} from './book-ocr-browser.mjs';
import {
  analyzeBrokenSaraAm,
  buildStructuredText,
  classifyBlockText,
  preserveTextSymbols,
  sortReadingOrder,
  summarizeBlockConfidence,
} from './book-ocr-rules.mjs';
import {
  buildCoverRecoveryPlan,
  classifyReviewFirstRegion,
  coverZoneForBox,
  needsCoverRecovery,
} from './cover-recovery-core.mjs';

let recoveryRun = 0;
let recoveryWorker = null;

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

function cloneCanvas(source) {
  const canvas = createCanvas(source.width, source.height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0);
  return canvas;
}

function cropZone(source, bbox, topPaddingRatio = 0.18) {
  const topPadding = Math.max(6, Math.round(bbox.height * topPaddingRatio));
  const sidePadding = Math.max(6, Math.round(bbox.width * 0.04));
  const bottomPadding = Math.max(4, Math.round(bbox.height * 0.10));
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

function resizeCanvas(source, scale) {
  const canvas = createCanvas(source.width * scale, source.height * scale);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function filterVariant(source, filter) {
  const canvas = createCanvas(source.width, source.height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.filter = filter;
  context.drawImage(source, 0, 0);
  context.filter = 'none';
  return canvas;
}

function colorIsolationVariant(source) {
  const canvas = cloneCanvas(source);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const r = image.data[index];
    const g = image.data[index + 1];
    const b = image.data[index + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max ? (max - min) / max : 0;
    const luminance = r * 0.299 + g * 0.587 + b * 0.114;
    const white = luminance > 172 && saturation < 0.32;
    const goldBrown = r > 92 && g > 55 && r >= g * 1.02 && g >= b * 1.12;
    const dark = luminance < 92;
    const foreground = white || goldBrown || dark;
    const value = foreground ? 0 : 255;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function softThresholdVariant(source) {
  const gray = filterVariant(source, 'grayscale(1) contrast(1.18) brightness(1.04)');
  const context = gray.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, gray.width, gray.height);
  let sum = 0;
  for (let index = 0; index < image.data.length; index += 4) sum += image.data[index];
  const mean = sum / Math.max(1, image.data.length / 4);
  for (let index = 0; index < image.data.length; index += 4) {
    const value = image.data[index] < mean - 12 ? 0 : 255;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
  return gray;
}

function recoveryVariants(crop) {
  const up4 = resizeCanvas(crop, 4);
  const up6 = resizeCanvas(crop, 6);
  return [
    { name: 'Original', canvas: cloneCanvas(crop) },
    { name: 'Upscale 4x', canvas: up4 },
    { name: 'Upscale 6x', canvas: up6 },
    { name: 'Color Isolation', canvas: colorIsolationVariant(up4) },
    { name: 'CLAHE-like Contrast', canvas: filterVariant(up4, 'grayscale(1) contrast(1.55) brightness(1.05)') },
    { name: 'Edge-preserving Sharpen', canvas: filterVariant(up4, 'contrast(1.28) saturate(.7)') },
    { name: 'Soft Binary Mask', canvas: softThresholdVariant(up4) },
  ];
}

function thaiScriptRatio(text) {
  const letters = [...String(text || '')].filter(character => /[\p{L}\p{N}]/u.test(character));
  if (!letters.length) return 0;
  return letters.filter(character => /[ก-๙๐-๙]/u.test(character)).length / letters.length;
}

function inferTypeFromZone(zone, text, bbox, page) {
  const zoneType = {
    main_title: 'title',
    subtitle: 'title',
    class_level: 'class_level',
    author_name: 'person_name',
    school_name: 'school_name',
    organization_name: 'organization_name',
    footer_text: 'organization_name',
  }[zone];
  return zoneType || classifyBlockText(text, bbox, page);
}

async function getRecoveryWorker() {
  if (recoveryWorker) return recoveryWorker;
  const tesseract = await loadTesseract();
  recoveryWorker = await tesseract.createWorker(['tha', 'eng'], 1, { cacheMethod: 'write' });
  await recoveryWorker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300', tessedit_pageseg_mode: '6' });
  return recoveryWorker;
}

async function recognizeRecoveryZone(source, zone, page, onProgress, runId, index, total) {
  if (runId !== recoveryRun) throw new Error('BOOK_OCR_CANCELLED');
  const crop = cropZone(source, zone.bbox, 0.30);
  const variants = recoveryVariants(crop);
  const worker = await getRecoveryWorker();
  const attempts = [];
  try {
    for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
      if (runId !== recoveryRun) throw new Error('BOOK_OCR_CANCELLED');
      const item = variants[variantIndex];
      onProgress?.({
        status: 'cover_recovery',
        progress: 0.86 + ((index + variantIndex / variants.length) / Math.max(1, total)) * 0.12,
        label: `Recovery ${zone.name} · ${item.name}`,
      });
      await worker.setParameters({ tessedit_pageseg_mode: ['main_title', 'subtitle'].includes(zone.name) ? '7' : '6' });
      const response = await worker.recognize(item.canvas);
      const rawText = String(response.data.text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
      const sara = analyzeBrokenSaraAm(rawText, {
        confidence: Math.max(0, Math.min(1, Number(response.data.confidence || 0) / 100)),
        bbox: zone.bbox,
        type: inferTypeFromZone(zone.name, rawText, zone.bbox, page),
        context: rawText,
      });
      const text = preserveTextSymbols(sara.correctedText || sara.normalizedText || rawText);
      attempts.push({
        name: item.name,
        rawText,
        text,
        confidence: Math.max(0, Math.min(1, Number(response.data.confidence || 0) / 100)),
        saraAm: sara,
      });
    }
  } finally {
    variants.forEach(item => releaseCanvas(item.canvas));
    releaseCanvas(crop);
  }

  const frequencies = new Map();
  attempts.forEach(attempt => {
    const key = attempt.text.replace(/\s+/gu, ' ').trim();
    if (key) frequencies.set(key, (frequencies.get(key) || 0) + 1);
  });
  attempts.forEach(attempt => {
    const agreement = attempt.text ? (frequencies.get(attempt.text.replace(/\s+/gu, ' ').trim()) || 0) / Math.max(1, attempts.length) : 0;
    attempt.score = attempt.confidence * 0.55 + thaiScriptRatio(attempt.text) * 0.20 + agreement * 0.18 + (attempt.text.length >= 3 ? 0.07 : 0);
  });
  attempts.sort((a, b) => b.score - a.score);
  const best = attempts[0] || { text: '', rawText: '', confidence: 0, score: 0, saraAm: analyzeBrokenSaraAm('') };
  const type = inferTypeFromZone(zone.name, best.text, zone.bbox, page);
  const status = classifyReviewFirstRegion({
    bbox: zone.bbox,
    zone: zone.name,
    textRegionConfidence: Math.max(0.25, best.score),
    ocrConfidence: best.confidence,
    baselineEvidence: best.text ? 0.56 : 0.18,
    connectedComponentScore: best.text ? 0.52 : 0.18,
    glyphAlignment: best.text ? 0.50 : 0.16,
    heightConsistency: 0.46,
    spacingConsistency: 0.44,
    glyphCount: [...best.text].filter(character => /[\p{L}\p{N}]/u.test(character)).length,
    ocrCandidateCount: attempts.filter(attempt => attempt.text).length,
    hasOcrCandidate: Boolean(best.text),
    hasThaiCandidate: /[ก-๙]/u.test(best.text),
    thaiScriptConfidence: thaiScriptRatio(best.text),
    foregroundContrast: 0.42,
    decorativeFont: ['main_title', 'subtitle'].includes(zone.name),
    smallText: ['school_name', 'organization_name', 'footer_text'].includes(zone.name),
  }, { zone: zone.name, page });
  const confidenceSummary = summarizeBlockConfidence({
    text: best.text,
    confidence: best.confidence,
    regionConfidence: status.confidence,
    bbox: zone.bbox,
    page,
    type,
    lowResolution: ['school_name', 'organization_name', 'footer_text'].includes(zone.name),
  });
  const candidateTexts = [...new Set(attempts.map(attempt => attempt.text).filter(Boolean))];
  return {
    id: `recovery-${zone.name}-${index + 1}`,
    type,
    regionType: 'text',
    zone: zone.name,
    bbox: zone.bbox,
    page,
    text: best.text,
    rawText: best.rawText,
    confidence: best.confidence,
    regionConfidence: status.confidence,
    status: best.text ? status.status : 'likely_non_text',
    requiresReview: best.text ? status.status !== 'verified' : true,
    failureSignals: [...new Set([...(status.reasons || []), ...(confidenceSummary.failureSignals || []), ...(best.saraAm?.issueCount ? ['broken_sara_am'] : [])])],
    attempts,
    candidates: candidateTexts.map(text => ({ text, score: attempts.find(attempt => attempt.text === text)?.score || 0, dictionarySupport: false })),
    confidenceSummary,
    recovered: true,
    recoveryReason: 'cover_zone_recovery',
    originalCropUrl: '',
    enhancedCropUrl: '',
    upscaleCropUrl: '',
    userConfirmed: false,
  };
}

function overlapRatio(a, b) {
  const left = Math.max(a.left || 0, b.left || 0);
  const top = Math.max(a.top || 0, b.top || 0);
  const right = Math.min((a.left || 0) + (a.width || 0), (b.left || 0) + (b.width || 0));
  const bottom = Math.min((a.top || 0) + (a.height || 0), (b.top || 0) + (b.height || 0));
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  return intersection / Math.max(1, Math.min((a.width || 1) * (a.height || 1), (b.width || 1) * (b.height || 1)));
}

function documentTypeForResult(result, source, configuration) {
  if (configuration.documentType) return configuration.documentType;
  const protectedCount = result.blocks.filter(block => ['title', 'class_level', 'person_name', 'school_name', 'organization_name'].includes(block.type)).length;
  const portrait = source.height >= source.width * 0.85;
  if (protectedCount || (portrait && result.blocks.length < 3)) return 'worksheet_cover';
  return 'normal_document';
}

async function terminateRecoveryWorker() {
  const worker = recoveryWorker;
  recoveryWorker = null;
  await worker?.terminate();
}

export async function processBookCoverCanvas(source, configuration = {}) {
  const runId = ++recoveryRun;
  const baseResult = await processBaseBookCoverCanvas(source, configuration);
  const page = { width: source.width, height: source.height };
  const documentType = documentTypeForResult(baseResult, source, configuration);
  const recoveryPlan = buildCoverRecoveryPlan(page, baseResult.blocks, documentType);
  if (!recoveryPlan.required || configuration.options?.coverRecovery === false) {
    return { ...baseResult, documentType, recovery: recoveryPlan, pipeline: 'book-cover-review-first-v2' };
  }

  const recovered = [];
  try {
    for (let index = 0; index < recoveryPlan.zones.length; index += 1) {
      const zone = recoveryPlan.zones[index];
      if (zone.name === 'top_illustration') continue;
      const duplicatesExisting = baseResult.blocks.some(block => overlapRatio(block.bbox || {}, zone.bbox) >= 0.55);
      if (duplicatesExisting) continue;
      recovered.push(await recognizeRecoveryZone(source, zone, page, configuration.onProgress, runId, index, recoveryPlan.zones.length));
    }
  } finally {
    await terminateRecoveryWorker();
  }

  const merged = sortReadingOrder([...baseResult.blocks, ...recovered]);
  const reviewBlocks = merged.filter(block => block.status !== 'verified' || block.requiresReview || block.failureSignals?.length);
  const text = buildStructuredText(merged);
  const confidenceValues = merged.filter(block => block.text).map(block => Number(block.confidence || 0));
  const confidence = confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : 0;
  const finalRecovery = needsCoverRecovery(documentType, merged);
  return {
    ...baseResult,
    text,
    confidence,
    blocks: merged,
    documentType,
    review: { blocks: reviewBlocks, count: reviewBlocks.length },
    layout: {
      ...baseResult.layout,
      recoveryTriggered: true,
      recoveryZones: recoveryPlan.zones.map(zone => zone.name),
      recoveredBlockCount: recovered.filter(block => block.text).length,
      remainingRecoveryReasons: finalRecovery.reasons,
      readingOrder: merged.map(block => block.id),
    },
    recovery: { ...recoveryPlan, recoveredBlocks: recovered.length, remaining: finalRecovery },
    pipeline: 'book-cover-review-first-v2',
  };
}

export async function cancelBookCoverOcr() {
  recoveryRun += 1;
  await Promise.allSettled([cancelBaseBookCoverOcr(), terminateRecoveryWorker()]);
}
