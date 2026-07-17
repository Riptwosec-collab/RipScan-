import { normalizeDocumentModel } from './document-model.mjs';

export const RIPSCAN_PROJECT_VERSION = '1.0.0';
const MANIFEST_PATH = 'manifest.json';
const DOCUMENT_PATH = 'document.json';

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function ensureZip() {
  if (!globalThis.JSZip) throw new Error('โหลดระบบ ZIP ไม่สำเร็จ');
  return globalThis.JSZip;
}

function decodeDataUrl(value) {
  const match = String(value || '').match(/^data:([^;,]+)?(?:;base64)?,(.*)$/u);
  if (!match) return null;
  const binary = atob(match[2] || '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mime: match[1] || 'application/octet-stream', bytes };
}

function extensionForMime(mime) {
  return ({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
  })[mime] || 'bin';
}

function base64FromBytes(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

export async function modelToRipscanBlob(documentModel, options = {}) {
  const JSZip = ensureZip();
  const zip = new JSZip();
  const model = clone(normalizeDocumentModel(documentModel));
  const assets = [];
  let assetSequence = 0;
  for (const page of model.pages || []) {
    if (page.backgroundImage?.startsWith('data:')) {
      const decoded = decodeDataUrl(page.backgroundImage);
      if (decoded) {
        const path = `assets/background-${String(++assetSequence).padStart(4, '0')}.${extensionForMime(decoded.mime)}`;
        zip.file(path, decoded.bytes);
        assets.push({ path, mime: decoded.mime, role: 'page-background', pageId: page.id });
        page.backgroundImage = `ripscan-asset://${path}`;
      }
    }
    for (const block of page.blocks || []) {
      if (block.type !== 'image' || !block.src?.startsWith('data:')) continue;
      const decoded = decodeDataUrl(block.src);
      if (!decoded) continue;
      const path = `assets/image-${String(++assetSequence).padStart(4, '0')}.${extensionForMime(decoded.mime)}`;
      zip.file(path, decoded.bytes);
      assets.push({ path, mime: decoded.mime, role: 'image-block', pageId: page.id, blockId: block.id });
      block.src = `ripscan-asset://${path}`;
    }
  }
  const manifest = {
    format: 'ripscan-project',
    version: RIPSCAN_PROJECT_VERSION,
    documentModelVersion: model.version,
    name: model.name,
    createdAt: new Date().toISOString(),
    sourceFormat: model.metadata?.sourceFormat || model.sourceType || 'unknown',
    pages: model.pages.length,
    assets,
    exportSettings: options.exportSettings || model.metadata?.exportSettings || {},
    compatibilityReport: options.compatibilityReport || null,
  };
  zip.file(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  zip.file(DOCUMENT_PATH, JSON.stringify(model, null, 2));
  if (options.includeThumbnails) {
    for (const [index, thumbnail] of (options.thumbnails || []).entries()) {
      if (thumbnail instanceof Blob) zip.file(`thumbnails/page-${String(index + 1).padStart(3, '0')}.png`, thumbnail);
    }
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export async function ripscanBlobToModel(fileOrBlob) {
  const JSZip = ensureZip();
  const zip = await JSZip.loadAsync(fileOrBlob);
  const manifestEntry = zip.file(MANIFEST_PATH);
  const documentEntry = zip.file(DOCUMENT_PATH);
  if (!manifestEntry || !documentEntry) throw new Error('ไฟล์ RipScan Project ไม่สมบูรณ์');
  const manifest = JSON.parse(await manifestEntry.async('text'));
  if (manifest.format !== 'ripscan-project') throw new Error('รูปแบบ Project ไม่ถูกต้อง');
  const model = JSON.parse(await documentEntry.async('text'));
  const urls = [];
  const hydrate = async value => {
    if (!String(value || '').startsWith('ripscan-asset://')) return value;
    const path = String(value).slice('ripscan-asset://'.length);
    const entry = zip.file(path);
    if (!entry) return '';
    const bytes = await entry.async('uint8array');
    const asset = (manifest.assets || []).find(item => item.path === path);
    const mime = asset?.mime || 'application/octet-stream';
    return `data:${mime};base64,${base64FromBytes(bytes)}`;
  };
  for (const page of model.pages || []) {
    page.backgroundImage = await hydrate(page.backgroundImage);
    for (const block of page.blocks || []) if (block.type === 'image') block.src = await hydrate(block.src);
  }
  const normalized = normalizeDocumentModel(model);
  normalized.metadata ||= {};
  normalized.metadata.ripscanProject = {
    version: manifest.version,
    openedAt: new Date().toISOString(),
    originalName: fileOrBlob?.name || manifest.name || 'project.ripscan',
  };
  return { model: normalized, manifest, revoke() { urls.forEach(url => URL.revokeObjectURL(url)); } };
}
