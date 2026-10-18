import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { app } from '../../server/app.js';
import type { Bindings } from '../../server/env.js';
import { photoDetailSchema, photoListItemSchema } from '../../shared/schemas.js';
import { openTestDb } from '../helpers/sqliteD1.js';

const listSchema = z.object({
    photos: z.array(photoListItemSchema),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
});

const colorFacetSchema = z.object({
    colors: z.array(
        z.object({
            value: z.string(),
            count: z.number(),
        }),
    ),
});

const OWNER = 'owner@example.com';

function memoryBucket() {
    const objects = new Map<string, { body: ArrayBuffer; contentType: string }>();
    return {
        objects,
        async put(
            key: string,
            value: ArrayBuffer | ArrayBufferView,
            options?: { httpMetadata?: { contentType?: string } },
        ) {
            const view =
                value instanceof ArrayBuffer
                    ? new Uint8Array(value)
                    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
            const copy = new Uint8Array(view.byteLength);
            copy.set(view);
            objects.set(key, {
                body: copy.buffer,
                contentType: options?.httpMetadata?.contentType ?? 'application/octet-stream',
            });
        },
        async get(key: string) {
            const found = objects.get(key);
            if (!found) {
                return null;
            }
            return {
                body: found.body,
                writeHttpMetadata(headers: Headers) {
                    headers.set('content-type', found.contentType);
                },
            };
        },
        async delete(key: string) {
            objects.delete(key);
        },
    };
}

function bindEnv(): { env: Bindings; bucket: ReturnType<typeof memoryBucket> } {
    const { d1 } = openTestDb();
    const bucket = memoryBucket();
    const env: Bindings = {
        PHOTO_DB: d1,
        PHOTO_BUCKET: bucket as unknown as Bindings['PHOTO_BUCKET'],
        ADMIN_EMAIL_ALLOWLIST: OWNER,
    };
    return { env, bucket };
}

function adminHeaders(): HeadersInit {
    return { 'cf-access-authenticated-user-email': OWNER };
}

