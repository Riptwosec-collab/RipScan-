const jobs = new Map();

function ensureNotCancelled(jobId) {
  if (jobs.get(jobId)?.cancelled) {
    const error = new Error('CANCELLED');
    error.name = 'AbortError';
    throw error;
  }
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  try {
    const context = canvas.getContext('2d');
    context?.clearRect(0, 0, canvas.width, canvas.height);
  } catch {}
  canvas.width = 0;
  canvas.height = 0;
}

function projectionScore(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const rows = new Float64Array(canvas.height);
  let totalDark = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    let count = 0;
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4;
      const gray = image.data[offset] * .299 + image.data[offset + 1] * .587 + image.data[offset + 2] * .114;
      if (gray < 165) count += 1;
    }
    rows[y] = count;
    totalDark += count;
  }
  image.data.fill(0);
  if (totalDark < canvas.width * canvas.height * .003) return 0;
  const mean = totalDark / rows.length;
  let variance = 0;
  for (const value of rows) variance += (value - mean) ** 2;
  return variance / rows.length;
}

function rotate(source, angle, expand = true) {
  if (Math.abs(angle) < .01) {
    const clone = new OffscreenCanvas(source.width, source.height);
    clone.getContext('2d', { alpha: false }).drawImage(source, 0, 0);
    return clone;
  }
  const radians = angle * Math.PI / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const width = Math.max(1, Math.round(expand ? source.width * cos + source.height * sin : source.width));
  const height = Math.max(1, Math.round(expand ? source.width * sin + source.height * cos : source.height));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.translate(width / 2, height / 2);
  context.rotate(radians);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function detectDeskew(source, jobId) {
  const scale = Math.min(1, 640 / Math.max(source.width, source.height));
  const sample = new OffscreenCanvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
  const context = sample.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, sample.width, sample.height);
  context.drawImage(source, 0, 0, sample.width, sample.height);
  let bestAngle = 0;
  let bestScore = -1;
  for (let angle = -4; angle <= 4; angle += 1) {
    ensureNotCancelled(jobId);
    const candidate = rotate(sample, angle, false);
    const score = projectionScore(candidate);
    releaseCanvas(candidate);
    if (score > bestScore) { bestScore = score; bestAngle = angle; }
  }
  releaseCanvas(sample);
  return Math.abs(bestAngle) < 1 ? 0 : bestAngle;
}

function resize(source, maxSide, upscale = 1) {
  const baseScale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const scale = Math.max(.25, baseScale * Math.max(1, upscale));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

function enhance(source) {
  const canvas = new OffscreenCanvas(source.width, source.height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.filter = 'grayscale(1) contrast(1.45) brightness(1.05)';
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0);
  context.filter = 'none';
  return canvas;
}

function otsuThreshold(imageData) {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < imageData.data.length; index += 4) histogram[imageData.data[index]] += 1;
  const total = imageData.data.length / 4;
  let sum = 0;
  for (let level = 0; level < 256; level += 1) sum += level * histogram[level];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let maxVariance = -1;
  let threshold = 160;
  for (let level = 0; level < 256; level += 1) {
    backgroundWeight += histogram[level];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += level * histogram[level];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > maxVariance) { maxVariance = variance; threshold = level; }
  }
  return threshold;
}

function threshold(source, preserveSmallMarks = false) {
  const canvas = new OffscreenCanvas(source.width, source.height);
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const value = Math.round(data[index] * .299 + data[index + 1] * .587 + data[index + 2] * .114);
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  const cutoff = otsuThreshold(image) + (preserveSmallMarks ? 16 : 0);
  for (let index = 0; index < data.length; index += 4) {
    const value = data[index] > cutoff ? 255 : 0;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }
  context.putImageData(image, 0, 0);
  image.data.fill(0);
  return canvas;
}

async function canvasBlob(canvas, type = 'image/jpeg', quality = .88) {
  return canvas.convertToBlob({ type, quality });
}

async function process(message) {
  const { jobId, bitmap, mode = 'base', maxSide = 2200 } = message;
  jobs.set(jobId, { cancelled: false });
  const canvases = [];
  try {
    ensureNotCancelled(jobId);
    const source = resize(bitmap, maxSide, 1);
    canvases.push(source);
    bitmap.close?.();
    const deskewAngle = detectDeskew(source, jobId);
    const corrected = rotate(source, deskewAngle, true);
    canvases.push(corrected);
    const variants = [];
    if (mode === 'base') {
      const enhanced = enhance(corrected);
      canvases.push(enhanced);
      variants.push({ name: deskewAngle ? 'ต้นฉบับ + ปรับเอียง' : 'ต้นฉบับ', blob: await canvasBlob(corrected) });
      variants.push({ name: 'ลด Noise + Contrast', blob: await canvasBlob(enhanced) });
    } else if (mode === 'threshold') {
      const binary = threshold(corrected, false);
      canvases.push(binary);
      variants.push({ name: 'Threshold ขาวดำ', blob: await canvasBlob(binary, 'image/png', 1) });
    } else if (mode === 'sara-am') {
      const upscaled = resize(corrected, Math.min(3600, maxSide * 2), 2);
      const preserved = threshold(upscaled, true);
      canvases.push(upscaled, preserved);
      variants.push({ name: 'Upscale 4x', blob: await canvasBlob(upscaled) });
      variants.push({ name: 'Small-mark Preservation', blob: await canvasBlob(preserved, 'image/png', 1) });
    }
    ensureNotCancelled(jobId);
    postMessage({ type: 'result', jobId, deskewAngle, variants });
  } finally {
    for (const canvas of canvases) releaseCanvas(canvas);
    try { bitmap.close?.(); } catch {}
    jobs.delete(jobId);
  }
}

self.addEventListener('message', event => {
  const message = event.data || {};
  if (message.type === 'cancel') {
    const job = jobs.get(message.jobId);
    if (job) job.cancelled = true;
    return;
  }
  if (message.type === 'dispose') {
    for (const job of jobs.values()) job.cancelled = true;
    jobs.clear();
    close();
    return;
  }
  if (message.type === 'process') process(message).catch(error => postMessage({ type: 'error', jobId: message.jobId, name: error.name, message: error.message || String(error) }));
});
