# RipScan 2.0 — Review-first Cover OCR และ Broken Sara Am

วันที่ประเมิน: 12 กรกฎาคม 2026

## ขอบเขต

การอัปเกรดนี้แก้ปัญหา 2 กลุ่ม:

1. Cover OCR กรอง Text Region แรงเกินไปจนหัวข้อ ชื่อบุคคล ชื่อโรงเรียน และข้อความเล็กหาย
2. สระอำถูกแยกเป็นช่องว่าง เช่น `การน าเสนอ`

หลักการสำคัญคือ **ข้อความที่ยังไม่แน่ใจต้องถูกเก็บไว้ตรวจ ไม่ใช่ถูกลบทิ้ง**

## สถานะใหม่

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

## Flow ใหม่

```text
Layout/Region Detection
→ ตรวจ Text Evidence แบบหลายเงื่อนไข
→ Verified / Review Required / Possible Text
→ ถ้า Evidence ต่ำ ให้ Secondary Detection
→ Confirmed Non-Text เฉพาะเมื่อหลายตัวตรวจตรงกัน
→ Cover Zone Recovery เมื่อ Text Block น้อยกว่า 3
→ Editor แสดงทุก Block ที่ยังอาจเป็นข้อความ
```

Text Evidence ใช้แบบ OR-combination ไม่บังคับผ่านทุกข้อ:

- Baseline
- Glyph Pattern
- Connected Components แนวนอน
- OCR Candidate
- Thai Script Candidate
- Character Height Consistency
- Spacing Consistency
- ตำแหน่งที่คาดว่าเป็นข้อความ
- Foreground Contrast
- Bounding Box ลักษณะบรรทัด

## Cover Zone Recovery

Zone ที่ตรวจ:

1. `top_illustration`
2. `main_title`
3. `subtitle`
4. `class_level`
5. `author_name`
6. `school_name`
7. `organization_name`
8. `footer_text`

ถ้า Cover Page พบ Text Block น้อยกว่า 3 หรือขาดหัวข้อ/ข้อมูลด้านล่าง ระบบจะอ่าน Zone ที่ขาดด้วย Variant:

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

ข้อความฟอนต์ประดิษฐ์และข้อความขนาดเล็กจะเป็น `possible_text` หรือ `review_required` ไม่ถูก Reject ทันที

## Regression Fixture สำหรับ Cover Flow

Fixture เชิงโครงสร้างจำลองปัญหาเดิมที่เหลือเพียงชื่อบุคคลหนึ่ง Block

### ก่อนอัปเกรด

| Block | สถานะ |
|---|---|
| นางสาวชญาณี จิตต์ซื่อ | review_required |

Text Block ที่เก็บไว้: **1**

### หลังอัปเกรด

| Block | สถานะเป้าหมาย |
|---|---|
| ใบกิจกรรมวรรณคดี | verified/review_required |
| ชั้นมัธยมศึกษาปีที่ ๑ | review_required |
| นางสาวชญาณี จิตต์ซื่อ | review_required |
| โรงเรียนภูเก็ตวิทยาลัย | possible_text/review_required |
| สำนักงานเขตพื้นที่การศึกษา มัธยมศึกษาพังงา ภูเก็ต ระนอง | possible_text/review_required |

Text Block หลัง Recovery: **5**  
Block ที่ Recovery กลับมาได้: **4**  
Expected Text Recall ของ Fixture: **1/5 → 5/5**

ตัวเลขนี้เป็น Structural Regression Fixture ไม่ใช่ End-to-End Accuracy ของภาพหน้าปกทุกแบบ

## Actual-image Benchmark: Thai Sara Am Fixture

ทดสอบกับภาพ PNG จริงพื้นหลังไล่สี ข้อความสีขาว และรูปประกอบ โดยใช้ Tesseract 5.5.0 ภาษา `tha+eng` แบบ PSM 6

Ground Truth เฉพาะ 4 บรรทัดภาษาไทยมีสระอำ 21 ตำแหน่ง

