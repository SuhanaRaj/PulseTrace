// Single authoritative list of projects. Add an entry here to add a project (backend + /api/projects + dashboard selector).
import { httpError } from '../utils/httpError.js';

export const PROJECTS = [
  { id: 'pulsetrace', name: 'PulseTrace' },
  { id: 'api-suite', name: 'API Suite' },
];

export const DEFAULT_PROJECT_ID = PROJECTS[0].id;
export const PROJECT_IDS = PROJECTS.map((project) => project.id);

export const isValidProjectId = (value) => typeof value === 'string' && PROJECT_IDS.includes(value);

export function assertValidProjectId(value) {
  if (!isValidProjectId(value)) {
    throw httpError(400, `Invalid projectId ${JSON.stringify(value)}. Valid projects: ${PROJECT_IDS.join(', ')}.`);
  }
  return value;
}
