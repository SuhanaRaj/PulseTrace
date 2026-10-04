import mongoose from 'mongoose';
import env from './env.js';

mongoose.set('bufferCommands', false);

export async function connectDatabase() {
  try {
    await mongoose.connect(env.mongoDbUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('MongoDB connected successfully.');
    return true;
  } catch (error) {
    console.error('MongoDB connection unavailable:', error.message);
    return false;
  }
}

mongoose.connection.on('error', (error) => {
  console.error('MongoDB connection error:', error.message);
});

export function isDatabaseConnected() {
  return mongoose.connection.readyState === 1;
}

export function disconnectDatabase() {
  return mongoose.disconnect();
}
