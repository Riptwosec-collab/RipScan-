import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeThaiGraphemes,
  assessEmptyCell,
  buildTableModel,
  calculateTextMetrics,
  classifyToken,
  confidenceBreakdown,
  detectCellContamination,
  detectRepeatedHeader,
  detectTableContinuation,
  difficultThaiIssues,
  exportDelimited,
  inferColumnType,
  joinSegments,
  normalizeThaiUnicode,
  rankCandidates,
  segmentMixedLanguage,
  strictPreservationKind,
  thaiGraphemes,
  validateRowConsistency,
  validateStrictNumber,
} from '../web/ocr-core.mjs';

test('mixed Thai-English segmentation preserves exact text', () => {
  const input = 'บริษัท ABC Technology จำกัด Ticket No. INC-2569-001';
  const segments = segmentMixedLanguage(input);
  assert.equal(joinSegments(segments), input);
  assert.ok(segments.some(item => item.type === 'thai'));
  assert.ok(segments.some(item => item.type === 'english'));
  assert.ok(segments.some(item => item.type === 'document_code'));
});

test('strict preservation classifies email URL and document code', () => {
  assert.equal(strictPreservationKind('support@example.com'), 'email');
  assert.equal(strictPreservationKind('https://example.com/a?id=1'), 'url');
  assert.equal(strictPreservationKind('INC-2569-001'), 'document_code');
  assert.equal(classifyToken('Windows'), 'english');
});

test('Thai normalization removes zero-width but preserves Thai marks and digits', () => {
  const result = normalizeThaiUnicode('ผู้\u200Bรับผิดชอบ ๑๒๓ ๆ ฯ ์');
  assert.equal(result.normalizedText.includes('\u200B'), false);
  assert.ok(result.normalizedText.includes('๑๒๓'));
  assert.ok(result.normalizedText.includes('ๆ'));
  assert.ok(result.normalizedText.includes('ฯ'));
});

test('Thai grapheme analyzer keeps combining marks with base', () => {
  const graphemes = thaiGraphemes('เจ้าหน้าที่');
  assert.ok(graphemes.length < [...'เจ้าหน้าที่'].length);
  assert.equal(analyzeThaiGraphemes('เจ้าหน้าที่').valid, true);
});

test('numeric strict mode flags ambiguity and validates formats', () => {
  assert.equal(validateStrictNumber('1,250.00', 'currency').valid, true);
  assert.equal(validateStrictNumber('(1,200.00)', 'currency').valid, true);
  assert.equal(validateStrictNumber('7.5%', 'percentage').valid, true);
  assert.equal(validateStrictNumber('11/07/2569', 'date').valid, true);
  assert.equal(validateStrictNumber('O8.30', 'time').ambiguous, true);
});

test('column type inference uses header and value evidence', () => {
  assert.equal(inferColumnType('จำนวนเงิน', ['1,250.00', '500.00']).type, 'currency');
  assert.equal(inferColumnType('', ['a@example.com', 'b@example.com']).type, 'email');
});

test('empty-cell protection does not invent placeholders', () => {
  const empty = assessEmptyCell({ text: '', foregroundRatio: 0.002, connectedComponents: 0, wordCount: 0 });
  assert.equal(empty.isEmpty, true);
  const suspicious = assessEmptyCell({ text: '-', foregroundRatio: 0.003, connectedComponents: 1, wordCount: 0 });
  assert.ok(['empty', 'possibly_empty'].includes(suspicious.status));
});

test('contamination detector catches numeric column leakage', () => {
  const result = detectCellContamination({ text: 'ฝ่ายบัญชี 25', columnType: 'currency', neighboringTexts: ['ฝ่ายบัญชี'], confidence: 0.8 });
  assert.equal(result.contaminated, true);
  assert.ok(result.reasons.includes('column_type_mismatch'));
});

test('row consistency detects missing cells', () => {
  const result = validateRowConsistency([[1, 2, 3], [1, 2], [1, 2, 3]]);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.type === 'missing_cell'));
});

