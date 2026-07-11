import { structureHeadings } from './heading-structure.mjs';

const results = document.querySelector('#results');
const attached = new WeakSet();

function applyHeadingStructure(textarea, { force = false } = {}) {
  if (!textarea || !textarea.value.trim()) return null;
  if (!force && textarea.dataset.headingUserEdited === 'true') return null;

  const structured = structureHeadings(textarea.value);
  if (structured.text && structured.text !== textarea.value) textarea.value = structured.text;

  textarea.dataset.headingCount = String(structured.headings.length);
  textarea.closest('.page-card')?.setAttribute('data-heading-count', String(structured.headings.length));
  textarea.dispatchEvent(new CustomEvent('ripscan:headings-structured', {
    bubbles: true,
    detail: { headings: structured.headings, sections: structured.sections },
  }));
  return structured;
}

function attachTextarea(textarea) {
  if (attached.has(textarea)) return;
  attached.add(textarea);
  textarea.dataset.headingAuto = 'true';

  textarea.addEventListener('input', event => {
    if (event.isTrusted) {
      textarea.dataset.headingUserEdited = 'true';
      return;
    }
    queueMicrotask(() => applyHeadingStructure(textarea, { force: true }));
  });

  requestAnimationFrame(() => applyHeadingStructure(textarea, { force: true }));
}

function scan(root = document) {
  root.querySelectorAll?.('textarea.page-text').forEach(attachTextarea);
}

if (results) {
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('textarea.page-text')) attachTextarea(node);
        scan(node);
      }
    }
  }).observe(results, { childList: true, subtree: true });

  results.addEventListener('click', event => {
    if (!event.target.closest('[data-managed-action="copy-all"], [data-managed-action="export-selected"], [data-managed-action="export-all"]')) return;
    results.querySelectorAll('textarea.page-text').forEach(textarea => applyHeadingStructure(textarea));
  }, true);
}

scan();
document.documentElement.dataset.headingSeparation = 'automatic';
