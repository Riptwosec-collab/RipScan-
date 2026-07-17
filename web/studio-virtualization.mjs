const PAGE_ITEM_HEIGHT = 154;
const PAGE_WINDOW = 16;
const TABLE_ROW_HEIGHT = 38;
const TABLE_WINDOW = 56;
const guards = new WeakSet();
let scheduled = false;

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function studioModel() {
  return globalThis.RipScanDocumentStudio?.getModel?.() || null;
}

function activePageIndex(model) {
  const pageId = document.querySelector('.studio-page-canvas')?.dataset.studioPage;
  const byId = model?.pages?.findIndex(page => page.id === pageId) ?? -1;
  if (byId >= 0) return byId;
  return Number(document.querySelector('.studio-page-thumb.active')?.dataset.pageIndex || 0);
}

function thumbnail(page, index, active) {
  return `<button type="button" class="studio-page-thumb ${index === active ? 'active' : ''}" data-page-index="${index}"><span class="studio-thumb-sheet" style="aspect-ratio:${Number(page.width || 794)}/${Number(page.height || 1123)};background:${escapeHtml(page.background || '#fff')}">${page.backgroundImage ? `<img src="${escapeHtml(page.backgroundImage)}" alt="" loading="lazy" decoding="async">` : ''}<em>${page.blocks?.length || 0} blocks</em></span><strong>${escapeHtml(page.name || `หน้า ${index + 1}`)}</strong><small>${Math.round(page.width || 0)}×${Math.round(page.height || 0)}</small></button>`;
}

function virtualizePages() {
  const list = document.querySelector('#studioPageList');
  const model = studioModel();
  if (!list || !model?.pages?.length || model.pages.length <= PAGE_WINDOW) return;
  if (!list.dataset.virtualListener) {
    list.dataset.virtualListener = 'true';
    list.classList.add('performance-virtualized');
    list.addEventListener('scroll', schedule, { passive: true });
  }
  const active = activePageIndex(model);
  const byScroll = Math.max(0, Math.floor(list.scrollTop / PAGE_ITEM_HEIGHT) - 4);
  let start = byScroll;
  if (active < start || active >= start + PAGE_WINDOW) start = Math.max(0, active - Math.floor(PAGE_WINDOW / 2));
  const end = Math.min(model.pages.length, start + PAGE_WINDOW);
  if (list.dataset.virtualStart === String(start) && list.dataset.virtualCount === String(model.pages.length) && list.querySelector(`[data-page-index="${active}"]`)) return;
  const top = start * PAGE_ITEM_HEIGHT;
  const bottom = Math.max(0, (model.pages.length - end) * PAGE_ITEM_HEIGHT);
  guards.add(list);
  list.innerHTML = `<div class="studio-page-virtual-spacer" style="height:${top}px" aria-hidden="true"></div>${model.pages.slice(start, end).map((page, offset) => thumbnail(page, start + offset, active)).join('')}<div class="studio-page-virtual-spacer" style="height:${bottom}px" aria-hidden="true"></div>`;
  list.dataset.virtualStart = String(start);
  list.dataset.virtualCount = String(model.pages.length);
  queueMicrotask(() => guards.delete(list));
}

function pageAndBlock(blockId) {
  const model = studioModel();
  if (!model) return {};
  for (const page of model.pages || []) {
    const block = page.blocks?.find(item => item.id === blockId);
    if (block) return { page, block };
  }
  return {};
}

function rowCells(block, row, start, end) {
  return (block.cells || [])
    .filter(cell => !cell.hidden && cell.row === row && cell.row < end && cell.row + Math.max(1, cell.rowSpan || 1) > start)
    .sort((a, b) => a.column - b.column)
    .map(cell => `<td contenteditable="true" data-table-cell="${cell.id}" data-block-id="${block.id}" rowspan="${Math.max(1, cell.rowSpan || 1)}" colspan="${Math.max(1, cell.columnSpan || 1)}" style="${Object.entries(cell.style || {}).map(([key, value]) => `${key.replace(/[A-Z]/gu, c => `-${c.toLowerCase()}`)}:${typeof value === 'number' ? `${value}px` : value}`).join(';')}">${escapeHtml(cell.text || '').replace(/\n/gu, '<br>')}</td>`).join('');
}

