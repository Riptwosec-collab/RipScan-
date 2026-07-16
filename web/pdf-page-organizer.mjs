export const PDF_PAGE_ORGANIZER_VERSION = '3.2.0';

let pageSequence = 0;

function pageId() {
  pageSequence += 1;
  const random = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `pdf-page-${Date.now().toString(36)}-${pageSequence}-${random}`;
}

export function normalizePageItem(item = {}, index = 0) {
  return {
    id: item.id || pageId(),
    sourceId: String(item.sourceId || item.fileId || 'source-1'),
    sourceName: String(item.sourceName || item.fileName || 'document.pdf'),
    sourcePageIndex: Math.max(0, Number(item.sourcePageIndex ?? item.pageIndex ?? index) || 0),
    sourcePageNumber: Math.max(1, Number(item.sourcePageNumber ?? item.pageNumber ?? index + 1) || index + 1),
    rotation: ((Number(item.rotation) || 0) % 360 + 360) % 360,
    selected: Boolean(item.selected),
    deleted: Boolean(item.deleted),
    duplicateOf: item.duplicateOf || null,
    thumbnailUrl: String(item.thumbnailUrl || ''),
    width: Math.max(1, Number(item.width) || 1),
    height: Math.max(1, Number(item.height) || 1),
    metadata: { ...(item.metadata || {}) },
  };
}

export function createPageOrganizer(items = [], options = {}) {
  return {
    version: PDF_PAGE_ORGANIZER_VERSION,
    items: items.map(normalizePageItem),
    history: [],
    future: [],
    maxHistory: Math.max(5, Number(options.maxHistory) || 50),
    activeId: options.activeId || items[0]?.id || null,
  };
}

function snapshotItems(organizer) {
  return organizer.items.map(item => ({
    ...item,
    metadata: { ...(item.metadata || {}) },
  }));
}

export function commitOrganizer(organizer, label = 'แก้ไขหน้า') {
  organizer.history.push({ label, items: snapshotItems(organizer), activeId: organizer.activeId });
  if (organizer.history.length > organizer.maxHistory) organizer.history.shift();
  organizer.future = [];
  return organizer;
}

function restoreSnapshot(organizer, snapshot) {
  organizer.items = snapshot.items.map(normalizePageItem);
  organizer.activeId = snapshot.activeId || organizer.items[0]?.id || null;
  return organizer;
}

export function undoOrganizer(organizer) {
  const previous = organizer.history.pop();
  if (!previous) return { changed: false, organizer };
  organizer.future.push({ label: previous.label, items: snapshotItems(organizer), activeId: organizer.activeId });
  restoreSnapshot(organizer, previous);
  return { changed: true, label: previous.label, organizer };
}

export function redoOrganizer(organizer) {
  const next = organizer.future.pop();
  if (!next) return { changed: false, organizer };
  organizer.history.push({ label: next.label, items: snapshotItems(organizer), activeId: organizer.activeId });
  restoreSnapshot(organizer, next);
  return { changed: true, label: next.label, organizer };
}

export function visiblePageItems(organizer) {
  return organizer.items.filter(item => !item.deleted);
}

export function selectedPageItems(organizer) {
  return visiblePageItems(organizer).filter(item => item.selected);
}

export function selectAllPages(organizer) {
  commitOrganizer(organizer, 'เลือกทุกหน้า');
  for (const item of organizer.items) if (!item.deleted) item.selected = true;
  return organizer;
}

export function deselectAllPages(organizer) {
  commitOrganizer(organizer, 'ยกเลิกเลือกทุกหน้า');
  for (const item of organizer.items) item.selected = false;
  return organizer;
}

export function togglePageSelection(organizer, id, force) {
  const item = organizer.items.find(page => page.id === id && !page.deleted);
  if (!item) return organizer;
  commitOrganizer(organizer, 'เลือกหน้า');
  item.selected = force === undefined ? !item.selected : Boolean(force);
  organizer.activeId = item.id;
  return organizer;
}

