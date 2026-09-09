import { colorMatchSql, parseColors } from './colors.js';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

export const PHOTO_DETAIL_COLUMNS = `
    id, storage_key, location, description, taken_at, uploaded_at, width, height,
    latitude, longitude, country, state, camera, colors
`;

export function parseLimit(rawValue) {
    const parsed = Number.parseInt(rawValue, 10);

    if (Number.isNaN(parsed) || parsed <= 0) {
        return DEFAULT_LIMIT;
    }

    return Math.min(parsed, MAX_LIMIT);
}

export function encodeCursor(record) {
    return btoa(JSON.stringify({
        takenAt: record.taken_at,
        uploadedAt: record.uploaded_at,
        id: record.id
    }));
}

export function decodeCursor(rawCursor) {
    if (!rawCursor) {
        return null;
    }

    try {
        const parsed = JSON.parse(atob(rawCursor));
        if (!parsed.takenAt || !parsed.id) {
            return null;
        }
        // Fall back to takenAt for cursors generated before uploadedAt was added
        if (!parsed.uploadedAt) {
            parsed.uploadedAt = parsed.takenAt;
        }

        return parsed;
    } catch {
        return null;
    }
}

export function buildImageUrl(id, variant = 'full') {
    const basePath = `/api/photos/${encodeURIComponent(id)}/image`;
    if (variant === 'thumb') {
        return `/cdn-cgi/image/width=640,height=640,fit=scale-down,quality=82,format=auto${basePath}`;
    }
    return basePath;
}

export function buildThumbnailStorageKey(storageKey = '') {
    if (!storageKey) {
        return '';
    }

    const extensionIndex = storageKey.lastIndexOf('.');
    if (extensionIndex === -1) {
        return `${storageKey}.thumb`;
    }

    return `${storageKey.slice(0, extensionIndex)}.thumb${storageKey.slice(extensionIndex)}`;
}

/**
 * Minimal row for gallery list pagination: sorting keys, display date, and
 * intrinsic size. Thumbnail/full URLs are derived on the client from `id`.
 * Width/height ride along because the masonry layout needs a real aspect
 * ratio before the image bytes arrive.
 */
export function mapPhotoListRecord(record) {
    return {
        id: record.id,
        takenAt: record.taken_at,
        uploadedAt: record.uploaded_at,
        width: record.width ?? null,
        height: record.height ?? null
    };
}

export function mapPhotoRecord(record) {
    return {
        id: record.id,
        location: record.location,
        description: record.description || '',
        takenAt: record.taken_at,
        uploadedAt: record.uploaded_at,
        width: record.width,
        height: record.height,
        latitude: record.latitude ?? null,
        longitude: record.longitude ?? null,
        country: record.country || '',
        state: record.state || '',
        camera: record.camera || '',
        colors: parseColors(record.colors),
        storageKey: record.storage_key,
        image: {
            url: buildImageUrl(record.id, 'full'),
            width: record.width,
            height: record.height
        },
        thumbnail: {
            url: buildImageUrl(record.id, 'thumb'),
            width: record.width,
            height: record.height
        }
    };
}

export function getExtensionFromType(contentType = '') {
    const normalized = contentType.toLowerCase();

    if (normalized.includes('png')) {
        return 'png';
    }

    if (normalized.includes('webp')) {
        return 'webp';
    }

    if (normalized.includes('gif')) {
        return 'gif';
    }

    return 'jpg';
}

export function collectPhotoFilters(searchParams) {
    return {
        country: searchParams.get('country') || '',
        state: searchParams.get('state') || '',
        location: searchParams.get('location') || '',
        color: searchParams.get('color') || '',
        takenFrom: searchParams.get('takenFrom') || '',
        takenTo: searchParams.get('takenTo') || ''
    };
}

export function buildPhotoFilterClause(filters = {}) {
    const clauses = [];
    const bindings = [];

    if (filters.country) {
        clauses.push('LOWER(TRIM(country)) = LOWER(TRIM(?))');
        bindings.push(filters.country);
    }
    if (filters.state) {
        clauses.push('LOWER(TRIM(state)) = LOWER(TRIM(?))');
        bindings.push(filters.state);
    }
    if (filters.location) {
        clauses.push('LOWER(TRIM(location)) = LOWER(TRIM(?))');
        bindings.push(filters.location);
    }
    if (filters.color) {
        clauses.push(colorMatchSql());
        bindings.push(filters.color);
    }
    if (filters.takenFrom) {
        clauses.push('taken_at >= ?');
        bindings.push(filters.takenFrom);
    }
    if (filters.takenTo) {
        clauses.push('taken_at <= ?');
        bindings.push(filters.takenTo);
    }

    return {
        clauses,
        bindings,
        whereClause: clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    };
}
