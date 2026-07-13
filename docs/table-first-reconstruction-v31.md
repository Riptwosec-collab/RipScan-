# RipScan 3.1 — Table-first Reconstruction

## ขอบเขต

เวอร์ชันนี้เปลี่ยนการประมวลผลเอกสารตารางจากการ OCR ทั้งหน้าแล้วแบ่งข้อความภายหลัง เป็นลำดับ:

```text
ตรวจเส้นตาราง
→ สร้าง Grid
→ ตรวจแถวและคอลัมน์
→ ตรวจเส้นภายในที่หายเพื่อหา Merged Cell
→ Crop และ OCR แยกทีละ Cell
→ ตรวจ Cell / Row / Table Context
→ สร้าง Editable Table
```

ผลลัพธ์หลักเป็นตารางจริงใน Document Model ไม่ใช่ Markdown ที่ใช้เครื่องหมาย `|` และไม่ใช่ภาพแบน

## Regression Fixture จากภาพจริง

ใช้ภาพตารางราชการที่ผู้ใช้ให้มาเป็นแหล่ง Geometry โดยบันทึกเฉพาะค่าตำแหน่งเส้นแบบไม่เก็บข้อมูลส่วนบุคคลใน `tests/fixtures/government-table-page2.json`

ค่าที่ตรวจจากภาพขนาด 437×558 พิกเซล:

```text
Vertical lines:   46, 94, 267, 305, 360, 419
Horizontal lines: 51, 88, 233, 347, 379, 412, 461
Columns:          5
Row bands:        6
Page label:       2/3
```

เส้นแนวนอนบางช่วงไม่ต่อผ่านทุกคอลัมน์ เป็นหลักฐานของ Cell ที่รวมแนวตั้ง ระบบจึงใช้ Segment Coverage แทนการบังคับให้ทุกเส้นพาดทั้งตาราง

## ก่อนอัปเกรด

- ตารางอาจถูกส่งเป็นข้อความก้อนเดียว
- ระบบอัตโนมัติอาจเขียน Markdown `| ... |` ลง Textarea
- เส้นตารางอาจกลายเป็น `| | |`
- ข้อความจากหลาย Cell อาจปนกัน
- Merged Cell และความกว้างคอลัมน์ไม่อยู่ในผลลัพธ์หลัก
- ผู้ใช้ต้องเปิดเครื่องมือวิเคราะห์อีกชั้นก่อนแก้ Cell

## หลังอัปเกรด

- สร้าง Grid ก่อน OCR
- รักษาความกว้างคอลัมน์และความสูงแถวตามเส้นจริง
- ตรวจ Merged Cell จากเส้นกั้นภายในที่ขาด
- OCR ไม่เกิน 4 Variant ต่อ Cell
- Fast Pass ใช้ 2 Variant และ Retry เฉพาะ Cell ที่ยังไม่ชัด
- แสดง Editable HTML Table ทันทีแทน Textarea
- มีสถานะ `verified`, `review_required`, `possible_text`, `contaminated`, `structure_conflict`, `empty`, `possibly_empty`
- มี Original Overlay, Cell Crop, Candidate และ Confidence
- เพิ่ม/ลบ/ย้ายเส้น Grid และอ่านใหม่เฉพาะ Cell ได้
- เปิดต่อใน Document Studio เพื่อแก้ Row, Column, Merge/Split, Border, Alignment, Font และส่งออก

## Gibberish Safety

ข้อความตัวอย่างต่อไปนี้ถูกจัดว่าเป็น Gibberish และไม่ผ่านเป็น `verified`:

```text
อหง โทร๒อ๕๓1อห1หส oo th | | |
```

สัญญาณที่ใช้ร่วมกัน:

- Pipe ซ้ำจากเส้นตาราง
- Script เปลี่ยนผิดธรรมชาติ
- Symbol Ratio สูง
- Confidence ต่ำ
- OCR Variant ไม่เห็นตรงกัน
- รูปแบบไม่ตรงกับประเภทคอลัมน์

หากยังอ่านไม่ได้ ระบบเก็บ Cell ไว้ใน Review ไม่ซ่อนหรือลบทิ้ง

## Strict Fields

คอลัมน์ติดต่อ เอกสารแนบ วันที่ และรหัสใช้ Validation แบบอนุรักษนิยม เช่น:

```text
094-359-3926
081-598-2746
Secretary.inspector1@rd.go.th
แบบ 8
แบบ 12
2/3
```

Validation ไม่แทน `0/O`, `1/I/l`, `5/S` หรือ `8/B` โดยไม่มีหลักฐาน OCR

## Performance

- Grid Detection และ Cell Crop ทำใน OffscreenCanvas Worker
- Desktop ใช้ OCR Worker สูงสุด 2 ตัว
- Mobile ใช้ OCR Worker 1 ตัว
- Fast Pass 2 Variant
- Retry รวมสูงสุด 4 Variantต่อ Cell
- ไม่ Retry ทั้งหน้าเมื่อแก้ Cell เดียว
- มี Cancel และ Progress ราย Cell
- ล้าง ImageData/Canvas และ Terminate Worker หลังงาน

## Export

Editable Table ถูกส่งเข้า Document Studio เป็น Table Block จริง จึงใช้เส้นทาง Export เดิมที่รองรับ:

- DOCX: ตารางจริง, Row/Column, Merge, Border, Alignment, Line Break
- XLSX: Cell จริง, Merge, Width/Height, Wrap, Text Field
- PDF และ Searchable PDF
- PNG/JPG พร้อม Width, Height, DPI, Scale, Quality และ Background

## ข้อจำกัดที่ยังเหลือ

- Grid Detector เป็น Image Heuristic ใน Browser ไม่ใช่โมเดล Table Structure Recognition ขนาดใหญ่
- ตารางที่ไม่มีเส้นหรือมีพื้นหลังซับซ้อนอาจต้องแก้ Grid ด้วยมือ
- Regression นี้ตรวจโครงสร้างจาก Geometry ของภาพจริง แต่ยังไม่ใช่การวัด Character Accuracy ครบทุก Cell
- ยังไม่ได้รัน Automated Browser E2E พร้อม Screenshot Comparison ในทุก Browser
- ความใกล้เคียงต้นฉบับขึ้นกับความคมชัด ภาพเอียง ฟอนต์ และเส้นตาราง จึงไม่รับประกัน 100% สำหรับทุกเอกสาร
