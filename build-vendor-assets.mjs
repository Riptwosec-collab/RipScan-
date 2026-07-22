import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist/vendor/tessdata', { recursive: true });
await mkdir('dist/vendor/tesseract-core', { recursive: true });
await copyFile('node_modules/tesseract.js/dist/tesseract.min.js', 'dist/vendor/tesseract.min.js');
await copyFile('node_modules/tesseract.js/dist/worker.min.js', 'dist/vendor/worker.min.js');
await copyFile('node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'dist/vendor/tesseract-core/tesseract-core-lstm.wasm.js');
await copyFile('node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'dist/vendor/tesseract-core/tesseract-core-lstm.wasm');
await copyFile('node_modules/@tesseract.js-data/tha/4.0.0_best_int/tha.traineddata.gz', 'dist/vendor/tessdata/tha.traineddata.gz');
await copyFile('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'dist/vendor/tessdata/eng.traineddata.gz');
await copyFile('node_modules/jszip/dist/jszip.min.js', 'dist/vendor/jszip.min.js');
await copyFile('node_modules/pdfjs-dist/build/pdf.min.mjs', 'dist/vendor/pdf.min.mjs');
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'dist/vendor/pdf.worker.min.mjs');
await copyFile('node_modules/xlsx/dist/xlsx.full.min.js', 'dist/vendor/xlsx.full.min.js');
await copyFile('node_modules/html2canvas/dist/html2canvas.min.js', 'dist/vendor/html2canvas.min.js');
await copyFile('node_modules/jspdf/dist/jspdf.umd.min.js', 'dist/vendor/jspdf.umd.min.js');

console.log('RipScan local OCR, PDF, ZIP, DOCX and spreadsheet runtime assets bundled');
