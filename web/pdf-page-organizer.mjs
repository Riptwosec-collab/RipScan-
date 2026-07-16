import {
  createOrganizerItem,
  deleteOrganizerItems,
  duplicateOrganizerItems,
  normalizeOrganizer,
  reorderOrganizer,
  rotateOrganizerItems,
} from './pdf-utility-core.mjs';

export const PAGE_ORGANIZER_VERSION = '4.0.0';

export class PdfPageOrganizer {
  constructor(items = [], { maxHistory = 50 } = {}) {
    this.items = normalizeOrganizer(items);
    this.maxHistory = Math.max(1, Number(maxHistory) || 50);
    this.history = [];
    this.future = [];
  }

  snapshot(label) {
    this.history.push({ label, items: structuredCloneSafe(this.items) });
    if (this.history.length > this.maxHistory) this.history.shift();
    this.future = [];
  }

  replace(items, label = 'แทนที่รายการหน้า') {
    this.snapshot(label);
    this.items = normalizeOrganizer(items);
    return this.items;
  }

  appendSource({ sourceId, sourceIndex, name, pageCount, kind = 'pdf' }) {
    this.snapshot('เพิ่มไฟล์');
    for (let pageIndex = 0; pageIndex < Math.max(1, Number(pageCount) || 1); pageIndex += 1) {
      this.items.push(createOrganizerItem({ sourceId, sourceIndex, pageIndex, kind, name: `${name} · หน้า ${pageIndex + 1}` }));
    }
    return this.items;
  }

  reorder(fromIndex, toIndex) {
    this.snapshot('เรียงหน้า');
    this.items = reorderOrganizer(this.items, fromIndex, toIndex);
    return this.items;
  }

  moveBefore(ids, targetId) {
    const selected = new Set(ids || []);
    const moving = this.items.filter(item => selected.has(item.id));
    const remaining = this.items.filter(item => !selected.has(item.id));
    const targetIndex = Math.max(0, remaining.findIndex(item => item.id === targetId));
    this.snapshot('ย้ายหน้าก่อน');
    remaining.splice(targetIndex, 0, ...moving);
    this.items = remaining;
    return this.items;
  }

  moveAfter(ids, targetId) {
    const selected = new Set(ids || []);
    const moving = this.items.filter(item => selected.has(item.id));
    const remaining = this.items.filter(item => !selected.has(item.id));
    const found = remaining.findIndex(item => item.id === targetId);
    const targetIndex = found < 0 ? remaining.length : found + 1;
    this.snapshot('ย้ายหน้าหลัง');
    remaining.splice(targetIndex, 0, ...moving);
    this.items = remaining;
    return this.items;
  }

  select(ids, selected = true) {
    const set = new Set(ids || []);
    this.items = this.items.map(item => set.has(item.id) ? { ...item, selected: Boolean(selected) } : item);
    return this.items;
  }

  selectAll(selected = true) {
    this.items = this.items.map(item => ({ ...item, selected: Boolean(selected) }));
    return this.items;
  }

  rotate(ids, delta) {
    this.snapshot('หมุนหน้า');
    this.items = rotateOrganizerItems(this.items, ids, delta);
    return this.items;
  }

  remove(ids) {
    this.snapshot('ลบหน้า');
    this.items = deleteOrganizerItems(this.items, ids);
    return this.items;
  }

  duplicate(ids) {
    this.snapshot('ทำสำเนาหน้า');
    this.items = duplicateOrganizerItems(this.items, ids);
    return this.items;
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) return false;
    this.future.push({ label: previous.label, items: structuredCloneSafe(this.items) });
    this.items = normalizeOrganizer(previous.items);
    return true;
  }

  redo() {
    const next = this.future.pop();
    if (!next) return false;
    this.history.push({ label: next.label, items: structuredCloneSafe(this.items) });
    this.items = normalizeOrganizer(next.items);
    return true;
  }

  selectedItems() {
    return this.items.filter(item => item.selected && !item.deleted);
  }

  activeItems() {
    return this.items.filter(item => !item.deleted);
  }

  serialize() {
    return {
      version: PAGE_ORGANIZER_VERSION,
      items: structuredCloneSafe(this.items),
    };
  }
}

function structuredCloneSafe(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
