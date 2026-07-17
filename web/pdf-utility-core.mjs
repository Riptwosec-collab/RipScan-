export const PDF_TOOLS_VERSION = '4.0.0';
export const PDF_HEADER = '%PDF-';

export const PDF_TOOL_CATALOG = Object.freeze([
  { id: 'compress', label: 'บีบอัด PDF', accept: '.pdf', description: 'ลดขนาด PDF พร้อมโหมดรักษา Text Layer' },
  { id: 'merge', label: 'รวม PDF', accept: '.pdf,image/jpeg,image/png,image/webp', description: 'รวม PDF และรูปภาพ พร้อมจัดลำดับหน้า' },
  { id: 'split', label: 'แยก PDF', accept: '.pdf', description: 'แยกทุกหน้า ช่วงหน้า หน้าคู่ หน้าคี่ หรือทุก N หน้า' },
  { id: 'organize', label: 'จัดเรียงหน้า PDF', accept: '.pdf', description: 'หมุน ลบ ทำสำเนา และลากเรียงหน้า' },
  { id: 'edit', label: 'แก้ไข PDF', accept: '.pdf', description: 'เปิด PDF ใน Document Studio เดิมเพื่อแก้ข้อความ รูป และ Block' },
  { id: 'pdf-to-jpg', label: 'PDF เป็น JPG', accept: '.pdf', description: 'แปลงหน้าที่เลือกเป็น JPG แบบ Queue ทีละหน้า' },
  { id: 'pdf-to-png', label: 'PDF เป็น PNG', accept: '.pdf', description: 'แปลงหน้าที่เลือกเป็น PNG พร้อม DPI และ Resize' },
  { id: 'image-to-pdf', label: 'รูปภาพเป็น PDF', accept: 'image/jpeg,image/png,image/webp,image/bmp,image/tiff', description: 'รวมรูปหลายรูปเป็น PDF พร้อม Page Size และ Margin' },
]);

export const NON_TEXT_PRESERVING_COMPRESSION = new Set(['high', 'raster']);

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function normalizeCompressionOptions(options = {}) {
  const level = ['low', 'standard', 'high', 'custom'].includes(options.level) ? options.level : 'standard';
  const defaults = {
    low: { quality: .92, dpi: 220, downscale: false },
    standard: { quality: .78, dpi: 150, downscale: true },
    high: { quality: .58, dpi: 110, downscale: true },
    custom: { quality: .82, dpi: 150, downscale: true },
  }[level];
  return {
    level,
    quality: clamp(options.quality, .1, 1, defaults.quality),
    dpi: clamp(options.dpi, 72, 600, defaults.dpi),
    downscale: options.downscale === undefined ? defaults.downscale : Boolean(options.downscale),
    removeMetadata: options.removeMetadata !== false,
    grayscale: Boolean(options.grayscale),
    flattenAnnotations: Boolean(options.flattenAnnotations),
    preserveTextLayer: options.preserveTextLayer !== false && level !== 'high',
    preserveLinks: options.preserveLinks !== false,
    preservePageSize: options.preservePageSize !== false,
    recompressJpeg: options.recompressJpeg !== false,
  };
}

export function estimateCompressedSize(originalBytes, pageCount, options = {}) {
  const normalized = normalizeCompressionOptions(options);
  const ratio = normalized.preserveTextLayer
    ? ({ low: .92, standard: .78, custom: .74 }[normalized.level] || .78)
    : Math.max(.18, Math.min(.82, normalized.quality * (normalized.dpi / 150) * .72));
  const overhead = Math.max(4096, Math.min(96_000, Number(pageCount || 1) * 900));
  return Math.max(overhead, Math.round(Number(originalBytes || 0) * ratio));
}

export function compressionReport(originalBytes, outputBytes, pageCount, failedPages = []) {
  const original = Math.max(0, Number(originalBytes) || 0);
  const output = Math.max(0, Number(outputBytes) || 0);
  const saved = Math.max(0, original - output);
  return {
    originalBytes: original,
    outputBytes: output,
    savedBytes: saved,
    savedPercent: original ? saved / original * 100 : 0,
    completedPages: Math.max(0, Number(pageCount || 0) - failedPages.length),
    failedPages: [...failedPages],
  };
}

