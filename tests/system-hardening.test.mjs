import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const windowsLauncher = await readFile(new URL('../run-windows.ps1', import.meta.url));
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const studioDocs = await readFile(new URL('../docs/document-reconstruction-studio-v3.md', import.meta.url), 'utf8');

test('upload validation only accepts image formats that the OCR decoder supports', () => {
  assert.match(app, /const SUPPORTED_IMAGE_TYPES = new Set/);
  assert.match(app, /image\/png/);
  assert.match(app, /image\/jpeg/);
  assert.match(app, /SUPPORTED_FILE_NAME\.test\(file\.name\)/);
  assert.doesNotMatch(app, /file\.type\.startsWith\('image\/'\)/);
  assert.match(app, /รองรับเฉพาะ PDF, PNG, JPG, WEBP, TIFF และ BMP/);
});

test('Windows launcher stays ASCII-safe for Windows PowerShell 5.1 and waits for health', () => {
  assert.ok([...windowsLauncher].every(byte => byte < 128));
  assert.match(windowsLauncher.toString('utf8'), /\/api\/health/);
  assert.match(windowsLauncher.toString('utf8'), /app\.main:app/);
});

test('Vercel sends isolation and anti-clickjacking headers', () => {
  const headers = Object.fromEntries(vercel.headers[0].headers.map(item => [item.key, item.value]));
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin');
});

test('local launch documentation names the actual ASGI module', () => {
  assert.match(readme, /uvicorn app\.main:app/);
  assert.match(studioDocs, /uvicorn app\.main:app/);
  assert.doesNotMatch(readme, /uvicorn api\.index:app/);
  assert.doesNotMatch(studioDocs, /uvicorn api\.index:app/);
});
