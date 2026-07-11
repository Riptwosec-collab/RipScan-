# RipScan — Thai-English OCR

เว็บแปลงภาพและ PDF เป็นข้อความภาษาไทย–อังกฤษ รองรับการใช้งานออนไลน์บน Vercel และการใช้งานในเครื่อง

## ใช้งานออนไลน์

เปิด:

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

การส่งออก PDF จะเปิดหน้าพิมพ์ของเบราว์เซอร์ ให้เลือก **Save as PDF** โดย PDF จะมีภาพและข้อความแยกรายหน้าเพื่อให้ค้นหาและคัดลอกข้อความได้ แต่ยังไม่ใช่ Text Overlay แบบวางตรงพิกัดต้นฉบับทุกคำ

## เปิดใช้งาน Backend ในเครื่องบน Windows

โหมด Local ใช้ FastAPI และ Tesseract OCR ที่ติดตั้งในเครื่อง

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

## ตรวจและ Build เว็บ Static

```bash
npm run check
npm run build
```

Static output จะอยู่ในโฟลเดอร์ `dist/`

## Local API

- หน้าเว็บ: `/`
- Health check: `/api/health`
- OCR: `POST /api/ocr`
- OpenAPI: `/docs`

> OCR อาจอ่านชื่อเฉพาะ ตัวเลข หรือตัวอักษรจากภาพไม่ชัดผิดได้ ควรตรวจเทียบต้นฉบับก่อนนำไปใช้
