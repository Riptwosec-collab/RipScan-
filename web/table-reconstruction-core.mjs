export const TABLE_RECONSTRUCTION_VERSION = '3.1.0';

export const CELL_STATUSES = Object.freeze([
  'verified',
  'review_required',
  'possible_text',
  'contaminated',
  'structure_conflict',
  'empty',
  'possibly_empty',
]);

export const CELL_OCR_VARIANTS = Object.freeze([
  'original',
  'upscale3',
  'line_soft',
  'contrast_soft',
]);

const THAI_RE = /[\u0E00-\u0E7F]/u;
const LATIN_RE = /[A-Za-z]/u;
const DIGIT_RE = /[0-9๐-๙]/u;
const PUNCT_RE = /[^\p{L}\p{N}\s@._\-–—/():,]/gu;
const PIPE_RUN_RE = /(?:\|\s*){2,}/u;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function normalizeCellText(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export function clusterLinePositions(values = [], tolerance = 3) {
  const sorted = [...values]
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return [];
  const groups = [[sorted[0]]];
  for (const value of sorted.slice(1)) {
    const group = groups[groups.length - 1];
    const center = group.reduce((sum, item) => sum + item, 0) / group.length;
    if (Math.abs(value - center) <= tolerance) group.push(value);
    else groups.push([value]);
  }
  return groups.map(group => Math.round(group.reduce((sum, item) => sum + item, 0) / group.length));
}

export function normalizeGridLines({ width = 1, height = 1, horizontalLines = [], verticalLines = [], tolerance = 3 } = {}) {
  const x = clusterLinePositions(verticalLines, tolerance).filter(value => value >= 0 && value <= width);
  const y = clusterLinePositions(horizontalLines, tolerance).filter(value => value >= 0 && value <= height);
  return {
    verticalLines: x,
    horizontalLines: y,
    columns: Math.max(0, x.length - 1),
    rows: Math.max(0, y.length - 1),
    bounds: x.length >= 2 && y.length >= 2
      ? { left: x[0], top: y[0], right: x[x.length - 1], bottom: y[y.length - 1], width: x[x.length - 1] - x[0], height: y[y.length - 1] - y[0] }
      : null,
  };
}

function intervalCoverage(segments = [], position, start, end, tolerance = 4) {
  const width = Math.max(1, end - start);
  const overlapping = segments.filter(segment => Math.abs(Number(segment.position) - position) <= tolerance)
    .map(segment => [Math.max(start, Number(segment.start) || 0), Math.min(end, Number(segment.end) || 0)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  if (!overlapping.length) return 0;
  let covered = 0;
  let [cursorStart, cursorEnd] = overlapping[0];
  for (const [a, b] of overlapping.slice(1)) {
    if (a <= cursorEnd) cursorEnd = Math.max(cursorEnd, b);
    else { covered += cursorEnd - cursorStart; cursorStart = a; cursorEnd = b; }
  }
  covered += cursorEnd - cursorStart;
  return clamp(covered / width, 0, 1);
}

class DisjointSet {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array(size).fill(0);
  }
  find(value) {
    let current = value;
    while (this.parent[current] !== current) {
      this.parent[current] = this.parent[this.parent[current]];
      current = this.parent[current];
    }
    return current;
  }
  union(a, b) {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) return;
    if (this.rank[rootA] < this.rank[rootB]) [rootA, rootB] = [rootB, rootA];
    this.parent[rootB] = rootA;
    if (this.rank[rootA] === this.rank[rootB]) this.rank[rootA] += 1;
  }
}

function slotIndex(row, column, columns) {
  return row * columns + column;
}

function groupToCell(group, grid, pageNumber, conflict = false) {
  const rows = group.map(item => item.row);
  const columns = group.map(item => item.column);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minColumn = Math.min(...columns);
  const maxColumn = Math.max(...columns);
  const expected = (maxRow - minRow + 1) * (maxColumn - minColumn + 1);
  const left = grid.verticalLines[minColumn];
  const right = grid.verticalLines[maxColumn + 1];
  const top = grid.horizontalLines[minRow];
  const bottom = grid.horizontalLines[maxRow + 1];
  const status = conflict || group.length !== expected ? 'structure_conflict' : 'possibly_empty';
  return {
    cellId: `p${pageNumber}-r${minRow}-c${minColumn}`,
    rowIndex: minRow,
    columnIndex: minColumn,
    rowSpan: maxRow - minRow + 1,
    columnSpan: maxColumn - minColumn + 1,
    boundingBox: { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top },
    width: right - left,
    height: bottom - top,
    text: '',
    textWithLineBreaks: '',
    plainText: '',
    lines: [],
    border: { top: true, right: true, bottom: true, left: true },
    fillColor: '#ffffff',
    alignment: 'left',
    verticalAlignment: 'middle',
    fontSize: 14,
    fontWeight: 400,
    confidence: 0,
    status,
    reviewStatus: status,
    candidates: [],
    columnType: 'mixed_text',
    metadata: { source: 'table-grid', slotCount: group.length },
  };
}

export function buildTableStructure({
  pageNumber = 1,
  width = 1,
  height = 1,
  horizontalLines = [],
  verticalLines = [],
  horizontalSegments = [],
  verticalSegments = [],
  lineTolerance = 4,
  borderCoverageThreshold = 0.48,
} = {}) {
  const grid = normalizeGridLines({ width, height, horizontalLines, verticalLines, tolerance: lineTolerance });
  const { rows, columns } = grid;
  if (rows < 1 || columns < 1) return { ...grid, pageNumber, cells: [], structureStatus: 'not_a_table', conflicts: ['grid_too_small'] };

  const dsu = new DisjointSet(rows * columns);
  const conflicts = [];

  for (let boundary = 1; boundary < rows; boundary += 1) {
    const y = grid.horizontalLines[boundary];
    for (let column = 0; column < columns; column += 1) {
      const start = grid.verticalLines[column];
      const end = grid.verticalLines[column + 1];
      const coverage = intervalCoverage(horizontalSegments, y, start, end, lineTolerance);
      if (coverage < borderCoverageThreshold) dsu.union(slotIndex(boundary - 1, column, columns), slotIndex(boundary, column, columns));
    }
  }

  for (let boundary = 1; boundary < columns; boundary += 1) {
    const x = grid.verticalLines[boundary];
    for (let row = 0; row < rows; row += 1) {
      const start = grid.horizontalLines[row];
      const end = grid.horizontalLines[row + 1];
      const coverage = intervalCoverage(verticalSegments, x, start, end, lineTolerance);
      if (coverage < borderCoverageThreshold) dsu.union(slotIndex(row, boundary - 1, columns), slotIndex(row, boundary, columns));
    }
  }

  const groups = new Map();
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const root = dsu.find(slotIndex(row, column, columns));
      const group = groups.get(root) || [];
      group.push({ row, column });
      groups.set(root, group);
    }
  }

  const cells = [...groups.values()].map(group => {
    const rowValues = group.map(item => item.row);
    const columnValues = group.map(item => item.column);
    const expected = (Math.max(...rowValues) - Math.min(...rowValues) + 1) * (Math.max(...columnValues) - Math.min(...columnValues) + 1);
    if (group.length !== expected) conflicts.push(`non_rectangular_${group[0].row}_${group[0].column}`);
    return groupToCell(group, grid, pageNumber, group.length !== expected);
  }).sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex);

  const columnWidths = Array.from({ length: columns }, (_, index) => grid.verticalLines[index + 1] - grid.verticalLines[index]);
  const rowHeights = Array.from({ length: rows }, (_, index) => grid.horizontalLines[index + 1] - grid.horizontalLines[index]);
  return {
    tableId: `table-p${pageNumber}-${Math.round(grid.bounds?.left || 0)}-${Math.round(grid.bounds?.top || 0)}`,
    page: pageNumber,
    pageWidth: width,
    pageHeight: height,
    rowCount: rows,
    columnCount: columns,
    rows,
    columns,
    columnWidths,
    rowHeights,
    cells,
    verticalLines: grid.verticalLines,
    horizontalLines: grid.horizontalLines,
    bounds: grid.bounds,
    structureStatus: conflicts.length ? 'structure_conflict' : 'verified',
    conflicts,
    metadata: { tableFirst: true, gridLocked: false, version: TABLE_RECONSTRUCTION_VERSION },
  };
}

