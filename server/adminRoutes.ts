import { desc, eq, sql } from 'drizzle-orm';
import jpeg from 'jpeg-js';
import { extractColorsFromRgba, parseColors, serializeColors } from '../shared/colors.js';
import { decodeCursor, encodeCursor } from '../shared/cursor.js';
import { type PhotoPatch, preparePhotoPatch } from '../shared/patch.js';
import { parseLimit } from '../shared/query.js';
import { buildThumbnailStorageKey, getExtensionFromType } from '../shared/urls.js';
import { requireAdmin } from './access.js';
import { createDb, type PhotoDb } from './db.js';
import { cursorSql } from './filters.js';
import { type AppContext, fail, guard } from './http.js';
import { mapPhotoDetail } from './map.js';
import { type PhotoRow, photos } from './schema.js';

const DEFAULT_BATCH = 8;
const MAX_BATCH = 20;

function noStore(c: AppContext) {
    c.header('Cache-Control', 'no-store');
}

function parseBatchSize(rawValue: string | undefined): number {
    const parsed = Number.parseInt(rawValue ?? '', 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
        return DEFAULT_BATCH;
    }
    return Math.min(parsed, MAX_BATCH);
}

function photoId(c: AppContext): string | null {
    const id = c.req.param('id');
    return id ? id : null;
}

async function findPhoto(db: PhotoDb, id: string): Promise<PhotoRow | undefined> {
    return db.select().from(photos).where(eq(photos.id, id)).limit(1).get();
}

export async function adminSession(c: AppContext): Promise<Response> {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
        return auth.response;
    }

    const redirectTo = new URL(c.req.url).searchParams.get('redirectTo');
    if (redirectTo) {
        const redirectUrl = new URL(redirectTo, new URL(c.req.url).origin);
        if (redirectUrl.origin !== new URL(c.req.url).origin) {
            return fail(c, 'Invalid redirect target.', 400);
        }
        return c.redirect(redirectUrl.toString(), 302);
    }

    noStore(c);
    return c.json({ authenticated: true, email: auth.email });
}

export async function listAdminPhotos(c: AppContext): Promise<Response> {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
        return auth.response;
    }

    const params = new URL(c.req.url).searchParams;
    const limit = parseLimit(params.get('limit'));
    const rawCursor = params.get('cursor');
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && !cursor) {
        return fail(c, 'Invalid cursor supplied.', 400);
    }
    const where = cursor ? cursorSql(cursor) : undefined;

    const db = createDb(c.env);
    const rows = await db
        .select()
        .from(photos)
        .where(where)
        .orderBy(desc(photos.takenAt), desc(photos.uploadedAt), desc(photos.id))
        .limit(limit + 1);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    noStore(c);
    return c.json({
        photos: pageRows.map(mapPhotoDetail),
        hasMore,
        nextCursor: hasMore && last ? encodeCursor(last) : null,
    });
}

function patchValues(patch: PhotoPatch): Partial<typeof photos.$inferInsert> {
    const values: Partial<typeof photos.$inferInsert> = {};
    if (patch.location !== undefined) values.location = patch.location;
    if (patch.description !== undefined) values.description = patch.description;
    if (patch.country !== undefined) values.country = patch.country;
    if (patch.state !== undefined) values.state = patch.state;
    if (patch.camera !== undefined) values.camera = patch.camera;
    if (patch.takenAt !== undefined) values.takenAt = patch.takenAt;
    if (patch.latitude !== undefined) values.latitude = patch.latitude;
    if (patch.longitude !== undefined) values.longitude = patch.longitude;
    if (patch.colors !== undefined) values.colors = patch.colors;
    return values;
}

export async function updatePhoto(c: AppContext): Promise<Response> {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
        return auth.response;
    }

    let payload: unknown;
    try {
        payload = await c.req.json();
    } catch {
        return fail(c, 'A valid JSON body is required.', 400);
    }

    const prepared = preparePhotoPatch(payload);
    if (!prepared.ok) {
        return fail(c, prepared.error, 400);
    }

    const id = photoId(c);
    if (!id) {
        return fail(c, 'Photo not found.', 404);
    }
    const db = createDb(c.env);
    const existing = await findPhoto(db, id);
    if (!existing) {
        return fail(c, 'Photo not found.', 404);
    }

    await db.update(photos).set(patchValues(prepared.patch)).where(eq(photos.id, id));
    const updated = await findPhoto(db, id);
    if (!updated) {
        return fail(c, 'Photo not found.', 404);
    }

    noStore(c);
    return c.json({
        success: true,
        message: 'Photo metadata saved.',
        photo: mapPhotoDetail(updated),
    });
}

