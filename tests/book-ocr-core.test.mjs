import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_BOOK_OCR_OPTIONS,
  THAI_DICTIONARIES,
  analyzeRegionFeatures,
  analyzeSaraAm,
  analyzeThaiGraphemes,
  buildStructuredText,
  calculateTextMetrics,
  classifyBlockText,
  classifyDashSymbol,
  detectFailureSignals,
  extractDashElements,
  languageForBlock,
  normalizeThaiUnicodeDetailed,
  preserveTextSymbols,
  rankCandidates,
  segmentGraphemes,
  shouldRetryBlock,
  sortReadingOrder,
  summarizeBlockConfidence,
} from '../web/book-ocr-core.mjs';

const saraAmWords = [
  'ดำเนินการ', 'จำนวน', 'สำนักงาน', 'สำคัญ', 'กำหนด', 'คำแนะนำ', 'ชำนาญ',
  'อำนาจ', 'จำเป็น', 'นำเสนอ', 'ตำแหน่ง', 'สำเร็จ', 'สำหรับ', 'กำลัง',
  'บำรุง', 'ลำดับ', 'อำเภอ',
];

const dashSamples = [
  '66-F4-007', 'INC-2569-001', 'RD-Wifi', 'ชื่อ-นามสกุล', 'ไทย–อังกฤษ',
  'หน้า 10–15', '08.30-16.30 น.', 'LAN / WAN', 'A_B_C', '--------------------',
];

test('default mode is text-only with conservative Thai preservation enabled', () => {
  assert.equal(DEFAULT_BOOK_OCR_OPTIONS.mode, 'text_only');
  assert.equal(DEFAULT_BOOK_OCR_OPTIONS.detailedSaraAm, true);
  assert.equal(DEFAULT_BOOK_OCR_OPTIONS.preserveDashes, true);
  assert.equal(DEFAULT_BOOK_OCR_OPTIONS.preserveSeparators, true);
  assert.equal(DEFAULT_BOOK_OCR_OPTIONS.skipLogoAndIcons, true);
});

test('academic and Sara Am dictionaries contain required terms', () => {
  assert.ok(THAI_DICTIONARIES.academic.includes('จุฬาลงกรณ์มหาวิทยาลัย'));
  assert.ok(THAI_DICTIONARIES.academic.includes('วรรณวิจัย'));
  for (const word of saraAmWords) assert.ok(THAI_DICTIONARIES.saraAm.includes(word), `missing ${word}`);
});

test('decomposed Sara Am is normalized without changing other text', () => {
  const result = normalizeThaiUnicodeDetailed('จํานวน สํานักงาน');
  assert.equal(result.normalizedText, 'จำนวน สำนักงาน');
  assert.equal(result.changed, true);
  assert.equal(result.changes.length, 2);
  assert.equal(result.changes[0].type, 'sara_am_normalization');
});

test('normal Sara Am words remain unchanged', () => {
  for (const word of saraAmWords) {
    const result = normalizeThaiUnicodeDetailed(word);
    assert.equal(result.normalizedText, word);
  }
});

test('missing Sara Am forms are flagged but not auto-replaced', () => {
  const result = analyzeSaraAm('จานวน ดาเนินการ สานักงาน', 0.82);
  assert.equal(result.normalizedText, 'จานวน ดาเนินการ สานักงาน');
  assert.equal(result.requiresReview, true);
  assert.deepEqual(result.flagged[0].candidates, ['จำนวน']);
  assert.deepEqual(result.flagged[1].candidates, ['ดำเนินการ']);
  assert.deepEqual(result.flagged[2].candidates, ['สำนักงาน']);
});

test('Sara Am below 96 percent confidence requires review', () => {
  assert.equal(analyzeSaraAm('จำนวน', 0.95).requiresReview, true);
  assert.equal(analyzeSaraAm('จำนวน', 0.97).requiresReview, false);
});

test('Thai grapheme segmentation keeps Sara Am with its syllable', () => {
  const clusters = segmentGraphemes('จำนวน');
  assert.ok(clusters.some(cluster => cluster.includes('ำ')));
  assert.equal(clusters.join(''), 'จำนวน');
});

test('floating Thai marks are detected', () => {
  const result = analyzeThaiGraphemes('่ทดสอบ');
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.type === 'floating_mark'));
});

test('duplicate tone marks are detected', () => {
  const result = analyzeThaiGraphemes('ก่้');
  assert.ok(result.issues.some(issue => issue.type === 'duplicate_tone_mark'));
});

test('all required dash samples are preserved byte-for-byte', () => {
  const input = dashSamples.join('\n');
  assert.equal(preserveTextSymbols(input), input);
});

