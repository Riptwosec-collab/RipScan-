# RipScan — Thai-English OCR

เว็บแปลงภาพและ PDF เป็นข้อความภาษาไทย–อังกฤษ รองรับการใช้งานออนไลน์บน Vercel และการใช้งานในเครื่อง ไฟล์ถูกประมวลผลภายในอุปกรณ์ของผู้ใช้เป็นหลัก

## ใช้งานออนไลน์

```text
https://rip-scan.vercel.app
```

โหมดออนไลน์ใช้ Tesseract.js และ PDF.js ภายใน Browser ไฟล์ไม่ถูกอัปโหลดไปเก็บบนเซิร์ฟเวอร์

## ความสามารถหลัก

- PNG, JPG, WEBP, TIFF, BMP และ PDF
- ภาษาไทย ภาษาอังกฤษ และไทย–อังกฤษผสม
- PDF Text Layer และ PDF สแกนสูงสุด 100 หน้า
- วางรูปจาก Clipboard ด้วย `Ctrl+V` หรือ `Cmd+V`
- อัปโหลดหลายไฟล์และลบไฟล์ออกจากรายการ
- ปรับภาพเอียง Contrast Threshold และขยายภาพอัตโนมัติ
- ตรวจภาพคู่ข้อความ พร้อม Zoom หมุน ค้นหา Undo และ Redo
- Thumbnail แยกหน้า ลากจัดลำดับ หมุน ลบ Crop และ OCR ใหม่
- ส่งออก TXT, Markdown, HTML, CSV, JSON, DOCX, XLSX และ PDF
- PWA ติดตั้งเป็นแอปและเตรียมใช้งานออฟไลน์

## OCR ปกหนังสือ พื้นหลังไล่สี และข้อความขนาดเล็ก

RipScan 1.8 เพิ่มชั้น OCR แบบแบ่ง Block สำหรับภาพที่มีพื้นหลังสี ตัวอักษรสีขาว ข้อความขนาดเล็ก รูปภาพ และหลายโซนในหน้าเดียว

### Text Only OCR

ค่าเริ่มต้นคือ **อ่านเฉพาะข้อความ**:

- ตรวจ Text Region ก่อน OCR
- ข้ามรูปภาพ โลโก้ ไอคอน และกราฟิกที่ไม่มีแนวข้อความ
- แยก Barcode/QR ออกจาก Text OCR
- เก็บ Bounding Box ของแต่ละ Block
- จัด Reading Order จากตำแหน่งจริง
- ไม่ใช้ข้อความจาก Image Region ใน Export

Region ที่รองรับ:

- `text`
- `image`
- `logo`
- `icon`
- `barcode`
- `qr_code`
- `decorative_shape`
- `separator_line`
- `table`
- `unknown`

Block ข้อความถูกจำแนกเป็น:

- `title`
- `numbered_list`
- `paragraph`
- `publisher_info`
- `address`
- `phone`
- `isbn`
- `price`
- `unknown`

### Barcode และ ISBN

- ใช้ `BarcodeDetector` เมื่อ Browser รองรับ EAN-13 และ QR
- แยก Bounding Box Barcode ออกจาก Text OCR
- ผูก ISBN และราคาใกล้ Barcode เป็นข้อมูลโครงสร้าง
- หาก Browser ถอดรหัสไม่ได้ ระบบยังพยายามกันเส้น Barcode ออกจากข้อความและส่งให้ตรวจ
- Phone และ ISBN ใช้กฎแยกกันเพื่อป้องกันเบอร์โทรถูกตีความเป็น ISBN

### Gradient และ Small Text Variants

ระบบสร้าง Candidate ต่อ Block:

1. Original Crop
2. Grayscale
3. CLAHE-like Contrast
4. Local Contrast Normalized
5. Background Flattened
6. Blue-channel Enhanced
7. Adaptive Threshold แบบรักษาจุดเล็ก
8. Upscale 3x
9. Upscale 4x
10. Mild Sharpen

