# RipScan — Thai-English OCR

เว็บแปลงภาพและ PDF เป็นข้อความภาษาไทย–อังกฤษ รองรับการใช้งานออนไลน์บน Vercel และการใช้งานในเครื่อง

## ใช้งานออนไลน์

เปิด:

```text
https://rip-scan.vercel.app
```

โหมดออนไลน์ประมวลผล OCR ภายในเบราว์เซอร์ด้วย Tesseract.js และใช้ PDF.js อ่าน Text Layer หรือแปลงหน้าสแกนเป็นภาพก่อน OCR ไฟล์ไม่ถูกอัปโหลดไปเก็บบนเซิร์ฟเวอร์

รองรับ:

- PNG, JPG, WEBP, TIFF, BMP และ PDF
- ภาษาไทย ภาษาอังกฤษ และไทย+อังกฤษ
- PDF Text Layer
- PDF สแกนสูงสุด 100 หน้า
- หลายไฟล์พร้อมกันสูงสุด 10 ไฟล์
- แก้ข้อความ คัดลอก และดาวน์โหลด TXT

> การเปิดครั้งแรกต้องใช้อินเทอร์เน็ตเพื่อโหลดระบบ OCR และชุดภาษา หลังจากนั้นเบราว์เซอร์อาจเก็บ Cache ไว้เพื่อให้เปิดเร็วขึ้น

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

## Vercel Build

```bash
npm install
npm run build
```

Static output จะอยู่ในโฟลเดอร์ `dist/`

## Local API

- หน้าเว็บ: `/`
- Health check: `/api/health`
- OCR: `POST /api/ocr`
- OpenAPI: `/docs`

> OCR อาจอ่านชื่อเฉพาะ ตัวเลข หรือตัวอักษรจากภาพไม่ชัดผิดได้ ควรตรวจเทียบต้นฉบับก่อนนำไปใช้
