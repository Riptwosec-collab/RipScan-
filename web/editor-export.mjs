import { documentToPlainText, getTableCell } from './document-model.mjs';

export const EXPORT_PRESETS = {
  A4: { width: 794, height: 1123 },
  A5: { width: 559, height: 794 },
  Letter: { width: 816, height: 1056 },
  Legal: { width: 816, height: 1344 },
};

export function normalizeExportOptions(options = {}) {
  const pageSize = options.pageSize || 'source';
  const preset = EXPORT_PRESETS[pageSize] || null;
  let width = Math.max(1, Number(options.width) || preset?.width || 0);
  let height = Math.max(1, Number(options.height) || preset?.height || 0);
  const orientation = options.orientation || 'portrait';
  if (preset && orientation === 'landscape' && height > width) [width, height] = [height, width];
  if (preset && orientation === 'portrait' && width > height) [width, height] = [height, width];
  return {
    format: options.format || 'pdf',
    pageSize,
    orientation,
    width,
    height,
    keepAspect: options.keepAspect !== false,
    fit: options.fit || 'contain',
    scale: Math.max(.1, Math.min(8, Number(options.scale) || 1)),
    dpi: Math.max(72, Math.min(600, Number(options.dpi) || 144)),
    quality: Math.max(.1, Math.min(1, Number(options.quality) || .92)),
    margin: Math.max(0, Number(options.margin) || 0),
    background: options.background || '#ffffff',
    transparent: Boolean(options.transparent),
    selectedPages: Array.isArray(options.selectedPages) ? options.selectedPages : null,
    includeReviewRequired: Boolean(options.includeReviewRequired),
  };
}

export function calculateOutputSize(sourceWidth, sourceHeight, options = {}) {
  const normalized = normalizeExportOptions(options);
  const sourceW = Math.max(1, Number(sourceWidth) || 1);
  const sourceH = Math.max(1, Number(sourceHeight) || 1);
  let width = normalized.width || sourceW * normalized.scale;
  let height = normalized.height || sourceH * normalized.scale;
  if (normalized.keepAspect) {
    const ratio = sourceW / sourceH;
    if (normalized.width && !options.height) height = width / ratio;
    else if (normalized.height && !options.width) width = height * ratio;
    else if (normalized.width && normalized.height) {
      const scale = normalized.fit === 'cover'
        ? Math.max(width / sourceW, height / sourceH)
        : Math.min(width / sourceW, height / sourceH);
      width = sourceW * scale;
      height = sourceH * scale;
    }
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    canvasWidth: Math.max(1, Math.round(width * normalized.dpi / 96)),
    canvasHeight: Math.max(1, Math.round(height * normalized.dpi / 96)),
    options: normalized,
  };
}

export function safeFilename(value, fallback = 'ripscan-document') {
  const cleaned = String(value || fallback).replace(/[\\/:*?"<>|]+/gu, '-').replace(/\s+/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '');
  return cleaned || fallback;
}

export function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

export async function canvasToBlob(canvas, format = 'png', quality = .92) {
  const mime = format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : 'image/png';
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('สร้างไฟล์ภาพไม่สำเร็จ')), mime, quality));
}

const scriptPromises = new Map();

