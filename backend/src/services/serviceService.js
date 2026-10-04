import Service from '../models/Service.js';
import Trace from '../models/Trace.js';
import { resolveProjectId } from '../utils/projectScope.js';

function requireFields(data, fields) {
  const missingField = fields.find((field) => !data[field]);
  if (missingField) {
    const error = new Error(`${missingField} is required.`);
    error.statusCode = 400;
    throw error;
  }
}

function percentile(values, value) {
  if (!values.length) return 0;
  return values[Math.min(values.length - 1, Math.ceil((value / 100) * values.length) - 1)];
}

function addMetrics(service, traces) {
  const matchingTraces = traces.filter((trace) => trace.rootService === service.name);
  const durations = matchingTraces.map((trace) => trace.duration).sort((a, b) => a - b);
  const failed = matchingTraces.filter((trace) => trace.status === 'error').length;
  const averageLatency = durations.length
    ? Math.round(durations.reduce((total, duration) => total + duration, 0) / durations.length)
    : 0;

  return {
    id: service._id.toString(),
    name: service.name,
    environment: service.environment,
    status: service.status,
    requestRate: matchingTraces.length,
    errorRate: matchingTraces.length ? Number(((failed / matchingTraces.length) * 100).toFixed(2)) : 0,
    averageLatency,
    p95Latency: percentile(durations, 95),
  };
}

export async function getServices(query = {}) {
  const projectId = resolveProjectId(query.projectId);
  const [services, traces] = await Promise.all([
    Service.find({ projectId }).sort({ createdAt: -1 }),
    Trace.find({ projectId }).select('rootService duration status'),
  ]);
  return services.map((service) => addMetrics(service, traces));
}

export async function getService(id, query = {}) {
  const projectId = resolveProjectId(query.projectId);
  const service = await Service.findOne({ _id: id, projectId });
  if (!service) {
    const error = new Error('Service not found.');
    error.statusCode = 404;
    throw error;
  }
  const traces = await Trace.find({ projectId, rootService: service.name }).select('rootService duration status');
  return addMetrics(service, traces);
}

export function addService(data) {
  requireFields(data, ['name', 'environment', 'status']);
  return Service.create({ ...data, projectId: resolveProjectId(data.projectId) });
}

export async function editService(id, data, query = {}) {
  const { projectId: _ignored, ...changes } = data || {}; // a service cannot be moved to another project
  const service = await Service.findOneAndUpdate({ _id: id, projectId: resolveProjectId(query.projectId) }, changes, {
    new: true,
    runValidators: true,
  });
  if (!service) {
    const error = new Error('Service not found.');
    error.statusCode = 404;
    throw error;
  }
  return service;
}

export async function removeService(id, query = {}) {
  const service = await Service.findOneAndDelete({ _id: id, projectId: resolveProjectId(query.projectId) });
  if (!service) {
    const error = new Error('Service not found.');
    error.statusCode = 404;
    throw error;
  }
}
