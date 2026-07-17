export const DOCUMENT_MODEL_VERSION = '4.0.0';
export const FORM_BLOCK_TYPES = Object.freeze(['field', 'checkbox', 'radio', 'signature', 'stamp', 'barcode', 'qr', 'label', 'value']);

let sequence = 0;

export function makeId(prefix = 'node') {
  sequence += 1;
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${sequence}-${random}`;
}

export function cloneValue(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function redactionMetadata(metadata = {}) {
  return {
    redactedAt: metadata?.redactedAt || null,
    redactionMethod: metadata?.redactionMethod || 'burn-in-and-remove-text-layer',
  };
}

export function defaultTextStyle(overrides = {}) {
  return {
    fontFamily: "system-ui, 'Noto Sans Thai', sans-serif",
    fontSize: 16,
    fontWeight: 400,
    fontStyle: 'normal',
    textDecoration: 'none',
    color: '#111827',
    backgroundColor: 'transparent',
    lineHeight: 1.45,
    textAlign: 'left',
    verticalAlign: 'top',
    letterSpacing: 0,
    padding: 4,
    borderColor: 'transparent',
    borderWidth: 0,
    borderStyle: 'solid',
    borderRadius: 0,
    ...overrides,
  };
}

export function createDocument({ name = 'เอกสารใหม่', sourceType = 'unknown', metadata = {}, assets = [], exportSettings = {} } = {}) {
  const sourceFormat = metadata.sourceFormat || sourceType || 'unknown';
  return {
    version: DOCUMENT_MODEL_VERSION,
    id: makeId('document'),
    name,
    sourceType,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {
      fidelityMode: 'editable_reconstruction',
      importedBy: 'RipScan Document Studio',
      sourceFileName: metadata.sourceFileName || name,
      sourceFormat,
      sourceMimeType: metadata.sourceMimeType || '',
      sourcePageSize: metadata.sourcePageSize || {},
      sourceOrientation: metadata.sourceOrientation || 'unknown',
      sourceStructure: metadata.sourceStructure || {},
      importAdapter: metadata.importAdapter || sourceFormat,
      preferredRoundTripFormat: metadata.preferredRoundTripFormat || sourceFormat,
      dualRepresentation: true,
      ...metadata,
    },
    pages: [],
    assets: Array.isArray(assets) ? cloneValue(assets) : [],
    exportSettings: { ...exportSettings },
    reviewIssues: [],
  };
}

export function createPage({
  id = makeId('page'),
  number = 1,
  width = 794,
  height = 1123,
  background = '#ffffff',
  backgroundImage = '',
  name = '',
  blocks = [],
  metadata = {},
  visualReference = null,
  editableLayer = null,
} = {}) {
  const pageWidth = Math.max(1, Number(width) || 794);
  const pageHeight = Math.max(1, Number(height) || 1123);
  const normalizedBlocks = blocks.map(normalizeBlock);
  return {
    id,
    number,
    name: name || `หน้า ${number}`,
    width: pageWidth,
    height: pageHeight,
    background,
    backgroundImage,
    blocks: normalizedBlocks,
    editableLayer: editableLayer ? cloneValue(editableLayer) : { blockIds: normalizedBlocks.map(block => block.id) },
    visualReference: visualReference ? cloneValue(visualReference) : {
      backgroundImage,
      sourcePageSize: { width: pageWidth, height: pageHeight },
      originalLayoutMap: [],
    },
    metadata: { ...metadata },
  };
}

function baseBlock(type, options = {}) {
  return {
    id: options.id || makeId(type),
    type,
    x: Math.max(0, Number(options.x) || 0),
    y: Math.max(0, Number(options.y) || 0),
    width: Math.max(8, Number(options.width) || 160),
    height: Math.max(8, Number(options.height) || 48),
    zIndex: Number.isFinite(Number(options.zIndex)) ? Number(options.zIndex) : 1,
    rotation: Number(options.rotation) || 0,
    locked: Boolean(options.locked),
    hidden: Boolean(options.hidden),
    redacted: Boolean(options.redacted),
    confidence: Number.isFinite(Number(options.confidence)) ? Number(options.confidence) : 1,
    reviewStatus: options.reviewStatus || 'verified',
    source: options.source || 'manual',
    sourceElementType: options.sourceElementType || options.metadata?.sourceElementType || options.source || 'manual',
    sourceElementId: options.sourceElementId || options.metadata?.sourceElementId || '',
    sourceFormat: options.sourceFormat || options.metadata?.sourceFormat || '',
    exportSupport: options.exportSupport || options.metadata?.exportSupport || 'native_or_compatible',
    willRemainEditable: options.willRemainEditable !== false,
    compatibilityNotes: Array.isArray(options.compatibilityNotes) ? [...options.compatibilityNotes] : [],
    metadata: { ...(options.metadata || {}) },
  };
}

export function createTextBlock(options = {}) {
  const redacted = Boolean(options.redacted);
  return {
    ...baseBlock(options.role === 'header' || options.role === 'footer' ? options.role : 'text', options),
    role: options.role || 'paragraph',
    text: redacted ? '' : String(options.text ?? ''),
    spans: redacted ? [] : (Array.isArray(options.spans) ? cloneValue(options.spans) : []),
    style: defaultTextStyle(options.style),
  };
}

export function createImageBlock(options = {}) {
  const redacted = Boolean(options.redacted);
  return {
    ...baseBlock('image', options),
    src: redacted ? '' : String(options.src || ''),
    alt: redacted ? '' : String(options.alt || ''),
    fit: options.fit || 'contain',
    opacity: Number.isFinite(Number(options.opacity)) ? Math.max(0, Math.min(1, Number(options.opacity))) : 1,
    lockAspectRatio: options.lockAspectRatio !== false,
    crop: {
      left: Math.max(0, Number(options.crop?.left) || 0),
      top: Math.max(0, Number(options.crop?.top) || 0),
      right: Math.max(0, Number(options.crop?.right) || 0),
      bottom: Math.max(0, Number(options.crop?.bottom) || 0),
    },
    style: {
      borderColor: '#d1d5db',
      borderWidth: 0,
      borderStyle: 'solid',
      borderRadius: 0,
      backgroundColor: 'transparent',
      ...(options.style || {}),
    },
  };
}

export function createShapeBlock(options = {}) {
  return {
    ...baseBlock(options.shape === 'line' ? 'line' : 'shape', options),
    shape: options.shape || 'rectangle',
    opacity: Number.isFinite(Number(options.opacity)) ? Math.max(0, Math.min(1, Number(options.opacity))) : 1,
    style: {
      fill: 'transparent',
      stroke: '#111827',
      strokeWidth: 1,
      dash: 'solid',
      borderRadius: 0,
      ...(options.style || {}),
    },
  };
}

export function createFieldBlock(options = {}) {
  const type = FORM_BLOCK_TYPES.includes(options.type) ? options.type : 'field';
  const redacted = Boolean(options.redacted);
  return {
    ...baseBlock(type, options),
    label: redacted ? '' : String(options.label || ''),
    value: redacted ? '' : String(options.value || ''),
    fieldType: options.fieldType || (type === 'field' ? 'text' : type),
    checked: Boolean(options.checked),
    choices: redacted ? [] : (Array.isArray(options.choices) ? cloneValue(options.choices) : []),
    validation: redacted ? null : (options.validation ? cloneValue(options.validation) : null),
    src: redacted ? '' : String(options.src || ''),
    alt: redacted ? '' : String(options.alt || ''),
    style: defaultTextStyle(options.style),
  };
}

export function createTableCell({
  id = makeId('cell'), row = 0, column = 0, rowSpan = 1, columnSpan = 1,
  text = '', style = {}, hidden = false, redacted = false, confidence = 1, reviewStatus = 'verified', metadata = {},
} = {}) {
  const isRedacted = Boolean(redacted);
  return {
    id,
    row: Math.max(0, Number(row) || 0),
    column: Math.max(0, Number(column) || 0),
    rowSpan: Math.max(1, Number(rowSpan) || 1),
    columnSpan: Math.max(1, Number(columnSpan) || 1),
    text: isRedacted ? '' : String(text ?? ''),
    hidden: Boolean(hidden),
    redacted: isRedacted,
    confidence: Number.isFinite(Number(confidence)) ? Number(confidence) : 1,
    reviewStatus,
    metadata: isRedacted ? redactionMetadata(metadata) : { ...metadata },
    style: {
      fontFamily: "system-ui, 'Noto Sans Thai', sans-serif",
      fontSize: 14,
      fontWeight: 400,
      color: '#111827',
      backgroundColor: '#ffffff',
      textAlign: 'left',
      verticalAlign: 'middle',
      padding: 6,
      borderTop: '1px solid #64748b',
      borderRight: '1px solid #64748b',
      borderBottom: '1px solid #64748b',
      borderLeft: '1px solid #64748b',
      ...style,
    },
  };
}

export function createTableBlock({
  id,
  rows = 2,
  columns = 2,
  cells = [],
  columnWidths = [],
  rowHeights = [],
  merges = [],
  style = {},
  ...options
} = {}) {
  const block = {
    ...baseBlock('table', { id, ...options }),
    rows: Math.max(1, Number(rows) || 1),
    columns: Math.max(1, Number(columns) || 1),
    cells: cells.map(cell => createTableCell(options.redacted ? { ...cell, redacted: true } : cell)),
    columnWidths: [...columnWidths],
    rowHeights: [...rowHeights],
    merges: cloneValue(merges || []),
    style: {
      borderCollapse: 'collapse',
      tableLayout: 'fixed',
      backgroundColor: '#ffffff',
      ...(style || {}),
    },
  };
  normalizeTable(block);
  return block;
}

export function normalizeTable(table) {
  table.rows = Math.max(1, Number(table.rows) || 1);
  table.columns = Math.max(1, Number(table.columns) || 1);
  table.cells = Array.isArray(table.cells) ? table.cells.map(createTableCell) : [];
  const occupied = new Map();
  for (const cell of table.cells) {
    if (cell.row >= table.rows || cell.column >= table.columns) continue;
    for (let rowOffset = 0; rowOffset < cell.rowSpan; rowOffset += 1) {
      for (let columnOffset = 0; columnOffset < cell.columnSpan; columnOffset += 1) {
        occupied.set(`${cell.row + rowOffset}:${cell.column + columnOffset}`, cell.id);
      }
    }
  }
  for (let row = 0; row < table.rows; row += 1) {
    for (let column = 0; column < table.columns; column += 1) {
      if (!occupied.has(`${row}:${column}`)) table.cells.push(createTableCell({ row, column }));
    }
  }
  table.cells.sort((a, b) => a.row - b.row || a.column - b.column);
  while (table.columnWidths.length < table.columns) table.columnWidths.push(Math.max(72, table.width / table.columns));
  table.columnWidths = table.columnWidths.slice(0, table.columns).map(value => Math.max(24, Number(value) || 72));
  while (table.rowHeights.length < table.rows) table.rowHeights.push(38);
  table.rowHeights = table.rowHeights.slice(0, table.rows).map(value => Math.max(22, Number(value) || 38));
  return table;
}

export function normalizeBlock(block = {}) {
  if (block.type === 'table') return createTableBlock(block);
  if (block.type === 'image') return createImageBlock(block);
  if (block.type === 'shape' || block.type === 'line') return createShapeBlock(block);
  if (FORM_BLOCK_TYPES.includes(block.type)) return createFieldBlock(block);
  return createTextBlock(block);
}

export function migrateDocumentModel(documentModel) {
  const source = cloneValue(documentModel || {});
  const fromVersion = String(source.version || '1.0.0');
  source.pages = Array.isArray(source.pages) ? source.pages : [];
  for (const page of source.pages) {
    page.blocks = Array.isArray(page.blocks) ? page.blocks : [];
    for (const block of page.blocks) {
      if (block.type === 'field' && block.fieldType === 'checkbox') block.type = 'checkbox';
      if (block.type === 'field' && block.fieldType === 'radio') block.type = 'radio';
      if (block.redacted) {
        block.text = '';
        block.value = '';
        block.label = '';
        block.alt = '';
        block.src = '';
        block.spans = [];
        block.choices = [];
        block.validation = null;
        if (Array.isArray(block.cells)) block.cells.forEach(cell => { cell.text = ''; cell.redacted = true; });
        block.metadata = redactionMetadata(block.metadata);
      }
      if (Array.isArray(block.cells)) block.cells.forEach(cell => {
        if (!cell.redacted) return;
        cell.text = '';
        cell.metadata = redactionMetadata(cell.metadata);
      });
      if (!block.redacted) block.metadata = { ...(block.metadata || {}), migratedFrom: block.metadata?.migratedFrom || fromVersion };
    }
  }
  source.metadata = { ...(source.metadata || {}), modelMigratedFrom: source.metadata?.modelMigratedFrom || fromVersion };
  source.version = DOCUMENT_MODEL_VERSION;
  return source;
}

export function normalizeDocumentModel(documentModel) {
  const migrated = migrateDocumentModel(documentModel);
  const document = {
    ...createDocument(),
    ...migrated,
  };
  document.version = DOCUMENT_MODEL_VERSION;
  document.metadata = { ...createDocument({ name: document.name, sourceType: document.sourceType, metadata: document.metadata }).metadata, ...(document.metadata || {}) };
  document.pages = Array.isArray(document.pages)
    ? document.pages.map((page, index) => createPage({ ...page, number: page.number || index + 1 }))
    : [];
  document.updatedAt = new Date().toISOString();
  document.reviewIssues = Array.isArray(document.reviewIssues) ? document.reviewIssues : [];
  document.assets = Array.isArray(document.assets) ? document.assets : [];
  document.exportSettings = document.exportSettings && typeof document.exportSettings === 'object' ? document.exportSettings : {};
  return document;
}

export function validateDocumentModel(documentModel) {
  const errors = [];
  if (!documentModel || typeof documentModel !== 'object') return { valid: false, errors: ['document_missing'] };
  if (!Array.isArray(documentModel.pages)) errors.push('pages_missing');
  for (const [pageIndex, page] of (documentModel.pages || []).entries()) {
    if (!(page.width > 0 && page.height > 0)) errors.push(`page_${pageIndex}_size_invalid`);
    if (!Array.isArray(page.blocks)) errors.push(`page_${pageIndex}_blocks_missing`);
    for (const block of page.blocks || []) {
      if (!block.id) errors.push(`page_${pageIndex}_block_id_missing`);
      if (!['text', 'header', 'footer', 'table', 'image', 'shape', 'line', ...FORM_BLOCK_TYPES].includes(block.type)) errors.push(`block_${block.id}_type_invalid`);
      if (!(block.width > 0 && block.height > 0)) errors.push(`block_${block.id}_size_invalid`);
      if (block.type === 'table') {
        if (!(block.rows > 0 && block.columns > 0)) errors.push(`table_${block.id}_dimensions_invalid`);
        const visible = (block.cells || []).filter(cell => !cell.hidden);
        if (!visible.length) errors.push(`table_${block.id}_cells_missing`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function findBlock(documentModel, blockId) {
  for (const page of documentModel.pages || []) {
    const block = page.blocks?.find(item => item.id === blockId);
    if (block) return { page, block };
  }
  return null;
}

export function getTableCell(table, row, column) {
  return table.cells.find(cell => !cell.hidden
    && row >= cell.row && row < cell.row + cell.rowSpan
    && column >= cell.column && column < cell.column + cell.columnSpan) || null;
}

export function addTableRow(table, at = table.rows) {
  const index = Math.max(0, Math.min(table.rows, Number(at) || 0));
  for (const cell of table.cells) {
    if (cell.row >= index) cell.row += 1;
    else if (cell.row + cell.rowSpan > index) cell.rowSpan += 1;
  }
  table.rows += 1;
  table.rowHeights.splice(index, 0, 38);
  normalizeTable(table);
  return table;
}

export function deleteTableRow(table, at = table.rows - 1) {
  if (table.rows <= 1) return table;
  const index = Math.max(0, Math.min(table.rows - 1, Number(at) || 0));
  table.cells = table.cells.filter(cell => {
    if (cell.row > index) { cell.row -= 1; return true; }
    if (cell.row === index && cell.rowSpan === 1) return false;
    if (cell.row <= index && cell.row + cell.rowSpan > index) { cell.rowSpan = Math.max(1, cell.rowSpan - 1); return true; }
    return true;
  });
  table.rows -= 1;
  table.rowHeights.splice(index, 1);
  normalizeTable(table);
  return table;
}

export function addTableColumn(table, at = table.columns) {
  const index = Math.max(0, Math.min(table.columns, Number(at) || 0));
  for (const cell of table.cells) {
    if (cell.column >= index) cell.column += 1;
    else if (cell.column + cell.columnSpan > index) cell.columnSpan += 1;
  }
  table.columns += 1;
  table.columnWidths.splice(index, 0, Math.max(72, table.width / table.columns));
  normalizeTable(table);
  return table;
}

export function deleteTableColumn(table, at = table.columns - 1) {
  if (table.columns <= 1) return table;
  const index = Math.max(0, Math.min(table.columns - 1, Number(at) || 0));
  table.cells = table.cells.filter(cell => {
    if (cell.column > index) { cell.column -= 1; return true; }
    if (cell.column === index && cell.columnSpan === 1) return false;
    if (cell.column <= index && cell.column + cell.columnSpan > index) { cell.columnSpan = Math.max(1, cell.columnSpan - 1); return true; }
    return true;
  });
  table.columns -= 1;
  table.columnWidths.splice(index, 1);
  normalizeTable(table);
  return table;
}

export function mergeTableCells(table, coordinates = []) {
  const unique = [...new Map(coordinates.map(item => [`${item.row}:${item.column}`, item])).values()];
  if (unique.length < 2) return { merged: false, reason: 'select_at_least_two_cells' };
  const rows = unique.map(item => item.row);
  const columns = unique.map(item => item.column);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minColumn = Math.min(...columns);
  const maxColumn = Math.max(...columns);
  const expected = (maxRow - minRow + 1) * (maxColumn - minColumn + 1);
  if (unique.length !== expected) return { merged: false, reason: 'selection_must_be_rectangle' };
  const selected = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const cell = getTableCell(table, row, column);
      if (!cell || !selected.includes(cell)) selected.push(cell);
    }
  }
  const anchor = selected.sort((a, b) => a.row - b.row || a.column - b.column)[0];
  anchor.row = minRow;
  anchor.column = minColumn;
  anchor.rowSpan = maxRow - minRow + 1;
  anchor.columnSpan = maxColumn - minColumn + 1;
  anchor.text = selected.map(cell => cell.text).filter(Boolean).join('\n');
  for (const cell of selected) {
    if (cell === anchor) continue;
    cell.hidden = true;
    cell.text = '';
  }
  table.merges ||= [];
  table.merges.push({ row: minRow, column: minColumn, rowSpan: anchor.rowSpan, columnSpan: anchor.columnSpan });
  normalizeTable(table);
  return { merged: true, anchor };
}

export function splitTableCell(table, cellId) {
  const cell = table.cells.find(item => item.id === cellId && !item.hidden);
  if (!cell || (cell.rowSpan === 1 && cell.columnSpan === 1)) return { split: false, reason: 'cell_not_merged' };
  const { row, column, rowSpan, columnSpan } = cell;
  cell.rowSpan = 1;
  cell.columnSpan = 1;
  for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
      if (rowOffset === 0 && columnOffset === 0) continue;
      const targetRow = row + rowOffset;
      const targetColumn = column + columnOffset;
      const hidden = table.cells.find(item => item.row === targetRow && item.column === targetColumn && item.hidden);
      if (hidden) hidden.hidden = false;
      else table.cells.push(createTableCell({ row: targetRow, column: targetColumn }));
    }
  }
  table.merges = (table.merges || []).filter(merge => !(merge.row === row && merge.column === column));
  normalizeTable(table);
  return { split: true, cell };
}

export function documentToPlainText(documentModel) {
  return (documentModel.pages || []).map(page => (page.blocks || [])
    .filter(block => !block.redacted && !block.hidden)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(block => {
      if (block.type === 'table') {
        return Array.from({ length: block.rows }, (_, row) => Array.from({ length: block.columns }, (_, column) => {
          const cell = getTableCell(block, row, column);
          return cell && !cell.redacted ? cell.text || '' : '';
        }).join('\t')).join('\n');
      }
      if (block.type === 'field') return `${block.label}${block.label ? ': ' : ''}${block.value}`;
      return block.text || '';
    }).filter(Boolean).join('\n\n')).join('\n\n---\n\n');
}
