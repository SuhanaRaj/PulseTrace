import ErrorRecord from '../models/Error.js';
import * as tracingService from './tracingService.js';
import { resolveProjectId } from '../utils/projectScope.js';

function validateError(data) {
  const fields = ['serviceName', 'errorType', 'message'];
  const missingField = fields.find((field) => !data[field]);
  if (missingField) {
    const error = new Error(`${missingField} is required.`);
    error.statusCode = 400;
    throw error;
  }
}

function positiveInteger(value, fallback, maximum = 100) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error('Pagination values must be positive integers.');
    error.statusCode = 400;
    throw error;
  }
  return Math.min(parsed, maximum);
}

export async function getAllErrors(query = {}) {
  const page = positiveInteger(query.page, 1, 100000);
  const limit = positiveInteger(query.limit, 20);
  const projectId = resolveProjectId(query.projectId);
  const filter = { projectId };
  if (query.service) filter.serviceName = query.service.toLowerCase();
  if (query.search) {
    const search = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ message: { $regex: search, $options: 'i' } }, { errorType: { $regex: search, $options: 'i' } }];
  }
  const [errors, total] = await Promise.all([
    ErrorRecord.find(filter).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit),
    ErrorRecord.countDocuments(filter),
  ]);
  const data = await Promise.all(errors.map(async (errorRecord) => ({
    ...errorRecord.toObject(),
    id: errorRecord._id.toString(),
    occurrenceCount: await ErrorRecord.countDocuments({
      projectId,
      serviceName: errorRecord.serviceName,
      errorType: errorRecord.errorType,
      message: errorRecord.message,
    }),
  })));
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getError(id, query = {}) {
  const errorRecord = await ErrorRecord.findOne({ _id: id, projectId: resolveProjectId(query.projectId) });
  if (!errorRecord) {
    const error = new Error('Error record not found.');
    error.statusCode = 404;
    throw error;
  }
  return errorRecord;
}

export async function addError(data) {
  validateError(data);
  // An error that references a trace belongs to that trace's project (an explicit projectId must match it).
  const projectId = data.traceId ? (await tracingService.findTraceForWrite(data.traceId, data.projectId)).projectId : resolveProjectId(data.projectId);
  return tracingService.recordError({ ...data, projectId });
}

export async function removeError(id, query = {}) {
  const errorRecord = await ErrorRecord.findOneAndDelete({ _id: id, projectId: resolveProjectId(query.projectId) });
  if (!errorRecord) {
    const error = new Error('Error record not found.');
    error.statusCode = 404;
    throw error;
  }
}