export function classifyColumnType(header = '') {
  const value = normalizeCellText(header).toLowerCase();
  if (/หน่วยรับตรวจ|หน่วยงาน|ส่วนงาน|องค์กร/u.test(value)) return 'organization';
  if (/จัดเตรียม|เอกสารและข้อมูล|รายละเอียด|ข้อมูลประกอบ/u.test(value)) return 'description';
  if (/เอกสารแนบ|แบบ\s*\d+|attachment/u.test(value)) return 'attachment_code';
  if (/ดำเนินการ|process|สถานะ/u.test(value)) return 'process';
  if (/ติดต่อ|โทร|อีเมล|email|phone/u.test(value)) return 'contact';
  if (/เลขที่|เลขเอกสาร|document/u.test(value)) return 'document_number';
  if (/วันที่|date/u.test(value)) return 'date';
  return 'mixed_text';
}

function scriptKind(character) {
  if (/[\u0E00-\u0E7F]/u.test(character)) return 'thai';
  if (/[A-Za-z]/u.test(character)) return 'latin';
  if (/[0-9๐-๙]/u.test(character)) return 'digit';
  return 'other';
}

function scriptSwitches(text) {
  const kinds = [...text].map(scriptKind).filter(kind => kind !== 'other');
  let switches = 0;
  for (let index = 1; index < kinds.length; index += 1) if (kinds[index] !== kinds[index - 1]) switches += 1;
  return switches;
}

