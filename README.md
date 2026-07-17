# RipScan — OCR + Document Studio + PDF Tools

RipScan เป็นเว็บแอป OCR ภาษาไทย–อังกฤษและระบบจัดการเอกสารแบบ Browser-first มี Structured Document Model, Document Studio, Office Import, Table-first Reconstruction และ PDF Tools อยู่ในโปรเจกต์เดียวกัน

## ใช้งานออนไลน์

```text
https://rip-scan.vercel.app
```

ไฟล์ OCR, PDF, รูปภาพ และไฟล์ Office ถูกประมวลผลใน Browser ในโหมดปกติ ไม่ถูกอัปโหลดไปเก็บบน Server

## RipScan 3.3.1

- Document Model 3.3 พร้อม migration จาก 3.0 และ block ชนิด field, checkbox, radio, signature, stamp, barcode, QR, label และ value
- Form Recognition จากหลักฐาน label/value separator และ checkbox glyph พร้อม validation โดยไม่เดาค่าที่อ่านไม่ชัด
- Template import, validation, duplicate guard, match confidence และ apply แบบ placeholder ที่ต้อง review
- Project Workspace เก็บคิว สถานะ และผลข้อความ OCR ใน IndexedDB โดยไม่เก็บไฟล์/ภาพต้นฉบับอัตโนมัติ
- Export Compatibility Check สำหรับ DOCX/XLSX แสดง supported, flattened และ unsupported ก่อนส่งออก
- Redaction audit report ไม่มีข้อความที่ถูกลบ, external-origin visibility และ Secure Delete ข้อมูล local ทั้งหมด

รายละเอียดรุ่น: `docs/release-v3.3.md`

## RipScan 3.2

### PDF Tools ใน Convert Center เดิม

- บีบอัด PDF
- รวม PDF และรูปภาพ
- แยก PDF ทุกหน้า ตามช่วง ทุก N หน้า หน้าคู่ และหน้าคี่
- จัดเรียงหน้า หมุน ลบ ทำสำเนา และ Undo/Redo
- แก้ไข PDF ผ่าน Document Studio เดิม
- PDF เป็น JPG
- PDF เป็น PNG
- รูปภาพหลายรูปเป็น PDF

ทุก Tool ใช้ Progress, Cancel, Worker Queue และ Memory Cleanup ไม่มีการสร้าง Convert Center หรือ PDF Editor แยกชุดใหม่

### PDF Compression

- Low — รักษาคุณภาพสูง
- Standard — สมดุลคุณภาพและขนาด
- High — Render ทีละหน้าเป็น JPEG เพื่อลดขนาดมากขึ้น
- Custom — Quality, DPI, Text Layer, Metadata และ Grayscale

โหมด Preserve Text Layer จะรักษาโครงสร้าง PDF เดิมและบีบอัด object streams ส่วน High Mode อาจไม่รักษา Text Layer และ UI จะแจ้งก่อนดำเนินการ

### Merge / Split / Page Organizer

Page Organizer กลางหนึ่งชุดใช้ร่วมกันระหว่าง Merge, Split และ Organize:

- Drag เพื่อเรียงหน้า
- Multi-select
- Rotate left/right
- Delete
- Duplicate
- Undo/Redo
- PDF + JPG/PNG ในชุด Merge เดียวกัน
- ดาวน์โหลดผล Split หลายไฟล์เป็น ZIP

### PDF Editor

PDF Editor ใช้ Structured Document Model และ Document Studio เดิม:

- PDF มี Text Layer → Positioned Text Blocks
- PDF สแกน → OCR Pipeline เดิมและ Manual Review
- เพิ่มข้อความ รูป ตาราง Shape Highlight Line Arrow Header Footer และ Page Number
- Whiteout เป็น Visual Overlay เท่านั้น ไม่ใช่ Secure Redaction
- Export แบบรักษาหน้า PDF ต้นฉบับและวาง Block ที่แก้ไขเพิ่มเป็น Layer ใหม่

### PDF เป็นรูปภาพ

- JPG / PNG
- เลือกทุกหน้า ช่วงหน้า หรือหน้าที่เลือก
- DPI 72–600
- Width / Height / Scale
- Transparent PNG
- JPG Quality
- Render ทีละหน้า ไม่สร้าง Canvas ทุกหน้าพร้อมกัน
- หลายไฟล์ดาวน์โหลดเป็น ZIP

