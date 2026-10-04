import app from './src/app.js';
import { connectDatabase } from './src/config/database.js';
import env from './src/config/env.js';
import Service from './src/models/Service.js';
import Trace from './src/models/Trace.js';
import Span from './src/models/Span.js';
import ErrorRecord from './src/models/Error.js';
import { countUnmigrated } from './src/services/projectMigration.js';

app.listen(env.port, () => {
  console.log(`PulseTrace Backend is running on http://localhost:${env.port}`);
  connectDatabase().then(async (connected) => {
    if (!connected) return;
    try {
      const counts = await countUnmigrated({ traces: Trace, spans: Span, errors: ErrorRecord, services: Service });
      const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
      if (total) console.warn(`[projects] ${total} document(s) have no projectId and are invisible to the dashboard: run "npm run migrate:projects". ${JSON.stringify(counts)}`);
    } catch (error) {
      console.warn(`[projects] could not check for un-migrated data: ${error.message}`);
    }
  });
});
