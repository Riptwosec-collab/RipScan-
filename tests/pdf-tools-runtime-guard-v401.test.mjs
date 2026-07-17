import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const build = await readFile(new URL('../build.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('production build replaces recursive PDF Tools observer with one-shot initialization', () => {
  assert.match(build, /PDF Tools observer runtime guard could not be applied/u);
  assert.match(build, /function initializePdfTools\(\)/u);
  assert.match(build, /if \(initializePdfTools\(\)\) observer\.disconnect\(\)/u);
  assert.match(build, /observer\.observe\(document\.body \|\| document\.documentElement/u);
  assert.doesNotMatch(build, /serviceWorker\.replace\(\/ripscan-pwa-v\[0-9\.\]\+\/g, 'ripscan-pwa-v4\.0\.0'\)/u);
});

test('RipScan performance version is 5.0.0 while PDF Tools observer guard remains enabled', () => {
  assert.equal(packageJson.version, '5.0.0');
  assert.match(build, /ripscan-pwa-v5\.0\.0/u);
  assert.match(build, /PDF Tools v4\.0\.1 runtime guard/u);
  assert.match(build, /Performance Runtime v5\.0\.0/u);
});
