# RipScan 2.2 — OCR Worker Queue, Performance และ OCR Safety

## ขอบเขต

อัปเกรดนี้แก้ปัญหา 3 กลุ่มพร้อมกัน:

1. สระอำแตก เช่น `บทร าพัน`, `การน าเสนอ`, `ส านักงาน`, `จ านวน`
2. Token จากรูปประกอบบนหน้าปกหลุดเข้า Editor/Export
3. หน้าเว็บหน่วงจากการสร้าง Variant และ OCR ซ้ำจำนวนมากบน Main Thread

## สาเหตุเดิม

### สระอำแตก

- จุดนิคหิตมีขนาดเล็กและถูก Threshold/Denoise กลืน
- Crop ด้านบนชิดเกินไป
- OCR แยก Grapheme เป็นพยัญชนะ + ช่องว่าง + `า`
- ผลจากแต่ละ Variant ไม่ถูกเปรียบเทียบในระดับคำอย่างเพียงพอ

### รูปถูก OCR

- Region จากรูปมีเส้น/ขอบ/Connected Components คล้าย Glyph
- Fallback เดิมสามารถคืนทั้งหน้าเป็น `unknown` แล้วส่งเข้า OCR
- Token จาก Non-text อาจถูกกรองหลัง OCR แทนการหยุดก่อนเรียก OCR

### เว็บค้าง

Pipeline ก่อนหน้า:

- สร้างภาพประมาณ 10 Variant ต่อ Block ไว้พร้อมกัน
- Fast Pass ใช้ได้ถึง 4 OCR Calls
- Retry ขยายได้ถึง 6 OCR Calls
- มี Upscale 4x/6x หลายภาพในหน่วยความจำพร้อมกัน
- Crop, Resize, Threshold และ Pixel Loop ทำบน Main Thread
- Retry ระดับหน้าในบาง Flow

## Pipeline ใหม่

```text
Main UI Thread
→ Document Type
→ Offscreen Preprocess Worker
→ Text Evidence / Cover Hard Block
→ Region Queue
→ Tesseract Worker Pool
→ Fast Pass 2 Variant
→ แสดง Block เบื้องต้น
→ Retry เฉพาะ Block ต่ำ
→ Broken Sara Am Review
→ Merge / Editor / Export
```

## Worker และ Concurrency

| อุปกรณ์ | OCR Worker | Preprocess Worker |
|---|---:|---:|
| Desktop | สูงสุด 2 | สูงสุด 2 ตาม Policy |
| Mobile/Low-memory | 1 | 1 |

Tesseract OCR ทำงานใน Worker ของ Tesseract.js ส่วน Crop/Resize/Contrast/Small-mark threshold ทำใน `ocr-preprocess-worker.js` ด้วย `OffscreenCanvas`

หาก Browser ไม่รองรับ Worker/OffscreenCanvas ระบบจะ Fallback ไป Pipeline เดิมแทนการทำให้หน้าเว็บใช้ไม่ได้

## Adaptive Variant Strategy

| Region | Fast Pass | Retry | สูงสุด |
|---|---|---|---:|
| Text ปกติ | Original, Upscale 2x | — | 2 |
| Low confidence | Original, Upscale 2x | Upscale 4x, CLAHE | 4 |
| Broken Sara Am | Original, Upscale 2x | Upscale 4x, Small-mark | 4 |
| Decorative title | Original, Upscale 2x | Upscale 4x, CLAHE, Color Isolation | 5 |
| Non-text | ไม่มี | ไม่มี | 0 |

ระบบไม่สร้าง Upscale 6x ทั้งหน้าและไม่สร้างทุก Variant ไว้พร้อมกัน

## Cover Illustration Block

Region ต่อไปนี้มี Variant เท่ากับ 0 และไม่ถูกเรียก OCR:

- illustration
- character_art
- animal / animal_art
- ship / ship_art
- logo
- emblem
- icon
- badge
- decorative_frame
- ornament
- background_shape
- photograph
- cartoon
- `top_illustration` ของหน้าปก

ผลที่ Block แล้วกำหนด:

```json
{
  "status": "confirmed_non_text",
  "action": "skip_text_ocr",
  "doNotEmitTokens": true,
  "emitToEditor": false,
  "emitToExport": false
}
```

Token เช่น `CAR A`, `CH ” =`, `@@@2`, `<= 5` และ `| - TR uf 3 @ |` ไม่สามารถผ่านไป Editor/Export ได้

## Text Evidence

Region ที่ไม่ระบุว่าเป็น Text ต้องมีหลักฐานอย่างน้อย 2 ข้อก่อนเรียก OCR:

- Baseline
- Glyph เรียงแนวนอน
- Connected Components
- Spacing consistency
- Script candidate
- Detector/OCR candidate
- Line aspect ratio
- Foreground contrast

ข้อความจริงที่ Confidence ต่ำจะเป็น `review_required` ไม่ถูก Hard Reject เหมือน Non-text

## Broken Sara Am

รองรับ Regression อย่างน้อย:

```text
บทร าพัน → บทรำพัน
การน าเสนอ → การนำเสนอ
ส านักงาน → สำนักงาน
จ านวน → จำนวน
ค าแนะน า → คำแนะนำ
ส าคัญ → สำคัญ
```