describe('photo API', () => {
    it('pages the public list in taken-at order and filters by color', async () => {
        const { env } = bindEnv();
        const older = await upload(env, {
            location: 'Kyoto',
            takenAt: '2020-01-01T00:00:00.000Z',
            colors: '["blue"]',
        });
        const newer = await upload(env, {
            location: 'Paris',
            takenAt: '2022-01-01T00:00:00.000Z',
            colors: '["red"]',
        });

        const first = await app.request('/api/photos?limit=1', {}, env);
        expect(first.status).toBe(200);
        const firstBody = listSchema.parse(await first.json());
        expect(firstBody.photos.map((photo) => photo.id)).toEqual([newer]);
        expect(firstBody.hasMore).toBe(true);
        expect(firstBody.nextCursor).toBeTruthy();

        const second = await app.request(
            `/api/photos?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? '')}`,
            {},
            env,
        );
        const secondBody = listSchema.parse(await second.json());
        expect(secondBody.photos.map((photo) => photo.id)).toEqual([older]);
        expect(secondBody.hasMore).toBe(false);

        const blue = await app.request('/api/photos?color=blue', {}, env);
        const blueBody = listSchema.parse(await blue.json());
        expect(blueBody.photos.map((photo) => photo.id)).toEqual([older]);

        const bad = await app.request('/api/photos?cursor=not-a-cursor', {}, env);
        expect(bad.status).toBe(400);
    });

    it('returns color facets without applying the selected color', async () => {
        const { env } = bindEnv();
        await upload(env, {
            location: 'Kyoto',
            takenAt: '2020-01-01T00:00:00.000Z',
            colors: '["blue","green"]',
        });
        await upload(env, {
            location: 'Paris',
            takenAt: '2021-01-01T00:00:00.000Z',
            colors: '["red"]',
        });
        const response = await app.request('/api/photos/colors?color=blue', {}, env);
        expect(response.status).toBe(200);
        const body = colorFacetSchema.parse(await response.json());
        expect(body.colors.map((color) => color.value)).toEqual(['red', 'green', 'blue']);
    });

    it('rejects an anonymous admin call and saves a metadata patch', async () => {
        const { env } = bindEnv();
        const id = await upload(env, {
            location: 'Kyoto',
            takenAt: '2020-06-01T00:00:00.000Z',
            colors: '[]',
        });
        const denied = await app.request('/api/admin/photos', {}, env);
        expect(denied.status).toBe(401);

        const saved = await app.request(
            `/api/admin/photos/${id}`,
            {
                method: 'PATCH',
                headers: { ...adminHeaders(), 'content-type': 'application/json' },
                body: JSON.stringify({ location: 'Tokyo', takenAt: '2020-06-02' }),
            },
            env,
        );
        expect(saved.status).toBe(200);
        const body = z
            .object({
                photo: z.object({ location: z.string(), takenAt: z.string() }),
            })
            .parse(await saved.json());
        expect(body.photo.location).toBe('Tokyo');
        expect(body.photo.takenAt).toBe('2020-06-02T12:00:00.000Z');

        const metadata = await app.request(`/api/photos/${id}/metadata`, {}, env);
        const detail = photoDetailSchema.parse(await metadata.json());
        expect(detail.thumbnail.url).toContain('format=auto');
    });

    it('deletes the row and the stored object', async () => {
        const { env, bucket } = bindEnv();
        const id = await upload(env, {
            location: 'Rome',
            takenAt: '2019-01-01T00:00:00.000Z',
            colors: '[]',
        });
        expect(bucket.objects.size).toBe(1);
        const removed = await app.request(
            `/api/admin/photos/${id}`,
            {
                method: 'DELETE',
                headers: adminHeaders(),
            },
            env,
        );
        expect(removed.status).toBe(200);
        expect(bucket.objects.size).toBe(0);
        const missing = await app.request(`/api/photos/${id}/metadata`, {}, env);
        expect(missing.status).toBe(404);
    });

    it('serves the timeline, the geo index, and the stored bytes', async () => {
        const { env } = bindEnv();
        const id = await upload(env, {
            location: 'Rome',
            takenAt: '2019-03-04T00:00:00.000Z',
            colors: '[]',
        });
        const saved = await app.request(
            `/api/admin/photos/${id}`,
            {
                method: 'PATCH',
                headers: { ...adminHeaders(), 'content-type': 'application/json' },
                body: JSON.stringify({ latitude: 41.9, longitude: 12.5 }),
            },
            env,
        );
        expect(saved.status).toBe(200);

        const timeline = z
            .object({
                groups: z.array(
                    z.object({ year: z.number(), month: z.number(), count: z.number() }),
                ),
            })
            .parse(await (await app.request('/api/photos/timeline', {}, env)).json());
        expect(timeline.groups).toEqual([{ year: 2019, month: 3, count: 1 }]);

        const geo = z
            .object({
                locations: z.array(
                    z.object({ id: z.string(), latitude: z.number(), longitude: z.number() }),
                ),
            })
            .parse(await (await app.request('/api/photos/geo', {}, env)).json());
        expect(geo.locations).toEqual([{ id, latitude: 41.9, longitude: 12.5 }]);

        const image = await app.request(`/api/photos/${id}/image`, {}, env);
        expect(image.status).toBe(200);
        expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

        const denied = await app.request('/api/photos/geo', { method: 'POST' }, env);
        expect(denied.status).toBe(405);
    });

    it('rejects an unknown color with 400', async () => {
        const { env } = bindEnv();
        const response = await app.request('/api/photos?color=navy', {}, env);
        expect(response.status).toBe(400);
        expect(
            z.object({ error: z.literal('Unknown color.') }).parse(await response.json()),
        ).toEqual({ error: 'Unknown color.' });
    });

    it('returns stored bytes when the image cache cannot be scheduled', async () => {
        const puts: string[] = [];
        vi.stubGlobal('caches', {
            default: {
                async match() {
                    return undefined;
                },
                async put(request: Request) {
                    puts.push(request.url);
                },
            },
        });
        try {
            const { env } = bindEnv();
            const id = await upload(env, {
                location: 'Lisbon',
                takenAt: '2018-01-02T00:00:00.000Z',
                colors: '[]',
            });
            const image = await app.request(`/api/photos/${id}/image`, {}, env);
            expect(image.status).toBe(200);
            expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
            expect(puts).toEqual([]);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

async function upload(
    env: Bindings,
    fields: { location: string; takenAt: string; colors: string },
): Promise<string> {
    const form = new FormData();
    form.set('photo', new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' }));
    form.set('location', fields.location);
    form.set('takenAt', fields.takenAt);
    form.set('colors', fields.colors);
    const response = await app.request(
        '/api/admin/photos',
        {
            method: 'POST',
            headers: adminHeaders(),
            body: form,
        },
        env,
    );
    expect(response.status).toBe(201);
    const body = z.object({ photoId: z.string() }).parse(await response.json());
    return body.photoId;
}
