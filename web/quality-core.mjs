const clone = value => globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const formTypes = new Set(['field', 'checkbox', 'radio', 'signature', 'stamp', 'barcode', 'qr', 'label', 'value']);
const makeLocalId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export function validateField(value, type = 'text') {
  const source = String(value ?? '').trim();
  const rules = {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/u,
    phone: /^(?:\+66|0)\d{8,9}$/u,
    url: /^https?:\/\/[^\s]+$/iu,
    ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/u,
    mac: /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/iu,
    date: /^(?:\d{1,2}[\/-]){2}\d{2,4}$/u,
    currency: /^[-+]?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$/u,
    percentage: /^[-+]?\d+(?:\.\d+)?%$/u,
    postal_code: /^\d{5}$/u,
    thai_national_id: /^\d{13}$/u,
  };
  const compact = ['phone', 'thai_national_id', 'postal_code'].includes(type) ? source.replace(/[\s-]/gu, '') : source;
  let valid = rules[type] ? rules[type].test(compact) : Boolean(source);
  const warnings = [];
  const candidateValues = [];
  if (/[OIlSB]/u.test(source) && ['phone', 'currency', 'percentage', 'postal_code', 'thai_national_id'].includes(type)) {
    const candidate = source.replace(/O/gu, '0').replace(/[Il]/gu, '1').replace(/S/gu, '5').replace(/B/gu, '8');
    if (candidate !== source) candidateValues.push(candidate);
    warnings.push('ambiguous_ocr_character');
    valid = false;
  }
  if (type === 'thai_national_id' && /^\d{13}$/u.test(compact)) {
    const sum = [...compact.slice(0, 12)].reduce((total, digit, index) => total + Number(digit) * (13 - index), 0);
    valid = (11 - (sum % 11)) % 10 === Number(compact[12]);
    if (!valid) warnings.push('checksum_mismatch');
  }
  return { value: source, type, valid, confidence: valid ? 1 : candidateValues.length ? .5 : 0, normalizedValue: valid ? compact : source, warnings, candidateValues, evidence: rules[type] ? ['format_rule'] : ['non_empty'], sourceBlockId: null };
}

export function collectReviewItems(model) {
  const items = [];
  for (const [pageIndex, page] of (model?.pages || []).entries()) {
    for (const block of page.blocks || []) {
      if (block.hidden || block.reviewStatus === 'confirmed_non_text') continue;
      const text = block.type === 'field' ? block.value : block.text;
      if (['review_required', 'possible_text', 'possible_issue', 'contaminated'].includes(block.reviewStatus) || Number(block.confidence) < .88) {
        items.push({ id: block.id, pageIndex, pageNumber: page.number || pageIndex + 1, blockId: block.id, type: block.type, text: text || '', confidence: Number(block.confidence || 0), status: block.reviewStatus || 'review_required', reasons: block.metadata?.reviewReasons || [], candidates: block.metadata?.candidates || [] });
      }
      if (block.type === 'table') for (const cell of block.cells || []) {
        if (cell.hidden || cell.redacted || (cell.reviewStatus === 'verified' && Number(cell.confidence ?? 1) >= .88)) continue;
        items.push({ id: cell.id, pageIndex, pageNumber: page.number || pageIndex + 1, blockId: block.id, cellId: cell.id, type: 'table-cell', text: cell.text || '', confidence: Number(cell.confidence || 0), status: cell.reviewStatus || 'review_required', reasons: cell.metadata?.reviewReasons || [], candidates: cell.metadata?.candidates || [] });
      }
    }
  }
  return items.sort((a, b) => a.confidence - b.confidence || a.pageIndex - b.pageIndex);
}