export function detectFileSignature(bytes) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  const ascii = new TextDecoder('latin1').decode(value.slice(0, 16));
  if (ascii.startsWith('%PDF-')) return 'pdf';
  if (value[0] === 0xff && value[1] === 0xd8 && value[2] === 0xff) return 'jpeg';
  if (value[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'png';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'webp';
  if (ascii.startsWith('BM')) return 'bmp';
  if (ascii.startsWith('II*\u0000') || ascii.startsWith('MM\u0000*')) return 'tiff';
  if (ascii.startsWith('PK\u0003\u0004')) return 'zip';
  return 'unknown';
}

export function validatePdfBytes(bytes, config = {}) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  const maxBytes = Math.max(1, Number(config.maxBytes || 512 * 1024 * 1024));
  const errors = [];
  if (!value.length) errors.push('PDF_EMPTY');
  if (value.length > maxBytes) errors.push('PDF_TOO_LARGE');
  if (detectFileSignature(value) !== 'pdf') errors.push('PDF_INVALID_HEADER');
  const tailStart = Math.max(0, value.length - 2048);
  const tail = new TextDecoder('latin1').decode(value.slice(tailStart));
  if (value.length > 8 && !tail.includes('%%EOF')) errors.push('PDF_EOF_NOT_FOUND');
  return { valid: errors.length === 0, errors, bytes: value.length };
}

export function normalizeRotation(value) {
  const rotation = Math.round(Number(value) || 0);
  return ((rotation % 360) + 360) % 360;
}

