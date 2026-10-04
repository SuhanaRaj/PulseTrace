import mongoose from 'mongoose';

const DB_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

export function getHealthStatus() {
  return {
    status: 'ok',
    service: 'PulseTrace Backend',
    database: DB_STATES[mongoose.connection.readyState] || 'unknown',
    timestamp: new Date().toISOString(),
  };
}
