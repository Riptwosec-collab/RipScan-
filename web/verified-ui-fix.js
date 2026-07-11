const AUTO_VERIFIED_SETTINGS = Object.freeze({
  tableMode: 'accurate',
  exportPolicy: 'mark_review',
  delimiter: ',',
});

function enforceAutomaticVerifiedSettings() {
  try {
    localStorage.setItem('ripscan-table-mode', AUTO_VERIFIED_SETTINGS.tableMode);
    localStorage.setItem('ripscan-export-policy', AUTO_VERIFIED_SETTINGS.exportPolicy);
    localStorage.setItem('ripscan-delimiter', AUTO_VERIFIED_SETTINGS.delimiter);
  } catch {
    // The verification layer still uses its built-in defaults when storage is unavailable.
  }

  const panel = document.querySelector('.verified-controls');
  if (!panel) return;

  const tableMode = panel.querySelector('#tableMode');
  const exportPolicy = panel.querySelector('#verifiedExportPolicy');
  const delimiter = panel.querySelector('#verifiedDelimiter');

  if (tableMode) tableMode.value = AUTO_VERIFIED_SETTINGS.tableMode;
  if (exportPolicy) exportPolicy.value = AUTO_VERIFIED_SETTINGS.exportPolicy;
  if (delimiter) delimiter.value = AUTO_VERIFIED_SETTINGS.delimiter;

  panel.hidden = true;
  panel.setAttribute('aria-hidden', 'true');
  panel.style.display = 'none';

  if ('inert' in panel) panel.inert = true;
}

const observer = new MutationObserver(enforceAutomaticVerifiedSettings);
observer.observe(document.documentElement, { childList: true, subtree: true });
enforceAutomaticVerifiedSettings();

document.documentElement.dataset.verifiedSettings = 'automatic';
