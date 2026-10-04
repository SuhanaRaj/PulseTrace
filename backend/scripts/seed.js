import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import Service from '../src/models/Service.js';
import Trace from '../src/models/Trace.js';
import Span from '../src/models/Span.js';
import ErrorRecord from '../src/models/Error.js';

const PROJECT_ID = 'pulsetrace'; // seeded development data is PulseTrace project data

const services = [
  { name: 'api-gateway', environment: 'development', status: 'healthy' },
  { name: 'auth-service', environment: 'development', status: 'healthy' },
  { name: 'mission-service', environment: 'development', status: 'healthy' },
  { name: 'notification-service', environment: 'development', status: 'healthy' },
];

const traces = [
  { traceId: 'tr_001', rootService: 'api-gateway', route: '/v1/missions/launch', method: 'POST', duration: 742, status: 'error' },
  { traceId: 'tr_002', rootService: 'api-gateway', route: '/v1/users/me', method: 'GET', duration: 126, status: 'success' },
  { traceId: 'tr_003', rootService: 'mission-service', route: '/v1/missions/preview', method: 'POST', duration: 319, status: 'success' },
  { traceId: 'tr_004', rootService: 'notification-service', route: '/v1/notifications', method: 'GET', duration: 74, status: 'success' },
];

const spans = [
  { spanId: 'sp_001_gateway', traceId: 'tr_001', serviceName: 'api-gateway', operation: 'POST /v1/missions/launch', duration: 742, status: 'error', startTime: '2026-09-30T10:00:00Z', endTime: '2026-09-30T10:00:00.742Z' },
  { spanId: 'sp_001_auth', traceId: 'tr_001', parentSpanId: 'sp_001_gateway', serviceName: 'auth-service', operation: 'Validate token', duration: 83, status: 'success', startTime: '2026-09-30T10:00:00.012Z', endTime: '2026-09-30T10:00:00.095Z' },
  { spanId: 'sp_001_mission', traceId: 'tr_001', parentSpanId: 'sp_001_gateway', serviceName: 'mission-service', operation: 'Launch mission', duration: 612, status: 'error', startTime: '2026-09-30T10:00:00.112Z', endTime: '2026-09-30T10:00:00.724Z' },
  { spanId: 'sp_002_gateway', traceId: 'tr_002', serviceName: 'api-gateway', operation: 'GET /v1/users/me', duration: 126, status: 'success', startTime: '2026-09-30T10:02:00Z', endTime: '2026-09-30T10:02:00.126Z' },
  { spanId: 'sp_002_auth', traceId: 'tr_002', parentSpanId: 'sp_002_gateway', serviceName: 'auth-service', operation: 'Fetch user', duration: 72, status: 'success', startTime: '2026-09-30T10:02:00.015Z', endTime: '2026-09-30T10:02:00.087Z' },
  { spanId: 'sp_003_mission', traceId: 'tr_003', serviceName: 'mission-service', operation: 'POST /v1/missions/preview', duration: 319, status: 'success', startTime: '2026-09-30T10:04:00Z', endTime: '2026-09-30T10:04:00.319Z' },
  { spanId: 'sp_004_notification', traceId: 'tr_004', serviceName: 'notification-service', operation: 'GET /v1/notifications', duration: 74, status: 'success', startTime: '2026-09-30T10:06:00Z', endTime: '2026-09-30T10:06:00.074Z' },
];

const errors = [
  { traceId: 'tr_001', serviceName: 'mission-service', errorType: 'DatabaseTimeout', message: 'Database connection timed out', stackTrace: 'TimeoutError: development seed stack trace' },
  { traceId: 'tr_001', serviceName: 'mission-service', errorType: 'DatabaseTimeout', message: 'Database connection timed out', stackTrace: 'TimeoutError: development seed stack trace' },
  { traceId: 'tr_001', serviceName: 'api-gateway', errorType: 'UpstreamTimeout', message: 'Mission service did not respond in time', stackTrace: 'GatewayTimeout: development seed stack trace' },
];

async function seedDatabase() {
  const isConnected = await connectDatabase();
  if (!isConnected) {
    process.exitCode = 1;
    return;
  }

  await Service.bulkWrite(
    services.map((service) => ({
      updateOne: {
        filter: { projectId: PROJECT_ID, name: service.name },
        update: { $set: { ...service, projectId: PROJECT_ID } },
        upsert: true,
      },
    })),
  );

  await Trace.bulkWrite(traces.map((trace) => ({ updateOne: { filter: { traceId: trace.traceId }, update: { $set: { ...trace, projectId: PROJECT_ID } }, upsert: true } })));
  await Span.bulkWrite(spans.map((span) => ({ updateOne: { filter: { spanId: span.spanId }, update: { $set: { ...span, projectId: PROJECT_ID } }, upsert: true } })));
  for (const errorRecord of errors) {
    await ErrorRecord.updateOne(
      { projectId: PROJECT_ID, traceId: errorRecord.traceId, serviceName: errorRecord.serviceName, errorType: errorRecord.errorType, message: errorRecord.message },
      { $setOnInsert: { ...errorRecord, projectId: PROJECT_ID } },
      { upsert: true },
    );
  }

  console.log('Development PulseTrace data seeded successfully.');
  await disconnectDatabase();
}

seedDatabase().catch(async (error) => {
  console.error('Database seed failed:', error.message);
  await disconnectDatabase();
  process.exitCode = 1;
});