export function gibberishAssessment(text, { confidence = 1, columnType = 'mixed_text', providerAgreement = 1 } = {}) {
  const value = normalizeCellText(text);
  if (!value) return { gibberish: false, score: 0, reasons: ['empty'] };
  const length = Math.max(1, [...value].length);
  const pipes = (value.match(/\|/gu) || []).length;
  const symbols = (value.match(PUNCT_RE) || []).length;
  const switches = scriptSwitches(value);
  const hasThai = THAI_RE.test(value);
  const hasLatin = LATIN_RE.test(value);
  const hasDigits = DIGIT_RE.test(value);
  let score = 0;
  const reasons = [];
  if (PIPE_RUN_RE.test(value) || pipes >= 3) { score += .42; reasons.push('table_line_tokens'); }
  if (symbols / length > .22) { score += .20; reasons.push('symbol_ratio'); }
  if (switches >= Math.max(4, length * .22)) { score += .18; reasons.push('script_switches'); }
  if (hasThai && hasLatin && hasDigits && length < 40) { score += .10; reasons.push('mixed_scripts_short_cell'); }
  if (confidence < .42) { score += .18; reasons.push('low_confidence'); }
  if (providerAgreement < .45) { score += .16; reasons.push('provider_disagreement'); }
  if (columnType === 'attachment_code' && value.length > 30) { score += .18; reasons.push('column_type_mismatch'); }
  if (columnType === 'contact' && !/@|\d{2,}/u.test(value)) { score += .08; reasons.push('contact_pattern_missing'); }
  return { gibberish: score >= .52, score: clamp(score, 0, 1), reasons };
}

export function strictFieldAssessment(value, columnType = 'mixed_text') {
  const text = normalizeCellText(value);
  if (!text) return { valid: false, type: columnType, reason: 'empty' };
  const phone = /^(?:\+?66[- ]?|0)\d{1,2}(?:[- ]?\d{3,4}){2}$/u;
  const email = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/iu;
  const attachment = /^แบบ\s*\d{1,3}$/u;
  const page = /^\d{1,4}\s*\/\s*\d{1,4}$/u;
  const date = /^(?:\d{1,2}[\/.-]){2}\d{2,4}$/u;
  if (columnType === 'contact') {
    if (email.test(text)) return { valid: true, type: 'email', normalized: text };
    if (phone.test(text)) return { valid: true, type: 'phone', normalized: text };
    return { valid: false, type: 'contact', reason: 'contact_format' };
  }
  if (columnType === 'attachment_code') return attachment.test(text)
    ? { valid: true, type: 'attachment_code', normalized: text }
    : { valid: false, type: 'attachment_code', reason: 'attachment_format' };
  if (columnType === 'date') return date.test(text)
    ? { valid: true, type: 'date', normalized: text }
    : { valid: false, type: 'date', reason: 'date_format' };
  if (page.test(text)) return { valid: true, type: 'page_number', normalized: text.replace(/\s+/gu, '') };
  if (email.test(text)) return { valid: true, type: 'email', normalized: text };
  if (phone.test(text)) return { valid: true, type: 'phone', normalized: text };
  if (attachment.test(text)) return { valid: true, type: 'attachment_code', normalized: text };
  return { valid: true, type: columnType, normalized: text };
}

