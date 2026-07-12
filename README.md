# RipScan — Thai-English OCR

เว็บแปลงภาพและ PDF เป็นข้อความภาษาไทย–อังกฤษ พร้อมตรวจแก้ผลลัพธ์ แยกหน้า ตาราง แบบฟอร์ม และหน้าปกที่มีรูปประกอบ โดยประมวลผลภายใน Browser เป็นหลัก

## ใช้งานออนไลน์

```text
https://rip-scan.vercel.app
```

ไฟล์ไม่ถูกอัปโหลดไปเก็บบนเซิร์ฟเวอร์ในโหมด Browser OCR

## ความสามารถหลัก

- PNG, JPG, WEBP, TIFF, BMP และ PDF
- ภาษาไทย ภาษาอังกฤษ และไทย–อังกฤษผสม
- PDF Text Layer และ PDF สแกนสูงสุด 100 หน้า
- Drag & Drop, เลือกหลายไฟล์ และวางภาพด้วย `Ctrl+V` / `Cmd+V`
- ปรับภาพเอียง Contrast Threshold และขยายภาพอัตโนมัติ
- ตรวจภาพคู่ข้อความ พร้อม Zoom หมุน ค้นหา Undo/Redo
- Thumbnail แยกหน้า ลากจัดลำดับ หมุน ลบ Crop และ OCR ใหม่
- ตรวจตารางแยก Cell, Numeric Strict และ Cross-Cell Contamination
- ส่งออก TXT, Markdown, HTML, CSV, JSON, DOCX, XLSX และ PDF
- PWA ติดตั้งเป็นแอปและเตรียมใช้งานออฟไลน์

## Layout เวอร์ชัน 1.9

หน้าแรกปรับตาม UI น้ำเงิน–ม่วงแบบ Premium:

- Hero และภาพ OCR ใช้พื้นที่สมดุล
- กล่องอัปโหลดและตั้งค่า OCR ขยายเต็มพื้นที่
- ปุ่มและข้อความจัด Grid ไม่ซ้อน ไม่ล้น และไม่ถูกตัด
- รายการไฟล์ใช้ Ellipsis เมื่อชื่อยาว
- ปุ่มเริ่ม OCR กว้างเต็มการ์ด
- Tablet และ Mobile เรียงเป็นคอลัมน์อัตโนมัติ
- รองรับ Dark/Light Theme และ `prefers-reduced-motion`

## Cover / Poster OCR

RipScan 1.9 เพิ่ม Pipeline สำหรับหน้าปก หนังสือ ใบงาน โปสเตอร์ เกียรติบัตร Infographic และภาพออกแบบที่มีรูปประกอบจำนวนมาก

Document Mode:

- `cover_page`
- `worksheet_cover`
- `book_cover`
- `poster`
- `certificate_cover`
- `infographic`
- `illustrated_document`
- `normal_document`

ลำดับการทำงาน:

```text
ตรวจประเภทเอกสาร
→ แยก Text / Illustration / Barcode
→ ตรวจหลักฐานบรรทัดข้อความ
→ OCR แยก Block
→ ตรวจภาษาไทยและ Gibberish
→ Confidence Gate
→ รวมเฉพาะข้อความที่ผ่าน
```

ห้าม OCR ทั้งภาพหน้าปกเป็นข้อความก้อนเดียวในชั้น Cover OCR

## Text vs Illustration

Region ที่รองรับ:

- `text`
- `photograph`
- `illustration`
- `cartoon`
- `logo`
- `icon`
- `decorative_frame`
- `ornament`
- `separator`
- `background_shape`
- `barcode`
- `qr_code`
- `unknown`

เฉพาะ Region ประเภท `text` ที่ผ่านหลักฐานต่อไปนี้จึงเข้าสู่ Text OCR:

- Baseline Evidence
- Character-like Connected Components
- Glyph Alignment
- Character Height Consistency
- Spacing Consistency
- Text-line Score
- จำนวน Glyph ขั้นต่ำ

กรอบ ลายไทย ตัวละคร เหรียญ ไอคอน และพื้นที่สีที่ไม่มีหลักฐานข้อความจะถูกข้าม

