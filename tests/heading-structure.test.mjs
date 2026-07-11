import test from 'node:test';
import assert from 'node:assert/strict';
import { detectHeading, markdownWithHeadings, structureHeadings } from '../web/heading-structure.mjs';

test('separates explicit Thai headings from body text', () => {
  const input = 'บทนำ\nเอกสารฉบับนี้อธิบายการทำงานของระบบ OCR สำหรับภาษาไทยและอังกฤษ\nวัตถุประสงค์\nเพื่อแปลงเอกสารให้ตรวจแก้ได้สะดวก';
  const result = structureHeadings(input);
  assert.equal(result.headings.length, 2);
  assert.match(result.text, /^บทนำ\n\nเอกสารฉบับนี้/);
  assert.match(result.text, /อังกฤษ\n\nวัตถุประสงค์\n\nเพื่อแปลง/);
});

test('detects numbered and English uppercase headings', () => {
  assert.equal(detectHeading('1.2 ขอบเขตการดำเนินงาน', { previousBlank: true, nextLine: 'รายละเอียดเนื้อหาที่มีความยาวมากกว่าหัวข้อ' }).isHeading, true);
  assert.equal(detectHeading('PROJECT SUMMARY', { previousBlank: true, nextLine: 'This section contains the complete project summary and supporting details.' }).isHeading, true);
});

test('does not classify dates codes numeric values or table rows as headings', () => {
  for (const line of ['11/07/2026', 'INV-2026-001', '089-123-4567', 'ชื่อ  จำนวน  ราคา', 'A001 | สมชาย | 250.00']) {
    assert.equal(detectHeading(line, { previousBlank: true, nextLine: 'รายละเอียดเนื้อหาที่ยาวเพียงพอสำหรับบริบท' }).isHeading, false, line);
  }
});

test('does not turn ordinary bullet list items into headings', () => {
  assert.equal(detectHeading('1. ติดตั้งโปรแกรม', { previousBlank: true, nextLine: '2. เปิดไฟล์และเริ่มใช้งาน' }).isHeading, false);
  assert.equal(detectHeading('- ตรวจสอบเอกสาร', { previousBlank: true, nextLine: 'รายละเอียดของรายการตรวจสอบเอกสารทั้งหมด' }).isHeading, false);
});

test('returns structured sections without inventing content', () => {
  const input = 'สรุป\nข้อความสรุปต้นฉบับ\n\nหมายเหตุ:\nข้อความหมายเหตุต้นฉบับ';
  const result = structureHeadings(input);
  assert.deepEqual(result.sections.map(section => section.heading), ['สรุป', 'หมายเหตุ:']);
  assert.equal(result.sections[0].body.join(' '), 'ข้อความสรุปต้นฉบับ');
  assert.equal(result.sections[1].body.join(' '), 'ข้อความหมายเหตุต้นฉบับ');
  assert.equal(result.text.replace(/\n/g, ''), input.replace(/\n/g, ''));
});

test('Markdown export converts detected headings to heading syntax', () => {
  const output = markdownWithHeadings('บทสรุป\nผลการประมวลผลทั้งหมดอยู่ในส่วนนี้');
  assert.match(output, /^## บทสรุป\n\nผลการประมวลผล/);
});