function targetItems(organizer, ids = []) {
  const selected = ids.length ? new Set(ids) : new Set(selectedPageItems(organizer).map(item => item.id));
  if (!selected.size && organizer.activeId) selected.add(organizer.activeId);
  return organizer.items.filter(item => selected.has(item.id) && !item.deleted);
}

export function rotatePages(organizer, degrees = 90, ids = []) {
  const targets = targetItems(organizer, ids);
  if (!targets.length) return organizer;
  commitOrganizer(organizer, degrees < 0 ? 'หมุนหน้าซ้าย' : 'หมุนหน้าขวา');
  for (const item of targets) item.rotation = ((item.rotation + Number(degrees || 0)) % 360 + 360) % 360;
  return organizer;
}

export function deletePages(organizer, ids = []) {
  const targets = targetItems(organizer, ids);
  if (!targets.length) return organizer;
  commitOrganizer(organizer, 'ลบหน้า');
  for (const item of targets) {
    item.deleted = true;
    item.selected = false;
  }
  organizer.activeId = visiblePageItems(organizer)[0]?.id || null;
  return organizer;
}

export function restorePages(organizer, ids = []) {
  const idSet = new Set(ids);
  const targets = organizer.items.filter(item => idSet.has(item.id) && item.deleted);
  if (!targets.length) return organizer;
  commitOrganizer(organizer, 'คืนหน้าที่ลบ');
  for (const item of targets) item.deleted = false;
  return organizer;
}

export function duplicatePages(organizer, ids = []) {
  const targets = targetItems(organizer, ids);
  if (!targets.length) return organizer;
  commitOrganizer(organizer, 'ทำสำเนาหน้า');
  const targetIds = new Set(targets.map(item => item.id));
  const output = [];
  for (const item of organizer.items) {
    output.push(item);
    if (!targetIds.has(item.id)) continue;
    const copy = normalizePageItem({
      ...item,
      id: pageId(),
      selected: false,
      duplicateOf: item.duplicateOf || item.id,
      metadata: { ...item.metadata },
    });
    output.push(copy);
  }
  organizer.items = output;
  return organizer;
}

