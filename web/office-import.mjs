import {
  createDocument,
  createPage,
  createTextBlock,
  createTableBlock,
  createTableCell,
  createImageBlock,
  createShapeBlock,
  normalizeDocumentModel,
} from './document-model.mjs';

export const STRUCTURED_EXTENSIONS = new Set([
  'docx', 'xlsx', 'xls', 'pptx', 'txt', 'csv', 'html', 'htm', 'rtf', 'odt', 'ods', 'odp', 'json',
]);

const MIME_EXTENSION = new Map([
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
  ['application/vnd.ms-excel', 'xls'],
  ['text/plain', 'txt'],
  ['text/csv', 'csv'],
  ['text/html', 'html'],
  ['application/rtf', 'rtf'],
  ['text/rtf', 'rtf'],
  ['application/vnd.oasis.opendocument.text', 'odt'],
  ['application/vnd.oasis.opendocument.spreadsheet', 'ods'],
  ['application/vnd.oasis.opendocument.presentation', 'odp'],
]);

export function extensionOf(fileOrName) {
  if (typeof fileOrName === 'string') return fileOrName.split('.').pop()?.toLowerCase() || '';
  const byName = String(fileOrName?.name || '').split('.').pop()?.toLowerCase() || '';
  return byName || MIME_EXTENSION.get(fileOrName?.type) || '';
}

export function isStructuredDocumentFile(file) {
  return STRUCTURED_EXTENSIONS.has(extensionOf(file));
}

function requireDomParser() {
  if (typeof DOMParser === 'undefined') throw new Error('เบราว์เซอร์นี้ไม่รองรับ XML Parser');
  return DOMParser;
}

function parseXml(text) {
  const Parser = requireDomParser();
  const document = new Parser().parseFromString(String(text || ''), 'application/xml');
  const error = document.querySelector('parsererror');
  if (error) throw new Error(`อ่านโครงสร้าง XML ไม่สำเร็จ: ${error.textContent?.slice(0, 120) || 'unknown error'}`);
  return document;
}

function directChildren(node, localName) {
  return [...(node?.children || [])].filter(child => !localName || child.localName === localName);
}

function descendants(node, localName) {
  return [...(node?.getElementsByTagName('*') || [])].filter(child => child.localName === localName);
}

function firstDescendant(node, localName) {
  return descendants(node, localName)[0] || null;
}

function attributeByLocalName(node, name) {
  if (!node?.attributes) return '';
  return [...node.attributes].find(attribute => attribute.localName === name)?.value || '';
}