test('repeated headers and table continuation are detected without duplicating data', () => {
  const header = ['ลำดับ', 'ชื่อ', 'จำนวน'];
  assert.equal(detectRepeatedHeader(header, header).repeated, true);
  const continuation = detectTableContinuation(
    { columnCount: 3, columnWidths: [10, 50, 20], header, lastRunningNumber: 25 },
    { columnCount: 3, columnWidths: [10, 49, 21], header, firstRunningNumber: 26 },
  );
  assert.equal(continuation.continuation, true);
});

test('candidate ranker never creates a candidate outside supplied list', () => {
  const result = rankCandidates([
    { text: 'สำนักงาน', ocrConfidence: 0.95, evidence: { providerAgreement: 1, imageMatch: 1, documentRepetition: 0.9 } },
    { text: 'สำนักงาบ', ocrConfidence: 0.5, evidence: { providerAgreement: 0.2, imageMatch: 0.4 } },
  ]);
  assert.equal(result.selectedCandidate, 'สำนักงาน');
  assert.ok(result.candidates.every(item => ['สำนักงาน', 'สำนักงาบ'].includes(item.text)));
});

test('confidence thresholds are stricter for names and codes', () => {
  const evidence = { ocrConfidence: 0.97, providerAgreement: 0.97, scriptConfidence: 0.98, imageQuality: 0.95, dictionarySupport: 0.9, documentRepetitionSupport: 0.9, formatValidation: 1 };
  const general = confidenceBreakdown(evidence, 'general');
  const name = confidenceBreakdown(evidence, 'person_name');
  assert.ok(name.threshold > general.threshold);
});

test('difficult Thai words are routed to review with lower confidence', () => {
  const issues = difficultThaiIssues('เจ้าหน้าที่ผู้รับผิดชอบ', { confidence: 0.9, nearTableLine: true });
  assert.ok(issues.length > 0);
  assert.ok(issues.some(issue => issue.reasons.includes('near_table_line')));
});

test('structured table model preserves multiline text spans and leading zero strings', () => {
  const model = buildTableModel([
    [{ text: 'รหัส', confidence: 0.99 }],
    [{ text: '00125\nINC-0001', rowSpan: 2, columnSpan: 1, confidence: 0.92 }],
  ]);
  const cell = model.rows[1].cells[0];
  assert.equal(cell.textWithLineBreaks, '00125\nINC-0001');
  assert.equal(cell.rowSpan, 2);
});

test('CSV export preserves empty cells, line breaks, quotes and UTF-8 BOM', () => {
  const csv = exportDelimited([['ชื่อ', '', 'หมายเหตุ'], ['นายทดสอบ', '00125', 'บรรทัด 1\nบรรทัด 2']], ',');
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.ok(csv.includes('ชื่อ,,หมายเหตุ'));
  assert.ok(csv.includes('"บรรทัด 1\nบรรทัด 2"'));
});

test('text metrics report CER WER and Thai grapheme error rate', () => {
  const metrics = calculateTextMetrics('สำนักงาน', 'สำนักงาบ');
  assert.ok(metrics.cer > 0);
  assert.ok(metrics.wer > 0);
  assert.ok(metrics.thaiGraphemeErrorRate > 0);
});

import { readFile } from 'node:fs/promises';

test('table fixture catalog contains 25 synthetic privacy-safe ground-truth cases', async () => {
  const fixtures = JSON.parse(await readFile(new URL('./table-fixtures.json', import.meta.url), 'utf8'));
  assert.equal(fixtures.length, 25);
  assert.ok(fixtures.every(item => item.containsRealPersonalData === false));
  assert.ok(fixtures.every(item => item.groundTruth?.headers && item.groundTruth?.rows && item.groundTruth?.spans));
  assert.ok(fixtures.some(item => item.category === 'borderless'));
  assert.ok(fixtures.some(item => item.category === 'merged_cell'));
  assert.ok(fixtures.some(item => item.category === 'mixed_th_en'));
});
