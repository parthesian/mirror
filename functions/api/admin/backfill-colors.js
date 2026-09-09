import jpeg from 'jpeg-js';
import { requireAdmin } from '../../_lib/access.js';
import { extractColorsFromRgba, serializeColors } from '../../_lib/colors.js';
import { errorResponse, handleOptions, json } from '../../_lib/http.js';

const DEFAULT_BATCH = 8;
const MAX_BATCH = 20;

function parseBatchSize(rawValue) {
    const parsed = Number.parseInt(rawValue, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
        return DEFAULT_BATCH;
    }
    return Math.min(parsed, MAX_BATCH);
}

function buildSampleUrl(request, photoId) {
    return new URL(
        `/cdn-cgi/image/width=96,height=96,fit=scale-down,quality=70,format=jpeg/api/photos/${encodeURIComponent(photoId)}/image`,
        request.url
    );
}

function buildFallbackUrl(request, photoId) {
    return new URL(`/api/photos/${encodeURIComponent(photoId)}/image`, request.url);
}

async function fetchSampleBytes(request, photoId) {
    const sampleResponse = await fetch(buildSampleUrl(request, photoId).toString());
    if (sampleResponse.ok) {
        return new Uint8Array(await sampleResponse.arrayBuffer());
    }

    const fallbackResponse = await fetch(buildFallbackUrl(request, photoId).toString());
    if (!fallbackResponse.ok) {
        throw new Error(`Unable to load photo ${photoId} (${fallbackResponse.status}).`);
    }
    return new Uint8Array(await fallbackResponse.arrayBuffer());
}

function extractColorsFromJpegBytes(bytes) {
    const decoded = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 32 });
    if (!decoded?.data?.length) {
        throw new Error('JPEG decoder returned no pixel data.');
    }
    return extractColorsFromRgba(decoded.data);
}

async function countMissingColors(env) {
    const row = await env.PHOTO_DB.prepare(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN colors IS NULL OR TRIM(colors) = '' THEN 1 ELSE 0 END) AS missing
        FROM photos
    `).first();

    return {
        total: Number(row?.total) || 0,
        missing: Number(row?.missing) || 0
    };
}

async function getBackfillStatus(context) {
    const { request, env } = context;
    const auth = await requireAdmin(request, env);
    if (!auth.ok) {
        return auth.response;
    }

    const url = new URL(request.url);
    const counts = await countMissingColors(env);
    const includeIds = url.searchParams.get('ids') === '1';
    const payload = {
        ...counts,
        complete: counts.missing === 0
    };

    if (includeIds && counts.missing) {
        const limit = parseBatchSize(url.searchParams.get('limit'));
        const listing = await env.PHOTO_DB.prepare(`
            SELECT id
            FROM photos
            WHERE colors IS NULL OR TRIM(colors) = ''
            ORDER BY taken_at DESC, uploaded_at DESC, id DESC
            LIMIT ?
        `).bind(limit).all();
        payload.photos = Array.isArray(listing.results) ? listing.results : [];
    }

    return json(payload, {
        headers: { 'Cache-Control': 'no-store' }
    });
}

async function backfillColors(context) {
    const { request, env } = context;
    const auth = await requireAdmin(request, env);
    if (!auth.ok) {
        return auth.response;
    }

    const url = new URL(request.url);
    const limit = parseBatchSize(url.searchParams.get('limit'));
    const force = url.searchParams.get('force') === '1';

    const listing = await env.PHOTO_DB.prepare(`
        SELECT id
        FROM photos
        ${force ? '' : "WHERE colors IS NULL OR TRIM(colors) = ''"}
        ORDER BY taken_at DESC, uploaded_at DESC, id DESC
        LIMIT ?
    `).bind(limit).all();

    const rows = Array.isArray(listing.results) ? listing.results : [];
    const processed = [];
    const failed = [];

    for (const row of rows) {
        try {
            const bytes = await fetchSampleBytes(request, row.id);
            const colors = extractColorsFromJpegBytes(bytes);
            const serialized = serializeColors(colors);
            await env.PHOTO_DB.prepare(`
                UPDATE photos SET colors = ? WHERE id = ?
            `).bind(serialized, row.id).run();
            processed.push({ id: row.id, colors });
        } catch (error) {
            console.error(`Failed to backfill colors for ${row.id}:`, error);
            failed.push({
                id: row.id,
                error: error.message || 'Color extraction failed.'
            });
        }
    }

    const counts = await countMissingColors(env);
    return json({
        processed,
        failed,
        remaining: counts.missing,
        total: counts.total,
        complete: counts.missing === 0
    }, {
        headers: { 'Cache-Control': 'no-store' }
    });
}

export async function onRequest(context) {
    try {
        switch (context.request.method) {
            case 'GET':
                return await getBackfillStatus(context);
            case 'POST':
                return await backfillColors(context);
            case 'OPTIONS':
                return handleOptions();
            default:
                return errorResponse('Method not allowed.', 405);
        }
    } catch (error) {
        console.error('Failed to backfill photo colors:', error);
        return errorResponse('Failed to backfill photo colors.', 500, error.message);
    }
}
