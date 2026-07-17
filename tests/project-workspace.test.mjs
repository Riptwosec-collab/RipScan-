import test from 'node:test';
import assert from 'node:assert/strict';
import { addProjectJobs, createProject, sanitizeOcrResult, summarizeProject, updateProjectJob } from '../web/project-core.mjs';

test('project queue deduplicates files and persists only safe OCR result data', () => {
  let project = createProject('Batch A');
  const file = { name: 'invoice.pdf', size: 1200, type: 'application/pdf', lastModified: 123 };
  project = addProjectJobs(project, [file, file]);
  assert.equal(project.jobs.length, 1);
  project = updateProjectJob(project, project.jobs[0].key, { status: 'completed', progress: 1, result: sanitizeOcrResult({ name: file.name, fullText: 'total 10', originalPreviewUrl: 'blob:secret', pages: [{ page: 1, text: 'total 10', confidence: 90, originalPreviewUrl: 'data:image/png;base64,secret' }] }) });
  assert.equal(summarizeProject(project).counts.completed, 1);
  const serialized = JSON.stringify(project);
  assert.equal(serialized.includes('blob:secret'), false);
  assert.equal(serialized.includes('base64,secret'), false);
});
