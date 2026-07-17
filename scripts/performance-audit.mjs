import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function files(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await files(path));
    else output.push(path);
  }
  return output;
}

function scriptSources(html) {
  return [...html.matchAll(/<script[^>]+src="([^"]+)"[^>]*>/gu)].map(match => match[1]);
}

function styleSources(html) {
  return [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/gu)].map(match => match[1]);
}

async function sizeOf(path) {
  try { return (await stat(path)).size; }
  catch { return 0; }
}

async function sumLocalAssets(root, sources) {
  const values = await Promise.all(
    sources
      .filter(source => source.startsWith('/'))
      .map(source => sizeOf(join(root, source.slice(1)))),
  );
  return values.reduce((sum, value) => sum + value, 0);
}

function reduction(before, after) {
  if (!before) return null;
  return {
    bytes: before - after,
    percent: Number(((before - after) / before * 100).toFixed(2)),
  };
}

const V4_ENTRY = Object.freeze({
  description: 'reconstructed from the verified RipScan 4.0.1 production entrypoint; local byte sizes are measured from the corresponding unbundled source assets copied by that build',
  scripts: [
    'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js',
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    '/app.js',
    '/upgrade.js',
    '/advanced.js',
    '/verified-ui-fix.js',
    '/verified.js',
    '/theme-ui.js',
    '/table-review-v312.js',
    '/document-studio.js',
    '/pdf-tools-ui.js',
    '/table-auto-ui.js',
    '/performance-v22-ui.js',
    '/cover-recovery-ui.js',
    '/cover-ocr-ui.js',
    '/book-ocr-ui.js',
  ],
  styles: [
    '/styles.css',
    '/upgrade.css',
    '/advanced.css',
    '/verified.css',
    '/redesign.css',
    '/compact-home.css',
    '/layout-cover.css',
    '/reference-scale.css',
    '/cover-recovery.css',
    '/performance-v22.css',
    '/table-auto.css',
    '/document-studio.css',
    '/pdf-tools.css',
    '/table-review-v31.css',
  ],
});

const root = process.argv[2] || 'dist';
const sourceRoot = process.argv[3] || 'web';
const html = await readFile(join(root, 'index.html'), 'utf8');
const all = await files(root);
const js = all.filter(path => /\.(?:js|mjs)$/iu.test(path));
const css = all.filter(path => /\.css$/iu.test(path));
const initialScripts = scriptSources(html);
const initialStyles = styleSources(html);
const initialJsBytes = await sumLocalAssets(root, initialScripts);
const initialCssBytes = await sumLocalAssets(root, initialStyles);
const baselineJsBytes = await sumLocalAssets(sourceRoot, V4_ENTRY.scripts);
const baselineCssBytes = await sumLocalAssets(sourceRoot, V4_ENTRY.styles);
const baseline = {
  version: '4.0.1',
  method: V4_ENTRY.description,
  initialScripts: V4_ENTRY.scripts,
  initialStyles: V4_ENTRY.styles,
  initialScriptCount: V4_ENTRY.scripts.length,
  initialLocalScriptCount: V4_ENTRY.scripts.filter(source => source.startsWith('/')).length,
  initialRemoteScriptCount: V4_ENTRY.scripts.filter(source => !source.startsWith('/')).length,
  initialStyleCount: V4_ENTRY.styles.length,
  initialLocalJavaScriptBytes: baselineJsBytes,
  initialLocalCssBytes: baselineCssBytes,
};
const current = {
  version: '5.0.0',
  initialScripts,
  initialStyles,
  initialScriptCount: initialScripts.length,
  initialLocalScriptCount: initialScripts.filter(source => source.startsWith('/')).length,
  initialRemoteScriptCount: initialScripts.filter(source => !source.startsWith('/')).length,
  initialStyleCount: initialStyles.length,
  initialLocalJavaScriptBytes: initialJsBytes,
  initialLocalCssBytes: initialCssBytes,
};
const report = {
  generatedAt: new Date().toISOString(),
  scope: 'static production entrypoint measurements; browser timings, CPU, FPS and RAM require real-browser collection',
  baseline,
  current,
  delta: {
    initialScriptCount: current.initialScriptCount - baseline.initialScriptCount,
    initialStyleCount: current.initialStyleCount - baseline.initialStyleCount,
    initialLocalJavaScript: reduction(baseline.initialLocalJavaScriptBytes, current.initialLocalJavaScriptBytes),
    initialLocalCss: reduction(baseline.initialLocalCssBytes, current.initialLocalCssBytes),
  },
  totalJavaScriptBytes: (await Promise.all(js.map(sizeOf))).reduce((sum, value) => sum + value, 0),
  totalCssBytes: (await Promise.all(css.map(sizeOf))).reduce((sum, value) => sum + value, 0),
  javascriptFileCount: js.length,
  cssFileCount: css.length,
  dynamicLoading: html.includes('/performance-bootstrap.js')
    && !html.includes('/document-studio.js')
    && !html.includes('/pdf-tools-ui.js')
    && !html.includes('/book-ocr-ui.js')
    && !html.includes('tesseract.min.js')
    && !html.includes('jszip.min.js'),
};
await writeFile(join(root, 'performance-audit.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report));
