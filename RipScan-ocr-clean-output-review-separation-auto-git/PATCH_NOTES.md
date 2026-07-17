# RipScan OCR Clean Output / Review Separation Patch

## Changed files

- `web/ocr-output-cleaner.mjs` — central review metadata, output policy, marker migration, sanitizing, phone validation, gibberish detection, domain candidates, export preview.
- `web/document-model.mjs` — Document Model 4.1 review metadata separated from text, legacy migration, decoration layer, clean `documentToPlainText()`.
- `web/editor-export.mjs` — shared clean policy for TXT, DOCX, XLSX, JSON, searchable PDF, rendered PDF/image cleanup, export preview.
- `web/verified.js` — removes marker injection, adds output modes, Review Panel actions, clean copy buttons, warning for unverified copy, CSV/JSON clean export.
- `tests/*.test.mjs` — 27 regression/unit tests.
- `package.json` — adds `web/ocr-output-cleaner.mjs` to `npm run check`.

## Default policy

`Clean Verified + Reviewed`

- verified: included
- review_required + confirmed: included
- review_required + unconfirmed: excluded
- possible_text: excluded
- gibberish: excluded
- confirmed_non_text: excluded
- rejected: excluded

## Validation performed

```text
node --check web/ocr-output-cleaner.mjs
node --check web/document-model.mjs
node --check web/editor-export.mjs
node --check web/verified.js
node --test tests/*.test.mjs
```

Result: 27 tests passed, 0 failed.

## Apply

Extract this archive at the repository root and allow replacement of the listed files, then run:

```bash
npm test
npm run check
npm run build
```
