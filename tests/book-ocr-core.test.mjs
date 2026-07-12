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
} from '../web/book-ocr-rules.mjs';

const saraAmWords = ['ดำเนินการ','จำนวน','สำนักงาน','สำคัญ','กำหนด','คำแนะนำ','ชำนาญ','อำนาจ','จำเป็น','นำเสนอ','ตำแหน่ง','สำเร็จ','สำหรับ','กำลัง','บำรุง','ลำดับ','อำเภอ'];
const dashSamples = ['66-F4-007','INC-2569-001','RD-Wifi','ชื่อ-นามสกุล','ไทย–อังกฤษ','หน้า 10–15','08.30-16.30 น.','LAN / WAN','A_B_C','--------------------'];

test('defaults are conservative and text-only', () => {
  assert.equal(DEFAULT_BOOK_OCR_OPTIONS.mode, 'text_only');
  assert.equal(DEFAULT_BOOK_OCR_OPTIONS.detailedSaraAm, true);
  assert.equal(DEFAULT_BOOK_OCR_OPTIONS.preserveDashes, true);
  assert.equal(DEFAULT_BOOK_OCR_OPTIONS.preserveSeparators, true);
  assert.equal(DEFAULT_BOOK_OCR_OPTIONS.skipLogoAndIcons, true);
});

test('required dictionaries are present', () => {
  assert.ok(THAI_DICTIONARIES.academic.includes('จุฬาลงกรณ์มหาวิทยาลัย'));
  assert.ok(THAI_DICTIONARIES.academic.includes('วรรณวิจัย'));
  for (const word of saraAmWords) assert.ok(THAI_DICTIONARIES.saraAm.includes(word), `missing ${word}`);
});

test('decomposed Sara Am is normalized only as Unicode normalization', () => {
  const result = normalizeThaiUnicodeDetailed('จํานวน สํานักงาน');
  assert.equal(result.normalizedText, 'จำนวน สำนักงาน');
  assert.equal(result.changes.length, 2);
  assert.ok(result.changes.every(change => change.type === 'sara_am_normalization'));
});

test('valid Sara Am words stay unchanged', () => {
  for (const word of saraAmWords) assert.equal(normalizeThaiUnicodeDetailed(word).normalizedText, word);
});

test('missing Sara Am forms are review candidates, not automatic replacements', () => {
  const result = analyzeSaraAm('จานวน ดาเนินการ สานักงาน', .82);
  assert.equal(result.normalizedText, 'จานวน ดาเนินการ สานักงาน');
  assert.equal(result.requiresReview, true);
  assert.deepEqual(result.flagged.map(item => item.candidates[0]), ['จำนวน','ดำเนินการ','สำนักงาน']);
});

test('Sara Am threshold is 96 percent', () => {
  assert.equal(analyzeSaraAm('จำนวน', .95).requiresReview, true);
  assert.equal(analyzeSaraAm('จำนวน', .97).requiresReview, false);
});

test('Thai grapheme segmentation keeps Sara Am attached', () => {
  const clusters = segmentGraphemes('จำนวน');
  assert.equal(clusters.join(''), 'จำนวน');
  assert.ok(clusters.some(cluster => cluster.includes('ำ')));
});

test('Thai grapheme validator detects floating and duplicate marks', () => {
  assert.ok(analyzeThaiGraphemes('่ทดสอบ').issues.some(issue => issue.type === 'floating_mark'));
  assert.ok(analyzeThaiGraphemes('ก่้').issues.some(issue => issue.type === 'duplicate_tone_mark'));
});

test('all dash and separator samples are preserved byte-for-byte', () => {
  const input = dashSamples.join('\n');
  assert.equal(preserveTextSymbols(input), input);
});

test('dash rules distinguish code, range, em dash and minus', () => {
  assert.equal(classifyDashSymbol('-', '66-F4-007').role, 'document_code');
  assert.equal(classifyDashSymbol('–', 'หน้า 10–15').role, 'range');
  assert.equal(classifyDashSymbol('—', 'ข้อความ — หมายเหตุ').type, 'em_dash');
  assert.equal(classifyDashSymbol('−', '10 − 2').type, 'minus_sign');
});

