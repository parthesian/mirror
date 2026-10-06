import { handle } from 'hono/cloudflare-pages';
import { app } from '../../server/app.js';

export const onRequest = handle(app);
