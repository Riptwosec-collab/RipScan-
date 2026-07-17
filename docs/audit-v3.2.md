# RipScan 3.2 implementation audit

วันที่ตรวจ: 2026-07-15 — ตรวจจาก `main` commit `1d76acf`

## Architecture และ data flow

RipScan เป็น local-first static web application มี FastAPI/Tesseract เป็นทางเลือกสำหรับการรันแบบ local/container แต่หน้าเว็บหลักใช้ Tesseract.js และ PDF.js ใน browser โดยตรง เส้นทางข้อมูลหลักคือ File/Clipboard → PDF/Image decoding → preprocessing → page/region/cell OCR → conservative validation → Document Model → Review/Studio → export

- Browser memory: `web/app.js` เก็บ files, documents, history, viewer และ Object URL; canvas ถูกลดขนาดและ release หลังใช้
- Worker: preprocessing และ table reconstruction มี worker แยก; orchestration และ Office parsing บางส่วนยังอยู่ main thread
- Persistence: Document Studio ใช้ IndexedDB; preferences ใช้ localStorage; PWA ใช้ Cache Storage
- Network: CDN libraries, OCR worker/core และ language data อาจถูกดาวน์โหลด แต่ไฟล์ผู้ใช้ไม่ถูกส่งออกใน default browser flow

## เก็บไว้

- Cover OCR hard block และ review-first statuses
- Broken Sara Am recovery ที่ไม่เดาชื่อเฉพาะ
- Table-first cell model, merged cells และ cross-cell validation
- Document Model/Studio, IndexedDB, undo/redo
- Office import adapters และ export ที่สร้างไฟล์จริง
- Worker timeout/cancel/progress และ canvas cleanup ที่มีอยู่

## ปรับปรุง

- FastAPI static mount ไม่ตรง root-relative assets; แก้ใน 3.2
- CPU-bound backend OCR ทำงานใน async event loop; ย้ายไป thread ใน 3.2
- File validation เดิมเชื่อ MIME/extension มากเกินไป; เพิ่ม magic-byte/pixel limit ใน 3.2
- Browser dependencies อยู่นอก lockfile; 3.2 ล็อก URL ให้เป็น exact version เป็นขั้นกลาง ก่อน bundle ภายใน
- CI เดิมตรวจเฉพาะ Node; 3.2 เพิ่ม Python และ container jobs
- Security headers เดิมไม่ครบ; 3.2 เพิ่ม CSP, framing และ cross-origin headers

## รวมระบบ

- Review หลายจุดกระจายใน cover/table/book UI ควรรวมผ่าน Document Model `reviewIssues`
- Export PDF มี visual PDF กับ browser-print searchable PDF แยกกัน ควรรวมเป็น direct export pipeline
- Threshold ต้องอ้างอิง profile กลางและถูกบันทึกใน metadata แทน hardcode กระจายหลายไฟล์

## เขียนใหม่เฉพาะส่วน

- `build.mjs` ใช้ exact string replacement หลายจุด บาง replacement ไม่ fail เมื่อ source เปลี่ยน ควรย้าย patch ไป source modules/config แล้วให้ build ทำเพียง copy/bundle
- Searchable PDF ต้องมี direct writer และ embedded Thai font ก่อนยกเลิก browser-print fallback

## ลบ/ไม่แสดง

- ห้ามแสดง PDF/A, handwriting, cloud OCR, fillable PDF หรือ password protection จนมี implementation และ validation จริง
- ลบ UI ที่อาศัย mock score/progress/placeholder; quality score ต้องคำนวณจาก text/layout/table evidence เท่านั้น
- ไม่รองรับ macro, OLE, remote Office relationship และ nested archive โดยอัตโนมัติ

## Import/export matrix

| Format | Import | Export | ข้อจำกัด |
|---|---|---|---|
| PDF/Image | text layer หรือ OCR | visual PDF/JPG/PNG | searchable ใช้ print fallback ใน 3.1 |
| DOCX | paragraph/run/table/image พื้นฐาน | text/table DOCX | DrawingML/SmartArt ไม่ครบ |
| XLSX/XLS | sheet/cell/merge/style ที่ parser คืน | table sheets | advanced workbook features ไม่ครบ |
| PPTX | slide text/image/connector | ผ่าน PDF/image | animation/chart ไม่ครบ |
| Text/CSV/HTML/RTF/ODF | โครงสร้างพื้นฐาน | text/JSON/Office บางชนิด | ต้อง sanitize และจำกัด archive/XML |

## Test gap

Node regression 164 รายการผ่าน ณ จุดเริ่มต้น แต่ 72 declarations อยู่ในไฟล์ที่ตรวจ source string จึงไม่ใช่ behavioral coverage เต็มรูปแบบ Backend มีเพียง health/unsupported-file tests และ CI ไม่เคยรัน Python ก่อน 3.2 ยังขาด browser E2E, direct-PDF text extraction, malformed archive corpus, memory budget และ visual regression จาก fixture จริง

## Migration

Document Model ยังเป็น 3.0.0 จึงไม่บังคับ migration ใน foundation patch การเพิ่ม field/version/redaction ต้องใช้ migration function ที่รับ model เดิมแบบไม่ทำข้อมูลหาย IndexedDB store เดิมต้องคงชื่อเดิมจน migration test ผ่าน
