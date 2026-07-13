import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCellMatrix,
  matrixToMarkdown,
  pageActionPolicy,
  tableEvidence,
} from '../web/table-structure-core.mjs';

test('MAC address table keeps every value in its own column', () => {
  const cells = [
    { rowIndex: 0, columnIndex: 0, text: 'ลำดับที่' },
    { rowIndex: 0, columnIndex: 1, text: 'MAC Address' },
    { rowIndex: 0, columnIndex: 2, text: 'S/N Number' },
    { rowIndex: 0, columnIndex: 3, text: 'เจ้าของเครื่อง' },
    { rowIndex: 1, columnIndex: 0, text: '1.' },
    { rowIndex: 1, columnIndex: 1, text: '24-6A-0E-DE-EF-9D' },
    { rowIndex: 1, columnIndex: 2, text: '5CD43979HO' },
    { rowIndex: 1, columnIndex: 3, text: 'คุณเสวนีย์' },
  ];
  const model = buildCellMatrix(cells);
  assert.equal(model.rows, 2);
  assert.equal(model.columns, 4);
  assert.deepEqual(model.matrix[1], ['1.', '24-6A-0E-DE-EF-9D', '5CD43979HO', 'คุณเสวนีย์']);
  const markdown = matrixToMarkdown(model.matrix);
  assert.match(markdown, /^\| ลำดับที่ \| MAC Address \| S\/N Number \| เจ้าของเครื่อง \|/u);
  assert.match(markdown, /\| 1\. \| 24-6A-0E-DE-EF-9D \| 5CD43979HO \| คุณเสวนีย์ \|/u);
});

test('merged cells stay anchored and never leak into neighboring columns', () => {
  const model = buildCellMatrix([
    { rowIndex: 0, columnIndex: 0, text: 'หน่วยรับตรวจ' },
    { rowIndex: 0, columnIndex: 1, text: 'การจัดเตรียมเอกสารและข้อมูล', columnSpan: 2 },
    { rowIndex: 0, columnIndex: 3, text: 'การดำเนินการ' },
    { rowIndex: 1, columnIndex: 0, text: 'ส่วนบริหารฯ', rowSpan: 2 },
    { rowIndex: 1, columnIndex: 1, text: 'จัดเตรียมข้อมูล' },
    { rowIndex: 1, columnIndex: 2, text: 'แนบ 8' },
    { rowIndex: 1, columnIndex: 3, text: 'วันแรกของการเข้าตรวจ' },
    { rowIndex: 2, columnIndex: 1, text: 'รายชื่อผู้ตรวจ' },
    { rowIndex: 2, columnIndex: 2, text: 'แนบ 9' },
    { rowIndex: 2, columnIndex: 3, text: 'ส่งก่อนวันเข้าตรวจ' },
  ]);
  assert.equal(model.columns, 4);
  assert.equal(model.matrix[0][1], 'การจัดเตรียมเอกสารและข้อมูล');
  assert.equal(model.matrix[0][2], '');
  assert.equal(model.matrix[2][0], '');
  assert.equal(model.spans.length, 2);
});

test('only copy and TXT download remain visible in page toolbar', () => {
  assert.equal(pageActionPolicy('copy-page'), 'visible');
  assert.equal(pageActionPolicy('download-page'), 'visible');
  for (const action of ['download-image', 'rerun', 'rotate', 'crop', 'analyze', 'mixed', 'cover-review']) {
    assert.equal(pageActionPolicy(action), 'background');
  }
});

test('grid evidence requires multiple horizontal and vertical separators', () => {
  assert.equal(tableEvidence({ horizontalLines: [10, 40, 80, 120], verticalLines: [5, 80, 160, 240], width: 250, height: 130 }).likelyTable, true);
  assert.equal(tableEvidence({ horizontalLines: [10, 40], verticalLines: [5, 80, 160], width: 250, height: 130 }).likelyTable, false);
});
