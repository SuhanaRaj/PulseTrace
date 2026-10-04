// Adds projectId:"pulsetrace" to existing (seed/dev) telemetry and fixes the services index.
// Safe + idempotent: never overwrites an existing projectId, never deletes documents.
// Usage: npm run migrate:projects            (apply)
//        npm run migrate:projects -- --dry-run (report only)
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import Service from '../src/models/Service.js';
import Trace from '../src/models/Trace.js';
import Span from '../src/models/Span.js';
import ErrorRecord from '../src/models/Error.js';
import { DEFAULT_PROJECT_ID } from '../src/config/projects.js';
import { backfillProjectId, dropLegacyServiceNameIndex } from '../src/services/projectMigration.js';

const dryRun = process.argv.includes('--dry-run');
const models = { traces: Trace, spans: Span, errors: ErrorRecord, services: Service };

if (!(await connectDatabase())) {
  process.exitCode = 1;
} else {
  try {
    console.log(`${dryRun ? '[dry run] ' : ''}Backfilling projectId="${DEFAULT_PROJECT_ID}" on documents that have none...`);
    console.table(await backfillProjectId(models, { dryRun }));
    if (!dryRun) {
      const dropped = await dropLegacyServiceNameIndex(Service);
      console.log(dropped ? 'Dropped legacy unique index services.name_1.' : 'No legacy services.name_1 index to drop.');
      await Promise.all(Object.values(models).map((model) => model.createIndexes()));
      console.log('Indexes ensured. Migration complete.');
    }
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}
