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
    officeMode: options.officeMode === 'original' ? 'original' : 'editable',
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
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
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
  let script;
  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    script = existing || document.createElement('script');
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
    };
    const handleLoad = () => {
      cleanup();
      const value = globalName ? globalThis[globalName] : true;
      if (value) resolve(value);
      else reject(new Error(`โหลด ${globalName || src} แล้วแต่ระบบไม่พร้อมใช้งาน`));
    };
    const handleError = () => {
      cleanup();
      reject(new Error(`โหลด ${src} ไม่สำเร็จ`));
    };
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`โหลดระบบส่งออกนานเกิน 20 วินาที กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่`));
    }, 20_000);
    if (!existing) {
      script.src = src;
      script.async = true;
      document.head.append(script);
    }
  }).catch(error => {
    scriptPromises.delete(src);
    script?.remove();
    throw error;
  });
  scriptPromises.set(src, promise);
  return promise;
}

export async function ensureStudioLibraries({ xlsx = false, render = false, pdf = false } = {}) {
  const jobs = [];
  if (xlsx && !globalThis.XLSX) jobs.push(loadExternalScript('/vendor/xlsx.full.min.js', 'XLSX'));
  if (render && !globalThis.html2canvas) jobs.push(loadExternalScript('/vendor/html2canvas.min.js', 'html2canvas'));
  if (pdf && !globalThis.jspdf?.jsPDF) jobs.push(loadExternalScript('/vendor/jspdf.umd.min.js', 'jspdf'));
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
    return downloadBlob(await modelToDocxBlob(documentModel, normalized), `${base}-${normalized.officeMode}.docx`);
  }
  if (normalized.format === 'xlsx') {
    const documentModel = options.documentModel;
    if (!documentModel) throw new Error('ไม่พบ Document Model สำหรับ XLSX');
    return downloadBlob(await modelToXlsxBlob(documentModel, { ...normalized, officeMode: 'editable' }), `${base}-editable.xlsx`);
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

const pxToPt = value => Math.max(0, Number(value) || 0) * .75;
const pxToTwip = value => Math.max(1, Math.round((Number(value) || 0) * 15));

function wordColor(value, fallback = '111827') {
  const clean = String(value || '').replace(/^#/u, '');
  return /^[0-9a-f]{6}$/iu.test(clean) ? clean.toUpperCase() : fallback;
}

function wordRunProperties(style = {}, options = {}) {
  const fontSize = Math.max(8, Number(style.fontSize) || 16);
  const hiddenSearchLayer = options.hiddenSearchLayer ? '<w:vanish/><w:webHidden/><w:noProof/>' : '';
  return `<w:rPr>${hiddenSearchLayer}${Number(style.fontWeight) >= 600 ? '<w:b/>' : ''}${style.fontStyle === 'italic' ? '<w:i/>' : ''}${style.textDecoration === 'underline' ? '<w:u w:val="single"/>' : ''}<w:color w:val="${wordColor(style.color)}"/><w:sz w:val="${Math.round(fontSize * 1.5)}"/><w:szCs w:val="${Math.round(fontSize * 1.5)}"/></w:rPr>`;
}

function wordParagraphXml(text, style = {}, options = {}) {
  const align = style.textAlign === 'center' ? 'center' : style.textAlign === 'right' ? 'right' : style.textAlign === 'justify' ? 'both' : 'left';
  return String(text ?? '').split('\n').map(line => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${Math.round((Number(style.fontSize) || 16) * (Number(style.lineHeight) || 1.15) * 15)}" w:lineRule="atLeast"/><w:jc w:val="${align}"/></w:pPr><w:r>${wordRunProperties(style, options)}<w:t xml:space="preserve">${xmlEscape(line || ' ')}</w:t></w:r></w:p>`).join('');
}

function tableToWordXml(table, options = {}) {
  const hiddenSearchLayer = Boolean(options.hiddenSearchLayer);
  const grid = Array.from({ length: table.columns }, (_, column) => Math.max(240, pxToTwip(table.columnWidths?.[column] || table.width / table.columns)));
  const rows = Array.from({ length: table.rows }, (_, row) => {
    const emitted = new Set();
    const cells = [];
    for (let column = 0; column < table.columns; column += 1) {
      const cell = getTableCell(table, row, column);
      if (!cell || emitted.has(cell.id)) continue;
      emitted.add(cell.id);
      if (cell.row < row) {
        if (column !== cell.column) continue;
        cells.push(`<w:tc><w:tcPr>${cell.columnSpan > 1 ? `<w:gridSpan w:val="${cell.columnSpan}"/>` : ''}<w:vMerge/></w:tcPr><w:p/></w:tc>`);
        column += cell.columnSpan - 1;
        continue;
      }
      const background = hiddenSearchLayer ? 'auto' : wordColor(cell.style?.backgroundColor, 'FFFFFF');
      const properties = `<w:tcPr><w:tcW w:w="${grid.slice(cell.column, cell.column + cell.columnSpan).reduce((sum, value) => sum + value, 0)}" w:type="dxa"/>${cell.columnSpan > 1 ? `<w:gridSpan w:val="${cell.columnSpan}"/>` : ''}${cell.rowSpan > 1 ? '<w:vMerge w:val="restart"/>' : ''}<w:vAlign w:val="${cell.style?.verticalAlign === 'top' ? 'top' : cell.style?.verticalAlign === 'bottom' ? 'bottom' : 'center'}"/><w:shd w:val="clear" w:color="auto" w:fill="${background}"/></w:tcPr>`;
      cells.push(`<w:tc>${properties}${wordParagraphXml(cell.text || ' ', cell.style, options)}</w:tc>`);
      column += cell.columnSpan - 1;
    }
    return `<w:tr><w:trPr><w:trHeight w:val="${pxToTwip(table.rowHeights?.[row] || table.height / table.rows)}" w:hRule="atLeast"/></w:trPr>${cells.join('')}</w:tr>`;
  }).join('');
  const borderValue = hiddenSearchLayer ? 'nil' : 'single';
  return `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblW w:w="${pxToTwip(table.width)}" w:type="dxa"/><w:tblBorders><w:top w:val="${borderValue}" w:sz="4"/><w:left w:val="${borderValue}" w:sz="4"/><w:bottom w:val="${borderValue}" w:sz="4"/><w:right w:val="${borderValue}" w:sz="4"/><w:insideH w:val="${borderValue}" w:sz="4"/><w:insideV w:val="${borderValue}" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${grid.map(width => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
}

function floatingShapeStyle(block, zIndex = block.zIndex || 1) {
  return `position:absolute;margin-left:${pxToPt(block.x)}pt;margin-top:${pxToPt(block.y)}pt;width:${Math.max(.75, pxToPt(block.width))}pt;height:${Math.max(.75, pxToPt(block.height))}pt;z-index:${zIndex};rotation:${Number(block.rotation) || 0};mso-position-horizontal-relative:page;mso-position-vertical-relative:page;mso-wrap-style:none`;
}

const wordAnchorParagraphPr = '<w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr>';

function floatingBlockXml(block, options = {}) {
  const hiddenSearchLayer = Boolean(options.hiddenSearchLayer);
  if (block.type === 'shape' || block.type === 'line') {
    if (hiddenSearchLayer) return '';
    const fill = block.style?.fill && block.style.fill !== 'transparent' ? wordColor(block.style.fill, 'FFFFFF') : 'none';
    return `<w:p>${wordAnchorParagraphPr}<w:r><w:pict><v:rect style="${floatingShapeStyle(block)}" ${fill === 'none' ? 'filled="f"' : `fillcolor="#${fill}"`} strokecolor="#${wordColor(block.style?.stroke, '111827')}" strokeweight="${Math.max(.5, Number(block.style?.strokeWidth) || 1)}pt"/></w:pict></w:r></w:p>`;
  }
  const content = block.type === 'table'
    ? tableToWordXml(block, options)
    : wordParagraphXml(block.type === 'field' ? `${block.label}${block.label ? ': ' : ''}${block.value}` : block.text || ' ', block.style, options);
  const inset = Math.max(0, pxToPt(block.style?.padding || 0));
  const stroked = !hiddenSearchLayer && Number(block.style?.borderWidth || 0) > 0 ? 't' : 'f';
  return `<w:p>${wordAnchorParagraphPr}<w:r><w:pict><v:rect style="${floatingShapeStyle(block)}" filled="f" stroked="${stroked}" strokecolor="#${wordColor(block.style?.borderColor, '111827')}"><v:textbox inset="${inset}pt,${inset}pt,${inset}pt,${inset}pt"><w:txbxContent>${content}</w:txbxContent></v:textbox></v:rect></w:pict></w:r></w:p>`;
}

function pageSectionXml(page) {
  return `<w:sectPr><w:pgSz w:w="${pxToTwip(page.width)}" w:h="${pxToTwip(page.height)}" w:orient="${page.width > page.height ? 'landscape' : 'portrait'}"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
}

async function officeImageAsset(src, index) {
  if (!src || typeof fetch !== 'function') return null;
  try {
    const response = await fetch(src);
    if (!response.ok && response.type !== 'blob') return null;
    const blob = await response.blob();
    const type = blob.type || 'image/jpeg';
    const extension = type.includes('png') ? 'png' : type.includes('gif') ? 'gif' : 'jpg';
    return { bytes: await blob.arrayBuffer(), extension, filename: `page-background-${index + 1}.${extension}`, type };
  } catch {
    return null;
  }
}

function floatingImageXml(block, relationshipId, title = 'Document image') {
  return `<w:p>${wordAnchorParagraphPr}<w:r><w:pict><v:rect style="${floatingShapeStyle(block, block.zIndex || 1)}" filled="f" stroked="f"><v:imagedata r:id="${relationshipId}" o:title="${xmlEscape(title)}"/></v:rect></w:pict></w:r></w:p>`;
}

export async function modelToDocxBlob(documentModel, options = {}) {
  if (!globalThis.JSZip) throw new Error('โหลดระบบ DOCX ไม่สำเร็จ');
  const zip = new globalThis.JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const pages = documentModel.pages || [];
  const relationships = [];
  const body = [];
  let imageSequence = 0;
  for (const [pageIndex, page] of pages.entries()) {
    const preserveOriginalAppearance = options.officeMode === 'original'
      && Boolean(page.backgroundImage && page.metadata?.preserveBackgroundInOffice);
    const pageImages = [
      ...(preserveOriginalAppearance ? [{
        src: page.backgroundImage,
        title: `Original page ${pageIndex + 1}`,
        block: { x: 0, y: 0, width: page.width, height: page.height, zIndex: -100, rotation: 0 },
      }] : []),
      ...(page.blocks || []).filter(block => !block.hidden && block.type === 'image' && block.src).map(block => ({
        src: block.src,
        title: block.alt || `Image ${imageSequence + 1}`,
        block,
      })),
    ];
    const assets = await Promise.all(pageImages.map(async image => {
      imageSequence += 1;
      const sequence = imageSequence;
      return { ...image, asset: await officeImageAsset(image.src, sequence - 1), relationshipId: `rIdImage${sequence}` };
    }));
    for (const image of assets) {
      if (!image.asset) continue;
      zip.folder('word').folder('media').file(image.asset.filename, image.asset.bytes);
      relationships.push(`<Relationship Id="${image.relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.asset.filename}"/>`);
      body.push(floatingImageXml(image.block, image.relationshipId, image.title));
    }
    for (const block of (page.blocks || []).filter(item => !item.hidden && item.type !== 'image').sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1) || a.y - b.y || a.x - b.x)) {
      body.push(floatingBlockXml(block, {
        hiddenSearchLayer: preserveOriginalAppearance && Boolean(block.metadata?.ocrSearchOverlay),
      }));
    }
    if (pageIndex < pages.length - 1) {
      body.push(`<w:p><w:pPr>${pageSectionXml(page)}</w:pPr><w:r><w:br w:type="page"/></w:r></w:p>`);
    }
  }
  const lastPage = pages.at(-1) || { width: 794, height: 1123 };
  zip.folder('word').folder('_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`);
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}${pageSectionXml(lastPage)}</w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

export async function modelToXlsxBlob(documentModel, options = {}) {
  await ensureStudioLibraries({ xlsx: true });
  const workbook = globalThis.XLSX.utils.book_new();
  workbook.Props = {
    Title: documentModel.name || 'RipScan Editable OCR',
    Subject: options.officeMode === 'original' ? 'RipScan OCR export' : 'Editable OCR cells',
    Creator: 'RipScan',
  };
  let tableCount = 0;
  for (const [pageIndex, page] of (documentModel.pages || []).entries()) {
    const tables = (page.blocks || []).filter(block => block.type === 'table');
    if (!tables.length) {
      const sheet = globalThis.XLSX.utils.aoa_to_sheet([['']]);
      const columns = Math.max(16, Math.min(64, Math.round(page.width / 18)));
      const rows = Math.max(24, Math.min(140, Math.round(page.height / 14)));
      const occupied = new Set();
      const merges = [];
      const blocks = (page.blocks || []).filter(block => ['text', 'header', 'footer', 'field'].includes(block.type)).sort((a, b) => a.y - b.y || a.x - b.x);
      for (const block of blocks) {
        const text = block.type === 'field' ? `${block.label}${block.label ? ': ' : ''}${block.value}` : block.text || '';
        if (!text) continue;
        let row = Math.max(0, Math.min(rows - 1, Math.floor(block.y / Math.max(1, page.height) * rows)));
        const column = Math.max(0, Math.min(columns - 1, Math.floor(block.x / Math.max(1, page.width) * columns)));
        const endRow = Math.max(row, Math.min(rows - 1, Math.ceil((block.y + block.height) / Math.max(1, page.height) * rows) - 1));
        const endColumn = Math.max(column, Math.min(columns - 1, Math.ceil((block.x + block.width) / Math.max(1, page.width) * columns) - 1));
        while (row < rows - 1 && occupied.has(`${row}:${column}`)) row += 1;
        const address = globalThis.XLSX.utils.encode_cell({ r: row, c: column });
        sheet[address] = {
          t: 's',
          v: text,
          s: {
            alignment: {
              horizontal: block.style?.textAlign || 'left',
              vertical: block.style?.verticalAlign || 'top',
              wrapText: true,
            },
            font: {
              bold: Number(block.style?.fontWeight) >= 600,
              italic: block.style?.fontStyle === 'italic',
              sz: Math.max(8, Math.round((Number(block.style?.fontSize) || 16) * .75)),
            },
          },
        };
        const mergeEndRow = Math.max(row, endRow);
        if (mergeEndRow > row || endColumn > column) merges.push({ s: { r: row, c: column }, e: { r: mergeEndRow, c: endColumn } });
        for (let occupiedRow = row; occupiedRow <= mergeEndRow; occupiedRow += 1) {
          for (let occupiedColumn = column; occupiedColumn <= endColumn; occupiedColumn += 1) occupied.add(`${occupiedRow}:${occupiedColumn}`);
        }
      }
      sheet['!ref'] = `A1:${globalThis.XLSX.utils.encode_cell({ r: rows - 1, c: columns - 1 })}`;
      sheet['!cols'] = Array.from({ length: columns }, () => ({ wpx: page.width / columns }));
      sheet['!rows'] = Array.from({ length: rows }, () => ({ hpx: page.height / rows }));
      sheet['!merges'] = merges;
      sheet['!margins'] = { left: 0, right: 0, top: 0, bottom: 0, header: 0, footer: 0 };
      globalThis.XLSX.utils.book_append_sheet(workbook, sheet, `Page ${pageIndex + 1}`.slice(0, 31));
      continue;
    }
    for (const table of tables) {
      tableCount += 1;
      const matrix = Array.from({ length: table.rows }, (_, row) => Array.from({ length: table.columns }, (_, column) => {
        const cell = getTableCell(table, row, column);
        return cell && cell.row === row && cell.column === column ? cell.text || '' : '';
      }));
      const sheet = globalThis.XLSX.utils.aoa_to_sheet(matrix);
      sheet['!cols'] = (table.columnWidths || []).map(width => ({ wpx: width }));
      sheet['!rows'] = (table.rowHeights || []).map(height => ({ hpx: height }));
      sheet['!merges'] = (table.cells || []).filter(cell => !cell.hidden && (cell.rowSpan > 1 || cell.columnSpan > 1)).map(cell => ({ s: { r: cell.row, c: cell.column }, e: { r: cell.row + cell.rowSpan - 1, c: cell.column + cell.columnSpan - 1 } }));
      sheet['!margins'] = { left: 0, right: 0, top: 0, bottom: 0, header: 0, footer: 0 };
      globalThis.XLSX.utils.book_append_sheet(workbook, sheet, `Table ${tableCount}`.slice(0, 31));
    }
  }
  const bytes = globalThis.XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
