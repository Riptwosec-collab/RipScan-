$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  Write-Host "ไม่พบ Python กรุณาติดตั้ง Python 3.11-3.13 และเลือก Add Python to PATH" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }
if (-not (Test-Path ".venv")) { python -m venv .venv }
& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt

$tesseract = Get-Command tesseract -ErrorAction SilentlyContinue
if (-not $tesseract -and -not (Test-Path "C:\Program Files\Tesseract-OCR\tesseract.exe")) {
  Write-Host "ยังไม่พบ Tesseract OCR กรุณาติดตั้งพร้อมภาษา Thai และ English" -ForegroundColor Yellow
  Write-Host "หลังติดตั้ง แก้ TESSERACT_CMD ในไฟล์ .env หากไม่ได้อยู่ใน PATH"
}

Start-Process "http://localhost:8000"
& ".\.venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
