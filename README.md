# RipScan — OCR + Document Studio + PDF Tools

RipScan เป็นเว็บแอป OCR ภาษาไทย–อังกฤษและระบบจัดการเอกสารแบบ Browser-first มี Structured Document Model, Document Studio, Office Import, Table-first Reconstruction และ PDF Tools อยู่ในโปรเจกต์เดียวกัน

## ใช้งานออนไลน์

```text
https://rip-scan.vercel.app
```

ไฟล์ OCR, PDF, รูปภาพ และไฟล์ Office ถูกประมวลผลใน Browser ในโหมดปกติ ไม่ถูกอัปโหลดไปเก็บบน Server

## RipScan 5.0 — Performance Runtime

Performance Runtime v5 ต่อเข้ากับระบบเดิมโดยตรง ไม่สร้าง Document Studio, Convert Center, OCR Pipeline หรือ Export Pipeline ชุดใหม่

### Initial-load optimization

- Tesseract.js โหลดเมื่อเริ่ม OCR
- PDF.js โหลดเมื่อเปิด PDF
- JSZip โหลดเมื่อ Tool ต้องสร้าง ZIP
- Document Studio โหลดเมื่อเปิด Editor หรือ Import Office
- PDF Tools โหลดเมื่อเปิด Convert Center
- Table/Cover/Book Review โหลดหลังมี OCR Result และ Browser ว่าง
- Heavy Tool ใช้ Dynamic Import และ Hover/Focus Preload

Static Production Audit รุ่น 5.0 วัด Entry Point ได้:

| รายการ | 4.0.1 baseline | 5.0.0 |
|---|---:|---:|
| Initial scripts | 16 | 8 |
| Initial stylesheets | 14 | 9 |
| Initial local JavaScript | 336,554 bytes | 159,989 bytes |
| Initial local CSS | 125,112 bytes | 90,150 bytes |

JavaScript ใน Critical Path ลดลง 176,565 bytes หรือ 52.46% และ CSS ลดลง 34,962 bytes หรือ 27.94% ตัวเลขมาจาก `scripts/performance-audit.mjs` และถูกสร้างซ้ำทุก `npm run build`

### Shared Queue และ Worker

- Heavy jobs: Desktop สูงสุด 2, Mobile/Low-memory สูงสุด 1
- Thumbnail jobs: Desktop สูงสุด 3, Mobile สูงสุด 1
- Export jobs: สูงสุด 1
- Priority: Visible → Current Page → Retry → Nearby Thumbnail → Background
- Timeout ตามประเภทงาน
- Auto retry สูงสุด 1 ครั้งเฉพาะ Job/Region/Cell
- Circuit Breaker ป้องกัน Provider Error วนซ้ำ
- Cancel เชื่อมด้วย AbortController

Image preprocessing ใช้ `performance-image-worker.js`:

- OffscreenCanvas
- Transferable ImageBitmap
- Resize
- Deskew projection
- Grayscale/Contrast
- Otsu Threshold
- Small-mark Preservation สำหรับสระอำ
- Explicit Canvas, ImageData และ ImageBitmap cleanup

### Document Studio performance

Document Studio เดิมได้รับการต่อยอดด้วย:

- Page Thumbnail Virtualization: Window 16 หน้า
- Large Table Row Virtualization: Window 56 แถว
- Render Editor เฉพาะหน้าปัจจุบัน
- รูป Thumbnail ใช้ `loading="lazy"` และ `decoding="async"`
- Patch-based Undo/Redo แทน Full-document Snapshot ใน Production Build
- รวมการพิมพ์ต่อเนื่องเป็น History Group
- History Limit ปรับตาม Device และ Large File Mode
- Export สร้าง DOM เฉพาะหน้าที่เลือก
- ล้าง History และ Document Resources เมื่อปิด Studio

### Resource Manager และ Large File Mode

Resource Manager กลางจัดการ:

- Object URL
- Canvas
- ImageBitmap
- Worker
- AbortController
- Temporary cleanup callback

Large File Mode เปิดอัตโนมัติเมื่อ PDF มากกว่า 30 หน้า, ไฟล์เกิน 60 MB, ภาพเกิน 32 ล้านพิกเซล, ตารางเกิน 2,500 Cell หรืออุปกรณ์มี RAM ต่ำ โดยจะลด Worker, ลด Preview Quality, จำกัด History และปิด Auto-process หน้าถัดไป แต่ไม่เปลี่ยนคุณภาพ Export ที่ผู้ใช้เลือก

### Performance Settings

หน้า OCR มี Settings:

- อัตโนมัติ
- ประหยัดทรัพยากร
- สมดุล
- ประสิทธิภาพสูง
- จำนวน Worker
- OCR Variant Limit
- Undo History Limit
- Auto-process next page
- OffscreenCanvas
- Clear Temporary Cache

