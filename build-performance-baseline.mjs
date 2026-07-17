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

const report = await collect();
await writeFile('.performance-baseline.json', JSON.stringify(report, null, 2), 'utf8');
console.log(`RipScan baseline measured: ${report.initialLocalScriptCount} local scripts / ${report.initialLocalScriptBytes} bytes, ${report.initialRemoteScriptCount} remote scripts, ${report.pwaPrecacheAssetCount} precache assets`);