export function createOrganizerItem({ sourceId, sourceIndex = 0, pageIndex = 0, kind = 'pdf', name = '', rotation = 0, selected = true, duplicateOf = '' } = {}) {
  return {
    id: globalThis.crypto?.randomUUID?.() || `page-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sourceId: sourceId || `source-${sourceIndex}`,
    sourceIndex: Math.max(0, Number(sourceIndex) || 0),
    pageIndex: Math.max(0, Number(pageIndex) || 0),
    kind,
    name: name || `หน้า ${Math.max(0, Number(pageIndex) || 0) + 1}`,
    rotation: normalizeRotation(rotation),
    selected: Boolean(selected),
    deleted: false,
    duplicateOf,
  };
}

export function normalizeOrganizer(items = []) {
  return items.filter(Boolean).map(item => ({ ...createOrganizerItem(item), ...item, rotation: normalizeRotation(item.rotation), deleted: Boolean(item.deleted) }));
}

export function reorderOrganizer(items, fromIndex, toIndex) {
  const output = normalizeOrganizer(items);
  const from = Math.max(0, Math.min(output.length - 1, Number(fromIndex) || 0));
  const to = Math.max(0, Math.min(output.length - 1, Number(toIndex) || 0));
  if (!output.length || from === to) return output;
  const [item] = output.splice(from, 1);
  output.splice(to, 0, item);
  return output;
}

export function rotateOrganizerItems(items, ids, delta) {
  const selected = new Set(ids || []);
  return normalizeOrganizer(items).map(item => selected.has(item.id) ? { ...item, rotation: normalizeRotation(item.rotation + Number(delta || 0)) } : item);
}

export function deleteOrganizerItems(items, ids) {
  const selected = new Set(ids || []);
  return normalizeOrganizer(items).map(item => selected.has(item.id) ? { ...item, deleted: true, selected: false } : item);
}

export function duplicateOrganizerItems(items, ids) {
  const selected = new Set(ids || []);
  const output = [];
  for (const item of normalizeOrganizer(items)) {
    output.push(item);
    if (selected.has(item.id)) output.push(createOrganizerItem({ ...item, duplicateOf: item.id, name: `${item.name} (สำเนา)` }));
  }
  return output;
}

function expandRangePart(part, pageCount) {
  const clean = String(part || '').trim();
  if (!clean) return [];
  if (/^\d+$/u.test(clean)) {
    const page = Number(clean);
    if (page < 1 || page > pageCount) throw new Error(`PAGE_OUT_OF_RANGE:${page}`);
    return [page - 1];
  }
  const match = clean.match(/^(\d+)\s*-\s*(\d+)$/u);
  if (!match) throw new Error(`INVALID_PAGE_RANGE:${clean}`);
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start > end) throw new Error(`REVERSED_PAGE_RANGE:${clean}`);
  if (start < 1 || end > pageCount) throw new Error(`PAGE_OUT_OF_RANGE:${clean}`);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index - 1);
}

export function parsePageRanges(source, pageCount, { allowDuplicates = false } = {}) {
  const count = Math.max(0, Number(pageCount) || 0);
  if (!count) throw new Error('PAGE_COUNT_REQUIRED');
  const parts = String(source || '').split(/[,\n]+/u).map(part => part.trim()).filter(Boolean);
  if (!parts.length) throw new Error('PAGE_RANGE_REQUIRED');
  const pages = parts.flatMap(part => expandRangePart(part, count));
  if (!allowDuplicates) {
    const duplicate = pages.find((page, index) => pages.indexOf(page) !== index);
    if (duplicate !== undefined) throw new Error(`DUPLICATE_PAGE:${duplicate + 1}`);
  }
  return pages;
}

export function buildSplitGroups(mode, pageCount, options = {}) {
  const count = Math.max(0, Number(pageCount) || 0);
  if (!count) throw new Error('PAGE_COUNT_REQUIRED');
  const all = Array.from({ length: count }, (_, index) => index);
  if (mode === 'every-page') return all.map(page => [page]);
  if (mode === 'selected' || mode === 'ranges') {
    const source = options.ranges || options.selectedPages?.map(page => Number(page) + 1).join(',');
    const parts = String(source || '').split(/[,\n]+/u).map(part => part.trim()).filter(Boolean);
    return parts.map(part => expandRangePart(part, count));
  }
  if (mode === 'even') return [all.filter(page => (page + 1) % 2 === 0)];
  if (mode === 'odd') return [all.filter(page => (page + 1) % 2 === 1)];
  if (mode === 'every-n') {
    const size = Math.max(1, Math.floor(Number(options.everyN) || 1));
    const groups = [];
    for (let index = 0; index < all.length; index += size) groups.push(all.slice(index, index + size));
    return groups;
  }
  throw new Error(`UNSUPPORTED_SPLIT_MODE:${mode}`);
}

export function outputPageFilename(baseName, pageIndex, extension = 'png', totalPages = 1) {
  const base = String(baseName || 'document').replace(/\.[^.]+$/u, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'document';
  const digits = Math.max(3, String(Math.max(1, totalPages)).length);
  return `${base}_page_${String(Number(pageIndex) + 1).padStart(digits, '0')}.${extension}`;
}

export function splitFilename(baseName, pages = []) {
  const base = String(baseName || 'document').replace(/\.[^.]+$/u, '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'document';
  if (pages.length === 1) return `${base}_page_${pages[0] + 1}.pdf`;
  return `${base}_pages_${pages[0] + 1}-${pages[pages.length - 1] + 1}.pdf`;
}

export function sourceFormatMetadata(file, overrides = {}) {
  const name = String(file?.name || overrides.sourceFileName || 'untitled');
  const extension = String(overrides.sourceFormat || name.split('.').pop() || 'unknown').toLowerCase();
  return {
    sourceFileName: name,
    sourceFormat: extension,
    sourceMimeType: String(file?.type || overrides.sourceMimeType || ''),
    sourcePageSize: overrides.sourcePageSize || {},
    sourceOrientation: overrides.sourceOrientation || 'unknown',
    sourceStructure: overrides.sourceStructure || {},
    importAdapter: overrides.importAdapter || extension,
    preferredRoundTripFormat: overrides.preferredRoundTripFormat || extension,
  };
}

export function compatibilityReport(documentModel, targetFormat = '') {
  const format = targetFormat || documentModel?.metadata?.preferredRoundTripFormat || documentModel?.sourceType || 'pdf';
  const counts = { text: 0, table: 0, image: 0, shape: 0, field: 0, unsupported: 0 };
  const fallbacks = [];
  for (const page of documentModel?.pages || []) {
    for (const block of page.blocks || []) {
      if (counts[block.type] !== undefined) counts[block.type] += 1;
      else counts.unsupported += 1;
      if (format === 'xlsx' && !['table', 'text', 'image'].includes(block.type)) fallbacks.push({ blockId: block.id, policy: 'flatten_block', reason: `XLSX ไม่รองรับ ${block.type} โดยตรง` });
      if (format === 'docx' && block.rotation && !['image', 'shape'].includes(block.type)) fallbacks.push({ blockId: block.id, policy: 'compatible_text_box', reason: 'Word Paragraph ไม่รองรับ rotation แบบ absolute โดยตรง' });
      if (format === 'pptx' && block.type === 'field') fallbacks.push({ blockId: block.id, policy: 'editable_text_box', reason: 'Form Field จะถูกแปลงเป็น Text Box' });
    }
  }
  return {
    targetFormat: format,
    editable: counts.text + counts.table + counts.image + counts.shape + counts.field - fallbacks.length,
    counts,
    fallbacks,
    warnings: fallbacks.map(item => item.reason),
    canExport: true,
  };
}

export function fidelityScore(documentModel) {
  const blocks = (documentModel?.pages || []).flatMap(page => page.blocks || []);
  const review = blocks.filter(block => !['verified', 'accepted'].includes(block.reviewStatus || 'verified')).length;
  const missingSource = blocks.filter(block => !block.source && !block.metadata?.sourceElementId).length;
  const tables = blocks.filter(block => block.type === 'table');
  const tableIssues = tables.reduce((sum, table) => sum + (table.cells || []).filter(cell => !['verified', 'accepted'].includes(cell.reviewStatus || 'verified')).length, 0);
  const penalty = Math.min(.45, review * .008 + missingSource * .003 + tableIssues * .004);
  const overall = Math.max(.5, 1 - penalty);
  return {
    layoutScore: Math.max(.5, overall - missingSource * .001),
    textPositionScore: Math.max(.5, overall - review * .002),
    tableScore: Math.max(.5, 1 - tableIssues * .008),
    imageScore: Math.max(.5, 1 - blocks.filter(block => block.type === 'image' && !block.src).length * .05),
    overallScore: overall,
    reviewCount: review + tableIssues,
  };
}
