import {
  buildStructuredText,
  classifyBlockText,
  languageForBlock,
  preserveTextSymbols,
  rankCandidates,
  sortReadingOrder,
  summarizeBlockConfidence,
} from './book-ocr-rules.mjs';
import {
  coverOutputAudit,
  hardBlockCoverBlocks,
  isCoverHardBlockDocument,
  looksLikeCoverIllustrationLeak,
  strictCoverEditorOutput,
} from './cover-hard-block.mjs';
import { resolveSaraAmAcrossVariants } from './sara-am-recovery-v21.mjs';
import {
  CircuitBreaker,
  OCR_LIMITS,
  OCR_PERFORMANCE_VERSION,
  concurrencyFor,
  createJobMetrics,
  finishJobMetrics,
  gibberishAssessment,
  progressivePercent,
  shouldOcrRegion,
  stableRegionHash,
  variantPlan,
  withTimeout,
} from './ocr-performance-core.mjs';
import {
  processBookCoverCanvas as processLegacy,
  cancelBookCoverOcr as cancelLegacy,
} from './book-ocr-browser-hard-block.mjs';

export const BOOK_COVER_PERFORMANCE_PIPELINE = `book-cover-performance-v${OCR_PERFORMANCE_VERSION}`;

let activeRun = 0;
let activeClient = null;
let activePool = null;
const activeObjectUrls = new Set();

