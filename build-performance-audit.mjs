import { readFile, stat, writeFile } from 'node:fs/promises';

function sources(html, tag) {
  const pattern = tag === 'script' ? /<script[^>]+src="([^"]+)"[^>]*>/gu : /<link[^>]+href="([^"]+)"[^>]*>/gu;
  return [...html.matchAll(pattern)].map(match => match[1]);
}

async function bytesFor(root, urls) {
  let bytes = 0;
  const found = [];
  for (const url of urls.filter(item => item.startsWith('/'))) {
    try {
      const size = (await stat(`${root}${url}`)).size;
      bytes += size;
      found.push({ url, bytes: size });
    } catch {}
  }
  return { bytes, files: found };
}

async function collect(root = 'dist') {
  const html = await readFile(`${root}/index.html`, 'utf8');
  const scripts = sources(html, 'script');
  const styles = sources(html, 'style');
  const localScripts = scripts.filter(url => url.startsWith('/'));
  const remoteScripts = scripts.filter(url => /^https?:/u.test(url));
  const localStyles = styles.filter(url => url.startsWith('/'));
  const scriptSize = await bytesFor(root, localScripts);
  const styleSize = await bytesFor(root, localStyles);
  const sw = await readFile(`${root}/sw.js`, 'utf8');
  const appShellMatch = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/u)?.[1] || '';
  const precacheAssets = [...appShellMatch.matchAll(/'([^']+)'/gu)].map(match => match[1]);
  return {
    measuredAt: new Date().toISOString(),
    initialLocalScriptCount: localScripts.length,
    initialRemoteScriptCount: remoteScripts.length,
    initialLocalScriptBytes: scriptSize.bytes,
    initialLocalStyleCount: localStyles.length,
    initialLocalStyleBytes: styleSize.bytes,
    localScripts: scriptSize.files,
    remoteScripts,
    localStyles: styleSize.files,
    pwaPrecacheAssetCount: precacheAssets.length,
    indexHtmlBytes: (await stat(`${root}/index.html`)).size,
    appJsBytes: (await stat(`${root}/app.js`)).size,
    serviceWorkerBytes: (await stat(`${root}/sw.js`)).size,
  };
}

const before = JSON.parse(await readFile('.performance-baseline.json', 'utf8'));
const after = await collect();
const difference = {
  initialLocalScriptCount: after.initialLocalScriptCount - before.initialLocalScriptCount,
  initialRemoteScriptCount: after.initialRemoteScriptCount - before.initialRemoteScriptCount,
  initialLocalScriptBytes: after.initialLocalScriptBytes - before.initialLocalScriptBytes,
  initialLocalStyleCount: after.initialLocalStyleCount - before.initialLocalStyleCount,
  initialLocalStyleBytes: after.initialLocalStyleBytes - before.initialLocalStyleBytes,
  pwaPrecacheAssetCount: after.pwaPrecacheAssetCount - before.pwaPrecacheAssetCount,
  indexHtmlBytes: after.indexHtmlBytes - before.indexHtmlBytes,
  appJsBytes: after.appJsBytes - before.appJsBytes,
  serviceWorkerBytes: after.serviceWorkerBytes - before.serviceWorkerBytes,
};
const percent = (beforeValue, afterValue) => beforeValue > 0 ? Number(((afterValue - beforeValue) / beforeValue * 100).toFixed(2)) : null;
const report = {
  methodology: 'Static byte counts from the same Vercel production build before and after performance transforms. Remote script byte sizes are excluded because they are not downloaded during build.',
  before,
  after,
  difference,
  percentChange: {
    initialLocalScriptBytes: percent(before.initialLocalScriptBytes, after.initialLocalScriptBytes),
    initialLocalStyleBytes: percent(before.initialLocalStyleBytes, after.initialLocalStyleBytes),
    pwaPrecacheAssetCount: percent(before.pwaPrecacheAssetCount, after.pwaPrecacheAssetCount),
  },
};
await writeFile('dist/performance-build-report.json', JSON.stringify(report, null, 2), 'utf8');
console.log(`RipScan optimized measured: ${after.initialLocalScriptCount} local scripts / ${after.initialLocalScriptBytes} bytes, ${after.initialRemoteScriptCount} remote scripts, ${after.pwaPrecacheAssetCount} precache assets`);
console.log(`RipScan static delta: scripts ${difference.initialLocalScriptCount}, bytes ${difference.initialLocalScriptBytes}, remote ${difference.initialRemoteScriptCount}, precache ${difference.pwaPrecacheAssetCount}`);