async function deleteStoredObjects(bucket: R2Bucket, storageKey: string) {
    const keys = [storageKey];
    const thumbnailKey = buildThumbnailStorageKey(storageKey);
    if (thumbnailKey && thumbnailKey !== storageKey) {
        keys.push(thumbnailKey);
    }
    await Promise.all(
        keys.map(async (key) => {
            try {
                await bucket.delete(key);
            } catch (error) {
                console.error(`Failed to delete stored photo object ${key}:`, error);
            }
        }),
    );
}

export async function deletePhoto(c: AppContext): Promise<Response> {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
        return auth.response;
    }

    const id = photoId(c);
    if (!id) {
        return fail(c, 'Photo not found.', 404);
    }
    const db = createDb(c.env);
    const existing = await findPhoto(db, id);
    if (!existing) {
        return fail(c, 'Photo not found.', 404);
    }

    await db.delete(photos).where(eq(photos.id, id));
    await deleteStoredObjects(c.env.PHOTO_BUCKET, existing.storageKey);
    noStore(c);
    return c.json({
        success: true,
        message: 'Photo and metadata deleted.',
        photoId: id,
    });
}

export async function createPhoto(c: AppContext): Promise<Response> {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
        return auth.response;
    }

    const formData = await c.req.formData();
    const photo = formData.get('photo');
    const location = (formData.get('location') || '').toString().trim();
    const description = (formData.get('description') || '').toString().trim();
    const takenAt = (formData.get('takenAt') || '').toString().trim();
    const width = Number.parseInt((formData.get('width') || '').toString().trim(), 10);
    const height = Number.parseInt((formData.get('height') || '').toString().trim(), 10);
    const latitude = Number.parseFloat((formData.get('latitude') || '').toString().trim());
    const longitude = Number.parseFloat((formData.get('longitude') || '').toString().trim());
    const country = (formData.get('country') || '').toString().trim();
    const state = (formData.get('state') || '').toString().trim();
    const camera = (formData.get('camera') || '').toString().trim();
    const colors = serializeColors(parseColors((formData.get('colors') || '').toString()));

    if (!(photo instanceof File)) {
        return fail(c, 'A photo file is required.', 400);
    }
    if (!location) {
        return fail(c, 'Location is required.', 400);
    }

    const photoId = crypto.randomUUID();
    const contentType = photo.type || 'image/jpeg';
    const extension = getExtensionFromType(contentType);
    const storageKey = `photos/${photoId}.${extension}`;
    const uploadedAt = new Date().toISOString();
    const normalizedTakenAt = takenAt || uploadedAt;
    const normalizedWidth = Number.isFinite(width) ? width : null;
    const normalizedHeight = Number.isFinite(height) ? height : null;
    const normalizedLatitude = Number.isFinite(latitude) ? latitude : null;
    const normalizedLongitude = Number.isFinite(longitude) ? longitude : null;

    await c.env.PHOTO_BUCKET.put(storageKey, await photo.arrayBuffer(), {
        httpMetadata: { contentType },
    });

    const db = createDb(c.env);
    await db.insert(photos).values({
        id: photoId,
        storageKey,
        location,
        description,
        takenAt: normalizedTakenAt,
        uploadedAt,
        width: normalizedWidth,
        height: normalizedHeight,
        latitude: normalizedLatitude,
        longitude: normalizedLongitude,
        country,
        state,
        camera,
        colors,
    });

    return c.json(
        {
            success: true,
            photoId,
            message: 'Photo uploaded successfully.',
            photo: mapPhotoDetail({
                id: photoId,
                storageKey,
                location,
                description,
                takenAt: normalizedTakenAt,
                uploadedAt,
                width: normalizedWidth,
                height: normalizedHeight,
                latitude: normalizedLatitude,
                longitude: normalizedLongitude,
                country,
                state,
                camera,
                colors,
            }),
        },
        201,
    );
}