### รูปภาพเป็น PDF

รองรับ JPG, PNG, WEBP, BMP และ TIFF เมื่อ Browser decode ได้ พร้อม:

- หลายรูป
- ลากเรียงลำดับ
- A4 / A5 / Letter / Legal / Fit Image / Custom
- Contain / Cover / Stretch
- Margin
- Background
- Auto Orientation
- Page Number

## Round-Trip Export

Document Studio มีคำสั่ง:

- ส่งออกเป็นรูปแบบเดิม
- Compatibility Report
- Fidelity Score
- ดาวน์โหลด `.ripscan`
- เปิด `.ripscan` เพื่อแก้ไขต่อ

รองรับ:

- DOCX → Paragraph, Run, Table และ Embedded Image จริง
- XLSX → Cell, Merge, Width และ Height จริงผ่าน Existing SheetJS Export
- PPTX → Text Box, Image, Shape และ Table Object จริง
- PDF → Original Page + Editable Overlay
- Image → JPG/PNG/WEBP แบบ Flatten และเก็บ Layer ต่อได้ผ่าน `.ripscan`

Fallback Policy:

1. Native editable element
2. Compatible shape
3. Editable text box
4. Flatten เฉพาะ Block
5. Flatten ทั้งหน้าเป็นตัวเลือกสุดท้าย

RipScan ไม่อ้างว่าผลลัพธ์เหมือนต้นฉบับ 100% ทุกไฟล์ ก่อน Export จะแสดง Compatibility/Fidelity Report และรายการที่ควรตรวจ

## RipScan Editable Project

ไฟล์ `.ripscan` เป็น ZIP ที่ประกอบด้วย:

```text
manifest.json
document.json
assets/
thumbnails/
```

เก็บ Pages, Text Blocks, Tables, Images, Shapes, Source Metadata, Review Issues และ Export Settings เพื่อเปิดแก้ไขต่อภายหลังใน RipScan

## นำเข้า

- PDF และ PDF สแกน
- JPG / JPEG / PNG / WEBP / BMP / TIFF
- DOCX
- XLSX / XLS
- PPTX
- TXT / CSV / HTML / RTF / JSON
- ODT / ODS / ODP ระดับโครงสร้างพื้นฐาน
- `.ripscan`

## OCR เดิมที่ยังคงทำงาน

- ภาษาไทย ภาษาอังกฤษ และไทย–อังกฤษผสม
- PDF Text Layer และ PDF สแกน
- Deskew, Contrast, Threshold, Upscale และ Background Cleanup
- Worker Queue, Progress, Cancel, Timeout และ Retry เฉพาะ Region
- Cover Image Hard Block
- Broken Sara Am Recovery เช่น `บทร าพัน`, `การน าเสนอ`, `ส านักงาน`
- Table-first Reconstruction แยก Cell และ Merged Cell
- Review-first Status: `verified`, `review_required`, `possible_text`, `likely_non_text`, `confirmed_non_text`

เฉพาะ `confirmed_non_text` เท่านั้นที่ถูกตัดจาก Output

## Document Studio

- Visual Page View
- Structured Blocks View
- Text/Image/Table/Shape/Field Blocks
- Drag, Resize, Rotation และ z-index
- Font, Color, Alignment, Opacity, Border และ Fit
- Table Row/Column, Merge/Split Cell
- Multi-page navigation
- Undo/Redo
- Save/Load ใน IndexedDB
- Autosave หลังหยุดแก้ไข 2.5 วินาที พร้อมสถานะ Saved/Failed
- Named Version, Restore และลบ Version
- Review Center รวมรายการ Confidence ต่ำทั้งเอกสาร
- Visual Compare แบบ Side-by-side, Overlay และ Before/After
- Redaction แบบ Burn-in และตัดข้อความออกจาก Text Layer
- บันทึก Layout/Field เป็น Template ที่ไม่มีข้อความต้นฉบับ
- เปิด OCR Result เดิมเข้า Editor ด้วยปุ่ม **เปิดแก้ไขแบบต้นฉบับ**

### Convert Center

ส่งออกและแปลงไฟล์เป็น:

