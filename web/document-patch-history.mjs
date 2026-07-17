function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function same(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return false;
  return false;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createModelPatches(before, after, path = [], patches = [], options = {}) {
  if (same(before, after)) return patches;
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) {
      patches.push({ path, before: clone(before), after: clone(after) });
      return patches;
    }
    for (let index = 0; index < before.length; index += 1) {
      const previous = before[index];
      const next = after[index];
      if (isPlainObject(previous) && isPlainObject(next) && previous.id && next.id && previous.id !== next.id) {
        patches.push({ path, before: clone(before), after: clone(after) });
        return patches;
      }
      createModelPatches(previous, next, [...path, index], patches, options);
      if (patches.length > (options.maxPatches || 500)) {
        patches.length = 0;
        patches.push({ path: [], before: clone(before), after: clone(after), fallback: true });
        return patches;
      }
    }
    return patches;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) createModelPatches(before[key], after[key], [...path, key], patches, options);
    return patches;
  }
  patches.push({ path, before: clone(before), after: clone(after) });
  return patches;
}

function parentAt(model, path) {
  if (!path.length) return { parent: null, key: null };
  const keys = [...path];
  const key = keys.pop();
  let parent = model;
  for (const segment of keys) parent = parent?.[segment];
  return { parent, key };
}

function write(model, path, value) {
  if (!path.length) return clone(value);
  const { parent, key } = parentAt(model, path);
  if (parent === undefined || parent === null) throw new Error(`Patch path ไม่ถูกต้อง: ${path.join('.')}`);
  if (value === undefined) {
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
  } else {
    parent[key] = clone(value);
  }
  return model;
}

export function applyModelPatches(model, patches, direction = 'forward') {
  let output = model;
  const ordered = direction === 'backward' ? [...patches].reverse() : patches;
  for (const patch of ordered) output = write(output, patch.path, direction === 'backward' ? patch.before : patch.after);
  return output;
}

export class DocumentPatchHistory {
  constructor({ limit = 70, coalesceMs = 850 } = {}) {
    this.limit = Math.max(10, Number(limit) || 70);
    this.coalesceMs = coalesceMs;
    this.undoStack = [];
    this.redoStack = [];
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoCount() { return this.undoStack.length; }
  get redoCount() { return this.redoStack.length; }
  record(before, after, { label = 'แก้ไข', groupKey = '' } = {}) {
    const patches = createModelPatches(before, after);
    if (!patches.length) return false;
    const entry = { label, groupKey, patches, at: Date.now() };
    const previous = this.undoStack.at(-1);
    if (groupKey && previous?.groupKey === groupKey && entry.at - previous.at <= this.coalesceMs) {
      const base = clone(before);
      applyModelPatches(base, previous.patches, 'backward');
      previous.patches = createModelPatches(base, after);
      previous.at = entry.at;
      previous.label = label;
    } else {
      this.undoStack.push(entry);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack = [];
    return true;
  }
  undo(model) {
    const entry = this.undoStack.pop();
    if (!entry) return { model, entry: null };
    const nextModel = applyModelPatches(model, entry.patches, 'backward');
    this.redoStack.push(entry);
    return { model: nextModel, entry };
  }
  redo(model) {
    const entry = this.redoStack.pop();
    if (!entry) return { model, entry: null };
    const nextModel = applyModelPatches(model, entry.patches, 'forward');
    this.undoStack.push(entry);
    return { model: nextModel, entry };
  }
  clear() { this.undoStack = []; this.redoStack = []; }
}
