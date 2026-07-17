import test from 'node:test';
import assert from 'node:assert/strict';
import { PdfPageOrganizer } from '../web/pdf-page-organizer.mjs';

test('shared PDF Page Organizer reorders rotates deletes duplicates and restores history', () => {
  const organizer = new PdfPageOrganizer();
  organizer.appendSource({ sourceId: 'first', sourceIndex: 0, name: 'first.pdf', pageCount: 3, kind: 'pdf' });
  assert.equal(organizer.activeItems().length, 3);
  const original = organizer.activeItems().map(item => item.id);
  organizer.reorder(0, 2);
  assert.equal(organizer.activeItems()[2].id, original[0]);
  organizer.rotate([original[0]], 90);
  assert.equal(organizer.activeItems().find(item => item.id === original[0]).rotation, 90);
  organizer.duplicate([original[1]]);
  assert.equal(organizer.activeItems().length, 4);
  organizer.remove([original[2]]);
  assert.equal(organizer.activeItems().length, 3);
  assert.equal(organizer.undo(), true);
  assert.equal(organizer.activeItems().length, 4);
  assert.equal(organizer.redo(), true);
  assert.equal(organizer.activeItems().length, 3);
});

test('organizer selection is reused by merge and split workflows', () => {
  const organizer = new PdfPageOrganizer();
  organizer.appendSource({ sourceId: 'a', sourceIndex: 0, name: 'a.pdf', pageCount: 2 });
  organizer.appendSource({ sourceId: 'b', sourceIndex: 1, name: 'b.png', pageCount: 1, kind: 'image' });
  organizer.selectAll(false);
  const second = organizer.activeItems()[1];
  organizer.select([second.id], true);
  assert.deepEqual(organizer.selectedItems().map(item => item.id), [second.id]);
  const serialized = organizer.serialize();
  assert.equal(serialized.version, '4.0.0');
  assert.equal(serialized.items.length, 3);
});
