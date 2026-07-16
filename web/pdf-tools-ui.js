import {
  PDF_TOOL_CATALOG,
  buildSplitGroups,
  estimateCompressedSize,
  outputPageFilename,
} from './pdf-utility-core.mjs';
import { PdfPageOrganizer } from './pdf-page-organizer.mjs';
import {
  compressPdf,
  imageFilesToPdf,
  inspectPdfFile,
  mergePdfSources,
  packageImageResults,
  renderPdfPages,
  splitPdf,
} from './pdf-tool-runtime.mjs';
import {
  attachSourceMetadata,
  exportOriginalFormat,
  roundTripReport,
} from './roundtrip-export.mjs';
import { modelToRipscanBlob, ripscanBlobToModel } from './ripscan-project.mjs';
import { createImageBlock, createShapeBlock, createTextBlock } from './document-model.mjs';
import { downloadBlob, safeFilename } from './editor-export.mjs';

const VERSION = '4.0.0';
const state = {
  tool: '',
  files: [],
  organizer: new PdfPageOrganizer(),
  metadata: [],
  controller: null,
  originalPdfFile: null,
  busy: false,
  draggedIndex: -1,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const formatBytes = bytes => {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(2)} MB`;
};

function studioApi() {
  if (!globalThis.RipScanDocumentStudio) throw new Error('Document Studio ยังไม่พร้อม');
  return globalThis.RipScanDocumentStudio;
}

function activeModelPage() {
  const model = studioApi().getModel?.();
  if (!model) return null;
  const active = Number($('.studio-page-thumb.active')?.dataset.pageIndex || 0);
  return model.pages?.[active] || model.pages?.[0] || null;
}

function updateModel(model) {
  studioApi().openModel(model);
}

function ensureUi() {
  const center = $('#convertCenter .convert-center-card');
  if (!center || $('#pdfToolsSection')) return false;
  const section = document.createElement('section');
  section.id = 'pdfToolsSection';
  section.className = 'pdf-tools-section';
  section.innerHTML = `
    <header class="pdf-tools-heading"><div><strong>PDF Tools</strong><small>ประมวลผลใน Browser · Worker Queue · ไม่เก็บไฟล์บน Server</small></div><span>RipScan ${VERSION}</span></header>
    <div class="pdf-tool-cards">${PDF_TOOL_CATALOG.map(tool => `<button type="button" class="pdf-tool-card" data-pdf-tool="${tool.id}"><span>${tool.id === 'compress' ? '↘' : tool.id === 'merge' ? '⊕' : tool.id === 'split' ? '✂' : tool.id === 'edit' ? '✎' : tool.id.includes('png') || tool.id.includes('jpg') ? '▧' : '▤'}</span><div><strong>${tool.label}</strong><small>${tool.description}</small><em>${tool.accept}</em></div></button>`).join('')}</div>
    <div id="pdfToolWorkspace" class="pdf-tool-workspace" hidden></div>
    <div class="roundtrip-panel">
      <div><strong>Round-Trip Export</strong><small id="roundTripSource">เปิดเอกสารใน Document Studio เพื่อส่งออกเป็นรูปแบบเดิม</small></div>
      <div class="roundtrip-actions"><button type="button" data-roundtrip-action="original">ส่งออกเป็นรูปแบบเดิม</button><button type="button" data-roundtrip-action="report">Compatibility Report</button><button type="button" data-roundtrip-action="save-project">ดาวน์โหลดโปรเจกต์ RipScan</button><button type="button" data-roundtrip-action="open-project">เปิดโปรเจกต์ RipScan</button></div>
      <div id="roundTripReport" class="roundtrip-report" hidden></div>
    </div>
    <input id="pdfToolFileInput" type="file" hidden multiple>
    <input id="ripscanProjectInput" type="file" accept=".ripscan,.zip,application/zip" hidden>
    <input id="pdfSignatureInput" type="file" accept="image/png,image/jpeg,image/webp" hidden>
  `;
  const progress = $('.convert-progress', center);
  center.insertBefore(section, progress || center.querySelector('footer'));
  section.addEventListener('click', handleClick);
  section.addEventListener('change', handleChange);
  section.addEventListener('input', handleInput);
  $('#pdfToolFileInput').addEventListener('change', event => loadToolFiles(event.target.files));
  $('#ripscanProjectInput').addEventListener('change', event => openProject(event.target.files?.[0]));
  $('#pdfSignatureInput').addEventListener('change', event => addSignature(event.target.files?.[0]));
  installAnnotationTools();
  refreshRoundTripSource();
  return true;
}

function refreshRoundTripSource() {
  const model = globalThis.RipScanDocumentStudio?.getModel?.();
  const label = $('#roundTripSource');
  if (!label) return;
  label.textContent = model
    ? `${model.name} · ต้นฉบับ ${model.metadata?.sourceFormat || model.sourceType || 'ไม่ทราบ'} · ${model.pages?.length || 0} หน้า`
    : 'เปิดเอกสารใน Document Studio เพื่อส่งออกเป็นรูปแบบเดิม';
}

function fileAccept(tool) {
  return PDF_TOOL_CATALOG.find(item => item.id === tool)?.accept || '.pdf';
}

function openTool(tool) {
  state.tool = tool;
  state.files = [];
  state.metadata = [];
  state.organizer = new PdfPageOrganizer();
  const input = $('#pdfToolFileInput');
  input.accept = fileAccept(tool);
  input.multiple = ['merge', 'image-to-pdf'].includes(tool);
  const workspace = $('#pdfToolWorkspace');
  workspace.hidden = false;
  workspace.innerHTML = toolWorkspaceHtml(tool);
  installDropZone(workspace);
}

function toolWorkspaceHtml(tool) {
  const title = PDF_TOOL_CATALOG.find(item => item.id === tool)?.label || tool;
  const common = `<header><div><strong>${title}</strong><small>ไฟล์ทำงานเฉพาะใน Browser</small></div><button type="button" data-pdf-action="close-workspace">×</button></header><button type="button" class="pdf-drop-zone" data-pdf-action="choose-files"><strong>ลากไฟล์มาวาง หรือคลิกเพื่อเลือก</strong><small>${escapeHtml(fileAccept(tool))}</small></button><div id="pdfToolFileSummary" class="pdf-tool-file-summary"></div>`;
  if (tool === 'compress') return `${common}<div class="pdf-tool-options"><label>ระดับ<select id="pdfCompressionLevel"><option value="low">ต่ำ — รักษาคุณภาพสูง</option><option value="standard" selected>มาตรฐาน</option><option value="high">สูง — ขนาดเล็กมาก</option><option value="custom">กำหนดเอง</option></select></label><label>คุณภาพภาพ <output id="pdfCompressionQualityValue">78%</output><input id="pdfCompressionQuality" type="range" min="10" max="100" value="78"></label><label>DPI<input id="pdfCompressionDpi" type="number" min="72" max="600" value="150"></label><label><input id="pdfPreserveTextLayer" type="checkbox" checked> รักษา Text Layer</label><label><input id="pdfRemoveMetadata" type="checkbox" checked> ลบ Metadata ที่ไม่จำเป็น</label><label><input id="pdfGrayscale" type="checkbox"> Grayscale</label></div><p class="pdf-warning">การบีบอัดระดับสูงจะ Render หน้าใหม่และอาจลดความคมชัดของเอกสารสแกน</p>${runFooter('เริ่มบีบอัด')}`;
  if (tool === 'merge' || tool === 'organize') return `${common}<div class="organizer-toolbar"><button type="button" data-organizer-action="select-all">เลือกทั้งหมด</button><button type="button" data-organizer-action="rotate-left">หมุนซ้าย</button><button type="button" data-organizer-action="rotate-right">หมุนขวา</button><button type="button" data-organizer-action="duplicate">ทำสำเนา</button><button type="button" data-organizer-action="delete">ลบ</button><button type="button" data-organizer-action="undo">Undo</button><button type="button" data-organizer-action="redo">Redo</button></div><div id="pdfOrganizer" class="pdf-organizer"></div>${runFooter(tool === 'merge' ? 'รวม PDF' : 'สร้าง PDF ที่จัดเรียงแล้ว')}`;
  if (tool === 'split') return `${common}<div class="pdf-tool-options"><label>วิธีแยก<select id="pdfSplitMode"><option value="every-page">แยกทุกหน้า</option><option value="ranges">แยกตามช่วงหน้า</option><option value="every-n">แยกทุก N หน้า</option><option value="even">หน้าคู่</option><option value="odd">หน้าคี่</option></select></label><label>ช่วงหน้า<input id="pdfSplitRanges" type="text" placeholder="1-3, 4-7, 8"></label><label>ทุก N หน้า<input id="pdfSplitEveryN" type="number" min="1" value="2"></label></div>${runFooter('แยก PDF')}`;
  if (tool === 'pdf-to-jpg' || tool === 'pdf-to-png') return `${common}<div class="pdf-tool-options"><label>ช่วงหน้า<input id="pdfImageRanges" type="text" placeholder="ว่าง = ทุกหน้า"></label><label>DPI<select id="pdfImageDpi"><option>72</option><option>96</option><option selected>150</option><option>200</option><option>300</option><option>600</option></select></label><label>กว้าง<input id="pdfImageWidth" type="number" min="1" placeholder="อัตโนมัติ"></label><label>สูง<input id="pdfImageHeight" type="number" min="1" placeholder="อัตโนมัติ"></label><label>คุณภาพ JPG<input id="pdfImageQuality" type="range" min="10" max="100" value="92"></label><label><input id="pdfImageTransparent" type="checkbox"> โปร่งใสสำหรับ PNG</label></div>${runFooter(`แปลงเป็น ${tool.endsWith('jpg') ? 'JPG' : 'PNG'}`)}`;
  if (tool === 'image-to-pdf') return `${common}<div id="pdfImageOrder" class="pdf-image-order"></div><div class="pdf-tool-options"><label>ขนาดหน้า<select id="imagePdfPageSize"><option value="A4">A4</option><option value="A5">A5</option><option value="Letter">Letter</option><option value="Legal">Legal</option><option value="fit-image">ตามขนาดรูป</option><option value="custom">กำหนดเอง</option></select></label><label>Fit<select id="imagePdfFit"><option value="contain">Contain</option><option value="cover">Cover</option><option value="stretch">Stretch</option></select></label><label>Margin<input id="imagePdfMargin" type="number" min="0" value="24"></label><label>พื้นหลัง<input id="imagePdfBackground" type="color" value="#ffffff"></label><label><input id="imagePdfAutoOrientation" type="checkbox" checked> Auto Orientation</label><label><input id="imagePdfPageNumbers" type="checkbox"> ใส่เลขหน้า</label></div>${runFooter('สร้าง PDF')}`;
  if (tool === 'edit') return `${common}<div class="pdf-editor-help"><strong>ใช้ Document Studio เดิม</strong><p>PDF ที่มี Text Layer จะสร้าง Positioned Text Blocks ส่วน PDF สแกนจะใช้ OCR Pipeline เดิมและเก็บจุดที่ไม่มั่นใจไว้ Review</p></div>${runFooter('เปิดแก้ไข PDF')}`;
  return common;
}

function runFooter(label) {
  return `<div class="pdf-tool-progress"><progress id="pdfToolProgress" max="100" value="0"></progress><span id="pdfToolProgressText">พร้อมทำงาน</span></div><footer><button type="button" data-pdf-action="cancel" disabled>ยกเลิก</button><button type="button" class="studio-primary" data-pdf-action="run">${label}</button></footer>`;
}

function installDropZone(workspace) {
  const zone = $('.pdf-drop-zone', workspace);
  for (const type of ['dragenter', 'dragover']) zone?.addEventListener(type, event => { event.preventDefault(); zone.classList.add('dragging'); });
  for (const type of ['dragleave', 'drop']) zone?.addEventListener(type, event => { event.preventDefault(); zone.classList.remove('dragging'); });
  zone?.addEventListener('drop', event => loadToolFiles(event.dataTransfer?.files));
}

async function loadToolFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  state.files = files;
  state.metadata = [];
  state.organizer = new PdfPageOrganizer();
  setProgress(0, 'กำลังอ่าน Metadata…');
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (file.type === 'application/pdf' || /\.pdf$/iu.test(file.name)) {
        const metadata = await inspectPdfFile(file, { onProgress: message => setProgress(Math.round((index + (message.completed || 0) / Math.max(1, message.total || 1)) / files.length * 100), message.label) });
        state.metadata.push(metadata);
        state.organizer.appendSource({ sourceId: `${index}:${file.name}`, sourceIndex: index, name: file.name, pageCount: metadata.pageCount, kind: 'pdf' });
      } else {
        state.metadata.push({ pageCount: 1, image: true });
        state.organizer.appendSource({ sourceId: `${index}:${file.name}`, sourceIndex: index, name: file.name, pageCount: 1, kind: 'image' });
      }
    }
    if (state.tool === 'edit') state.originalPdfFile = files[0];
    renderFileSummary();
    renderOrganizer();
    renderImageOrder();
    setProgress(0, 'พร้อมทำงาน');
  } catch (error) {
    setProgress(0, thaiError(error));
  }
}

function renderFileSummary() {
  const box = $('#pdfToolFileSummary');
  if (!box) return;
  box.innerHTML = state.files.map((file, index) => `<article><strong>${escapeHtml(file.name)}</strong><span>${formatBytes(file.size)}</span><small>${state.metadata[index]?.pageCount || 1} หน้า</small></article>`).join('');
  if (state.tool === 'compress' && state.files[0]) {
    const estimate = estimateCompressedSize(state.files[0].size, state.metadata[0]?.pageCount || 1, compressionOptions());
    box.insertAdjacentHTML('beforeend', `<article class="estimate"><strong>ประมาณการหลังบีบอัด</strong><span>${formatBytes(estimate)}</span><small>ค่าประมาณก่อนประมวลผลจริง</small></article>`);
  }
}

function organizerSelectedIds() {
  return $$('#pdfOrganizer input[data-organizer-select]:checked').map(input => input.dataset.organizerSelect);
}

function renderOrganizer() {
  const box = $('#pdfOrganizer');
  if (!box) return;
  box.innerHTML = state.organizer.activeItems().map((item, index) => `<article class="pdf-organizer-item" draggable="true" data-organizer-index="${index}" data-organizer-id="${item.id}"><input type="checkbox" data-organizer-select="${item.id}" ${item.selected ? 'checked' : ''}><span class="page-placeholder">${item.pageIndex + 1}</span><div><strong>${escapeHtml(item.name)}</strong><small>หมุน ${item.rotation}°</small></div><em>⋮⋮</em></article>`).join('');
  $$('.pdf-organizer-item', box).forEach(item => {
    item.addEventListener('dragstart', () => { state.draggedIndex = Number(item.dataset.organizerIndex); });
    item.addEventListener('dragover', event => event.preventDefault());
    item.addEventListener('drop', event => { event.preventDefault(); state.organizer.reorder(state.draggedIndex, Number(item.dataset.organizerIndex)); renderOrganizer(); });
  });
}

function renderImageOrder() {
  const box = $('#pdfImageOrder');
  if (!box) return;
  box.innerHTML = state.files.map((file, index) => `<article draggable="true" data-image-index="${index}"><strong>${index + 1}. ${escapeHtml(file.name)}</strong><span>${formatBytes(file.size)}</span></article>`).join('');
  $$('#pdfImageOrder article').forEach(item => {
    item.addEventListener('dragstart', () => { state.draggedIndex = Number(item.dataset.imageIndex); });
    item.addEventListener('dragover', event => event.preventDefault());
    item.addEventListener('drop', event => {
      event.preventDefault();
      const to = Number(item.dataset.imageIndex);
      const [file] = state.files.splice(state.draggedIndex, 1);
      state.files.splice(to, 0, file);
      renderImageOrder();
      renderFileSummary();
    });
  });
}

function compressionOptions() {
  return {
    level: $('#pdfCompressionLevel')?.value || 'standard',
    quality: Number($('#pdfCompressionQuality')?.value || 78) / 100,
    dpi: Number($('#pdfCompressionDpi')?.value || 150),
    preserveTextLayer: $('#pdfPreserveTextLayer')?.checked !== false,
    removeMetadata: $('#pdfRemoveMetadata')?.checked !== false,
    grayscale: Boolean($('#pdfGrayscale')?.checked),
  };
}

function setProgress(percent, label) {
  const progress = $('#pdfToolProgress');
  const text = $('#pdfToolProgressText');
  if (progress) progress.value = Math.max(0, Math.min(100, Number(percent) || 0));
  if (text) text.textContent = label;
}

function jobProgress(message) {
  const percent = Math.round(Number(message.completed || 0) / Math.max(1, Number(message.total || 1)) * 100);
  setProgress(percent, `${message.label || 'กำลังประมวลผล'} · ${percent}%`);
}

async function runTool() {
  if (state.busy) return;
  if (!state.files.length) return $('#pdfToolFileInput').click();
  state.busy = true;
  state.controller = new AbortController();
  $('[data-pdf-action="run"]')?.setAttribute('disabled', '');
  $('[data-pdf-action="cancel"]')?.removeAttribute('disabled');
  try {
    if (state.tool === 'compress') await runCompress();
    else if (state.tool === 'merge' || state.tool === 'organize') await runMerge();
    else if (state.tool === 'split') await runSplit();
    else if (state.tool === 'pdf-to-jpg' || state.tool === 'pdf-to-png') await runPdfToImage();
    else if (state.tool === 'image-to-pdf') await runImageToPdf();
    else if (state.tool === 'edit') await runEdit();
    setProgress(100, 'ดำเนินการเสร็จแล้ว');
  } catch (error) {
    setProgress(0, thaiError(error));
  } finally {
    state.busy = false;
    state.controller = null;
    $('[data-pdf-action="run"]')?.removeAttribute('disabled');
    $('[data-pdf-action="cancel"]')?.setAttribute('disabled', '');
  }
}

async function runCompress() {
  const result = await compressPdf(state.files[0], { ...compressionOptions(), signal: state.controller.signal, onProgress: jobProgress });
  const name = `${safeFilename(state.files[0].name.replace(/\.pdf$/iu, ''))}-compressed.pdf`;
  downloadBlob(result.blob, name);
  const report = result.report;
  $('#pdfToolFileSummary')?.insertAdjacentHTML('beforeend', `<article class="result"><strong>ขนาดใหม่ ${formatBytes(report.outputBytes)}</strong><span>ลดลง ${formatBytes(report.savedBytes)} (${report.savedPercent.toFixed(1)}%)</span><small>${result.preserveTextLayer ? 'รักษา Text Layer' : 'Render เป็นภาพ — Text Layer ไม่ถูกเก็บ'}</small></article>`);
}

async function runMerge() {
  const blob = await mergePdfSources(state.files, state.organizer.activeItems(), { signal: state.controller.signal, onProgress: jobProgress });
  downloadBlob(blob, 'ripscan-merged.pdf');
}

async function runSplit() {
  const count = state.metadata[0]?.pageCount || 0;
  const mode = $('#pdfSplitMode')?.value || 'every-page';
  const groups = buildSplitGroups(mode, count, { ranges: $('#pdfSplitRanges')?.value, everyN: Number($('#pdfSplitEveryN')?.value || 2) });
  const outputs = await splitPdf(state.files[0], groups, { signal: state.controller.signal, onProgress: jobProgress });
  if (outputs.length === 1) return downloadBlob(outputs[0].blob, outputs[0].filename);
  if (!globalThis.JSZip) throw new Error('ZIP_NOT_AVAILABLE');
  const zip = new globalThis.JSZip();
  outputs.forEach(output => zip.file(output.filename, output.blob));
  downloadBlob(await zip.generateAsync({ type: 'blob' }), `${safeFilename(state.files[0].name.replace(/\.pdf$/iu, ''))}-split.zip`);
}

async function runPdfToImage() {
  const count = state.metadata[0]?.pageCount || 0;
  const ranges = $('#pdfImageRanges')?.value?.trim();
  const selectedPages = ranges ? buildSplitGroups('ranges', count, { ranges }).flat() : null;
  const extension = state.tool.endsWith('jpg') ? 'jpg' : 'png';
  const rendered = await renderPdfPages(state.files[0], {
    format: extension,
    selectedPages,
    dpi: Number($('#pdfImageDpi')?.value || 150),
    width: Number($('#pdfImageWidth')?.value || 0),
    height: Number($('#pdfImageHeight')?.value || 0),
    keepAspect: true,
    quality: Number($('#pdfImageQuality')?.value || 92) / 100,
    transparent: extension === 'png' && Boolean($('#pdfImageTransparent')?.checked),
    signal: state.controller.signal,
    onProgress: jobProgress,
  });
  const packaged = await packageImageResults(rendered, state.files[0].name, extension);
  downloadBlob(packaged.blob, packaged.filename);
}

async function runImageToPdf() {
  const blob = await imageFilesToPdf(state.files, {
    pageSize: $('#imagePdfPageSize')?.value || 'A4',
    fit: $('#imagePdfFit')?.value || 'contain',
    margin: Number($('#imagePdfMargin')?.value || 0),
    background: $('#imagePdfBackground')?.value || '#ffffff',
    autoOrientation: $('#imagePdfAutoOrientation')?.checked !== false,
    pageNumbers: Boolean($('#imagePdfPageNumbers')?.checked),
    signal: state.controller.signal,
    onProgress: jobProgress,
  });
  downloadBlob(blob, 'ripscan-images.pdf');
}

async function runEdit() {
  const file = state.files[0];
  state.originalPdfFile = file;
  await studioApi().importFiles([file]);
  const current = studioApi().getModel();
  if (current) updateModel(attachSourceMetadata(current, file, { sourceFormat: 'pdf', importAdapter: 'pdfjs-text-layer', preferredRoundTripFormat: 'pdf' }));
  $('#convertCenter').hidden = true;
}

function handleClick(event) {
  const tool = event.target.closest('[data-pdf-tool]')?.dataset.pdfTool;
  if (tool) return openTool(tool);
  const pdfAction = event.target.closest('[data-pdf-action]')?.dataset.pdfAction;
  if (pdfAction === 'choose-files') return $('#pdfToolFileInput').click();
  if (pdfAction === 'close-workspace') { $('#pdfToolWorkspace').hidden = true; return; }
  if (pdfAction === 'run') return runTool();
  if (pdfAction === 'cancel') { state.controller?.abort(); setProgress(0, 'ผู้ใช้ยกเลิก'); return; }
  const organizerAction = event.target.closest('[data-organizer-action]')?.dataset.organizerAction;
  if (organizerAction) return handleOrganizerAction(organizerAction);
  const roundtrip = event.target.closest('[data-roundtrip-action]')?.dataset.roundtripAction;
  if (roundtrip) return handleRoundTrip(roundtrip);
}

function handleChange(event) {
  if (event.target.matches('[data-organizer-select]')) state.organizer.select([event.target.dataset.organizerSelect], event.target.checked);
  if (event.target.id === 'pdfCompressionLevel') {
    const presets = { low: [92, 220, true], standard: [78, 150, true], high: [58, 110, false] };
    const preset = presets[event.target.value];
    if (preset) { $('#pdfCompressionQuality').value = preset[0]; $('#pdfCompressionDpi').value = preset[1]; $('#pdfPreserveTextLayer').checked = preset[2]; $('#pdfCompressionQualityValue').textContent = `${preset[0]}%`; renderFileSummary(); }
  }
}

function handleInput(event) {
  if (event.target.id === 'pdfCompressionQuality') { $('#pdfCompressionQualityValue').textContent = `${event.target.value}%`; renderFileSummary(); }
}

function handleOrganizerAction(action) {
  const ids = organizerSelectedIds();
  if (action === 'select-all') state.organizer.selectAll(true);
  if (action === 'rotate-left') state.organizer.rotate(ids, -90);
  if (action === 'rotate-right') state.organizer.rotate(ids, 90);
  if (action === 'duplicate') state.organizer.duplicate(ids);
  if (action === 'delete') state.organizer.remove(ids);
  if (action === 'undo') state.organizer.undo();
  if (action === 'redo') state.organizer.redo();
  renderOrganizer();
}

async function handleRoundTrip(action) {
  try {
    const model = studioApi().getModel?.();
    if (!model && action !== 'open-project') throw new Error('กรุณาเปิดเอกสารใน Document Studio ก่อน');
    if (action === 'report') {
      const report = roundTripReport(model);
      const box = $('#roundTripReport');
      box.hidden = false;
      box.innerHTML = `<strong>รักษาหน้าตาโดยประมาณ ${report.summary.overallPercent}%</strong><p>ข้อความแก้ไขได้ ${report.summary.editableTextBlocks} Blocks · ตาราง ${report.summary.editableTables} · รูป ${report.summary.imageObjects} · Fallback ${report.summary.fallbackElements}</p>${report.compatibility.warnings.length ? `<ul>${report.compatibility.warnings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>ไม่พบคำเตือนสำคัญ</p>'}`;
    }
    if (action === 'save-project') downloadBlob(await modelToRipscanBlob(model, { compatibilityReport: roundTripReport(model) }), `${safeFilename(model.name)}.ripscan`);
    if (action === 'open-project') $('#ripscanProjectInput').click();
    if (action === 'original') {
      const format = model.metadata?.preferredRoundTripFormat || model.metadata?.sourceFormat || model.sourceType || 'pdf';
      const result = await exportOriginalFormat(model, { format, originalFile: format === 'pdf' ? state.originalPdfFile : null, onProgress: jobProgress });
      downloadBlob(result.blob, `${safeFilename(model.name.replace(/\.[^.]+$/u, ''))}.${result.extension}`);
      const box = $('#roundTripReport'); box.hidden = false; box.innerHTML = `<strong>ส่งออก ${result.extension.toUpperCase()} สำเร็จ</strong><p>Fidelity โดยประมาณ ${result.report.summary.overallPercent}% · Fallback ${result.report.summary.fallbackElements} จุด</p>`;
    }
  } catch (error) {
    $('#roundTripReport').hidden = false;
    $('#roundTripReport').textContent = thaiError(error);
  }
}

