import express from 'express';
import helmet from 'helmet';
import { authRouter } from './auth/routes.js';
import { packagerRouter } from './packagers/routes.js';
import { walletRouter } from './wallets/routes.js';
import { bookingRouter } from './bookings/routes.js';
import { dashboardRouter } from './dashboard/routes.js';
import { financeRouter } from './finance/routes.js';
import { reportRouter } from './reports/routes.js';
import { getPrisma } from './database/prisma.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { requestId } from './middleware/request-id.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(requestId);
app.use(express.json({ limit: '64kb' }));

app.get('/health', (_request, response) => response.json({ status: 'ok' }));
app.get('/api/v1/health', (_request, response) => response.json({ status: 'ok' }));
app.get('/ready', async (_request, response) => {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    response.json({ status: 'ready' });
  } catch {
    response.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable', request_id: response.locals.requestId } });
  }
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/packagers', packagerRouter);
app.use('/api/v1/wallets', walletRouter);
app.use('/api/v1/bookings', bookingRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1', financeRouter);
app.use('/api/v1/reports', reportRouter);

app.use(notFound);
app.use(errorHandler);
