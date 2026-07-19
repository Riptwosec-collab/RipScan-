import { readFile, writeFile } from 'node:fs/promises';

const path = 'dist/sw.js';
let source = await readFile(path, 'utf8');
source = source.replace(/ripscan-pwa-v[0-9.]+/g, 'ripscan-pwa-v4.1.3');
await writeFile(path, source, 'utf8');
console.log('RipScan PWA cache bumped to v4.1.3 for OCR worker heartbeat and runtime recovery');
