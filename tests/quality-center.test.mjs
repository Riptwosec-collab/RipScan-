import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTemplateToModel, createTemplate, inferBorderlessTable, recognizeFormLayout, testTemplateMatch, validateField, validateTemplate } from '../web/quality-core.mjs';

test('borderless table inference reports evidence and an explicit inferred label', () => {
  const blocks = [
    { x: 10, y: 10, text: 'ชื่อ' }, { x: 220, y: 10, text: 'จำนวน' },
    { x: 10, y: 55, text: 'รายการ A' }, { x: 220, y: 55, text: '10' },
    { x: 10, y: 100, text: 'รายการ B' }, { x: 220, y: 100, text: '20' },
  ];
  const result = inferBorderlessTable(blocks);
  assert.equal(result.inferred, true);
  assert.equal(result.label, 'Inferred Grid');
  assert.deepEqual([result.rows, result.columns], [3, 2]);
  assert.ok(result.evidence.includes('repeated_x_position'));
});

test('template stores reusable geometry without source text', () => {
  const model = { version: '3.0.0', pages: [{ width: 800, height: 1100, blocks: [{ id: 'field-1', type: 'field', label: 'ข้อมูลลับ', value: '123', x: 10, y: 20, width: 100, height: 30, fieldType: 'id' }] }] };
  const template = createTemplate(model, 'แบบฟอร์ม');
  const serialized = JSON.stringify(template);
  assert.equal(serialized.includes('ข้อมูลลับ'), false);
  assert.equal(serialized.includes('123'), false);
  assert.equal(template.pages[0].blocks[0].fieldType, 'id');
});

test('field validation supports email and checksum-aware Thai ID', () => {
  assert.equal(validateField('user@example.org', 'email').valid, true);
  assert.equal(validateField('not-an-email', 'email').valid, false);
  assert.equal(validateField('1234567890123', 'thai_national_id').valid, false);
});

test('form recognition converts only evidenced label/value and checkbox text', () => {
  const source = { pages: [{ width: 800, height: 1100, blocks: [
    { id: 'email', type: 'text', text: 'Email: user@example.org', x: 10, y: 20, width: 300, height: 30, confidence: .96 },
    { id: 'agree', type: 'text', text: '☑ ยอมรับเงื่อนไข', x: 10, y: 60, width: 300, height: 30, confidence: .9 },
    { id: 'plain', type: 'text', text: 'ข้อความธรรมดา', x: 10, y: 100, width: 300, height: 30 },
  ] }] };
  const result = recognizeFormLayout(source);
  assert.equal(result.recognized.length, 2);
  assert.equal(result.model.pages[0].blocks[0].fieldType, 'email');
  assert.equal(result.model.pages[0].blocks[0].validation.valid, true);
  assert.equal(result.model.pages[0].blocks[1].type, 'checkbox');
  assert.equal(result.model.pages[0].blocks[2].type, 'text');
});

test('form recognition does not turn URLs times or document codes into verified fields', () => {
  const values = ['https://example.com', 'เวลา 12:30', 'รหัส AB:123'];
  const source = { pages: [{ blocks: values.map((text, index) => ({ id: String(index), type: 'text', text, x: 0, y: index * 20, width: 200, height: 20, confidence: .99 })) }] };
  const result = recognizeFormLayout(source);
  assert.equal(result.recognized.length, 0);
  assert.deepEqual(result.model.pages[0].blocks.map(block => block.type), ['text', 'text', 'text']);
});

test('template validates, matches page geometry, and applies empty review placeholders', () => {
  const model = { version: '3.3.0', pages: [{ width: 800, height: 1100, blocks: [{ id: 'field-1', type: 'field', label: 'secret', value: '123', x: 10, y: 20, width: 100, height: 30, fieldType: 'text' }] }] };
  const template = createTemplate(model, 'Form');
  assert.equal(validateTemplate(template).valid, true);
  assert.equal(testTemplateMatch({ pages: [{ width: 800, height: 1100 }] }, template).compatible, true);
  const target = { pages: [{ width: 1600, height: 2200, blocks: [] }] };
  const applied = applyTemplateToModel(target, template);
  assert.equal(applied.applied, true);
  assert.equal(applied.model.pages[0].blocks[0].value, '');
  assert.equal(applied.model.pages[0].blocks[0].x, 20);
  assert.equal(applied.model.pages[0].blocks[0].reviewStatus, 'review_required');
});