function xmlText(node, localName = '') {
  if (!node) return '';
  if (!localName) return node.textContent || '';
  return descendants(node, localName).map(item => item.textContent || '').join('');
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function emuToPx(value) {
  return Math.max(0, safeNumber(value) / 9525);
}

function twipToPx(value) {
  return Math.max(0, safeNumber(value) / 15);
}

function pointsToPx(value) {
  return Math.max(1, safeNumber(value, 12) * 96 / 72);
}

function normalizeHexColor(value, fallback = '#111827') {
  const clean = String(value || '').replace(/^#/, '').trim();
  return /^[0-9a-f]{6}$/i.test(clean) ? `#${clean}` : fallback;
}

function estimateTextHeight(text, fontSize = 16, width = 600, lineHeight = 1.45) {
  const average = Math.max(6, fontSize * .56);
  const charactersPerLine = Math.max(1, Math.floor(width / average));
  const lines = String(text || '').split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
  return Math.max(fontSize * lineHeight + 8, lines * fontSize * lineHeight + 8);
}

function ensureZip() {
  if (!globalThis.JSZip) throw new Error('โหลดระบบอ่านไฟล์ Office ไม่สำเร็จ (JSZip ไม่พร้อม)');
  return globalThis.JSZip;
}

function ensureXlsx() {
  if (!globalThis.XLSX) throw new Error('โหลดระบบ Excel ไม่สำเร็จ (SheetJS ไม่พร้อม)');
  return globalThis.XLSX;
}

async function zipXml(zip, path) {
  const entry = zip.file(path);
  if (!entry) return null;
  return parseXml(await entry.async('text'));
}

function resolveZipPath(basePath, target) {
  if (!target) return '';
  if (target.startsWith('/')) return target.slice(1);
  const parts = basePath.split('/');
  parts.pop();
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

async function relationshipMap(zip, path) {
  const document = await zipXml(zip, path);
  const basePath = path.replace(/_rels\/[^/]+\.rels$/u, '').replace(/\/$/u, '');
  const map = new Map();
  for (const relationship of descendants(document, 'Relationship')) {
    const id = attributeByLocalName(relationship, 'Id');
    const target = attributeByLocalName(relationship, 'Target');
    if (id && target) map.set(id, resolveZipPath(basePath, target));
  }
  return map;
}

function mimeFromPath(path) {
  const extension = path.split('.').pop()?.toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff' })[extension] || 'application/octet-stream';
}

async function zipImageDataUrl(zip, path) {
  const entry = zip.file(path);
  if (!entry) return '';
  const base64 = await entry.async('base64');
  return `data:${mimeFromPath(path)};base64,${base64}`;
}

export function parseCsv(text, delimiter = '') {
  const source = String(text || '').replace(/^\uFEFF/u, '');
  const detected = delimiter || (() => {
    const firstLine = source.split(/\r?\n/u)[0] || '';
    const candidates = [',', '\t', ';', '|'];
    return candidates.map(value => ({ value, count: firstLine.split(value).length - 1 })).sort((a, b) => b.count - a.count)[0]?.value || ',';
  })();
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === detected) { row.push(field); field = ''; continue; }
    if (character === '\n') { row.push(field.replace(/\r$/u, '')); rows.push(row); row = []; field = ''; continue; }
    field += character;
  }
  row.push(field.replace(/\r$/u, ''));
  if (row.some(value => value !== '') || !rows.length) rows.push(row);
  const width = Math.max(1, ...rows.map(item => item.length));
  return rows.map(item => [...item, ...Array.from({ length: width - item.length }, () => '')]);
}

export function rtfToText(source) {
  let text = String(source || '');
  text = text.replace(/\\par[d]?\b/gu, '\n');
  text = text.replace(/\\tab\b/gu, '\t');
  text = text.replace(/\\u(-?\d+)\??/gu, (_, value) => String.fromCharCode(Number(value) < 0 ? Number(value) + 65536 : Number(value)));
  text = text.replace(/\\'[0-9a-f]{2}/giu, match => {
    try { return new TextDecoder('windows-1252').decode(Uint8Array.of(parseInt(match.slice(2), 16))); }
    catch { return ''; }
  });
  text = text.replace(/\{\\\*[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/gu, '');
  text = text.replace(/\\[a-z]+-?\d* ?/giu, '');
  text = text.replace(/[{}]/gu, '');
  return text.replace(/\n{3,}/gu, '\n\n').trim();
}

function matrixToTableBlock(matrix, options = {}) {
  const rows = Math.max(1, matrix.length);
  const columns = Math.max(1, ...matrix.map(row => row.length));
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push(createTableCell({
        row,
        column,
        text: matrix[row]?.[column] ?? '',
        style: row === 0 && options.header !== false ? { fontWeight: 700, backgroundColor: '#e2e8f0', textAlign: 'center' } : {},
      }));
    }
  }
  const width = options.width || Math.max(420, columns * 130);
  const height = options.height || Math.max(90, rows * 38);
  return createTableBlock({ rows, columns, cells, width, height, ...options });
}

function addFlowText(page, state, text, role = 'paragraph', style = {}) {
  const clean = String(text || '').replace(/\s+$/gu, '');
  if (!clean) return null;
  const fontSize = Number(style.fontSize) || (role === 'heading' ? 28 : 16);
  const width = Math.max(120, page.width - state.marginLeft - state.marginRight);
  const height = estimateTextHeight(clean, fontSize, width, Number(style.lineHeight) || 1.45);
  if (state.y + height > page.height - state.marginBottom) return { overflow: true, text: clean, role, style };
  const block = createTextBlock({
    x: state.marginLeft,
    y: state.y,
    width,
    height,
    text: clean,
    role,
    style: {
      fontSize,
      fontWeight: role === 'heading' ? 700 : 400,
      ...style,
    },
    source: state.source,
  });
  page.blocks.push(block);
  state.y += height + (role === 'heading' ? 16 : 8);
  return block;
}

function newFlowState(source = 'import') {
  return { y: 56, marginLeft: 60, marginRight: 60, marginBottom: 56, source };
}

function pushFlowPage(documentModel, width = 794, height = 1123, name = '') {
  const page = createPage({ number: documentModel.pages.length + 1, width, height, name });
  documentModel.pages.push(page);
  return { page, state: newFlowState(documentModel.sourceType) };
}