### ผล OCR ดิบ

```text
การดําเนินการและจ้ํานวนสํานักงาน
ดําเนินการ จํานวน สํานักงาน สําคัญ คําหนด คําแนะนํา
ชํานาญ อํานาจ จําเป็น นําเสนอ ตําแหน่ง สําเร็อ
สําหรับ กคําสัง บํารุง ลําดับ จําเภอ คุณธรรม
```

### หลัง Unicode Sara Am Normalization

```text
การดำเนินการและจ้ำนวนสำนักงาน
ดำเนินการ จำนวน สำนักงาน สำคัญ คำหนด คำแนะนำ
ชำนาญ อำนาจ จำเป็น นำเสนอ ตำแหน่ง สำเร็อ
สำหรับ กคำสัง บำรุง ลำดับ จำเภอ คุณธรรม
```

### Metrics จากภาพจริง

| Metric | ก่อน | หลัง Unicode Normalize |
|---|---:|---:|
| Precomposed `ำ` ที่ตรวจพบ | 0/21 | 21/21 |
| Thai CER | 32.68% | 3.92% |
| Thai WER | 94.74% | 26.32% |

Normalization แก้รูป Unicode `ํา` → `ำ` ได้ครบ แต่ยังไม่แก้คำผิดจากรูปร่าง เช่น:

- `จ้ำนวน`
- `คำหนด`
- `สำเร็อ`
- `กคำสัง`
- `ำเภอ`

คำเหล่านี้ต้องอ่าน Variant เพิ่มหรือส่ง Manual Review ห้ามแก้จาก Dictionary อย่างเดียว

## Broken Sara Am Spacing Regression

ชุดทดสอบครอบคลุม 13 รูปแบบ:

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

ผลระดับกฎ:

- ตรวจ Pattern: **13/13**
- สร้าง Candidate ที่ถูกต้อง: **13/13**
- คำจริงที่ห้ามรวมอัตโนมัติ `นา ดา ลา อา ตา`: **5/5 ไม่ถูกเปลี่ยน**
- ชื่อเฉพาะ/ชื่อหน่วยงาน: ส่ง `review_required`
- Auto-fix: ทำเฉพาะเมื่อ 2+ Variant เห็น `ำ`, Image Evidence ≥ 0.98, Bounding Box สนับสนุน, Provider Agreement ผ่าน และ Confidence ≥ 0.98

## Manual Review UI

- Overlay สีเขียว: `verified`
- สีเหลือง: `review_required`
- สีส้ม: `possible_text`
- สีเทา: `likely_non_text`
- ไม่แสดง `confirmed_non_text`

Toggle:

- แสดงข้อความทั้งหมด
- เฉพาะข้อความยืนยันแล้ว
- พื้นที่ที่ควรตรวจ
- Non-Text ที่ยังไม่ยืนยัน

Broken Sara Am แสดง:

- Raw OCR
- Candidate
- Confidence
- ปุ่มยืนยันคำแนะนำ
- ปุ่มคงข้อความเดิม
- ปุ่มอ่านใหม่

เครื่องมือวาดกรอบข้อความจะ OCR พื้นที่ใหม่ทันที

## ข้อจำกัดและความซื่อสัตย์ของผลวัด

- ภาพหน้าปกต้นฉบับที่มีพญานาค/ตัวละครและ Ground Truth Bounding Box ไม่ได้อยู่ใน repository หรือ File Library ที่ค้นได้ในรอบนี้
- จึงยังไม่รายงาน Automatic Text Region Precision/Recall และ Confidence ราย Block ของภาพดังกล่าว
- Cover 1→5 เป็น Regression Fixture ที่ตรวจ Flow และสถานะ
- Sara Am CER/WER ด้านบนมาจากภาพ PNG จริงที่มี Ground Truth
- Browser End-to-End OCR ยังต้องทดสอบซ้ำเมื่อ Vercel Preview พร้อมและมีภาพหน้าปกต้นฉบับ