Debug Panel เปิดเฉพาะ Development:

```text
http://localhost:8000/?debugPerformance=1
```

Panel แสดง Queue, Active Jobs, FPS, Long Tasks, DOM Nodes, Canvas, JS Heap และ Resource Count โดยไม่เก็บข้อความ OCR ชื่อไฟล์ ภาพ หรือเนื้อหา Cell

### Service Worker v5

- App Shell เก็บเฉพาะ Core UI
- Heavy Tool ไม่ Precache ตอน Install
- Runtime Cache จำกัด 48 รายการ
- ลบ Cache Version เก่าเมื่อ Activate
- Local JS/CSS ใช้ Network-first ลดปัญหาไฟล์ข้าม Version
- ไม่ Cache Blob URL, Data URL, User Upload และ Export Result

รายละเอียดการ Audit: `docs/performance-audit-v5.md`

## RipScan 4.0 — PDF Tools และ Round-Trip

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

- หลายรูปและลากเรียงลำดับ
- A4 / A5 / Letter / Legal / Fit Image / Custom
- Contain / Cover / Stretch
- Margin / Background / Auto Orientation / Page Number

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
- Patch Undo/Redo
- Save/Load ใน IndexedDB
- เปิด OCR Result เดิมด้วย **เปิดแก้ไขแบบต้นฉบับ**

## Structured Document Model v4

```js
{
  version: '4.0.0',
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
Core Upload / OCR / Office Import / PDF Tools
                    │
                    ▼
          Shared Performance Runtime
       Queue · Resource Manager · Workers
                    │
                    ▼
          Structured Document Model v4
             ┌──────┴────────┐
             ▼               ▼
 Existing Document      Shared PDF Worker
 Studio / Convert       Queue + Organizer
 Center                       │
             └──────┬────────┘
                    ▼
 PDF · JPG · PNG · DOCX · XLSX · PPTX · .ripscan
```

ไฟล์ Performance หลัก:

```text
web/performance-runtime.mjs
web/performance-bootstrap.js
web/performance-image-worker.js
web/performance-image-client.mjs
web/document-patch-history.mjs
web/studio-virtualization.mjs
web/performance-v5.css
scripts/performance-audit.mjs
```

ไฟล์ระบบเอกสารเดิม:

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

Dependency ที่ reuse และโหลดตาม Tool:

- Tesseract.js `7`
- PDF.js `4.10.38`
- JSZip `3.10.1`
- SheetJS `0.18.5`
- html2canvas `1.4.1`
- jsPDF `2.5.2`
- pdf-lib `1.17.1`
- @pdf-lib/fontkit `1.1.1`

ไม่มีการใช้ `latest`

## ทดสอบและ Build

```bash
npm install
npm test
npm run check
npm run build
```

`npm run build` ทำงานตามลำดับ:

1. Unit และ Regression Tests
2. Source Syntax Check
3. สร้าง `dist/`
4. Production Transform
5. Dist Syntax Check
6. Static Performance Audit

รายงานจะอยู่ที่:

```text
dist/performance-audit.json
```

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

- Browser LCP, INP, TBT, CPU, FPS และ Peak RAM ต้องวัดจาก Browser/อุปกรณ์จริง จึงไม่รายงานตัวเลขจาก CI
- Preserve Text PDF Compression อาจลดขนาดได้น้อยใน PDF ที่ optimize มาแล้ว
- Secure Redaction ที่ลบ Content Stream จริงยังไม่เปิดใช้
- WordArt, SmartArt, Chart, Macro, OLE, Animation และ 3D อาจ fallback
- DOCX absolute-positioned element บางชนิดอาจแปลงเป็น Text Box หรือ Flow Content
- XLSX formula/data validation/frozen pane ซับซ้อนขึ้นกับ metadata ที่ Import Adapter อ่านได้
- PPTX theme/master/SmartArt/Chart ซับซ้อนอาจ flatten เฉพาะ Block
- TIFF/BMP/WEBP ขึ้นกับ Browser Image Decoder
- ฟอนต์ที่ไม่มีจะใช้ Noto Sans Thai/System fallback
- Fidelity Score เป็น heuristic ไม่ใช่ pixel-perfect guarantee

## เอกสารเพิ่มเติม

- `docs/performance-audit-v5.md`
- `docs/pdf-tools-roundtrip-v4.md`
- `docs/document-reconstruction-studio-v3.md`
- `docs/review-first-cover-sara-am-v2.md`
- `docs/cover-poster-ocr-evaluation-v1.9.md`
- `docs/book-cover-thai-ocr-evaluation.md`