export function computeQualityReport(model) {
  const blocks = (model?.pages || []).flatMap(page => (page.blocks || []).filter(block => !block.hidden && block.reviewStatus !== 'confirmed_non_text'));
  const textual = blocks.filter(block => ['text', 'header', 'footer', 'field', 'label', 'value'].includes(block.type));
  const tables = blocks.filter(block => block.type === 'table');
  const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 1;
  const textAccuracy = mean(textual.map(block => Math.max(0, Math.min(1, Number(block.confidence ?? (block.reviewStatus === 'verified' ? 1 : 0))))));
  const geometry = blocks.map(block => {
    const page = model.pages.find(item => item.blocks?.includes(block));
    return block.x >= 0 && block.y >= 0 && block.width > 0 && block.height > 0 && block.x + block.width <= page.width * 1.02 && block.y + block.height <= page.height * 1.02 ? 1 : 0;
  });
  const layoutSimilarity = mean(geometry);
  const tableCells = tables.flatMap(table => table.cells || []);
  const tableAccuracy = mean(tableCells.map(cell => cell.hidden || cell.reviewStatus === 'verified' ? 1 : Math.max(0, Math.min(1, Number(cell.confidence || 0)))));
  const overall = (textAccuracy * .5) + (layoutSimilarity * .3) + (tableAccuracy * .2);
  return { textAccuracy, layoutSimilarity, tableAccuracy, overall, formula: 'overall = textAccuracy×0.50 + layoutSimilarity×0.30 + tableAccuracy×0.20', sampleSize: { blocks: blocks.length, textBlocks: textual.length, tableCells: tableCells.length } };
}

export function redactBlock(model, blockId) {
  const output = clone(model);
  for (const page of output.pages || []) {
    const block = (page.blocks || []).find(item => item.id === blockId);
    if (!block) continue;
    block.redacted = true;
    block.text = '';
    block.value = '';
    block.label = '';
    block.alt = '';
    block.src = '';
    block.spans = [];
    block.choices = [];
    block.validation = null;
    if (block.cells) block.cells.forEach(cell => {
      cell.text = '';
      cell.redacted = true;
      cell.metadata = { redactedAt: new Date().toISOString(), redactionMethod: 'burn-in-and-remove-text-layer' };
    });
    block.metadata = { redactedAt: new Date().toISOString(), redactionMethod: 'burn-in-and-remove-text-layer' };
    output.reviewIssues = (output.reviewIssues || []).filter(issue => issue.blockId !== blockId);
    return output;
  }
  throw new Error('ไม่พบ Block ที่ต้องการปิดบัง');
}

export function createRedactionReport(model) {
  const entries = [];
  for (const [pageIndex, page] of (model?.pages || []).entries()) {
    for (const block of page.blocks || []) {
      if (!block.redacted && !(block.cells || []).some(cell => cell.redacted)) continue;
      entries.push({ page: page.number || pageIndex + 1, blockId: block.id, type: block.type, x: block.x, y: block.y, width: block.width, height: block.height, redactedCells: (block.cells || []).filter(cell => cell.redacted).map(cell => ({ id: cell.id, row: cell.row, column: cell.column })), method: block.metadata?.redactionMethod || 'burn-in-and-remove-text-layer', redactedAt: block.metadata?.redactedAt || null });
    }
  }
  return { version: '1.0.0', documentId: model?.id || null, generatedAt: new Date().toISOString(), redactionCount: entries.length, containsRedactedText: false, entries };
}

