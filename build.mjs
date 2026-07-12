import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('web', 'dist', { recursive: true });

const browserModulePath = 'dist/book-ocr-browser.mjs';
const browserModule = await readFile(browserModulePath, 'utf8');
const strictBrowserModule = browserModule.replace(
  "from './book-ocr-core.mjs';",
  "from './book-ocr-rules.mjs';",
);

if (strictBrowserModule === browserModule) {
  throw new Error('Strict book OCR rules were not applied to the production module');
}

await writeFile(browserModulePath, strictBrowserModule, 'utf8');
console.log('RipScan static site built in dist/ with strict book OCR rules');
