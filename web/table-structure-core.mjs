export const TABLE_STRUCTURE_VERSION = '2.3.0';

export const VISIBLE_PAGE_ACTIONS = new Set([
  'copy-page',
  'download-page',
]);

export const BACKGROUND_PAGE_ACTIONS = new Set([
  'download-image',
  'rerun',
  'rotate',
  'crop',
  'analyze',
  'mixed',
  'cover-review',
]);

export function normalizeCellText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildCellMatrix(cells = []) {
  const normalized = cells.map(cell => ({
    rowIndex: Math.max(0, Number(cell.rowIndex || 0)),
    columnIndex: Math.max(0, Number(cell.columnIndex || 0)),
    rowSpan: Math.max(1, Number(cell.rowSpan || 1)),
    columnSpan: Math.max(1, Number(cell.columnSpan || 1)),
    text: normalizeCellText(cell.text),
  }));

  const rows = normalized.reduce((max, cell) => Math.max(max, cell.rowIndex + cell.rowSpan), 0);
  const columns = normalized.reduce((max, cell) => Math.max(max, cell.columnIndex + cell.columnSpan), 0);
  const matrix = Array.from({ length: rows }, () => Array.from({ length: columns }, () => ''));
  const spans = [];

  for (const cell of normalized) {
    if (!matrix[cell.rowIndex]) continue;
    matrix[cell.rowIndex][cell.columnIndex] = cell.text;
    if (cell.rowSpan > 1 || cell.columnSpan > 1) {
      spans.push({
        rowIndex: cell.rowIndex,
        columnIndex: cell.columnIndex,
        rowSpan: cell.rowSpan,
        columnSpan: cell.columnSpan,
      });
    }
  }

  return { rows, columns, matrix, spans };
}

function markdownCell(value) {
  return normalizeCellText(value)
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>');
}

export function matrixToMarkdown(matrix = [], options = {}) {
  const rows = matrix.map(row => [...row]);
  const columns = Math.max(0, ...rows.map(row => row.length));
  if (!rows.length || !columns) return '';
  const normalizedRows = rows.map(row => Array.from({ length: columns }, (_, index) => markdownCell(row[index] || '')));
  const headerIndex = Math.max(0, Math.min(normalizedRows.length - 1, Number(options.headerRowIndex || 0)));
  const output = [];
  normalizedRows.forEach((row, index) => {
    output.push(`| ${row.join(' | ')} |`);
    if (index === headerIndex) output.push(`| ${Array.from({ length: columns }, () => '---').join(' | ')} |`);
  });
  return output.join('\n');
}

export function matrixToTsv(matrix = []) {
  return matrix
    .map(row => row.map(value => normalizeCellText(value).replace(/\n/g, ' ')).join('\t'))
    .join('\n');
}

export function tableEvidence({ horizontalLines = [], verticalLines = [], width = 1, height = 1 } = {}) {
  const horizontal = [...horizontalLines].filter(value => Number.isFinite(value));
  const vertical = [...verticalLines].filter(value => Number.isFinite(value));
  const horizontalSpread = horizontal.length > 1 ? (Math.max(...horizontal) - Math.min(...horizontal)) / Math.max(1, height) : 0;
  const verticalSpread = vertical.length > 1 ? (Math.max(...vertical) - Math.min(...vertical)) / Math.max(1, width) : 0;
  const score = Math.min(1,
    Math.min(1, horizontal.length / 5) * 0.42
    + Math.min(1, vertical.length / 4) * 0.38
    + Math.min(1, horizontalSpread) * 0.10
    + Math.min(1, verticalSpread) * 0.10,
  );
  return {
    score,
    horizontalCount: horizontal.length,
    verticalCount: vertical.length,
    likelyTable: horizontal.length >= 3 && vertical.length >= 3 && score >= 0.58,
  };
}

export function pageActionPolicy(action) {
  if (VISIBLE_PAGE_ACTIONS.has(action)) return 'visible';
  if (BACKGROUND_PAGE_ACTIONS.has(action)) return 'background';
  return 'unchanged';
}