export function textToDocument(text, { name = 'ข้อความ', sourceType = 'txt' } = {}) {
  const documentModel = createDocument({ name, sourceType });
  let { page, state } = pushFlowPage(documentModel);
  for (const paragraph of String(text || '').split(/\n{2,}/u)) {
    const result = addFlowText(page, state, paragraph.trim(), 'paragraph');
    if (result?.overflow) {
      ({ page, state } = pushFlowPage(documentModel));
      addFlowText(page, state, paragraph.trim(), 'paragraph');
    }
  }
  if (!documentModel.pages.length) pushFlowPage(documentModel);
  return normalizeDocumentModel(documentModel);
}

export function csvToDocument(text, { name = 'ตาราง CSV' } = {}) {
  const matrix = parseCsv(text);
  const documentModel = createDocument({ name, sourceType: 'csv' });
  const pageWidth = Math.max(794, matrix[0].length * 140 + 80);
  const pageHeight = Math.max(600, matrix.length * 40 + 130);
  const page = createPage({ number: 1, width: pageWidth, height: pageHeight, name: 'ตาราง' });
  page.blocks.push(createTextBlock({ x: 40, y: 26, width: pageWidth - 80, height: 42, text: name, role: 'heading', style: { fontSize: 26, fontWeight: 700 } }));
  page.blocks.push(matrixToTableBlock(matrix, { x: 40, y: 82, width: pageWidth - 80, height: Math.max(100, matrix.length * 38), source: 'csv' }));
  documentModel.pages.push(page);
  return normalizeDocumentModel(documentModel);
}

function htmlTableToMatrix(table) {
  const occupancy = [];
  const records = [];
  [...table.rows].forEach((row, rowIndex) => {
    occupancy[rowIndex] ||= [];
    let columnIndex = 0;
    [...row.cells].forEach(cell => {
      while (occupancy[rowIndex][columnIndex]) columnIndex += 1;
      const rowSpan = Math.max(1, Number(cell.rowSpan || 1));
      const columnSpan = Math.max(1, Number(cell.colSpan || 1));
      records.push({ row: rowIndex, column: columnIndex, rowSpan, columnSpan, text: cell.innerText || cell.textContent || '', header: cell.tagName === 'TH' });
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        occupancy[rowIndex + rowOffset] ||= [];
        for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) occupancy[rowIndex + rowOffset][columnIndex + columnOffset] = true;
      }
      columnIndex += columnSpan;
    });
  });
  return { records, rows: occupancy.length, columns: Math.max(1, ...occupancy.map(row => row.length)) };
}

export function htmlToDocument(html, { name = 'HTML Document' } = {}) {
  const Parser = requireDomParser();
  const dom = new Parser().parseFromString(String(html || ''), 'text/html');
  const documentModel = createDocument({ name, sourceType: 'html' });
  let { page, state } = pushFlowPage(documentModel);
  const elements = [...dom.body.children];
  for (const element of elements) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'table') {
      const parsed = htmlTableToMatrix(element);
      const height = Math.max(90, parsed.rows * 40);
      if (state.y + height > page.height - state.marginBottom) ({ page, state } = pushFlowPage(documentModel));
      const cells = parsed.records.map(record => createTableCell({
        ...record,
        style: record.header ? { fontWeight: 700, backgroundColor: '#e2e8f0', textAlign: 'center' } : {},
      }));
      page.blocks.push(createTableBlock({ rows: parsed.rows, columns: parsed.columns, cells, x: state.marginLeft, y: state.y, width: page.width - state.marginLeft - state.marginRight, height, source: 'html' }));
      state.y += height + 14;
      continue;
    }
    if (tag === 'img') {
      const width = Math.min(page.width - state.marginLeft - state.marginRight, Number(element.getAttribute('width')) || 420);
      const height = Number(element.getAttribute('height')) || Math.max(120, width * .6);
      if (state.y + height > page.height - state.marginBottom) ({ page, state } = pushFlowPage(documentModel));
      page.blocks.push(createImageBlock({ x: state.marginLeft, y: state.y, width, height, src: element.getAttribute('src') || '', alt: element.getAttribute('alt') || '', source: 'html' }));
      state.y += height + 12;
      continue;
    }
    const role = /^h[1-6]$/u.test(tag) ? 'heading' : tag === 'header' ? 'header' : tag === 'footer' ? 'footer' : 'paragraph';
    const style = {
      fontSize: role === 'heading' ? Math.max(20, 34 - Number(tag.slice(1) || 1) * 2) : 16,
      fontWeight: role === 'heading' || ['strong', 'b'].includes(tag) ? 700 : 400,
      textAlign: element.getAttribute('align') || 'left',
    };
    const result = addFlowText(page, state, element.innerText || element.textContent || '', role, style);
    if (result?.overflow) {
      ({ page, state } = pushFlowPage(documentModel));
      addFlowText(page, state, element.innerText || element.textContent || '', role, style);
    }
  }
  return normalizeDocumentModel(documentModel);
}

