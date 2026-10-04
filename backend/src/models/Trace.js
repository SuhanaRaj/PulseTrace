import mongoose from 'mongoose';
import { isValidProjectId } from '../config/projects.js';

const traceSchema = new mongoose.Schema({
  projectId: {
    type: String,
    required: true,
    trim: true,
    validate: { validator: isValidProjectId, message: 'Unknown projectId.' },
  },
  traceId: {
    type: String,
    required: true,
    trim: true,
    unique: true,
  },
  rootService: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  route: {
    type: String,
    required: true,
    trim: true,
  },
  method: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
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
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

traceSchema.index({ projectId: 1, timestamp: -1 });
traceSchema.index({ timestamp: -1 });
traceSchema.index({ status: 1 });

export default mongoose.model('Trace', traceSchema);
