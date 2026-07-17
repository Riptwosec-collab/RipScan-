# RipScan Performance Audit v5.0.0

วันที่ตรวจ: 2026-07-17  
Repository: `Riptwosec-collab/RipScan-`  
ขอบเขต: ต่อระบบเดิมเท่านั้น ไม่สร้าง Document Studio, Convert Center, OCR Pipeline หรือ Export Pipeline ซ้ำ

## วิธีวัด

ค่าที่รายงานเป็นตัวเลขในเอกสารนี้มาจากการตรวจ Source/Production Build และ Automated Tests ที่ทำซ้ำได้เท่านั้น โดย `scripts/performance-audit.mjs` สร้าง `dist/performance-audit.json` ทุกครั้งที่ Build

Browser Timing, FPS, Peak RAM, CPU, LCP, INP และ Total Blocking Time ต้องเก็บจาก Browser จริงผ่าน Performance Runtime เนื่องจาก GitHub Actions ไม่มี Browser Profile ในชุดทดสอบนี้ จึงไม่ใส่ตัวเลขจำลอง

## Baseline ก่อนแก้

### Initial loading

- Source `index.html` โหลด JavaScript 8 รายการทันที
- มี Tesseract.js และ JSZip จาก CDN อยู่ใน Critical Path
- `app.js` Static Import PDF.js ตั้งแต่เปิดหน้าแรก
- Production Build Inject Tool Module เพิ่ม 8 รายการ ได้แก่ Book/Cover OCR UI, Performance UI, Table UI, PDF Tools, Document Studio และ Table Review
- Production CSS Inject เพิ่ม 8 Stylesheet รวม Editor และ PDF Tools แม้ผู้ใช้ยังไม่ได้เปิด Tool

### Main Thread

พบงานหนักใน `app.js`:

- `getImageData()` และ Pixel Loop สำหรับ Projection/Threshold
- หมุนภาพหลายมุมเพื่อหา Deskew
- สร้าง OCR Variant บน Main Thread
- PDF Page Render ทำบน Main Thread
- อัปเดต Progress โดยตรงจากทุก OCR Message

### Document Studio

- Undo/Redo เก็บ `cloneValue(state.model)` ทั้ง Document
- Focus Text Editor เก็บ Snapshot ทั้ง Document
- Page Sidebar Render Thumbnail ทุกหน้า
- Table สร้าง DOM ทุก Row/Cell ของหน้าปัจจุบัน
- Export สร้าง DOM ของทุกหน้าที่อยู่ใน Model ก่อนเริ่ม Export
- PDF Import เก็บ Background เป็น Data URL ทุกหน้า

### Resource lifecycle

ระบบเดิมมี Cleanup หลายจุด แต่ยังไม่มี Registry กลางสำหรับ Object URL, Canvas, ImageBitmap, Worker และ AbortController ทำให้ตรวจ Leak ข้าม Tool ได้ยาก

### Service Worker

- Tool Module และ Library จำนวนมากอยู่ใน App Shell
- ไม่มี Runtime Cache Entry Limit
- ไม่มี Guard กลางป้องกัน User File, Blob URL และ Export Result

## การแก้ไข v5

### Lazy loading

หน้าแรกโหลดเฉพาะ Core UI และ `performance-bootstrap.js` ส่วน Tool ต่อไปนี้ใช้ Dynamic Import:

- Document Studio
- PDF Tools
- Table Review
- Cover/Book OCR Review
- Tesseract.js
- JSZip
- PDF.js ใน OCR Entry

การ Hover/Focus ปุ่มจะ Preload Tool ที่กำลังจะใช้ แต่ไม่ Initialize งานหนัก

### Worker preprocessing

ย้าย Deskew Sample, Projection Score, Grayscale, Contrast, Otsu Threshold, Resize และ Small-mark Variant ไป `performance-image-worker.js` โดยใช้:

- OffscreenCanvas
- ImageBitmap Transferable
- Abort Message
- Timeout
- Explicit Canvas/ImageData/ImageBitmap Cleanup

OCR Variant ใช้ Progressive Policy:

1. Original/Deskew
2. Enhanced
3. Threshold เฉพาะ Confidence ต่ำ

### Shared runtime

`performance-runtime.mjs` เพิ่ม:

- Priority Queue แยก Heavy/Thumbnail/Export Lane
- Desktop Heavy สูงสุด 2, Mobile/Low-memory สูงสุด 1
- Timeout และ Retry สูงสุด 1
- Circuit Breaker
- Bounded TTL/LRU Cache
- Resource Manager
- Large File Mode
- Low-memory Recovery
- Development Metrics Panel
- Telemetry Metric ที่ไม่มีเนื้อหาเอกสาร

### Document Studio

Production Build เปลี่ยน History เป็น Patch History:

- Text/Cell/Position/Style เก็บเฉพาะ Path ที่เปลี่ยน
- History Limit ปรับตาม Device/Large File Mode
- การพิมพ์ต่อเนื่องรวมเป็น Group เดียว
- ล้าง History และ Document Resource เมื่อปิด Studio

เพิ่ม Virtualization:

- Page Thumbnail Window 16 รายการ
- Table Row Window 56 แถว
- รูป Thumbnail ใช้ `loading="lazy"` และ `decoding="async"`
- Render Editor เฉพาะหน้าปัจจุบันตามระบบเดิม
- Export สร้าง DOM เฉพาะหน้าที่ผู้ใช้เลือก

### PWA

- App Shell เหลือ Core UI
- Heavy Tool อยู่ใน Lazy Asset List และไม่ Precache ตอน Install
- Runtime Cache จำกัด 48 รายการ
- JS/CSS ใช้ Network-first เพื่อป้องกันไฟล์ข้าม Version
- ไม่ Cache `blob:`, `data:`, `file:`, User Upload และ Export Result
- มีคำสั่ง Clear Temporary Cache

## Static Build Budget

`npm run build` จะสร้างรายงานจริงที่ `dist/performance-audit.json` ประกอบด้วย:

- Initial Script Count
- Initial Stylesheet Count
- Initial Local JavaScript Bytes
- Initial Local CSS Bytes
- Total JavaScript/CSS Bytes
- Dynamic Loading Guard

ตัวเลขนี้ไม่ใช่ Network Timing และไม่ใช้แทน LCP/INP/TBT

## Runtime Metrics

Performance Runtime เก็บในเครื่องผู้ใช้เท่านั้นโดยค่าเริ่มต้น:

- Long Task Count/Duration
- LCP
- CLS
- INP เมื่อ Browser รองรับ
- FPS
- DOM Node Count
- Canvas Count
- JS Heap เมื่อ Browser รองรับ
- Queue Length
- Worker/Canvas/Bitmap/Object URL Count จาก Resource Manager

Debug Panel เปิดเฉพาะ `localhost` หรือ Query `?debugPerformance=1`

## Automated coverage

- Worker concurrency
- Queue priority
- Cancel pending/active job
- Timeout
- Retry limit
- Circuit breaker
- Object URL/Bitmap/Canvas/Worker cleanup
- Bounded TTL cache
- Patch Undo/Redo
- History limit
- Large File Mode
- Lazy Dynamic Import
- No duplicate Document Studio/Convert Center
- Worker OffscreenCanvas cleanup
- Page/Table Virtualization limits
- Service Worker cache bounds
- Existing OCR, Cover Hard Block, Broken Sara Am, Table-first, PDF Tools and Export regressions

## Known limitations

1. Browser Timing ก่อน–หลังต้องวัดจากอุปกรณ์จริง จึงไม่รายงานตัวเลขที่ GitHub Actions ไม่ได้วัด
2. PDF.js Page Paint ยังต้อง Compose ผ่าน Canvas ของ Browser แต่ Parsing และ OCR/Image Preprocessing แยกจาก Main Thread และทำทีละหน้า
3. Export บางรูปแบบใช้ DOM Renderer ของระบบเดิม แต่ v5 จำกัดการสร้าง DOM เฉพาะหน้าที่เลือก
4. Data URL เดิมใน Document Model ยังจำเป็นสำหรับการบันทึก Project/Export บางประเภท; v5 ลด Preview และจำนวนหน้าที่ Render พร้อมกัน แต่ไม่ได้เปลี่ยน File Format เดิม
5. Table Virtualization เปิดเมื่อมากกว่า 56 แถว; Merged Cell ที่คร่อมขอบ Window จะถูก Render จาก Anchor Cell ที่เกี่ยวข้อง แต่ Browser บางรุ่นอาจคำนวณความสูงต่างกันเล็กน้อย
6. Telemetry ปิดเป็นค่าเริ่มต้นและไม่มีการส่งข้อความ OCR ชื่อไฟล์ ภาพ หรือ Cell Content
