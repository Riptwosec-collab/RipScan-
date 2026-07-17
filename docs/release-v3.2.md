# RipScan 3.2 — Foundation, Review และ Direct Searchable PDF

## สิ่งที่เสร็จในรุ่นนี้

- Local/Docker เสิร์ฟ frontend assets จาก root path เดียวกับ Vercel
- Backend ตรวจ magic byte + MIME + extension, จำกัดจำนวนพิกเซล และย้าย OCR ออกจาก event loop
- Security headers ครบ baseline: CSP, HSTS, framing, referrer, permissions และ cross-origin policy
- CI แยก Node, Python และ container smoke jobs
- Review Center รวม block/cell ที่ต้องตรวจ เรียงตาม confidence และแก้/ยืนยัน/non-text ได้
- Quality score มีสูตรและ sample size ไม่ใช้คะแนนจำลอง
- Visual Compare: Side-by-side, Overlay และ Before/After slider
- Searchable PDF ดาวน์โหลดโดยตรง: visual layer + invisible positioned text layer พร้อม Noto Sans Thai
- Review Required ไม่เข้า PDF text layer โดยค่าเริ่มต้น; `confirmed_non_text` และ redacted ถูกตัดเสมอ
- Redaction ลบข้อความ/candidate metadata จาก export model และ burn-in พื้นที่สีดำใน visual output
- Autosave แบบ debounce, named versions และ restore
- Template export เก็บเฉพาะ geometry/field/table/header/footer ไม่เก็บข้อความเอกสาร
- Batch OCR พักต่อ/ยกเลิกได้ โดย pause ทำงานที่ page/file boundary เพื่อไม่ทิ้ง worker กลางคำ
- Privacy view แสดง processing mode, engine, storage usage และ PWA cache จากสถานะจริง
- Validation framework ไม่แก้ตัวอักษรกำกวม `O/0`, `I/l/1`, `S/5`, `B/8` อัตโนมัติ
- Borderless table inference core คืนป้าย `Inferred Grid`, confidence และ evidence ชัดเจน

## สิ่งที่ตั้งใจไม่แสดง

ไม่มีตัวเลือก PDF/A, cloud OCR, handwriting OCR, password PDF, fillable PDF หรือ automatic template matching เพราะยังไม่มี implementation/validator ที่พิสูจน์ได้ ระบบไม่สร้าง mock result หรือ progress ปลอมเพื่อเติม UI

## Migration

- Document Model ยังคง version `3.0.0`; เปิด project เดิมได้โดยไม่แปลงข้อมูล
- IndexedDB `ripscan-document-studio` อัปเกรด schema จาก 1 → 2 โดยเพิ่ม object store `versions`; store `documents` เดิมไม่ถูกลบ
- PWA cache เปลี่ยนเป็น `ripscan-pwa-v3.2.0`; service worker ลบ cache RipScan รุ่นเก่าหลัง activate
- Template ใหม่อยู่ใน localStorage key `ripscan-templates` และไม่มีข้อความจากเอกสารต้นฉบับ

## Rollback

1. Deploy commit ก่อน 3.2 หรือ checkout tag/commit รุ่นเดิม
2. ล้าง Cache Storage ที่ขึ้นต้น `ripscan-pwa-` แล้ว reload
3. ไม่ต้องลบ IndexedDB; รุ่นเก่าจะไม่อ่าน store `versions` แต่ยังอ่าน `documents` ได้
4. หากต้องการ rollback ข้อมูล ให้ Export Project Backup JSON ก่อน แล้ว import กลับใน Document Studio

## Known limitations

- ฟอนต์ไทยใน direct PDF ใช้ Noto Sans Thai จึงรักษาการเลือก/ค้นหาข้อความได้ แต่หน้าตาฟอนต์อาจต่างจากต้นฉบับ
- Text-layer bounding box ใช้ตำแหน่ง Document Model; เอกสาร OCR ที่ไม่มี positioned block ต้องเปิดเข้า Studio ก่อน
- Visual Compare วัด confidence และ geometry ที่มีอยู่ ไม่ใช่ pixel-diff computer vision เต็มรูปแบบ
- Template รุ่นนี้บันทึก/export geometry ได้ แต่ยังไม่ auto-apply เมื่อ confidence ต่ำ
- Pause จะหยุดที่ขอบเขตหน้า/ไฟล์ ไม่หยุด Tesseract ระหว่างหนึ่ง region
- DOCX/XLSX ยังคงเป็น structural export; SmartArt, macro, OLE และ Office rendering fidelity เต็มรูปแบบไม่รองรับ
- Mobile scanner/camera ไม่เปิดใช้ เพราะ permissions policy ปิดกล้องและยังไม่มี edge-detection flow ที่ผ่านการทดสอบ

ฟอนต์ `web/fonts/NotoSansThai.ttf` ใช้ภายใต้ SIL Open Font License ซึ่งแนบไว้ที่ `web/fonts/OFL-NotoSansThai.txt`
