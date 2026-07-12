import * as base from './book-ocr-core.mjs';
import {
  classifyCoverRegion,
  classifyProtectedText,
  confidenceGate,
  detectGibberish,
  filterCoverOutput,
} from './cover-ocr-rules.mjs';

export * from './book-ocr-core.mjs';
export * from './cover-ocr-rules.mjs';

const SEPARATOR = /^(?:-{4,}|_{4,}|={4,}|─{4,}|━{4,}|═{4,})$/u;
const ISBN_STRICT = /(?:\bISBN(?:-1[03])?\s*:?\s*(?:97[89][\s-]?)?[0-9Xx](?:[\s-]?[0-9Xx]){8,12}\b|\b97[89](?:[\s-]?\d){10}\b)/i;
const PHONE_STRICT = /(?:โทร(?:ศัพท์)?\.?\s*:?\s*)?(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,3}\)?[\s-]?)\d{3,4}[\s-]\d{3,4}\b/u;
const PRICE = /(?:฿|บาท|ราคา)\s*[0-9๐-๙,.]+|[0-9๐-๙,.]+\s*(?:บาท|฿)/u;

export function classifyDashSymbol(symbol, context = '') {
  const value = String(symbol ?? '');
  const text = String(context ?? '');
  const typeMap = { '-': 'hyphen', '–': 'en_dash', '—': 'em_dash', '−': 'minus_sign', '_': 'underscore', '/': 'slash', '|': 'vertical_bar' };
  let role = 'text_symbol';
  if (SEPARATOR.test(value)) role = 'section_separator';
  else if (/[A-Za-z0-9]+[-_/][A-Za-z0-9]+/.test(text) && /[A-Za-z]/.test(text)) role = 'document_code';
  else if (/^(?:[A-Z0-9]{2,}[-_/]){1,}[A-Z0-9-_/]+$/i.test(text.trim())) role = 'document_code';
  else if (/\d\s*[–-]\s*\d/u.test(text)) role = 'range';
  else if (value === '—') role = 'sentence_separator';
  else if (value === '−') role = 'mathematical_minus';
  return { symbol: value, type: SEPARATOR.test(value) ? 'separator_line' : (typeMap[value] || 'unknown'), role };
}

export function extractDashElements(value) {
  const elements = [];
  String(value ?? '').split('\n').forEach((line, lineIndex) => {
    if (SEPARATOR.test(line.trim())) {
      elements.push({ ...classifyDashSymbol(line.trim(), line), line: lineIndex + 1, length: line.trim().length, position: 'between_blocks' });
      return;
    }
    [...line.matchAll(/[-–—−_/|]+/gu)].forEach(match => elements.push({ ...classifyDashSymbol(match[0], line), line: lineIndex + 1, column: match.index + 1, length: match[0].length }));
  });
  return elements;
}

export function analyzeRegionFeatures(features = {}) {
  const textLineScore = Number(features.textLineScore || 0);
  const connectedComponentScore = Number(features.connectedComponentScore || 0);
  const inferred = {
    ...features,
    baselineEvidence: features.baselineEvidence ?? Math.min(1, textLineScore * 1.08),
    glyphAlignment: features.glyphAlignment ?? Math.min(1, textLineScore * 0.94 + connectedComponentScore * 0.18),
    heightConsistency: features.heightConsistency ?? Math.min(1, connectedComponentScore * 0.82 + textLineScore * 0.22),
    spacingConsistency: features.spacingConsistency ?? Math.min(1, textLineScore * 0.72 + connectedComponentScore * 0.24),
    glyphCount: features.glyphCount ?? Math.round(connectedComponentScore * 12),
  };
  return classifyCoverRegion(inferred);
}

export function detectFailureSignals(value, box = null, confidence = 1) {
  const baseSignals = base.detectFailureSignals(value, box, confidence);
  const gibberish = detectGibberish(value, {
    confidence,
    hasBaseline: box?.baselineEvidence !== false,
    boundingBoxFit: box?.boundingBoxFit !== false,
  });
  const coverSignals = gibberish.reasons.map(reason => `cover_${reason}`);
  if (gibberish.rejected) coverSignals.push('rejected_as_non_text');
  return [...new Set([...baseSignals, ...coverSignals])];
}

