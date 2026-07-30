import {
  createDocument,
  createPage,
  createTextBlock,
  createTableBlock,
  createTableCell,
  normalizeDocumentModel,
} from './document-model.mjs';

export const OCR_LAYOUT_VERSION = '3.1.0';

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

function normalizedBox(box = {}, pageWidth = 1, pageHeight = 1) {
  const x0 = clamp(box.x0 ?? box.left, 0, pageWidth);
  const y0 = clamp(box.y0 ?? box.top, 0, pageHeight);
  const x1 = clamp(box.x1 ?? x0 + Number(box.width || 0), x0, pageWidth);
  const y1 = clamp(box.y1 ?? y0 + Number(box.height || 0), y0, pageHeight);
  return {
    x0,
    y0,
    x1,
    y1,
    left: x0,
    top: y0,
    width: Math.max(1, x1 - x0),
    height: Math.max(1, y1 - y0),
  };
}

function cleanText(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[\u200B\u200C\u200D\uFEFF]/gu, '')
    .replace(/[ \t]+/gu, ' ')
    .trim();
}

function lineKey(line) {
  return `${Math.round(line.bbox.left / 3)}:${Math.round(line.bbox.top / 3)}:${cleanText(line.text)}`;
}

function wordFromNode(word, pageWidth, pageHeight) {
  const text = cleanText(word?.text);
  if (!text) return null;
  return {
    text,
    confidence: clamp(Number(word.confidence || 0) / 100, 0, 1),
    bbox: normalizedBox(word.bbox, pageWidth, pageHeight),
    fontName: String(word.font_name || ''),
  };
}

function collectTesseractLines(blocks, pageWidth, pageHeight) {
  const lines = [];
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const words = (line.words || []).map(word => wordFromNode(word, pageWidth, pageHeight)).filter(Boolean);
        const text = cleanText(line.text || words.map(word => word.text).join(' '));
        if (!text) continue;
        lines.push({
          text,
          confidence: clamp(Number(line.confidence ?? paragraph.confidence ?? block.confidence ?? 0) / 100, 0, 1),
          bbox: normalizedBox(line.bbox || paragraph.bbox || block.bbox, pageWidth, pageHeight),
          baseline: line.baseline ? { ...line.baseline } : null,
          words,
        });
      }
    }
  }
  return lines;
}

function groupWordsIntoLines(words, pageWidth, pageHeight) {
  const groups = [];
  for (const word of [...words].sort((a, b) => a.bbox.top - b.bbox.top || a.bbox.left - b.bbox.left)) {
    const centerY = word.bbox.top + word.bbox.height / 2;
    const group = groups.find(candidate => Math.abs(candidate.centerY - centerY) <= Math.max(3, word.bbox.height * .48));
    if (group) {
      group.words.push(word);
      group.centerY = (group.centerY * (group.words.length - 1) + centerY) / group.words.length;
    } else groups.push({ centerY, words: [word] });
  }
  return groups.map(group => {
    group.words.sort((a, b) => a.bbox.left - b.bbox.left);
    const left = Math.min(...group.words.map(word => word.bbox.left));
    const top = Math.min(...group.words.map(word => word.bbox.top));
    const right = Math.max(...group.words.map(word => word.bbox.x1));
    const bottom = Math.max(...group.words.map(word => word.bbox.y1));
    return {
      text: group.words.map(word => word.text).join(' '),
      confidence: group.words.reduce((sum, word) => sum + word.confidence, 0) / group.words.length,
      bbox: normalizedBox({ x0: left, y0: top, x1: right, y1: bottom }, pageWidth, pageHeight),
      baseline: null,
      words: group.words,
    };
  });
}

function layoutText(lines) {
  const output = [];
  let previous = null;
  for (const line of lines) {
    if (previous) {
      const gap = line.bbox.top - previous.bbox.y1;
      if (gap > Math.max(previous.bbox.height, line.bbox.height) * 1.25) output.push('');
    }
    output.push(line.text);
    previous = line;
  }
  return output.join('\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function finalizeLayout(lines, pageWidth, pageHeight, source) {
  const unique = [...new Map(lines.map(line => [lineKey(line), line])).values()]
    .sort((a, b) => a.bbox.top - b.bbox.top || a.bbox.left - b.bbox.left);
  const words = unique.flatMap(line => line.words || []);
  const occupiedArea = unique.reduce((sum, line) => sum + line.bbox.width * line.bbox.height, 0);
  return {
    version: OCR_LAYOUT_VERSION,
    source,
    width: Math.max(1, Math.round(pageWidth)),
    height: Math.max(1, Math.round(pageHeight)),
    text: layoutText(unique),
    lines: unique,
    words,
    coverage: clamp(occupiedArea / Math.max(1, pageWidth * pageHeight), 0, 1),
  };
}

export function extractTesseractLayout(data = {}, pageWidth = 1, pageHeight = 1) {
  let lines = collectTesseractLines(data.blocks, pageWidth, pageHeight);
  if (!lines.length) {
    const words = [];
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (node.text && node.bbox && !node.words && !node.lines && !node.paragraphs) {
        const word = wordFromNode(node, pageWidth, pageHeight);
        if (word) words.push(word);
      }
      for (const key of ['blocks', 'paragraphs', 'lines', 'words']) visit(node[key]);
    };
    visit(data.blocks);
    lines = groupWordsIntoLines(words, pageWidth, pageHeight);
  }
  return finalizeLayout(lines, pageWidth, pageHeight, 'tesseract');
}

