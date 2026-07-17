import { readFile, writeFile } from 'node:fs/promises';

function replaceRequired(source, search, replacement, label) {
  source = source.replace(/\r\n/g, '\n');
  const result = source.replace(search, replacement);
  if (result === source) throw new Error(`PDF performance patch failed: ${label}`);
  return result;
}

const runtimePath = 'dist/pdf-tool-runtime.mjs';
let runtime = await readFile(runtimePath, 'utf8');
runtime = replaceRequired(runtime, '  try { canvas.width = 1; canvas.height = 1; } catch {}', '  try { canvas.width = 0; canvas.height = 0; } catch {}', 'PDF canvas release');
await writeFile(runtimePath, runtime, 'utf8');

const uiPath = 'dist/pdf-tools-ui.js';
let ui = await readFile(uiPath, 'utf8');
const branchBlock = [
  "    if (state.tool === 'compress') await runCompress();",
  "    else if (state.tool === 'merge' || state.tool === 'organize') await runMerge();",
  "    else if (state.tool === 'split') await runSplit();",
  "    else if (state.tool === 'pdf-to-jpg' || state.tool === 'pdf-to-png') await runPdfToImage();",
  "    else if (state.tool === 'image-to-pdf') await runImageToPdf();",
  "    else if (state.tool === 'edit') await runEdit();",
].join('\n');
const scheduledBlock = [
  "    const queueType = state.tool === 'edit' ? 'heavy' : 'export';",
  "    const jobId = 'pdf-tool:' + state.tool + ':' + state.files.map(file => file.name + ':' + file.size).join('|');",
  '    const execute = async () => {',
  "      if (state.tool === 'compress') await runCompress();",
  "      else if (state.tool === 'merge' || state.tool === 'organize') await runMerge();",
  "      else if (state.tool === 'split') await runSplit();",
  "      else if (state.tool === 'pdf-to-jpg' || state.tool === 'pdf-to-png') await runPdfToImage();",
  "      else if (state.tool === 'image-to-pdf') await runImageToPdf();",
  "      else if (state.tool === 'edit') await runEdit();",
  '    };',
  '    if (window.RipScanPerformanceRuntime?.scheduler) {',
  '      await window.RipScanPerformanceRuntime.scheduler.schedule(queueType, execute, {',
  '        id: jobId,',
  '        priority: 1,',
  '        signal: state.controller.signal,',
  "        timeoutMs: queueType === 'export' ? 190_000 : 65_000,",
  '      });',
  '    } else await execute();',
].join('\n');
ui = replaceRequired(ui, branchBlock, scheduledBlock, 'shared PDF queue');
ui = replaceRequired(
  ui,
  "  if (!globalThis.JSZip) throw new Error('ZIP_NOT_AVAILABLE');",
  "  if (!globalThis.JSZip) await import('./lazy-libraries.mjs').then(module => module.loadJsZip());\n  if (!globalThis.JSZip) throw new Error('ZIP_NOT_AVAILABLE');",
  'lazy ZIP loading',
);
await writeFile(uiPath, ui, 'utf8');

console.log('RipScan PDF performance patch: shared single export queue, real Abort propagation, lazy ZIP and 0x0 Canvas cleanup');