function docxRunStyle(run) {
  const properties = directChildren(run, 'rPr')[0] || firstDescendant(run, 'rPr');
  const size = attributeByLocalName(firstDescendant(properties, 'sz'), 'val');
  const color = attributeByLocalName(firstDescendant(properties, 'color'), 'val');
  return {
    fontWeight: firstDescendant(properties, 'b') ? 700 : 400,
    fontStyle: firstDescendant(properties, 'i') ? 'italic' : 'normal',
    textDecoration: firstDescendant(properties, 'u') ? 'underline' : 'none',
    fontSize: size ? pointsToPx(Number(size) / 2) : 16,
    color: color && color !== 'auto' ? normalizeHexColor(color) : '#111827',
  };
}

function docxParagraphData(paragraph) {
  const runs = directChildren(paragraph, 'r');
  const pieces = [];
  const spans = [];
  for (const run of runs) {
    const style = docxRunStyle(run);
    let text = '';
    for (const child of directChildren(run)) {
      if (child.localName === 't') text += child.textContent || '';
      if (child.localName === 'tab') text += '\t';
      if (child.localName === 'br') text += '\n';
    }
    if (text) {
      spans.push({ text, style });
      pieces.push(text);
    }
  }
  const properties = directChildren(paragraph, 'pPr')[0] || firstDescendant(paragraph, 'pPr');
  const styleId = attributeByLocalName(firstDescendant(properties, 'pStyle'), 'val');
  const align = attributeByLocalName(firstDescendant(properties, 'jc'), 'val');
  const heading = /^Heading|^หัวข้อ/iu.test(styleId);
  const firstStyle = spans[0]?.style || {};
  return {
    text: pieces.join(''),
    spans,
    role: heading ? 'heading' : 'paragraph',
    style: {
      ...firstStyle,
      fontSize: heading ? Math.max(22, firstStyle.fontSize || 24) : firstStyle.fontSize || 16,
      fontWeight: heading ? 700 : firstStyle.fontWeight || 400,
      textAlign: ({ center: 'center', right: 'right', both: 'justify' })[align] || 'left',
    },
  };
}

function docxTableData(tableNode) {
  const rows = directChildren(tableNode, 'tr');
  const cells = [];
  const activeVerticalMerges = new Map();
  let columnCount = 0;
  rows.forEach((rowNode, rowIndex) => {
    let column = 0;
    for (const cellNode of directChildren(rowNode, 'tc')) {
      const properties = directChildren(cellNode, 'tcPr')[0] || firstDescendant(cellNode, 'tcPr');
      const span = Math.max(1, safeNumber(attributeByLocalName(firstDescendant(properties, 'gridSpan'), 'val'), 1));
      const verticalMerge = firstDescendant(properties, 'vMerge');
      const mergeValue = attributeByLocalName(verticalMerge, 'val');
      const text = directChildren(cellNode).filter(child => child.localName === 'p').map(item => docxParagraphData(item).text).join('\n');
      if (verticalMerge && mergeValue !== 'restart') {
        const anchor = activeVerticalMerges.get(column);
        if (anchor) anchor.rowSpan += 1;
        column += span;
        continue;
      }
      const cell = createTableCell({ row: rowIndex, column, columnSpan: span, text });
      cells.push(cell);
      if (verticalMerge && mergeValue === 'restart') activeVerticalMerges.set(column, cell);
      else activeVerticalMerges.delete(column);
      column += span;
    }
    columnCount = Math.max(columnCount, column);
  });
  return { rows: Math.max(1, rows.length), columns: Math.max(1, columnCount), cells };
}

async function docxParagraphImages(zip, paragraph, relationships) {
  const images = [];
  for (const blip of descendants(paragraph, 'blip')) {
    const relationshipId = attributeByLocalName(blip, 'embed');
    const path = relationships.get(relationshipId);
    if (!path) continue;
    const extent = firstDescendant(paragraph, 'extent');
    images.push({
      src: await zipImageDataUrl(zip, path),
      width: Math.max(80, emuToPx(attributeByLocalName(extent, 'cx')) || 240),
      height: Math.max(60, emuToPx(attributeByLocalName(extent, 'cy')) || 160),
      alt: path.split('/').pop() || 'รูปภาพ',
    });
  }
  return images;
}

