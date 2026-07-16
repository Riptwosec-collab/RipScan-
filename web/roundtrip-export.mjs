import { compatibilityReport, fidelityScore, sourceFormatMetadata } from './pdf-utility-core.mjs';
import { exportEditablePdf } from './pdf-tool-runtime.mjs';
import { modelToXlsxBlob } from './editor-export.mjs';
import { modelToRipscanBlob } from './ripscan-project.mjs';

export const ROUNDTRIP_VERSION = '4.0.0';

function ensureZip() {
  if (!globalThis.JSZip) throw new Error('โหลดระบบ ZIP ไม่สำเร็จ');
  return globalThis.JSZip;
}

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function xml(value) {
  return String(value ?? '').replace(/[<>&"']/gu, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '');
}

function decodeDataUrl(value) {
  const match = String(value || '').match(/^data:([^;,]+)?(?:;base64)?,(.*)$/u);
  if (!match) return null;
  const binary = atob(match[2] || '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mime: match[1] || 'application/octet-stream', bytes };
}

function officeColor(value, fallback = '111827') {
  const clean = String(value || '').replace('#', '');
  return /^[0-9a-f]{6}$/iu.test(clean) ? clean.toUpperCase() : fallback;
}

export function attachSourceMetadata(documentModel, file, overrides = {}) {
  const model = clone(documentModel);
  model.metadata ||= {};
  Object.assign(model.metadata, sourceFormatMetadata(file, overrides));
  for (const [pageIndex, page] of (model.pages || []).entries()) {
    page.metadata ||= {};
    page.metadata.sourcePageIndex ??= pageIndex;
    page.visualReference ||= {
      backgroundImage: page.backgroundImage || '',
      sourcePageSize: { width: page.width, height: page.height },
      originalLayoutMap: [],
    };
    for (const [blockIndex, block] of (page.blocks || []).entries()) {
      block.metadata ||= {};
      block.metadata.sourceFormat ||= model.metadata.sourceFormat;
      block.metadata.sourceElementType ||= block.source || `${model.metadata.sourceFormat}_${block.type}`;
      block.metadata.sourceElementId ||= `${pageIndex + 1}:${blockIndex + 1}:${block.id}`;
      if (block.type === 'text' && block.metadata.originalText === undefined) block.metadata.originalText = block.text;
    }
  }
  return model;
}

export function roundTripReport(documentModel, targetFormat = '') {
  const compatibility = compatibilityReport(documentModel, targetFormat);
  const fidelity = fidelityScore(documentModel);
  return {
    version: ROUNDTRIP_VERSION,
    sourceFormat: documentModel?.metadata?.sourceFormat || documentModel?.sourceType || 'unknown',
    targetFormat: compatibility.targetFormat,
    compatibility,
    fidelity,
    summary: {
      editableTextBlocks: compatibility.counts.text || 0,
      editableTables: compatibility.counts.table || 0,
      imageObjects: compatibility.counts.image || 0,
      shapes: compatibility.counts.shape || 0,
      fallbackElements: compatibility.fallbacks.length,
      overallPercent: Math.round(fidelity.overallScore * 100),
    },
  };
}

function docxRun(text, style = {}) {
  const size = Math.round((Number(style.fontSize) || 16) * 1.5);
  return `<w:r><w:rPr>${Number(style.fontWeight) >= 600 ? '<w:b/>' : ''}${style.fontStyle === 'italic' ? '<w:i/>' : ''}${style.textDecoration === 'underline' ? '<w:u w:val="single"/>' : ''}<w:color w:val="${officeColor(style.color)}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:rFonts w:ascii="Noto Sans Thai" w:hAnsi="Noto Sans Thai" w:eastAsia="Noto Sans Thai" w:cs="Noto Sans Thai"/></w:rPr><w:t xml:space="preserve">${xml(text || ' ')}</w:t></w:r>`;
}

function docxParagraph(block) {
  const alignment = ({ center: 'center', right: 'right', justify: 'both' })[block.style?.textAlign] || 'left';
  return String(block.text ?? block.value ?? '').split('\n').map(line => `<w:p><w:pPr><w:jc w:val="${alignment}"/></w:pPr>${docxRun(line, block.style)}</w:p>`).join('');
}

function docxTable(block) {
  const rows = Array.from({ length: block.rows }, (_, row) => {
    const cells = (block.cells || []).filter(cell => !cell.hidden && cell.row === row).sort((a, b) => a.column - b.column).map(cell => {
      const tcPr = `<w:tcPr>${cell.columnSpan > 1 ? `<w:gridSpan w:val="${cell.columnSpan}"/>` : ''}${cell.rowSpan > 1 ? '<w:vMerge w:val="restart"/>' : ''}<w:shd w:fill="${officeColor(cell.style?.backgroundColor, 'FFFFFF')}"/></w:tcPr>`;
      const paragraphs = String(cell.text || '').split('\n').map(line => `<w:p>${docxRun(line, cell.style)}</w:p>`).join('');
      return `<w:tc>${tcPr}${paragraphs || `<w:p>${docxRun(' ', cell.style)}</w:p>`}</w:tc>`;
    }).join('');
    return `<w:tr>${cells}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${rows}</w:tbl>`;
}

function docxImageXml(relationshipId, block, documentId) {
  const cx = Math.max(1, Math.round(Number(block.width || 160) * 9525));
  const cy = Math.max(1, Math.round(Number(block.height || 100) * 9525));
  return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${documentId}" name="${xml(block.alt || `Image ${documentId}`)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${xml(block.alt || 'image')}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

export async function modelToRoundTripDocx(documentModel) {
  const JSZip = ensureZip();
  const zip = new JSZip();
  const relationships = [];
  const mediaDefaults = new Set();
  const body = [];
  let relationshipIndex = 1;
  let imageIndex = 1;
  for (const [pageIndex, page] of (documentModel.pages || []).entries()) {
    for (const block of (page.blocks || []).filter(item => !item.hidden).sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (block.type === 'table') body.push(docxTable(block));
      else if (block.type === 'image') {
        const data = decodeDataUrl(block.src);
        if (!data) { body.push(`<w:p>${docxRun(`[รูปภาพ: ${block.alt || 'ไม่พบข้อมูลรูป'}]`)}</w:p>`); continue; }
        const extension = data.mime.includes('png') ? 'png' : 'jpg';
        mediaDefaults.add(extension);
        const filename = `image${imageIndex++}.${extension}`;
        const relationshipId = `rId${relationshipIndex++}`;
        zip.file(`word/media/${filename}`, data.bytes);
        relationships.push(`<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/>`);
        body.push(docxImageXml(relationshipId, block, imageIndex));
      } else if (block.type === 'shape' || block.type === 'line') body.push(`<w:p>${docxRun(`[${block.shape || block.type}]`)}</w:p>`);
      else body.push(docxParagraph(block));
    }
    if (pageIndex < documentModel.pages.length - 1) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  }
  const firstPage = documentModel.pages?.[0] || { width: 794, height: 1123 };
  const pageWidth = Math.round(Number(firstPage.width || 794) * 15);
  const pageHeight = Math.round(Number(firstPage.height || 1123) * 15);
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...mediaDefaults].map(ext => `<Default Extension="${ext}" ContentType="image/${ext === 'jpg' ? 'jpeg' : ext}"/>`).join('')}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="${pageWidth}" w:h="${pageHeight}"${pageWidth > pageHeight ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}

function pptxTextShape(block, shapeId) {
  const x = Math.round(Number(block.x || 0) * 9525);
  const y = Math.round(Number(block.y || 0) * 9525);
  const cx = Math.max(9525, Math.round(Number(block.width || 160) * 9525));
  const cy = Math.max(9525, Math.round(Number(block.height || 48) * 9525));
  const text = block.type === 'field' ? `${block.label || ''}${block.label ? ': ' : ''}${block.value || ''}` : block.text || '';
  const size = Math.max(600, Math.round((Number(block.style?.fontSize) || 16) * 100));
  return `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="Text ${shapeId}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="${Math.round((Number(block.rotation) || 0) * 60000)}"><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:pPr algn="${block.style?.textAlign === 'center' ? 'ctr' : block.style?.textAlign === 'right' ? 'r' : 'l'}"/><a:r><a:rPr lang="th-TH" sz="${size}" b="${Number(block.style?.fontWeight) >= 600 ? 1 : 0}"><a:solidFill><a:srgbClr val="${officeColor(block.style?.color)}"/></a:solidFill><a:latin typeface="Noto Sans Thai"/><a:ea typeface="Noto Sans Thai"/><a:cs typeface="Noto Sans Thai"/></a:rPr><a:t>${xml(text)}</a:t></a:r><a:endParaRPr lang="th-TH"/></a:p></p:txBody></p:sp>`;
}

function pptxTableShape(block, shapeId) {
  const x = Math.round(Number(block.x || 0) * 9525);
  const y = Math.round(Number(block.y || 0) * 9525);
  const cx = Math.max(9525, Math.round(Number(block.width || 400) * 9525));
  const cy = Math.max(9525, Math.round(Number(block.height || 200) * 9525));
  const grid = Array.from({ length: block.columns }, (_, index) => `<a:gridCol w="${Math.round((block.columnWidths?.[index] || block.width / block.columns) * 9525)}"/>`).join('');
  const rows = Array.from({ length: block.rows }, (_, row) => {
    const cells = Array.from({ length: block.columns }, (_, column) => {
      const cell = (block.cells || []).find(item => !item.hidden && item.row === row && item.column === column);
      const text = cell?.text || '';
      return `<a:tc${cell?.columnSpan > 1 ? ` gridSpan="${cell.columnSpan}"` : ''}${cell?.rowSpan > 1 ? ` rowSpan="${cell.rowSpan}"` : ''}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="th-TH" sz="${Math.max(700, Math.round((Number(cell?.style?.fontSize) || 12) * 100))}"/><a:t>${xml(text)}</a:t></a:r><a:endParaRPr lang="th-TH"/></a:p></a:txBody><a:tcPr marL="45720" marR="45720" marT="22860" marB="22860"><a:solidFill><a:srgbClr val="${officeColor(cell?.style?.backgroundColor, 'FFFFFF')}"/></a:solidFill></a:tcPr></a:tc>`;
    }).join('');
    return `<a:tr h="${Math.round((block.rowHeights?.[row] || 38) * 9525)}">${cells}</a:tr>`;
  }).join('');
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${shapeId}" name="Table ${shapeId}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

function pptxShape(block, shapeId) {
  const x = Math.round(Number(block.x || 0) * 9525);
  const y = Math.round(Number(block.y || 0) * 9525);
  const cx = Math.max(9525, Math.round(Number(block.width || 100) * 9525));
  const cy = Math.max(9525, Math.round(Number(block.height || 100) * 9525));
  const preset = block.shape === 'arrow' ? 'rightArrow' : block.shape === 'line' || block.type === 'line' ? 'line' : 'rect';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="Shape ${shapeId}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm rot="${Math.round((Number(block.rotation) || 0) * 60000)}"><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${officeColor(block.style?.fill, 'FFFFFF')}"/></a:solidFill><a:ln w="${Math.max(1, Number(block.style?.strokeWidth) || 1) * 12700}"><a:solidFill><a:srgbClr val="${officeColor(block.style?.stroke)}"/></a:solidFill></a:ln></p:spPr></p:sp>`;
}

export async function modelToRoundTripPptx(documentModel) {
  const JSZip = ensureZip();
  const zip = new JSZip();
  const slideOverrides = [];
  const presentationRelationships = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>'];
  for (const [pageIndex, page] of (documentModel.pages || []).entries()) {
    const slideNumber = pageIndex + 1;
    const rels = [];
    const shapes = [];
    let shapeId = 2;
    let imageIndex = 1;
    for (const block of (page.blocks || []).filter(item => !item.hidden).sort((a, b) => Number(a.zIndex || 1) - Number(b.zIndex || 1))) {
      if (block.type === 'image') {
        const data = decodeDataUrl(block.src);
        if (!data) continue;
        const ext = data.mime.includes('png') ? 'png' : 'jpg';
        const mediaName = `slide${slideNumber}-image${imageIndex++}.${ext}`;
        const relId = `rId${rels.length + 2}`;
        zip.file(`ppt/media/${mediaName}`, data.bytes);
        rels.push(`<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${mediaName}"/>`);
        const x = Math.round(Number(block.x || 0) * 9525); const y = Math.round(Number(block.y || 0) * 9525); const cx = Math.max(9525, Math.round(Number(block.width || 160) * 9525)); const cy = Math.max(9525, Math.round(Number(block.height || 100) * 9525));
        shapes.push(`<p:pic><p:nvPicPr><p:cNvPr id="${shapeId++}" name="${xml(block.alt || mediaName)}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm rot="${Math.round((Number(block.rotation) || 0) * 60000)}"><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
      } else if (block.type === 'table') shapes.push(pptxTableShape(block, shapeId++));
      else if (block.type === 'shape' || block.type === 'line') shapes.push(pptxShape(block, shapeId++));
      else shapes.push(pptxTextShape(block, shapeId++));
    }
    rels.unshift('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>');
    zip.file(`ppt/slides/slide${slideNumber}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    zip.file(`ppt/slides/_rels/slide${slideNumber}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
    slideOverrides.push(`<Override PartName="/ppt/slides/slide${slideNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
    presentationRelationships.push(`<Relationship Id="rId${slideNumber + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${slideNumber}.xml"/>`);
  }
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slideOverrides.join('')}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  const first = documentModel.pages?.[0] || { width: 1280, height: 720 };
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${(documentModel.pages || []).map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${Math.round(Number(first.width || 1280) * 9525)}" cy="${Math.round(Number(first.height || 720) * 9525)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presentationRelationships.join('')}</Relationships>`);
  zip.file('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
  zip.file('ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  zip.file('ppt/theme/theme1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="RipScan"><a:themeElements><a:clrScheme name="RipScan"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2>${['6366F1','8B5CF6','06B6D4','10B981','F59E0B','EF4444'].map((color, index) => `<a:accent${index + 1}><a:srgbClr val="${color}"/></a:accent${index + 1}>`).join('')}<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="RipScan"><a:majorFont><a:latin typeface="Noto Sans Thai"/><a:ea typeface="Noto Sans Thai"/><a:cs typeface="Noto Sans Thai"/></a:majorFont><a:minorFont><a:latin typeface="Noto Sans Thai"/><a:ea typeface="Noto Sans Thai"/><a:cs typeface="Noto Sans Thai"/></a:minorFont></a:fontScheme><a:fmtScheme name="RipScan"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' });
}

export async function exportOriginalFormat(documentModel, options = {}) {
  const format = String(options.format || documentModel?.metadata?.preferredRoundTripFormat || documentModel?.metadata?.sourceFormat || documentModel?.sourceType || 'pdf').toLowerCase();
  if (format === 'docx') return { blob: await modelToRoundTripDocx(documentModel), extension: 'docx', report: roundTripReport(documentModel, 'docx') };
  if (['xlsx', 'xls', 'ods'].includes(format)) return { blob: await modelToXlsxBlob(documentModel), extension: 'xlsx', report: roundTripReport(documentModel, 'xlsx') };
  if (['pptx', 'odp'].includes(format)) return { blob: await modelToRoundTripPptx(documentModel), extension: 'pptx', report: roundTripReport(documentModel, 'pptx') };
  if (format === 'pdf') {
    const result = await exportEditablePdf(documentModel, options.originalFile, options);
    return { blob: result.blob, extension: 'pdf', report: { ...roundTripReport(documentModel, 'pdf'), thaiFontEmbedded: result.thaiFontEmbedded } };
  }
  if (format === 'ripscan') return { blob: await modelToRipscanBlob(documentModel, { compatibilityReport: roundTripReport(documentModel) }), extension: 'ripscan', report: roundTripReport(documentModel, 'ripscan') };
  throw new Error(`ยังไม่รองรับ Round-Trip Export เป็น ${format}`);
}