export function emptyCellAssessment({ pixelDensity = 0, connectedComponents = 0, wordCount = 0, neighborLeak = 0, lineDensity = 0 } = {}) {
  const contentScore = clamp(pixelDensity * 2.2 + Math.min(1, connectedComponents / 4) * .35 + Math.min(1, wordCount / 2) * .35 - lineDensity * .55 - neighborLeak * .45, 0, 1);
  if (contentScore <= .12) return { status: 'empty', confidence: 1 - contentScore };
  if (contentScore <= .28) return { status: 'possibly_empty', confidence: 1 - contentScore };
  return { status: 'possible_text', confidence: contentScore };
}

export function crossCellContamination({
  text = '',
  wordBoxes = [],
  cellBox,
  neighborTexts = [],
  columnType = 'mixed_text',
  confidence = 1,
} = {}) {
  const reasons = [];
  if (!cellBox) return { contaminated: false, score: 0, reasons };
  const outside = wordBoxes.filter(box => {
    const centerX = Number(box.x ?? box.left ?? 0) + Number(box.width || 0) / 2;
    const centerY = Number(box.y ?? box.top ?? 0) + Number(box.height || 0) / 2;
    return centerX < cellBox.left || centerX > cellBox.right || centerY < cellBox.top || centerY > cellBox.bottom;
  }).length;
  let score = wordBoxes.length ? outside / wordBoxes.length : 0;
  if (outside) reasons.push('word_center_outside_cell');
  if ((String(text).match(/\|/gu) || []).length >= 2) { score += .45; reasons.push('table_lines_in_text'); }
  const normalized = normalizeCellText(text).toLowerCase();
  if (neighborTexts.some(item => normalizeCellText(item).length > 4 && normalized.includes(normalizeCellText(item).toLowerCase()))) { score += .25; reasons.push('neighbor_duplicate'); }
  if (columnType === 'attachment_code' && normalized.length > 30) { score += .25; reasons.push('column_width_mismatch'); }
  if (confidence < .35) score += .12;
  return { contaminated: score >= .45, score: clamp(score, 0, 1), reasons };
}

function candidateScore(candidate, context = {}) {
  const text = normalizeCellText(candidate.text);
  const confidence = clamp(candidate.confidence, 0, 1);
  const agreement = clamp(candidate.providerAgreement ?? context.providerAgreement ?? .5, 0, 1);
  const gibberish = gibberishAssessment(text, { confidence, columnType: context.columnType, providerAgreement: agreement });
  const strict = strictFieldAssessment(text, context.columnType);
  let score = confidence * .52 + agreement * .22 + (strict.valid ? .14 : 0) + (text ? .08 : 0) - gibberish.score * .65;
  if (candidate.variant === 'original') score += .02;
  if (candidate.preservedThaiMarks) score += .06;
  return { ...candidate, text, score, gibberish, strict };
}

export function selectCellCandidate(candidates = [], context = {}) {
  const ranked = candidates.map(candidate => candidateScore(candidate, context)).sort((a, b) => b.score - a.score);
  const winner = ranked[0] || null;
  if (!winner) return { text: '', confidence: 0, status: 'possibly_empty', candidates: [] };
  const next = ranked[1];
  const close = next && Math.abs(winner.score - next.score) < .08 && winner.text !== next.text;
  let status = 'verified';
  if (winner.gibberish.gibberish) status = 'contaminated';
  else if (close || winner.confidence < .72 || !winner.strict.valid) status = 'review_required';
  else if (winner.confidence < .88) status = 'possible_text';
  return { text: winner.text, confidence: winner.confidence, status, candidates: ranked, selectedVariant: winner.variant, closeCandidates: Boolean(close) };
}

export function applyHeaderColumnTypes(table) {
  if (!table?.cells?.length) return table;
  for (let column = 0; column < table.columnCount; column += 1) {
    const header = table.cells.find(cell => cell.rowIndex === 0 && column >= cell.columnIndex && column < cell.columnIndex + cell.columnSpan);
    const type = classifyColumnType(header?.text || '');
    for (const cell of table.cells) {
      if (column >= cell.columnIndex && column < cell.columnIndex + cell.columnSpan) cell.columnType = type;
    }
  }
  return table;
}

