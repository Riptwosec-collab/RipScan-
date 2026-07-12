export * from './book-ocr-core.mjs';

const SEPARATOR = /^(?:-{4,}|_{4,}|={4,}|─{4,}|━{4,}|═{4,})$/u;
const ISBN_STRICT = /(?:\bISBN(?:-1[03])?\s*:?[\s-]*(?:97[89][\s-]?)?[0-9Xx](?:[\s-]?[0-9Xx]){8,12}\b|\b97[89](?:[\s-]?\d){10}\b)/i;
const PHONE_STRICT = /(?:โทร(?:ศัพท์)?\.?\s*:?[\s-]*)?(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,3}\)?[\s-]?)\d{3,4}[\s-]\d{3,4}\b/u;
const PRICE = /(?:฿|บาท|ราคา)\s*[0-9๐-๙,.]+|[0-9๐-๙,.]+\s*(?:บาท|฿)/u;

export function classifyDashSymbol(symbol, context = '') {
  const value = String(symbol ?? '');
  const text = String(context ?? '');
  const typeMap = { '-': 'hyphen', '–': 'en_dash', '—': 'em_dash', '−': 'minus_sign', '_': 'underscore', '/': 'slash', '|': 'vertical_bar' };
  let role = 'text_symbol';
  if (SEPARATOR.test(value)) role = 'section_separator';
  else if (/[A-Za-z0-9]+[-_/][A-Za-z0-9]+/.test(text) && /[A-Za-z]/.test(text)) role = 'document_code';
  else if (/^(?:[A-Z0-9]{2,}[-_/]){1,}[A-Z0-9-_/]+$/i.test(text.trim())) role = 'document_code';
  else if (/\d\s*[–-]\s*\d/u.test(text)) role = 'range';
  else if (value === '—') role = 'sentence_separator';
  else if (value === '−') role = 'mathematical_minus';
  return { symbol: value, type: SEPARATOR.test(value) ? 'separator_line' : (typeMap[value] || 'unknown'), role };
}

export function extractDashElements(value) {
  const elements = [];
  String(value ?? '').split('\n').forEach((line, lineIndex) => {
    if (SEPARATOR.test(line.trim())) {
      elements.push({ ...classifyDashSymbol(line.trim(), line), line: lineIndex + 1, length: line.trim().length, position: 'between_blocks' });
      return;
    }
    [...line.matchAll(/[-–—−_/|]+/gu)].forEach(match => elements.push({ ...classifyDashSymbol(match[0], line), line: lineIndex + 1, column: match.index + 1, length: match[0].length }));
  });
  return elements;
}

export function classifyBlockText(value, box = {}, page = {}) {
  const text = String(value ?? '').trim();
  const yRatio = page.height ? (box.top || box.y || 0) / page.height : 0;
  const heightRatio = page.height ? (box.height || 0) / page.height : 0;
  if (!text) return 'unknown';
  if (ISBN_STRICT.test(text)) return 'isbn';
  if (PHONE_STRICT.test(text) || /^(?:โทร(?:ศัพท์)?\.?\s*:?[\s-]*)?0\d(?:[\s-]?\d){8}$/u.test(text)) return 'phone';
  if (PRICE.test(text)) return 'price';
  if (/^(?:\d+|[ก-ฮ])[.)]\s+/u.test(text)) return 'numbered_list';
  if (/(?:ถนน|แขวง|เขต|ตำบล|อำเภอ|จังหวัด|เลขที่|ซอย)/u.test(text) && text.length > 15) return 'address';
  if (/(?:สำนักพิมพ์|ศูนย์หนังสือ|จัดพิมพ์|เผยแพร่|มหาวิทยาลัย)/u.test(text)) return 'publisher_info';
  if (yRatio < 0.32 && (heightRatio > 0.035 || text.length < 80) && !/[.!?。！？]$/u.test(text)) return 'title';
  if (text.length >= 70 || /[.!?。！？]$/u.test(text)) return 'paragraph';
  return 'unknown';
}
