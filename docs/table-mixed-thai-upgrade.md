# Table OCR + Mixed Thai-English Verification Upgrade

## Scope implemented in v1.5

This release adds a browser-side verification layer. Documents remain on the user's device.

### Table verification implemented

- Uses the existing line-grid detector and cell-level OCR for tables whose boundaries are detected.
- Infers column types from headers and repeated values.
- Applies strict validation to integer, decimal, currency, percentage, date, and time cells.
- Flags ambiguous pairs such as `O/0`, `I/l/1`, `S/5`, `B/8`, `Z/2`, and `G/6` for manual review instead of silently changing them.
- Protects empty and possibly-empty cells. Placeholders such as `O`, `-`, and `.` are not silently accepted as values.
- Detects likely cross-cell contamination using neighboring text, inferred column type, confidence, and available bounding-box evidence.
- Preserves multiline text, empty cells, leading-zero strings, row span, and column span in structured JSON.
- Adds a table-review section with cell state, reason, confidence summary, and navigation to the affected cell.
- Marks cells as verified, review recommended, manual review required, contaminated, empty, or possibly empty.
- Adds CSV and JSON export from the verified table with four export policies: all, verified only, mark unverified, or block while red cells remain.
- CSV supports UTF-8 BOM, comma/semicolon/tab delimiters, quoted newlines, empty cells, Thai text, and leading-zero codes.

### Thai-English verification implemented

- Detects Thai, English, numbers, email, URL, phone, document code, punctuation, and unknown tokens at segment level.
- Reassembles segments to the exact original string, including spaces and punctuation.
- Adds Thai Unicode normalization with an auditable change list; it does not convert Thai digits or rewrite spelling.
- Adds Thai grapheme-cluster checks for duplicated or orphaned vowels, tone marks, and combining marks.
- Routes difficult Thai words and words near table boundaries to review.
- Adds a user-controlled custom dictionary stored only in localStorage.
- Candidate ranking is restricted to candidates supplied by OCR evidence; the ranker cannot generate a new word.
- Adds strict-preservation classification for email, URL, phone, file path, version, and document code.
- Adds page-level language override metadata for Auto, Thai, English, mixed Thai-English, or numeric/code review.
- Adds separate evidence-based confidence thresholds for general text, difficult Thai, names, numeric values, and codes.

## Tests

`npm test` runs Node's built-in test runner against `tests/ocr-core.test.mjs`.

The current suite contains 17 automated checks covering:

- Mixed Thai-English segmentation and exact reassembly.
- Strict email, URL, and code preservation.
- Thai Unicode and grapheme behavior.
- Numeric, date, currency, and percentage validation.
- Column-type inference.
- Empty-cell protection.
- Cross-cell contamination detection.
- Row consistency.
- Repeated-header and multi-page-continuation evidence.
- Candidate ranking without invented candidates.
- Stricter confidence thresholds for names and codes.
- Difficult-Thai review routing.
- Structured spans and leading-zero preservation.
- CSV escaping and empty-cell preservation.
- CER, WER, and Thai Grapheme Error Rate functions.
- A catalog of 25 synthetic, privacy-safe table ground-truth fixtures.

## Accuracy reporting

No production accuracy percentage is claimed. Metric functions now exist for CER, WER, Thai Grapheme Error Rate, cell status, and contamination evidence. Real before/after accuracy requires labeled source images or PDFs plus browser OCR runs. The 25 fixtures validate structural and preservation rules only; they are not 25 rendered OCR images.

## Remaining limitations

The following requirements are not claimed as completed in v1.5:

- Borderless-table reconstruction from OCR word bounding boxes.
- Full manual grid editor with drag/add/remove line tools, merge/split, and undo/redo.
- Automatic OCR variants that remove or inpaint table lines for every cell.
- Automatic cell, row, and table OCR comparison view with multiple cloud providers.
- Region-level re-OCR from a manually selected bounding box.
- Automatic document vocabulary learning and expiry lifecycle.
- Automatic cross-page table merging in the UI.
- Verified XLSX/DOCX table export from the new review layer. Existing general export remains available separately.
- Searchable PDF text overlay positioned inside each original cell.
- Production CER/WER and contamination-rate measurements on a labeled real-world dataset.
- Browser End-to-End tests for the review interactions.

These items need a later phase with reliable word/cell bounding boxes, rendered test documents, and browser automation. The UI and core intentionally avoid guessing missing cell content while those features are incomplete.
