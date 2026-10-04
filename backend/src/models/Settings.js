import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    default: 'default',
  },
  workspaceName: {
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: 80,
    default: 'PulseTrace Workspace',
  },
  environment: {
    type: String,
    required: true,
    enum: ['production', 'staging', 'development'],
    default: 'development',
  },
  theme: {
    type: String,
    required: true,
    enum: ['dark', 'system'],
    default: 'dark',
  },
  errorNotifications: {
    type: Boolean,
    default: true,
  },
  refreshInterval: {
    type: Number,
    min: 1000,
    max: 60000,
    default: 5000,
  },
  liveUpdates: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

export default mongoose.model('Settings', settingsSchema);
