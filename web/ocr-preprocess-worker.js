const jobs = new Map();
const cancelledJobs = new Set();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const emit = (type, detail = {}) => self.postMessage({ type, ...detail });

function assertActive(jobId) {
  if (cancelledJobs.has(jobId)) {
    const error = new Error('OCR_CANCELLED');
    error.code = 'OCR_CANCELLED';
    throw error;
  }
}

function makeCanvas(width, height) {
  return new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
}

function grayscaleData(imageData) {
  const gray = new Uint8Array(imageData.width * imageData.height);
  for (let source = 0, target = 0; source < imageData.data.length; source += 4, target += 1) {
    gray[target] = Math.round(imageData.data[source] * 0.299 + imageData.data[source + 1] * 0.587 + imageData.data[source + 2] * 0.114);
  }
  return gray;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[clamp(Math.floor(sorted.length * ratio), 0, sorted.length - 1)];
}

function groupActive(values, threshold, minLength = 2, gapTolerance = 2) {
  const groups = [];
  let start = -1;
  let last = -1;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] >= threshold) {
      if (start < 0) start = index;
      last = index;
    } else if (start >= 0 && index - last > gapTolerance) {
      if (last - start + 1 >= minLength) groups.push([start, last]);
      start = -1;
      last = -1;
    }
  }
  if (start >= 0 && last - start + 1 >= minLength) groups.push([start, last]);
  return groups;
}

function analyzeRows(gray, width, height) {
  const edgeEnergy = new Float64Array(height);
  const components = new Float64Array(height);
  const contrast = new Float64Array(height);
  for (let y = 1; y < height - 1; y += 1) {
    let edge = 0;
    let runs = 0;
    let previousDark = false;
    let min = 255;
    let max = 0;
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value = gray[index];
      min = Math.min(min, value);
      max = Math.max(max, value);
      const gradient = Math.abs(gray[index + 1] - gray[index - 1]) + Math.abs(gray[index + width] - gray[index - width]);
      if (gradient > 42) edge += gradient;
      const dark = value < 105 || value > 220;
      if (dark && !previousDark) runs += 1;
      previousDark = dark;
    }
    edgeEnergy[y] = edge / Math.max(1, width);
    components[y] = runs / Math.max(1, width / 18);
    contrast[y] = (max - min) / 255;
  }
  return { edgeEnergy, components, contrast };
}

function inferCover(gray, width, height, requestedType) {
  if (requestedType && requestedType !== 'auto' && requestedType !== 'normal_document') return requestedType;
  const topHeight = Math.max(1, Math.floor(height * 0.44));
  const lowerStart = Math.floor(height * 0.48);
  let topVariation = 0;
  let lowerVariation = 0;
  let topSamples = 0;
  let lowerSamples = 0;
  const step = Math.max(2, Math.floor(Math.min(width, height) / 220));
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const index = y * width + x;
      const local = Math.abs(gray[index + 1] - gray[index - 1]) + Math.abs(gray[index + width] - gray[index - width]);
      if (y <= topHeight) { topVariation += local; topSamples += 1; }
      else if (y >= lowerStart) { lowerVariation += local; lowerSamples += 1; }
    }
  }
  const top = topVariation / Math.max(1, topSamples);
  const lower = lowerVariation / Math.max(1, lowerSamples);
  const portrait = height > width * 1.12;
  return portrait && top > lower * 1.12 && top > 24 ? 'illustrated_cover' : 'normal_document';
}

function coverZones(width, height) {
  const zone = (name, top, bottom) => ({
    id: `zone-${name}`,
    zone: name,
    bbox: { left: Math.round(width * 0.06), top: Math.round(height * top), width: Math.round(width * 0.88), height: Math.max(1, Math.round(height * (bottom - top))) },
  });
  return [
    { ...zone('top_illustration', 0, 0.44), regionType: 'illustration', status: 'confirmed_non_text', doNotEmitTokens: true, expectedText: false },
    { ...zone('main_title', 0.43, 0.61), regionType: 'text', decorativeFont: true, expectedText: true },
    { ...zone('class_level', 0.60, 0.71), regionType: 'text', expectedText: true },
    { ...zone('author_name', 0.70, 0.82), regionType: 'text', expectedText: true },
    { ...zone('school_name', 0.81, 0.91), regionType: 'text', smallText: true, expectedText: true },
    { ...zone('organization_name', 0.90, 1), regionType: 'text', smallText: true, expectedText: true },
  ];
}

