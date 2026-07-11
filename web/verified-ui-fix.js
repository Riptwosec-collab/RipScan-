function applyVerifiedUiGuard() {
  const panel = document.querySelector('.verified-controls');
  const mode = panel?.querySelector('#tableMode');
  if (!mode) return;

  const label = mode.closest('label');
  if (label) {
    label.innerHTML = '<span>การตรวจตาราง</span><input value="Verified Cell Review" disabled aria-label="โหมดตรวจตารางที่ใช้งานอยู่">';
  }

  const note = panel.querySelector('small');
  if (note) {
    note.textContent = 'ชั้นตรวจสอบนี้ไม่ย้ายข้อความข้าม Cell ไม่เติม Cell ว่าง และไม่เดาชื่อ ตัวเลข หรือรหัส · Manual Grid เต็มรูปแบบยังไม่เปิดในรุ่นนี้';
  }
}

const observer = new MutationObserver(applyVerifiedUiGuard);
observer.observe(document.documentElement, { childList: true, subtree: true });
applyVerifiedUiGuard();
