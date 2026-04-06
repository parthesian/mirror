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

        return parsed;
    } catch {
        return null;
    }
}

export function buildImageUrl(id, variant = 'full') {
    const url = new URL(`/api/photos/${id}/image`, 'https://gallery.invalid');
    url.searchParams.set('variant', variant);
    return `${url.pathname}${url.search}`;
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