export async function importDocx(file, { onProgress = () => {} } = {}) {
  onProgress({ stage: 'open', progress: .05, label: 'กำลังเปิด DOCX' });
  const Zip = ensureZip();
  const zip = await Zip.loadAsync(await file.arrayBuffer());
  const documentXml = await zipXml(zip, 'word/document.xml');
  if (!documentXml) throw new Error('ไม่พบ word/document.xml ในไฟล์ DOCX');
  const relationships = await relationshipMap(zip, 'word/_rels/document.xml.rels');
  const section = firstDescendant(documentXml, 'sectPr');
  const pageSize = firstDescendant(section, 'pgSz');
  const pageWidth = twipToPx(attributeByLocalName(pageSize, 'w')) || 794;
  const pageHeight = twipToPx(attributeByLocalName(pageSize, 'h')) || 1123;
  const margins = firstDescendant(section, 'pgMar');
  const baseState = {
    marginLeft: twipToPx(attributeByLocalName(margins, 'left')) || 60,
    marginRight: twipToPx(attributeByLocalName(margins, 'right')) || 60,
    marginBottom: twipToPx(attributeByLocalName(margins, 'bottom')) || 56,
  };
  const documentModel = createDocument({ name: file.name, sourceType: 'docx', metadata: { faithfulMode: 'ooxml_reconstruction' } });
  let page = createPage({ number: 1, width: pageWidth, height: pageHeight });
  documentModel.pages.push(page);
  let state = { ...newFlowState('docx'), ...baseState };
  const body = firstDescendant(documentXml, 'body');
  const content = directChildren(body).filter(child => ['p', 'tbl'].includes(child.localName));
  for (let index = 0; index < content.length; index += 1) {
    const node = content[index];
    onProgress({ stage: 'parse', progress: .1 + .75 * (index + 1) / Math.max(1, content.length), label: `นำเข้า Word ${index + 1}/${content.length}` });
    if (node.localName === 'tbl') {
      const parsed = docxTableData(node);
      const height = Math.max(80, parsed.rows * 42);
      if (state.y + height > page.height - state.marginBottom) {
        page = createPage({ number: documentModel.pages.length + 1, width: pageWidth, height: pageHeight });
        documentModel.pages.push(page);
        state = { ...newFlowState('docx'), ...baseState };
      }
      page.blocks.push(createTableBlock({ ...parsed, x: state.marginLeft, y: state.y, width: page.width - state.marginLeft - state.marginRight, height, source: 'docx' }));
      state.y += height + 14;
      continue;
    }
    const data = docxParagraphData(node);
    const images = await docxParagraphImages(zip, node, relationships);
    for (const image of images) {
      if (state.y + image.height > page.height - state.marginBottom) {
        page = createPage({ number: documentModel.pages.length + 1, width: pageWidth, height: pageHeight });
        documentModel.pages.push(page);
        state = { ...newFlowState('docx'), ...baseState };
      }
      page.blocks.push(createImageBlock({ x: state.marginLeft, y: state.y, width: Math.min(image.width, page.width - state.marginLeft - state.marginRight), height: image.height, src: image.src, alt: image.alt, source: 'docx' }));
      state.y += image.height + 10;
    }
    if (!data.text) continue;
    let result = addFlowText(page, state, data.text, data.role, data.style);
    if (result?.overflow) {
      page = createPage({ number: documentModel.pages.length + 1, width: pageWidth, height: pageHeight });
      documentModel.pages.push(page);
      state = { ...newFlowState('docx'), ...baseState };
      result = addFlowText(page, state, data.text, data.role, data.style);
    }
    if (result && !result.overflow) result.spans = data.spans;
  }
  onProgress({ stage: 'done', progress: 1, label: 'นำเข้า DOCX เสร็จแล้ว' });
  return normalizeDocumentModel(documentModel);
}

