import { cp, mkdir, writeFile } from 'node:fs/promises';

const vendorRoot = 'dist/vendor';
const coreTarget = `${vendorRoot}/tesseract-core`;
const languageTarget = `${vendorRoot}/tessdata`;

await mkdir(vendorRoot, { recursive: true });
await mkdir(languageTarget, { recursive: true });

await cp('node_modules/tesseract.js/dist/tesseract.min.js', `${vendorRoot}/tesseract.min.js`);
await cp('node_modules/tesseract.js/dist/worker.min.js', `${vendorRoot}/worker.min.js`);
await cp('node_modules/tesseract.js-core', coreTarget, { recursive: true });

const languageSources = {
  eng: [
    'https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz',
    'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz',
  ],
  tha: [
    'https://tessdata.projectnaptha.com/4.0.0_fast/tha.traineddata.gz',
    'https://cdn.jsdelivr.net/npm/@tesseract.js-data/tha@1.0.0/4.0.0_best_int/tha.traineddata.gz',
  ],
};

async function downloadLanguage(code, urls) {
  let lastError = null;
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort('LANGUAGE_DOWNLOAD_TIMEOUT'), 45_000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 50_000) throw new Error('LANGUAGE_FILE_TOO_SMALL');
      await writeFile(`${languageTarget}/${code}.traineddata.gz`, bytes);
      console.log(`Bundled OCR language ${code}: ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB`);
      return;
    } catch (error) {
      lastError = error;
      console.warn(`OCR language source failed for ${code}: ${url} (${error?.message || error})`);
    }
  }
  throw new Error(`Unable to bundle OCR language ${code}: ${lastError?.message || lastError}`);
}

for (const [code, urls] of Object.entries(languageSources)) await downloadLanguage(code, urls);

console.log('Local Tesseract runtime bundled: API, worker, full core directory, Thai and English language data');