export function applyNamingRule(rule, values = {}) {
  const rendered = String(rule || '{originalName}').replace(/\{([a-zA-Z]+)\}/gu, (_, key) => String(values[key] ?? ''));
  return rendered.replace(/[\\/:*?"<>|]+/gu, '-').replace(/\s+/gu, '-').replace(/-+/gu, '-').replace(/^[-. ]+|[-. ]+$/gu, '').slice(0, 180) || 'document';
}

export function createTemplate(model, name = 'Template') {
  return { version: '1.1.0', id: makeLocalId('template'), name, createdAt: new Date().toISOString(), sourceModelVersion: model.version, pages: (model.pages || []).map(page => ({ width: page.width, height: page.height, blocks: (page.blocks || []).filter(block => formTypes.has(block.type) || ['table', 'header', 'footer'].includes(block.type)).map(block => ({ id: block.id, type: block.type, x: block.x, y: block.y, width: block.width, height: block.height, fieldType: block.fieldType, validation: block.validation, rows: block.rows, columns: block.columns })) })) };
}

export function validateTemplate(template) {
  const errors = [];
  if (!template || typeof template !== 'object') return { valid: false, errors: ['template_missing'] };
  if (!Array.isArray(template.pages) || !template.pages.length) errors.push('pages_missing');
  for (const [pageIndex, page] of (template.pages || []).entries()) {
    if (!(Number(page.width) > 0 && Number(page.height) > 0)) errors.push(`page_${pageIndex}_size_invalid`);
    for (const block of page.blocks || []) {
      if (![...formTypes, 'table', 'header', 'footer'].includes(block.type)) errors.push(`block_${block.id || pageIndex}_type_invalid`);
      if (![block.x, block.y, block.width, block.height].every(Number.isFinite) || block.width <= 0 || block.height <= 0) errors.push(`block_${block.id || pageIndex}_geometry_invalid`);
      if ('text' in block || 'value' in block || 'src' in block) errors.push(`block_${block.id || pageIndex}_contains_source_data`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function testTemplateMatch(model, template) {
  const validation = validateTemplate(template);
  if (!validation.valid) return { compatible: false, confidence: 0, reasons: validation.errors };
  const pageRatio = Math.min(model.pages?.length || 0, template.pages.length) / Math.max(model.pages?.length || 1, template.pages.length);
  const sizeScores = template.pages.map((templatePage, index) => {
    const page = model.pages?.[index];
    if (!page) return 0;
    const widthRatio = Math.min(page.width / templatePage.width, templatePage.width / page.width);
    const heightRatio = Math.min(page.height / templatePage.height, templatePage.height / page.height);
    return Math.max(0, Math.min(1, (widthRatio + heightRatio) / 2));
  });
  const sizeScore = sizeScores.length ? sizeScores.reduce((sum, score) => sum + score, 0) / sizeScores.length : 0;
  const confidence = (pageRatio * .55) + (sizeScore * .45);
  return { compatible: confidence >= .72, confidence, reasons: confidence >= .72 ? ['page_count', 'page_aspect_ratio'] : ['page_or_size_mismatch'] };
}

export function applyTemplateToModel(model, template, { force = false } = {}) {
  const match = testTemplateMatch(model, template);
  if (!match.compatible && !force) return { applied: false, model: clone(model), match, added: 0 };
  const output = clone(model);
  let added = 0;
  for (const [pageIndex, templatePage] of template.pages.entries()) {
    const page = output.pages?.[pageIndex];
    if (!page) continue;
    const scaleX = page.width / templatePage.width;
    const scaleY = page.height / templatePage.height;
    for (const source of templatePage.blocks || []) {
      const candidate = { ...clone(source), id: makeLocalId(source.type), x: source.x * scaleX, y: source.y * scaleY, width: source.width * scaleX, height: source.height * scaleY, value: '', text: '', confidence: match.confidence, reviewStatus: 'review_required', source: 'template', metadata: { templateId: template.id, templateBlockId: source.id, reviewReasons: ['template_placeholder_requires_confirmation'] } };
      if (source.type === 'table') candidate.cells = [];
      page.blocks = page.blocks || [];
      const overlaps = page.blocks.some(block => block.type === source.type && Math.abs(block.x - candidate.x) < 8 && Math.abs(block.y - candidate.y) < 8);
      if (!overlaps) { page.blocks.push(candidate); added += 1; }
    }
  }
  output.updatedAt = new Date().toISOString();
  return { applied: true, model: output, match, added };
}

function inferFieldType(label, value) {
  const source = `${label} ${value}`.toLowerCase();
  if (/e-?mail|อีเมล/u.test(source)) return 'email';
  if (/โทร|phone|mobile/u.test(source)) return 'phone';
  if (/วันที่|date|dob/u.test(source)) return 'date';
  if (/ราคา|ยอด|จำนวนเงิน|amount|total/u.test(source)) return 'currency';
  if (/บัตรประชาชน|national.?id|เลขประจำตัว/u.test(source)) return 'thai_national_id';
  if (/รหัสไปรษณีย์|postal|zip/u.test(source)) return 'postal_code';
  return 'text';
}

function hasFormPairEvidence(source, label, value) {
  if (!value || label.length > 48 || label.split(/\s+/u).length > 6) return false;
  if (/^https?:\/\//iu.test(source) || /^(?:เวลา\s*)?\d{1,2}:\d{2}(?::\d{2})?$/u.test(source)) return false;
  if (/\b[A-Z0-9][A-Z0-9._/-]{1,}$/u.test(label)) return false;
  if (/\d/u.test(label) || !/[\p{L}]/u.test(label)) return false;
  return /(ชื่อ|นามสกุล|ที่อยู่|อีเมล|email|โทร|phone|mobile|วันที่|date|ยอด|ราคา|amount|total|เลข|รหัส|code|\bid\b|บริษัท|หน่วยงาน|ตำแหน่ง|จังหวัด|อำเภอ|เขต|แขวง|หมายเหตุ|note)/iu.test(label);
}

export function recognizeFormLayout(model) {
  const output = clone(model);
  const recognized = [];
  for (const [pageIndex, page] of (output.pages || []).entries()) {
    page.blocks = (page.blocks || []).map(block => {
      if (block.type !== 'text' || block.redacted || block.reviewStatus === 'confirmed_non_text') return block;
      const source = String(block.text || '').trim();
      const check = source.match(/^([☐☑✓✔□■])\s*(.+)$/u);
      if (check) {
        const next = { ...block, type: 'checkbox', label: check[2], value: '', checked: /[☑✓✔■]/u.test(check[1]), fieldType: 'checkbox', source: 'form-recognition', metadata: { ...(block.metadata || {}), recognitionEvidence: ['checkbox_glyph', 'adjacent_label'] } };
        recognized.push({ pageIndex, blockId: block.id, type: 'checkbox', confidence: block.confidence ?? .8 });
        return next;
      }
      const pair = source.match(/^(.{1,80}?)[：:]\s*(.*)$/u);
      if (!pair) return block;
      const label = pair[1].trim();
      const value = pair[2].trim();
      if (!hasFormPairEvidence(source, label, value)) return block;
      const fieldType = inferFieldType(label, value);
      const validation = validateField(value, fieldType);
      const confidence = Math.max(0, Math.min(1, Number(block.confidence ?? .75) * (validation.valid ? 1 : .82)));
      const next = { ...block, type: 'field', label, value, fieldType, validation, confidence, reviewStatus: validation.valid && confidence >= .88 ? 'verified' : 'review_required', source: 'form-recognition', metadata: { ...(block.metadata || {}), recognitionEvidence: ['label_value_separator', `field_type_${fieldType}`], reviewReasons: validation.valid ? [] : ['field_validation_failed', ...validation.warnings] } };
      delete next.text;
      recognized.push({ pageIndex, blockId: block.id, type: 'field', fieldType, confidence });
      return next;
    });
  }
  output.updatedAt = new Date().toISOString();
  return { model: output, recognized };
}

export function inferBorderlessTable(textBlocks, tolerance = 12) {
  const blocks = (textBlocks || []).filter(block => String(block.text || '').trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const block of blocks) {
    let row = rows.find(item => Math.abs(item.y - block.y) <= tolerance);
    if (!row) { row = { y: block.y, blocks: [] }; rows.push(row); }
    row.blocks.push(block);
  }
  const anchors = [];
  for (const block of blocks) if (!anchors.some(x => Math.abs(x - block.x) <= tolerance * 2)) anchors.push(block.x);
  anchors.sort((a, b) => a - b);
  const confidence = rows.length >= 2 && anchors.length >= 2 ? Math.min(.95, .45 + Math.min(rows.length, 8) * .05 + Math.min(anchors.length, 6) * .04) : 0;
  return { inferred: confidence >= .65, label: 'Inferred Grid', confidence, rows: rows.length, columns: anchors.length, anchors, evidence: ['repeated_x_position', 'row_baseline_cluster', 'whitespace_gap'] };
}
