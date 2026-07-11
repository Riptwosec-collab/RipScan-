# Table OCR + Mixed Thai-English Verification Upgrade

## Scope implemented in v1.5

This upgrade adds a browser-side verification layer without sending documents to a server.

### Table verification

- Validates column types from headers and repeated values.
- Strict validation for integer, decimal, currency, percentage, date, and time cells.
- Protects empty and possibly-empty cells; placeholders such as `0`, `O`, `-`, and `.` are not silently accepted as values.
- Detects likely cross-cell contamination using neighboring text, column type, confidence, and available bounding-box evidence.
- Preserves row span, column span, multiline text, empty cells, and leading-zero codes in structured exports.
- Adds a table review tab with cell status, reasons, confidence summary, and direct navigation to problematic cells.
- Adds Manual Grid controls: merge, split, add/delete row or column, mark empty, undo, and redo.
- Adds structured CSV, XLSX, DOCX-table, and JSON exports from the edited grid.
- Adds borderless-table detection based on OCR word bounding boxes, repeated alignment, repeated large gaps across rows, and vertical line clustering. It does not use whitespace count alone.

### Thai-English verification

- Detects Thai, English, numbers, email, URL, document code, punctuation, and mixed text at token/segment level.
- Preserves the original text when segments are joined.
- Adds Thai Unicode normalization with an audit list; does not convert Thai digits or rewrite spelling.
- Adds Thai grapheme-cluster validation for duplicated or orphaned vowels/tone marks.
- Routes difficult Thai words and words near table boundaries to review.
- Adds document-local vocabulary and a user-controlled custom dictionary stored in localStorage.
- Uses candidate ranking only on supplied candidates. The ranking function cannot generate a new candidate.
- Adds strict-preservation checks for email, URL, phone, file path, version, and document code.
- Adds configurable manual language override for a page or selected table cell.

### Export policy

Users can choose:

- Export all text.
- Export verified text only.
- Mark unverified cells with `[โปรดตรวจสอบ: ...]`.
- Block export while red cells remain.

CSV supports UTF-8 BOM, comma/semicolon/tab delimiters, quoted newlines, quoted delimiters, empty cells, Thai text, and leading-zero codes.

## Tests

`npm test` runs Node's built-in test runner against `tests/ocr-core.test.mjs`.

The current suite covers 17 automated checks:

- Thai-English segmentation and exact reassembly.
- Strict email/URL/code preservation.
- Thai Unicode and grapheme behavior.
- Numeric/date/currency strict validation.
- Column inference.
- Empty-cell protection.
- Cell-contamination detection.
- Row consistency.
- Repeated headers and multi-page continuation evidence.
- Candidate ranking without invented candidates.
- Stricter confidence thresholds for names/codes.
- Difficult Thai review routing.
- Structured spans and leading-zero preservation.
- CSV escaping and empty cells.
- CER/WER/Thai grapheme metrics.
- A catalog of 25 synthetic, privacy-safe table ground-truth fixtures.

## Accuracy reporting

No production accuracy percentage is claimed. The repository now contains metric functions for CER, WER, Thai Grapheme Error Rate, cell status, contamination rate, and structure confidence. Real before/after accuracy requires a labeled image/PDF dataset and browser OCR runs. The synthetic fixtures validate structure and preservation rules, not real-world OCR accuracy.

## Remaining limitations

- Borderless-table detection is heuristic and works best when columns repeat at similar X positions across multiple rows.
- Cell-level re-OCR from the review grid is not enabled unless the OCR result includes reliable source bounding boxes for that cell.
- Line removal/inpainting variants are not yet applied to every cell; the existing line-table pipeline crops inside detected boundaries.
- Google Vision and Azure comparisons are not available in the privacy-only Vercel mode.
- Searchable PDF text overlay at exact cell coordinates is not implemented in this browser-only release.
- Multi-page table continuation evidence is implemented in the core module, but automatic cross-page table merging remains opt-in/manual in the UI.
- The 25 fixtures are synthetic structural ground truth; they do not include 25 rendered images.
