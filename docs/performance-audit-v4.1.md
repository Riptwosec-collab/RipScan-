# RipScan Performance Audit v4.1

สถานะ: Audit และ Emergency Performance Upgrade จาก Production 4.0.1

## ขอบเขตที่ตรวจ

- Entry scripts, dynamic imports และ PWA precache
- OCR, PDF, Table, Document Studio, Office Import และ Export pipelines
- Worker lifecycle, queue, timeout, retry และ cancellation
- MutationObserver, pointer events และ progress updates
- Object URL, Canvas, ImageBitmap และ temporary buffers
- Undo/Redo และ Document Studio rendering

## ต้นเหตุที่ยืนยันจากโค้ด

1. `web/app.js` โหลด PDF.js ที่ Entry Point แม้ผู้ใช้ยังไม่เปิด PDF
2. `web/index.html` โหลด Tesseract.js และ JSZip ตั้งแต่หน้าแรก
3. `web/app.js` มี Deskew/Threshold และ Pixel Projection บน Main Thread
4. OCR หน้าเดียวถูกประมวลผลซ้ำ: Main OCR เสร็จแล้ว แต่ `book-ocr-ui.js` ตรวจพบ Page Card ใหม่และสั่ง OCR อัตโนมัติรอบสอง
5. `book-ocr-browser-performance.mjs` สร้าง Promise สำหรับทุก Region พร้อมกัน แม้ Worker Pool จำกัด Slot ทำให้ Crop/Blob/Queue จำนวนมากค้างพร้อมกัน
6. `web/app.js` Render PDF ทุกหน้าและสร้าง Page Review DOM ทุกหน้าพร้อมกัน
7. `web/document-studio.js` เก็บสำเนา Document Model ทั้งก้อนใน Undo/Redo และตอนเริ่มแก้ `contenteditable`
8. Document Studio สร้าง Thumbnail ทุกหน้า และ Export DOM ทุกหน้าก่อน Export
9. PDF Tools มี Worker cleanup แต่ไม่มี Global Concurrency Budget ร่วมกับ OCR/Export อื่น
10. Service Worker precache OCR, Office, Table, Studio และ PDF assets จำนวนมาก
11. Recursive PDF Tools `MutationObserver` เป็นสาเหตุ freeze ก่อนหน้าและถูกแก้เป็น one-shot initializer ใน 4.0.1

## การแก้ไขที่เพิ่ม

### Shared runtime

- Shared queue: Desktop heavy <= 2, Mobile/Safe Mode heavy = 1, Export = 1
- Priority queue, duplicate Job ID prevention, Abort, timeout และ queue pause
- Job-local `ResourceManager` สำหรับ Object URL, ImageBitmap, Canvas และ Worker
- TTL/LRU Job Cache
- Long Task Guard: ถ้าพบ Task >= 1,000 ms ให้หยุด Background Thumbnail และเข้า Safe Mode

### Emergency Safe Mode

เปิดอัตโนมัติเมื่อ:

- PDF มากกว่า 20 หน้า
- ไฟล์มากกว่า 20 MB
- ด้านภาพมากกว่า 4,000 px
- OCR Region มากกว่า 100
- ตารางมากกว่า 500 Cell
- Queue มากกว่า 40 งาน
- Mobile หรืออุปกรณ์ RAM/CPU ต่ำ

Safe Mode ใช้ Heavy Worker 1, Variant สูงสุด 2, History 20, Preview สูงสุด 1,400 px และไม่ประมวลผลหน้าถัดไปอัตโนมัติ

### OCR

- Tesseract โหลดเมื่อเริ่ม OCR
- Main OCR ส่งงานเข้า Worker Region Pipeline
- Region Queue ไม่สร้าง Promise ทุก Region พร้อมกัน
- Variant สูงสุด 4 และ Safe Mode สูงสุด 2
- Variant Canvas จำกัด 16,000,000 pixels
- ผล Worker Block ถูกส่งเข้า Review UI โดยตรง ป้องกัน OCR หน้าเดิมรอบสอง
- Start ซ้ำใช้ Job ID เดิมและได้ Promise เดิม
- Cancel ส่งถึง Legacy OCR, Book OCR, Scheduler และ Worker

### PDF และ Document Studio

