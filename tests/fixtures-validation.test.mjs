import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('quality fixtures contain privacy-safe expected outcomes', async () => {
  const fixtures = JSON.parse(await readFile(new URL('./table-fixtures.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(fixtures));
  assert.ok(fixtures.length >= 20);
  assert.equal(JSON.stringify(fixtures).includes('@gmail.com'), false);
});
