import { DEFAULT_PROJECT_ID } from '../config/projects.js';

const missingProject = { $or: [{ projectId: { $exists: false } }, { projectId: null }] };

/**
 * Backfill projectId on legacy documents (created before projects existed). Non-destructive and idempotent:
 * only documents WITHOUT a projectId are touched; existing values are never overwritten; nothing is deleted.
 * `models` = { traces, spans, errors, services } Mongoose models.
 */
export async function backfillProjectId(models, { projectId = DEFAULT_PROJECT_ID, dryRun = false } = {}) {
  const report = {};
  for (const [name, model] of Object.entries(models)) {
    if (dryRun) {
      report[name] = { matched: await model.countDocuments(missingProject), modified: 0 };
    } else {
      const result = await model.updateMany(missingProject, { $set: { projectId } });
      report[name] = { matched: result.matchedCount ?? result.n ?? 0, modified: result.modifiedCount ?? result.nModified ?? 0 };
    }
  }
  return report;
}

/** Number of documents per collection that still have no projectId (0 everywhere = migrated). */
export async function countUnmigrated(models) {
  const counts = {};
  for (const [name, model] of Object.entries(models)) counts[name] = await model.countDocuments(missingProject);
  return counts;
}

/**
 * services.name used to be globally unique; it is now unique per project. Drop the legacy single-field unique
 * index (an index, not data) so the same service name can exist in two projects. Safe to re-run.
 */
export async function dropLegacyServiceNameIndex(serviceModel) {
  const indexes = await serviceModel.collection.indexes().catch(() => []);
  const legacy = indexes.find((index) => index.name === 'name_1' && index.unique);
  if (!legacy) return false;
  await serviceModel.collection.dropIndex('name_1');
  return true;
}
