# RipScan — OCR + Document Reconstruction Studio

RipScan เป็นเว็บแอป OCR ภาษาไทย–อังกฤษที่เพิ่ม **Document Reconstruction Studio** สำหรับนำเข้าไฟล์เอกสาร แปลงเป็นโครงสร้างที่แก้ไขต่อได้ และส่งออกเป็น PDF/JPG/PNG/DOCX/XLSX โดยประมวลผลใน Browser เป็นหลัก

## ใช้งานออนไลน์

```text
https://rip-scan.vercel.app
```

ไฟล์ OCR และไฟล์ Office จะถูกประมวลผลใน Browser ในโหมดปกติ ไม่ถูกอัปโหลดไปเก็บบนเซิร์ฟเวอร์

## RipScan 3.0

### นำเข้า

- PDF และ PDF สแกน
- JPG / JPEG / PNG / WEBP / BMP / TIFF
- DOCX
- XLSX / XLS
- PPTX
- TXT / CSV / HTML / RTF / JSON
- ODT / ODS / ODP ระดับโครงสร้างพื้นฐาน

### OCR

- ภาษาไทย ภาษาอังกฤษ และไทย–อังกฤษผสม
- PDF Text Layer และ PDF สแกนสูงสุด 100 หน้า
- Drag & Drop, หลายไฟล์ และวางภาพด้วย `Ctrl+V` / `Cmd+V`
- Deskew, Contrast, Threshold, Upscale และ Background Cleanup
- Worker Queue, Progress, Cancel, Timeout และ Retry เฉพาะ Region
- Cover Image Hard Block ไม่อ่านข้อความจากรูปประกอบบนหน้าปก
- Broken Sara Am Recovery สำหรับ `บทร าพัน`, `การน าเสนอ`, `ส านักงาน`
- ตรวจตารางแยก Cell พร้อม Merged Cell และ Cross-Cell Validation

### Document Studio

ผลลัพธ์ไม่จบแค่ Plain Text แต่เปิดเป็น WYSIWYG Document Model ได้:

- Visual Page View
- Structured Blocks View
- แก้ Text Block โดยตรง
- ลากย้ายและ Resize Block
- Position / Size / Rotation / z-index
- Font size / weight / color / alignment
- เพิ่มข้อความ รูป ตาราง เส้น และหน้าใหม่
- ตารางเป็น Cell จริง
- เพิ่ม/ลบ Row และ Column
- Merge / Split Cell
- แก้ Cell, Border, Fill และ Alignment
- Multi-page navigation
- Undo / Redo สูงสุด 50 snapshots
- Save/Load ใน IndexedDB
- เปิด OCR Result เดิมเข้า Editor ด้วยปุ่ม **เปิดแก้ไขแบบต้นฉบับ**

### Convert Center

ส่งออกและแปลงไฟล์เป็น:

- PDF แบบ Render
- Searchable PDF ผ่าน Browser Print
- JPG
- PNG
- DOCX
- XLSX
- TXT
- JSON Structured Document Model

ตัวเลือก Resize:

- Width / Height
- Keep aspect ratio
- Fit contain / cover
- Scale 10–800%
- DPI 72–600
- JPG quality
- Background color
- Transparent PNG
- A4 / A5 / Letter / Legal / Source / Custom
- Portrait / Landscape
- Export เฉพาะหน้าที่เลือก

## Document Model

```js
{
  version: '3.0.0',
  id,
  name,
  sourceType,
  metadata,
  pages: [{
    id,
    number,
    width,
    height,
    background,
    backgroundImage,
    blocks: [{
      id,
      type: 'text | table | image | shape | line | field | header | footer',
      x, y, width, height,
      zIndex,
      rotation,
      style,
      content,
      confidence,
      reviewStatus,
      metadata
    }]
  }],
  reviewIssues: []
}
```

### Table Model

- `rows`, `columns`
- `cells[]`
- `rowSpan`, `columnSpan`
- `columnWidths`, `rowHeights`
- Cell styles, border, fill, alignment และ review status

## วิธี Import

### DOCX

อ่าน OOXML โดยตรงจาก ZIP:

- Paragraph / Run / Heading
- Bold / Italic / Underline / Color / Font Size
- Paragraph alignment
- Table / Grid Span / Vertical Merge
- Embedded image relationship
- Page size และ margin พื้นฐาน

### XLSX / XLS

ใช้ SheetJS:

- Sheet → Page
- Cell → Editable Cell
- Merged Cell
- Column width / Row height
- Font / Fill / Alignment / Border ที่ Parser คืนมาได้