export function layoutFromPdfItems(items = [], pageWidth = 1, pageHeight = 1, scale = 1) {
  const words = items.filter(item => cleanText(item.str)).map(item => {
    const text = cleanText(item.str);
    const height = Math.max(1, Number(item.height || Math.abs(item.transform?.[3] || 10)) * scale);
    const x0 = Number(item.transform?.[4] || 0) * scale;
    const y0 = pageHeight - Number(item.transform?.[5] || 0) * scale - height;
    const width = Math.max(1, Number(item.width || text.length * height * .52) * scale);
    return {
      text,
      confidence: 1,
      bbox: normalizedBox({ x0, y0, x1: x0 + width, y1: y0 + height }, pageWidth, pageHeight),
      fontName: String(item.fontName || ''),
    };
  });
  return finalizeLayout(groupWordsIntoLines(words, pageWidth, pageHeight), pageWidth, pageHeight, 'pdf-text');
}

export function scoreOcrCandidate(candidate = {}) {
  const text = cleanText(candidate.text);
  const confidence = clamp(candidate.confidence, 0, 1);
  const replacementRatio = (text.match(/\uFFFD/gu) || []).length / Math.max(1, text.length);
  const controlRatio = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu) || []).length / Math.max(1, text.length);
  const isolatedMarkRatio = (text.match(/(?:^|[\s])[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/gu) || []).length / Math.max(1, text.length);
  const usefulCharacters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  const contentScore = clamp(usefulCharacters / 100, 0, 1);
  const lineScore = clamp((candidate.layout?.lines?.length || text.split('\n').filter(Boolean).length) / 10, 0, 1);
  const layoutScore = clamp((candidate.layout?.words?.length || 0) / 25, 0, 1);
  return confidence * .68 + contentScore * .12 + lineScore * .07 + layoutScore * .13
    - replacementRatio * .8 - controlRatio - isolatedMarkRatio * .45;
}

export function tableRecordsToBlock(records = [], options = {}) {
  const rows = Math.max(1, ...records.map(record => Number(record.rowIndex || 0) + Number(record.rowSpan || 1)));
  const columns = Math.max(1, ...records.map(record => Number(record.columnIndex || 0) + Number(record.columnSpan || 1)));
  const width = Math.max(80, Number(options.width) || columns * 120);
  const height = Math.max(32, Number(options.height) || rows * 38);
  return createTableBlock({
    x: Number(options.x) || 0,
    y: Number(options.y) || 0,
    width,
    height,
    rows,
    columns,
    columnWidths: Array.from({ length: columns }, () => width / columns),
    rowHeights: Array.from({ length: rows }, () => height / rows),
    cells: records.map(record => createTableCell({
      row: record.rowIndex,
      column: record.columnIndex,
      rowSpan: record.rowSpan,
      columnSpan: record.columnSpan,
      text: record.text,
      confidence: record.confidence ?? 1,
      reviewStatus: record.reviewStatus || 'verified',
    })),
    source: 'detected-table',
  });
}

export function ocrRowsToDocumentModel(rows = [], name = 'RipScan OCR') {
  const documentModel = createDocument({
    name,
    sourceType: 'ocr-layout',
    metadata: { fidelityMode: 'positioned_ocr_reconstruction', layoutVersion: OCR_LAYOUT_VERSION },
  });
  rows.forEach((row, index) => {
    const layout = row.layout || {};
    const width = Math.max(320, Number(layout.width || row.width || 794));
    const height = Math.max(240, Number(layout.height || row.height || 1123));
    const page = createPage({
      number: index + 1,
      width,
      height,
      backgroundImage: row.image || '',
      metadata: {
        sourcePage: row.originalPage || index + 1,
        ocrLayout: true,
        layoutVersion: layout.version || OCR_LAYOUT_VERSION,
        preserveBackgroundInOffice: Boolean(row.image),
      },
    });
    const tableBlocks = Array.isArray(row.tables) ? row.tables : [];
    if (tableBlocks.length) {
      page.blocks.push(...tableBlocks);
    } else if (layout.lines?.length) {
      const heights = layout.lines.map(line => line.bbox.height).sort((a, b) => a - b);
      const medianHeight = heights[Math.floor(heights.length / 2)] || 16;
      for (const line of layout.lines) {
        const fontSize = clamp(line.bbox.height * .76, 8, 64);
        page.blocks.push(createTextBlock({
          x: line.bbox.left,
          y: line.bbox.top,
          width: line.bbox.width,
          height: Math.max(line.bbox.height, fontSize * 1.18),
          text: line.text,
          spans: line.words || [],
          role: line.bbox.height >= medianHeight * 1.42 ? 'heading' : 'paragraph',
          confidence: line.confidence,
          reviewStatus: line.confidence >= .85 ? 'verified' : 'review_required',
          source: layout.source || 'ocr-layout',
          style: {
            fontSize,
            lineHeight: 1.05,
            padding: 0,
            backgroundColor: 'transparent',
            fontWeight: line.bbox.height >= medianHeight * 1.42 ? 700 : 400,
          },
          metadata: { bbox: { ...line.bbox }, baseline: line.baseline || null },
        }));
      }
    } else {
      const lines = String(row.text || '').split(/\r?\n/gu);
      const lineHeight = Math.max(18, Math.min(30, height / Math.max(12, lines.length + 2)));
      lines.forEach((text, lineIndex) => {
        if (!text.trim()) return;
        page.blocks.push(createTextBlock({
          x: width * .05,
          y: width * .05 + lineIndex * lineHeight,
          width: width * .9,
          height: lineHeight,
          text,
          source: 'ocr-text-fallback',
          confidence: Number(row.confidence) || 0,
          style: { fontSize: lineHeight * .72, lineHeight: 1.08, padding: 0 },
        }));
      });
    }
    documentModel.pages.push(page);
  });
  return normalizeDocumentModel(documentModel);
}
