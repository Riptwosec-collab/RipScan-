const jobs = new Map();

function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }

function otsu(gray) {
  const histogram = new Uint32Array(256);
  for (const value of gray) histogram[value] += 1;
  const total = gray.length;
  let weighted = 0;
  for (let index = 0; index < 256; index += 1) weighted += index * histogram[index];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let best = -1;
  let threshold = 180;
  for (let index = 0; index < 256; index += 1) {
    backgroundWeight += histogram[index];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += index * histogram[index];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weighted - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > best) { best = variance; threshold = index; }
  }
  return clamp(threshold + 20, 110, 230);
}

function cluster(values, tolerance) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return [];
  const groups = [[sorted[0]]];
  for (const value of sorted.slice(1)) {
    const group = groups[groups.length - 1];
    const center = group.reduce((sum, item) => sum + item, 0) / group.length;
    if (Math.abs(value - center) <= tolerance) group.push(value);
    else groups.push([value]);
  }
  return groups.map(group => Math.round(group.reduce((sum, item) => sum + item, 0) / group.length));
}

function longestRun(binary, width, height, position, horizontal, gapTolerance = 3) {
  const length = horizontal ? width : height;
  let best = 0;
  let current = 0;
  let gaps = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const index = horizontal ? position * width + offset : offset * width + position;
    if (binary[index]) { current += gaps + 1; gaps = 0; best = Math.max(best, current); }
    else if (current && gaps < gapTolerance) gaps += 1;
    else { current = 0; gaps = 0; }
  }
  return best;
}

function segmentsAt(binary, width, height, position, horizontal, gapTolerance = 4, minLength = 8) {
  const length = horizontal ? width : height;
  const result = [];
  let start = -1;
  let lastDark = -1;
  let gaps = 0;
  for (let offset = 0; offset < length; offset += 1) {
    const index = horizontal ? position * width + offset : offset * width + position;
    if (binary[index]) {
      if (start < 0) start = offset;
      lastDark = offset;
      gaps = 0;
    } else if (start >= 0 && gaps < gapTolerance) gaps += 1;
    else if (start >= 0) {
      if (lastDark - start + 1 >= minLength) result.push({ position, start, end: lastDark, strength: (lastDark - start + 1) / length });
      start = -1; lastDark = -1; gaps = 0;
    }
  }
  if (start >= 0 && lastDark - start + 1 >= minLength) result.push({ position, start, end: lastDark, strength: (lastDark - start + 1) / length });
  return result;
}

function lineEvidence(binary, width, height) {
  const horizontalCandidates = [];
  const verticalCandidates = [];
  const horizontalMinimum = Math.max(30, width * .18);
  const verticalMinimum = Math.max(30, height * .20);
  for (let y = 0; y < height; y += 1) if (longestRun(binary, width, height, y, true) >= horizontalMinimum) horizontalCandidates.push(y);
  for (let x = 0; x < width; x += 1) if (longestRun(binary, width, height, x, false) >= verticalMinimum) verticalCandidates.push(x);
  const tolerance = Math.max(2, Math.round(Math.max(width, height) / 600));
  const horizontalLines = cluster(horizontalCandidates, tolerance);
  const verticalLines = cluster(verticalCandidates, tolerance);
  const horizontalSegments = horizontalLines.flatMap(position => segmentsAt(binary, width, height, position, true, tolerance + 1, Math.max(10, width * .05)));
  const verticalSegments = verticalLines.flatMap(position => segmentsAt(binary, width, height, position, false, tolerance + 1, Math.max(10, height * .05)));
  return { horizontalLines, verticalLines, horizontalSegments, verticalSegments, tolerance };
}

function releaseCanvas(canvas) { canvas.width = 1; canvas.height = 1; }

async function bitmapFromPayload(payload) {
  if (payload.bitmap) return payload.bitmap;
  if (payload.blob) return createImageBitmap(payload.blob);
  throw new Error('TABLE_IMAGE_MISSING');
}

