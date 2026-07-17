import {
  buildCellMatrix,
  pageActionPolicy,
} from './table-structure-core.mjs';

const TABLE_AUTO_VERSION = '3.1.2';
const results = document.querySelector('#results');
const structuredTables = new WeakSet();
let scanScheduled = false;

const TECHNICAL_LABELS = new Set([
  'รูปภาพ',
  'OCR ใหม่',
  'หมุนหน้า',
  'ครอป',
  'ตาราง/ฟอร์ม',
  'ตรวจไทย–อังกฤษ',
  'ตรวจข้อความจากหน้าปก',
  'ปิดเครื่องมือตรวจหน้าปก',
]);

function actionName(button) {
  if (button.dataset.action) return button.dataset.action;
  if (button.dataset.managedPageAction) return button.dataset.managedPageAction;
  if (button.dataset.advancedPageAction) return button.dataset.advancedPageAction;
  if (button.dataset.verifiedPage) return button.dataset.verifiedPage;
  if (button.classList.contains('cover-review-toggle')) return 'cover-review';
  return '';
}

function simplifyPageActions(pageCard) {
  const actions = pageCard.querySelector('.page-actions');
  if (!actions || actions.dataset.compactActions === 'true') return;
  for (const button of [...actions.querySelectorAll('button')]) {
    const action = actionName(button);
    const label = button.textContent.trim();
    const policy = pageActionPolicy(action);
    if (action === 'analyze' || button.dataset.advancedPageAction === 'analyze') {
      button.hidden = true;
      button.dataset.automaticOnly = 'true';
      continue;
    }
    if (policy === 'background' || TECHNICAL_LABELS.has(label)) button.remove();
  }
  actions.dataset.compactActions = 'true';
  pageCard.dataset.backgroundOcrTools = 'worker-table-detection,auto-retry,auto-language,auto-cover-filter';
}

function recordsFromHtmlTable(table) {
  const occupancy = [];
  const records = [];
  [...table.rows].forEach((row, rowIndex) => {
    occupancy[rowIndex] ||= [];
    let columnIndex = 0;
    [...row.cells].forEach(cell => {
      while (occupancy[rowIndex][columnIndex]) columnIndex += 1;
      const rowSpan = Math.max(1, Number(cell.rowSpan || 1));
      const columnSpan = Math.max(1, Number(cell.colSpan || 1));
      const text = cell.querySelector('span')?.textContent ?? cell.textContent ?? '';
      records.push({ rowIndex, columnIndex, rowSpan, columnSpan, text });
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        occupancy[rowIndex + rowOffset] ||= [];
        for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
          occupancy[rowIndex + rowOffset][columnIndex + columnOffset] = true;
        }
      }
      columnIndex += columnSpan;
    });
  });
  return records;
}

function publishStructuredTable(pageCard, table) {
  const records = recordsFromHtmlTable(table);
  const model = buildCellMatrix(records);
  if (model.rows < 2 || model.columns < 2) return;
  pageCard.dataset.tableRows = String(model.rows);
  pageCard.dataset.tableColumns = String(model.columns);
  pageCard.dataset.tableCellSeparated = 'true';
  pageCard.dataset.tableOutputMode = 'structured-event';
  pageCard.dispatchEvent(new CustomEvent('ripscan:structured-table-ready', {
    bubbles: true,
    detail: {
      records,
      rows: model.rows,
      columns: model.columns,
      spans: model.spans,
      output: 'editable-table',
    },
  }));

  const heading = pageCard.querySelector('.page-head > div:first-child');
  if (heading && !heading.querySelector('.auto-table-badge')) {
    const badge = document.createElement('span');
    badge.className = 'auto-table-badge';
    badge.textContent = `ตาราง ${model.rows}×${model.columns} · พร้อมเปิดแก้ไข`;
    heading.append(badge);
  }
}

function bindTableEditing(pageCard, table) {
  if (structuredTables.has(table)) return;
  structuredTables.add(table);
  publishStructuredTable(pageCard, table);
  let timer = 0;
  table.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => publishStructuredTable(pageCard, table), 240);
  });
}

function scan() {
  scanScheduled = false;
  if (!results) return;
  results.querySelectorAll('.page-card').forEach(simplifyPageActions);
  results.querySelectorAll('.analysis-panel .detected-table').forEach(table => {
    const pageCard = table.closest('.page-card');
    if (pageCard) bindTableEditing(pageCard, table);
  });
}

function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  const run = () => scan();
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 700 });
  else setTimeout(run, 80);
}

results?.addEventListener('input', event => {
  if (event.isTrusted && event.target.matches('textarea.page-text')) event.target.dataset.userEdited = 'true';
});

if (results) {
  const observer = new MutationObserver(scheduleScan);
  observer.observe(results, { childList: true, subtree: true });
  scheduleScan();
}

document.documentElement.dataset.tableAutoVersion = TABLE_AUTO_VERSION;
