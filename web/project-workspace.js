import { addProjectJobs, createProject, fileJobKey, sanitizeOcrResult, summarizeProject, updateProjectJob } from './project-core.mjs';

const DB_NAME = 'ripscan-project-workspace';
const STORE = 'projects';
const ACTIVE_KEY = 'ripscan-active-project';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function put(project) {
  const database = await openDb();
  await new Promise((resolve, reject) => { const transaction = database.transaction(STORE, 'readwrite'); transaction.objectStore(STORE).put(project); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
  database.close(); localStorage.setItem(ACTIVE_KEY, project.id); return project;
}

async function list() {
  const database = await openDb();
  const rows = await new Promise((resolve, reject) => { const request = database.transaction(STORE).objectStore(STORE).getAll(); request.onsuccess = () => resolve(request.result || []); request.onerror = () => reject(request.error); });
  database.close(); return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function active(create = false) {
  const projects = await list();
  const selected = projects.find(project => project.id === localStorage.getItem(ACTIVE_KEY)) || projects[0];
  if (selected || !create) return selected || null;
  return put(createProject(`Project ${new Date().toLocaleDateString('th-TH')}`));
}

let mutationQueue = Promise.resolve();
function mutate(mutator) {
  const operation = mutationQueue.then(async () => {
    const project = await active(true);
    return put(mutator(project));
  });
  mutationQueue = operation.catch(() => undefined);
  return operation;
}

document.addEventListener('ripscan:files-added', event => { mutate(project => addProjectJobs(project, event.detail.files)).catch(console.error); });
document.addEventListener('ripscan:job-status', event => {
  mutate(project => updateProjectJob(project, fileJobKey(event.detail.file), { status: event.detail.status, progress: event.detail.progress ?? (event.detail.status === 'completed' ? 1 : 0), result: event.detail.result ? sanitizeOcrResult(event.detail.result) : null, error: String(event.detail.error || '') })).catch(console.error);
});

globalThis.RipScanProjects = {
  list,
  active,
  create: name => put(createProject(name)),
  select(id) { localStorage.setItem(ACTIVE_KEY, id); },
  summary: summarizeProject,
  async remove(id) { const database = await openDb(); await new Promise((resolve, reject) => { const transaction = database.transaction(STORE, 'readwrite'); transaction.objectStore(STORE).delete(id); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); }); database.close(); if (localStorage.getItem(ACTIVE_KEY) === id) localStorage.removeItem(ACTIVE_KEY); },
};
