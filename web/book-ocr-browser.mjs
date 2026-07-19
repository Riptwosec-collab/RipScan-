import { loadTesseract } from './lazy-libraries.mjs';
import {
  DEFAULT_BOOK_OCR_OPTIONS,
  analyzeRegionFeatures,
  analyzeSaraAm,
  analyzeThaiGraphemes,
  buildStructuredText,
  classifyBlockText,
  detectFailureSignals,
  languageForBlock,
  normalizeThaiUnicodeDetailed,
  rankCandidates,
  shouldRetryBlock,
  sortReadingOrder,
  summarizeBlockConfidence,
} from './book-ocr-core.mjs';

const MAX_SEGMENT_SIDE = 1500;
const MAX_OCR_VARIANTS = 6;
const MIN_BLOCK_WIDTH = 24;
const MIN_BLOCK_HEIGHT = 7;
const workerCache = new Map();
let activeRun = 0;

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

function cropCanvas(source, bbox, padding = 0) {
  const left = Math.max(0, Math.floor((bbox.left ?? bbox.x ?? 0) - padding));
  const top = Math.max(0, Math.floor((bbox.top ?? bbox.y ?? 0) - padding));
  const width = Math.min(source.width - left, Math.ceil((bbox.width || 1) + padding * 2));
  const height = Math.min(source.height - top, Math.ceil((bbox.height || 1) + padding * 2));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, left, top, width, height, 0, 0, width, height);
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

function getLuminance(source) {
  const context = source.getContext('2d', { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, source.width, source.height);
  const gray = new Uint8Array(source.width * source.height);
  const blue = new Uint8Array(gray.length);
  for (let sourceIndex = 0, pixel = 0; sourceIndex < imageData.data.length; sourceIndex += 4, pixel += 1) {
    const r = imageData.data[sourceIndex];
    const g = imageData.data[sourceIndex + 1];
    const b = imageData.data[sourceIndex + 2];
    gray[pixel] = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
    blue[pixel] = b;
  }
  return { gray, blue, imageData };
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)))];
}

function meanAndDeviation(values) {
  if (!values.length) return { mean: 0, deviation: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  return { mean, deviation };
}

function groupActive(values, threshold, minLength = 2, gapTolerance = 2) {
  const groups = [];
  let start = null;
  let lastActive = null;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] >= threshold) {
      if (start === null) start = index;
      lastActive = index;
    } else if (start !== null && lastActive !== null && index - lastActive > gapTolerance) {
      if (lastActive - start + 1 >= minLength) groups.push([start, lastActive]);
      start = null;
      lastActive = null;
    }
  }
  if (start !== null && lastActive - start + 1 >= minLength) groups.push([start, lastActive]);
  return groups;
}

