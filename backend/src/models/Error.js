import mongoose from 'mongoose';
import { isValidProjectId } from '../config/projects.js';

const errorSchema = new mongoose.Schema({
  projectId: {
    type: String,
    required: true,
    trim: true,
    validate: { validator: isValidProjectId, message: 'Unknown projectId.' },
  },
  traceId: {
    type: String,
    trim: true,
    default: null,
  },
  serviceName: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  errorType: {
    type: String,
    required: true,
    trim: true,
  },
  message: {
    type: String,
    required: true,
    trim: true,
  },
  stackTrace: {
    type: String,
    default: null,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

errorSchema.index({ projectId: 1, timestamp: -1 });
errorSchema.index({ traceId: 1 });
errorSchema.index({ serviceName: 1 });
errorSchema.index({ timestamp: -1 });

export default mongoose.model('ErrorRecord', errorSchema, 'errors');
