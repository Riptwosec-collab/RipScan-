import * as core from './cover-ocr-core.mjs';

export * from './cover-ocr-core.mjs';

export function classifyCoverRegion(features = {}) {
  const ornamentScore = Math.max(0, Math.min(1, Number(features.ornamentScore || 0)));
  const curvedEdgeDensity = Math.max(0, Math.min(1, Number(features.curvedEdgeDensity || 0)));
  const symmetry = Math.max(0, Math.min(1, Number(features.symmetry || 0)));
  const areaRatio = Math.max(0, Math.min(1, Number(features.areaRatio || 0)));
  const textLineScore = Math.max(0, Math.min(1, Number(features.textLineScore || 0)));
  const connectedComponentScore = Math.max(0, Math.min(1, Number(features.connectedComponentScore || 0)));
  if (ornamentScore >= 0.6 || (curvedEdgeDensity >= 0.7 && symmetry >= 0.45 && areaRatio >= 0.08 && textLineScore < 0.4 && connectedComponentScore < 0.4)) {
    return { regionType: 'ornament', action: 'skip_text_ocr', confidence: Math.max(ornamentScore, curvedEdgeDensity), hasText: false };
  }
  return core.classifyCoverRegion(features);
}

export function classifyProtectedText(value, box = {}, page = {}) {
  const text = String(value ?? '').trim();
  const namePrefix = /^(?:นาย|นาง|นางสาว|เด็กชาย|เด็กหญิง|ดร\.|ศ\.|รศ\.|ผศ\.)\s*/u;
  const schoolWords = /(?:โรงเรียน|มหาวิทยาลัย|วิทยาลัย|สำนักงาน|เขตพื้นที่|สถานศึกษา|ศูนย์การศึกษา|สำนักพิมพ์)/u;
  const titleWords = /(?:ใบกิจกรรม|วรรณคดี|ชั้นมัธยมศึกษา|แบบฝึกหัด|ใบงาน|บทเรียน|ประกาศ|เกียรติบัตร|หนังสือ|รายงาน)/u;
  if (!text) return 'unknown';
  if (namePrefix.test(text) && text.replace(namePrefix, '').trim().split(/\s+/u).length >= 1) return 'person_name';
  if (schoolWords.test(text)) return /โรงเรียน|สถานศึกษา/u.test(text) ? 'school_name' : 'organization_name';
  if (/^(?:ชั้น|ระดับชั้น)\s*(?:มัธยม|ประถม|อนุบาล)/u.test(text)) return 'class_level';
  if (titleWords.test(text)) return 'title';
  if (page.height && box.height) {
    const yRatio = Number(box.top || box.y || 0) / page.height;
    const heightRatio = Number(box.height || 0) / page.height;
    if (yRatio < 0.36 && heightRatio >= 0.034 && text.length <= 90) return 'title';
  }
  if (text.length >= 55 || /[.!?。！？]$/u.test(text)) return 'paragraph';
  return 'unknown';
}
