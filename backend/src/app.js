import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import healthRoutes from './routes/healthRoutes.js';
import serviceRoutes from './routes/serviceRoutes.js';
import traceRoutes from './routes/traceRoutes.js';
import spanRoutes from './routes/spanRoutes.js';
import errorRoutes from './routes/errorRoutes.js';
import performanceRoutes from './routes/performanceRoutes.js';
import serviceMapRoutes from './routes/serviceMapRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import telemetryRoutes from './routes/telemetryRoutes.js';
import env from './config/env.js';
import tracingMiddleware from './middleware/tracingMiddleware.js';
import { errorMiddleware } from './middleware/errorMiddleware.js';
import { notFoundMiddleware } from './middleware/notFoundMiddleware.js';

const app = express();

app.use(cors({ origin: env.corsOrigins, exposedHeaders: ['x-trace-id', 'x-span-id'] }));
app.use(tracingMiddleware); // before body parsing + routes so timing covers the whole request
app.use(express.json({ limit: '1mb' })); // telemetry batches can be larger than the 100kb default
app.use(morgan('dev'));

app.use('/api/health', healthRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/traces', traceRoutes);
app.use('/api/spans', spanRoutes);
app.use('/api/errors', errorRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/service-map', serviceMapRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/telemetry', telemetryRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