test('dash classifier distinguishes document code and range', () => {
  assert.equal(classifyDashSymbol('-', '66-F4-007').role, 'document_code');
  assert.equal(classifyDashSymbol('–', 'หน้า 10–15').role, 'range');
  assert.equal(classifyDashSymbol('—', 'ข้อความ — หมายเหตุ').type, 'em_dash');
  assert.equal(classifyDashSymbol('−', '10 − 2').type, 'minus_sign');
});

test('separator line becomes a structured separator', () => {
  const elements = extractDashElements('หัวข้อ\n--------------------\nเนื้อหา');
  const separator = elements.find(item => item.type === 'separator_line');
  assert.ok(separator);
  assert.equal(separator.role, 'section_separator');
  assert.equal(separator.length, 20);
  assert.equal(separator.position, 'between_blocks');
});

test('slash and underscore are not changed', () => {
  const elements = extractDashElements('LAN / WAN\nA_B_C');
  assert.ok(elements.some(item => item.type === 'slash'));
  assert.ok(elements.some(item => item.type === 'underscore'));
  assert.equal(preserveTextSymbols('LAN / WAN\nA_B_C'), 'LAN / WAN\nA_B_C');
});

test('English noise inside Thai paragraph triggers retry', () => {
  const signals = detectFailureSignals('สำนักงาน wi ดำเนินการ io', null, 0.9);
  assert.ok(signals.includes('english_noise_in_thai'));
});

test('mixed script inside one Thai word triggers retry', () => {
  const signals = detectFailureSignals('สำนักwงาน', null, 0.9);
  assert.ok(signals.includes('latin_inside_thai_word'));
});

test('barcode-like repeated symbols trigger retry', () => {
  const signals = detectFailureSignals('|||| |||| +++', null, 0.9);
  assert.ok(signals.includes('repeated_barcode_symbols'));
});

test('low confidence triggers retry and does not imply correction', () => {
  const result = shouldRetryBlock({ text: 'จานวน', confidence: 0.52, bbox: { width: 120 }, type: 'paragraph' });
  assert.equal(result.retry, true);
  assert.ok(result.signals.includes('low_confidence'));
  assert.ok(result.signals.includes('sara_am_review'));
});

test('proper names use a higher review threshold', () => {
  const result = shouldRetryBlock({ text: 'จุฬาลงกรณ์มหาวิทยาลัย', confidence: 0.97, type: 'publisher_info', bbox: { width: 300 } });
  assert.equal(result.retry, true);
  assert.equal(result.threshold, 0.98);
});

test('block classifier separates title, numbered list and paragraph', () => {
  assert.equal(classifyBlockText('วรรณคดีโบราณ', { top: 30, height: 70 }, { width: 800, height: 1200 }), 'title');
  assert.equal(classifyBlockText('1. วัตถุประสงค์', { top: 300, height: 30 }, { width: 800, height: 1200 }), 'numbered_list');
  assert.equal(classifyBlockText('ข้อความยาวที่เป็นย่อหน้าและมีรายละเอียดจำนวนมากเพื่อให้ระบบจำแนกเป็นย่อหน้าหลักของเอกสาร.', { top: 400, height: 45 }, { width: 800, height: 1200 }), 'paragraph');
});

test('block classifier separates publisher address phone ISBN and price', () => {
  assert.equal(classifyBlockText('ศูนย์หนังสือแห่งจุฬาลงกรณ์มหาวิทยาลัย', {}, {}), 'publisher_info');
  assert.equal(classifyBlockText('เลขที่ 254 ถนนพญาไท แขวงวังใหม่ เขตปทุมวัน กรุงเทพมหานคร', {}, {}), 'address');
  assert.equal(classifyBlockText('โทร. 02-218-9893', {}, {}), 'phone');
  assert.equal(classifyBlockText('ISBN 978-616-407-087-5', {}, {}), 'isbn');
  assert.equal(classifyBlockText('ราคา 200 บาท', {}, {}), 'price');
});

test('language selection is per block', () => {
  assert.equal(languageForBlock('paragraph', 'วรรณคดีโบราณ'), 'tha');
  assert.equal(languageForBlock('isbn', 'ISBN 978-616-407-087-5'), 'number');
  assert.equal(languageForBlock('barcode', ''), 'barcode');
  assert.equal(languageForBlock('publisher_info', 'จุฬาลงกรณ์ University'), 'tha+eng');
});

test('reading order is top-to-bottom and left-to-right inside a band', () => {
  const blocks = [
    { id: 'b', type: 'paragraph', bbox: { top: 200, left: 30, width: 100, height: 30 } },
    { id: 'a2', type: 'title', bbox: { top: 20, left: 300, width: 100, height: 40 } },
    { id: 'a1', type: 'title', bbox: { top: 20, left: 20, width: 100, height: 40 } },
  ];
  assert.deepEqual(sortReadingOrder(blocks).map(item => item.id), ['a1', 'a2', 'b']);
});

