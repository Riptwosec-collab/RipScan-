import './performance-emergency-ui.js';

const root = document.documentElement;
const themeToggle = document.querySelector('#themeToggle');
const menuToggle = document.querySelector('#menuToggle');
const mainNav = document.querySelector('#mainNav');
const chooseFileButton = document.querySelector('#chooseFileButton');
const fileInput = document.querySelector('#fileInput');
const dropzone = document.querySelector('#dropzone');
const uploadTitle = document.querySelector('#uploadTitle');
const runButton = document.querySelector('#runButton');
const runButtonLabel = runButton?.querySelector('.button-label');
const statusBox = document.querySelector('#status');
const themeMeta = document.querySelector('meta[name="theme-color"]');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const systemTheme = matchMedia('(prefers-color-scheme: light)');
const defaultUploadTitle = uploadTitle?.textContent || 'ลากไฟล์มาวาง หรือคลิกเพื่อเลือก';

function storedTheme() {
  try { return localStorage.getItem('ripscan-theme'); }
  catch { return null; }
}

function applyTheme(theme, { save = false } = {}) {
  const next = theme === 'light' ? 'light' : 'dark';
  root.dataset.theme = next;
  root.style.colorScheme = next;
  themeMeta?.setAttribute('content', next === 'dark' ? '#050725' : '#f7faff');
  if (themeToggle) {
    const isLight = next === 'light';
    themeToggle.setAttribute('aria-pressed', String(isLight));
    themeToggle.setAttribute('aria-label', isLight ? 'สลับเป็นธีมมืด' : 'สลับเป็นธีมสว่าง');
    themeToggle.title = isLight ? 'ธีมมืด' : 'ธีมสว่าง';
  }
  if (save) {
    try { localStorage.setItem('ripscan-theme', next); }
    catch { /* Private mode may block storage. */ }
  }
}

applyTheme(root.dataset.theme || 'dark');

themeToggle?.addEventListener('click', () => {
  applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark', { save: true });
});

systemTheme.addEventListener?.('change', event => {
  if (!storedTheme()) applyTheme(event.matches ? 'light' : 'dark');
});

function closeMenu({ restoreFocus = false } = {}) {
  if (!mainNav || !menuToggle) return;
  mainNav.classList.remove('is-open');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'เปิดเมนู');
  if (restoreFocus) menuToggle.focus();
}

menuToggle?.addEventListener('click', event => {
  event.stopPropagation();
  const open = !mainNav?.classList.contains('is-open');
  mainNav?.classList.toggle('is-open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'ปิดเมนู' : 'เปิดเมนู');
});

mainNav?.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link) return;
  mainNav.querySelectorAll('a').forEach(item => {
    item.classList.toggle('active', item === link);
    if (item === link) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  closeMenu();
});

document.addEventListener('click', event => {
  if (!mainNav?.classList.contains('is-open')) return;
  if (!event.target.closest('.topbar')) closeMenu();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mainNav?.classList.contains('is-open')) closeMenu({ restoreFocus: true });
});

chooseFileButton?.addEventListener('click', event => {
  event.stopPropagation();
  if (!chooseFileButton.disabled) fileInput?.click();
});

function syncBusyState() {
  const busy = Boolean(statusBox && !statusBox.hidden);
  runButton?.classList.toggle('is-loading', busy);
  if (runButtonLabel) runButtonLabel.textContent = busy ? 'กำลังประมวลผล...' : 'เริ่มแปลงข้อความ';
  if (chooseFileButton) chooseFileButton.disabled = busy;
}

if (statusBox) {
  new MutationObserver(syncBusyState).observe(statusBox, { attributes: true, attributeFilter: ['hidden'] });
  syncBusyState();
}

let dragDepth = 0;

dropzone?.addEventListener('dragenter', () => {
  dragDepth += 1;
  if (uploadTitle) uploadTitle.textContent = 'วางไฟล์เพื่อเริ่มสแกน';
});

dropzone?.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth && uploadTitle) uploadTitle.textContent = defaultUploadTitle;
});

dropzone?.addEventListener('drop', () => {
  dragDepth = 0;
  if (uploadTitle) uploadTitle.textContent = defaultUploadTitle;
});

const navLinks = [...(mainNav?.querySelectorAll('a[href^="#"]') || [])];
const sections = navLinks
  .map(link => ({ link, section: document.querySelector(link.getAttribute('href')) }))
  .filter(item => item.section);

function updateActiveNavigation() {
  const marker = scrollY + 150;
  let selected = sections[0];
  for (const item of sections) {
    if (item.section.offsetTop <= marker) selected = item;
  }
  if (!selected) return;
  navLinks.forEach(link => {
    const active = link === selected.link;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

let scrollFrame = 0;
function handleScroll() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    document.querySelector('.topbar')?.classList.toggle('is-scrolled', scrollY > 12);
    updateActiveNavigation();
    scrollFrame = 0;
  });
}

addEventListener('scroll', handleScroll, { passive: true });
handleScroll();

const pointerFine = matchMedia('(pointer: fine)').matches;
const parallaxRoots = [...document.querySelectorAll('[data-parallax-root]')];
const backdropItems = [...document.querySelectorAll('.site-backdrop [data-depth]')];
let parallaxFrame = 0;
let pointerX = 0;
let pointerY = 0;

function paintParallax() {
  const x = pointerX - innerWidth / 2;
  const y = pointerY - innerHeight / 2;
  backdropItems.forEach(item => {
    const depth = Number(item.dataset.depth || 0.2);
    item.style.translate = `${x * depth * 0.018}px ${y * depth * 0.018}px`;
  });
  parallaxRoots.forEach(stage => {
    const rect = stage.getBoundingClientRect();
    const localX = Math.max(-1, Math.min(1, (pointerX - rect.left - rect.width / 2) / Math.max(1, rect.width / 2)));
    const localY = Math.max(-1, Math.min(1, (pointerY - rect.top - rect.height / 2) / Math.max(1, rect.height / 2)));
    stage.querySelectorAll('[data-depth]').forEach(item => {
      const depth = Number(item.dataset.depth || 0.3);
      item.style.translate = `${localX * depth * 8}px ${localY * depth * 8}px`;
    });
  });
  parallaxFrame = 0;
}

if (pointerFine && !reduceMotion.matches) {
  addEventListener('pointermove', event => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!parallaxFrame) parallaxFrame = requestAnimationFrame(paintParallax);
  }, { passive: true });

  document.querySelector('.hero-visual')?.addEventListener('pointerleave', () => {
    parallaxRoots.forEach(stage => stage.querySelectorAll('[data-depth]').forEach(item => { item.style.translate = ''; }));
  });
}

requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-ready')));
