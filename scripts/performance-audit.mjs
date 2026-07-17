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

const root = process.argv[2] || 'dist';
const html = await readFile(join(root, 'index.html'), 'utf8');
const all = await files(root);
const js = all.filter(path => /\.(?:js|mjs)$/iu.test(path));
const css = all.filter(path => /\.css$/iu.test(path));
const initialScripts = scriptSources(html);
const initialStyles = styleSources(html);
const initialJsBytes = (await Promise.all(initialScripts.filter(source => source.startsWith('/')).map(source => sizeOf(join(root, source.slice(1)))))).reduce((sum, value) => sum + value, 0);
const initialCssBytes = (await Promise.all(initialStyles.filter(source => source.startsWith('/')).map(source => sizeOf(join(root, source.slice(1)))))).reduce((sum, value) => sum + value, 0);
const report = {
  generatedAt: new Date().toISOString(),
  scope: 'static production build measurements; browser timings and RAM require runtime collection',
  initialScripts,
  initialStyles,
  initialScriptCount: initialScripts.length,
  initialStyleCount: initialStyles.length,
  initialLocalJavaScriptBytes: initialJsBytes,
  initialLocalCssBytes: initialCssBytes,
  totalJavaScriptBytes: (await Promise.all(js.map(sizeOf))).reduce((sum, value) => sum + value, 0),
  totalCssBytes: (await Promise.all(css.map(sizeOf))).reduce((sum, value) => sum + value, 0),
  javascriptFileCount: js.length,
  cssFileCount: css.length,
  dynamicLoading: html.includes('/performance-bootstrap.js') && !html.includes('/document-studio.js') && !html.includes('/pdf-tools-ui.js') && !html.includes('tesseract.min.js'),
};
await writeFile(join(root, 'performance-audit.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report));