async function openProject(file) {
  if (!file) return;
  try {
    const result = await ripscanBlobToModel(file);
    updateModel(result.model);
    $('#convertCenter').hidden = true;
  } catch (error) {
    $('#roundTripReport').hidden = false;
    $('#roundTripReport').textContent = thaiError(error);
  }
}

function installAnnotationTools() {
  const toolbar = $('#documentStudio .studio-toolbar');
  if (!toolbar || toolbar.querySelector('[data-pdf-annotation]')) return;
  const group = document.createElement('span');
  group.className = 'pdf-annotation-tools';
  group.innerHTML = `<button type="button" data-pdf-annotation="highlight">Highlight</button><button type="button" data-pdf-annotation="rectangle">กรอบ</button><button type="button" data-pdf-annotation="line">เส้น</button><button type="button" data-pdf-annotation="arrow">ลูกศร</button><button type="button" data-pdf-annotation="whiteout" title="ปิดทับภาพเท่านั้น ไม่ใช่ Secure Redaction">Whiteout</button><button type="button" data-pdf-annotation="page-number">เลขหน้า</button><button type="button" data-pdf-annotation="header">Header</button><button type="button" data-pdf-annotation="footer">Footer</button><button type="button" data-pdf-annotation="signature">ลายเซ็น</button>`;
  toolbar.insertBefore(group, toolbar.querySelector('[data-studio-action="convert"]'));
  group.addEventListener('click', event => {
    const action = event.target.closest('[data-pdf-annotation]')?.dataset.pdfAnnotation;
    if (action) addAnnotation(action);
  });
}