ตัวอักษรที่ต่ำกว่าเกณฑ์จะถูกระบุ `Low Resolution` และส่ง Manual Review ระบบไม่เดาข้อความที่ไม่มีหลักฐานภาพเพียงพอ

### ภาษาแยกตาม Block

- Thai title/paragraph → Thai
- Address/Publisher → Thai หรือ Thai+English
- ISBN/Phone/Price → Number/English
- Barcode → Barcode Reader
- Mixed Block → Thai+English

ไม่บังคับใช้ไทย–อังกฤษกับทุก Block

## สระอำและ Thai Grapheme

ระบบตรวจ `ำ` โดยเฉพาะ:

- Normalize Unicode จาก `ํา` เป็น `ำ` พร้อม Change Log
- ตรวจสระอำหาย เช่น `จานวน`, `ดาเนินการ`, `สานักงาน`
- เสนอ Candidate แต่ไม่แทนคำอัตโนมัติ
- Confidence ของสระอำต่ำกว่า 96% จะถูกส่ง Review
- ตรวจ Floating Mark, วรรณยุกต์ซ้ำ, สระ/วรรณยุกต์ไม่มีพยัญชนะฐาน และ Unicode Order
- ชื่อบุคคล ชื่อหน่วยงาน และศัพท์เฉพาะใช้ Threshold สูงขึ้น

พจนานุกรมแบ่งหมวดทั่วไป ราชการ วิชาการ หน่วยงาน IT สระอำ และคำเฉพาะผู้ใช้ พจนานุกรมใช้เพิ่มคะแนน Candidate เท่านั้น ภาพและ OCR Evidence มีน้ำหนักสูงกว่า Context

ตัวอย่างคำทดสอบ:

```text
ดำเนินการ จำนวน สำนักงาน สำคัญ กำหนด คำแนะนำ
ชำนาญ อำนาจ จำเป็น นำเสนอ ตำแหน่ง สำเร็จ
สำหรับ กำลัง บำรุง ลำดับ อำเภอ คุณธรรม
```

## การรักษาขีดและเส้นคั่น

รองรับและรักษา:

```text
-
–
—
−
_
/
|
--------------------
```

จำแนกบทบาทเป็น Document Code, Range, Sentence Separator, Minus Sign และ Section Separator โดยไม่เปลี่ยน Dash ชนิดหนึ่งเป็นอีกชนิดโดยอัตโนมัติ

ตัวอย่างที่ต้องคงเดิม:

```text
66-F4-007
INC-2569-001
RD-Wifi
ชื่อ-นามสกุล
หน้า 10–15
ไทย–อังกฤษ
08.30-16.30 น.
LAN / WAN
A_B_C
--------------------
```

## Manual Review

แต่ละหน้าสแกนมีปุ่ม **ข้อความขนาดเล็กและคำไทยยาก** แสดง:

- Original Crop
- Enhanced Crop
- Upscale Crop
- OCR แต่ละ Variant
- Candidate และ Confidence
- Dictionary Support
- Failure Signals
- ปุ่มยืนยัน
- ปุ่มใช้ข้อความที่แก้ไข
- ปุ่มอ่านใหม่
- ตัวเลือกภาษาเฉพาะ Block

เพิ่มปุ่ม **ล้างหน้าสแกน** เพื่อยกเลิกงาน OCR ชั้นละเอียดและล้างผลลัพธ์ทั้งหมด โดยไม่ลบไฟล์ที่เลือกออกจากรายการ

## ตัวเลือกขั้นสูง

- อ่านเฉพาะข้อความ
- อ่านข้อความบนรูปภาพด้วย
- อ่านเฉพาะตาราง
- อ่านทั้งหมด
- ข้ามรูป โลโก้ และไอคอน
- ตรวจสระอำแบบละเอียด
- ตรวจวรรณยุกต์
- ตรวจสระบนและล่าง
- ตรวจคำไทยยาก
- ตรวจชื่อเฉพาะ
- รักษาเลขไทย
- รักษาเครื่องหมายขีด
- รักษาเส้นคั่น
- รักษาการขึ้นบรรทัด
- รักษาหัวข้อ
- รักษารายการ