test('structured text excludes barcode and image regions', () => {
  const text = buildStructuredText([
    { type: 'title', regionType: 'text', text: 'หัวข้อ', bbox: { top: 10, left: 10, height: 30 } },
    { type: 'image', regionType: 'image', text: 'มั่วจากรูปภาพ', bbox: { top: 40, left: 10, height: 200 } },
    { type: 'barcode', regionType: 'barcode', text: '||||', bbox: { top: 260, left: 10, height: 60 } },
    { type: 'paragraph', regionType: 'text', text: 'เนื้อหา', bbox: { top: 330, left: 10, height: 30 } },
  ]);
  assert.equal(text, 'หัวข้อ\n\nเนื้อหา');
});

test('region classifier sends photographs away from text OCR', () => {
  const result = analyzeRegionFeatures({ textLineScore: 0.15, connectedComponentScore: 0.12, texture: 0.86, colorVariance: 0.79 });
  assert.equal(result.regionType, 'image');
  assert.equal(result.action, 'skip_text_ocr');
});

test('region classifier sends line-like components to text OCR', () => {
  const result = analyzeRegionFeatures({ textLineScore: 0.82, connectedComponentScore: 0.71, texture: 0.22, colorVariance: 0.2 });
  assert.equal(result.regionType, 'text');
  assert.equal(result.action, 'text_ocr');
});

test('region classifier separates barcode before text OCR', () => {
  const result = analyzeRegionFeatures({ barcodeScore: 0.9, textLineScore: 0.7, connectedComponentScore: 0.7 });
  assert.equal(result.regionType, 'barcode');
  assert.equal(result.action, 'barcode_reader');
});

test('candidate ranking never creates a candidate outside supplied evidence', () => {
  const candidates = ['จานวน', 'จำนวน'];
  const ranked = rankCandidates(candidates, {
    confidences: { จานวน: 0.77, จำนวน: 0.76 },
    imageEvidence: { จานวน: 0.55, จำนวน: 0.94 },
    providerAgreement: { จานวน: 0.5, จำนวน: 0.8 },
  });
  assert.equal(ranked.length, 2);
  assert.ok(ranked.every(item => candidates.includes(item.text)));
  assert.equal(ranked[0].text, 'จำนวน');
});

test('dictionary support is a small score boost rather than forced replacement', () => {
  const ranked = rankCandidates(['คำที่ไม่อยู่ในพจนานุกรม', 'วรรณวิจัย'], {
    confidences: { คำที่ไม่อยู่ในพจนานุกรม: 0.99, วรรณวิจัย: 0.4 },
    imageEvidence: { คำที่ไม่อยู่ในพจนานุกรม: 0.99, วรรณวิจัย: 0.2 },
  });
  assert.equal(ranked[0].text, 'คำที่ไม่อยู่ในพจนานุกรม');
  assert.equal(ranked[1].dictionarySupport, 1);
});

test('confidence summary exposes Sara Am and image exclusion confidence separately', () => {
  const summary = summarizeBlockConfidence({ text: 'จำนวน', confidence: 0.95, regionConfidence: 0.99, type: 'paragraph', bbox: { width: 200 } });
  assert.equal(summary.textRegionConfidence, 0.99);
  assert.equal(summary.imageExclusionConfidence, 0.99);
  assert.ok(summary.saraAmConfidence <= 0.95);
  assert.equal(summary.requiresReview, true);
});

test('metrics calculate perfect Sara Am, grapheme and dash preservation', () => {
  const truth = 'จำนวน ดำเนินการ\n66-F4-007\nไทย–อังกฤษ\n--------------------';
  const metrics = calculateTextMetrics(truth, truth);
  assert.equal(metrics.cer, 0);
  assert.equal(metrics.wer, 0);
  assert.equal(metrics.thaiGraphemeAccuracy, 1);
  assert.equal(metrics.saraAmDetectionAccuracy, 1);
  assert.equal(metrics.saraAmMissingRate, 0);
  assert.equal(metrics.dashPreservationAccuracy, 1);
});

test('metrics expose missing Sara Am and changed dash', () => {
  const metrics = calculateTextMetrics('จานวน ดาเนินการ\n66 F4 007\nไทย-อังกฤษ', 'จำนวน ดำเนินการ\n66-F4-007\nไทย–อังกฤษ');
  assert.ok(metrics.cer > 0);
  assert.ok(metrics.saraAmMissingRate > 0);
  assert.ok(metrics.dashPreservationAccuracy < 1);
});