test('separator line is structured and retained', () => {
  const separator = extractDashElements('หัวข้อ\n--------------------\nเนื้อหา').find(item => item.type === 'separator_line');
  assert.ok(separator);
  assert.equal(separator.role, 'section_separator');
  assert.equal(separator.length, 20);
});

test('slash and underscore remain distinct symbols', () => {
  const elements = extractDashElements('LAN / WAN\nA_B_C');
  assert.ok(elements.some(item => item.type === 'slash'));
  assert.ok(elements.some(item => item.type === 'underscore'));
});

test('failure rules detect English noise in Thai', () => {
  const signals = detectFailureSignals('สำนักงาน wi ดำเนินการ io', null, .9);
  assert.ok(signals.includes('english_noise_in_thai'));
});

test('failure rules detect mixed script inside one word', () => {
  assert.ok(detectFailureSignals('สำนักwงาน', null, .9).includes('latin_inside_thai_word'));
});

test('failure rules detect barcode-like punctuation', () => {
  assert.ok(detectFailureSignals('|||| |||| +++', null, .9).includes('repeated_barcode_symbols'));
});

test('low-confidence Sara Am and proper names are retried', () => {
  const low = shouldRetryBlock({ text: 'จานวน', confidence: .52, bbox: { width: 120 }, type: 'paragraph' });
  assert.equal(low.retry, true);
  assert.ok(low.signals.includes('sara_am_review'));
  const proper = shouldRetryBlock({ text: 'จุฬาลงกรณ์มหาวิทยาลัย', confidence: .97, type: 'publisher_info', bbox: { width: 300 } });
  assert.equal(proper.threshold, .98);
  assert.equal(proper.retry, true);
});

test('layout block types are separated', () => {
  assert.equal(classifyBlockText('วรรณคดีโบราณ', { top: 30, height: 70 }, { width: 800, height: 1200 }), 'title');
  assert.equal(classifyBlockText('1. วัตถุประสงค์', { top: 300, height: 30 }, { width: 800, height: 1200 }), 'numbered_list');
  assert.equal(classifyBlockText('ข้อความยาวที่เป็นย่อหน้าและมีรายละเอียดจำนวนมากเพื่อให้ระบบจำแนกเป็นย่อหน้าหลักของเอกสาร.', { top: 400, height: 45 }, { width: 800, height: 1200 }), 'paragraph');
  assert.equal(classifyBlockText('ศูนย์หนังสือแห่งจุฬาลงกรณ์มหาวิทยาลัย', {}, {}), 'publisher_info');
  assert.equal(classifyBlockText('เลขที่ 254 ถนนพญาไท แขวงวังใหม่ เขตปทุมวัน กรุงเทพมหานคร', {}, {}), 'address');
  assert.equal(classifyBlockText('โทร. 02-218-9893', {}, {}), 'phone');
  assert.equal(classifyBlockText('ISBN 978-616-407-087-5', {}, {}), 'isbn');
  assert.equal(classifyBlockText('ราคา 200 บาท', {}, {}), 'price');
});

test('phone is not misclassified as ISBN', () => {
  assert.equal(classifyBlockText('02-939-7755', {}, {}), 'phone');
  assert.notEqual(classifyBlockText('08.30-16.30 น.', {}, {}), 'isbn');
});

test('language is selected per block', () => {
  assert.equal(languageForBlock('paragraph', 'วรรณคดีโบราณ'), 'tha');
  assert.equal(languageForBlock('isbn', 'ISBN 978-616-407-087-5'), 'number');
  assert.equal(languageForBlock('barcode', ''), 'barcode');
  assert.equal(languageForBlock('publisher_info', 'จุฬาลงกรณ์ University'), 'tha+eng');
});

