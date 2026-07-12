# ผลประเมิน OCR ปกหนังสือ พื้นหลังไล่สี และภาษาไทยขนาดเล็ก

อัปเดต: 12 กรกฎาคม 2569

เอกสารนี้รายงานผลที่วัดได้จริงของ RipScan 1.8 โดยแยก **ผลจากภาพจริงที่ผู้ใช้ส่ง** ออกจาก **Fixture ที่สร้างเพื่อควบคุม Ground Truth** อย่างชัดเจน ตัวเลขในเอกสารนี้ไม่ใช่ Accuracy ของเอกสารทุกประเภท

## ขอบเขตการทดสอบ

### ภาพจริง

ใช้ภาพหน้าจอพื้นหลังน้ำเงิน–ม่วงที่มี:

- ตัวอักษรไทยสีขาวและ Gradient
- ข้อความขนาดใหญ่และขนาดเล็ก
- ไทย–อังกฤษผสม
- ไอคอนและกราฟิกหลายโซน

กำหนด Ground Truth ด้วยมือ 3 บริเวณ ได้แก่ Hero, ข้อความอธิบาย และหัวข้อตั้งค่า OCR

### Fixture ควบคุม

สร้างภาพพื้นหลังไล่สีที่มีคำสระอำ รหัสที่มีขีด En dash Slash Underscore และเส้นคั่น เพื่อวัดพฤติกรรมแบบทำซ้ำได้

Fixture ไม่ใช่ภาพหนังสือจริงและไม่ใช้สรุป Production Accuracy

## ผลภาพจริงก่อนและหลัง

คำว่า “หลัง” ในตารางนี้คือ **ผล Variant ที่ดีที่สุดในการทดลองแบบมี Ground Truth** เพื่อวัดศักยภาพของ Preprocessing แต่ละ Variant ไม่ใช่การรับประกันว่า Runtime Ranker จะเลือก Variant เดียวกันทุกครั้ง

| บริเวณ | CER ก่อน | CER Variant ดีที่สุด | WER ก่อน | WER Variant ดีที่สุด | Variant |
|---|---:|---:|---:|---:|---|
| Hero | 11.36% | 11.36% | 40.00% | 40.00% | Original |
| ข้อความอธิบาย | 11.65% | 7.77% | 54.55% | 36.36% | Upscale 4x + CLAHE-like |
| หัวข้อตั้งค่า | 54.12% | 54.12% | 122.22% | 122.22% | Original |
| **รวมแบบถ่วงน้ำหนัก** | **27.16%** | **25.43%** | **76.00%** | **68.00%** | หลาย Variant |

ผลรวม CER ลดลงประมาณ 6.35% แบบ Relative และ WER ลดลงประมาณ 10.53% แบบ Relative ในตัวอย่างภาพจริงนี้ จุดที่ยังอ่านยากที่สุดคือข้อความขนาดเล็กติดไอคอนและเส้นกรอบ

## เปรียบเทียบแบบคำต่อคำจากภาพจริง

### ข้อความอธิบาย

Ground Truth:

```text
อัปโหลดไฟล์ภาพ หรือ PDF ของคุณ
ให้ AI OCR อ่านและแปลงเป็นข้อความที่แก้ไขได้ทันที
รวดเร็ว แม่นยำ ปลอดภัย
```

ก่อน:

```text
อัปโหลดไฟล์ภาพ หรือ POF ของคุณ
WAI OCR อ่านและแปลงเป็นข้อความที่แก้ไขได้ทันที
รวดเร็ว * แม่นยํา = ปลอดภัย
```

Variant ที่ดีที่สุด:

```text
อัปโหลดไฟล์ภาพ หรือ PDF ของคุณ
ให้ AI OCR อ่านและแปลงเป็นข้อความที่แก้ไขได้ทันที
รวดเร็ว = แม่นยํา = ปลอดภัย
```

สิ่งที่ดีขึ้น:

- `POF` → `PDF`
- `WAI OCR` → `ให้ AI OCR`

สิ่งที่ยังผิด:

- Bullet จุดกลางถูกอ่านเป็น `=`
- `แม่นยำ` ยังออกมาเป็น Unicode แบบแยก `แม่นยํา` ก่อนผ่าน Sara Am Normalizer

### Hero

Ground Truth:

```text
เปลี่ยนภาพ
และ PDF
เป็นข้อความที่
ตรวจแก้ได้
```

ผล OCR ยังมี `,` เกินและคำว่า `และ` บาง Variant ถูกอ่านเป็น Latin noise จึงต้องใช้ Failure Detector และ Manual Review แทนการเดาคำ

## ผล Fixture ภาษาไทยและเครื่องหมาย

| Metric | ก่อน | หลัง Unicode Normalization | หลังแบ่ง Block + Variant |
|---|---:|---:|---:|
| CER | 34.32% | 18.82% | 9.23% |
| WER | 78.79% | 39.39% | 42.42% |
| สระอำรูปประกอบสำเร็จ `ำ` | 0/21 | 21/21 | 21/21 |
| รูปแยก `ํา` ที่ตรวจพบ | 21/21 | ถูก Normalize | ถูก Normalize |
| Dash Preservation จาก OCR | 46.15% | 46.15% | 46.15% |

CER ดีขึ้นมากหลัง Normalize `ํา` เป็น `ำ` และอ่านแยก Block แต่ WER ยังถูกกระทบจากคำอื่น เช่น `ดำเนินการ` บางรอบเป็น `ดำเน็นการ` และรหัสตัวเลขบางส่วนยังอ่านผิด

