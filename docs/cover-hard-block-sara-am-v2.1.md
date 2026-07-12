# RipScan 2.1 — Cover Image Hard Block และ Broken Sara Am

## ปัญหาที่แก้

1. OCR อ่านรูปพญานาค ตัวละคร เรือ ตรา และลวดลายเป็นอักขระมั่ว
2. Token จาก Non-Text Region หลุดเข้า Editor และ Export
3. สระอำแตกเป็นช่องว่าง เช่น `บทร าพัน`, `การน าเสนอ`, `ส านักงาน`

## Flow ใหม่

```text
ตรวจประเภทหน้าปก
→ กำหนด Cover Image Hard Block
→ ปิด OCR ใน top_illustration และ Non-Text Region
→ ล้าง Token ของ Region ที่ถูก Block
→ ตรวจ Sanity ของ Text Zone
→ Recovery Scan เฉพาะ main_title / class / name / school / organization
→ OCR หลาย Variant
→ Broken Sara Am Reconstruction
→ Manual Review หรือ Safe Auto-fix
→ Editor / Export เฉพาะ Block ที่อนุญาต
```

## Region ที่ Hard Block

- illustration
- character_art
- animal_art
- ship_art
- decorative_frame
- ornament
- logo
- icon
- badge
- emblem
- background_shape
- photograph
- cartoon

Region เหล่านี้ถูกกำหนด:

```json
{
  "status": "confirmed_non_text",
  "action": "skip_text_ocr",
  "doNotEmitTokens": true,
  "emitToEditor": false,
  "emitToExport": false
}
```

## No-output-leak

Token ที่เคยพบจากภาพ เช่น:

```text
CAR A
CH ” =
0002
<= 5
| - TR uf 3 @ |
```

จะถูกเก็บเฉพาะใน `suppressedText` เพื่อ Audit และไม่ส่งไปยัง Editor หรือ Export

## Broken Sara Am v2.1

รองรับอย่างน้อย:

```text
บทร าพัน → บทรำพัน
การน าเสนอ → การนำเสนอ
ค าแนะน า → คำแนะนำ
ส านักงาน → สำนักงาน
จ านวน → จำนวน
ส าคัญ → สำคัญ
```

ระบบเก็บ Raw OCR, Candidate, Variant Agreement, Bounding Box Evidence และ Confidence แยกกัน

Safe Auto-fix ต้องผ่านทุกข้อ:

- OCR อย่างน้อย 2 Variant สนับสนุน Candidate
- Image Evidence ≥ 0.98
- Provider/Variant Agreement ≥ 0.66
- Bounding Box Support
- Confidence ≥ 0.98
- Candidate อยู่ในกลุ่มคำที่รองรับ
- ไม่ใช่ชื่อบุคคล ชื่อโรงเรียน ชื่อหน่วยงาน หรือชื่อสถานที่

หากไม่ครบ ระบบใช้สถานะ `broken_sara_am_review` และให้ผู้ใช้ยืนยัน

## ผลทดสอบภาพจริงจากหน้าปกที่แนบ

ภาพทดสอบเป็น Screenshot จริงขนาด 1107×712 พิกเซล โดย Crop หน้าปกด้านซ้ายเป็น 558×661 พิกเซล

### ก่อน Hard Block

OCR เฉพาะ `top_illustration` คืนข้อความมั่ว 9 บรรทัด ทั้งที่ Ground Truth ของโซนนี้กำหนดให้ไม่ส่งข้อความ:

```text
on “% / >
| Slt ได้ 2 60 |
- { A Ba +
) จุ ห ลบ we #”
ล ห
" | , ~~
% 7
- , x ะ๑ / 9
SS ae 4158
```

### หลัง Hard Block

```text
Top Illustration emitted lines: 0
Output leak count: 0
```

### Text Zone ที่ยังอ่านได้

ระบบแยกอ่านเฉพาะโซนข้อความและยังคง Candidate สำหรับ:

- ใบกิจกรรมวรรณคดี
- ชั้นมัธยมศึกษาปีที่ ๑
- นางสาวชญาณี จิตต์ซื่อ
- โรงเรียนภูเก็ตวิทยาลัย
- สำนักงานเขตพื้นที่การศึกษา
- มัธยมศึกษาพังงา ภูเก็ต ระนอง

ข้อความที่ OCR ยังไม่ตรงทั้งหมดจะอยู่ใน Manual Review ไม่ถูกเดาแก้โดย Dictionary

## Metrics ที่เพิ่ม

- Cover Hard-blocked Region Count
- Blocked Token Count
- Output Leak Count
- Cover Sanity Reasons
- Broken Sara Am Detection
- Sara Am Variant Agreement
- Sara Am Recovery Accuracy
- False Sara Am Merge Rate

## ข้อจำกัด

- Hard Block อาศัย Document Type และ Zone ของหน้าปก จึงต้องจัดประเภทเอกสารได้ถูกต้อง
- ข้อความจริงที่วางทับใน `top_illustration` จะถูก Block ตามนโยบายนี้ ยกเว้นผู้ใช้สร้าง Manual Text Region เอง
- Browser OCR ยังขึ้นกับคุณภาพภาพและโมเดล Tesseract
- ผลภาพจริงด้านบนเป็นการทดสอบกับ Screenshot หนึ่งภาพ ไม่ใช่ Accuracy สำหรับหน้าปกทุกชนิด