function addAnnotation(action) {
  if (action === 'signature') return $('#pdfSignatureInput').click();
  const model = studioApi().getModel?.();
  const page = activeModelPage();
  if (!model || !page) return;
  if (action === 'page-number') page.blocks.push(createTextBlock({ role: 'footer', x: page.width / 2 - 30, y: page.height - 36, width: 60, height: 24, text: String(page.number || 1), style: { fontSize: 12, textAlign: 'center', backgroundColor: 'transparent' }, source: 'pdf-annotation' }));
  else if (action === 'header') page.blocks.push(createTextBlock({ role: 'header', x: 40, y: 18, width: page.width - 80, height: 30, text: 'Header', style: { fontSize: 12, textAlign: 'center', backgroundColor: 'transparent' }, source: 'pdf-annotation' }));
  else if (action === 'footer') page.blocks.push(createTextBlock({ role: 'footer', x: 40, y: page.height - 44, width: page.width - 80, height: 30, text: 'Footer', style: { fontSize: 12, textAlign: 'center', backgroundColor: 'transparent' }, source: 'pdf-annotation' }));
  else {
    const styles = {
      highlight: { shape: 'rectangle', fill: '#fde047', stroke: '#eab308', strokeWidth: 1, opacity: .35 },
      rectangle: { shape: 'rectangle', fill: 'transparent', stroke: '#ef4444', strokeWidth: 2 },
      line: { shape: 'line', fill: 'transparent', stroke: '#2563eb', strokeWidth: 2 },
      arrow: { shape: 'arrow', fill: '#2563eb', stroke: '#2563eb', strokeWidth: 2 },
      whiteout: { shape: 'rectangle', fill: '#ffffff', stroke: '#ffffff', strokeWidth: 0, overlayOnly: true },
    }[action];
    page.blocks.push(createShapeBlock({ x: 80, y: 80, width: 220, height: action === 'line' || action === 'arrow' ? 40 : 80, shape: styles.shape, style: styles, source: action === 'whiteout' ? 'visual-redaction-overlay' : 'pdf-annotation', metadata: action === 'whiteout' ? { secureRedaction: false, warning: 'ปิดทับภาพเท่านั้น' } : {} }));
  }
  updateModel(model);
}

