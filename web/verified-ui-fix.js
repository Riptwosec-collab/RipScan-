import './heading-auto.js';

const AUTO_VERIFIED_SETTINGS = Object.freeze({
  tableMode: 'accurate',
  exportPolicy: 'mark_review',
  delimiter: ',',
});

function ensureAutomaticSettingsSentinel() {
  let sentinel = document.querySelector('#automaticVerifiedSettings');

  document.querySelectorAll('.verified-controls').forEach(panel => panel.remove());

  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.id = 'automaticVerifiedSettings';
    sentinel.hidden = true;
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.innerHTML = `
      <input id="tableMode" type="hidden" value="accurate">
      <input id="verifiedExportPolicy" type="hidden" value="mark_review">
      <input id="verifiedDelimiter" type="hidden" value=",">
    `;
    document.body.append(sentinel);
  }

  const tableMode = sentinel.querySelector('#tableMode');
  const exportPolicy = sentinel.querySelector('#verifiedExportPolicy');
  const delimiter = sentinel.querySelector('#verifiedDelimiter');

  if (tableMode) tableMode.value = AUTO_VERIFIED_SETTINGS.tableMode;
  if (exportPolicy) exportPolicy.value = AUTO_VERIFIED_SETTINGS.exportPolicy;
  if (delimiter) delimiter.value = AUTO_VERIFIED_SETTINGS.delimiter;

  return sentinel;
}

function enforceAutomaticVerifiedSettings() {
  try {
    localStorage.setItem('ripscan-table-mode', AUTO_VERIFIED_SETTINGS.tableMode);
    localStorage.setItem('ripscan-export-policy', AUTO_VERIFIED_SETTINGS.exportPolicy);
    localStorage.setItem('ripscan-delimiter', AUTO_VERIFIED_SETTINGS.delimiter);
  } catch {
    // The verification layer still uses fixed defaults when storage is unavailable.
  }

  ensureAutomaticSettingsSentinel();
  document.documentElement.dataset.verifiedSettings = 'automatic';
}

const observer = new MutationObserver(() => {
  if (document.querySelector('.verified-controls')) enforceAutomaticVerifiedSettings();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

enforceAutomaticVerifiedSettings();
