# RipScan 3.2 — Repository Audit ก่อนเพิ่ม PDF Tools และ Round-Trip Export

วันที่ Audit: 2026-07-16

Repository: `Riptwosec-collab/RipScan-`

## 1. โครงสร้างเดิมที่เกี่ยวข้อง

- `web/index.html` — Landing page และ OCR workspace หลัก
- `web/app.js`, `web/upgrade.js`, `web/advanced.js` — OCR entry flow และ page result cards
- `web/document-model.mjs` — Structured Document Model กลาง
- `web/document-studio.js` — Document Studio เดิม, WYSIWYG editor, Undo/Redo, IndexedDB, Convert Center
- `web/document-studio.css` — UI ของ Document Studio และ Convert Center เดิม
- `web/office-import.mjs` — DOCX/XLSX/PPTX/ODF/HTML/CSV/TXT/RTF/JSON import adapters
- `web/editor-export.mjs` — PDF/JPG/PNG/DOCX/XLSX/TXT/JSON export service เดิม
- `web/table-reconstruction-*`, `web/table-review-v312.js` — Table-first Reconstruction และ Worker Queue
- `web/book-ocr-*`, `web/cover-*`, `web/sara-am-*` — OCR, Cover Hard Block และ Broken Sara Am Recovery
- `web/sw.js` — PWA shell/runtime cache
- `build.mjs` — Static build, production rewrites, asset injection, PWA version
- `tests/*.test.mjs` — Unit และ regression tests

## 2. Entry Point และ Build

- Browser entry ใช้ `web/index.html`
- Build เป็น static copy: `web/` → `dist/`
- `npm run build` รัน `npm test`, `npm run check`, แล้ว `node build.mjs`
- Vercel serve static output
- ไม่มี frontend bundler; library ขนาดใหญ่ถูก lazy-load จาก CDN แบบระบุ version

## 3. Routing / การเปิดหน้า

- เป็น single-page application
- Document Studio และ Convert Center เป็น overlay/shell เดิมใน `document-studio.js`
- ห้ามสร้าง route หรือ editor ใหม่แยก
- PDF Tools จะเพิ่มเป็นหมวดใน Convert Center เดิม และเรียก Document Studio เดิมเมื่อแก้ PDF

## 4. Document Studio เดิม

มีอยู่แล้ว:

- Visual page canvas และ Structure view
- Text/Table/Image/Shape/Field blocks
- Move, resize, rotate, z-index, duplicate, delete
- Table row/column, merge/split cell
- Undo/Redo
- Save/Load IndexedDB
- Office/PDF/Image import
- Convert Center พร้อม page selection, quality, DPI, resize และ cancel

PDF Editor ใหม่ต้อง reuse `openModel()`, `createImageBlock()`, `createTextBlock()`, `createShapeBlock()` และ Convert Center เดิม

## 5. Document Model เดิม

`document-model.mjs` มี:

- Document → Pages → Blocks
- Text, Image, Shape, Line, Field, Table
- Table Cell / Merge / Size / Style
- `metadata` ระดับ Document, Page และ Block

สิ่งที่ต้องขยายโดยไม่ทำลาย schema เดิม:

- Source format metadata
- Source element reference
- Editable semantic layer / visual reference metadata
- Image crop, aspect lock และ source asset id
- Cell metadata สำหรับ formula, type, number format และ source address
- Export compatibility metadata

## 6. Import Adapter เดิม

Reuse:

- PDF.js 4.10.38 สำหรับ PDF preview/text layer
- JSZip 3.10.1 สำหรับ OOXML/ODF และ ZIP
- SheetJS 0.18.5 สำหรับ XLSX
- DOCX OOXML parser เดิม
- PPTX XML parser เดิม

Refactor:

- เพิ่ม source metadata ทุก adapter
- เก็บ formula/type/format ของ XLSX ใน cell metadata
- เก็บ source element id/path ใน block metadata
- เก็บ original PDF bytes เป็น transient browser asset ไม่ฝัง Base64 ใน Document Model

## 7. Export Service เดิม

Reuse:

- `normalizeExportOptions()`
- `calculateOutputSize()`
- `downloadBlob()`
- `renderElementToCanvas()`
- `exportPageElements()`
- DOCX/XLSX exporters เดิมเป็นฐาน

Refactor:

- เพิ่ม PDF native/overlay export ผ่าน pdf-lib
- เพิ่ม PPTX native exporter
- เพิ่ม RipScan project export/import
- เพิ่ม Compatibility Report และ original-format dispatch
- เพิ่ม PDF utility operations โดยไม่สร้าง Export Service ใหม่

## 8. Worker / Queue

มีอยู่แล้ว:

- OCR preprocessing Worker
- Table reconstruction Worker
- Serialized lazy table detection
- Progress/Cancel token

PDF Tools จะเพิ่ม Worker เฉพาะงาน image processing และใช้ queue กลางใน PDF Tool Core:

- Desktop concurrency สูงสุด 2
- Mobile concurrency สูงสุด 1
- PDF.js render ทีละหน้า
- Thumbnail lazy/IntersectionObserver
- AbortController per task

## 9. PWA / Service Worker

- ปัจจุบัน cache version `ripscan-pwa-v3.1.2`
- ต้องเพิ่มไฟล์ PDF Tools/Round-Trip ใหม่ใน shell cache
- ต้องอัปเดตเป็น `ripscan-pwa-v3.2.0`
- Remote offline pack ต้องเพิ่ม pdf-lib แบบ pin version

## 10. ระบบที่ห้ามแตะ Logic

- Cover Image Hard Block
- Broken Sara Am Recovery
- Review-first OCR thresholds
- Table-first Reconstruction rules
- Tesseract Worker Queue
- Existing Office import behavior ที่ผ่าน regression
- Existing PDF/JPG/PNG/DOCX/XLSX exports

แก้ได้เฉพาะจุดเชื่อม, metadata และ extension interface โดยต้องคง regression เดิมทั้งหมด

## 11. จุดเสี่ยงระบบซ้ำ

- Convert Center มีอยู่แล้ว — ห้ามสร้าง dialog ใหม่
- Document Studio มีอยู่แล้ว — ห้ามสร้าง PDF Editor ใหม่
- Image Block มีอยู่แล้ว — เพิ่ม property/crop เท่านั้น
- Export Service มีอยู่แล้ว — เพิ่ม adapter/dispatch เท่านั้น
- PDF.js มีอยู่แล้ว — ห้ามเพิ่ม renderer ซ้ำ
- JSZip มีอยู่แล้ว — reuse สำหรับ split ZIP และ `.ripscan`

## 12. Library Policy

เพิ่มเฉพาะ:

- `pdf-lib@1.17.1` แบบ lazy-loaded จาก jsDelivr

เหตุผล:

- Browser-first
- MIT license
- ใช้ merge/split/copy page, image embedding, page rotation, metadata และ native PDF overlay
- ไม่ซ้ำกับ PDF.js: PDF.js ใช้ render/read; pdf-lib ใช้ write/modify

ไม่เพิ่ม library สำหรับ ZIP, image resize, XLSX หรือ PDF preview เพราะระบบเดิมมีแล้ว

## 13. ไฟล์ที่จะสร้าง

- `web/pdf-tools-core.mjs` — validation, queue, ranges, merge/split/compress/PDF-image operations
- `web/pdf-page-organizer.mjs` — shared page organizer state และ commands
- `web/pdf-tools-worker.js` — resize/compress image worker
- `web/pdf-tools-integration.js` — inject PDF Tools เข้า Convert Center เดิมและเชื่อม Document Studio
- `web/pdf-tools.css` — styles ภายใน theme เดิม
- `web/roundtrip-export.mjs` — project format, compatibility, original-format dispatch, PPTX/native PDF adapters
- `tests/pdf-tools-v320.test.mjs`
- `tests/roundtrip-export-v320.test.mjs`

## 14. ไฟล์ที่จะแก้ไข

- `web/document-model.mjs` — backward-compatible metadata extensions
- `web/office-import.mjs` — source metadata / XLSX formula/type / source references
- `web/editor-export.mjs` — lazy pdf-lib, native PDF and adapter hooks
- `web/document-studio.js` — เพิ่ม PDF Tools category, source format badge, project/original export, image properties โดย reuse shell เดิม
- `web/document-studio.css` — responsive PDF tools workspace
- `web/sw.js` — cache 3.2.0
- `build.mjs` — inject/cache assets
- `package.json` — version/check files
- `README.md` — usage, routes/menu, limitations

## 15. Acceptance Strategy

- ฟังก์ชันทุกตัวต้องคืน Blob/Document Model จริงใน Browser
- ไม่มี Production mock
- Test core operations ด้วย deterministic fixtures
- CI ต้องผ่าน test/check/build
- Vercel preview ต้อง READY ก่อน merge
- Production verify asset/version หลัง merge

## 16. Known feasibility boundaries

- Preserve-mode compression สามารถลดโครงสร้าง/metadata และใช้ object streams แต่ PDF ที่บีบอัดดีอยู่แล้วอาจไม่เล็กลง
- High raster compression จะลดขนาดได้มากกว่า แต่ต้องแจ้งว่ากระทบ text layer และใช้เฉพาะเมื่อผู้ใช้เลือก
- Secure redaction ไม่เท่ากับ white overlay; v3.2 เรียกอย่างชัดเจนว่า overlay redaction
- SmartArt/OLE/complex chart/animation และ absolute Word DrawingML อาจต้อง flatten เฉพาะ block และต้องปรากฏใน Compatibility Report
- ไม่อ้างความเหมือนต้นฉบับ 100%