function overlapRatio(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  if (right <= left || bottom <= top) return 0;
  const intersection = (right - left) * (bottom - top);
  return intersection / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

function mergeNearbyBoxes(boxes, pageWidth, pageHeight) {
  const sorted = [...boxes].sort((a, b) => a.top - b.top || a.left - b.left);
  const output = [];
  for (const box of sorted) {
    const previous = output[output.length - 1];
    if (previous) {
      const verticalGap = box.top - (previous.top + previous.height);
      const horizontalOverlap = Math.max(0, Math.min(previous.left + previous.width, box.left + box.width) - Math.max(previous.left, box.left));
      const overlap = horizontalOverlap / Math.max(1, Math.min(previous.width, box.width));
      const similarAlignment = Math.abs(previous.left - box.left) < pageWidth * 0.04 || Math.abs((previous.left + previous.width) - (box.left + box.width)) < pageWidth * 0.04;
      if (verticalGap >= -4 && verticalGap <= Math.max(14, Math.min(previous.height, box.height) * 0.8) && overlap > 0.48 && similarAlignment) {
        const right = Math.max(previous.left + previous.width, box.left + box.width);
        const bottom = Math.max(previous.top + previous.height, box.top + box.height);
        previous.left = Math.min(previous.left, box.left);
        previous.top = Math.min(previous.top, box.top);
        previous.width = right - previous.left;
        previous.height = bottom - previous.top;
        previous.lineCount = (previous.lineCount || 1) + (box.lineCount || 1);
        previous.textLineScore = Math.max(previous.textLineScore, box.textLineScore);
        previous.connectedComponentScore = Math.max(previous.connectedComponentScore, box.connectedComponentScore);
        continue;
      }
    }
    output.push({ ...box });
  }
  return output.filter(box => box.width >= MIN_BLOCK_WIDTH && box.height >= MIN_BLOCK_HEIGHT && box.width <= pageWidth && box.height <= pageHeight * 0.72);
}

function estimateBarcodeScore(gray, width, height, bbox) {
  const left = Math.max(0, Math.floor(bbox.left));
  const right = Math.min(width - 1, Math.ceil(bbox.left + bbox.width));
  const top = Math.max(0, Math.floor(bbox.top));
  const bottom = Math.min(height - 1, Math.ceil(bbox.top + bbox.height));
  if (right - left < 40 || bottom - top < 18) return 0;
  let transitions = 0;
  let samples = 0;
  let verticalConsistency = 0;
  const rowStep = Math.max(1, Math.floor((bottom - top) / 10));
  for (let y = top; y <= bottom; y += rowStep) {
    let rowTransitions = 0;
    let previous = gray[y * width + left] < 128;
    for (let x = left + 1; x <= right; x += 1) {
      const current = gray[y * width + x] < 128;
      if (current !== previous) rowTransitions += 1;
      previous = current;
    }
    transitions += rowTransitions / Math.max(1, right - left);
    samples += 1;
  }
  const columnStep = Math.max(1, Math.floor((right - left) / 30));
  for (let x = left; x <= right; x += columnStep) {
    let dark = 0;
    for (let y = top; y <= bottom; y += 1) if (gray[y * width + x] < 128) dark += 1;
    const ratio = dark / Math.max(1, bottom - top + 1);
    if (ratio > 0.65 || ratio < 0.12) verticalConsistency += 1;
  }
  const transitionScore = Math.min(1, (transitions / Math.max(1, samples)) * 5);
  const consistencyScore = Math.min(1, verticalConsistency / Math.max(1, Math.ceil((right - left) / columnStep)) * 1.8);
  const aspectScore = Math.min(1, bbox.width / Math.max(1, bbox.height) / 2.5);
  return transitionScore * 0.48 + consistencyScore * 0.34 + aspectScore * 0.18;
}

function segmentTextRegions(source, excludedBoxes = []) {
  const scale = Math.min(1, MAX_SEGMENT_SIDE / Math.max(source.width, source.height));
  const sample = scale < 1 ? resizeCanvas(source, scale) : cloneCanvas(source);
  const { gray } = getLuminance(sample);
  const width = sample.width;
  const height = sample.height;
  const rowEnergy = new Float64Array(height);
  const rowComponents = new Float64Array(height);

  for (let y = 1; y < height - 1; y += 1) {
    let energy = 0;
    let components = 0;
    let inDark = false;
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const gx = Math.abs(gray[index + 1] - gray[index - 1]);
      const gy = Math.abs(gray[index + width] - gray[index - width]);
      const edge = gx + gy;
      if (edge > 44) energy += edge;
      const local = gray[index] < 92 || gray[index] > 215;
      if (local && !inDark) components += 1;
      inDark = local;
    }
    rowEnergy[y] = energy / Math.max(1, width);
    rowComponents[y] = components / Math.max(1, width / 20);
  }

  const activeEnergy = [...rowEnergy].filter(value => value > 0);
  const energyThreshold = Math.max(7, percentile(activeEnergy, 0.58));
  const componentThreshold = Math.max(0.18, percentile([...rowComponents], 0.56));
  const activity = [...rowEnergy].map((value, index) => value >= energyThreshold && rowComponents[index] >= componentThreshold ? value : 0);
  const bands = groupActive(activity, energyThreshold, 3, 3);
  const boxes = [];

  for (const [startY, endY] of bands) {
    const expandedTop = Math.max(0, startY - 4);
    const expandedBottom = Math.min(height - 1, endY + 4);
    const columnEnergy = new Float64Array(width);
    for (let x = 1; x < width - 1; x += 1) {
      let energy = 0;
      for (let y = expandedTop; y <= expandedBottom; y += 1) {
        const index = y * width + x;
        const gx = Math.abs(gray[index + 1] - gray[index - 1]);
        const gy = y > 0 && y < height - 1 ? Math.abs(gray[index + width] - gray[index - width]) : 0;
        if (gx + gy > 42) energy += gx + gy;
      }
      columnEnergy[x] = energy / Math.max(1, expandedBottom - expandedTop + 1);
    }
    const threshold = Math.max(7, percentile([...columnEnergy].filter(Boolean), 0.54));
    let groups = groupActive([...columnEnergy], threshold, 3, Math.max(3, Math.floor(width * 0.008)));
    if (!groups.length) groups = [[0, width - 1]];
    if (groups.length > 7) groups = [[groups[0][0], groups[groups.length - 1][1]]];

    for (const [startX, endX] of groups) {
      const bbox = {
        left: Math.max(0, Math.floor((startX - 6) / scale)),
        top: Math.max(0, Math.floor((expandedTop - 4) / scale)),
        width: Math.min(source.width, Math.ceil((endX - startX + 13) / scale)),
        height: Math.min(source.height, Math.ceil((expandedBottom - expandedTop + 9) / scale)),
      };
      const excluded = excludedBoxes.some(box => overlapRatio(bbox, box) > 0.22);
      if (excluded) continue;
      const bandHeight = Math.max(1, expandedBottom - expandedTop + 1);
      const textLineScore = Math.min(1, rowEnergy.slice(startY, endY + 1).reduce((sum, value) => sum + value, 0) / Math.max(1, endY - startY + 1) / Math.max(12, energyThreshold * 1.35));
      const connectedComponentScore = Math.min(1, rowComponents.slice(startY, endY + 1).reduce((sum, value) => sum + value, 0) / Math.max(1, endY - startY + 1));
      const barcodeScore = estimateBarcodeScore(gray, width, height, { left: startX, top: expandedTop, width: endX - startX + 1, height: bandHeight });
      const region = analyzeRegionFeatures({ textLineScore, connectedComponentScore, texture: 0.25, colorVariance: 0.3, barcodeScore });
      if (region.action === 'skip_text_ocr') continue;
      boxes.push({ ...bbox, textLineScore, connectedComponentScore, barcodeScore, regionType: region.regionType, regionConfidence: region.confidence, lineCount: 1 });
    }
  }

  releaseCanvas(sample);
  const merged = mergeNearbyBoxes(boxes, source.width, source.height);
  if (!merged.length) {
    return [{ left: 0, top: 0, width: source.width, height: source.height, textLineScore: 0.35, connectedComponentScore: 0.25, barcodeScore: 0, regionType: 'unknown', regionConfidence: 0.35, fallback: true }];
  }
  return merged;
}

