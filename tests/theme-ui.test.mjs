import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('landing page contains required dual-theme controls and upload elements', async () => {
  const html = await read('web/index.html');
  for (const required of [
    'data-theme="dark"',
    'id="themeToggle"',
    'id="menuToggle"',
    'id="chooseFileButton"',
    'id="dropzone"',
    'id="fileInput"',
    'id="runButton"',
    'href="/redesign.css"',
    'src="/theme-ui.js"',
  ]) assert.ok(html.includes(required), `missing ${required}`);
});

test('theme CSS defines dark and light variable systems', async () => {
  const css = await read('web/redesign.css');
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /html\[data-theme="light"\]/);
  for (const variable of [
    '--bg-primary',
    '--surface',
    '--surface-border',
    '--text-primary',
    '--accent-primary',
    '--button-gradient',
    '--glow-color',
    '--shadow-color',
  ]) assert.ok(css.includes(variable), `missing ${variable}`);
});

test('motion design respects reduced-motion preferences', async () => {
  const css = await read('web/redesign.css');
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.ok(css.includes('animation-duration: 0.001ms'));
});

test('theme UI persists selection and supports responsive menu', async () => {
  const js = await read('web/theme-ui.js');
  assert.ok(js.includes("localStorage.getItem('ripscan-theme')"));
  assert.ok(js.includes("localStorage.setItem('ripscan-theme'"));
  assert.ok(js.includes("prefers-color-scheme: light"));
  assert.ok(js.includes("mainNav.classList.remove('is-open')"));
  assert.ok(js.includes("fileInput?.click()"));
});

test('PWA shell includes the redesign assets', async () => {
  const serviceWorker = await read('web/sw.js');
  assert.ok(serviceWorker.includes("ripscan-pwa-v1.6.0"));
  assert.ok(serviceWorker.includes("'/redesign.css'"));
  assert.ok(serviceWorker.includes("'/theme-ui.js'"));
});