async function countMissingColors(db: PhotoDb): Promise<{ total: number; missing: number }> {
    const row = await db.get<{ total: number; missing: number }>(sql`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN colors IS NULL OR TRIM(colors) = '' THEN 1 ELSE 0 END) AS missing
        FROM photos
    `);
    return {
        total: Number(row?.total) || 0,
        missing: Number(row?.missing) || 0,
    };
}

export async function backfillStatus(c: AppContext): Promise<Response> {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
        return auth.response;
    }

    const url = new URL(c.req.url);
    const db = createDb(c.env);
    const counts = await countMissingColors(db);
    const payload: {
        total: number;
        missing: number;
        complete: boolean;
        photos?: { id: string }[];
    } = {
        ...counts,
        complete: counts.missing === 0,
    };

    if (url.searchParams.get('ids') === '1' && counts.missing) {
        const limit = parseBatchSize(url.searchParams.get('limit') ?? undefined);
        payload.photos = await db
            .select({ id: photos.id })
            .from(photos)
            .where(sql`${photos.colors} IS NULL OR TRIM(${photos.colors}) = ''`)
            .orderBy(desc(photos.takenAt), desc(photos.uploadedAt), desc(photos.id))
            .limit(limit);
    }

    noStore(c);
    return c.json(payload);
}

function buildSampleUrl(requestUrl: string, photoId: string): string {
    return new URL(
        `/cdn-cgi/image/width=96,height=96,fit=scale-down,quality=70,format=jpeg/api/photos/${encodeURIComponent(photoId)}/image`,
        requestUrl,
    ).toString();
}

async function fetchSampleBytes(requestUrl: string, photoId: string): Promise<Uint8Array> {
    const sampleResponse = await fetch(buildSampleUrl(requestUrl, photoId));
    if (sampleResponse.ok) {
        return new Uint8Array(await sampleResponse.arrayBuffer());
    }
    const fallback = await fetch(
        new URL(`/api/photos/${encodeURIComponent(photoId)}/image`, requestUrl),
    );
    if (!fallback.ok) {
        throw new Error(`Unable to load photo ${photoId} (${fallback.status}).`);
    }
    return new Uint8Array(await fallback.arrayBuffer());
}

export async function backfillColors(c: AppContext): Promise<Response> {
    const auth = await requireAdmin(c);
    if (!auth.ok) {
        return auth.response;
    }

    const url = new URL(c.req.url);
    const limit = parseBatchSize(url.searchParams.get('limit') ?? undefined);
    const force = url.searchParams.get('force') === '1';
    const db = createDb(c.env);
    const rows = await db
        .select({ id: photos.id })
        .from(photos)
        .where(force ? undefined : sql`${photos.colors} IS NULL OR TRIM(${photos.colors}) = ''`)
        .orderBy(desc(photos.takenAt), desc(photos.uploadedAt), desc(photos.id))
        .limit(limit);

    const processed: { id: string; colors: string[] }[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const row of rows) {
        try {
            const bytes = await fetchSampleBytes(c.req.url, row.id);
            const decoded = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 32 });
            if (!decoded?.data?.length) {
                throw new Error('JPEG decoder returned no pixel data.');
            }
            const colors = extractColorsFromRgba(decoded.data);
            await db
                .update(photos)
                .set({ colors: serializeColors(colors) })
                .where(eq(photos.id, row.id));
            processed.push({ id: row.id, colors });
        } catch (error) {
            console.error(`Failed to backfill colors for ${row.id}:`, error);
            failed.push({
                id: row.id,
                error: error instanceof Error ? error.message : 'Color extraction failed.',
            });
        }
    }

    const counts = await countMissingColors(db);
    noStore(c);
    return c.json({
        processed,
        failed,
        remaining: counts.missing,
        total: counts.total,
        complete: counts.missing === 0,
    });
}

export function adminHandler(message: string, fn: (c: AppContext) => Promise<Response>) {
    return (c: AppContext) => guard(c, message, () => fn(c));
}