async function detectGrid(payload, signal) {
  const bitmap = await bitmapFromPayload(payload);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  const scale = Math.min(1, 1800 / Math.max(originalWidth, originalHeight));
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  if (signal.cancelled) throw new Error('TABLE_TASK_CANCELLED');
  const image = context.getImageData(0, 0, width, height);
  const gray = new Uint8Array(width * height);
  for (let source = 0, target = 0; source < image.data.length; source += 4, target += 1) {
    gray[target] = Math.round(image.data[source] * .299 + image.data[source + 1] * .587 + image.data[source + 2] * .114);
  }
  const threshold = otsu(gray);
  const binary = new Uint8Array(gray.length);
  for (let index = 0; index < gray.length; index += 1) binary[index] = gray[index] <= threshold ? 1 : 0;
  const evidence = lineEvidence(binary, width, height);
  const inverse = 1 / scale;
  const result = {
    width: originalWidth,
    height: originalHeight,
    threshold,
    horizontalLines: evidence.horizontalLines.map(value => Math.round(value * inverse)),
    verticalLines: evidence.verticalLines.map(value => Math.round(value * inverse)),
    horizontalSegments: evidence.horizontalSegments.map(segment => ({ ...segment, position: Math.round(segment.position * inverse), start: Math.round(segment.start * inverse), end: Math.round(segment.end * inverse) })),
    verticalSegments: evidence.verticalSegments.map(segment => ({ ...segment, position: Math.round(segment.position * inverse), start: Math.round(segment.start * inverse), end: Math.round(segment.end * inverse) })),
  };
  image.data.fill(0); gray.fill(0); binary.fill(0); releaseCanvas(canvas);
  return result;
}

function contrastSoft(image) {
  const output = new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
  for (let index = 0; index < output.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) output.data[index + channel] = clamp((output.data[index + channel] - 128) * 1.28 + 128, 0, 255);
  }
  return output;
}

function softenLines(context, width, height) {
  context.save();
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = 'rgba(255,255,255,.88)';
  const edge = Math.max(1, Math.round(Math.min(width, height) * .018));
  context.fillRect(0, 0, width, edge);
  context.fillRect(0, height - edge, width, edge);
  context.fillRect(0, 0, edge, height);
  context.fillRect(width - edge, 0, edge, height);
  context.restore();
}

async function cropCell(payload, signal) {
  const bitmap = await bitmapFromPayload(payload);
  const box = payload.box || {};
  const padding = Math.max(2, Number(payload.padding ?? 5));
  const sx = clamp(Math.floor(Number(box.x ?? box.left ?? 0) - padding), 0, bitmap.width - 1);
  const sy = clamp(Math.floor(Number(box.y ?? box.top ?? 0) - padding), 0, bitmap.height - 1);
  const sw = clamp(Math.ceil(Number(box.width || 1) + padding * 2), 1, bitmap.width - sx);
  const sh = clamp(Math.ceil(Number(box.height || 1) + padding * 2), 1, bitmap.height - sy);
  const variant = payload.variant || 'original';
  const scale = variant === 'upscale3' ? 3 : variant === 'contrast_soft' || variant === 'line_soft' ? 2 : 1;
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)));
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: variant === 'contrast_soft' });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  if (signal.cancelled) throw new Error('TABLE_TASK_CANCELLED');
  if (variant === 'line_soft') softenLines(context, canvas.width, canvas.height);
  if (variant === 'contrast_soft') {
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const adjusted = contrastSoft(image);
    context.putImageData(adjusted, 0, 0);
    image.data.fill(0); adjusted.data.fill(0);
  }
  const blob = await canvas.convertToBlob({ type: 'image/png', quality: .96 });
  releaseCanvas(canvas);
  return { blob, variant, width: Math.round(sw * scale), height: Math.round(sh * scale) };
}

self.addEventListener('message', async event => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    const signal = jobs.get(message.jobId);
    if (signal) signal.cancelled = true;
    return;
  }
  if (message.type === 'dispose') {
    for (const signal of jobs.values()) signal.cancelled = true;
    jobs.clear();
    return;
  }
  const signal = { cancelled: false };
  jobs.set(message.jobId, signal);
  try {
    const result = message.type === 'detect-grid'
      ? await detectGrid(message.payload || {}, signal)
      : message.type === 'crop-cell'
        ? await cropCell(message.payload || {}, signal)
        : (() => { throw new Error('TABLE_WORKER_TASK_UNKNOWN'); })();
    if (signal.cancelled) throw new Error('TABLE_TASK_CANCELLED');
    self.postMessage({ jobId: message.jobId, ok: true, result });
  } catch (error) {
    self.postMessage({ jobId: message.jobId, ok: false, error: error?.message || String(error) });
  } finally {
    jobs.delete(message.jobId);
  }
});