test('reading order is top-to-bottom then left-to-right', () => {
  const blocks = [
    { id: 'b', type: 'paragraph', bbox: { top: 200, left: 30, width: 100, height: 30 } },
    { id: 'a2', type: 'title', bbox: { top: 20, left: 300, width: 100, height: 40 } },
    { id: 'a1', type: 'title', bbox: { top: 20, left: 20, width: 100, height: 40 } },
  ];
  assert.deepEqual(sortReadingOrder(blocks).map(item => item.id), ['a1','a2','b']);
});

test('structured export excludes image and barcode regions', () => {
  const text = buildStructuredText([
    { type: 'title', regionType: 'text', text: 'หัวข้อ', bbox: { top: 10, left: 10, height: 30 } },
    { type: 'image', regionType: 'image', text: 'มั่วจากรูปภาพ', bbox: { top: 40, left: 10, height: 200 } },
    { type: 'barcode', regionType: 'barcode', text: '||||', bbox: { top: 260, left: 10, height: 60 } },
    { type: 'paragraph', regionType: 'text', text: 'เนื้อหา', bbox: { top: 330, left: 10, height: 30 } },
  ]);
  assert.equal(text, 'หัวข้อ\n\nเนื้อหา');
});

test('region classifier separates image, text and barcode', () => {
  assert.equal(analyzeRegionFeatures({ textLineScore: .15, connectedComponentScore: .12, texture: .86, colorVariance: .79 }).action, 'skip_text_ocr');
  assert.equal(analyzeRegionFeatures({ textLineScore: .82, connectedComponentScore: .71, texture: .22, colorVariance: .2 }).action, 'text_ocr');
  assert.equal(analyzeRegionFeatures({ barcodeScore: .9, textLineScore: .7, connectedComponentScore: .7 }).action, 'barcode_reader');
});

test('candidate ranking cannot invent text', () => {
  const candidates = ['จานวน','จำนวน'];
  const ranked = rankCandidates(candidates, {
    confidences: { จานวน: .77, จำนวน: .76 },
    imageEvidence: { จานวน: .55, จำนวน: .94 },
    providerAgreement: { จานวน: .5, จำนวน: .8 },
  });
  assert.ok(ranked.every(item => candidates.includes(item.text)));
  assert.equal(ranked[0].text, 'จำนวน');
});

test('dictionary is only a score boost', () => {
  const ranked = rankCandidates(['คำที่ไม่อยู่ในพจนานุกรม','วรรณวิจัย'], {
    confidences: { คำที่ไม่อยู่ในพจนานุกรม: .99, วรรณวิจัย: .4 },
    imageEvidence: { คำที่ไม่อยู่ในพจนานุกรม: .99, วรรณวิจัย: .2 },
  });
  assert.equal(ranked[0].text, 'คำที่ไม่อยู่ในพจนานุกรม');
  assert.equal(ranked[1].dictionarySupport, 1);
});

test('confidence metrics are separated by concern', () => {
  const summary = summarizeBlockConfidence({ text: 'จำนวน', confidence: .95, regionConfidence: .99, type: 'paragraph', bbox: { width: 200 } });
  assert.equal(summary.textRegionConfidence, .99);
  assert.equal(summary.imageExclusionConfidence, .99);
  assert.ok(summary.saraAmConfidence <= .95);
  assert.equal(summary.requiresReview, true);
});

test('perfect text has perfect Sara Am, grapheme and dash metrics', () => {
  const truth = 'จำนวน ดำเนินการ\n66-F4-007\nไทย–อังกฤษ\n--------------------';
  const metrics = calculateTextMetrics(truth, truth);
  assert.deepEqual(metrics, { cer: 0, wer: 0, thaiGraphemeAccuracy: 1, saraAmDetectionAccuracy: 1, saraAmMissingRate: 0, dashPreservationAccuracy: 1 });
});

test('metrics expose missing Sara Am and dash changes', () => {
  const metrics = calculateTextMetrics('จานวน ดาเนินการ\n66 F4 007\nไทย-อังกฤษ', 'จำนวน ดำเนินการ\n66-F4-007\nไทย–อังกฤษ');
  assert.ok(metrics.cer > 0);
  assert.ok(metrics.saraAmMissingRate > 0);
  assert.ok(metrics.dashPreservationAccuracy < 1);
});
