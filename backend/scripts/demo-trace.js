// Generates real traces through the reusable tracer and persists them in MongoDB.
// Usage: npm run demo:trace
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import tracer from '../src/tracing/tracer.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run({ fail }) {
  const trace = await tracer.startTrace({ projectId: 'pulsetrace', rootService: 'api-gateway', route: '/api/missions', method: 'GET' });
  const root = await trace.startSpan({ serviceName: 'api-gateway', operation: 'GET /api/missions' });

  await trace.withSpan({ serviceName: 'auth-service', operation: 'Validate token', parent: root }, () => sleep(20 + Math.random() * 30));

  try {
    await trace.withSpan({ serviceName: 'mission-service', operation: 'Load missions', parent: root }, async (missionSpan) => {
      await sleep(40 + Math.random() * 60);
      await trace.withSpan({ serviceName: 'database', operation: 'find missions', parent: missionSpan }, async () => {
        await sleep(30 + Math.random() * 50);
        if (fail) throw new Error('Database connection timed out');
      });
    });
    await root.end();
  } catch (error) {
    await root.fail(error);
  }

  const { trace: finished } = await trace.end();
  console.log(`${finished.traceId} -> ${finished.status} in ${finished.duration}ms`);
}

if (!(await connectDatabase())) {
  process.exitCode = 1;
} else {
  await run({ fail: false });
  await run({ fail: true });
  await disconnectDatabase();
}
