import { readFile, writeFile } from 'node:fs/promises';

const indexPath = 'dist/index.html';
let html = await readFile(indexPath, 'utf8');

const lazyScripts = [
  '/table-review-v312.js',
  '/document-studio.js',
  '/pdf-tools-ui.js',
  '/table-auto-ui.js',
  '/performance-v22-ui.js',
  '/cover-recovery-ui.js',
  '/cover-ocr-ui.js',
  '/book-ocr-ui.js',
];
for (const script of lazyScripts) {
  html = html.replace(new RegExp(`\\s*<script type="module" src="${script.replaceAll('/', '\\/').replaceAll('.', '\\.')}\\"><\\/script>`, 'g'), '');
}
html = html
  .replace(/\s*<script src="(?:https:\/\/cdn\.jsdelivr\.net\/npm\/tesseract\.js@7(?:\.0\.0)?\/dist\/tesseract\.min\.js|\/vendor\/tesseract\.min\.js)"><\/script>/g, '')
  .replace(/\s*<script src="(?:https:\/\/cdn\.jsdelivr\.net\/npm\/jszip@3\.10\.1\/dist\/jszip\.min\.js|\/vendor\/jszip\.min\.js)"><\/script>/g, '');

const lazyStyles = [
  '/performance-v22.css',
  '/table-auto.css',
  '/document-studio.css',
  '/pdf-tools.css',
  '/table-review-v31.css',
  '/cover-recovery.css',
];
for (const style of lazyStyles) {
  html = html.replace(new RegExp(`\\s*<link rel="stylesheet" href="${style.replaceAll('/', '\\/').replaceAll('.', '\\.')}">`, 'g'), '');
}

if (!html.includes('src="/tool-lazy-loader.js"')) {
  html = html.replace(
    '  <script type="module" src="/performance-guard.js"></script>',
    '  <script type="module" src="/performance-guard.js"></script>\n  <script type="module" src="/tool-lazy-loader.js"></script>',
  );
}
await writeFile(indexPath, html, 'utf8');

const verifiedPath = 'dist/verified-ui-fix.js';
let verified = await readFile(verifiedPath, 'utf8');
verified = verified.replace("import './book-ocr-ui.js';\n", '');
await writeFile(verifiedPath, verified, 'utf8');

const swPath = 'dist/sw.js';
let sw = await readFile(swPath, 'utf8');
if (!sw.includes("'/tool-lazy-loader.js'")) sw = sw.replace("  '/app.js',", "  '/app.js',\n  '/tool-lazy-loader.js',");
const lazyAssets = [
  '/performance-v22.css', '/performance-v22-ui.js',
  '/book-ocr.css', '/book-ocr-core.mjs', '/book-ocr-rules.mjs', '/book-ocr-browser.mjs',
  '/book-ocr-browser-recovery.mjs', '/book-ocr-browser-hard-block.mjs', '/book-ocr-browser-performance.mjs', '/book-ocr-ui.js',
  '/cover-recovery.css', '/cover-ocr-core.mjs', '/cover-ocr-rules.mjs', '/cover-recovery-core.mjs', '/cover-hard-block.mjs', '/cover-ocr-ui.js', '/cover-recovery-ui.js',
  '/sara-am-spacing.mjs', '/sara-am-recovery-v21.mjs', '/ocr-performance-core.mjs', '/ocr-preprocess-worker.js',
  '/table-auto.css', '/table-structure-core.mjs', '/table-auto-ui.js', '/table-reconstruction-core.mjs', '/table-reconstruction-worker.js', '/table-review-v312.js', '/table-review-v31.css',
  '/document-studio.css', '/document-model.mjs', '/office-import.mjs', '/editor-export.mjs', '/document-studio.js',
  '/pdf-tools.css', '/pdf-utility-core.mjs', '/pdf-page-organizer.mjs', '/pdf-worker.js', '/pdf-tool-runtime.mjs', '/ripscan-project.mjs', '/roundtrip-export.mjs', '/pdf-tools-ui.js',
];
for (const asset of lazyAssets) sw = sw.replace(`  '${asset}',\n`, '');
await writeFile(swPath, sw, 'utf8');

console.log(`RipScan lazy tools: removed ${lazyScripts.length} scripts and ${lazyStyles.length} styles from initial HTML; heavy OCR, Office, Table and PDF modules now load on demand`);
