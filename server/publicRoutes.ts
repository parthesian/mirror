import { and, asc, desc, sql } from 'drizzle-orm';
import { mapColorFacets } from '../shared/colors.js';
import { encodeCursor } from '../shared/cursor.js';
import { readPhotoQuery } from '../shared/query.js';
import { createDb } from './db.js';
import { cursorSql, photoFilterSql } from './filters.js';
import { type AppContext, fail, guard } from './http.js';
import { mapPhotoDetail, mapPhotoListItem } from './map.js';
import { photos } from './schema.js';

function cache(c: AppContext, value: string) {
    c.header('Cache-Control', value);
    c.header('Vary', 'Accept-Encoding');
}

function defaultCache(): Cache | null {
    if (typeof caches === 'undefined') {
        return null;
    }
    return caches.default;
}

export async function listPhotos(c: AppContext): Promise<Response> {
    const read = readPhotoQuery(new URL(c.req.url).searchParams);
    if (!read.ok) {
        return fail(c, read.error, 400);
    }

    const db = createDb(c.env);
    const where = and(
        photoFilterSql(read.query.filters),
        read.query.cursor ? cursorSql(read.query.cursor) : undefined,
    );
    const rows = await db
        .select({
            id: photos.id,
            takenAt: photos.takenAt,
            uploadedAt: photos.uploadedAt,
            width: photos.width,
            height: photos.height,
        })
        .from(photos)
        .where(where)
        .orderBy(desc(photos.takenAt), desc(photos.uploadedAt), desc(photos.id))
        .limit(read.query.limit + 1);

    const hasMore = rows.length > read.query.limit;
    const pageRows = hasMore ? rows.slice(0, read.query.limit) : rows;
    const last = pageRows[pageRows.length - 1];
    cache(c, 'public, s-maxage=60, max-age=10');
    return c.json({
        photos: pageRows.map(mapPhotoListItem),
        hasMore,
        nextCursor: hasMore && last ? encodeCursor(last) : null,
    });
}

export async function listPhotoColors(c: AppContext): Promise<Response> {
    const read = readPhotoQuery(new URL(c.req.url).searchParams);
    if (!read.ok) {
        return fail(c, read.error, 400);
    }

    const filters = { ...read.query.filters, color: '' as const };
    const filterSql = photoFilterSql(filters);
    const where = filterSql
        ? sql`${sql`TRIM(json_each.value) != ''`} AND ${filterSql}`
        : sql`TRIM(json_each.value) != ''`;

    const db = createDb(c.env);
    const rows = await db.all<{ color: string; count: number }>(sql`
        SELECT LOWER(TRIM(json_each.value)) AS color, COUNT(*) AS count
        FROM photos, json_each(
            CASE
                WHEN photos.colors IS NULL OR TRIM(photos.colors) = '' THEN '[]'
                ELSE photos.colors
            END
        )
        WHERE ${where}
        GROUP BY LOWER(TRIM(json_each.value))
    `);

    cache(c, 'public, s-maxage=60, max-age=15');
    return c.json({ colors: mapColorFacets(rows) });
}

export async function listGeo(c: AppContext): Promise<Response> {
    const db = createDb(c.env);
    const rows = await db
        .select({
            id: photos.id,
            latitude: photos.latitude,
            longitude: photos.longitude,
            country: photos.country,
            state: photos.state,
            location: photos.location,
            takenAt: photos.takenAt,
        })
        .from(photos)
        .where(sql`${photos.latitude} IS NOT NULL AND ${photos.longitude} IS NOT NULL`)
        .orderBy(asc(photos.takenAt), asc(photos.uploadedAt), asc(photos.id));

    cache(c, 'public, s-maxage=600, max-age=120');
    return c.json({
        locations: rows.map((row) => ({
            id: row.id,
            latitude: row.latitude,
            longitude: row.longitude,
            country: row.country ?? '',
            state: row.state ?? '',
            location: row.location ?? '',
            takenAt: row.takenAt,
        })),
    });
}

export async function listTimeline(c: AppContext): Promise<Response> {
    const read = readPhotoQuery(new URL(c.req.url).searchParams);
    if (!read.ok) {
        return fail(c, read.error, 400);
    }

    const year = sql<number>`CAST(strftime('%Y', ${photos.takenAt}) AS INTEGER)`;
    const month = sql<number>`CAST(strftime('%m', ${photos.takenAt}) AS INTEGER)`;
    const count = sql<number>`COUNT(*)`;
    const db = createDb(c.env);
    const groups = await db
        .select({ year, month, count })
        .from(photos)
        .where(photoFilterSql(read.query.filters))
        .groupBy(sql`strftime('%Y', ${photos.takenAt})`, sql`strftime('%m', ${photos.takenAt})`)
        .orderBy(desc(year), desc(month));

    cache(c, 'public, s-maxage=300, max-age=60');
    return c.json({ groups });
}

export async function getPhotoMetadata(c: AppContext): Promise<Response> {
    const db = createDb(c.env);
    const row = await db
        .select()
        .from(photos)
        .where(sql`${photos.id} = ${c.req.param('id')}`)
        .limit(1)
        .get();
    if (!row) {
        return fail(c, 'Photo not found.', 404);
    }
    cache(c, 'public, s-maxage=3600, max-age=300');
    return c.json(mapPhotoDetail(row));
}

export async function getPhotoImage(c: AppContext): Promise<Response> {
    const cacheStore = defaultCache();
    const cacheKey = new Request(c.req.url, c.req.raw);
    if (cacheStore) {
        const cached = await cacheStore.match(cacheKey);
        if (cached) {
            return cached;
        }
    }

    const db = createDb(c.env);
    const row = await db
        .select({ storageKey: photos.storageKey })
        .from(photos)
        .where(sql`${photos.id} = ${c.req.param('id')}`)
        .limit(1)
        .get();
    if (!row) {
        return fail(c, 'Photo not found.', 404);
    }

    const object = await c.env.PHOTO_BUCKET.get(row.storageKey);
    if (!object) {
        return fail(c, 'Photo asset not found.', 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    const response = new Response(object.body, { headers });
    if (cacheStore) {
        try {
            c.executionCtx.waitUntil(cacheStore.put(cacheKey, response.clone()));
        } catch (error) {
            console.error('Skipped photo image cache write', error);
        }
    }
    return response;
}

export function publicHandler(message: string, fn: (c: AppContext) => Promise<Response>) {
    return (c: AppContext) => guard(c, message, () => fn(c));
}
