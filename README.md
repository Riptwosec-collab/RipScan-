# RipScan — Thai-English OCR

เว็บแปลงภาพและ PDF เป็นข้อความภาษาไทย–อังกฤษ รองรับการใช้งานออนไลน์บน Vercel และการใช้งานในเครื่อง โดยประมวลผลไฟล์ภายในอุปกรณ์ของผู้ใช้เป็นหลัก

## ใช้งานออนไลน์

```text
https://rip-scan.vercel.app
```

โหมดออนไลน์ประมวลผล OCR ภายในเบราว์เซอร์ด้วย Tesseract.js และใช้ PDF.js อ่าน Text Layer หรือแปลงหน้าสแกนเป็นภาพก่อน OCR ไฟล์ไม่ถูกอัปโหลดไปเก็บบนเซิร์ฟเวอร์

## ความสามารถหลัก

- PNG, JPG, WEBP, TIFF, BMP และ PDF
- ภาษาไทย ภาษาอังกฤษ และไทย+อังกฤษ
- PDF Text Layer และ PDF สแกนสูงสุด 100 หน้า
- วางภาพจาก Clipboard ด้วย Ctrl+V / Cmd+V
- ปรับภาพเอียง, Grayscale, Contrast, ลด Noise และ Threshold อัตโนมัติ
- หน้าตรวจแบบภาพคู่ข้อความ พร้อม Zoom, หมุนดู, ค้นหา และ Undo/Redo
- Thumbnail แยกหน้า พร้อมลากจัดลำดับ เลื่อนขึ้น/ลง หมุน ลบ และเลือกหลายหน้า
- ครอปภาพหน้าเอกสารและสั่ง OCR ใหม่เฉพาะหน้า หรือหลายหน้าที่เลือก
- ดาวน์โหลดรูปหน้าที่เลือกเป็น ZIP

## OCR Engine และประสิทธิภาพ

RipScan 1.5 ใช้ Tesseract.js 7 และระบบจัดการ Worker สำหรับงานหลายหน้า

- โหมด **อัตโนมัติ** เลือกจำนวน Worker ตามความสามารถของอุปกรณ์
- โหมด **Turbo** ใช้พร้อมกันสูงสุด 2 Workers
- โหมด **ประหยัด RAM** ใช้ 1 Worker
- ใช้ Worker Pool สำหรับ OCR หลายหน้าที่เลือก
- แสดงความคืบหน้าและ ETA จาก Progress จริงของ OCR
- มีปุ่มยกเลิกงาน OCR และคืนหน่วยความจำด้วยการ Terminate Worker
- Cache โมเดลภาษาบนเบราว์เซอร์เพื่อลดเวลาการโหลดครั้งถัดไป
- จำกัดการทำงานพร้อมกันไม่เกิน 2 งาน

## ตารางและแบบฟอร์ม

หลัง OCR เอกสารแล้ว สามารถกด **ตาราง/ฟอร์ม** ที่แต่ละหน้า หรือเลือกหลายหน้าแล้วกด **วิเคราะห์ตารางหน้าที่เลือก**

ระบบพื้นฐานสามารถ:

- ตรวจเส้นแนวนอนและแนวตั้งของตาราง
- ตรวจจุดตัดเพื่อยืนยัน Grid
- OCR แยกทีละ Cell
- รักษา Cell ว่างตามโครงสร้างที่ตรวจพบ
- ตรวจขอบที่หายเพื่อประมาณ Merged Cell
- แสดง Confidence ราย Cell
- แก้ข้อความใน Cell ได้โดยตรง
- ตรวจ Checkbox, ฟิลด์แบบฟอร์ม, หัวกระดาษ และท้ายกระดาษ
- ส่งออกผลวิเคราะห์เป็น CSV, XLSX และ JSON

ระบบจะไม่สร้างตารางสมมติเมื่อไม่พบเส้นและจุดตัดที่น่าเชื่อถือ ตารางไม่มีเส้น ตารางซ้อน ภาพเอียงมาก หรือพื้นหลังซับซ้อนอาจต้องครอปและปรับภาพก่อนวิเคราะห์

## Verified Table OCR

RipScan 1.5 เพิ่มชั้นตรวจสอบหลัง Cell OCR เพื่อป้องกันข้อมูลเลื่อนข้ามแถวหรือคอลัมน์:

- วิเคราะห์ประเภทคอลัมน์จาก Header และค่าหลายแถว
- Numeric Strict Mode สำหรับจำนวนเต็ม ทศนิยม เงิน เปอร์เซ็นต์ วันที่ และเวลา
- ทำเครื่องหมาย `O/0`, `I/l/1`, `S/5`, `B/8`, `Z/2`, `G/6` เมื่อยังตัดสินไม่ได้
- ตรวจ Cell ที่อาจปนข้อความจาก Cell ข้างเคียง
- ป้องกัน Cell ว่างและ Cell ที่อาจว่าง โดยไม่เติม `0`, `O`, `-` หรือข้อความข้างเคียงเอง
- สถานะ Cell: Verified, Review Recommended, Manual Review Required, Contaminated, Empty และ Possibly Empty
- แสดง Tab **ตรวจสอบตาราง** พร้อมเหตุผลและปุ่มไปยัง Cell ที่มีปัญหา
- นโยบายส่งออก: ทั้งหมด, เฉพาะที่ยืนยันแล้ว, ทำเครื่องหมายจุดต้องตรวจ หรือห้ามส่งออกเมื่อยังมีสีแดง
- CSV ของชั้นตรวจสอบรองรับ UTF-8 BOM, Empty Cell, Line Break, Delimiter แบบ Comma/Semicolon/Tab และรหัสที่มีเลขศูนย์นำหน้า
- Structured JSON เก็บ Row Span, Column Span, Confidence, Column Type และ Language Segment