## Gibberish Detector

ระบบ Reject หรือส่ง Manual Review เมื่อพบ:

- สัญลักษณ์มากกว่า 25%
- Script เปลี่ยนหลายครั้งใน Token เดียว
- พยางค์ไทยผิดรูปแบบ
- อักขระ `| [ ] + @ #` ซ้ำผิดปกติ
- Token สั้นกระจัดกระจายจากรูปประกอบ
- OCR Confidence ต่ำ
- ไม่มี Baseline หรือ Bounding Box ไม่ตรงข้อความ

ตัวอย่างที่ต้อง Reject:

```text
| 3ร5ณส้ ๕๕ (0
คศั 7ฝ7@
[กงหด7
```

ข้อความที่ถูก Reject จะไม่อยู่ใน Export

## Decorative Thai Font

สำหรับฟอนต์ไทยประดิษฐ์ สีทอง สีขาว ตัวหนา ตัวเขียน มีเงา หรืออยู่บน Gradient ระบบเตรียม Variant:

1. Original Crop
2. Upscale 4x
3. Upscale 6x
4. Grayscale
5. Contrast Soft
6. CLAHE-like Contrast
7. Background Flattened
8. Edge-preserving Sharpen
9. Color Isolation
10. Text Mask
11. HSV Foreground Extraction เมื่อ Contrast ต่ำ

ระบบ OCR ทั้งบรรทัดก่อนอ่านระดับคำ

## Name / School Protection

ข้อความประเภทต่อไปนี้ใช้เกณฑ์สูงกว่าปกติ:

- ชื่อบุคคล
- ชื่อโรงเรียน
- ชื่อหน่วยงาน
- ชั้นเรียน
- หัวข้อหน้าปก

ชื่อบุคคลและโรงเรียนจะไม่ถูกแก้จากพจนานุกรมทั่วไป ถ้าหลักฐานไม่พอจะแสดง Manual Review เช่น:

```text
[โปรดตรวจสอบชื่อบุคคล]
[โปรดตรวจสอบชื่อโรงเรียน]
```

## Confidence Gate

ค่าเป้าหมาย:

```text
Text Region Confidence >= 0.90
OCR Confidence >= 0.90
Script Confidence >= 0.92
Thai Grapheme Confidence >= 0.94
Protected Name/School OCR >= 0.97
```

ผลลัพธ์เป็นหนึ่งใน:

- `accepted`
- `manual_review`
- `rejected_as_non_text`

## ตรวจข้อความจากหน้าปก

แต่ละหน้ามีปุ่ม **ตรวจข้อความจากหน้าปก** ผู้ใช้สามารถ:

- ดูภาพต้นฉบับและ Text Block
- ดูจำนวน Non-Text Region ที่ข้าม
- วาดกรอบข้อความเอง
- ลบกรอบที่จับผิด
- ระบุภาษา
- ระบุเป็นหัวข้อ ชื่อบุคคล ชื่อโรงเรียน หน่วยงาน หรือชั้นเรียน
- อ่านใหม่เฉพาะกรอบ
- ระบุว่าเป็นรูป ไม่ใช่ข้อความ
- ตรวจ OCR Candidate และ Confidence
- ยืนยันก่อนเพิ่มข้อความเข้าเอกสาร

## สระอำและ Thai Grapheme

- Normalize Unicode จาก `ํา` เป็น `ำ` พร้อม Change Log
- ตรวจสระอำหาย เช่น `จานวน`, `ดาเนินการ`, `สานักงาน`
- ไม่แทนคำอัตโนมัติจากพจนานุกรม
- Confidence สระอำต่ำกว่า 96% ส่ง Review
- ตรวจ Floating Mark, สระ/วรรณยุกต์ไม่มีฐาน และ Unicode Order
- รักษาเลขไทยและเครื่องหมายไทย

## ขีดและเส้นคั่น

รักษาแยกชนิด:

```text
-  –  —  −  _  /  |
--------------------
```

