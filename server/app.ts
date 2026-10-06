import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
    adminHandler,
    adminSession,
    backfillColors,
    backfillStatus,
    createPhoto,
    deletePhoto,
    listAdminPhotos,
    updatePhoto,
} from './adminRoutes.js';
import type { AppEnv } from './env.js';
import { type AppContext, fail } from './http.js';
import {
    getPhotoImage,
    getPhotoMetadata,
    listGeo,
    listPhotoColors,
    listPhotos,
    listTimeline,
    publicHandler,
} from './publicRoutes.js';

type MethodHandler = (c: AppContext) => Promise<Response> | Response;

function allow(handlers: Partial<Record<'GET' | 'POST' | 'PATCH' | 'DELETE', MethodHandler>>) {
    return (c: AppContext) => {
        const method = c.req.method;
        if (method === 'GET' || method === 'POST' || method === 'PATCH' || method === 'DELETE') {
            const handler = handlers[method];
            if (handler) {
                return handler(c);
            }
        }
        if (method === 'OPTIONS') {
            return c.body(null, 204);
        }
        return fail(c, 'Method not allowed.', 405);
    };
}

export const app = new Hono<AppEnv>().basePath('/api');

app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
});

app.use(
    '*',
    cors({
        origin: '*',
        allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type'],
    }),
);

app.all(
    '/photos',
    allow({
        GET: publicHandler('Failed to retrieve photos.', listPhotos),
    }),
);
app.all(
    '/photos/colors',
    allow({
        GET: publicHandler('Failed to retrieve photo colors.', listPhotoColors),
    }),
);
app.all(
    '/photos/geo',
    allow({
        GET: publicHandler('Failed to retrieve geo data.', listGeo),
    }),
);
app.all(
    '/photos/timeline',
    allow({
        GET: publicHandler('Failed to retrieve timeline data.', listTimeline),
    }),
);
app.all(
    '/photos/:id/metadata',
    allow({
        GET: publicHandler('Failed to load photo metadata.', getPhotoMetadata),
    }),
);
app.all(
    '/photos/:id/image',
    allow({
        GET: publicHandler('Failed to retrieve image asset.', getPhotoImage),
    }),
);

app.all(
    '/admin/session',
    allow({
        GET: adminHandler('Failed to verify admin session.', adminSession),
    }),
);
app.all(
    '/admin/photos',
    allow({
        GET: adminHandler('Failed to manage photos.', listAdminPhotos),
        POST: adminHandler('Failed to manage photos.', createPhoto),
    }),
);
app.all(
    '/admin/photos/:id',
    allow({
        PATCH: adminHandler('Failed to update photo metadata.', updatePhoto),
        DELETE: adminHandler('Failed to delete photo.', deletePhoto),
    }),
);
app.all(
    '/admin/backfill-colors',
    allow({
        GET: adminHandler('Failed to backfill photo colors.', backfillStatus),
        POST: adminHandler('Failed to backfill photo colors.', backfillColors),
    }),
);

app.notFound((c) => fail(c, 'Not found.', 404));

export default app;