export function reorderPage(organizer, sourceId, targetId, placement = 'before') {
  const sourceIndex = organizer.items.findIndex(item => item.id === sourceId);
  const targetIndex = organizer.items.findIndex(item => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return organizer;
  commitOrganizer(organizer, 'เรียงหน้า');
  const [source] = organizer.items.splice(sourceIndex, 1);
  let destination = organizer.items.findIndex(item => item.id === targetId);
  if (placement === 'after') destination += 1;
  organizer.items.splice(Math.max(0, destination), 0, source);
  organizer.activeId = source.id;
  return organizer;
}

export function movePages(organizer, ids, targetId, placement = 'before') {
  const movingIds = new Set(ids);
  const moving = organizer.items.filter(item => movingIds.has(item.id));
  if (!moving.length || movingIds.has(targetId)) return organizer;
  commitOrganizer(organizer, 'ย้ายหลายหน้า');
  organizer.items = organizer.items.filter(item => !movingIds.has(item.id));
  let index = organizer.items.findIndex(item => item.id === targetId);
  if (index < 0) index = organizer.items.length;
  else if (placement === 'after') index += 1;
  organizer.items.splice(index, 0, ...moving);
  organizer.activeId = moving[0].id;
  return organizer;
}

export function pageNumberLabel(item, outputIndex = 0) {
  const duplicate = item.duplicateOf ? ' · สำเนา' : '';
  const rotation = item.rotation ? ` · หมุน ${item.rotation}°` : '';
  return `${outputIndex + 1}. ${item.sourceName} · หน้า ${item.sourcePageNumber}${duplicate}${rotation}`;
}

function parsePositiveInteger(value) {
  if (!/^\d+$/u.test(String(value || '').trim())) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function parsePageSelection(spec, pageCount, options = {}) {
  const maximum = Math.max(1, Number(pageCount) || 1);
  const allowDuplicates = Boolean(options.allowDuplicates);
  const source = String(spec || '').trim();
  if (!source) return { valid: false, pages: [], errors: ['กรุณาระบุหมายเลขหน้า'] };
  const pages = [];
  const errors = [];
  for (const token of source.split(/[;,\n]+/u).map(value => value.trim()).filter(Boolean)) {
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/u);
    if (range) {
      const start = parsePositiveInteger(range[1]);
      const end = parsePositiveInteger(range[2]);
      if (!start || !end) { errors.push(`ช่วงหน้าไม่ถูกต้อง: ${token}`); continue; }
      if (start > end) { errors.push(`ช่วงหน้าย้อนกลับ: ${token}`); continue; }
      if (end > maximum) { errors.push(`หน้าเกินจำนวนทั้งหมด: ${token}`); continue; }
      for (let page = start; page <= end; page += 1) pages.push(page - 1);
      continue;
    }
    const page = parsePositiveInteger(token);
    if (!page) { errors.push(`หมายเลขหน้าไม่ถูกต้อง: ${token}`); continue; }
    if (page > maximum) { errors.push(`หน้า ${page} เกินจำนวน ${maximum} หน้า`); continue; }
    pages.push(page - 1);
  }
  const duplicatePages = pages.filter((page, index) => pages.indexOf(page) !== index);
  if (duplicatePages.length && !allowDuplicates) errors.push(`มีหน้าซ้ำ: ${[...new Set(duplicatePages)].map(page => page + 1).join(', ')}`);
  const normalized = allowDuplicates ? pages : [...new Set(pages)];
  return { valid: errors.length === 0 && normalized.length > 0, pages: normalized, errors };
}

export function parseSplitGroups(spec, pageCount) {
  const source = String(spec || '').trim();
  if (!source) return { valid: false, groups: [], errors: ['กรุณาระบุช่วงหน้า'] };
  const lines = source.split(/\n+/u).map(line => line.trim()).filter(Boolean);
  const groups = [];
  const errors = [];
  for (const line of lines) {
    const parsed = parsePageSelection(line, pageCount, { allowDuplicates: false });
    if (!parsed.valid) errors.push(...parsed.errors.map(error => `${line}: ${error}`));
    else groups.push({ label: line.replace(/\s+/gu, ''), pages: parsed.pages });
  }
  const ownership = new Map();
  for (const group of groups) {
    for (const page of group.pages) {
      if (ownership.has(page)) errors.push(`หน้า ${page + 1} อยู่ซ้ำในช่วง ${ownership.get(page)} และ ${group.label}`);
      else ownership.set(page, group.label);
    }
  }
  return { valid: errors.length === 0 && groups.length > 0, groups, errors };
}

export function splitGroupsByMode(mode, pageCount, options = {}) {
  const count = Math.max(1, Number(pageCount) || 1);
  if (mode === 'every-page') return Array.from({ length: count }, (_, index) => ({ label: `${index + 1}`, pages: [index] }));
  if (mode === 'odd') return [{ label: 'odd', pages: Array.from({ length: count }, (_, index) => index).filter(index => (index + 1) % 2 === 1) }];
  if (mode === 'even') return [{ label: 'even', pages: Array.from({ length: count }, (_, index) => index).filter(index => (index + 1) % 2 === 0) }];
  if (mode === 'every-n') {
    const every = Math.max(1, Number(options.every) || 1);
    const groups = [];
    for (let start = 0; start < count; start += every) groups.push({ label: `${start + 1}-${Math.min(count, start + every)}`, pages: Array.from({ length: Math.min(every, count - start) }, (_, offset) => start + offset) });
    return groups;
  }
  if (mode === 'selected') {
    const pages = [...new Set((options.pages || []).map(Number).filter(page => page >= 0 && page < count))];
    return pages.length ? [{ label: pages.map(page => page + 1).join('_'), pages }] : [];
  }
  return [];
}
