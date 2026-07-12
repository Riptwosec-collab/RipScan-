# ผลประเมิน Cover / Poster OCR — RipScan 1.9

วันที่ทดสอบ: 12 กรกฎาคม 2569

เอกสารนี้รายงานเฉพาะผลที่วัดได้จากชุดทดสอบจำกัด ไม่ใช่ Accuracy ของเอกสารทุกประเภท และไม่ใช้ Fixture จำลองอ้างเป็น Production Accuracy

## ชุดทดสอบ

### 1. ภาพจริงที่ผู้ใช้ส่ง

ใช้ภาพหน้าจอเว็บไซต์ขนาด 1926 × 816 พิกเซล ซึ่งมี:

- พื้นหลังน้ำเงิน–ม่วงแบบ Gradient
- ภาพประกอบไฟล์ PDF/OCR/เอกสาร
- ไอคอนและเส้นตกแต่ง
- ข้อความไทยขนาดใหญ่และเล็ก
- ไทย–อังกฤษผสม
- การ์ดและเส้นขอบจำนวนมาก

สร้าง Ground Truth ด้วยมือ 9 Text Regions ครอบคลุม Hero, Upload และ OCR Settings

### 2. Controlled Illustrated Cover Fixture

สร้าง Fixture ขนาด 1200 × 1600 พิกเซล มี:

- พื้นหลังไล่สี
- กรอบหลายชั้น
- ลายเส้นโค้งสีทอง
- ตัวละครวงกลม 5 ตำแหน่ง
- จุดดาวและกราฟิกตกแต่ง
- หัวข้อไทยฟอนต์หนาและมีเงา
- ชั้นเรียน ชื่อบุคคล โรงเรียน และหน่วยงาน

Ground Truth:

```text
ใบกิจกรรมวรรณคดี
ชั้นมัธยมศึกษาปีที่ ๑
นางสาวชญาณี จิตต์ซื่อ
โรงเรียนตัวอย่างวิทยา
สำนักงานเขตพื้นที่การศึกษา
```

## วิธีเปรียบเทียบ

### ก่อนอัปเกรด

- ส่งภาพทั้งหน้าเข้า Tesseract `tha+eng`
- ไม่มีการจำกัด Text Region
- รูป ไอคอน และเส้นตกแต่งอยู่ในภาพ OCR เดียวกัน

### หลังอัปเกรดในการวัดนี้

- ใช้ Text Block ที่กำหนด Ground Truth หรือวาดกรอบด้วย Manual Text Region Tool
- OCR แยกแต่ละ Block
- ใช้ Original, Grayscale, Contrast และ Upscale
- เลือกผลจาก Confidence และ Gibberish penalty
- ไม่รวม Region นอกกรอบข้อความในผลลัพธ์

> หมายเหตุ: ตัวเลขหลังอัปเกรดเป็นผล Block OCR เมื่อทราบ Text Region หรือผู้ใช้วาดกรอบแล้ว ไม่ใช่ Accuracy ของ Automatic Region Detector แบบ End-to-End

## ผลภาพจริงที่ผู้ใช้ส่ง

| Metric | Whole-page OCR | Block OCR |
|---|---:|---:|
| CER | 68.71% | 23.56% |
| บรรทัดที่เข้าข่าย Noise/Gibberish | 24/51 | 0/9 |
| Noise-line rate | 47.06% | 0.00% |

ผล Whole-page OCR มีบรรทัดรบกวน เช่น:

```text
S
|
SS
=
a
Ke
i
I
๒0!
BZ
+
```

เมื่ออ่านเฉพาะ Text Regions บรรทัดรบกวนจากภาพประกอบลดลง แต่ยังมีคำที่ต้องตรวจ เช่น:

```text
เปลี่ยนภาพ → เปลียนภาพ
เป็นข้อความที่ → เป็นข้อความทิ
ลากไฟล์มาวาง หรือคลิกเพื่อเลือก → ลากไฟล์มาวางหรอคลกเพอเลอก
เซิร์ฟเวอร์ → เชิร์ฟเวอร์
```

## ผล Controlled Illustrated Cover Fixture

| Metric | Whole-page OCR | Block OCR |
|---|---:|---:|
| CER | 32.11% | 23.85% |
| บรรทัด Noise จากกราฟิก | 2/7 | 0/5 |
| Noise-line rate | 28.57% | 0.00% |

ตัวอย่าง Whole-page OCR:

```text
= =i
ใบคกือกรรมวรรญณคลดี
ชนมรวศศขาททร
|
นางสาวชญาณีจิตต์ชื่อ -
.โรงเรียนตัวอย่างวิทยา ie
สํานักงานเขตพื้นที่การศึกษา
```

ตัวอย่าง Block OCR:

```text
ใบคกคืจอกรรมวรรญณคลี
ชื่นงั๊ชขบฆียวปที่ว
นางสาวชญาณีจิตต์ซื้อ
. โรงเรียนตัวอย่างวิทยา
สํานักงานเขตพื้นที่การศึกษา
```

## สาเหตุที่รูปถูกอ่านเป็นข้อความ

1. เส้นโค้ง กรอบ และลายประดับสร้าง Connected Components คล้าย Glyph
2. รูปที่มี Contrast สูงสร้างเส้นแนวตั้ง/แนวนอนคล้าย Baseline
3. Whole-page OCR พยายามบังคับทุกพื้นที่ให้เป็น Text Line
4. ฟอนต์ประดิษฐ์และเงาตัวอักษรทำให้เส้นจริงกับเส้นตกแต่งแยกยาก
5. ตัวอักษรเล็กอยู่ใกล้ไอคอน ทำให้ Bounding Box รวมภาพและข้อความ
6. Script Model พยายามคืนอักขระแม้หลักฐานภาพไม่เพียงพอ

