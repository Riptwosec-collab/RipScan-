# RipScan 3.0 — Document Reconstruction Studio

## เป้าหมาย

RipScan 3.0 เพิ่มชั้น **Document Reconstruction** เหนือระบบ OCR เดิม เพื่อให้ไฟล์ที่นำเข้าถูกแปลงเป็นเอกสารแบบมีโครงสร้างและแก้ไขต่อได้ ไม่จบเพียงข้อความธรรมดา

ระบบพยายามรักษา Layout ให้ใกล้ต้นฉบับที่สุดเท่าที่ Browser และข้อมูลในไฟล์ต้นทางอนุญาต พร้อมเครื่องมือ Manual Correction

> ไม่มีการรับประกันความเหมือน 100% สำหรับทุกไฟล์ โดยเฉพาะฟอนต์เฉพาะ SmartArt มาโคร OLE วัตถุฝัง เอฟเฟกต์ 3D และ Layout ที่พึ่งพาโปรแกรม Microsoft Office โดยตรง

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
Document → Pages → Blocks → Styles / Content / Review Status
        │
        ├── Text / Header / Footer
        ├── Table / Cells / Merge / Border
        ├── Image
        ├── Shape / Line
        └── Field
        │
        ▼
WYSIWYG Document Studio
Page Canvas · Outline · Properties · Review · Undo/Redo
        │
        ▼
Export / Convert Services
PDF · Searchable PDF via browser print · JPG · PNG · DOCX · XLSX · TXT · JSON
```

## Service Mapping

| Service | Implementation |
|---|---|
| UploadService | Main upload input + Document Studio input + validation |
| OCRService | Existing Worker Queue / Tesseract pipeline |
| LayoutAnalysisService | Existing OCR region/table pipeline + Office XML coordinates |
| DocumentReconstructionService | `document-model.mjs` + `office-import.mjs` |
| TableReconstructionService | Table model, merge/split/add/delete row/column |
| ConversionService | Convert Center in `document-studio.js` |
| ExportService | `editor-export.mjs` |
| ReviewService | `reviewStatus`, OCR confidence and existing review system |
| EditorStateService | History snapshots, IndexedDB save, page/block selection |

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
      confidence,
      reviewStatus,
      metadata
    }]
  }],
  reviewIssues: []
}
```

### Table Block

- `rows`, `columns`
- `cells[]`
- `rowSpan`, `columnSpan`
- `columnWidths`, `rowHeights`
- Cell border, fill, alignment, font and review status
- Merge/Split แบบแก้ไขได้

## Import

### PDF

- Render ทีละหน้า
- รักษาภาพหน้าเดิมเป็น Page Background
- อ่าน Text Layer เมื่อมี และสร้าง Positioned Text Block
- PDF สแกนยังใช้ OCR Pipeline เดิม แล้วกด **เปิดแก้ไขแบบต้นฉบับ**

### Image

- ใช้ภาพเป็น Page Background
- สามารถเพิ่ม Text/Table/Image Block ทับหน้าเดิม
- OCR Result เดิมสามารถเปิดเข้า Document Studio

### DOCX

อ่าน OOXML โดยตรงจาก ZIP:

- Paragraph / Run
- Heading
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
- ค่าที่แสดงของ Cell
- Font / Fill / Alignment / Border ที่ Parser คืนมาได้

### PPTX

อ่าน Slide XML โดยตรง:

- Slide → Page
- Text Shape → Positioned Text Block
- Picture → Positioned Image Block
- Connector → Line Block
- ใช้ค่า EMU สำหรับตำแหน่งและขนาด

### TXT / CSV / HTML / RTF

- TXT / RTF → Text Blocks
- CSV → Editable Table
- HTML → Paragraph / Heading / Table / Image

### ODT / ODS / ODP

รองรับโครงสร้างพื้นฐานจาก `content.xml`:

- ODT paragraph/heading
- ODS table
- ODP slide text

## WYSIWYG Editor

Document Studio มี:

- Page thumbnail navigation
- Visual Page View
- Structured Blocks View
- Contenteditable Text Block
- Editable Table Cell
- Drag Block
- Resize Block
- Position / Size / Rotation / z-index
- Font size / weight / color / alignment
- Image fit / opacity
- Add text / table / image / page
- Add/Delete row and column
- Merge/Split cell
- Undo/Redo สูงสุด 50 snapshots
- Save/Load ล่าสุดด้วย IndexedDB
- Import OCR Result เข้า Editor

## Convert Center

### Output

- PDF แบบ Render
- Searchable PDF ผ่าน Browser Print เพื่อรักษา Unicode และภาษาไทย
- JPG
- PNG
- DOCX แบบโครงสร้างพื้นฐาน
- XLSX จาก Table Blocks
- TXT
- JSON Structured Document Model

### Resize Options

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
- Selected pages

## Performance

- Import หลายไฟล์ทำตาม Queue
- PDF render ทีละหน้า
- Progress event
- Cancel token
- Yield กลับ UI ระหว่างหน้า
- OCR งานหนักยังใช้ Worker Queue เดิม
- Canvas ถูกลดขนาดและคืนหน่วยความจำหลัง Export
- Export หลายภาพรวมเป็น ZIP

## Known Limitations

1. DOCX/PPTX ไม่สามารถจำลอง WordArt, SmartArt, Chart, Macro, OLE และเอฟเฟกต์เฉพาะ Office ได้ครบ
2. ฟอนต์ที่ไม่มีในเครื่องผู้ใช้จะถูกแทนด้วย System/Noto Sans Thai fallback
3. Searchable PDF ใช้ Browser Print เพื่อรักษา Unicode ผู้ใช้ต้องเลือก Save as PDF
4. Direct PDF Export เป็นการ Render ภาพ จึงเน้น Visual Fidelity แต่ Text Layer ไม่ค้นหาได้
5. DOCX Export เน้นข้อความและตาราง ไม่เก็บตำแหน่ง Absolute ทุก Block แบบ Word DrawingML
6. XLSX Export ส่งออก Table Blocks เป็น Sheet และเก็บ Merge/ขนาดพื้นฐาน
7. PDF ที่เป็นภาพล้วนต้องผ่าน OCR ก่อนจึงมี Text Block ที่แก้ไขได้
8. Mixed upload ที่เลือก Office และภาพพร้อมกันจาก Main OCR Input จะเปิดเฉพาะไฟล์ Office ใน Studio; ใช้ปุ่ม **นำเข้า** ใน Studio เพื่อรวมหลายประเภท

## Local

```bash
npm install
npm test
npm run check
npm run build
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn api.index:app --host 0.0.0.0 --port 8000
```

เปิด `http://localhost:8000`

## Production Build

`npm run build` จะ:

1. รัน Unit/Regression Tests
2. ตรวจ Syntax ทุกโมดูล
3. สร้าง `dist/`
4. Inject Document Studio CSS/JS
5. Cache Asset ด้วย PWA `ripscan-pwa-v3.0.0`
