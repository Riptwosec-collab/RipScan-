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
    'id="automaticVerifiedSettings"',
    'href="/redesign.css"',
    'src="/theme-ui.js"',
  ]) assert.ok(html.includes(required), `missing ${required}`);
});

test('dark navy-purple is the default while saved light preference is respected', async () => {
  const html = await read('web/index.html');
  assert.ok(html.includes("const theme = saved === 'light' ? 'light' : 'dark'"));
  assert.ok(html.includes("localStorage.setItem('ripscan-theme', 'dark')"));
  assert.ok(html.indexOf('src="/verified-ui-fix.js"') < html.indexOf('src="/verified.js"'));
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

test('theme UI persists manual selection and supports responsive menu', async () => {
  const js = await read('web/theme-ui.js');
  assert.ok(js.includes("localStorage.getItem('ripscan-theme')"));
  assert.ok(js.includes("localStorage.setItem('ripscan-theme'"));
  assert.ok(js.includes("mainNav.classList.remove('is-open')"));
  assert.ok(js.includes('fileInput?.click()'));
});

test('verified table settings run automatically without rendering controls', async () => {
  const html = await read('web/index.html');
  const js = await read('web/verified-ui-fix.js');
  assert.ok(html.includes('id="tableMode" type="hidden" value="accurate"'));
  assert.ok(html.includes('id="verifiedExportPolicy" type="hidden" value="mark_review"'));
  assert.ok(html.includes('id="verifiedDelimiter" type="hidden" value=","'));
  assert.ok(js.includes("tableMode: 'accurate'"));
  assert.ok(js.includes("exportPolicy: 'mark_review'"));
  assert.ok(js.includes("delimiter: ','"));
  assert.ok(js.includes("document.querySelectorAll('.verified-controls').forEach(panel => panel.remove())"));
  assert.ok(js.includes("dataset.verifiedSettings = 'automatic'"));
});

test('PWA shell includes the redesign assets', async () => {
  const serviceWorker = await read('web/sw.js');
  assert.ok(serviceWorker.includes('ripscan-pwa-v1.6.2'));
  assert.ok(serviceWorker.includes("'/redesign.css'"));
  assert.ok(serviceWorker.includes("'/theme-ui.js'"));
  assert.ok(serviceWorker.includes("'/verified-ui-fix.js'"));
});
