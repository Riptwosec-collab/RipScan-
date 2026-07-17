const clone = value => globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const id = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export function createProject(name = 'RipScan Project') {
  const now = new Date().toISOString();
  return { id: id('project'), version: '1.0.0', name: String(name).trim() || 'RipScan Project', createdAt: now, updatedAt: now, settings: { namingRule: '{originalName}' }, jobs: [] };
}

export function fileJobKey(file) {
  return `${String(file.name || '')}:${Number(file.size || 0)}:${Number(file.lastModified || 0)}`;
}

export function addProjectJobs(project, files = []) {
  const output = clone(project);
  const known = new Set(output.jobs.map(job => job.key));
  for (const file of files) {
    const key = fileJobKey(file);
    if (known.has(key)) continue;
    output.jobs.push({ id: id('job'), key, name: String(file.name || 'document'), size: Number(file.size || 0), type: String(file.type || ''), status: 'queued', progress: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), result: null, error: '' });
    known.add(key);
  }
  output.updatedAt = new Date().toISOString();
  return output;
}

export function updateProjectJob(project, key, changes = {}) {
  const output = clone(project);
  const job = output.jobs.find(item => item.key === key);
  if (!job) return output;
  Object.assign(job, clone(changes), { updatedAt: new Date().toISOString() });
  output.updatedAt = job.updatedAt;
  return output;
}

export function summarizeProject(project) {
  const counts = { queued: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const job of project?.jobs || []) counts[job.status] = (counts[job.status] || 0) + 1;
  return { total: project?.jobs?.length || 0, counts, progress: project?.jobs?.length ? project.jobs.reduce((sum, job) => sum + Number(job.progress || 0), 0) / project.jobs.length : 0 };
}

export function sanitizeOcrResult(result) {
  return { name: String(result?.name || ''), type: String(result?.type || ''), confidence: Number(result?.confidence || 0), fullText: String(result?.fullText || ''), pages: (result?.pages || []).map(page => ({ page: Number(page.page || 0), text: String(page.text || ''), confidence: Number(page.confidence || 0) })) };
}