Dash Preservation ในระดับ **ข้อความที่ OCR อ่านออกมาแล้ว** ผ่าน Unit Test แบบ byte-for-byte แต่ Dash Accuracy จากภาพ Fixture ยังอยู่ที่ 46.15% เพราะ Tesseract อ่านตัวเลขรอบขีดผิดหรือเพิ่ม `_` การอัปเกรดนี้จึงรักษาขีดที่ตรวจพบและส่ง Block รหัสที่ไม่มั่นใจเข้าตรวจสอบ ไม่อ้างว่าสามารถกู้ขีดที่ OCR ไม่เห็นได้ครบ 100%

## สาเหตุที่สระอำหาย

1. จุดนิคหิตด้านบนมีขนาดเล็กและหายเมื่อใช้ Threshold หรือ Denoise แรงเกินไป
2. ความละเอียดตัวอักษรต่ำทำให้ `ํ` แยกออกจาก `า`
3. พื้นหลัง Gradient ทำให้ Contrast ของจุดนิคหิตไม่เท่ากับตัวอักษรส่วนล่าง
4. OCR อาจคืน Unicode แบบประกอบ `ํา` แทนตัว `ำ`
5. การอ่านทั้งหน้าเปิดโอกาสให้เส้น ไอคอน และรูปภาพรบกวน Baseline ของตัวอักษร

## วิธีที่ใช้ใน RipScan 1.8

### Text/Image/Barcode Region

- ตรวจ Text-line energy และ Connected Components
- ข้าม Region ที่มี Texture/Color Variance สูงแต่ไม่มีแนวข้อความ
- ตรวจ Barcode ก่อน Text OCR ด้วย BarcodeDetector เมื่อ Browser รองรับ
- Region ที่คล้าย Barcode แต่ถอดรหัสไม่ได้จะไม่ถูกนำไปสร้างข้อความโดยอัตโนมัติ
- OCR แยก Block และเก็บ Bounding Box

### Sara Am และ Thai Grapheme

- Normalize เฉพาะ `ํา` → `ำ` พร้อมเก็บ Change Log
- ไม่เปลี่ยน `จานวน` เป็น `จำนวน` โดยอัตโนมัติ
- สร้าง Candidate และส่ง Review เมื่อ Confidence ต่ำกว่า 96%
- ตรวจ Floating Mark, วรรณยุกต์ซ้ำ, สระอำซ้ำ และ Unicode Order
- Dictionary เพิ่มคะแนน Candidate เพียงเล็กน้อย ภาพและ Confidence มีน้ำหนักมากกว่า Context

### Gradient และ Small Text

สร้าง Candidate Variant ต่อ Block:

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

ถ้าความสูงข้อความต่ำเกินเกณฑ์ ระบบจะแสดง Low Resolution และไม่เดาข้อความ

### Dash และ Separator

- แยก `-`, `–`, `—`, `−`, `_`, `/`, `|`
- จำแนก Document Code, Range, Sentence Separator และ Separator Line
- ไม่ใช้การ Normalize ที่เปลี่ยน Dash ชนิดหนึ่งเป็นอีกชนิด
- เก็บเส้นคั่นเป็น Structured Element
- Export ใช้ข้อความ Unicode เดิมหลังผู้ใช้ยืนยัน

## Metrics ที่ยังไม่สามารถสรุปเป็น Production Accuracy

ยังไม่มีชุดภาพปกหนังสือจริงพร้อม Ground Truth จำนวนมากพอสำหรับรายงานต่อไปนี้อย่างน่าเชื่อถือ:

- Image Region Exclusion Accuracy
- False Text Detection on Image
- Thai Vowel Accuracy แยกทุกชนิด
- Thai Tone Mark Accuracy
- EAN/ISBN/QR Decode Accuracy ข้าม Browser
- Reading Order Accuracy บนปกหนังสือหลาย Layout

ระบบมีฟังก์ชันและข้อมูลสำหรับเก็บ Metrics เหล่านี้แล้ว แต่จะรายงานเป็น `N/A` จนกว่าจะมีชุดทดสอบจริง ไม่ใช้ Synthetic Fixture แทน Production Accuracy

## Test Status

Vercel Build ล่าสุด:

```text
61 tests
61 passed
0 failed
Syntax check passed
Static build passed
```

Unit Test ครอบคลุม:

- Sara Am Unicode และ Review Candidate
- Thai Grapheme
- Dash/Separator byte preservation
- Document Code, Range, Phone และ ISBN
- Text/Image/Barcode Region decision
- Reading Order
- Candidate Ranking ที่ห้ามสร้างคำใหม่
- Structured Export ที่ข้ามภาพและ Barcode
- UI Options, Review Panel และปุ่มล้างหน้าสแกน

## ข้อจำกัดที่เหลือ

- Browser ที่ไม่มี BarcodeDetector จะตรวจและแยกบริเวณ Barcode แต่ไม่รับประกันการถอดรหัส EAN/QR
- ตารางหรือปกที่มีตัวอักษรทับรูปภาพซับซ้อนยังอาจต้องครอปด้วยมือ
- Text Region Segmenter เป็น Algorithm ใน Browser ไม่ใช่โมเดล Object Detection ขนาดใหญ่
- ข้อความที่เล็กมากหรือเบลอจะถูกส่ง Review แทนการเดา
- การวัดครั้งนี้ใช้ภาพจริง 1 ภาพ 3 โซน และ Fixture ควบคุม 1 ภาพ จึงยังไม่เพียงพอสำหรับสรุป Accuracy ทั่วไป