function xlsxCellStyle(cell, isHeader = false) {
  const style = cell?.s || {};
  const font = style.font || {};
  const fillColor = style.fill?.fgColor?.rgb || style.fill?.bgColor?.rgb;
  const fontColor = font.color?.rgb;
  return {
    fontWeight: font.bold || isHeader ? 700 : 400,
    fontStyle: font.italic ? 'italic' : 'normal',
    textDecoration: font.underline ? 'underline' : 'none',
    fontSize: font.sz ? pointsToPx(font.sz) : 14,
    color: fontColor ? normalizeHexColor(fontColor.slice(-6)) : '#111827',
    backgroundColor: fillColor ? normalizeHexColor(fillColor.slice(-6), '#ffffff') : (isHeader ? '#e2e8f0' : '#ffffff'),
    textAlign: style.alignment?.horizontal || (isHeader ? 'center' : 'left'),
    verticalAlign: style.alignment?.vertical || 'middle',
    borderTop: style.border?.top ? '1px solid #64748b' : '1px solid #cbd5e1',
    borderRight: style.border?.right ? '1px solid #64748b' : '1px solid #cbd5e1',
    borderBottom: style.border?.bottom ? '1px solid #64748b' : '1px solid #cbd5e1',
    borderLeft: style.border?.left ? '1px solid #64748b' : '1px solid #cbd5e1',
  };
}

export async function importXlsx(file, { onProgress = () => {} } = {}) {
  const XLSX = ensureXlsx();
  onProgress({ stage: 'open', progress: .05, label: 'กำลังเปิด Excel' });
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellStyles: true, cellDates: true, dense: false });
  const documentModel = createDocument({ name: file.name, sourceType: 'xlsx', metadata: { sheetCount: workbook.SheetNames.length } });
  for (let sheetIndex = 0; sheetIndex < workbook.SheetNames.length; sheetIndex += 1) {
    const sheetName = workbook.SheetNames[sheetIndex];
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
    const rows = Math.max(1, range.e.r - range.s.r + 1);
    const columns = Math.max(1, range.e.c - range.s.c + 1);
    const cells = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const address = XLSX.utils.encode_cell({ r: range.s.r + row, c: range.s.c + column });
        const sourceCell = sheet[address];
        cells.push(createTableCell({
          row,
          column,
          text: sourceCell ? String(sourceCell.w ?? sourceCell.v ?? '') : '',
          style: xlsxCellStyle(sourceCell, row === 0),
        }));
      }
    }
    for (const merge of sheet['!merges'] || []) {
      const row = merge.s.r - range.s.r;
      const column = merge.s.c - range.s.c;
      const anchor = cells.find(cell => cell.row === row && cell.column === column);
      if (!anchor) continue;
      anchor.rowSpan = merge.e.r - merge.s.r + 1;
      anchor.columnSpan = merge.e.c - merge.s.c + 1;
      for (const cell of cells) {
        if (cell === anchor) continue;
        if (cell.row >= row && cell.row <= row + anchor.rowSpan - 1 && cell.column >= column && cell.column <= column + anchor.columnSpan - 1) cell.hidden = true;
      }
    }
    const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(48, safeNumber(sheet['!cols']?.[range.s.c + column]?.wpx, safeNumber(sheet['!cols']?.[range.s.c + column]?.wch, 12) * 8)));
    const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(24, safeNumber(sheet['!rows']?.[range.s.r + row]?.hpx, safeNumber(sheet['!rows']?.[range.s.r + row]?.hpt, 22) * 96 / 72)));
    const tableWidth = columnWidths.reduce((sum, value) => sum + value, 0);
    const tableHeight = rowHeights.reduce((sum, value) => sum + value, 0);
    const page = createPage({ number: sheetIndex + 1, name: sheetName, width: Math.max(900, tableWidth + 80), height: Math.max(600, tableHeight + 130) });
    page.blocks.push(createTextBlock({ x: 40, y: 22, width: page.width - 80, height: 46, text: sheetName, role: 'heading', style: { fontSize: 26, fontWeight: 700 }, source: 'xlsx' }));
    page.blocks.push(createTableBlock({ rows, columns, cells, columnWidths, rowHeights, x: 40, y: 82, width: tableWidth, height: tableHeight, source: 'xlsx', metadata: { sheetName } }));
    documentModel.pages.push(page);
    onProgress({ stage: 'parse', progress: .1 + .85 * (sheetIndex + 1) / workbook.SheetNames.length, label: `นำเข้า Sheet ${sheetIndex + 1}/${workbook.SheetNames.length}` });
  }
  onProgress({ stage: 'done', progress: 1, label: 'นำเข้า Excel เสร็จแล้ว' });
  return normalizeDocumentModel(documentModel);
}

