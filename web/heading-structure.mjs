const THAI_HEADING = /^(?:บทที่|บท|หมวดที่|หมวด|ส่วนที่|ส่วน|หัวข้อ|เรื่อง|คำนำ|สารบัญ|บทนำ|บทสรุป|สรุป|วัตถุประสงค์|ขอบเขต|รายละเอียด|ผลการตรวจสอบ|ผลลัพธ์|ข้อเสนอแนะ|หมายเหตุ|เอกสารแนบ|ภาคผนวก|บทคัดย่อ|วิธีดำเนินการ|การวิเคราะห์)(?:\s|[:：]|$)/u;
const ENGLISH_HEADING = /^(?:chapter|section|part|introduction|summary|conclusion|objective|scope|details?|results?|recommendations?|notes?|appendix|abstract|methodology|analysis)(?:\s|[:：]|$)/i;
const NUMBERED_HEADING = /^(\d+(?:\.\d+){0,3}|[ก-ฮ]|[IVXLC]+)[.)]?\s+(.+)$/iu;
const DATE_TIME_OR_NUMBER = /^(?:[฿$€£]?\s*[+-]?[\d๐-๙][\d๐-๙,]*(?:\.\d+)?%?|\d{1,2}[/:.-]\d{1,2}[/:.-]\d{2,4}|\d{1,2}:\d{2}(?::\d{2})?|\+?[\d\s()-]{7,})$/u;
const CODE_LIKE = /^(?:[A-Z]{1,8}[-_/]\d[\w./-]*|[A-Z0-9]{5,}|\d{2,}[-_/][A-Z0-9-]+)$/i;
const CONTACT_LIKE = /(?:https?:\/\/|www\.|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b)/i;
const SENTENCE_END = /[.!?。！？]$/u;
const LETTER = /[\p{L}]/u;
const ENGLISH_ALL_CAPS = /^[A-Z][A-Z\d &'()/-]{2,79}$/;

function cleanLine(value) {
  return String(value ?? '').replace(/[\t ]+$/g, '').replace(/^\s+/g, '').trim();
}

function isTableLike(line) {
  if (/\t|\|/.test(line)) return true;
  const columns = line.split(/\s{2,}/).filter(Boolean);
  return columns.length >= 3;
}

function isListItem(line) {
  return /^(?:[-–—•▪◦*]|\d+[.)]|[ก-ฮ][.)])\s+/u.test(line);
}

function nextMeaningful(lines, start) {
  for (let index = start; index < lines.length; index += 1) {
    const value = cleanLine(lines[index]);
    if (value) return { index, value };
  }
  return null;
}

function previousMeaningful(lines, start) {
  for (let index = start; index >= 0; index -= 1) {
    const value = cleanLine(lines[index]);
    if (value) return { index, value };
  }
  return null;
}

export function detectHeading(line, context = {}) {
  const text = cleanLine(line);
  const previousBlank = context.previousBlank ?? true;
  const nextLine = cleanLine(context.nextLine || '');

  if (!text || text.length < 2 || text.length > 100) return { isHeading: false, level: 0, confidence: 0, reason: 'length' };
  if (!LETTER.test(text)) return { isHeading: false, level: 0, confidence: 0, reason: 'no_letters' };
  if (DATE_TIME_OR_NUMBER.test(text) || CODE_LIKE.test(text) || CONTACT_LIKE.test(text)) return { isHeading: false, level: 0, confidence: 0, reason: 'strict_value' };
  if (isTableLike(text)) return { isHeading: false, level: 0, confidence: 0, reason: 'table_like' };

  if (THAI_HEADING.test(text) || ENGLISH_HEADING.test(text)) {
    const major = /^(?:บทที่|บท|หมวดที่|หมวด|chapter|part)(?:\s|[:：]|$)/iu.test(text);
    return { isHeading: true, level: major ? 1 : 2, confidence: 0.98, reason: 'explicit_heading' };
  }

  const numbered = text.match(NUMBERED_HEADING);
  if (numbered && !SENTENCE_END.test(text)) {
    const body = numbered[2].trim();
    if (body.length <= 72 && !isTableLike(body)) {
      const depth = String(numbered[1]).split('.').length;
      return { isHeading: true, level: Math.min(4, depth + 1), confidence: 0.9, reason: 'numbered_heading' };
    }
  }

  const englishWords = text.split(/\s+/).filter(Boolean);
  if (ENGLISH_ALL_CAPS.test(text) && englishWords.length <= 10 && !isListItem(text)) {
    return { isHeading: true, level: 2, confidence: 0.9, reason: 'all_caps_heading' };
  }

  if (text.endsWith(':') || text.endsWith('：')) {
    if (text.length <= 72 && !isListItem(text)) return { isHeading: true, level: 3, confidence: 0.84, reason: 'label_heading' };
  }

  const standalone = previousBlank
    && !SENTENCE_END.test(text)
    && !isListItem(text)
    && text.length <= 60
    && nextLine.length >= Math.max(24, text.length + 10);

  if (standalone) return { isHeading: true, level: 3, confidence: 0.72, reason: 'standalone_short_line' };

  return { isHeading: false, level: 0, confidence: 0, reason: 'body_text' };
}

export function structureHeadings(input) {
  const normalized = String(input ?? '').replace(/\r\n?/g, '\n');
  const rawLines = normalized.split('\n');
  const annotated = rawLines.map((line, index) => {
    const previous = previousMeaningful(rawLines, index - 1);
    const next = nextMeaningful(rawLines, index + 1);
    const previousBlank = index === 0 || !cleanLine(rawLines[index - 1]);
    const detected = detectHeading(line, { previousBlank, previousLine: previous?.value || '', nextLine: next?.value || '' });
    return { index, text: cleanLine(line), ...detected };
  });

  const output = [];
  for (const item of annotated) {
    if (!item.text) {
      if (output.length && output[output.length - 1] !== '') output.push('');
      continue;
    }
    if (item.isHeading) {
      if (output.length && output[output.length - 1] !== '') output.push('');
      output.push(item.text);
      output.push('');
    } else {
      output.push(item.text);
    }
  }

  while (output[0] === '') output.shift();
  while (output[output.length - 1] === '') output.pop();

  const compact = [];
  for (const line of output) {
    if (line === '' && compact[compact.length - 1] === '') continue;
    compact.push(line);
  }

  const headings = annotated
    .filter(item => item.isHeading)
    .map(item => ({ line: item.index + 1, text: item.text, level: item.level, confidence: item.confidence, reason: item.reason }));

  const sections = [];
  let current = { heading: null, level: 0, body: [] };
  for (const item of annotated) {
    if (!item.text) continue;
    if (item.isHeading) {
      if (current.heading || current.body.length) sections.push(current);
      current = { heading: item.text, level: item.level, body: [] };
    } else {
      current.body.push(item.text);
    }
  }
  if (current.heading || current.body.length) sections.push(current);

  return {
    text: compact.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    headings,
    sections,
  };
}

export function markdownWithHeadings(input) {
  const structured = structureHeadings(input);
  const headingMap = new Map(structured.headings.map(item => [item.text, item.level]));
  return structured.text
    .split('\n')
    .map(line => headingMap.has(line) ? `${'#'.repeat(Math.max(1, Math.min(6, headingMap.get(line))))} ${line}` : line)
    .join('\n');
}
