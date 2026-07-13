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
  if (xlsx && !globalThis.XLSX) jobs.push(loadExternalScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'XLSX'));
  if (render && !globalThis.html2canvas) jobs.push(loadExternalScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', 'html2canvas'));
  if (pdf && !globalThis.jspdf?.jsPDF) jobs.push(loadExternalScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js', 'jspdf'));
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
  if (normalized.format === 'searchable-pdf') return printSearchableDocument(pairs.map(item => item.page), filename, normalized);
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

function cssStyle(style = {}) {
  return Object.entries(style).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => {
    const property = key.replace(/[A-Z]/gu, character => `-${character.toLowerCase()}`);
    return `${property}:${typeof value === 'number' && !['fontWeight', 'lineHeight', 'opacity', 'zIndex'].includes(key) ? `${value}px` : value}`;
  }).join(';');
}

function searchableBlockHtml(block) {
  const position = `position:absolute;left:${block.x}px;top:${block.y}px;width:${block.width}px;height:${block.height}px;transform:rotate(${block.rotation || 0}deg);z-index:${block.zIndex || 1};box-sizing:border-box;`;
  if (block.type === 'image') return `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt || '')}" style="${position}object-fit:${block.fit || 'contain'};opacity:${block.opacity ?? 1};">`;
  if (block.type === 'table') {
    const rows = Array.from({ length: block.rows }, (_, row) => `<tr>${(block.cells || []).filter(cell => !cell.hidden && cell.row === row).sort((a, b) => a.column - b.column).map(cell => `<td rowspan="${cell.rowSpan}" colspan="${cell.columnSpan}" style="${cssStyle(cell.style)}">${escapeHtml(cell.text).replace(/\n/gu, '<br>')}</td>`).join('')}</tr>`).join('');
    return `<table style="${position}border-collapse:collapse;table-layout:fixed;background:${block.style?.backgroundColor || '#fff'}"><tbody>${rows}</tbody></table>`;
  }
  if (block.type === 'shape' || block.type === 'line') return `<div style="${position}background:${block.style?.fill || 'transparent'};border:${block.style?.strokeWidth || 1}px ${block.style?.dash || 'solid'} ${block.style?.stroke || '#111'}"></div>`;
  if (block.type === 'field') return `<div style="${position}${cssStyle(block.style)}"><strong>${escapeHtml(block.label)}</strong>${block.label ? ': ' : ''}${escapeHtml(block.value)}</div>`;
  return `<div style="${position}${cssStyle(block.style)};white-space:pre-wrap;overflow:hidden">${escapeHtml(block.text).replace(/\n/gu, '<br>')}</div>`;
}

export function printableDocumentHtml(pages, title, options = {}) {
  const margin = Math.max(0, Number(options.margin) || 0);
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{margin:${margin}px}*{box-sizing:border-box}body{margin:0;background:#e5e7eb;font-family:system-ui,'Noto Sans Thai',sans-serif}.print-page{position:relative;margin:0 auto;page-break-after:always;overflow:hidden}.print-page:last-child{page-break-after:auto}.print-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;z-index:0}table{border-collapse:collapse}td{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{background:#fff}.print-page{margin:0}}</style></head><body>${pages.map(page => `<section class="print-page" style="width:${page.width}px;height:${page.height}px;background:${page.background || '#fff'}">${page.backgroundImage ? `<img class="print-bg" src="${escapeHtml(page.backgroundImage)}">` : ''}${(page.blocks || []).filter(block => !block.hidden).sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1)).map(searchableBlockHtml).join('')}</section>`).join('')}<script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script></body></html>`;
}

export function printSearchableDocument(pages, title = 'RipScan Document', options = {}) {
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('กรุณาอนุญาต Pop-up เพื่อสร้าง Searchable PDF');
  popup.document.open();
  popup.document.write(printableDocumentHtml(pages, title, options));
  popup.document.close();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[<>&"']/gu, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '');
}

function tableToWordXml(table) {
  const rows = Array.from({ length: table.rows }, (_, row) => {
    const cells = (table.cells || []).filter(cell => !cell.hidden && cell.row === row).sort((a, b) => a.column - b.column).map(cell => {
      const properties = `<w:tcPr>${cell.columnSpan > 1 ? `<w:gridSpan w:val="${cell.columnSpan}"/>` : ''}${cell.rowSpan > 1 ? '<w:vMerge w:val="restart"/>' : ''}</w:tcPr>`;
      const paragraphs = String(cell.text || '').split('\n').map(line => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line || ' ')}</w:t></w:r></w:p>`).join('');
      return `<w:tc>${properties}${paragraphs}</w:tc>`;
    }).join('');
    return `<w:tr>${cells}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${rows}</w:tbl>`;
}

export async function modelToDocxBlob(documentModel) {
  if (!globalThis.JSZip) throw new Error('โหลดระบบ DOCX ไม่สำเร็จ');
  const zip = new globalThis.JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const body = [];
  for (const [pageIndex, page] of (documentModel.pages || []).entries()) {
    for (const block of (page.blocks || []).filter(item => !item.hidden).sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (block.type === 'table') body.push(tableToWordXml(block));
      else if (block.type === 'image') body.push(`<w:p><w:r><w:t>[รูปภาพ: ${xmlEscape(block.alt || block.src || 'image')}]</w:t></w:r></w:p>`);
      else {
        const text = block.type === 'field' ? `${block.label}${block.label ? ': ' : ''}${block.value}` : block.text || '';
        for (const line of String(text).split('\n')) body.push(`<w:p><w:pPr><w:jc w:val="${block.style?.textAlign === 'center' ? 'center' : block.style?.textAlign === 'right' ? 'right' : 'left'}"/></w:pPr><w:r><w:rPr>${Number(block.style?.fontWeight) >= 600 ? '<w:b/>' : ''}${block.style?.fontStyle === 'italic' ? '<w:i/>' : ''}<w:sz w:val="${Math.round((Number(block.style?.fontSize) || 16) * 1.5)}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(line || ' ')}</w:t></w:r></w:p>`);
      }
    }
    if (pageIndex < documentModel.pages.length - 1) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  }
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

export async function modelToXlsxBlob(documentModel) {
  await ensureStudioLibraries({ xlsx: true });
  const workbook = globalThis.XLSX.utils.book_new();
  let tableCount = 0;
  for (const [pageIndex, page] of (documentModel.pages || []).entries()) {
    const tables = (page.blocks || []).filter(block => block.type === 'table');
    if (!tables.length) {
      const rows = (page.blocks || []).filter(block => ['text', 'header', 'footer', 'field'].includes(block.type)).sort((a, b) => a.y - b.y || a.x - b.x).map(block => [block.type === 'field' ? block.label : '', block.type === 'field' ? block.value : block.text || '']);
      const sheet = globalThis.XLSX.utils.aoa_to_sheet(rows.length ? rows : [['']]);
      globalThis.XLSX.utils.book_append_sheet(workbook, sheet, `Page ${pageIndex + 1}`.slice(0, 31));
      continue;
    }
    for (const table of tables) {
      tableCount += 1;
      const matrix = Array.from({ length: table.rows }, (_, row) => Array.from({ length: table.columns }, (_, column) => getTableCell(table, row, column)?.text || ''));
      const sheet = globalThis.XLSX.utils.aoa_to_sheet(matrix);
      sheet['!cols'] = (table.columnWidths || []).map(width => ({ wpx: width }));
      sheet['!rows'] = (table.rowHeights || []).map(height => ({ hpx: height }));
      sheet['!merges'] = (table.cells || []).filter(cell => !cell.hidden && (cell.rowSpan > 1 || cell.columnSpan > 1)).map(cell => ({ s: { r: cell.row, c: cell.column }, e: { r: cell.row + cell.rowSpan - 1, c: cell.column + cell.columnSpan - 1 } }));
      globalThis.XLSX.utils.book_append_sheet(workbook, sheet, `Table ${tableCount}`.slice(0, 31));
    }
  }
  const bytes = globalThis.XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
