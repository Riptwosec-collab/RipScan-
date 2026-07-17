$ErrorActionPreference = 'Stop'

$RepoUrl = 'https://github.com/Riptwosec-collab/RipScan-.git'
$Branch = 'agent/ocr-clean-output-review-separation'
$CommitMessage = 'feat: separate OCR review metadata from clean exports'
$PatchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkRoot = Join-Path $env:TEMP 'ripscan-auto-upload'
$RepoRoot = Join-Path $WorkRoot 'RipScan-'

Write-Host '== RipScan automatic GitHub upload ==' -ForegroundColor Cyan

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'ไม่พบ Git กรุณาติดตั้ง Git for Windows ก่อน'
}

if (Test-Path $WorkRoot) {
  Remove-Item $WorkRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $WorkRoot | Out-Null

Write-Host '1/7 Clone repository...'
git clone $RepoUrl $RepoRoot
Set-Location $RepoRoot

Write-Host '2/7 Create feature branch...'
git checkout -b $Branch

Write-Host '3/7 Apply patch files...'
$Files = @(
  'package.json',
  'web/ocr-output-cleaner.mjs',
  'web/document-model.mjs',
  'web/editor-export.mjs',
  'web/verified.js',
  'tests/ocr-output-cleaner.test.mjs',
  'tests/document-review-model.test.mjs',
  'tests/editor-export-clean.test.mjs',
  'PATCH_NOTES.md'
)

foreach ($RelativePath in $Files) {
  $Source = Join-Path $PatchRoot $RelativePath
  $Destination = Join-Path $RepoRoot $RelativePath
  $DestinationDirectory = Split-Path -Parent $Destination
  if (-not (Test-Path $Source)) { throw "ไม่พบไฟล์ Patch: $RelativePath" }
  if (-not (Test-Path $DestinationDirectory)) {
    New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null
  }
  Copy-Item $Source $Destination -Force
}

Write-Host '4/7 Run tests and checks...'
if (Test-Path (Join-Path $RepoRoot 'package-lock.json')) {
  npm ci
}
npm test
npm run check
npm run build

Write-Host '5/7 Commit changes...'
git add package.json web/ocr-output-cleaner.mjs web/document-model.mjs web/editor-export.mjs web/verified.js tests/ocr-output-cleaner.test.mjs tests/document-review-model.test.mjs tests/editor-export-clean.test.mjs PATCH_NOTES.md
if (-not (git diff --cached --quiet)) {
  git commit -m $CommitMessage
} else {
  throw 'ไม่มีความเปลี่ยนแปลงสำหรับ Commit'
}

Write-Host '6/7 Push branch...'
git push -u origin $Branch

Write-Host '7/7 Open Draft PR...'
if (Get-Command gh -ErrorAction SilentlyContinue) {
  gh pr create --draft --base main --head $Branch --title 'OCR clean output and review separation' --body @'
## Summary
- separates OCR text content from review metadata
- adds centralized clean export policy
- filters possible text and gibberish by default
- adds phone validation, legacy marker migration, export preview, and tests

## Validation
- npm test
- npm run check
- npm run build
'@
} else {
  $CompareUrl = 'https://github.com/Riptwosec-collab/RipScan-/compare/main...' + $Branch + '?expand=1'
  Write-Host "Branch pushed successfully. Open this URL to create the PR:" -ForegroundColor Yellow
  Write-Host $CompareUrl
  Start-Process $CompareUrl
}

Write-Host 'Upload completed successfully.' -ForegroundColor Green
