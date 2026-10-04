import mongoose from 'mongoose';
import { isValidProjectId } from '../config/projects.js';

const spanSchema = new mongoose.Schema({
  projectId: {
    type: String,
    required: true,
    trim: true,
    validate: { validator: isValidProjectId, message: 'Unknown projectId.' },
  },
  spanId: {
    type: String,
    required: true,
    trim: true,
    unique: true,
  },
  traceId: {
    type: String,
    required: true,
    trim: true,
  },
  parentSpanId: {
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
  operation: {
    type: String,
    required: true,
    trim: true,
  },
  duration: {
    type: Number,
    required: true,
    min: 0,
  },
  status: {
    type: String,
    required: true,
    enum: ['success', 'error'],
  },
  startTime: {
    type: Date,
    required: true,
  },
  endTime: {
    type: Date,
    required: true,
  },
});

spanSchema.index({ projectId: 1, traceId: 1 });
spanSchema.index({ traceId: 1 });
spanSchema.index({ serviceName: 1 });
spanSchema.index({ parentSpanId: 1 });

export default mongoose.model('Span', spanSchema);