export function updateCellText(cell, selected) {
  const text = normalizeCellText(selected?.text ?? cell.text);
  cell.text = text;
  cell.textWithLineBreaks = text;
  cell.plainText = text.replace(/\s*\n\s*/gu, ' ').trim();
  cell.lines = text ? text.split('\n') : [];
  cell.confidence = clamp(selected?.confidence ?? cell.confidence, 0, 1);
  cell.status = selected?.status || cell.status || 'review_required';
  cell.reviewStatus = cell.status;
  cell.candidates = selected?.candidates || cell.candidates || [];
  return cell;
}

export function tableToDocumentBlockSpec(table, { pageScale = 1, x = table.bounds?.left || 0, y = table.bounds?.top || 0 } = {}) {
  const evidenceByCell = {};
  const cells = table.cells.map(cell => {
    const id = cell.cellId;
    evidenceByCell[id] = {
      boundingBox: cell.boundingBox,
      textWithLineBreaks: cell.textWithLineBreaks,
      plainText: cell.plainText,
      lines: cell.lines,
      border: cell.border,
      confidence: cell.confidence,
      status: cell.status,
      candidates: cell.candidates,
      columnType: cell.columnType,
    };
    return {
      id,
      row: cell.rowIndex,
      column: cell.columnIndex,
      rowSpan: cell.rowSpan,
      columnSpan: cell.columnSpan,
      text: cell.textWithLineBreaks || cell.text || '',
      confidence: cell.confidence,
      reviewStatus: cell.status,
      style: {
        fontFamily: "'Noto Sans Thai', system-ui, sans-serif",
        fontSize: cell.fontSize || 14,
        fontWeight: cell.fontWeight || 400,
        color: '#111827',
        backgroundColor: cell.fillColor || '#ffffff',
        textAlign: cell.alignment || 'left',
        verticalAlign: cell.verticalAlignment || 'middle',
        padding: 5,
        borderTop: cell.border?.top === false ? '0' : '1px solid #475569',
        borderRight: cell.border?.right === false ? '0' : '1px solid #475569',
        borderBottom: cell.border?.bottom === false ? '0' : '1px solid #475569',
        borderLeft: cell.border?.left === false ? '0' : '1px solid #475569',
        whiteSpace: 'pre-wrap',
      },
    };
  });
  return {
    rows: table.rowCount,
    columns: table.columnCount,
    x: x * pageScale,
    y: y * pageScale,
    width: (table.bounds?.width || table.columnWidths.reduce((sum, value) => sum + value, 0)) * pageScale,
    height: (table.bounds?.height || table.rowHeights.reduce((sum, value) => sum + value, 0)) * pageScale,
    columnWidths: table.columnWidths.map(value => value * pageScale),
    rowHeights: table.rowHeights.map(value => value * pageScale),
    cells,
    source: 'table-first-v31',
    reviewStatus: table.cells.some(cell => !['verified', 'empty'].includes(cell.status)) ? 'review_required' : 'verified',
    metadata: {
      tableFirst: true,
      tableId: table.tableId,
      page: table.page,
      version: TABLE_RECONSTRUCTION_VERSION,
      structureStatus: table.structureStatus,
      gridLocked: Boolean(table.metadata?.gridLocked),
      cellEvidence: evidenceByCell,
    },
  };
}

export function tableProgress(table) {
  const statuses = Object.fromEntries(CELL_STATUSES.map(status => [status, 0]));
  for (const cell of table?.cells || []) statuses[cell.status] = (statuses[cell.status] || 0) + 1;
  const completed = (statuses.verified || 0) + (statuses.empty || 0);
  return {
    tables: table ? 1 : 0,
    columns: table?.columnCount || 0,
    rows: table?.rowCount || 0,
    cells: table?.cells?.length || 0,
    completed,
    review: Math.max(0, (table?.cells?.length || 0) - completed),
    statuses,
  };
}

export function workerConcurrency({ mobile = false, hardwareConcurrency = 4 } = {}) {
  return mobile || Number(hardwareConcurrency) <= 4 ? 1 : 2;
}
