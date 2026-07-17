import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentPatchHistory, applyModelPatches, createModelPatches } from '../web/document-patch-history.mjs';

const clone = value => structuredClone(value);

function fixture() {
  return {
    id: 'doc',
    name: 'Example',
    pages: [{ id: 'p1', blocks: [{ id: 'b1', type: 'text', text: 'เดิม', x: 10, y: 20 }, { id: 't1', type: 'table', rows: 1, columns: 1, cells: [{ id: 'c1', text: 'A' }] }] }],
  };
}

test('model diff stores only changed leaf for text edit', () => {
  const before = fixture();
  const after = clone(before);
  after.pages[0].blocks[0].text = 'ข้อความใหม่';
  const patches = createModelPatches(before, after);
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].path, ['pages', 0, 'blocks', 0, 'text']);
  assert.equal(patches[0].before, 'เดิม');
  assert.equal(patches[0].after, 'ข้อความใหม่');
});

test('patches apply forward and backward without document snapshots in history', () => {
  const before = fixture();
  const after = clone(before);
  after.pages[0].blocks[0].x = 90;
  after.pages[0].blocks[1].cells[0].text = 'B';
  const patches = createModelPatches(before, after);
  const forward = applyModelPatches(clone(before), patches, 'forward');
  assert.deepEqual(forward, after);
  const backward = applyModelPatches(forward, patches, 'backward');
  assert.deepEqual(backward, before);
});

test('DocumentPatchHistory limits entries and supports undo redo', () => {
  const history = new DocumentPatchHistory({ limit: 3 });
  const model = fixture();
  for (let index = 0; index < 5; index += 1) {
    const before = clone(model);
    model.pages[0].blocks[0].x += 1;
    history.record(before, model, { label: 'move' });
  }
  assert.equal(history.undoCount, 3);
  const x = model.pages[0].blocks[0].x;
  const undone = history.undo(model);
  assert.equal(undone.model.pages[0].blocks[0].x, x - 1);
  const redone = history.redo(undone.model);
  assert.equal(redone.model.pages[0].blocks[0].x, x);
});