const normalizeText = value => String(value || '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
const clamp01 = value => Math.max(0, Math.min(1, Number(value || 0)));

function profile() {
  return {
    deviceMemory: Number(navigator.deviceMemory || 0),
    hardwareConcurrency: Number(navigator.hardwareConcurrency || 2),
    screenWidth: Number(window.screen?.width || window.innerWidth || 0),
    pointerCoarse: window.matchMedia?.('(pointer: coarse)').matches === true,
  };
}

function dispatchProgress(detail) {
  window.dispatchEvent(new CustomEvent('ripscan:ocr-progress', { detail }));
}

function emitProgress(configuration, detail) {
  const payload = { timestamp: performance.now(), ...detail };
  configuration.onProgress?.(payload);
  dispatchProgress(payload);
}

function supportsPerformancePipeline() {
  return typeof Worker === 'function'
    && typeof createImageBitmap === 'function'
    && typeof OffscreenCanvas === 'function'
    && Boolean(window.Tesseract?.createWorker);
}

class PreprocessClient {
  constructor() {
    this.worker = new Worker('/ocr-preprocess-worker.js');
    this.pending = new Map();
    this.sequence = 0;
    this.worker.addEventListener('message', event => {
      const message = event.data || {};
      if (message.type === 'progress') {
        window.dispatchEvent(new CustomEvent('ripscan:preprocess-progress', { detail: message }));
        return;
      }
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      if (message.type === 'error') {
        this.pending.delete(message.requestId);
        const error = new Error(message.message || message.code || 'PREPROCESS_WORKER_ERROR');
        error.code = message.code;
        pending.reject(error);
        return;
      }
      if (['initialized', 'segmented', 'preprocessed', 'disposed', 'cancelled'].includes(message.type)) {
        this.pending.delete(message.requestId);
        pending.resolve(message);
      }
    });
    this.worker.addEventListener('error', event => {
      const error = new Error(event.message || 'PREPROCESS_WORKER_CRASH');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  request(type, payload = {}, transfer = []) {
    const requestId = `p${++this.sequence}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({ type, requestId, ...payload }, transfer);
    });
  }

  init(jobId, bitmap, documentType) {
    return this.request('init', { jobId, bitmap, documentType, maxSide: OCR_LIMITS.fastPassMaxSide }, [bitmap]);
  }
  segment(jobId, documentType) { return this.request('segment', { jobId, documentType }); }
  preprocess(jobId, bbox, variants, saraAmSuspected = false) {
    return this.request('preprocess', { jobId, bbox, variants, saraAmSuspected });
  }
  dispose(jobId) { return this.request('dispose', { jobId }).catch(() => null); }
  cancel(jobId) { return this.request('cancel', { jobId }).catch(() => null); }
  terminate() {
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(new Error('OCR_CANCELLED'));
    this.pending.clear();
  }
}

class TesseractPool {
  constructor(count, metrics, onLogger) {
    this.count = count;
    this.metrics = metrics;
    this.onLogger = onLogger;
    this.slots = [];
    this.cancelled = false;
    this.breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 });
  }

  async start() {
    for (let index = 0; index < this.count; index += 1) this.slots.push(await this.createSlot(index));
  }

  async createSlot(index) {
    const worker = await window.Tesseract.createWorker(['tha', 'eng'], 1, {
      cacheMethod: 'write',
      logger: message => this.onLogger?.({ ...message, workerIndex: index }),
    });
    await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300', tessedit_pageseg_mode: '6' });
    return { index, worker, tail: Promise.resolve(), pending: 0, generation: 0 };
  }

  pickSlot() {
    return [...this.slots].sort((a, b) => a.pending - b.pending || a.index - b.index)[0];
  }

  async restartSlot(slot) {
    try { await slot.worker?.terminate(); } catch {}
    this.metrics.workerRestarts += 1;
    const replacement = await this.createSlot(slot.index);
    slot.worker = replacement.worker;
    slot.generation += 1;
  }

  run(task) {
    if (this.cancelled) return Promise.reject(new Error('OCR_CANCELLED'));
    if (!this.breaker.canRun()) return Promise.reject(new Error('OCR_CIRCUIT_OPEN'));
    const slot = this.pickSlot();
    slot.pending += 1;
    const execute = async () => {
      if (this.cancelled) throw new Error('OCR_CANCELLED');
      try {
        const result = await task(slot);
        this.breaker.success();
        return result;
      } catch (error) {
        this.breaker.failure();
        throw error;
      } finally {
        slot.pending = Math.max(0, slot.pending - 1);
      }
    };
    const promise = slot.tail.then(execute, execute);
    slot.tail = promise.catch(() => undefined);
    return promise;
  }

  async cancel() {
    this.cancelled = true;
    await Promise.allSettled(this.slots.map(slot => slot.worker?.terminate()));
    this.slots.length = 0;
  }
}

function thaiRatio(text) {
  const characters = [...String(text || '')].filter(character => /[\p{L}\p{N}]/u.test(character));
  return characters.length ? characters.filter(character => /[ก-๙๐-๙]/u.test(character)).length / characters.length : 0;
}

function typeForRegion(region, text, page) {
  const zoneType = {
    main_title: 'title',
    subtitle: 'title',
    class_level: 'class_level',
    author_name: 'person_name',
    student_name: 'person_name',
    school_name: 'school_name',
    organization_name: 'organization_name',
  }[region.zone];
  return zoneType || classifyBlockText(text, region.bbox, page);
}

function languageFor(type, text) {
  if (['isbn', 'phone', 'price'].includes(type)) return 'number';
  return languageForBlock(type, text) || 'tha';
}

function scoreAttempt(attempt, region) {
  const gibberish = gibberishAssessment(attempt.text, {
    confidence: attempt.confidence,
    regionType: region.regionType,
    hasBaseline: region.baselineEvidence !== 0,
  });
  const lengthScore = attempt.text.length >= 3 ? 0.08 : 0;
  return attempt.confidence * 0.58 + thaiRatio(attempt.text) * 0.20 + lengthScore - gibberish.score * 0.35;
}

async function recognizeBlob(pool, blob, language, label, timeoutMs, metrics) {
  return pool.run(async slot => {
    const numeric = language === 'number';
    const psm = label.includes('main_title') ? '7' : '6';
    await slot.worker.setParameters({
      tessedit_pageseg_mode: psm,
      tessedit_char_whitelist: numeric ? '0123456789๐๑๒๓๔๕๖๗๘๙ISBNisbnXx-–—−_/|:.,()฿ บาท' : '',
    });
    try {
      const response = await withTimeout(
        () => slot.worker.recognize(blob),
        timeoutMs,
        () => { metrics.timedOut += 1; },
      );
      return {
        rawText: normalizeText(response.data.text || ''),
        text: normalizeText(response.data.text || ''),
        confidence: clamp01(Number(response.data.confidence || 0) / 100),
      };
    } catch (error) {
      if (error.code === 'OCR_TIMEOUT' || error.message === 'OCR_TIMEOUT') await pool.restartSlot(slot);
      throw error;
    }
  });
}

function observeLongTasks(metrics) {
  if (typeof PerformanceObserver !== 'function') return null;
  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) metrics.mainThreadLongTaskMs += Number(entry.duration || 0);
    });
    observer.observe({ type: 'longtask', buffered: true });
    return observer;
  } catch { return null; }
}

function sampleMemory(metrics) {
  const used = Number(performance.memory?.usedJSHeapSize || 0);
  if (used) metrics.peakMemoryBytes = Math.max(Number(metrics.peakMemoryBytes || 0), used);
}

function createReviewUrls(variantResults, requiresReview) {
  if (!requiresReview || !variantResults.length) return { originalCropUrl: '', enhancedCropUrl: '', upscaleCropUrl: '' };
  const first = variantResults[0]?.blob;
  const best = variantResults[variantResults.length - 1]?.blob || first;
  const make = blob => {
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    activeObjectUrls.add(url);
    return url;
  };
  return { originalCropUrl: make(first), enhancedCropUrl: make(best), upscaleCropUrl: make(best) };
}

async function processRegion({ client, pool, jobId, region, index, total, page, configuration, runId, metrics, cache, fileHash }) {
  if (runId !== activeRun) throw new Error('BOOK_OCR_CANCELLED');
  const policy = shouldOcrRegion(region, { isCover: isCoverHardBlockDocument(configuration.documentType) });
  if (!policy.allow) {
    metrics.regionsSkipped += 1;
    return {
      id: region.id || `skip-${index + 1}`,
      ...region,
      text: '', rawText: '', status: 'confirmed_non_text', action: 'skip_text_ocr',
      doNotEmitTokens: true, emitToEditor: false, emitToExport: false,
      hardBlockReason: policy.reason,
    };
  }

  metrics.regionsOcr += 1;
  const fastVariants = variantPlan(region, 'fast');
  const fastPrepared = await client.preprocess(jobId, region.bbox, fastVariants, false);
  metrics.variantsCreated += fastPrepared.variants.length;
  const attempts = [];
  const runVariants = async (prepared, phase) => {
    for (const variant of prepared.variants) {
      if (runId !== activeRun) throw new Error('BOOK_OCR_CANCELLED');
      const hash = stableRegionHash({ fileHash, pageNumber: configuration.pageNumber, bbox: region.bbox, variant: variant.name, language: 'tha+eng' });
      let recognized = cache.get(hash);
      if (recognized) metrics.cacheHits += 1;
      else {
        recognized = await recognizeBlob(pool, variant.blob, 'tha+eng', `${region.zone || 'block'}-${phase}`, phase === 'retry' ? OCR_LIMITS.retryTimeoutMs : OCR_LIMITS.regionTimeoutMs, metrics);
        cache.set(hash, recognized);
      }
      attempts.push({ name: variant.name, blob: variant.blob, language: 'tha+eng', phase, ...recognized });
    }
  };
  await runVariants(fastPrepared, 'fast');

  let best = [...attempts].sort((a, b) => scoreAttempt(b, region) - scoreAttempt(a, region))[0] || { text: '', rawText: '', confidence: 0 };
  let type = typeForRegion(region, best.text, page);
  let language = languageFor(type, best.text);
  let saraReview = resolveSaraAmAcrossVariants(best.text, attempts, {
    bbox: region.bbox,
    bboxSupport: true,
    type,
    properNoun: ['person_name', 'school_name', 'organization_name', 'place_name'].includes(type),
    confidence: best.confidence,
    imageEvidence: attempts.filter(item => /ำ/u.test(item.text)).length / Math.max(1, attempts.length),
    providerAgreement: attempts.filter(item => item.text === best.text).length / Math.max(1, attempts.length),
  });
  const assessment = gibberishAssessment(best.text, { confidence: best.confidence, regionType: region.regionType, hasBaseline: policy.evidence.flags.baseline });
  const retryNeeded = best.confidence < 0.88 || assessment.gibberish || saraReview.issueCount > 0;

  if (retryNeeded) {
    metrics.retries += 1;
    emitProgress(configuration, {
      status: 'retry_low_confidence', stage: 'retry', page: configuration.pageNumber || 1,
      block: index + 1, totalBlocks: total, textRegions: metrics.regionsOcr, skippedRegions: metrics.regionsSkipped,
      retryRegions: metrics.retries, progress: progressivePercent('retry', index, total),
      label: `Retry เฉพาะ Block ${index + 1}`,
    });
    const retryNames = variantPlan({ ...region, lowConfidence: true, saraAmSuspected: saraReview.issueCount > 0 }, 'retry');
    const remaining = retryNames.filter(name => !attempts.some(item => item.name === name)).slice(0, Math.max(0, 4 - attempts.length));
    if (remaining.length) {
      const retryPrepared = await client.preprocess(jobId, region.bbox, remaining, saraReview.issueCount > 0);
      metrics.variantsCreated += retryPrepared.variants.length;
      await runVariants(retryPrepared, 'retry');
    }
    best = [...attempts].sort((a, b) => scoreAttempt(b, region) - scoreAttempt(a, region))[0] || best;
    type = typeForRegion(region, best.text, page);
    language = languageFor(type, best.text);
    saraReview = resolveSaraAmAcrossVariants(best.text, attempts, {
      bbox: region.bbox,
      bboxSupport: true,
      type,
      properNoun: ['person_name', 'school_name', 'organization_name', 'place_name'].includes(type),
      confidence: best.confidence,
      imageEvidence: attempts.filter(item => /ำ/u.test(item.text)).length / Math.max(1, attempts.length),
      providerAgreement: attempts.filter(item => item.text === best.text).length / Math.max(1, attempts.length),
    });
  }

  const finalText = preserveTextSymbols(saraReview.autoFix ? saraReview.correctedText : best.text);
  const finalAssessment = gibberishAssessment(finalText, { confidence: best.confidence, regionType: region.regionType, hasBaseline: policy.evidence.flags.baseline });
  const status = finalText && best.confidence >= 0.88 && !saraReview.requiresReview && !finalAssessment.gibberish
    ? 'verified'
    : finalText ? 'review_required' : 'possible_text';
  const confidenceSummary = summarizeBlockConfidence({ text: finalText, confidence: best.confidence, regionConfidence: Math.max(0.25, policy.evidence.count / 8), bbox: region.bbox, page, type });
  const candidateTexts = [...new Set([saraReview.suggestedText, ...attempts.map(item => item.text)].filter(Boolean))];
  const candidates = rankCandidates(candidateTexts, {
    confidences: Object.fromEntries(attempts.map(item => [item.text, item.confidence])),
    imageEvidence: Object.fromEntries(attempts.map(item => [item.text, item.confidence])),
    providerAgreement: Object.fromEntries(candidateTexts.map(text => [text, attempts.filter(item => item.text === text).length / Math.max(1, attempts.length)])),
  });
  const reviewUrls = createReviewUrls(attempts, status !== 'verified');
  const block = {
    id: region.id || `block-${index + 1}`,
    type, regionType: 'text', zone: region.zone || 'text_band', bbox: region.bbox, page,
    text: finalText, rawText: best.rawText, confidence: best.confidence,
    regionConfidence: Math.max(0.25, policy.evidence.count / 8), language,
    status, requiresReview: status !== 'verified',
    reviewStatus: saraReview.issueCount ? 'broken_sara_am_review' : status,
    failureSignals: [...new Set([...(saraReview.issueCount ? ['broken_sara_am'] : []), ...finalAssessment.reasons, ...(confidenceSummary.failureSignals || [])])],
    attempts: attempts.map(item => ({ name: item.name, text: item.text, rawText: item.rawText, confidence: item.confidence, language: item.language, phase: item.phase })),
    candidates: candidates.slice(0, 8), confidenceSummary,
    saraAmV22Review: saraReview,
    estimatedTextHeight: region.estimatedTextHeight || region.bbox.height,
    lowResolution: Number(region.estimatedTextHeight || region.bbox.height) < 7,
    userConfirmed: false,
    ...reviewUrls,
  };
  configuration.onBlockResult?.(block, { index, total });
  window.dispatchEvent(new CustomEvent('ripscan:ocr-block-result', { detail: { block, index, total } }));
  return block;
}

export async function processBookCoverCanvas(source, configuration = {}) {
  if (!supportsPerformancePipeline() || configuration.options?.performanceWorker === false) return processLegacy(source, configuration);
  const runId = ++activeRun;
  const jobId = `ocr-${runId}-${Date.now()}`;
  const metrics = createJobMetrics();
  const longTaskObserver = observeLongTasks(metrics);
  const client = new PreprocessClient();
  activeClient = client;
  const workerLimits = concurrencyFor(profile());
  const pool = new TesseractPool(workerLimits.ocrWorkers, metrics, message => {
    if (runId !== activeRun) return;
    if (message.status === 'recognizing text') sampleMemory(metrics);
  });
  activePool = pool;
  const cache = new Map();
  let documentType = configuration.documentType || 'auto';
  const pageNumber = Number(configuration.pageNumber || 1);
  configuration = { ...configuration, pageNumber, documentType };
  let bitmap;
  try {
    emitProgress(configuration, { status: 'document_type', stage: 'document_type', page: pageNumber, progress: progressivePercent('document_type', 0, 1), label: 'กำลังตรวจประเภทเอกสาร' });
    bitmap = await createImageBitmap(source);
    await client.init(jobId, bitmap, documentType);
    bitmap = null;
    const segmented = await client.segment(jobId, documentType);
    documentType = segmented.documentType;
    configuration.documentType = documentType;
    const isCover = isCoverHardBlockDocument(documentType);
    const regions = segmented.regions || [];
    metrics.regionsDetected = regions.length;
    metrics.regionsSkipped = regions.filter(region => !shouldOcrRegion(region, { isCover }).allow).length;
    emitProgress(configuration, {
      status: 'region_detection', stage: 'region_detection', page: pageNumber,
      textRegions: regions.length - metrics.regionsSkipped, skippedRegions: metrics.regionsSkipped,
      retryRegions: 0, progress: progressivePercent('region_detection', 1, 1),
      label: `พบ Text Region ${regions.length - metrics.regionsSkipped} จุด · ข้ามรูป ${metrics.regionsSkipped} จุด`,
    });
    await pool.start();
    const page = { width: source.width, height: source.height };
    const textRegions = regions.filter(region => shouldOcrRegion(region, { isCover }).allow);
    const skippedBlocks = regions.filter(region => !shouldOcrRegion(region, { isCover }).allow).map((region, index) => ({
      id: region.id || `skip-${index + 1}`, ...region, text: '', rawText: '', status: 'confirmed_non_text',
      action: 'skip_text_ocr', doNotEmitTokens: true, emitToEditor: false, emitToExport: false,
    }));
    const blocks = [];
    let completed = 0;
    const tasks = textRegions.map((region, index) => processRegion({
      client, pool, jobId, region, index, total: textRegions.length, page,
      configuration, runId, metrics, cache, fileHash: configuration.fileHash || jobId,
    }).then(block => {
      blocks.push(block);
      completed += 1;
      sampleMemory(metrics);
      const elapsed = Date.now() - metrics.startedAt;
      const eta = completed ? elapsed / completed * (textRegions.length - completed) : 0;
      emitProgress(configuration, {
        status: 'fast_pass', stage: 'fast_pass', page: pageNumber,
        block: completed, totalBlocks: textRegions.length,
        textRegions: metrics.regionsOcr, skippedRegions: metrics.regionsSkipped,
        retryRegions: metrics.retries, etaMs: eta,
        progress: progressivePercent('fast_pass', completed, textRegions.length),
        label: `ประมวลผล Block ${completed}/${textRegions.length}`,
      });
      return block;
    }));
    await withTimeout(() => Promise.all(tasks), OCR_LIMITS.pageTimeoutMs, () => { metrics.timedOut += 1; });

    emitProgress(configuration, { status: 'sara_am', stage: 'sara_am', page: pageNumber, progress: progressivePercent('sara_am', 1, 1), label: `ตรวจสระอำ ${blocks.filter(block => block.reviewStatus === 'broken_sara_am_review').length} จุด` });
    let ordered = sortReadingOrder([...skippedBlocks, ...blocks]);
    ordered = hardBlockCoverBlocks(ordered, { documentType, page });
    const text = isCover
      ? strictCoverEditorOutput(ordered, { includeMarkers: true })
      : buildStructuredText(ordered.filter(block => !block.doNotEmitTokens), configuration.options || {});
    const reviewBlocks = ordered.filter(block => !block.doNotEmitTokens && (block.requiresReview || block.status !== 'verified' || block.failureSignals?.length));
    const confidenceValues = ordered.filter(block => block.text && !block.doNotEmitTokens).map(block => Number(block.confidence || 0));
    const confidence = confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : 0;
    metrics.completedPages = 1;
    const finalMetrics = finishJobMetrics(metrics);
    const audit = coverOutputAudit(ordered);
    emitProgress(configuration, {
      status: 'complete', stage: 'merge', page: pageNumber, progress: 1,
      textRegions: metrics.regionsOcr, skippedRegions: metrics.regionsSkipped,
      retryRegions: metrics.retries, elapsedMs: finalMetrics.durationMs,
      label: `เสร็จแล้ว · OCR ${metrics.regionsOcr} จุด · ข้ามรูป ${metrics.regionsSkipped} จุด · Retry ${metrics.retries} จุด`,
    });
    return {
      text, confidence, blocks: ordered, barcodes: [], skippedImageRegions: metrics.regionsSkipped,
      documentType, review: { blocks: reviewBlocks, count: reviewBlocks.length },
      layout: {
        regionCount: ordered.length, textRegionCount: metrics.regionsOcr,
        skippedRegionCount: metrics.regionsSkipped, retryRegionCount: metrics.retries,
        readingOrder: ordered.filter(block => !block.doNotEmitTokens).map(block => block.id),
        coverHardBlock: isCover,
      },
      coverHardBlock: { enabled: isCover, audit },
      performance: {
        ...finalMetrics,
        workerLimits,
        duplicateOcrPrevented: metrics.cacheHits,
        circuitBreaker: pool.breaker.snapshot(),
        retriesChargeCredits: false,
      },
      pipeline: BOOK_COVER_PERFORMANCE_PIPELINE,
      options: configuration.options || {},
    };
  } catch (error) {
    if (error.message === 'OCR_CANCELLED' || error.message === 'BOOK_OCR_CANCELLED') metrics.cancelled = true;
    throw error;
  } finally {
    longTaskObserver?.disconnect();
    cache.clear();
    await Promise.allSettled([client.dispose(jobId), pool.cancel()]);
    client.terminate();
    activeClient = null;
    activePool = null;
    if (bitmap) bitmap.close?.();
  }
}

export async function cancelBookCoverOcr() {
  activeRun += 1;
  await Promise.allSettled([
    activePool?.cancel(),
    activeClient ? activeClient.cancel(`ocr-${activeRun - 1}`) : null,
    cancelLegacy(),
  ]);
  activeClient?.terminate();
  activeClient = null;
  activePool = null;
  for (const url of activeObjectUrls) URL.revokeObjectURL(url);
  activeObjectUrls.clear();
  window.dispatchEvent(new CustomEvent('ripscan:ocr-cancelled'));
}
