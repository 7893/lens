import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ApiBindings } from '@lens/shared';
import search from '../routes/search';
import images from '../routes/images';
import stats from '../routes/stats';
import suggest from '../routes/suggest';
import admin from '../routes/admin';

export const app = new Hono<{ Bindings: ApiBindings }>();

// Middleware
app.use(
  '/*',
  cors({ origin: ['https://lens.53.workers.dev', 'http://localhost:5173'], allowMethods: ['GET', 'POST'] }),
);

// Health check
app.get('/health', (c) => c.json({ status: 'healthy', name: 'lens' }));

// Routes
app.route('/api/search', search);
app.route('/api/stats', stats);
app.route('/api/images', images);
app.route('/api/suggest', suggest);
app.route('/api/admin', admin);

// Direct Image Alias
app.route('/image', images);
