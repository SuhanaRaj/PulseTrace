import env from '../config/env.js';
import { DEFAULT_PROJECT_ID, assertValidProjectId } from '../config/projects.js';
import { httpError } from './httpError.js';

/** The project this server's own telemetry belongs to (PROJECT_ID env, default "pulsetrace"). Validated. */
export const serverProjectId = () => assertValidProjectId(env.projectId || DEFAULT_PROJECT_ID);

const isMissing = (value) => value === undefined || value === null || value === '';

/**
 * Resolve the project a request/record belongs to. Never inferred from serviceName.
 *  - provided      -> must be a known project (400 otherwise)
 *  - not provided  -> the server's own project (PROJECT_ID env, default "pulsetrace"),
 *                     or 400 when REQUIRE_PROJECT_ID=true.
 * Reads therefore never aggregate across projects: no projectId means "the server's project", not "all".
 */
export function resolveProjectId(input) {
  if (isMissing(input)) {
    if (env.requireProjectId) throw httpError(400, 'projectId is required.');
    return serverProjectId();
  }
  return assertValidProjectId(input);
}

/** For writes that reference an existing trace: explicit projectId (validated) or null = inherit from the trace. */
export function explicitProjectId(input) {
  if (isMissing(input)) {
    if (env.requireProjectId) throw httpError(400, 'projectId is required.');
    return null;
  }
  return assertValidProjectId(input);
}
