วิธีอัปโหลดขึ้น GitHub อัตโนมัติ

1. แตกไฟล์ ZIP
2. คลิกขวา upload-to-github.ps1
3. เลือก Run with PowerShell

สคริปต์จะทำให้อัตโนมัติ:
- Clone repository Riptwosec-collab/RipScan-
- สร้าง branch agent/ocr-clean-output-review-separation
- วางไฟล์ Patch
- รัน npm test, npm run check และ npm run build
- Commit และ Push
- เปิด Draft Pull Request ถ้ามี GitHub CLI

หมายเหตุ:
- ต้องติดตั้ง Git for Windows
- ต้อง Login GitHub ใน Git Credential Manager หรือ GitHub CLI ไว้ก่อน