- PDF แบบ Render
- Searchable PDF ดาวน์โหลดโดยตรงพร้อม invisible text layer และฟอนต์ไทยฝังในไฟล์
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
  version: '3.3.0',
  id,
  name,
  sourceType,
  metadata: {
    sourceFileName,
    sourceFormat,
    sourceMimeType,
    sourcePageSize,
    sourceOrientation,
    sourceStructure,
    importAdapter,
    preferredRoundTripFormat,
    dualRepresentation: true
  },
  pages: [{
    width,
    height,
    backgroundImage,
    editableLayer,
    visualReference,
    blocks: [{
      type: 'text | table | image | shape | line | field | header | footer',
      x, y, width, height,
      rotation,
      zIndex,
      sourceElementType,
      sourceElementId,
      sourceFormat,
      exportSupport,
      willRemainEditable,
      compatibilityNotes
    }]
  }],
  assets: [],
  exportSettings: {},
  reviewIssues: []
}
```

## Architecture

```text
Upload / OCR / Office Import / PDF Tools
                │
                ▼
       Structured Document Model v4
          ┌─────┴─────────┐
          ▼               ▼
 Existing Document    Shared PDF Worker
 Studio / Convert     Queue + Organizer
 Center                    │
          └─────┬─────────┘
                ▼
PDF · JPG · PNG · DOCX · XLSX · PPTX · .ripscan
```

ไฟล์หลัก:

```text
web/document-model.mjs
web/document-studio.js
web/office-import.mjs
web/editor-export.mjs
web/pdf-utility-core.mjs
web/pdf-page-organizer.mjs
web/pdf-worker.js
web/pdf-tool-runtime.mjs
web/pdf-tools-ui.js
web/roundtrip-export.mjs
web/ripscan-project.mjs
```

## Dependency Policy

Dependency เดิมที่ reuse:

- PDF.js `4.10.38`
- JSZip `3.10.1`
- SheetJS `0.18.5`
- html2canvas `1.4.1`
- jsPDF `2.5.2`

เพิ่มแบบ Browser ESM และระบุ Version:

- pdf-lib `1.17.1`
- @pdf-lib/fontkit `1.1.1`

ไม่มีการใช้ `latest`

## ทดสอบและ Build

```bash
npm install
npm test
npm run check
npm run build
npm run test:integration
npm run security:check
npm run fixtures:validate
```

Build จะรัน Tests, Syntax Check, สร้าง `dist/`, Inject OCR/Table/Document Studio/PDF Tools และอัปเดต PWA Cache

## รัน Local

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
npm install
npm run build
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

เปิด `http://localhost:8000`

## Known Limitations

RipScan พยายามรักษา Layout ให้ใกล้ต้นฉบับที่สุด แต่ไม่รับประกันความเหมือน 100% สำหรับทุกไฟล์

ข้อจำกัดหลัก:

- WordArt, SmartArt, Chart, Macro, OLE และเอฟเฟกต์ 3D อาจไม่ถูกนำเข้าครบ
- ฟอนต์ที่ไม่มีในเครื่องผู้ใช้จะถูกแทนด้วย System/Noto Sans Thai fallback
- Searchable PDF ใช้ตำแหน่ง Text Block จาก Document Model; ข้อความสถานะ Review Required จะไม่รวมโดยค่าเริ่มต้น
- Direct PDF Export เน้น Visual Fidelity และเป็นภาพ Render
- DOCX Export เน้นข้อความและตาราง ไม่รักษา Absolute DrawingML ทุก Block
- XLSX Export สร้าง Sheet จาก Table Blocks และรักษา Merge/ขนาดพื้นฐาน
- PDF ภาพล้วนต้องผ่าน OCR ก่อนจึงมี Text Block ที่แก้ไขได้

## เอกสารเพิ่มเติม

- `docs/pdf-tools-roundtrip-v4.md`
- `docs/document-reconstruction-studio-v3.md`
- `docs/review-first-cover-sara-am-v2.md`
- `docs/cover-poster-ocr-evaluation-v1.9.md`
- `docs/book-cover-thai-ocr-evaluation.md`
- `docs/audit-v3.2.md`
- `docs/release-v3.2.md`

> ข้อความที่ภาพไม่ชัด ชื่อเฉพาะ ฟอนต์ประดิษฐ์ และโครงสร้างที่ขัดแย้งจะถูกส่ง Manual Review แทนการเดา