## สิ่งที่เพิ่มใน RipScan 1.9

### Cover Document Classifier

รองรับ:

- `cover_page`
- `worksheet_cover`
- `book_cover`
- `poster`
- `certificate_cover`
- `infographic`
- `illustrated_document`
- `normal_document`

### Text / Illustration Classifier

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

Text Region ต้องมี Baseline, Character-like Components, Glyph Alignment, Height Consistency, Spacing Consistency และจำนวน Glyph ขั้นต่ำ

### Gibberish Detector

Reject หรือส่ง Review เมื่อพบ:

- Symbol ratio มากกว่า 25%
- Script เปลี่ยนหลายครั้งใน Token เดียว
- รูปแบบพยางค์ไทยผิดปกติ
- สัญลักษณ์ `| [ ] + @ #` ซ้ำ
- OCR Confidence ต่ำ
- ไม่มี Baseline
- Bounding Box ไม่สอดคล้องกับข้อความ

### Confidence Gate

ค่าเป้าหมาย:

```text
Text Region Confidence >= 0.90
OCR Confidence >= 0.90
Script Confidence >= 0.92
Thai Grapheme Confidence >= 0.94
Protected Name/School OCR >= 0.97
```

ชื่อบุคคลและชื่อสถานศึกษาไม่ถูกแก้อัตโนมัติ เมื่อหลักฐานไม่พอจะส่ง Manual Review

### Decorative Font Variants

- Original Crop
- Upscale 4x
- Upscale 6x
- Grayscale
- Contrast Soft
- CLAHE-like Contrast
- Background Flattened
- Edge-preserving Sharpen
- Color Isolation
- Text Mask
- HSV Foreground Extraction เมื่อ Contrast ต่ำหรือมีเงา

### Manual Text Region Tool

ผู้ใช้สามารถ:

- วาดกรอบข้อความเอง
- ลบกรอบที่จับผิด
- ระบุภาษา
- ระบุหัวข้อ ชื่อบุคคล ชื่อโรงเรียน หรือหน่วยงาน
- OCR ใหม่เฉพาะกรอบ
- ระบุว่าเป็นรูป ไม่ใช่ข้อความ
- ยืนยันข้อความก่อนเพิ่มเข้าเอกสาร

## Automated Test

Vercel Preview ล่าสุด:

```text
79 tests
79 passed
0 failed
Syntax check passed
Static build passed
```

ครอบคลุม:

- Cover/Poster Classification
- Text Line Evidence
- Illustration/Ornament Rejection
- Gibberish Rejection
- Name/School Protection
- Strict Confidence Gate
- Output Filtering
- Decorative Font Variant Plan
- Text Block Grouping
- Cover Metrics
- Manual Region UI
- Responsive layout และ Overflow regression

## ข้อความที่อ่านถูกหรือใกล้เคียง

- `โรงเรียนตัวอย่างวิทยา`
- `สำนักงานเขตพื้นที่การศึกษา` หลัง Unicode Sara Am normalization
- ชื่อบุคคลอ่านได้ใกล้เคียง แต่ยังถูกส่ง Review ตามเกณฑ์ชื่อเฉพาะ
- ข้อความ UI ขนาดกลางส่วนใหญ่ดีขึ้นเมื่ออ่านแยก Block

## ข้อความที่ยังต้องตรวจ

- หัวข้อไทยฟอนต์หนาและมีเงา
- ข้อความสีขาวขนาดเล็ก
- ชั้นเรียนที่ใช้เลขไทยและตัวอักษรชิดกัน
- ชื่อบุคคลที่มีสระ/วรรณยุกต์ซับซ้อน
- ข้อความใกล้ไอคอน กรอบ หรือเส้นลวดลาย

## Metrics ที่ยังเป็น N/A

ยังไม่มี Dataset หน้าปกจริงที่ Label Bounding Box จำนวนมากพอ จึงยังไม่รายงาน Production Accuracy สำหรับ:

- Automatic Text Region Precision/Recall
- Automatic Non-Text Rejection Accuracy
- Automatic False Text Detection Rate
- Decorative Thai Font Accuracy ข้ามฟอนต์
- Name Accuracy ข้ามชื่อจริงหลายรูปแบบ
- School Name Accuracy ข้ามโรงเรียนหลายแห่ง

ฟังก์ชันคำนวณ Metrics ถูกเพิ่มแล้ว แต่ระบบจะไม่เติมตัวเลขจาก Synthetic Fixture แทน Production Dataset

## ข้อจำกัด

- Automatic Region Classifier ใน Browser เป็น Image Heuristic ไม่ใช่โมเดล Object Detection ขนาดใหญ่
- ภาพพญานาคต้นฉบับที่กล่าวถึงในข้อกำหนดไม่ได้ถูกแนบมากับรอบนี้ จึงยังไม่ได้รายงานผลเฉพาะภาพนั้น
- Browser ที่ไม่มี BarcodeDetector ไม่รับประกันการถอด EAN/QR
- Text ที่ทับรูปภาพซับซ้อนอาจต้องใช้ Manual Text Region Tool
- การทดสอบ UI เป็น Unit/Static Integration Test ยังไม่ใช่ Playwright End-to-End บนทุก Browser