function pptxTextStyle(shape) {
  const runProperties = firstDescendant(shape, 'rPr') || firstDescendant(shape, 'defRPr');
  const paragraphProperties = firstDescendant(shape, 'pPr');
  const size = attributeByLocalName(runProperties, 'sz');
  const solidFill = firstDescendant(runProperties, 'solidFill');
  const colorNode = solidFill ? (firstDescendant(solidFill, 'srgbClr') || firstDescendant(solidFill, 'schemeClr')) : null;
  const color = attributeByLocalName(colorNode, 'val');
  return {
    fontSize: size ? pointsToPx(Number(size) / 100) : 22,
    fontWeight: attributeByLocalName(runProperties, 'b') === '1' ? 700 : 400,
    fontStyle: attributeByLocalName(runProperties, 'i') === '1' ? 'italic' : 'normal',
    color: /^[0-9a-f]{6}$/iu.test(color) ? `#${color}` : '#111827',
    textAlign: ({ ctr: 'center', r: 'right', just: 'justify' })[attributeByLocalName(paragraphProperties, 'algn')] || 'left',
  };
}

function pptxTransform(shape) {
  const transform = firstDescendant(shape, 'xfrm');
  const offset = firstDescendant(transform, 'off');
  const extent = firstDescendant(transform, 'ext');
  return {
    x: emuToPx(attributeByLocalName(offset, 'x')),
    y: emuToPx(attributeByLocalName(offset, 'y')),
    width: Math.max(8, emuToPx(attributeByLocalName(extent, 'cx')) || 160),
    height: Math.max(8, emuToPx(attributeByLocalName(extent, 'cy')) || 60),
    rotation: safeNumber(attributeByLocalName(transform, 'rot')) / 60000,
  };
}

export async function importPptx(file, { onProgress = () => {} } = {}) {
  const Zip = ensureZip();
  const zip = await Zip.loadAsync(await file.arrayBuffer());
  const presentation = await zipXml(zip, 'ppt/presentation.xml');
  if (!presentation) throw new Error('ไม่พบ ppt/presentation.xml ในไฟล์ PPTX');
  const pageSize = firstDescendant(presentation, 'sldSz');
  const pageWidth = emuToPx(attributeByLocalName(pageSize, 'cx')) || 1280;
  const pageHeight = emuToPx(attributeByLocalName(pageSize, 'cy')) || 720;
  const slidePaths = Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/u.test(path)).sort((a, b) => Number(a.match(/\d+/u)?.[0]) - Number(b.match(/\d+/u)?.[0]));
  const documentModel = createDocument({ name: file.name, sourceType: 'pptx', metadata: { slideCount: slidePaths.length } });
  for (let slideIndex = 0; slideIndex < slidePaths.length; slideIndex += 1) {
    const slidePath = slidePaths[slideIndex];
    const slide = await zipXml(zip, slidePath);
    const relationshipPath = slidePath.replace('/slides/', '/slides/_rels/') + '.rels';
    const relationships = await relationshipMap(zip, relationshipPath);
    const page = createPage({ number: slideIndex + 1, name: `สไลด์ ${slideIndex + 1}`, width: pageWidth, height: pageHeight, background: '#ffffff' });
    for (const shape of descendants(slide, 'sp')) {
      const text = descendants(shape, 't').map(item => item.textContent || '').join('\n').replace(/\n{3,}/gu, '\n\n').trim();
      if (!text) continue;
      page.blocks.push(createTextBlock({ ...pptxTransform(shape), text, style: pptxTextStyle(shape), role: firstDescendant(shape, 'title') ? 'heading' : 'paragraph', source: 'pptx' }));
    }
    for (const picture of descendants(slide, 'pic')) {
      const blip = firstDescendant(picture, 'blip');
      const relationshipId = attributeByLocalName(blip, 'embed');
      const path = relationships.get(relationshipId);
      if (!path) continue;
      page.blocks.push(createImageBlock({ ...pptxTransform(picture), src: await zipImageDataUrl(zip, path), alt: path.split('/').pop() || 'รูปภาพ', source: 'pptx' }));
    }
    for (const connector of descendants(slide, 'cxnSp')) {
      page.blocks.push(createShapeBlock({ ...pptxTransform(connector), shape: 'line', source: 'pptx' }));
    }
    documentModel.pages.push(page);
    onProgress({ stage: 'parse', progress: .1 + .85 * (slideIndex + 1) / Math.max(1, slidePaths.length), label: `นำเข้าสไลด์ ${slideIndex + 1}/${slidePaths.length}` });
  }
  return normalizeDocumentModel(documentModel);
}

