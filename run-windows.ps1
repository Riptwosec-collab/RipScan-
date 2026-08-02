$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  Write-Host 'Python was not found. Install Python 3.11-3.13 and enable Add Python to PATH.' -ForegroundColor Red
  exit 1
}

if (-not (Test-Path '.env') -and (Test-Path '.env.example')) { Copy-Item '.env.example' '.env' }
if (-not (Test-Path '.venv')) { python -m venv .venv }

$pythonExe = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
& $pythonExe -m pip install --upgrade pip
& $pythonExe -m pip install -r requirements.txt

$tesseract = Get-Command tesseract -ErrorAction SilentlyContinue
if (-not $tesseract -and -not (Test-Path 'C:\Program Files\Tesseract-OCR\tesseract.exe')) {
  Write-Host 'Tesseract OCR was not found. Install Thai and English language data before scanning.' -ForegroundColor Yellow
  Write-Host 'Set TESSERACT_CMD in .env when tesseract.exe is not on PATH.'
}

$server = Start-Process -FilePath $pythonExe -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', '8000') -NoNewWindow -PassThru
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    try {
      Invoke-WebRequest -Uri 'http://localhost:8000/api/health' -UseBasicParsing -TimeoutSec 1 | Out-Null
      $ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $ready) { throw 'The local server did not become ready within 10 seconds.' }
  Start-Process 'http://localhost:8000'
  Wait-Process -Id $server.Id
} finally {
  if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