### PPTX

อ่าน Slide XML:

- Slide → Page
- Text Shape → Positioned Text Block
- Picture → Positioned Image Block
- Connector → Line Block
- ตำแหน่งและขนาดจาก EMU

### PDF / Image

- PDF Text Layer ถูกสร้างเป็น Positioned Text Blocks
- หน้า PDF และรูปถูกเก็บเป็น Page Background เพื่อรักษาหน้าตาเดิม
- PDF สแกนและรูปเอกสารใช้ OCR Pipeline เดิม แล้วเปิดเข้า Document Studio

## Review-first OCR

Region ใช้สถานะ:

- `verified`
- `review_required`
- `possible_text`
- `likely_non_text`
- `confirmed_non_text`

เฉพาะ `confirmed_non_text` เท่านั้นที่ถูกตัดจาก Output

ค่าเริ่มต้น:

```text
verified_text_threshold = 0.88
possible_text_threshold = 0.45
confirmed_non_text_threshold = 0.15
decorative_font_possible_threshold = 0.30
small_text_possible_threshold = 0.25
```

## Cover OCR Safety

Cover Mode รองรับ:

- `cover_page`
- `worksheet_cover`
- `book_cover`
- `poster`
- `illustrated_document`

Region ประเภท Illustration, Character, Animal, Ship, Logo, Emblem, Ornament และ Decorative Frame จะไม่ถูกส่งเข้า Text OCR และ Token จะไม่รั่วเข้า Editor/Export

## Broken Sara Am

ตรวจรูปแบบ:

```text
บทร าพัน
การน าเสนอ
การด าเนินงาน
จ านวน
ส านักงาน
ค าแนะน า
ส าคัญ
ก าหนด
ต าแหน่ง
ส าเร็จ
```

ระบบใช้ Unicode, Grapheme, Internal Spacing, OCR Variant, Image Evidence และ Dictionary เป็นคะแนนเสริม ชื่อเฉพาะจะไม่ถูกแก้อัตโนมัติเมื่อหลักฐานไม่ครบ

## Architecture

```text
Upload / OCR Result
        │
        ▼
Import Adapter Layer
PDF · Image · DOCX · XLSX · PPTX · HTML · CSV · TXT · RTF · ODF
        │
        ▼
Structured Document Model
        │
        ▼
WYSIWYG Page Editor + Review
        │
        ▼
PDF · Searchable PDF · JPG · PNG · DOCX · XLSX · TXT · JSON
```

ไฟล์หลัก:

```text
web/document-model.mjs
web/office-import.mjs
web/editor-export.mjs
web/document-studio.js
web/document-studio.css
```

## ทดสอบและ Build

```bash
npm install
npm test
npm run check
npm run build
```

Build จะ:

1. รัน Unit/Regression Tests
2. ตรวจ JavaScript Syntax
3. สร้าง Static output ที่ `dist/`
4. Inject OCR, Table Automation และ Document Studio
5. อัปเดต PWA Cache

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

## Known Limitations

RipScan พยายามรักษา Layout ให้ใกล้ต้นฉบับที่สุด แต่ไม่รับประกันความเหมือน 100% สำหรับทุกไฟล์

ข้อจำกัดหลัก:

- WordArt, SmartArt, Chart, Macro, OLE และเอฟเฟกต์ 3D อาจไม่ถูกนำเข้าครบ
- ฟอนต์ที่ไม่มีในเครื่องผู้ใช้จะถูกแทนด้วย System/Noto Sans Thai fallback
- Searchable PDF ใช้ Browser Print ผู้ใช้ต้องเลือก Save as PDF
- Direct PDF Export เน้น Visual Fidelity และเป็นภาพ Render
- DOCX Export เน้นข้อความและตาราง ไม่รักษา Absolute DrawingML ทุก Block
- XLSX Export สร้าง Sheet จาก Table Blocks และรักษา Merge/ขนาดพื้นฐาน
- PDF ภาพล้วนต้องผ่าน OCR ก่อนจึงมี Text Block ที่แก้ไขได้

## เอกสารเพิ่มเติม

- `docs/document-reconstruction-studio-v3.md`
- `docs/review-first-cover-sara-am-v2.md`
- `docs/cover-poster-ocr-evaluation-v1.9.md`
- `docs/book-cover-thai-ocr-evaluation.md`

> ข้อความที่ภาพไม่ชัด ชื่อเฉพาะ ฟอนต์ประดิษฐ์ และโครงสร้างที่ขัดแย้งจะถูกส่ง Manual Review แทนการเดา