function odfTableData(tableNode) {
  const rows = directChildren(tableNode).filter(child => child.localName === 'table-row');
  const matrix = [];
  for (const rowNode of rows) {
    const row = [];
    for (const cellNode of directChildren(rowNode).filter(child => ['table-cell', 'covered-table-cell'].includes(child.localName))) {
      const repeat = Math.max(1, safeNumber(attributeByLocalName(cellNode, 'number-columns-repeated'), 1));
      const text = descendants(cellNode, 'p').map(item => item.textContent || '').join('\n');
      for (let index = 0; index < repeat; index += 1) row.push(text);
    }
    matrix.push(row);
  }
  return matrix;
}

export async function importOpenDocument(file, { onProgress = () => {} } = {}) {
  const extension = extensionOf(file);
  const Zip = ensureZip();
  const zip = await Zip.loadAsync(await file.arrayBuffer());
  const content = await zipXml(zip, 'content.xml');
  if (!content) throw new Error('ไม่พบ content.xml ในไฟล์ OpenDocument');
  if (extension === 'ods') {
    const documentModel = createDocument({ name: file.name, sourceType: 'ods' });
    const tables = descendants(content, 'table').filter(node => node.parentElement?.localName === 'spreadsheet');
    tables.forEach((tableNode, index) => {
      const matrix = odfTableData(tableNode);
      const name = attributeByLocalName(tableNode, 'name') || `Sheet ${index + 1}`;
      const page = createPage({ number: index + 1, name, width: Math.max(900, (matrix[0]?.length || 1) * 140 + 80), height: Math.max(600, matrix.length * 40 + 130) });
      page.blocks.push(createTextBlock({ x: 40, y: 24, width: page.width - 80, height: 46, text: name, role: 'heading', style: { fontSize: 26, fontWeight: 700 } }));
      page.blocks.push(matrixToTableBlock(matrix, { x: 40, y: 82, width: page.width - 80, height: Math.max(90, matrix.length * 38), source: 'ods' }));
      documentModel.pages.push(page);
    });
    return normalizeDocumentModel(documentModel);
  }
  if (extension === 'odp') {
    const documentModel = createDocument({ name: file.name, sourceType: 'odp' });
    const pages = descendants(content, 'page');
    pages.forEach((pageNode, index) => {
      const page = createPage({ number: index + 1, name: attributeByLocalName(pageNode, 'name') || `สไลด์ ${index + 1}`, width: 1280, height: 720 });
      let y = 50;
      for (const paragraph of descendants(pageNode, 'p')) {
        const text = paragraph.textContent?.trim();
        if (!text) continue;
        page.blocks.push(createTextBlock({ x: 70, y, width: 1140, height: estimateTextHeight(text, 22, 1140), text, style: { fontSize: 22 }, source: 'odp' }));
        y += 54;
      }
      documentModel.pages.push(page);
    });
    return normalizeDocumentModel(documentModel);
  }
  const paragraphs = [...descendants(content, 'h'), ...descendants(content, 'p')].map(item => item.textContent || '').filter(Boolean);
  onProgress({ stage: 'parse', progress: .8, label: 'นำเข้า OpenDocument Text' });
  return textToDocument(paragraphs.join('\n\n'), { name: file.name, sourceType: 'odt' });
}

export async function importJsonDocument(file) {
  const parsed = JSON.parse(await file.text());
  if (parsed?.pages && Array.isArray(parsed.pages)) return normalizeDocumentModel(parsed);
  return textToDocument(JSON.stringify(parsed, null, 2), { name: file.name, sourceType: 'json' });
}

export async function importStructuredFile(file, options = {}) {
  const extension = extensionOf(file);
  const onProgress = options.onProgress || (() => {});
  if (!STRUCTURED_EXTENSIONS.has(extension)) throw new Error(`ยังไม่รองรับไฟล์ .${extension || 'unknown'} ใน Document Studio`);
  if (extension === 'docx') return importDocx(file, { onProgress });
  if (extension === 'xlsx' || extension === 'xls') return importXlsx(file, { onProgress });
  if (extension === 'pptx') return importPptx(file, { onProgress });
  if (['odt', 'ods', 'odp'].includes(extension)) return importOpenDocument(file, { onProgress });
  if (extension === 'csv') return csvToDocument(await file.text(), { name: file.name });
  if (extension === 'html' || extension === 'htm') return htmlToDocument(await file.text(), { name: file.name });
  if (extension === 'rtf') return textToDocument(rtfToText(await file.text()), { name: file.name, sourceType: 'rtf' });
  if (extension === 'json') return importJsonDocument(file);
  return textToDocument(await file.text(), { name: file.name, sourceType: extension || 'txt' });
}
