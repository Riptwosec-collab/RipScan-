# RipScan — Thai-English OCR

เว็บแปลงภาพและ PDF เป็นข้อความภาษาไทย–อังกฤษ พร้อมตรวจแก้ผลลัพธ์ แยกหน้า ตาราง แบบฟอร์ม หน้าปก และข้อความไทยอ่านยาก โดยประมวลผลภายใน Browser เป็นหลัก

## ใช้งานออนไลน์

```text
https://rip-scan.vercel.app
```

ไฟล์ไม่ถูกอัปโหลดไปเก็บบนเซิร์ฟเวอร์ในโหมด Browser OCR

## ความสามารถหลัก

- PNG, JPG, WEBP, TIFF, BMP และ PDF
- ภาษาไทย ภาษาอังกฤษ และไทย–อังกฤษผสม
- PDF Text Layer และ PDF สแกนสูงสุด 100 หน้า
- Drag & Drop, หลายไฟล์ และวางภาพด้วย `Ctrl+V` / `Cmd+V`
- ปรับภาพเอียง Contrast Threshold และขยายภาพอัตโนมัติ
- ตรวจภาพคู่ข้อความ พร้อม Zoom หมุน ค้นหา Undo/Redo
- Thumbnail แยกหน้า ลากจัดลำดับ หมุน ลบ Crop และ OCR ใหม่
- ตรวจตารางแยก Cell, Numeric Strict และ Cross-Cell Contamination
- ส่งออก TXT, Markdown, HTML, CSV, JSON, DOCX, XLSX และ PDF
- PWA ติดตั้งเป็นแอปและเตรียมใช้งานออฟไลน์

## RipScan 2.0 — Review-first OCR

เวอร์ชัน 2.0 เปลี่ยนหลักการจาก **Reject เมื่อไม่มั่นใจ** เป็น **เก็บไว้ให้ตรวจ**

สถานะ Region:

- `verified`
- `review_required`
- `possible_text`
- `likely_non_text`
- `confirmed_non_text`

เฉพาะ `confirmed_non_text` เท่านั้นที่ถูกตัดจาก Structured Text และ Export

ค่าเริ่มต้น:

```text
verified_text_threshold = 0.88
possible_text_threshold = 0.45
confirmed_non_text_threshold = 0.15
decorative_font_possible_threshold = 0.30
small_text_possible_threshold = 0.25
```

Text Evidence ใช้หลายเงื่อนไขร่วมกัน โดยไม่บังคับให้ผ่านทุกข้อพร้อมกัน:

- Baseline
- Glyph Pattern
- Connected Components แนวนอน
- OCR Candidate
- Thai Script Candidate
- Character Height Consistency
- Spacing Consistency
- Expected Text Position
- Foreground Contrast
- Line-like Bounding Box

## Cover / Poster OCR Recovery

Document Mode:

- `cover_page`
- `worksheet_cover`
- `book_cover`
- `poster`
- `certificate_cover`
- `infographic`
- `illustrated_document`
- `normal_document`

Cover Zone:

1. `top_illustration`
2. `main_title`
3. `subtitle`
4. `class_level`
5. `author_name`
6. `school_name`
7. `organization_name`
8. `footer_text`

หากหน้าปกพบ Text Block น้อยกว่า 3 หรือไม่พบหัวข้อ/ข้อมูลโรงเรียน ระบบจะทำ Recovery Scan เพิ่มเติม

Recovery Variant:

- Original
- Padded Crop
- Upscale 4x
- Upscale 6x
- Color Isolation
- Grayscale
- CLAHE-like Contrast
- Background Removal
- Edge-preserving Sharpen
- Soft Binary Mask

ข้อความสีทอง สีขาว ฟอนต์หนา ฟอนต์ประดิษฐ์ และข้อความเล็กด้านล่างจะถูกเก็บเป็น `possible_text` หรือ `review_required` แทนการลบทิ้งทันที

## Non-Text Safety

ระบบจะยืนยัน `confirmed_non_text` เมื่อ:

- ไม่มี Baseline
- ไม่มี Glyph Pattern
- ไม่มี OCR Candidate
- มีหลักฐานรูป/ลวดลายชัดเจน
- ตัวตรวจ Non-Text หลายรอบตรงกัน
- หรือผู้ใช้กด **เป็นรูป ไม่ใช่ข้อความ**