function segmentTextBands(gray, width, height) {
  const { edgeEnergy, components, contrast } = analyzeRows(gray, width, height);
  const energyValues = [...edgeEnergy].filter(value => value > 0);
  const componentValues = [...components].filter(value => value > 0);
  const energyThreshold = Math.max(6, percentile(energyValues, 0.58));
  const componentThreshold = Math.max(0.16, percentile(componentValues, 0.54));
  const activity = [...edgeEnergy].map((value, index) => value >= energyThreshold && components[index] >= componentThreshold ? value : 0);
  const bands = groupActive(activity, energyThreshold, 3, 3);
  const regions = [];
  for (const [start, end] of bands) {
    const top = Math.max(0, start - 5);
    const bottom = Math.min(height - 1, end + 5);
    const averageEdge = edgeEnergy.slice(start, end + 1).reduce((sum, value) => sum + value, 0) / Math.max(1, end - start + 1);
    const averageComponents = components.slice(start, end + 1).reduce((sum, value) => sum + value, 0) / Math.max(1, end - start + 1);
    const averageContrast = contrast.slice(start, end + 1).reduce((sum, value) => sum + value, 0) / Math.max(1, end - start + 1);
    const bbox = { left: Math.round(width * 0.025), top, width: Math.round(width * 0.95), height: bottom - top + 1 };
    regions.push({
      id: `band-${regions.length + 1}`,
      zone: 'text_band',
      regionType: 'text',
      bbox,
      width: bbox.width,
      height: bbox.height,
      baselineEvidence: clamp(averageEdge / Math.max(12, energyThreshold * 1.4), 0, 1),
      horizontalGlyphScore: clamp(averageComponents / 1.2, 0, 1),
      connectedComponentScore: clamp(averageComponents, 0, 1),
      spacingConsistency: clamp(averageComponents * 0.9, 0, 1),
      foregroundContrast: clamp(averageContrast, 0, 1),
      lineCount: 1,
      estimatedTextHeight: bbox.height,
    });
  }
  return regions;
}

async function initializeJob(message) {
  const { jobId, bitmap, maxSide = 2200, documentType = 'auto' } = message;
  assertActive(jobId);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = makeCanvas(bitmap.width * scale, bitmap.height * scale);
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  jobs.set(jobId, { canvas, scale, originalWidth: Math.round(canvas.width / scale), originalHeight: Math.round(canvas.height / scale), documentType });
  emit('initialized', { requestId: message.requestId, jobId, width: canvas.width, height: canvas.height, scale });
}

