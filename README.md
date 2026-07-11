# RipScan — Thai-English OCR

เว็บแปลงภาพและ PDF เป็นข้อความภาษาไทย–อังกฤษแบบใช้งานในเครื่อง รองรับ PDF Text Layer และ Tesseract OCR โดยไฟล์จะถูกประมวลผลในหน่วยความจำและไม่เก็บถาวร

## เปิดใช้งานบน Windows

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

## API

- หน้าเว็บ: `/`
- Health check: `/api/health`
- OCR: `POST /api/ocr`
- OpenAPI: `/docs`

## รองรับ

- PNG, JPG, WEBP, TIFF, BMP
- PDF สูงสุด 100 หน้า
- ภาษาไทย, อังกฤษ หรือไทย+อังกฤษ
- หลายไฟล์พร้อมกัน สูงสุด 10 ไฟล์
- คัดลอก แก้ข้อความ และดาวน์โหลด TXT จากหน้าเว็บ

> OCR อาจอ่านชื่อเฉพาะ ตัวเลข หรือตัวอักษรจากภาพไม่ชัดผิดได้ ควรตรวจเทียบต้นฉบับก่อนนำไปใช้