function renderTableWindow(shell, block, forceStart) {
  const viewportRows = Math.max(12, Math.ceil((shell.clientHeight || 420) / TABLE_ROW_HEIGHT));
  const windowSize = Math.min(TABLE_WINDOW, viewportRows + 18);
  const calculated = Math.max(0, Math.floor(shell.scrollTop / TABLE_ROW_HEIGHT) - 8);
  const start = Math.max(0, Math.min(block.rows - windowSize, Number.isFinite(forceStart) ? forceStart : calculated));
  const end = Math.min(block.rows, start + windowSize);
  if (shell.dataset.rowStart === String(start) && shell.dataset.rowCount === String(block.rows)) return;
  const topHeight = start * TABLE_ROW_HEIGHT;
  const bottomHeight = Math.max(0, (block.rows - end) * TABLE_ROW_HEIGHT);
  const columns = Math.max(1, block.columns || 1);
  const rows = [];
  if (topHeight) rows.push(`<tr class="virtual-row-spacer" aria-hidden="true"><td colspan="${columns}" style="height:${topHeight}px;padding:0;border:0"></td></tr>`);
  for (let row = start; row < end; row += 1) rows.push(`<tr data-virtual-row="${row}">${rowCells(block, row, start, end)}</tr>`);
  if (bottomHeight) rows.push(`<tr class="virtual-row-spacer" aria-hidden="true"><td colspan="${columns}" style="height:${bottomHeight}px;padding:0;border:0"></td></tr>`);
  const table = shell.querySelector('table');
  const tbody = table?.tBodies?.[0];
  if (!tbody) return;
  guards.add(shell);
  tbody.innerHTML = rows.join('');
  shell.dataset.rowStart = String(start);
  shell.dataset.rowCount = String(block.rows);
  queueMicrotask(() => guards.delete(shell));
}

function virtualizeTables() {
  for (const table of document.querySelectorAll('.studio-editable-table')) {
    const blockElement = table.closest('[data-block-id]');
    const blockId = blockElement?.dataset.blockId;
    const { block } = pageAndBlock(blockId);
    if (!block || block.type !== 'table' || block.rows <= TABLE_WINDOW) continue;
    let shell = table.parentElement?.classList.contains('studio-table-virtual-scroll') ? table.parentElement : null;
    if (!shell) {
      shell = document.createElement('div');
      shell.className = 'studio-table-virtual-scroll';
      shell.style.cssText = 'width:100%;height:100%;overflow:auto;contain:strict;';
      table.replaceWith(shell);
      shell.append(table);
      table.classList.add('performance-virtual-table');
      shell.addEventListener('scroll', () => {
        if (shell.dataset.scrollScheduled) return;
        shell.dataset.scrollScheduled = 'true';
        requestAnimationFrame(() => {
          delete shell.dataset.scrollScheduled;
          const current = pageAndBlock(blockId).block;
          if (current) renderTableWindow(shell, current);
        });
      }, { passive: true });
    }
    renderTableWindow(shell, block, 0);
  }
}

function optimizeImages() {
  document.querySelectorAll('#documentStudio img:not([decoding])').forEach(image => {
    image.decoding = 'async';
    if (!image.closest('.studio-page-canvas')) image.loading = 'lazy';
  });
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    virtualizePages();
    virtualizeTables();
    optimizeImages();
  });
}

const observer = new MutationObserver(records => {
  if (records.every(record => guards.has(record.target) || guards.has(record.target.parentElement))) return;
  schedule();
});

export function installStudioVirtualization() {
  const studio = document.querySelector('#documentStudio');
  if (!studio || studio.dataset.performanceVirtualization === 'true') return false;
  studio.dataset.performanceVirtualization = 'true';
  observer.observe(studio, { childList: true, subtree: true });
  studio.addEventListener('pointerdown', event => {
    const block = event.target.closest('.studio-block');
    if (block && event.target.closest('.studio-block-handle,.studio-resize-handle')) block.classList.add('performance-dragging');
  }, { capture: true });
  studio.addEventListener('pointerup', () => document.querySelectorAll('.performance-dragging').forEach(block => block.classList.remove('performance-dragging')), { capture: true });
  schedule();
  return true;
}

export function disposeStudioVirtualization() {
  observer.disconnect();
}

if (document.querySelector('#documentStudio')) installStudioVirtualization();
else document.addEventListener('ripscan:tool-loaded', event => { if (event.detail?.name === 'studio') queueMicrotask(installStudioVirtualization); });
