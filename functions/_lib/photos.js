const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

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
        return `/cdn-cgi/image/width=640,height=640,fit=scale-down,quality=82${basePath}`;
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
 * Minimal row for gallery list pagination: sorting keys + display date only.
 * Thumbnail/full URLs are derived on the client from `id`.
 */
export function mapPhotoListRecord(record) {
    return {
        id: record.id,
        takenAt: record.taken_at,
        uploadedAt: record.uploaded_at
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