## ไทย–อังกฤษผสมและคำไทยอ่านยาก

- แบ่งข้อความระดับ Segment เป็น Thai, English, Number, Email, URL, Phone, Document Code และ Punctuation
- รวม Segment กลับได้ตรงข้อความเดิม รวมช่องว่างและเครื่องหมาย
- Thai Unicode Normalization มีรายการการเปลี่ยนแปลงย้อนหลัง และไม่แปลงเลขไทยหรือแก้คำสะกดเอง
- Thai Grapheme Analyzer ตรวจสระ วรรณยุกต์ และอักขระประกอบที่ซ้ำหรือขาดฐาน
- คำไทยยาก คำยาว คำติดเส้นตาราง หรือ Confidence ต่ำจะถูกส่งเข้า Tab **คำไทยอ่านยาก**
- ชื่อบุคคล ตัวเลข อีเมล URL และรหัสจะไม่ถูกแก้จากบริบทโดยอัตโนมัติ
- Candidate Ranker เลือกได้เฉพาะ Candidate ที่มาจากหลักฐาน OCR เท่านั้น ไม่สามารถสร้างคำใหม่เอง
- รองรับ Custom Dictionary ของผู้ใช้ใน Local Storage
- กำหนดภาษาเฉพาะหน้าเป็น Auto, Thai, English, Thai-English หรือ Numeric/Code ได้

เอกสารรายละเอียดและข้อจำกัด: `docs/table-mixed-thai-upgrade.md`

## PWA และโหมดออฟไลน์

RipScan สามารถติดตั้งเป็นแอปจากเบราว์เซอร์ที่รองรับ PWA

1. เปิดเว็บด้วย Chrome, Edge หรือเบราว์เซอร์ที่รองรับ
2. กด **ติดตั้งแอป** เมื่อปุ่มปรากฏ หรือใช้เมนู Install App ของเบราว์เซอร์
3. ขณะออนไลน์ กด **เตรียมใช้งานออฟไลน์**
4. รอให้ระบบ Cache หน้าเว็บ, PDF.js, Tesseract.js และโมเดลภาษาไทย–อังกฤษเสร็จ
5. หลังจากนั้นสามารถเปิดแอปและ OCR รูปภาพได้แม้อินเทอร์เน็ตหลุด

Cache อาจถูกลบเมื่อผู้ใช้ล้างข้อมูลเว็บไซต์หรือระบบปฏิบัติการคืนพื้นที่

## ส่งออกไฟล์

รองรับการส่งออกเฉพาะหน้าที่เลือกหรือทุกหน้า:

- TXT
- Markdown
- HTML
- CSV
- JSON
- DOCX
- XLSX
- PDF ที่ค้นหาข้อความได้

การส่งออก PDF จะเปิดหน้าพิมพ์ของเบราว์เซอร์ ให้เลือก **Save as PDF** โดย PDF จะมีภาพและข้อความแยกรายหน้า แต่ยังไม่ใช่ Text Overlay ที่วางตรงพิกัด Cell ต้นฉบับทุกคำ

## Automated Tests

```bash
npm test
npm run check
npm run build
```

Build จะรัน Automated Tests ก่อนตรวจ Syntax และสร้าง Static output ใน `dist/`

ชุดปัจจุบันมี **17 Tests** ครอบคลุม:

- ไทย–อังกฤษผสมและการรวมข้อความกลับ
- Email, URL และ Document Code Preservation
- Thai Unicode และ Grapheme
- Numeric Strict Mode
- Column Type Inference
- Empty Cell Protection
- Cross-Cell Contamination
- Row Consistency
- Repeated Header และ Multi-page Continuation Evidence
- Candidate Ranking ที่ห้ามสร้าง Candidate ใหม่
- Confidence Threshold ของชื่อและรหัส
- คำไทยอ่านยาก
- Span, Multiline และเลขศูนย์นำหน้า
- CSV Escaping
- CER, WER และ Thai Grapheme Error Rate
- Catalog ข้อมูล Ground Truth จำลอง 25 ประเภท

ข้อมูลทดสอบ 25 ประเภทเป็น **Synthetic Structural Fixtures** ที่ไม่มีข้อมูลส่วนบุคคลจริง ไม่ใช่ผลทดสอบ OCR จากภาพจริง 25 ภาพ จึงยังไม่ใช้สรุป Accuracy ของ Production

## เปิดใช้งาน Backend ในเครื่องบน Windows

1. ติดตั้ง **Python 3.11–3.13** และเลือก `Add Python to PATH`
2. ติดตั้ง **Tesseract OCR** พร้อมภาษา `Thai` และ `English`
3. ดาวน์โหลดหรือ Clone repository
4. ดับเบิลคลิก `run-windows.bat`
5. เปิด `http://localhost:8000`

หาก Tesseract อยู่ที่ `C:\Program Files\Tesseract-OCR\tesseract.exe` แต่ระบบหาไม่เจอ ให้คัดลอก `.env.example` เป็น `.env` แล้วตั้งค่า:

```env
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
```

## macOS / Linux

```bash
chmod +x run-local.sh
./run-local.sh
```

## Docker

```bash
docker compose up --build
```

จากนั้นเปิด `http://localhost:8000`

## Local API

- หน้าเว็บ: `/`
- Health check: `/api/health`
- OCR: `POST /api/ocr`
- OpenAPI: `/docs`

> OCR อาจอ่านชื่อเฉพาะ ตัวเลข หรือตัวอักษรจากภาพไม่ชัดผิดได้ ควรตรวจเทียบต้นฉบับก่อนนำไปใช้ ระบบไม่อ้างว่าแม่น 100%
