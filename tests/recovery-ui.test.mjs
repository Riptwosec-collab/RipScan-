import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('recovery overlay exposes all requested display filters and statuses', async () => {
  const js = await read('web/cover-recovery-ui.js');
  for (const required of [
    'แสดงข้อความทั้งหมด',
    'เฉพาะข้อความยืนยันแล้ว',
    'พื้นที่ที่ควรตรวจ',
    'Non-Text ที่ยังไม่ยืนยัน',
    'verified',
    'review_required',
    'possible_text',
    'likely_non_text',
    'confirmed_non_text',
    'ripscan:book-result',
  ]) assert.ok(js.includes(required), `missing ${required}`);
});

test('Sara Am review shows evidence and confirmation actions', async () => {
  const js = await read('web/cover-recovery-ui.js');
  for (const required of [
    'broken_sara_am',
    'ต้นฉบับ OCR',
    'คำแนะนำ',
    'ยืนยันคำแนะนำ',
    'คงข้อความเดิม',
    'อ่านใหม่',
    'data-sara-action',
  ]) assert.ok(js.includes(required), `missing ${required}`);
});

test('manual region drawing is patched to OCR immediately', async () => {
  const build = await read('build.mjs');
  assert.ok(build.includes('recognizeRegion(panel, pageCard, created)'));
  assert.ok(build.includes("created.status = 'review_required'"));
});

test('recovery CSS provides green yellow orange and gray review states', async () => {
  const css = await read('web/cover-recovery.css');
  for (const selector of [
    '.recovery-block-overlay',
    '.status-dot.verified',
    '.status-dot.review_required',
    '.status-dot.possible_text',
    '.status-dot.likely_non_text',
    '.sara-am-spacing-review',
  ]) assert.ok(css.includes(selector), `missing ${selector}`);
  for (const color of ['#22c55e', '#eab308', '#f97316', '#94a3b8']) assert.ok(css.includes(color), `missing ${color}`);
});