ค่าเริ่มต้นเป็น Text Only, ตรวจสระอำ, รักษาขีด/เส้นคั่น และข้ามรูป/โลโก้

## ตารางและแบบฟอร์ม

- ตรวจ Grid และ OCR แยก Cell
- รักษา Empty Cell และ Merged Cell Evidence
- Numeric Strict Mode
- ตรวจ Cross-Cell Contamination
- ตรวจ Checkbox และฟิลด์แบบฟอร์ม
- ส่งออก CSV, XLSX และ JSON
- ตัวเลือก Verified Table ทำงานอัตโนมัติหลังบ้าน ไม่แสดงแถบตั้งค่าซ้ำบนหน้าเว็บ

## OCR Engine และประสิทธิภาพ

- Tesseract.js 7
- Auto, Turbo สูงสุด 2 Workers และโหมดประหยัด RAM
- Progress และ ETA
- Cancel OCR และ Terminate Worker
- Cache โมเดลภาษาใน Browser
- Candidate Ranker เลือกเฉพาะผลที่ OCR คืนมา ไม่สร้างคำใหม่

## Export

TXT, DOCX, Markdown และ PDF ใช้ Unicode UTF-8 และรักษา:

- สระอำและวรรณยุกต์
- ตัวการันต์และเลขไทย
- การขึ้นบรรทัดและย่อหน้า
- ขีดและเส้นคั่น
- รหัส ชื่อ-นามสกุล และช่วงตัวเลข

ผู้ใช้ควรตรวจ Manual Review ก่อนนำเอกสารสำคัญไปใช้งาน

## ผลทดสอบและ Accuracy

Vercel Build ล่าสุด:

```text
61 tests
61 passed
0 failed
Syntax check passed
Static build passed
```

รายงาน Benchmark ภาพจริงและ Fixture:

```text
docs/book-cover-thai-ocr-evaluation.md
```

ตัวเลขในรายงานมีขอบเขตชัดเจน ไม่ใช้ Synthetic Fixture อ้างเป็น Production Accuracy

## PWA และโหมดออฟไลน์

1. เปิดเว็บขณะมีอินเทอร์เน็ต
2. กด **เตรียมใช้งานออฟไลน์**
3. รอโหลด Tesseract.js, PDF.js และโมเดลภาษา
4. ติดตั้งผ่านปุ่ม Install App ของ Browser

Cache รุ่นปัจจุบัน: `ripscan-pwa-v1.8.0`

## คำสั่งทดสอบ

```bash
npm test
npm run check
npm run build
```

Build จะรัน Unit Tests, Syntax Check และสร้าง Static output ใน `dist/`

## เปิดใช้งาน Backend ในเครื่องบน Windows

1. ติดตั้ง Python 3.11–3.13 และเลือก `Add Python to PATH`
2. ติดตั้ง Tesseract OCR พร้อมภาษา Thai และ English
3. Clone repository
4. ดับเบิลคลิก `run-windows.bat`
5. เปิด `http://localhost:8000`

หาก Tesseract อยู่ที่ตำแหน่งมาตรฐานแต่ระบบหาไม่เจอ ให้ตั้ง `.env`:

```env
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
```

## macOS / Linux

```bash
chmod +x run-local.sh
./run-local.sh
```

## Docker

```bash
docker compose up --build
```

## Local API

- หน้าเว็บ: `/`
- Health check: `/api/health`
- OCR: `POST /api/ocr`
- OpenAPI: `/docs`

> OCR อาจอ่านชื่อเฉพาะ ตัวเลข สระ หรือเครื่องหมายจากภาพที่เล็กหรือเบลอผิดได้ RipScan จะแจ้งจุดที่ควรตรวจและไม่อ้างว่าแม่น 100%
