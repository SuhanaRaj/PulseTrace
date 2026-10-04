import mongoose from 'mongoose';
import { isValidProjectId } from '../config/projects.js';

const serviceSchema = new mongoose.Schema(
  {
    projectId: {
      type: String,
      required: true,
      trim: true,
      validate: { validator: isValidProjectId, message: 'Unknown projectId.' },
    },
    name: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    environment: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['healthy', 'degraded', 'down'],
      default: 'healthy',
    },
  },
  { timestamps: true },
);

// A service name is unique WITHIN a project (e.g. both projects may have a "database" service).
serviceSchema.index({ projectId: 1, name: 1 }, { unique: true });
serviceSchema.index({ environment: 1 });

export default mongoose.model('Service', serviceSchema);
