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

const indexPath = 'dist/index.html';
let indexHtml = await readFile(indexPath, 'utf8');
if (!indexHtml.includes('/layout-cover.css')) {
  indexHtml = indexHtml.replace(
    '<link rel="stylesheet" href="/compact-home.css">',
    '<link rel="stylesheet" href="/compact-home.css">\n  <link rel="stylesheet" href="/layout-cover.css">',
  );
}
if (!indexHtml.includes('/reference-scale.css')) {
  indexHtml = indexHtml.replace(
    '<link rel="stylesheet" href="/layout-cover.css">',
    '<link rel="stylesheet" href="/layout-cover.css">\n  <link rel="stylesheet" href="/reference-scale.css">',
  );
}
if (!indexHtml.includes('class="hero-support"')) {
  indexHtml = indexHtml.replace(
    '        </h1>\n      </div>',
    '        </h1>\n        <p class="hero-support">อัปโหลดไฟล์ PDF, PNG, JPG หรือวางจากคลิปบอร์ด ตั้งค่าการประมวลผล OCR แล้วแปลงเป็นข้อความที่ตรวจแก้ได้ทันที</p>\n      </div>',
  );
}
if (!indexHtml.includes('/cover-ocr-ui.js')) {
  indexHtml = indexHtml.replace(
    '  <script type="module" src="/theme-ui.js"></script>',
    '  <script type="module" src="/theme-ui.js"></script>\n  <script type="module" src="/cover-ocr-ui.js"></script>',
  );
}
await writeFile(indexPath, indexHtml, 'utf8');

const coverUiPath = 'dist/cover-ocr-ui.js';
let coverUi = await readFile(coverUiPath, 'utf8');
coverUi = coverUi.replace(
  "from './cover-ocr-core.mjs';",
  "from './cover-ocr-rules.mjs';",
);
coverUi = coverUi.replace(
  "  const grayscale = grayscaleCanvas(up4);",
  "  const cropUrl = original.toDataURL('image/jpeg', .88);\n  const enhancedUrl = up4.toDataURL('image/jpeg', .88);\n  const grayscale = grayscaleCanvas(up4);",
);
coverUi = coverUi.replace(
  "  region.cropUrl = original.toDataURL?.('image/jpeg', .88) || '';\n  region.enhancedUrl = up4.toDataURL?.('image/jpeg', .88) || '';",
  "  region.cropUrl = cropUrl;\n  region.enhancedUrl = enhancedUrl;",
);
await writeFile(coverUiPath, coverUi, 'utf8');

const serviceWorkerPath = 'dist/sw.js';
let serviceWorker = await readFile(serviceWorkerPath, 'utf8');
serviceWorker = serviceWorker.replace(/ripscan-pwa-v[0-9.]+/g, 'ripscan-pwa-v1.9.1');
for (const asset of ['/layout-cover.css', '/reference-scale.css', '/cover-ocr-core.mjs', '/cover-ocr-rules.mjs', '/cover-ocr-ui.js']) {
  if (!serviceWorker.includes(`'${asset}'`)) {
    serviceWorker = serviceWorker.replace("  '/compact-home.css',", `  '/compact-home.css',\n  '${asset}',`);
  }
}
await writeFile(serviceWorkerPath, serviceWorker, 'utf8');

console.log('RipScan static site built with cover OCR gates and reference-scale desktop layout');