export function classifyBlockText(value, box = {}, page = {}) {
  const text = String(value ?? '').trim();
  const yRatio = page.height ? (box.top || box.y || 0) / page.height : 0;
  const heightRatio = page.height ? (box.height || 0) / page.height : 0;
  if (!text) return 'unknown';
  if (ISBN_STRICT.test(text)) return 'isbn';
  if (PHONE_STRICT.test(text) || /^(?:โทร(?:ศัพท์)?\.?\s*:?\s*)?0\d(?:[\s-]?\d){8}$/u.test(text)) return 'phone';
  if (PRICE.test(text)) return 'price';
  if (/^(?:\d+|[ก-ฮ])[.)]\s+/u.test(text)) return 'numbered_list';
  if (/(?:ถนน|แขวง|เขต|ตำบล|อำเภอ|จังหวัด|เลขที่|ซอย)/u.test(text) && text.length > 15) return 'address';
  if (/(?:สำนักพิมพ์|ศูนย์หนังสือ|จัดพิมพ์|เผยแพร่)/u.test(text)) return 'publisher_info';

  const protectedType = classifyProtectedText(text, box, page);
  if (['person_name', 'school_name', 'organization_name', 'class_level'].includes(protectedType)) return protectedType;
  if (text.length >= 70 || /[.!?。！？]$/u.test(text)) return 'paragraph';
  if (protectedType === 'title') return 'title';
  if (page.height && yRatio < 0.32 && (heightRatio > 0.035 || text.length < 80) && !/[.!?。！？]$/u.test(text)) return 'title';
  return 'unknown';
}

export function languageForBlock(type, value = '') {
  if (['person_name', 'school_name', 'organization_name', 'class_level'].includes(type)) return 'tha';
  return base.languageForBlock(type, value);
}

export function shouldRetryBlock(block) {
  const baseRetry = base.shouldRetryBlock(block);
  const summary = base.summarizeBlockConfidence(block);
  const gate = confidenceGate({
    ...block,
    textRegionConfidence: block.regionConfidence,
    ocrConfidence: block.confidence,
    scriptConfidence: summary.thaiScriptConfidence,
    graphemeConfidence: summary.graphemeConfidence,
    baselineEvidence: block.bbox?.baselineEvidence ?? 1,
  });
  return {
    retry: baseRetry.retry || gate.status !== 'accepted',
    signals: [...new Set([...baseRetry.signals, ...gate.failures])],
    threshold: ['person_name', 'school_name', 'organization_name'].includes(gate.type) ? 0.97 : Math.max(baseRetry.threshold, 0.9),
    gate,
  };
}

export function buildStructuredText(blocks) {
  const normalized = blocks.map(block => {
    const regionType = block.regionType || block.type || 'text';
    if (['barcode', 'qr_code', 'image', 'logo', 'icon', 'illustration', 'photograph', 'cartoon', 'decorative_frame', 'ornament', 'background_shape'].includes(regionType)) {
      return { ...block, regionType, status: 'rejected_as_non_text', gate: { status: 'rejected_as_non_text', accepted: false, requiresReview: false, failures: [`region_${regionType}`] } };
    }
    const hasEvidence = Number.isFinite(Number(block.confidence)) || Number.isFinite(Number(block.regionConfidence)) || Boolean(block.gate);
    if (!hasEvidence) {
      return { ...block, regionType: 'text', status: 'accepted', gate: { status: 'accepted', accepted: true, requiresReview: false, failures: [] } };
    }
    const summary = base.summarizeBlockConfidence(block);
    const gate = confidenceGate({
      ...block,
      textRegionConfidence: block.regionConfidence,
      ocrConfidence: block.confidence,
      scriptConfidence: summary.thaiScriptConfidence,
      graphemeConfidence: summary.graphemeConfidence,
      baselineEvidence: block.bbox?.baselineEvidence ?? 1,
    });
    return { ...block, gate, status: gate.status, regionType: 'text' };
  });
  const { accepted } = filterCoverOutput(normalized);
  return base.buildStructuredText(accepted);
}

export function summarizeBlockConfidence(block) {
  const summary = base.summarizeBlockConfidence(block);
  const gate = confidenceGate({
    ...block,
    textRegionConfidence: summary.textRegionConfidence,
    ocrConfidence: block.confidence,
    scriptConfidence: summary.thaiScriptConfidence,
    graphemeConfidence: summary.graphemeConfidence,
    baselineEvidence: block.bbox?.baselineEvidence ?? 1,
  });
  return {
    ...summary,
    finalConfidence: gate.status === 'accepted' ? summary.finalConfidence : Math.min(summary.finalConfidence, 0.89),
    failureSignals: [...new Set([...summary.failureSignals, ...gate.failures])],
    requiresReview: gate.requiresReview || summary.requiresReview,
    rejectedAsNonText: gate.status === 'rejected_as_non_text',
    gate,
  };
}