Region ที่ยังไม่แน่ใจจะเป็น `likely_non_text` และเข้าสู่ Secondary Detection

Barcode และ QR Code ถูกส่งไป Barcode Reader ไม่เข้าสู่ Text OCR

## Overlay และ Manual Review

Document Viewer แสดงกรอบ:

- เขียว: `verified`
- เหลือง: `review_required`
- ส้ม: `possible_text`
- เทา: `likely_non_text`
- ไม่แสดง `confirmed_non_text`

Toggle:

- แสดงข้อความทั้งหมด
- เฉพาะข้อความยืนยันแล้ว
- พื้นที่ที่ควรตรวจ
- Non-Text ที่ยังไม่ยืนยัน

ผู้ใช้สามารถ:

- ลากกรอบข้อความเอง
- เลือกภาษา
- ระบุหัวข้อ ชื่อบุคคล ชื่อโรงเรียน หน่วยงาน หรือชั้นเรียน
- OCR พื้นที่ที่ลากทันที
- อ่านใหม่เฉพาะ Block
- แก้ข้อความ
- ยืนยัน Block
- ระบุว่าเป็นรูป ไม่ใช่ข้อความ

## Broken Sara Am — สระอำแยกเป็นช่องว่าง

ตรวจรูปแบบ เช่น:

```text
การน าเสนอ
การด าเนินงาน
จ านวน
ส านักงาน
ค าแนะน า
ช านาญ
ส าคัญ
ก าหนด
ต าแหน่ง
ส าเร็จ
อ าเภอ
ส าหรับ
ล าดับ
```

ระบบทำงานตามลำดับ:

1. เก็บ Raw OCR
2. Unicode Normalize
3. ตรวจ Zero-width Character
4. ตรวจ Broken Grapheme
5. ตรวจ Broken Sara Am
6. ตรวจ Internal Whitespace
7. ตรวจ Thai Syllable
8. สร้าง Candidate
9. ตรวจ Image Evidence
10. Auto-fix หรือส่ง Manual Review

Auto-fix ทำได้เมื่อ:

- OCR อย่างน้อย 2 Variant เห็น `ำ`
- Image Evidence ≥ 0.98
- Bounding Box สนับสนุน
- Thai Grapheme/Syllable ถูกต้อง
- Provider Agreement ผ่าน
- Confidence ≥ 0.98
- ไม่ใช่ชื่อเฉพาะ

คำจริง เช่น `นา`, `ดา`, `ลา`, `อา`, `ตา` จะไม่ถูกเปลี่ยนเป็นสระอำอัตโนมัติ

Crop สำหรับคำที่สงสัยใช้ Padding:

```text
top = 30%
bottom = 15%
left/right = 15%
```

เพื่อไม่ให้จุดนิคหิตด้านบนถูกตัด

## Export

ข้อความที่ส่งออก:

- รวม `verified`
- เก็บ `review_required` พร้อม `[โปรดตรวจสอบ: ...]`
- เก็บ `possible_text` พร้อม `[อาจเป็นข้อความ: ...]`
- ไม่รวม `confirmed_non_text`
- เมื่อผู้ใช้ยืนยันแล้ว ใช้ข้อความที่ยืนยันแทน Marker

ยังคงรักษา:

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

## ทดสอบและ Build

```bash
npm test
npm run check
npm run build
```

Build จะตรวจ Unit/Regression Tests, JavaScript Syntax และสร้าง Static output ที่ `dist/`

## รัน Local

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
npm install
npm run build
uvicorn api.index:app --host 0.0.0.0 --port 8000
```

เปิด `http://localhost:8000`

## รายงานการประเมิน

ดูรายละเอียด:

- `docs/review-first-cover-sara-am-v2.md`
- `docs/cover-poster-ocr-evaluation-v1.9.md`
- `docs/book-cover-thai-ocr-evaluation.md`

> RipScan ไม่รับประกันความแม่น 100% ข้อความที่ภาพไม่ชัด ชื่อเฉพาะ และฟอนต์ประดิษฐ์จะถูกส่ง Manual Review แทนการเดา
