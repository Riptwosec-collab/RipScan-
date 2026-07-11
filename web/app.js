const state = { files: [] };
const input = document.querySelector('#fileInput');
const dropzone = document.querySelector('#dropzone');
const fileList = document.querySelector('#fileList');
const runButton = document.querySelector('#runButton');
const language = document.querySelector('#language');
const statusBox = document.querySelector('#status');
const statusText = document.querySelector('#statusText');
const errorBox = document.querySelector('#error');
const results = document.querySelector('#results');

const formatBytes = bytes => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const escapeHtml = value => value.replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

function setFiles(files) {
  state.files = [...files].slice(0, 10);
  fileList.innerHTML = state.files.map((file, index) => `
    <div class="file-row"><span class="file-type">${file.type === 'application/pdf' ? 'PDF' : 'IMG'}</span>
      <span class="file-name"><strong>${escapeHtml(file.name)}</strong><small>${formatBytes(file.size)}</small></span>
      <button class="remove" data-index="${index}" aria-label="ลบไฟล์">×</button></div>`).join('');
  runButton.disabled = !state.files.length;
}

dropzone.addEventListener('click', () => input.click());
dropzone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') input.click(); });
input.addEventListener('change', () => setFiles(input.files));
['dragenter','dragover'].forEach(type => dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add('dragging'); }));
['dragleave','drop'].forEach(type => dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.remove('dragging'); }));
dropzone.addEventListener('drop', event => setFiles(event.dataTransfer.files));
fileList.addEventListener('click', event => {
  const button = event.target.closest('.remove');
  if (!button) return;
  state.files.splice(Number(button.dataset.index), 1); setFiles(state.files);
});

function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }
function setBusy(busy, text = 'กำลังประมวลผล…') {
  statusBox.hidden = !busy; statusText.textContent = text; runButton.disabled = busy || !state.files.length;
}

runButton.addEventListener('click', async () => {
  errorBox.hidden = true; results.innerHTML = ''; setBusy(true, 'กำลังอ่านเอกสารและตรวจภาษา…');
  const body = new FormData(); state.files.forEach(file => body.append('files', file));
  try {
    const response = await fetch(`/api/ocr?language=${encodeURIComponent(language.value)}`, { method: 'POST', body });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'แปลงไฟล์ไม่สำเร็จ');
    renderResults(payload);
  } catch (error) { showError(error.message || 'เชื่อมต่อระบบไม่ได้'); }
  finally { setBusy(false); }
});

function renderResults(documents) {
  results.innerHTML = documents.map((document, index) => {
    const confidence = Math.round(document.confidence * 100);
    return `<article class="panel result-card">
      <div class="result-head"><div><p class="eyebrow">ผลลัพธ์ ${index + 1}</p><h2>${escapeHtml(document.filename)}</h2><p>${document.pageCount} หน้า · ความมั่นใจเฉลี่ย ${confidence}%</p></div>
      <span class="score ${confidence >= 85 ? 'good' : confidence >= 65 ? 'warn' : 'bad'}">${confidence}%</span></div>
      <textarea id="text-${index}" spellcheck="false">${escapeHtml(document.fullText)}</textarea>
      <div class="actions"><button onclick="copyResult(${index})">คัดลอก</button><button onclick="downloadResult(${index}, '${escapeHtml(document.filename).replace(/'/g, '')}')">ดาวน์โหลด TXT</button></div>
      <details><summary>ดูรายละเอียดแต่ละหน้า</summary>${document.pages.map(page => `<div class="page-detail"><strong>หน้า ${page.page}</strong><span>${page.source === 'pdf-text' ? 'อ่านข้อความจาก PDF' : 'OCR'} · ${Math.round(page.confidence * 100)}%</span></div>`).join('')}</details>
    </article>`;
  }).join('');
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

window.copyResult = async index => {
  const area = document.querySelector(`#text-${index}`); await navigator.clipboard.writeText(area.value);
};
window.downloadResult = (index, filename) => {
  const text = document.querySelector(`#text-${index}`).value;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
  link.download = `${filename.replace(/\.[^.]+$/, '')}-ocr.txt`; link.click(); URL.revokeObjectURL(link.href);
};

fetch('/api/health').then(response => response.json()).then(data => {
  const node = document.querySelector('#health');
  node.classList.toggle('ready', data.status === 'healthy');
  node.querySelector('span:last-child').textContent = data.status === 'healthy' ? `พร้อมใช้งาน · ${data.languages.join(' + ')}` : 'ต้องติดตั้ง Tesseract ไทย/อังกฤษ';
}).catch(() => { document.querySelector('#health span:last-child').textContent = 'เชื่อมต่อระบบไม่ได้'; });
