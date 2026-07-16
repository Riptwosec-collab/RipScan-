# RipScan PDF Tools + Round-Trip Export v4

## Repository audit

RipScan เป็น Static Browser Application ที่ Build โดย `build.mjs` และคัดลอก `web/` ไป `dist/` โดยไม่มี Backend สำหรับเก็บไฟล์ผู้ใช้ งานหนักเดิมใช้ PDF.js Worker, OCR Worker, Table Reconstruction Worker และ Queue แบบจำกัด Concurrency

แกนที่นำกลับมาใช้:

- `web/document-model.mjs` — Structured Document Model กลาง
- `web/document-studio.js` — WYSIWYG Editor เดิม
- `web/office-import.mjs` — DOCX/XLSX/PPTX/ODF/HTML/RTF/CSV Adapter เดิม
- `web/editor-export.mjs` — Existing PDF/Image/DOCX/XLSX Export
- `web/table-reconstruction-worker.js` — ตัวอย่าง Worker/Queue และ Memory Cleanup
- `web/sw.js` — PWA Cache
- `JSZip 3.10.1` และ `PDF.js 4.10.38` — Dependency เดิม

ระบบที่ห้ามสร้างซ้ำและไม่ได้สร้างซ้ำ:

- Document Studio
- Convert Center
- Document Model
- Office Import
- Existing Export
- OCR Worker Queue

`pdf-tools-ui.js` ค้นหา `#convertCenter .convert-center-card` และเพิ่มหมวด PDF Tools เข้า Component เดิม ส่วน PDF Editor เรียก `RipScanDocumentStudio.importFiles()`, `openModel()` และ `getModel()`

## ไฟล์ใหม่

- `pdf-utility-core.mjs` — Validation, ranges, compression settings, reports และ compatibility
- `pdf-page-organizer.mjs` — Page Organizer กลางสำหรับ Merge/Split/Reorder
- `pdf-worker.js` — pdf-lib Worker สำหรับ inspect/merge/split/compress/image-to-PDF/editable overlay
- `pdf-tool-runtime.mjs` — AbortController, Queue, PDF.js page render, cleanup และ ZIP packaging
- `pdf-tools-ui.js` — ส่วนขยาย Convert Center และ Document Studio เดิม
- `pdf-tools.css` — Theme เดิมและ Responsive UI
- `roundtrip-export.mjs` — DOCX/XLSX/PPTX/PDF native adapters
- `ripscan-project.mjs` — `.ripscan` ZIP project

## Dependency policy

เพิ่มเฉพาะ Browser ESM แบบระบุ Version:

- `pdf-lib@1.17.1` สำหรับ copy page, merge, split, embed image และ PDF overlay
- `@pdf-lib/fontkit@1.1.1` สำหรับฝังฟอนต์ภาษาไทย

ยัง reuse:

- PDF.js `4.10.38`
- JSZip `3.10.1`
- SheetJS `0.18.5`
- html2canvas `1.4.1`
- jsPDF `2.5.2`

ไม่มีการใช้ `latest`

## Processing architecture

```text
Existing Convert Center / Document Studio
  -> PDF Tool Runtime
  -> AbortController
  -> PDF Worker (pdf-lib)
  -> Progress Events
  -> Blob Download
  -> Worker terminate / canvas clear / PDF destroy
```

PDF to image ใช้ PDF.js render ทีละหน้า ไม่ render ทุกหน้า 600 DPI พร้อมกัน และจำกัด pixel ต่อ Canvas เพื่อป้องกันหน่วยความจำล้น

## Compression modes

- Low/Standard/Custom แบบ Preserve Text Layer ใช้โครงสร้าง PDF เดิม ลบ metadata และ save ด้วย object streams
- High แบบ Raster Compression render ทีละหน้าและสร้าง PDF ใหม่จาก JPEG
- UI แจ้งชัดเจนเมื่อ High Mode ไม่รักษา Text Layer

ข้อจำกัด: pdf-lib ไม่สามารถ recompress image stream ทุกชนิดใน PDF เดิมโดยรักษา content stream ได้ครบ การลดขนาดแบบ Preserve Text จึงขึ้นกับโครงสร้างต้นฉบับและอาจลดได้น้อย

## Merge and split

Page Organizer เดียวรองรับ:

- reorder
- multi-select
- rotate
- delete
- duplicate
- undo/redo

Merge รองรับ PDF และ JPEG/PNG ส่วน WEBP/BMP จะ decode ผ่าน Browser Image API ก่อน embed

Split รองรับ every page, ranges, every N, odd และ even พร้อม ZIP เมื่อมีหลายผลลัพธ์

## PDF editing

PDF Editor ใช้ Document Studio เดิม:

- PDF Text Layer -> Positioned Text Blocks
- Scan PDF -> OCR Pipeline เดิมและ Review Status
- Image -> Image Block เดิม
- Annotation -> Text/Image/Shape Block ใน Document Model เดิม

Whiteout เป็น Visual Overlay เท่านั้นและไม่เรียกว่า Secure Redaction

Editable PDF Export ใช้หน้า PDF ต้นฉบับเป็น background/content เดิมและวาง Block ที่แก้หรือเพิ่มทับ โดยฝัง Noto Sans Thai เมื่อโหลด fontkit/font สำเร็จ

## Round-trip export

- DOCX: paragraph/run/table/image เป็น OOXML object จริง
- XLSX: reuse Existing SheetJS export; cell/merge/width/height เป็น worksheet จริง
- PPTX: text box/image/shape/table เป็น PresentationML object จริง
- PDF: original page + editable overlay
- `.ripscan`: manifest, document model, assets และ thumbnails

Fallback policy:

1. Native editable element
2. Compatible shape
3. Editable text box
4. Flatten เฉพาะ block
5. Flatten ทั้งหน้าเป็นตัวเลือกสุดท้าย

## Known limitations

- PDF Compression แบบ Preserve Text ไม่รับประกันว่าขนาดจะลดในทุกไฟล์
- Secure redaction ที่ลบ content stream จริงยังไม่เปิดใช้; Whiteout เป็น overlay
- Password PDF ขึ้นกับ PDF.js/pdf-lib encryption support และรหัสผ่านไม่ถูกเก็บ
- DOCX absolute-positioned text, WordArt, SmartArt, chart, macro และ OLE อาจ fallback
- PPTX animation, SmartArt, chart, 3D, master/theme ซับซ้อนอาจ fallback
- XLSX formula/data validation/frozen pane จะรักษาได้เมื่อ metadata เดิมมีและไม่ถูกแก้โครงสร้าง; adapter v4 ยังเน้น cell/table core
- TIFF/BMP/WEBP decoding ขึ้นกับ Browser
- Fidelity Score เป็น heuristic สำหรับรายการที่ควรตรวจ ไม่ใช่ pixel-perfect guarantee

## Privacy

ไฟล์ถูกอ่านและประมวลผลใน Browser ไม่มี Production Flow อัปโหลดไฟล์ไปเก็บบน Server และ Worker/Canvas/Object URL ถูก cleanup หลังจบงาน
