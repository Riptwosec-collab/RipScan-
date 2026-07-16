const jobs = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
}

async function bitmapFromPayload(payload) {
  if (payload.bitmap) return payload.bitmap;
  if (payload.blob) return createImageBitmap(payload.blob, { imageOrientation: 'from-image' });
  throw new Error('PDF_IMAGE_PAYLOAD_MISSING');
}

function containRect(sourceWidth, sourceHeight, targetWidth, targetHeight, mode = 'contain') {
  if (mode === 'stretch') return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  const scale = mode === 'cover'
    ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
    : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
}

async function resizeImage(payload, signal) {
  const bitmap = await bitmapFromPayload(payload);
  try {
    if (signal.cancelled) throw new Error('PDF_TOOL_CANCELLED');
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    const maxSide = Math.max(64, Number(payload.maxSide) || 0);
    const requestedWidth = Math.max(1, Number(payload.width) || 0);
    const requestedHeight = Math.max(1, Number(payload.height) || 0);
    let width = requestedWidth;
    let height = requestedHeight;
    if (!width && !height && maxSide) {
      const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
      width = Math.max(1, Math.round(sourceWidth * scale));
      height = Math.max(1, Math.round(sourceHeight * scale));
    } else if (payload.keepAspect !== false) {
      if (width && !height) height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
      else if (height && !width) width = Math.max(1, Math.round(height * sourceWidth / sourceHeight));
      else if (width && height) {
        const fit = containRect(sourceWidth, sourceHeight, width, height, payload.fit || 'contain');
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d', { alpha: payload.transparent === true });
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        if (!payload.transparent) {
          context.fillStyle = payload.background || '#ffffff';
          context.fillRect(0, 0, width, height);
        }
        context.drawImage(bitmap, fit.x, fit.y, fit.width, fit.height);
        if (signal.cancelled) throw new Error('PDF_TOOL_CANCELLED');
        const blob = await canvas.convertToBlob({ type: payload.mime || 'image/jpeg', quality: clamp(payload.quality ?? .9, .1, 1) });
        releaseCanvas(canvas);
        return { blob, width, height, sourceWidth, sourceHeight };
      }
    }
    width ||= sourceWidth;
    height ||= sourceHeight;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { alpha: payload.transparent === true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (!payload.transparent) {
      context.fillStyle = payload.background || '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0, width, height);
    if (payload.grayscale) {
      const image = context.getImageData(0, 0, width, height);
      for (let index = 0; index < image.data.length; index += 4) {
        const value = Math.round(image.data[index] * .299 + image.data[index + 1] * .587 + image.data[index + 2] * .114);
        image.data[index] = value;
        image.data[index + 1] = value;
        image.data[index + 2] = value;
      }
      context.putImageData(image, 0, 0);
      image.data.fill(0);
    }
    if (signal.cancelled) throw new Error('PDF_TOOL_CANCELLED');
    const blob = await canvas.convertToBlob({ type: payload.mime || 'image/jpeg', quality: clamp(payload.quality ?? .9, .1, 1) });
    releaseCanvas(canvas);
    return { blob, width, height, sourceWidth, sourceHeight };
  } finally {
    bitmap.close?.();
  }
}

async function thumbnail(payload, signal) {
  return resizeImage({
    ...payload,
    maxSide: Math.max(96, Number(payload.maxSide) || 320),
    mime: payload.mime || 'image/webp',
    quality: payload.quality ?? .78,
    keepAspect: true,
    transparent: false,
  }, signal);
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
    const result = message.type === 'resize-image'
      ? await resizeImage(message.payload || {}, signal)
      : message.type === 'thumbnail'
        ? await thumbnail(message.payload || {}, signal)
        : (() => { throw new Error('PDF_TOOL_WORKER_TASK_UNKNOWN'); })();
    if (signal.cancelled) throw new Error('PDF_TOOL_CANCELLED');
    self.postMessage({ jobId: message.jobId, ok: true, result });
  } catch (error) {
    self.postMessage({ jobId: message.jobId, ok: false, error: error?.message || String(error) });
  } finally {
    jobs.delete(message.jobId);
  }
});