async function addSignature(file) {
  if (!file) return;
  const model = studioApi().getModel?.();
  const page = activeModelPage();
  if (!model || !page) return;
  const src = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
  page.blocks.push(createImageBlock({ x: 80, y: page.height - 160, width: 220, height: 100, src, alt: 'ลายเซ็น', fit: 'contain', source: 'signature-image' }));
  updateModel(model);
}

function thaiError(error) {
  const text = String(error?.message || error || 'ดำเนินการไม่สำเร็จ');
  if (error?.name === 'AbortError' || text.includes('CANCELLED')) return 'ผู้ใช้ยกเลิก';
  if (text.includes('PDF_PASSWORD_REQUIRED')) return 'PDF มีรหัสผ่าน กรุณาใส่รหัสผ่านก่อนเปิดไฟล์';
  if (text.includes('PDF_INVALID_HEADER')) return 'ไฟล์นี้ไม่ใช่ PDF ที่ถูกต้อง';
  if (text.includes('PDF_EOF_NOT_FOUND')) return 'PDF อาจเสียหายหรือดาวน์โหลดมาไม่ครบ';
  if (text.includes('PDF_TOO_LARGE')) return 'ไฟล์ใหญ่เกินค่าที่ระบบกำหนด';
  if (text.includes('PAGE_OUT_OF_RANGE')) return 'หมายเลขหน้าเกินจำนวนหน้าของเอกสาร';
  if (text.includes('REVERSED_PAGE_RANGE')) return 'ช่วงหน้าต้องเรียงจากน้อยไปมาก';
  if (text.includes('DUPLICATE_PAGE')) return 'พบหมายเลขหน้าซ้ำ กรุณาตรวจช่วงหน้า';
  if (text.includes('memory') || text.includes('allocation')) return 'หน่วยความจำไม่เพียงพอ กรุณาลด DPI หรือเลือกหน้าจำนวนน้อยลง';
  return text;
}

const observer = new MutationObserver(() => {
  ensureUi();
  installAnnotationTools();
  refreshRoundTripSource();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
ensureUi();
installAnnotationTools();
document.documentElement.dataset.pdfToolsVersion = VERSION;