ตัวอย่างที่ต้องไม่เปลี่ยน:

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
```

## ตารางและแบบฟอร์ม

- ตรวจ Grid ก่อน OCR
- OCR แยกทีละ Cell
- รักษา Empty Cell และ Merged Cell Evidence
- Numeric Strict Mode
- ตรวจ Cross-Cell Contamination
- ตรวจ Checkbox และฟิลด์แบบฟอร์ม
- ส่งออก CSV, XLSX และ JSON
- Verified Table Settings ทำงานอัตโนมัติหลังบ้าน

## ล้างหน้าสแกน

ปุ่ม **ล้างหน้าสแกน** จะ:

- ยกเลิก OCR ที่กำลังทำงาน
- Terminate Worker
- ล้างหน้า OCR และ Review
- ไม่ลบไฟล์ต้นทางที่เลือกไว้

Retry ไม่มีการหักเครดิต เพราะเวอร์ชันนี้ยังไม่มีระบบเครดิต

## ผลทดสอบ

Vercel Preview ล่าสุด:

```text
79 tests
79 passed
0 failed
Syntax check passed
Static build passed
```

รายงานผลภาพจริงและ Controlled Fixture:

```text
docs/cover-poster-ocr-evaluation-v1.9.md
```

ผลวัดแบบ Text Regions ที่กำหนด Ground Truth:

| ชุดทดสอบ | Whole-page CER | Block OCR CER | Noise-line ก่อน | หลัง |
|---|---:|---:|---:|---:|
| ภาพจริงที่ผู้ใช้ส่ง | 68.71% | 23.56% | 47.06% | 0.00% |
| Illustrated Fixture | 32.11% | 23.85% | 28.57% | 0.00% |

ตัวเลข Block OCR วัดเมื่อทราบ Text Region หรือผู้ใช้วาดกรอบแล้ว ไม่ใช่ Accuracy ของ Automatic Detector แบบ End-to-End และไม่ใช้ Fixture อ้างเป็น Production Accuracy

## PWA

1. เปิดเว็บขณะออนไลน์
2. กดเตรียมใช้งานออฟไลน์
3. รอโหลด Tesseract.js, PDF.js และโมเดลภาษา
4. ติดตั้งผ่านเมนู Install App ของ Browser

Production Build ใช้ Cache รุ่น `ripscan-pwa-v1.9.0`

## คำสั่งทดสอบ

```bash
npm test
npm run check
npm run build
```

## เปิดใช้งาน Local

Windows:

1. ติดตั้ง Python 3.11–3.13 และเลือก `Add Python to PATH`
2. ติดตั้ง Tesseract OCR พร้อมภาษา Thai และ English
3. Clone repository
4. ดับเบิลคลิก `run-windows.bat`
5. เปิด `http://localhost:8000`

กรณีหา Tesseract ไม่พบ:

```env
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
```

macOS / Linux:

```bash
chmod +x run-local.sh
./run-local.sh
```

Docker:

```bash
docker compose up --build
```

## Local API

- หน้าเว็บ: `/`
- Health check: `/api/health`
- OCR: `POST /api/ocr`
- OpenAPI: `/docs`

## ข้อจำกัด

- Automatic Region Classifier ใน Browser เป็น Image Heuristic ไม่ใช่ Object Detection Model ขนาดใหญ่
- ภาพพญานาคต้นฉบับที่กล่าวถึงในข้อกำหนดไม่ได้แนบมาในรอบนี้ จึงยังไม่มีผลเฉพาะภาพนั้น
- ข้อความทับรูปภาพซับซ้อนอาจต้องวาดกรอบเอง
- Browser ที่ไม่มี BarcodeDetector ไม่รับประกันการถอด EAN/QR
- ยังไม่มี Dataset หน้าปกจริงพร้อม Bounding Box จำนวนมากพอสำหรับ Production Text Region Accuracy
- UI Regression Test ผ่าน แต่ยังไม่ได้รัน Playwright E2E บนทุก Browser

> RipScan ไม่อ้างว่าแม่น 100% เมื่อภาพเล็ก เบลอ มีฟอนต์ประดิษฐ์ หรือหลักฐานไม่พอ ระบบจะส่ง Manual Review แทนการเดา