Retry ใช้เฉพาะ Block ที่สงสัย พร้อม Top Padding 30% และ Small-mark preservation

Auto-fix ยังต้องมีหลักฐานหลาย Variant, Bounding Box, Image Evidence, Confidence สูง และต้องไม่ใช่ชื่อเฉพาะ หากหลักฐานไม่ครบจะเป็น `broken_sara_am_review`

## Timeout และ Circuit Breaker

```text
Text Region OCR: 15 วินาที
Retry Region: 20 วินาที
Page OCR: 60 วินาที
Watchdog: 10 วินาที
Retry ระบบ: สูงสุด 1 ครั้ง
```

Circuit Breaker มีสถานะ `closed`, `open`, `half_open` และหยุดเรียก Provider ชั่วคราวเมื่อเกิดความล้มเหลวต่อเนื่อง

## Cancel และ Progress

Progress แสดง:

- ขั้นตอน
- หน้า
- Block
- จำนวน Text Region
- จำนวน Region ที่ข้าม
- จำนวน Retry
- ETA

ปุ่ม **ยกเลิกการประมวลผล** จะ Terminate OCR Worker, Preprocess Worker และ Queue โดย UI มี timeout 1.9 วินาทีเพื่อไม่ให้ปุ่มค้าง

Watchdog แสดงสถานะเพิ่มเติมเมื่อไม่มี Progress เกิน 10 วินาที

## Memory

หลัง Region/Job เสร็จ:

- `ImageBitmap.close()`
- `canvas.width/height = 1`
- ล้าง `ImageData`
- ล้าง Job cache
- Blob URL เก็บเฉพาะ Crop ที่ต้อง Manual Review
- Revoke Blob URL เมื่อ Cancel/Clear
- ไม่เก็บ Base64 ของทุก Variant ใน State

## Prevent Duplicate OCR

Hash ประกอบด้วย:

```text
File Hash
Page Number
Region Bounding Box
Variant
Language
```

Cache มีอายุเฉพาะ Job และถูกล้างเมื่อ Job จบ

## เปรียบเทียบเชิงโครงสร้าง

| รายการต่อ Block ปกติ | ก่อน | หลัง | การเปลี่ยนแปลง |
|---|---:|---:|---:|
| Variant ที่สร้างไว้ | ประมาณ 10 | 2 | ลด 80% |
| OCR Call ใน Fast Pass | สูงสุด 4 | 2 | ลด 50% |
| OCR Call สูงสุดเมื่อ Retry | สูงสุด 6 | 4 | ลด 33% |
| Upscale 6x ทั้ง Block/Page | มีใน Recovery | ไม่มี | ตัดออก |
| Non-text Variant | อาจถูกสร้าง | 0 | ตัดก่อน OCR |
| Retry | หลาย Flow ระดับหน้า | เฉพาะ Region | ลดงานซ้ำ |

ตัวเลขนี้เป็นจำนวนงานจากโค้ด ไม่ใช่เวลาหรือ RAM จากเครื่องผู้ใช้

## Runtime Metrics

ระบบเพิ่ม Metrics ต่อ Job:

- `durationMs`
- `regionsDetected`
- `regionsOcr`
- `regionsSkipped`
- `retries`
- `variantsCreated`
- `cacheHits`
- `workerRestarts`
- `timedOut`
- `mainThreadLongTaskMs`
- `peakMemoryBytes`

`peakMemoryBytes` ใช้ได้เมื่อ Browser รองรับ `performance.memory` และ `mainThreadLongTaskMs` ใช้ Long Tasks API

### เวลา, RAM และ Main Thread ก่อน/หลัง

ยังเป็น `N/A` สำหรับ Production Dataset เพราะก่อนอัปเกรดไม่มี Telemetry ที่เก็บด้วยเอกสารและอุปกรณ์ชุดเดียวกัน การใส่ค่าจำลองจะทำให้เข้าใจผิด หลัง Deploy ระบบสามารถเก็บค่าหลังอัปเกรดต่อ Job เพื่อสร้าง Benchmark ที่เทียบเงื่อนไขเดียวกันได้

## OCR Quality Metrics

- Broken Sara Am Regression: ผ่านเคสที่กำหนด
- Cover top illustration จากภาพทดสอบก่อนหน้า: 9 noise lines → 0 emitted lines หลัง Hard Block
- Sara Am Fixture เดิม: exact `ำ` 0/21 → 21/21 หลัง Unicode normalization

ค่าดังกล่าวมีขอบเขตเฉพาะ Fixture/ภาพที่ระบุ ไม่ใช่ Accuracy สำหรับเอกสารทุกประเภท

## Tests

GitHub CI รอบอัปเกรด 2.2:

```text
Tests: 128
Passed: 128
Failed: 0
Syntax Check: Passed
Static Build: Passed
```

Tests ครอบคลุม Worker limits, Variant limits, Text Evidence, Non-text Block, Gibberish safety, Duplicate hash, Timeout, Circuit Breaker, Progress, Watchdog, Cancel และ PWA build

## Retry และเครดิต

RipScan เวอร์ชันนี้ไม่มีระบบหักเครดิต และ `performance.retriesChargeCredits` ถูกกำหนดเป็น `false` เพื่อยืนยันว่า Retry ภายในระบบไม่ถูกนับเป็นงานใหม่