export function loadExternalScript(src, globalName = '') {
  if (globalName && globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  if (scriptPromises.has(src)) return scriptPromises.get(src);
  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(globalName ? globalThis[globalName] : true), { once: true });
      existing.addEventListener('error', () => reject(new Error(`โหลด ${src} ไม่สำเร็จ`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve(globalName ? globalThis[globalName] : true);
    script.onerror = () => reject(new Error(`โหลด ${src} ไม่สำเร็จ`));
    document.head.append(script);
  });
  scriptPromises.set(src, promise);
  return promise;
}

export async function ensureStudioLibraries({ xlsx = false, render = false, pdf = false } = {}) {
  const jobs = [];
  if (xlsx && !globalThis.XLSX) jobs.push(loadExternalScript('https://cdn.jsdelivr.net/npm/@e965/xlsx@0.20.3/dist/xlsx.full.min.js', 'XLSX'));
  if (render && !globalThis.html2canvas) jobs.push(loadExternalScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', 'html2canvas'));
  if (pdf && !globalThis.jspdf?.jsPDF) jobs.push(loadExternalScript('https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js', 'jspdf'));
  await Promise.all(jobs);
}

export async function renderElementToCanvas(element, sourcePage, options = {}) {
  await ensureStudioLibraries({ render: true });
  const normalized = normalizeExportOptions(options);
  const size = calculateOutputSize(sourcePage.width, sourcePage.height, options);
  const scale = Math.max(.1, size.canvasWidth / Math.max(1, sourcePage.width));
  const canvas = await globalThis.html2canvas(element, {
    backgroundColor: normalized.transparent ? null : normalized.background,
    scale,
    useCORS: true,
    allowTaint: false,
    logging: false,
    imageTimeout: 15000,
    width: sourcePage.width,
    height: sourcePage.height,
    windowWidth: sourcePage.width,
    windowHeight: sourcePage.height,
  });
  if (canvas.width === size.canvasWidth && canvas.height === size.canvasHeight) return canvas;
  const output = document.createElement('canvas');
  output.width = size.canvasWidth;
  output.height = size.canvasHeight;
  const context = output.getContext('2d', { alpha: normalized.transparent });
  if (!normalized.transparent) {
    context.fillStyle = normalized.background;
    context.fillRect(0, 0, output.width, output.height);
  }
  const fitScale = normalized.fit === 'cover'
    ? Math.max(output.width / canvas.width, output.height / canvas.height)
    : Math.min(output.width / canvas.width, output.height / canvas.height);
  const drawWidth = canvas.width * fitScale;
  const drawHeight = canvas.height * fitScale;
  context.drawImage(canvas, (output.width - drawWidth) / 2, (output.height - drawHeight) / 2, drawWidth, drawHeight);
  canvas.width = 1;
  canvas.height = 1;
  return output;
}

export async function exportPageElements(elements, pages, options = {}, filename = 'ripscan-document', onProgress = () => {}) {
  const normalized = normalizeExportOptions(options);
  const base = safeFilename(filename.replace(/\.[^.]+$/u, ''));
  const selected = normalized.selectedPages || pages.map((_, index) => index);
  const pairs = selected.map(index => ({ index, page: pages[index], element: elements[index] })).filter(item => item.page && item.element);
  if (!pairs.length) throw new Error('ไม่มีหน้าที่เลือกสำหรับส่งออก');
  if (normalized.format === 'searchable-pdf') return exportDirectSearchablePdf(pairs, normalized, filename, onProgress);
  if (normalized.format === 'json') {
    const documentModel = options.documentModel;
    if (!documentModel) throw new Error('ไม่พบ Document Model สำหรับ JSON');
    return downloadBlob(new Blob([JSON.stringify(documentModel, null, 2)], { type: 'application/json;charset=utf-8' }), `${base}.json`);
  }
  if (normalized.format === 'txt') {
    const documentModel = options.documentModel;
    if (!documentModel) throw new Error('ไม่พบ Document Model สำหรับ TXT');
    return downloadBlob(new Blob([documentToPlainText(documentModel)], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
  }
  if (normalized.format === 'docx') {
    const documentModel = options.documentModel;
    if (!documentModel) throw new Error('ไม่พบ Document Model สำหรับ DOCX');
    return downloadBlob(await modelToDocxBlob(documentModel), `${base}.docx`);
  }
  if (normalized.format === 'xlsx') {
    const documentModel = options.documentModel;
    if (!documentModel) throw new Error('ไม่พบ Document Model สำหรับ XLSX');
    return downloadBlob(await modelToXlsxBlob(documentModel), `${base}.xlsx`);
  }
  if (normalized.format === 'pdf') {
    await ensureStudioLibraries({ render: true, pdf: true });
    const jsPDF = globalThis.jspdf.jsPDF;
    let pdf = null;
    for (let position = 0; position < pairs.length; position += 1) {
      const { page, element } = pairs[position];
      onProgress({ completed: position, total: pairs.length, label: `เรนเดอร์ PDF หน้า ${position + 1}/${pairs.length}` });
      const canvas = await renderElementToCanvas(element, page, normalized);
      const pageWidth = canvas.width * 72 / normalized.dpi;
      const pageHeight = canvas.height * 72 / normalized.dpi;
      const orientation = pageWidth > pageHeight ? 'landscape' : 'portrait';
      if (!pdf) pdf = new jsPDF({ orientation, unit: 'pt', format: [pageWidth, pageHeight], compress: true, putOnlyUsedFonts: true });
      else pdf.addPage([pageWidth, pageHeight], orientation);
      pdf.addImage(canvas.toDataURL('image/jpeg', normalized.quality), 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
      canvas.width = 1;
      canvas.height = 1;
    }
    pdf.save(`${base}.pdf`);
    onProgress({ completed: pairs.length, total: pairs.length, label: 'สร้าง PDF เสร็จแล้ว' });
    return;
  }

  const format = normalized.format === 'jpg' || normalized.format === 'jpeg' ? 'jpg' : 'png';
  const blobs = [];
  for (let position = 0; position < pairs.length; position += 1) {
    const { page, element } = pairs[position];
    onProgress({ completed: position, total: pairs.length, label: `สร้างภาพหน้า ${position + 1}/${pairs.length}` });
    const canvas = await renderElementToCanvas(element, page, normalized);
    blobs.push(await canvasToBlob(canvas, format, normalized.quality));
    canvas.width = 1;
    canvas.height = 1;
  }
  if (blobs.length === 1) return downloadBlob(blobs[0], `${base}.${format === 'jpg' ? 'jpg' : 'png'}`);
  if (!globalThis.JSZip) throw new Error('โหลดระบบ ZIP ไม่สำเร็จ');
  const zip = new globalThis.JSZip();
  blobs.forEach((blob, index) => zip.file(`page-${String(index + 1).padStart(3, '0')}.${format === 'jpg' ? 'jpg' : 'png'}`, blob));
  downloadBlob(await zip.generateAsync({ type: 'blob' }), `${base}-${format}-pages.zip`);
  onProgress({ completed: pairs.length, total: pairs.length, label: 'สร้างไฟล์ภาพเสร็จแล้ว' });
}

let thaiFontBase64Promise;

async function loadThaiPdfFont() {
  if (!thaiFontBase64Promise) thaiFontBase64Promise = fetch('/fonts/NotoSansThai.ttf').then(response => {
    if (!response.ok) throw new Error('โหลดฟอนต์ไทยสำหรับ PDF ไม่สำเร็จ');
    return response.arrayBuffer();
  }).then(buffer => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
  });
  return thaiFontBase64Promise;
}

export function collectSearchableTextLayer(page, includeReviewRequired = false) {
  const allowed = block => !block.hidden
    && !block.redacted
    && block.reviewStatus !== 'confirmed_non_text'
    && (includeReviewRequired || block.reviewStatus === 'verified');
  const runs = [];
  for (const block of (page.blocks || []).filter(allowed)) {
    if (['text', 'header', 'footer', 'label', 'value'].includes(block.type)) {
      runs.push({ ...block, text: block.text || '' });
    } else if (['field', 'checkbox', 'radio', 'barcode', 'qr'].includes(block.type)) {
      runs.push({ ...block, text: `${block.label || ''}${block.label ? ': ' : ''}${block.value || ''}` });
    } else if (block.type === 'table') {
      const columnWidths = block.columnWidths?.length === block.columns ? block.columnWidths : Array.from({ length: block.columns }, () => block.width / Math.max(1, block.columns));
      const rowHeights = block.rowHeights?.length === block.rows ? block.rowHeights : Array.from({ length: block.rows }, () => block.height / Math.max(1, block.rows));
      for (const cell of (block.cells || []).filter(cell => !cell.hidden && !cell.redacted && cell.reviewStatus !== 'confirmed_non_text' && (includeReviewRequired || cell.reviewStatus === 'verified'))) {
        const x = block.x + columnWidths.slice(0, cell.column).reduce((sum, value) => sum + value, 0);
        const y = block.y + rowHeights.slice(0, cell.row).reduce((sum, value) => sum + value, 0);
        runs.push({ text: cell.text || '', x, y, width: columnWidths.slice(cell.column, cell.column + (cell.columnSpan || 1)).reduce((sum, value) => sum + value, 0), height: rowHeights[cell.row] || 24, rotation: block.rotation || 0, style: cell.style || block.style || {} });
      }
    }
  }
  return runs.filter(run => String(run.text || '').trim());
}

export function analyzeExportCompatibility(documentModel, format) {
  const blocks = (documentModel?.pages || []).flatMap(page => page.blocks || []).filter(block => !block.hidden && !block.redacted && block.reviewStatus !== 'confirmed_non_text');
  const types = [...new Set(blocks.map(block => block.type))];
  const findings = [];
  const add = (level, feature, detail) => findings.push({ level, feature, detail });
  if (format === 'docx') {
    add('partial', 'positioned_layout', 'ตำแหน่งถูกสร้างเป็น Word text box/table ที่ยึดกับหน้ากระดาษ; Word อาจขยับเล็กน้อยตามฟอนต์ที่ติดตั้ง');
    if (types.some(type => ['image', 'signature', 'stamp'].includes(type))) add('supported', 'embedded_images', 'รูปแบบ data URL หรือ URL ที่อ่านได้ถูกฝังเป็น media ใน DOCX');
    if (types.some(type => ['shape', 'line'].includes(type))) add('partial', 'shapes', 'เส้นและกล่องถูกสร้างด้วย VML เพื่อคงตำแหน่งและสีพื้นฐาน');
    if (types.includes('table')) add('supported', 'tables', 'ตารางและ merge หลักถูกสร้างเป็น Word table');
    add('supported', 'thai_text', 'ข้อความไทยถูกเก็บเป็น Unicode');
  } else if (format === 'xlsx') {
    if (types.includes('table')) add('supported', 'tables', 'ตารางถูกแยกเป็น worksheet พร้อม merge และขนาดแถว/คอลัมน์');
    if (types.some(type => ['image', 'shape', 'line', 'signature', 'stamp'].includes(type))) add('partial', 'visual_blocks', 'องค์ประกอบภาพถูกระบุเป็นหมวดใน Content sheet; ตารางและเซลล์เป็นโครงสร้างแก้ไขได้จริง');
    if (types.some(type => ['text', 'header', 'footer'].includes(type)) && types.includes('table')) add('supported', 'page_text', 'ข้อความนอกตารางอยู่ใน Content sheet พร้อมชนิด ตำแหน่ง และสถานะตรวจสอบ');
    add('supported', 'string_values', 'ค่าข้อความและเลขศูนย์นำหน้าถูกเก็บเป็น string');
  } else throw new Error('format_not_supported');
  const weights = { supported: 0, partial: .35, unsupported: 1 };
  const risk = findings.length ? findings.reduce((sum, finding) => sum + weights[finding.level], 0) / findings.length : 0;
  return { format, risk, label: risk < .2 ? 'Low risk' : risk < .5 ? 'Review recommended' : 'High fidelity risk', findings, blockTypes: types };
}

export async function exportDirectSearchablePdf(pairs, options = {}, filename = 'ripscan-document', onProgress = () => {}) {
  await ensureStudioLibraries({ render: true, pdf: true });
  const jsPDF = globalThis.jspdf.jsPDF;
  const font = await loadThaiPdfFont();
  const base = safeFilename(filename.replace(/\.[^.]+$/u, ''));
  let pdf;
  for (let position = 0; position < pairs.length; position += 1) {
    const { page, element } = pairs[position];
    onProgress({ completed: position, total: pairs.length, label: `สร้าง Searchable PDF หน้า ${position + 1}/${pairs.length}` });
    const canvas = await renderElementToCanvas(element, page, options);
    const pageWidth = canvas.width * 72 / options.dpi;
    const pageHeight = canvas.height * 72 / options.dpi;
    const orientation = pageWidth > pageHeight ? 'landscape' : 'portrait';
    if (!pdf) {
      pdf = new jsPDF({ orientation, unit: 'pt', format: [pageWidth, pageHeight], compress: true, putOnlyUsedFonts: true });
      pdf.addFileToVFS('NotoSansThai.ttf', font);
      pdf.addFont('NotoSansThai.ttf', 'NotoSansThai', 'normal');
    } else pdf.addPage([pageWidth, pageHeight], orientation);
    pdf.addImage(canvas.toDataURL('image/jpeg', options.quality), 'JPEG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
    canvas.width = 1; canvas.height = 1;
    const scaleX = pageWidth / Math.max(1, page.width);
    const scaleY = pageHeight / Math.max(1, page.height);
    pdf.setFont('NotoSansThai', 'normal');
    for (const run of collectSearchableTextLayer(page, options.includeReviewRequired)) {
      const lines = String(run.text).split(/\r?\n/u);
      const fontSize = Math.max(4, Math.min(72, Number(run.style?.fontSize) || Math.max(8, run.height / Math.max(1, lines.length) * .72))) * scaleY;
      pdf.setFontSize(fontSize);
      const lineHeight = Math.max(fontSize, run.height * scaleY / Math.max(1, lines.length));
      lines.forEach((line, index) => {
        if (!line) return;
        pdf.text(line, run.x * scaleX, (run.y * scaleY) + fontSize + (index * lineHeight), {
          angle: -(Number(run.rotation) || 0),
          baseline: 'alphabetic',
          renderingMode: 'invisible',
          maxWidth: Math.max(1, run.width * scaleX),
        });
      });
    }
  }
  const blob = pdf.output('blob');
  downloadBlob(blob, `${base}-searchable.pdf`);
  onProgress({ completed: pairs.length, total: pairs.length, label: 'สร้าง Searchable PDF เสร็จแล้ว' });
  return blob;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[<>&"']/gu, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '');
}

const pxToTwips = value => Math.max(0, Math.round((Number(value) || 0) * 15));
const pxToPoints = value => Math.max(0, (Number(value) || 0) * .75).toFixed(2);

function officeColor(value, fallback = '000000') {
  const color = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/iu.test(color)) return color.slice(1).toUpperCase();
  if (/^#[0-9a-f]{3}$/iu.test(color)) return color.slice(1).split('').map(part => part + part).join('').toUpperCase();
  return fallback;
}

function wordAlignment(value) {
  return value === 'center' ? 'center' : value === 'right' || value === 'end' ? 'right' : value === 'justify' ? 'both' : 'left';
}

function wordParagraphs(value, style = {}) {
  const fontSize = Math.max(8, Math.round((Number(style.fontSize) || 16) * 1.5));
  const runProperties = `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Noto Sans Thai"/>${Number(style.fontWeight) >= 600 ? '<w:b/>' : ''}${style.fontStyle === 'italic' ? '<w:i/>' : ''}${style.textDecoration === 'underline' ? '<w:u w:val="single"/>' : ''}<w:color w:val="${officeColor(style.color)}"/><w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/></w:rPr>`;
  return String(value ?? '').split(/\r?\n/u).map(line => `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:jc w:val="${wordAlignment(style.textAlign)}"/></w:pPr><w:r>${runProperties}<w:t xml:space="preserve">${xmlEscape(line || ' ')}</w:t></w:r></w:p>`).join('');
}

export function tableToWordXml(table) {
  const columnWidths = table.columnWidths?.length === table.columns ? table.columnWidths : Array.from({ length: table.columns }, () => table.width / Math.max(1, table.columns));
  const rowHeights = table.rowHeights?.length === table.rows ? table.rowHeights : Array.from({ length: table.rows }, () => table.height / Math.max(1, table.rows));
  const rows = Array.from({ length: table.rows }, (_, row) => {
    const rendered = [];
    for (let column = 0; column < table.columns; column += 1) {
      const cell = getTableCell(table, row, column);
      if (!cell || column !== cell.column) continue;
      const continuation = row > cell.row;
      const gridSpan = cell.columnSpan > 1 ? `<w:gridSpan w:val="${cell.columnSpan}"/>` : '';
      const verticalMerge = cell.rowSpan > 1 ? (continuation ? '<w:vMerge/>' : '<w:vMerge w:val="restart"/>') : '';
      const cellWidth = columnWidths.slice(cell.column, cell.column + Math.max(1, cell.columnSpan)).reduce((sum, width) => sum + width, 0);
      const background = cell.redacted ? '000000' : officeColor(cell.style?.backgroundColor, 'FFFFFF');
      const vertical = cell.style?.verticalAlign === 'top' ? 'top' : cell.style?.verticalAlign === 'bottom' ? 'bottom' : 'center';
      const properties = `<w:tcPr><w:tcW w:w="${pxToTwips(cellWidth)}" w:type="dxa"/>${gridSpan}${verticalMerge}<w:shd w:val="clear" w:color="auto" w:fill="${background}"/><w:vAlign w:val="${vertical}"/></w:tcPr>`;
      const safeText = cell.redacted || cell.reviewStatus === 'confirmed_non_text' ? '' : cell.text || '';
      const paragraphs = continuation ? '<w:p/>' : wordParagraphs(safeText, cell.style || {});
      rendered.push(`<w:tc>${properties}${paragraphs}</w:tc>`);
      column += Math.max(1, cell.columnSpan) - 1;
    }
    const cells = rendered.join('');
    return `<w:tr><w:trPr><w:trHeight w:val="${pxToTwips(rowHeights[row])}" w:hRule="atLeast"/></w:trPr>${cells}</w:tr>`;
  }).join('');
  const grid = columnWidths.map(width => `<w:gridCol w:w="${pxToTwips(width)}"/>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${pxToTwips(table.width || columnWidths.reduce((sum, width) => sum + width, 0))}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
}

async function modelToDocxBlobLegacy(documentModel) {
  if (!globalThis.JSZip) throw new Error('โหลดระบบ DOCX ไม่สำเร็จ');
  const zip = new globalThis.JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const body = [];
  for (const [pageIndex, page] of (documentModel.pages || []).entries()) {
    for (const block of (page.blocks || []).filter(item => !item.hidden && !item.redacted && item.reviewStatus !== 'confirmed_non_text').sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (block.type === 'table') body.push(tableToWordXml(block));
      else if (block.type === 'image') body.push(`<w:p><w:r><w:t>[รูปภาพ: ${xmlEscape(block.alt || 'image')}]</w:t></w:r></w:p>`);
      else {
        const text = ['field', 'checkbox', 'radio', 'barcode', 'qr', 'label', 'value'].includes(block.type) ? `${block.label || ''}${block.label && block.value ? ': ' : ''}${block.value || ''}` : block.text || '';
        for (const line of String(text).split('\n')) body.push(`<w:p><w:pPr><w:jc w:val="${block.style?.textAlign === 'center' ? 'center' : block.style?.textAlign === 'right' ? 'right' : 'left'}"/></w:pPr><w:r><w:rPr>${Number(block.style?.fontWeight) >= 600 ? '<w:b/>' : ''}${block.style?.fontStyle === 'italic' ? '<w:i/>' : ''}<w:sz w:val="${Math.round((Number(block.style?.fontSize) || 16) * 1.5)}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(line || ' ')}</w:t></w:r></w:p>`);
      }
    }
    if (pageIndex < documentModel.pages.length - 1) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  }
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

function wordBlockText(block) {
  if (block.type === 'image') return `[Image: ${block.alt || 'image'}]`;
  if (['checkbox', 'radio'].includes(block.type)) return `${block.checked ? '☒' : '☐'} ${block.label || ''}${block.value ? ` ${block.value}` : ''}`.trim();
  if (['field', 'barcode', 'qr', 'label', 'value', 'signature', 'stamp'].includes(block.type)) return `${block.label || ''}${block.label && block.value ? ': ' : ''}${block.value || ''}`;
  return block.text || '';
}

export function blockToWordPositionedXml(block, imageRelationshipId = '') {
  const id = xmlEscape(String(block.id || `block-${Math.random().toString(36).slice(2)}`));
  const position = `position:absolute;margin-left:${pxToPoints(block.x)}pt;margin-top:${pxToPoints(block.y)}pt;width:${pxToPoints(block.width)}pt;height:${pxToPoints(block.height)}pt;z-index:${Math.round(Number(block.zIndex) || 1)};mso-position-horizontal-relative:page;mso-position-vertical-relative:page`;
  if (block.redacted) return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:pict><v:shape id="${id}" type="#_x0000_t202" style="${position}" filled="t" fillcolor="#000000" stroked="f"/></w:pict></w:r></w:p>`;
  if (block.type === 'image' && imageRelationshipId) {
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:pict><v:shape id="${id}" type="#_x0000_t75" style="${position}" stroked="f"><v:imagedata r:id="${xmlEscape(imageRelationshipId)}" o:title="${xmlEscape(block.alt || 'image')}"/></v:shape></w:pict></w:r></w:p>`;
  }
  if (block.type === 'shape' || block.type === 'line') {
    const fill = block.type === 'line' || block.style?.fill === 'transparent' ? 'f' : 't';
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:pict><v:shape id="${id}" type="#_x0000_t202" style="${position}" filled="${fill}" fillcolor="#${officeColor(block.style?.fill, 'FFFFFF')}" stroked="t" strokecolor="#${officeColor(block.style?.stroke, '111827')}" strokeweight="${Math.max(.5, Number(block.style?.strokeWidth) || 1)}pt"/></w:pict></w:r></w:p>`;
  }
  const content = block.type === 'table' ? tableToWordXml(block) : wordParagraphs(wordBlockText(block), block.style || {});
  const transparent = !block.style?.backgroundColor || block.style.backgroundColor === 'transparent';
  const borderWidth = Number(block.style?.borderWidth) || 0;
  const padding = pxToPoints(block.style?.padding ?? 2);
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:pict><v:shape id="${id}" type="#_x0000_t202" style="${position}" filled="${transparent ? 'f' : 't'}" fillcolor="#${officeColor(block.style?.backgroundColor, 'FFFFFF')}" stroked="${borderWidth > 0 ? 't' : 'f'}" strokecolor="#${officeColor(block.style?.borderColor, 'D1D5DB')}" strokeweight="${Math.max(.5, borderWidth)}pt"><v:textbox inset="${padding}pt,${padding}pt,${padding}pt,${padding}pt"><w:txbxContent>${content || '<w:p/>'}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
}

async function imagePayload(source) {
  if (!source) return null;
  const data = String(source).match(/^data:(image\/(?:png|jpeg|jpg|gif));base64,(.+)$/iu);
  if (data) {
    const binary = atob(data[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const extension = data[1].toLowerCase().includes('png') ? 'png' : data[1].toLowerCase().includes('gif') ? 'gif' : 'jpg';
    return { bytes, extension };
  }
  try {
    const response = await fetch(source);
    if (!response.ok) return null;
    const mime = response.headers.get('content-type') || '';
    const extension = mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : 'jpg';
    return { bytes: new Uint8Array(await response.arrayBuffer()), extension };
  } catch {
    return null;
  }
}

function wordSection(page) {
  return `<w:sectPr><w:pgSz w:w="${pxToTwips(page.width || 794)}" w:h="${pxToTwips(page.height || 1123)}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
}

export async function modelToDocxBlob(documentModel) {
  if (!globalThis.JSZip) throw new Error('โหลดระบบ DOCX ไม่สำเร็จ');
  const zip = new globalThis.JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const body = [];
  const relationships = [];
  let imageIndex = 0;
  const pages = documentModel.pages || [];
  for (const [pageIndex, page] of pages.entries()) {
    const blocks = (page.blocks || []).filter(item => !item.hidden && item.reviewStatus !== 'confirmed_non_text').sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0) || a.y - b.y || a.x - b.x);
    for (const block of blocks) {
      let relationshipId = '';
      if (block.type === 'image') {
        const payload = await imagePayload(block.src);
        if (payload) {
          imageIndex += 1;
          relationshipId = `rIdImage${imageIndex}`;
          const name = `image${imageIndex}.${payload.extension}`;
          zip.folder('word').folder('media').file(name, payload.bytes);
          relationships.push(`<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
        }
      }
      body.push(blockToWordPositionedXml(block, relationshipId));
    }
    if (pageIndex < pages.length - 1) body.push(`<w:p><w:pPr>${wordSection(page)}<w:pageBreakBefore/></w:pPr></w:p>`);
  }
  const lastPage = pages.at(-1) || { width: 794, height: 1123 };
  zip.folder('word').folder('_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`);
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body>${body.join('')}${wordSection(lastPage)}</w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

async function modelToXlsxBlobLegacy(documentModel) {
  await ensureStudioLibraries({ xlsx: true });
  const workbook = globalThis.XLSX.utils.book_new();
  let tableCount = 0;
  for (const [pageIndex, page] of (documentModel.pages || []).entries()) {
    const tables = (page.blocks || []).filter(block => block.type === 'table' && !block.hidden && !block.redacted && block.reviewStatus !== 'confirmed_non_text');
    if (!tables.length) {
      const rows = (page.blocks || []).filter(block => ['text', 'header', 'footer', 'field', 'checkbox', 'radio', 'barcode', 'qr', 'label', 'value'].includes(block.type) && !block.hidden && !block.redacted && block.reviewStatus !== 'confirmed_non_text').sort((a, b) => a.y - b.y || a.x - b.x).map(block => [['field', 'checkbox', 'radio', 'barcode', 'qr', 'label', 'value'].includes(block.type) ? block.label : '', ['field', 'checkbox', 'radio', 'barcode', 'qr', 'label', 'value'].includes(block.type) ? block.value : block.text || '']);
      const sheet = globalThis.XLSX.utils.aoa_to_sheet(rows.length ? rows : [['']]);
      globalThis.XLSX.utils.book_append_sheet(workbook, sheet, `Page ${pageIndex + 1}`.slice(0, 31));
      continue;
    }
    for (const table of tables) {
      tableCount += 1;
      const matrix = Array.from({ length: table.rows }, (_, row) => Array.from({ length: table.columns }, (_, column) => {
        const cell = getTableCell(table, row, column);
        if (!cell || cell.redacted || cell.reviewStatus === 'confirmed_non_text') return '';
        return cell.row === row && cell.column === column ? cell.text || '' : '';
      }));
      const sheet = globalThis.XLSX.utils.aoa_to_sheet(matrix);
      sheet['!cols'] = (table.columnWidths || []).map(width => ({ wpx: width }));
      sheet['!rows'] = (table.rowHeights || []).map(height => ({ hpx: height }));
      sheet['!merges'] = (table.cells || []).filter(cell => !cell.hidden && !cell.redacted && (cell.rowSpan > 1 || cell.columnSpan > 1)).map(cell => ({ s: { r: cell.row, c: cell.column }, e: { r: cell.row + cell.rowSpan - 1, c: cell.column + cell.columnSpan - 1 } }));
      globalThis.XLSX.utils.book_append_sheet(workbook, sheet, `Table ${tableCount}`.slice(0, 31));
    }
  }
  const bytes = globalThis.XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function spreadsheetCellStyle(cell = {}) {
  const style = cell.style || {};
  const background = cell.redacted ? '000000' : officeColor(style.backgroundColor, 'FFFFFF');
  return {
    font: {
      name: 'Arial',
      sz: Math.max(6, Math.round((Number(style.fontSize) || 14) * .75)),
      bold: Number(style.fontWeight) >= 600,
      italic: style.fontStyle === 'italic',
      underline: style.textDecoration === 'underline',
      color: { rgb: cell.redacted ? '000000' : officeColor(style.color, '111827') },
    },
    fill: { patternType: 'solid', fgColor: { rgb: background } },
    alignment: {
      horizontal: style.textAlign === 'center' ? 'center' : style.textAlign === 'right' ? 'right' : 'left',
      vertical: style.verticalAlign === 'top' ? 'top' : style.verticalAlign === 'bottom' ? 'bottom' : 'center',
      wrapText: true,
    },
    border: {
      top: { style: 'thin', color: { rgb: '64748B' } },
      right: { style: 'thin', color: { rgb: '64748B' } },
      bottom: { style: 'thin', color: { rgb: '64748B' } },
      left: { style: 'thin', color: { rgb: '64748B' } },
    },
  };
}

export function tableToWorksheet(table, XLSX = globalThis.XLSX) {
  if (!XLSX?.utils) throw new Error('xlsx_runtime_missing');
  const matrix = Array.from({ length: table.rows }, (_, row) => Array.from({ length: table.columns }, (_, column) => {
    const cell = getTableCell(table, row, column);
    if (!cell || cell.redacted || cell.reviewStatus === 'confirmed_non_text') return '';
    return cell.row === row && cell.column === column ? String(cell.text || '') : '';
  }));
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  for (let row = 0; row < table.rows; row += 1) {
    for (let column = 0; column < table.columns; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const source = getTableCell(table, row, column);
      sheet[address] ||= { t: 's', v: '' };
      sheet[address].s = spreadsheetCellStyle(source || {});
      sheet[address].z = '@';
    }
  }
  const defaultColumnWidth = (table.width || 640) / Math.max(1, table.columns);
  const defaultRowHeight = (table.height || 38 * table.rows) / Math.max(1, table.rows);
  sheet['!cols'] = Array.from({ length: table.columns }, (_, column) => ({ wpx: table.columnWidths?.[column] || defaultColumnWidth }));
  sheet['!rows'] = Array.from({ length: table.rows }, (_, row) => ({ hpx: table.rowHeights?.[row] || defaultRowHeight }));
  sheet['!merges'] = (table.cells || []).filter(cell => !cell.hidden && (cell.rowSpan > 1 || cell.columnSpan > 1)).map(cell => ({ s: { r: cell.row, c: cell.column }, e: { r: cell.row + cell.rowSpan - 1, c: cell.column + cell.columnSpan - 1 } }));
  sheet['!freeze'] = table.metadata?.headerRows ? { xSplit: 0, ySplit: Math.max(1, Number(table.metadata.headerRows) || 1) } : undefined;
  return sheet;
}

function cleanSheetName(value, fallback) {
  return String(value || fallback).replace(/[\\/?*\[\]:]/gu, '-').trim().slice(0, 31) || fallback;
}

function uniqueSheetName(workbook, requested) {
  const used = new Set(workbook.SheetNames.map(name => name.toLowerCase()));
  const base = cleanSheetName(requested, 'Sheet');
  if (!used.has(base.toLowerCase())) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base.slice(0, 31 - String(suffix).length - 1)} ${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `Sheet ${workbook.SheetNames.length + 1}`;
}

function categoryForTable(page, table, tableIndex) {
  if (table.metadata?.sheetName) return table.metadata.sheetName;
  const heading = (page.blocks || []).filter(block => ['header', 'text', 'label'].includes(block.type) && !block.hidden && !block.redacted && block.y <= table.y && (block.role === 'heading' || Number(block.style?.fontWeight) >= 600)).sort((a, b) => b.y - a.y)[0];
  return heading?.text || page.name || `Page ${page.number || 1} Table ${tableIndex + 1}`;
}

function contentRows(page) {
  return (page.blocks || []).filter(block => block.type !== 'table' && !block.hidden && !block.redacted && block.reviewStatus !== 'confirmed_non_text').sort((a, b) => a.y - b.y || a.x - b.x).map(block => {
    const value = ['field', 'checkbox', 'radio', 'barcode', 'qr', 'label', 'value', 'signature', 'stamp'].includes(block.type)
      ? `${block.label || ''}${block.label && block.value ? ': ' : ''}${block.value || ''}`
      : block.type === 'image' ? block.alt || '[image]' : block.text || '';
    return [block.role || block.type, block.type, value, block.x, block.y, block.width, block.height, block.reviewStatus || 'verified', block.confidence ?? 1];
  });
}

export async function modelToXlsxBlob(documentModel) {
  await ensureStudioLibraries({ xlsx: true });
  const XLSX = globalThis.XLSX;
  const workbook = XLSX.utils.book_new();
  for (const [pageIndex, page] of (documentModel.pages || []).entries()) {
    const tables = (page.blocks || []).filter(block => block.type === 'table' && !block.hidden && !block.redacted && block.reviewStatus !== 'confirmed_non_text');
    for (const [tableIndex, table] of tables.entries()) {
      const sheet = tableToWorksheet(table, XLSX);
      const name = uniqueSheetName(workbook, categoryForTable(page, table, tableIndex));
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    }
    let rows = contentRows(page);
    if (documentModel.sourceType === 'xlsx' && tables.length === 1 && rows.length === 1 && rows[0][2] === page.name) rows = [];
    if (rows.length || !tables.length) {
      const headings = [['Category', 'Type', 'Text / Value', 'X', 'Y', 'Width', 'Height', 'Review status', 'Confidence']];
      const sheet = XLSX.utils.aoa_to_sheet([...headings, ...rows]);
      sheet['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 60 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 12 }];
      sheet['!autofilter'] = { ref: `A1:I${Math.max(1, rows.length + 1)}` };
      sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
      const name = uniqueSheetName(workbook, `${page.name || `Page ${pageIndex + 1}`} Content`);
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    }
  }
  if (!workbook.SheetNames.length) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['']]), 'Document');
  workbook.Props = { Title: documentModel.name || 'RipScan document', Subject: 'Editable reconstruction exported by RipScan', Company: 'RipScan' };
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellStyles: true, compression: true });
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
