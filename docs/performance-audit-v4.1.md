# RipScan Performance Audit v4.1

สถานะเริ่มต้น: Audit จากโค้ด Production หลัง hotfix 4.0.1

## ขอบเขต
- Entry scripts และ eager-loaded modules
- OCR/PDF/Table/Document Studio/Office Import/Export pipelines
- Worker lifecycle, queue และ concurrency
- MutationObserver/IntersectionObserver/Event listeners
- Object URL, Canvas, ImageBitmap และ temporary buffers
- Undo/Redo, IndexedDB และ Service Worker

## Findings ที่ยืนยันจากโค้ด
1. หน้าแรกยังโหลด JavaScript module หลายไฟล์พร้อมกัน รวม OCR, Table, Document Studio และ PDF Tools
2. Tesseract.js และ JSZip ถูกโหลดจาก `<script>` ตั้งแต่หน้าแรก
3. PDF Tools เดิมเคยมี recursive MutationObserver และแก้ด้วย one-shot initializer ใน 4.0.1
4. Worker ถูกสร้างแยกหลาย subsystem และยังไม่มี shared global concurrency budget
5. Service Worker precache มีทั้ง OCR, Office/PDF และ tool assets จำนวนมาก ทำให้ update/cache cost สูง
6. Document Studio history และ autosave ต้องตรวจต่อเพื่อยืนยันว่าเป็น snapshot หรือ patch และวัด RAM จริงใน browser
7. ค่า Web Vitals, Peak RAM, FPS, OCR/PDF render/export time ยังไม่มี browser benchmark ที่เชื่อถือได้ จึงยังไม่รายงานตัวเลข

## Performance budgets
- TTI เป้าหมาย <= 3s บนเครื่องทั่วไป
- UI long task <= 100ms, ตรวจทุก task > 200ms
- Typing latency เป้าหมาย < 50ms
- Cancel response <= 1s
- Heavy jobs: desktop <= 2, mobile <= 1
- Export concurrency = 1
- History default = 60 operations

## Measurement policy
ห้ามใช้ค่าจำลองหรือ synthetic-only เป็น production claim. Browser benchmark ต้องบันทึก environment, file size/page count, cold/warm cache และ sample count.