async function segmentJob(message) {
  const { jobId, requestId } = message;
  assertActive(jobId);
  const job = jobs.get(jobId);
  if (!job) throw new Error('JOB_NOT_INITIALIZED');
  const context = job.canvas.getContext('2d', { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, job.canvas.width, job.canvas.height);
  const gray = grayscaleData(imageData);
  const detectedType = inferCover(gray, job.canvas.width, job.canvas.height, message.documentType || job.documentType);
  const cover = /cover|poster/u.test(detectedType);
  const rawRegions = cover ? coverZones(job.canvas.width, job.canvas.height) : segmentTextBands(gray, job.canvas.width, job.canvas.height);
  const regions = rawRegions.map(region => ({
    ...region,
    bbox: {
      left: Math.round(region.bbox.left / job.scale),
      top: Math.round(region.bbox.top / job.scale),
      width: Math.round(region.bbox.width / job.scale),
      height: Math.round(region.bbox.height / job.scale),
    },
  }));
  imageData.data.fill(0);
  emit('segmented', { requestId, jobId, documentType: detectedType, regions, skipped: regions.filter(item => item.doNotEmitTokens).length });
}

function drawCrop(job, bbox, padding = {}) {
  const scale = job.scale;
  const left = clamp(Math.floor((bbox.left || 0) * scale - Number(padding.left || 0)), 0, job.canvas.width - 1);
  const top = clamp(Math.floor((bbox.top || 0) * scale - Number(padding.top || 0)), 0, job.canvas.height - 1);
  const right = clamp(Math.ceil(((bbox.left || 0) + (bbox.width || 1)) * scale + Number(padding.right || 0)), left + 1, job.canvas.width);
  const bottom = clamp(Math.ceil(((bbox.top || 0) + (bbox.height || 1)) * scale + Number(padding.bottom || 0)), top + 1, job.canvas.height);
  const canvas = makeCanvas(right - left, bottom - top);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(job.canvas, left, top, right - left, bottom - top, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function resize(source, scale) {
  const canvas = makeCanvas(source.width * scale, source.height * scale);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function filtered(source, filter) {
  const canvas = makeCanvas(source.width, source.height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.filter = filter;
  context.drawImage(source, 0, 0);
  context.filter = 'none';
  return canvas;
}

function smallMark(source) {
  const gray = filtered(source, 'grayscale(1) contrast(1.18) brightness(1.04)');
  const context = gray.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, gray.width, gray.height);
  let sum = 0;
  for (let index = 0; index < image.data.length; index += 4) sum += image.data[index];
  const mean = sum / Math.max(1, image.data.length / 4);
  const threshold = mean - 8;
  for (let index = 0; index < image.data.length; index += 4) {
    const value = image.data[index] < threshold ? 0 : 255;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
  image.data.fill(0);
  return gray;
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
    const saturation = max ? (max - min) / max : 0;
    const luminance = r * 0.299 + g * 0.587 + b * 0.114;
    const foreground = (r > 95 && g > 52 && r >= g && g > b * 1.05) || (luminance > 170 && saturation < 0.34) || luminance < 95;
    const value = foreground ? 0 : 255;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
  image.data.fill(0);
  return canvas;
}

function makeVariant(crop, name) {
  if (name === 'original') return resize(crop, 1);
  if (name === 'upscale2') return resize(crop, 2);
  if (name === 'upscale4') return resize(crop, 4);
  if (name === 'clahe') return filtered(resize(crop, 4), 'grayscale(1) contrast(1.45) brightness(1.04)');
  if (name === 'small_mark') return smallMark(resize(crop, 4));
  if (name === 'color_isolation') return colorIsolation(crop);
  return resize(crop, 1);
}

async function preprocessRegion(message) {
  const { jobId, requestId, bbox, variants = ['original', 'upscale2'], saraAmSuspected = false } = message;
  assertActive(jobId);
  const job = jobs.get(jobId);
  if (!job) throw new Error('JOB_NOT_INITIALIZED');
  const topPadding = Math.max(6, Math.round((bbox.height || 1) * (saraAmSuspected ? 0.30 : 0.18) * job.scale));
  const sidePadding = Math.max(5, Math.round((bbox.width || 1) * 0.06 * job.scale));
  const bottomPadding = Math.max(4, Math.round((bbox.height || 1) * 0.14 * job.scale));
  const crop = drawCrop(job, bbox, { top: topPadding, left: sidePadding, right: sidePadding, bottom: bottomPadding });
  const output = [];
  try {
    for (let index = 0; index < variants.length; index += 1) {
      assertActive(jobId);
      const name = variants[index];
      const canvas = makeVariant(crop, name);
      try {
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        output.push({ name, blob, width: canvas.width, height: canvas.height });
        emit('progress', { jobId, stage: 'preprocess', completed: index + 1, total: variants.length });
      } finally {
        releaseCanvas(canvas);
      }
    }
  } finally {
    releaseCanvas(crop);
  }
  emit('preprocessed', { requestId, jobId, variants: output });
}

function disposeJob(jobId) {
  const job = jobs.get(jobId);
  releaseCanvas(job?.canvas);
  jobs.delete(jobId);
  cancelledJobs.delete(jobId);
}

self.onmessage = async event => {
  const message = event.data || {};
  try {
    if (message.type === 'init') await initializeJob(message);
    else if (message.type === 'segment') await segmentJob(message);
    else if (message.type === 'preprocess') await preprocessRegion(message);
    else if (message.type === 'cancel') {
      cancelledJobs.add(message.jobId);
      disposeJob(message.jobId);
      emit('cancelled', { requestId: message.requestId, jobId: message.jobId });
    } else if (message.type === 'dispose') {
      disposeJob(message.jobId);
      emit('disposed', { requestId: message.requestId, jobId: message.jobId });
    }
  } catch (error) {
    emit('error', { requestId: message.requestId, jobId: message.jobId, code: error.code || error.message || 'WORKER_ERROR', message: error.message || String(error) });
  }
};
