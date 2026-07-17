# RipScan 3.3.1 — Forms, Templates, Projects และ Export Safety

## ฟีเจอร์ที่เพิ่ม

- Document Model 3.3 และ migration ที่รักษา redaction จากเอกสาร 3.0
- Form Recognition สำหรับ label/value และ checkbox พร้อม field validation
- Form block types: field, checkbox, radio, signature, stamp, barcode, QR, label และ value
- Template import/test/apply โดยตรวจ schema, ปฏิเสธ source text/image และไม่เขียนทับ block เดิม
- Project Workspace ใน IndexedDB เก็บ metadata, queue status และผลข้อความ OCR เท่านั้น
- DOCX/XLSX compatibility report ที่บอกข้อจำกัดของ exporter ตามจริง
- Redaction audit report ที่เก็บเฉพาะตำแหน่ง/วิธีการ ไม่มีข้อความที่ถูกปิดบัง
- Privacy view แสดง external origins ที่ browser สังเกตเห็น และลบ local data ทั้งหมดได้

## ข้อจำกัดที่ยังระบุชัดเจน

- Form Recognition รุ่นนี้ใช้โครงสร้างผล OCR (separator/glyph/label semantics) ไม่ใช่โมเดล vision สำหรับลายเซ็นหรือตราประทับ
- DOCX จัด block ตาม reading order; positioned canvas, image และ shape ยังไม่รักษาความเหมือนต้นฉบับเต็มรูปแบบ
- XLSX เน้น table fidelity; visual objects และข้อความนอกตารางบนหน้าที่มีตารางไม่ถูกฝัง
- Project Workspace ไม่เก็บ raw file จึงต้องเลือกไฟล์ใหม่เมื่อต้อง retry หลัง reload

## Privacy

Browser OCR เป็น local-first โดย production build bundle runtime หลักไว้บน same-origin ส่วนภาษา OCR ยังโหลดจากแหล่ง tessdata ที่ประกาศไว้ หน้า Privacy แสดง origin ที่สังเกตได้ใน session และมีคำสั่งลบ IndexedDB, templates และ PWA caches แบบยืนยันผลสำเร็จจริง

## Reliability และ Security Patch 3.3.1

- ปิดการรั่วของ redacted table cell ใน PDF, DOCX, XLSX และ Document Model
- Searchable PDF รวมเฉพาะข้อความ verified โดยค่าเริ่มต้น
- ทำให้ Vercel, Docker และ FastAPI เสิร์ฟ frontend artifact ชุดเดียวกัน
- serialize Project mutations ป้องกันสถานะคิวเขียนทับกัน
- Secure Delete ไม่รายงานว่าสำเร็จเมื่อ IndexedDB ยังถูกใช้งาน
- ป้องกัน Form Recognition ตีความ URL, เวลา และ document code เป็น field
- จำกัด PDF/image pixels และ OCR concurrency ฝั่ง backend
- ใช้ `@e965/xlsx` และ jsPDF รุ่นแก้ช่องโหว่ พร้อม bundle dependency ใน production build
