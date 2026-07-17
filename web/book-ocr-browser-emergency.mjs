import {
  processBookCoverCanvas as processWorkerPipeline,
  cancelBookCoverOcr as cancelWorkerPipeline,
  BOOK_COVER_PERFORMANCE_PIPELINE,
} from './book-ocr-browser-performance.mjs';
import { SharedJobScheduler, performanceConfig, shouldUseLargeFileMode } from './performance-runtime.mjs';

const localScheduler = new SharedJobScheduler(performanceConfig());
const activeIds = new Set();
let sequence = 0;

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

export async function processBookCoverCanvas(source, configuration = {}) {
  const id = jobKey(source, configuration);
  const safeMode = shouldUseLargeFileMode({
    width: Number(source?.width || 0),
    height: Number(source?.height || 0),
    regions: Number(configuration.regionCount || 0),
    queueLength: scheduler().snapshot().jobCount,
  });
  if (safeMode) runtime()?.enterSafeMode?.('ocr_page_safe_mode', { page: Number(configuration.pageNumber || 1) });
  const priority = configuration.visible === false ? 5 : configuration.retry === true ? 2 : 1;
  activeIds.add(id);
  window.dispatchEvent(new CustomEvent('ripscan:job-start', { detail: { id, type: 'ocr', page: configuration.pageNumber || 1 } }));
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
      id,
      priority,
      signal: configuration.signal,
      timeoutMs: 65_000,
    });
  } finally {
    activeIds.delete(id);
    window.dispatchEvent(new CustomEvent('ripscan:job-end', { detail: { id, type: 'ocr' } }));
  }
}

export async function cancelBookCoverOcr() {
  for (const id of [...activeIds]) scheduler().cancel(id, 'OCR_CANCELLED');
  activeIds.clear();
  await cancelWorkerPipeline();
  window.dispatchEvent(new CustomEvent('ripscan:ocr-cancelled'));
}

export const BOOK_COVER_EMERGENCY_PIPELINE = `${BOOK_COVER_PERFORMANCE_PIPELINE}-emergency-v4.1.${++sequence}`;

globalThis.RipScanBookOCR = Object.freeze({
  process: processBookCoverCanvas,
  cancel: cancelBookCoverOcr,
  pipeline: BOOK_COVER_EMERGENCY_PIPELINE,
});