- PDF.js โหลดเมื่อเปิด PDF
- Safe Mode นำเข้า/ประมวลผลหน้าแรกก่อน
- Result Review สร้าง DOM เฉพาะหน้าปัจจุบัน
- Document Studio Render หน้าเอกสารปัจจุบันตามเดิม และ Thumbnail จำกัดรอบหน้าปัจจุบัน ±12 หน้า
- Undo/Redo งาน Block/Text/Table ใช้สำเนาระดับหน้า; Full Model ใช้เฉพาะงานโครงสร้างหน้า
- Drag/Resize อัปเดตผ่าน `requestAnimationFrame`
- Export สร้าง DOM เฉพาะหน้าที่ผู้ใช้เลือก
- PDF Tools ใช้ Shared Export Queue พร้อมกัน 1 งาน และส่ง Abort ลง Worker
- Canvas ที่จบงานลดเป็น 0×0

### Lazy loading และ PWA

- Initial page ไม่โหลด Tesseract, JSZip, Document Studio, PDF Tools, Table Review, Cover Review และ Advanced OCR UI
- Tool modules และ CSS โหลดเมื่อเปิด Tool หรือหลัง OCR ตามความจำเป็น
- Service Worker precache เฉพาะ App Shell; Heavy modules cache เมื่อเรียกใช้งานครั้งแรก

## ผลวัดจาก Static Production Build เดียวกัน

วิธีวัด: Build เดียวกันถูกวัดหลัง `build.mjs` ก่อน Performance Transform และวัดซ้ำหลัง Transform จากจำนวนไบต์จริงใน `dist`. ไม่รวมขนาด Remote Library เพราะ Build ไม่ได้ดาวน์โหลดไฟล์เหล่านั้น

| Metric | ก่อน | หลัง | เปลี่ยนแปลง |
|---|---:|---:|---:|
| Initial local scripts | 14 | 8 | -6 |
| Initial remote scripts | 2 | 0 | -2 |
| Initial local JavaScript | 337,951 bytes | 148,490 bytes | -189,461 bytes (-56.06%) |
| Initial local styles/assets | 126,937 bytes | 88,558 bytes | -38,379 bytes (-30.23%) |
| PWA precache assets | 63 | 27 | -36 (-57.14%) |
| `index.html` | 12,650 bytes | 11,806 bytes | -844 bytes |
| `app.js` | 41,418 bytes | 43,948 bytes | +2,530 bytes |
| Service Worker | 4,854 bytes | 3,891 bytes | -963 bytes |

ผลเต็มถูกสร้างเป็น `/performance-build-report.json` ทุก Production Build

## สิ่งที่ยังไม่มีค่าจริง

Environment นี้ไม่มี Chrome DevTools Performance/Memory automation จึงยังไม่มีค่าที่เชื่อถือได้สำหรับ:

- LCP, INP, CLS, TBT
- Main-thread blocking time ก่อน–หลัง
- Peak browser RAM/CPU
- Typing latency
- Drag/Resize FPS
- OCR/PDF/Export time จากไฟล์จริงหลายขนาด

จึงไม่รายงานตัวเลขเหล่านี้แบบคาดเดา ต้องเก็บด้วย Chrome DevTools บนอุปกรณ์และไฟล์ทดสอบที่ระบุ พร้อมบันทึก Browser version, CPU/RAM, cold/warm cache, file size, page count และ sample count

## Performance budgets

- TTI เป้าหมาย <= 3 วินาทีบนเครื่องทั่วไป
- UI interaction ไม่ควรถูก Block > 100 ms
- ตรวจและลด Long Task > 200 ms
- Typing latency เป้าหมาย < 50 ms
- Cancel เป้าหมาย <= 1 วินาที
- Heavy jobs: Desktop <= 2, Mobile/Safe Mode = 1
- Export concurrency = 1
- History default 50, Safe Mode 20

## Known limitations

- OCR Engine ของ Tesseract ทำงานใน Worker แต่การ Decode ภาพและ Browser PDF.js บางส่วนยังขึ้นกับความสามารถของ Browser
- Safe Mode ใน Document Studio นำเข้า PDF หน้าแรกก่อน; การเลือกช่วงหน้าขั้นสูงยังใช้ PDF Tools
- XLSX/Office parser โหลดเมื่อเปิดไฟล์ แต่ไฟล์ขนาดใหญ่มากยังต้องทดสอบ Heap จริงใน Chrome
- Static bundle report ไม่ใช่ Web Vitals หรือ Runtime Memory benchmark