async function detectBarcodes(source) {
  const barcodes = [];
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats?.() || [];
      const formats = ['ean_13', 'qr_code'].filter(format => !supported.length || supported.includes(format));
      const detector = new window.BarcodeDetector({ formats: formats.length ? formats : undefined });
      const detected = await detector.detect(source);
      for (const item of detected) {
        const box = item.boundingBox || {};
        barcodes.push({
          type: item.format === 'qr_code' ? 'qr_code' : 'barcode',
          format: item.format,
          value: item.rawValue || '',
          bbox: { left: box.x || 0, top: box.y || 0, width: box.width || 1, height: box.height || 1 },
          action: 'barcode_reader',
          confidence: 1,
        });
      }
    } catch (error) {
      console.warn('BarcodeDetector unavailable for this image', error);
    }
  }
  return barcodes;
}

function grayscaleVariant(source) {
  const canvas = cloneCanvas(source);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const value = Math.round(imageData.data[index] * 0.299 + imageData.data[index + 1] * 0.587 + imageData.data[index + 2] * 0.114);
    imageData.data[index] = value;
    imageData.data[index + 1] = value;
    imageData.data[index + 2] = value;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function contrastVariant(source, contrast = 1.35, brightness = 1.03) {
  const canvas = createCanvas(source.width, source.height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.filter = `grayscale(1) contrast(${contrast}) brightness(${brightness})`;
  context.drawImage(source, 0, 0);
  context.filter = 'none';
  return canvas;
}

function blueChannelVariant(source) {
  const canvas = cloneCanvas(source);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const b = imageData.data[index + 2];
    const r = imageData.data[index];
    const g = imageData.data[index + 1];
    const value = Math.max(0, Math.min(255, 128 + (b - (r + g) / 2) * 1.8));
    imageData.data[index] = value;
    imageData.data[index + 1] = value;
    imageData.data[index + 2] = value;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function boxBlurGray(gray, width, height, radius) {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      row += gray[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + row;
    }
  }
  const output = new Uint8Array(gray.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const top = Math.max(0, y - radius);
      const right = Math.min(width - 1, x + radius);
      const bottom = Math.min(height - 1, y + radius);
      const sum = integral[(bottom + 1) * (width + 1) + right + 1] - integral[top * (width + 1) + right + 1] - integral[(bottom + 1) * (width + 1) + left] + integral[top * (width + 1) + left];
      output[y * width + x] = Math.round(sum / ((right - left + 1) * (bottom - top + 1)));
    }
  }
  return output;
}

function flattenedVariant(source) {
  const canvas = cloneCanvas(source);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const gray = new Uint8Array(canvas.width * canvas.height);
  for (let sourceIndex = 0, pixel = 0; sourceIndex < imageData.data.length; sourceIndex += 4, pixel += 1) gray[pixel] = Math.round(imageData.data[sourceIndex] * 0.299 + imageData.data[sourceIndex + 1] * 0.587 + imageData.data[sourceIndex + 2] * 0.114);
  const background = boxBlurGray(gray, canvas.width, canvas.height, Math.max(4, Math.round(Math.min(canvas.width, canvas.height) / 30)));
  for (let pixel = 0, target = 0; pixel < gray.length; pixel += 1, target += 4) {
    const value = Math.max(0, Math.min(255, 128 + (gray[pixel] - background[pixel]) * 2.25));
    imageData.data[target] = value;
    imageData.data[target + 1] = value;
    imageData.data[target + 2] = value;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function adaptiveThresholdVariant(source, preserveDots = true) {
  const grayCanvas = grayscaleVariant(source);
  const context = grayCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, grayCanvas.width, grayCanvas.height);
  const gray = new Uint8Array(grayCanvas.width * grayCanvas.height);
  for (let sourceIndex = 0, pixel = 0; sourceIndex < imageData.data.length; sourceIndex += 4, pixel += 1) gray[pixel] = imageData.data[sourceIndex];
  const radius = Math.max(5, Math.round(Math.min(grayCanvas.width, grayCanvas.height) / 36));
  const background = boxBlurGray(gray, grayCanvas.width, grayCanvas.height, radius);
  const bias = preserveDots ? 9 : 14;
  for (let pixel = 0, target = 0; pixel < gray.length; pixel += 1, target += 4) {
    const value = gray[pixel] < background[pixel] - bias ? 0 : 255;
    imageData.data[target] = value;
    imageData.data[target + 1] = value;
    imageData.data[target + 2] = value;
  }
  context.putImageData(imageData, 0, 0);
  return grayCanvas;
}

function sharpenVariant(source) {
  const canvas = cloneCanvas(source);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const copy = new Uint8ClampedArray(imageData.data);
  const width = canvas.width;
  const height = canvas.height;
  const kernel = [0, -0.45, 0, -0.45, 2.8, -0.45, 0, -0.45, 0];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let value = 0;
        let kernelIndex = 0;
        for (let ky = -1; ky <= 1; ky += 1) for (let kx = -1; kx <= 1; kx += 1) value += copy[((y + ky) * width + x + kx) * 4 + channel] * kernel[kernelIndex++];
        imageData.data[(y * width + x) * 4 + channel] = Math.max(0, Math.min(255, value));
      }
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function makeVariants(crop, estimatedTextHeight) {
  const variants = [];
  const original = cloneCanvas(crop);
  variants.push({ name: 'Original Crop', canvas: original });
  variants.push({ name: 'Grayscale', canvas: grayscaleVariant(crop) });
  variants.push({ name: 'CLAHE-like Contrast', canvas: contrastVariant(crop, 1.45, 1.04) });
  variants.push({ name: 'Local Contrast Normalized', canvas: contrastVariant(flattenedVariant(crop), 1.28, 1.02) });
  variants.push({ name: 'Background Flattened', canvas: flattenedVariant(crop) });
  variants.push({ name: 'Blue Channel Enhanced', canvas: blueChannelVariant(crop) });
  variants.push({ name: 'Adaptive Threshold · Preserve Dots', canvas: adaptiveThresholdVariant(crop, true) });
  const scale3 = resizeCanvas(crop, 3);
  variants.push({ name: 'Upscale 3x', canvas: scale3 });
  const scale4 = resizeCanvas(crop, 4);
  variants.push({ name: 'Upscale 4x', canvas: scale4 });
  variants.push({ name: 'Mild Sharpen', canvas: sharpenVariant(estimatedTextHeight < 14 ? scale3 : crop) });
  return variants;
}

async function getWorker(language, onProgress) {
  const key = language === 'number' ? 'eng-number' : language;
  if (workerCache.has(key)) return workerCache.get(key);
  const langs = language === 'eng' || language === 'number' ? ['eng'] : language === 'tha+eng' ? ['tha', 'eng'] : ['tha'];
  const tesseract = await loadTesseract();
  const worker = await tesseract.createWorker(langs, 1, { cacheMethod: 'write', logger: onProgress });
  await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300', tessedit_pageseg_mode: '6' });
  workerCache.set(key, worker);
  return worker;
}

async function terminateWorkers() {
  const workers = [...workerCache.values()];
  workerCache.clear();
  await Promise.allSettled(workers.map(worker => worker.terminate()));
}

function scriptFit(text, language) {
  const thai = (String(text).match(/[ก-๙]/gu) || []).length;
  const latin = (String(text).match(/[A-Za-z]/g) || []).length;
  if (language === 'tha') return thai + latin ? thai / (thai + latin) : 0.5;
  if (language === 'eng' || language === 'number') return thai + latin ? latin / (thai + latin) : 0.7;
  return 0.9;
}

function scoreAttempt(attempt, language) {
  const grapheme = analyzeThaiGraphemes(attempt.text);
  const saraAm = analyzeSaraAm(attempt.text, attempt.confidence);
  const signals = detectFailureSignals(attempt.text, null, attempt.confidence);
  const dictionaryWords = attempt.text.split(/\s+/u).filter(Boolean);
  const ranked = rankCandidates(dictionaryWords, { confidences: Object.fromEntries(dictionaryWords.map(word => [word, attempt.confidence])), imageEvidence: Object.fromEntries(dictionaryWords.map(word => [word, attempt.confidence])) });
  const dictionarySupport = ranked.some(item => item.dictionarySupport) ? 1 : 0;
  return attempt.confidence * 0.48 + scriptFit(attempt.text, language) * 0.18 + grapheme.graphemeConfidence * 0.15 + saraAm.saraAmConfidence * 0.09 + dictionarySupport * 0.06 - signals.length * 0.04;
}

async function recognizeVariant(variant, language, label, onProgress) {
  const worker = await getWorker(language, message => onProgress?.({ ...message, label, variant: variant.name }));
  const numeric = language === 'number';
  if (numeric) await worker.setParameters({ tessedit_char_whitelist: '0123456789๐๑๒๓๔๕๖๗๘๙ISBNisbnXx-–—−_/|:.,()฿ บาท', tessedit_pageseg_mode: '6' });
  else await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' });
  const response = await worker.recognize(variant.canvas);
  const rawText = String(response.data.text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{4,}/g, '\n\n\n').trim();
  const normalized = normalizeThaiUnicodeDetailed(rawText);
  return { name: variant.name, rawText, text: normalized.normalizedText, normalizationChanges: normalized.changes, confidence: Math.max(0, Math.min(1, Number(response.data.confidence || 0) / 100)) };
}

function chooseVariantSubset(variants, estimatedTextHeight, retry = false) {
  const preferred = estimatedTextHeight < 14
    ? ['Original Crop', 'Local Contrast Normalized', 'Adaptive Threshold · Preserve Dots', 'Upscale 3x', 'Upscale 4x', 'Mild Sharpen']
    : ['Original Crop', 'CLAHE-like Contrast', 'Background Flattened', 'Blue Channel Enhanced', 'Adaptive Threshold · Preserve Dots', 'Mild Sharpen'];
  const count = retry ? MAX_OCR_VARIANTS : Math.min(4, MAX_OCR_VARIANTS);
  return preferred.map(name => variants.find(item => item.name === name)).filter(Boolean).slice(0, count);
}

function canvasPreview(canvas, maxSide = 900) {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const preview = scale < 1 ? resizeCanvas(canvas, scale) : canvas;
  const url = preview.toDataURL('image/jpeg', 0.88);
  if (preview !== canvas) releaseCanvas(preview);
  return url;
}

async function processBlock(source, region, index, page, options, onProgress, runId) {
  if (runId !== activeRun) throw new Error('BOOK_OCR_CANCELLED');
  const padding = Math.max(6, Math.round(region.height * 0.18));
  const crop = cropCanvas(source, region, padding);
  const estimatedTextHeight = Math.max(1, region.height / Math.max(1, region.lineCount || 1));
  const lowResolution = estimatedTextHeight < 6 || crop.width < 28;
  const originalCropUrl = canvasPreview(crop);
  if (lowResolution) {
    const upscale = resizeCanvas(crop, 4);
    const result = {
      id: `block-${index + 1}`,
      type: 'unknown', regionType: 'text', bbox: { left: region.left, top: region.top, width: region.width, height: region.height },
      text: '', confidence: 0, regionConfidence: region.regionConfidence, language: 'tha', bestVariant: 'Upscale 4x', attempts: [],
      originalCropUrl, enhancedCropUrl: canvasPreview(upscale), upscaleCropUrl: canvasPreview(upscale),
      estimatedTextHeight, lowResolution: true, requiresReview: true, failureSignals: ['low_resolution_no_guess'], candidates: [],
    };
    releaseCanvas(upscale); releaseCanvas(crop);
    return result;
  }

  const variants = makeVariants(crop, estimatedTextHeight);
  const initialLanguage = region.regionType === 'barcode' ? 'barcode' : 'tha';
  if (initialLanguage === 'barcode') {
    variants.forEach(item => releaseCanvas(item.canvas)); releaseCanvas(crop);
    return { id: `block-${index + 1}`, type: 'barcode', regionType: 'barcode', bbox: region, text: '', confidence: 0, language: 'barcode', requiresReview: true, failureSignals: ['barcode_reader_required'], originalCropUrl };
  }

  const attempts = [];
  for (const variant of chooseVariantSubset(variants, estimatedTextHeight, false)) {
    if (runId !== activeRun) throw new Error('BOOK_OCR_CANCELLED');
    attempts.push(await recognizeVariant(variant, initialLanguage, `Block ${index + 1}`, onProgress));
  }
  let best = [...attempts].sort((a, b) => scoreAttempt(b, initialLanguage) - scoreAttempt(a, initialLanguage))[0];
  let type = classifyBlockText(best.text, region, page);
  let language = languageForBlock(type, best.text);
  const preliminary = { text: best.text, confidence: best.confidence, bbox: region, type };
  const retry = shouldRetryBlock(preliminary);

  if (retry.retry || language !== initialLanguage) {
    const retryLanguage = ['isbn', 'phone', 'price'].includes(type) ? 'number' : language;
    for (const variant of chooseVariantSubset(variants, estimatedTextHeight, true)) {
      if (attempts.some(item => item.name === variant.name) && retryLanguage === initialLanguage) continue;
      if (runId !== activeRun) throw new Error('BOOK_OCR_CANCELLED');
      attempts.push({ ...await recognizeVariant(variant, retryLanguage, `Block ${index + 1} · retry`, onProgress), language: retryLanguage });
    }
    best = [...attempts].sort((a, b) => scoreAttempt(b, retryLanguage) - scoreAttempt(a, retryLanguage))[0];
    type = classifyBlockText(best.text, region, page);
    language = languageForBlock(type, best.text);
  }

  const candidateTexts = [...new Set(attempts.map(item => item.text).filter(Boolean))];
  const candidates = rankCandidates(candidateTexts, {
    confidences: Object.fromEntries(attempts.map(item => [item.text, item.confidence])),
    imageEvidence: Object.fromEntries(attempts.map(item => [item.text, item.confidence])),
    providerAgreement: Object.fromEntries(candidateTexts.map(text => [text, attempts.filter(item => item.text === text).length / Math.max(1, attempts.length)])),
  });
  const confidenceSummary = summarizeBlockConfidence({ text: best.text, confidence: best.confidence, regionConfidence: region.regionConfidence, bbox: region, type });
  const selectedCanvas = variants.find(item => item.name === best.name)?.canvas || crop;
  const upscaleCanvas = variants.find(item => item.name === 'Upscale 4x')?.canvas || selectedCanvas;
  const result = {
    id: `block-${index + 1}`,
    type,
    regionType: 'text',
    bbox: { left: region.left, top: region.top, width: region.width, height: region.height },
    text: best.text,
    rawText: best.rawText,
    confidence: best.confidence,
    regionConfidence: region.regionConfidence,
    language,
    bestVariant: best.name,
    attempts: attempts.map(item => ({ name: item.name, text: item.text, confidence: item.confidence, language: item.language || initialLanguage, normalizationChanges: item.normalizationChanges })),
    originalCropUrl,
    enhancedCropUrl: canvasPreview(selectedCanvas),
    upscaleCropUrl: canvasPreview(upscaleCanvas),
    estimatedTextHeight,
    lowResolution: false,
    requiresReview: confidenceSummary.requiresReview,
    failureSignals: confidenceSummary.failureSignals,
    candidates: candidates.slice(0, 8),
    confidenceSummary,
  };
  variants.forEach(item => releaseCanvas(item.canvas));
  releaseCanvas(crop);
  return result;
}

function mergeBarcodeData(barcodes, blocks) {
  return barcodes.map(barcode => {
    const nearby = blocks.filter(block => block.type === 'isbn' || block.type === 'price').sort((a, b) => {
      const ay = a.bbox.top + a.bbox.height / 2;
      const by = b.bbox.top + b.bbox.height / 2;
      const cy = barcode.bbox.top + barcode.bbox.height / 2;
      return Math.abs(ay - cy) - Math.abs(by - cy);
    });
    return {
      ...barcode,
      isbn: nearby.find(block => block.type === 'isbn')?.text || '',
      price: nearby.find(block => block.type === 'price')?.text || '',
    };
  });
}

export async function processBookCoverCanvas(source, configuration = {}) {
  const runId = ++activeRun;
  const options = { ...DEFAULT_BOOK_OCR_OPTIONS, ...(configuration.options || {}) };
  const onProgress = configuration.onProgress;
  const page = { width: source.width, height: source.height };
  onProgress?.({ status: 'layout', progress: 0.04, label: 'ตรวจ Text/Image/Barcode Region' });
  const detectedBarcodes = await detectBarcodes(source);
  const regions = segmentTextRegions(source, detectedBarcodes.map(item => item.bbox));
  const skippedRegions = regions.filter(region => region.regionType === 'image');
  const textRegions = regions.filter(region => ['text', 'unknown'].includes(region.regionType));
  const blocks = [];
  try {
    for (let index = 0; index < textRegions.length; index += 1) {
      onProgress?.({ status: 'block', progress: 0.08 + index / Math.max(1, textRegions.length) * 0.86, label: `อ่าน Block ${index + 1}/${textRegions.length}` });
      const block = await processBlock(source, textRegions[index], index, page, options, onProgress, runId);
      if (block.text || block.requiresReview) blocks.push(block);
    }
  } finally {
    await terminateWorkers();
  }
  const orderedBlocks = sortReadingOrder(blocks);
  const barcodes = mergeBarcodeData(detectedBarcodes, orderedBlocks);
  const text = buildStructuredText(orderedBlocks, options);
  const confidences = orderedBlocks.filter(block => block.text).map(block => block.confidence);
  const confidence = confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0;
  const reviewBlocks = orderedBlocks.filter(block => block.requiresReview || block.lowResolution || block.failureSignals?.length);
  onProgress?.({ status: 'complete', progress: 1, label: 'จัด Reading Order และผลตรวจภาษาไทยแล้ว' });
  return {
    text,
    confidence,
    blocks: orderedBlocks,
    barcodes,
    skippedImageRegions: skippedRegions.length,
    layout: { regionCount: regions.length, textRegionCount: textRegions.length, barcodeCount: barcodes.length, readingOrder: orderedBlocks.map(block => block.id) },
    review: { blocks: reviewBlocks, count: reviewBlocks.length },
    pipeline: 'book-cover-segmented-v1',
    options,
  };
}

export function cancelBookCoverOcr() {
  activeRun += 1;
  return terminateWorkers();
}
