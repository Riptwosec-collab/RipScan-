import {
  processBookCoverCanvas as processWorkerPipeline,
  cancelBookCoverOcr as cancelWorkerPipeline,
  BOOK_COVER_PERFORMANCE_PIPELINE,
} from './book-ocr-browser-performance.mjs';
import { SharedJobScheduler, performanceConfig, shouldUseLargeFileMode } from './performance-runtime.mjs';
import { OCR_LIMITS } from './ocr-performance-core.mjs';
import { loadTesseract } from './lazy-libraries.mjs';

const localScheduler = new SharedJobScheduler(performanceConfig());
const activeIds = new Set();
const SCHEDULER_STARTUP_GRACE_MS = 3 * 60_000;

function runtime() {
  return globalThis.RipScanPerformanceRuntime;
}

function scheduler() {
  return runtime()?.scheduler || localScheduler;
}

function jobKey(source, configuration) {
  const page = Number(configuration.pageNumber || 1);
  const file = configuration.fileHash || configuration.fileName || 'document';
  const width = Number(source?.width || 0);
  const height = Number(source?.height || 0);
  return `ocr-page:${file}:${page}:${width}x${height}:${configuration.documentType || 'auto'}`;
}

function recoverableWorkerError(error) {
  const code = String(error?.code || error?.message || '');
  if (error?.name === 'AbortError' || /CANCEL/u.test(code)) return false;
  // JOB_TIMEOUT means the complete page budget has already been used. Retrying
  // the whole page would only double the wait, so only restart for worker-level
  // failures that can realistically recover on a fresh worker.
  return /OCR_TIMEOUT|PREPROCESS_TIMEOUT|WORKER|CIRCUIT|CRASH/u.test(code);
}

function publicOcrError(error) {
  const code = String(error?.code || error?.message || 'OCR_WORKER_FAILED');
  const messages = [
    [/JOB_TIMEOUT|OCR_TIMEOUT/u, 'การอ่านข้อความหน้านี้ใช้เวลานานเกินกำหนด ระบบหยุดงานเพื่อไม่ให้ค้าง กรุณาลองลดความละเอียดของภาพหรือแบ่งเอกสารเป็นหน้าละไฟล์'],
    [/PREPROCESS_TIMEOUT/u, 'การเตรียมภาพใช้เวลานานเกินกำหนด กรุณาลองใช้ภาพ JPG/PNG ที่มีขนาดเล็กลง'],
    [/CIRCUIT/u, 'OCR Worker ผิดพลาดซ้ำหลายครั้ง ระบบพักการทำงานชั่วคราว กรุณารอสักครู่แล้วลองใหม่'],
    [/WORKER|CRASH/u, 'OCR Worker เริ่มทำงานไม่สำเร็จ กรุณารีเฟรชหน้าแล้วลองใหม่อีกครั้ง'],
  ];
  const match = messages.find(([pattern]) => pattern.test(code));
  if (!match) return error;
  const mapped = new Error(match[1]);
  mapped.code = code;
  mapped.cause = error;
  return mapped;
}

function recoveryProgress(configuration, attempt, error) {
  const detail = {
    status: 'worker_retry', stage: 'worker_retry', page: Number(configuration.pageNumber || 1),
    progress: Number(configuration.__lastProgress || 0.18), retryRegions: attempt,
    label: `Worker ไม่ตอบ · กำลังเริ่มใหม่อัตโนมัติ ${attempt}/1`,
    issueType: 'WORKER_AUTO_RETRY', errorCode: String(error?.code || error?.message || 'WORKER_ERROR'),
  };
  configuration.onProgress?.(detail);
  window.dispatchEvent(new CustomEvent('ripscan:ocr-progress', { detail }));
}

export async function processBookCoverCanvas(source, configuration = {}) {
  await loadTesseract();
  const id = jobKey(source, configuration);
  const safeMode = shouldUseLargeFileMode({
    width: Number(source?.width || 0),
    height: Number(source?.height || 0),
    regions: Number(configuration.regionCount || 0),
    queueLength: scheduler().snapshot().jobCount,
  });
  if (safeMode) runtime()?.enterSafeMode?.('ocr_page_safe_mode', { page: Number(configuration.pageNumber || 1) });
  const priority = configuration.visible === false ? 5 : configuration.retry === true ? 2 : 1;
  const schedulerTimeoutMs = OCR_LIMITS.pageTimeoutMs + SCHEDULER_STARTUP_GRACE_MS;
  window.dispatchEvent(new CustomEvent('ripscan:job-start', { detail: { id, type: 'ocr', page: configuration.pageNumber || 1 } }));
  let lastError = null;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (configuration.signal?.aborted) {
        throw typeof DOMException === 'function'
          ? new DOMException(String(configuration.signal.reason || 'OCR_CANCELLED'), 'AbortError')
          : Object.assign(new Error('OCR_CANCELLED'), { name: 'AbortError' });
      }
      const attemptId = `${id}:attempt:${attempt + 1}`;
      activeIds.add(attemptId);
      try {
        return await scheduler().schedule('heavy', ({ signal }) => processWorkerPipeline(source, {
          ...configuration,
          signal,
          options: {
            ...(configuration.options || {}),
            performanceWorker: true,
            emergencySafeMode: safeMode,
            maxVariantsPerRegion: safeMode ? 2 : 4,
          },
        }), {
          id: attemptId,
          priority,
          signal: configuration.signal,
          timeoutMs: schedulerTimeoutMs,
        });
      } catch (error) {
        lastError = error;
        if (attempt >= 1 || !recoverableWorkerError(error)) throw error;
        recoveryProgress(configuration, 1, error);
        await cancelWorkerPipeline({ silent: true, skipLegacy: true });
        await new Promise(resolve => setTimeout(resolve, 250));
      } finally {
        activeIds.delete(attemptId);
      }
    }
    throw lastError || new Error('OCR_WORKER_FAILED');
  } catch (error) {
    throw publicOcrError(error);
  } finally {
    window.dispatchEvent(new CustomEvent('ripscan:job-end', { detail: { id, type: 'ocr' } }));
  }
}

export async function cancelBookCoverOcr() {
  for (const id of [...activeIds]) scheduler().cancel(id, 'OCR_CANCELLED');
  activeIds.clear();
  await cancelWorkerPipeline();
  window.dispatchEvent(new CustomEvent('ripscan:ocr-cancelled'));
}

export const BOOK_COVER_EMERGENCY_PIPELINE = `${BOOK_COVER_PERFORMANCE_PIPELINE}-emergency-v4.2`;

globalThis.RipScanBookOCR = Object.freeze({
  process: processBookCoverCanvas,
  cancel: cancelBookCoverOcr,
  pipeline: BOOK_COVER_EMERGENCY_PIPELINE,
});
