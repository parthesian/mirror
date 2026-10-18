export function buildImageUrl(id: string, variant: 'full' | 'thumb' = 'full'): string {
    const basePath = `/api/photos/${encodeURIComponent(id)}/image`;
    if (variant === 'thumb') {
        return `/cdn-cgi/image/width=640,height=640,fit=scale-down,quality=82,format=auto${basePath}`;
    }
    return basePath;
}

export function buildThumbnailStorageKey(storageKey = ''): string {
    if (!storageKey) {
        return '';
    }

    const extensionIndex = storageKey.lastIndexOf('.');
    if (extensionIndex === -1) {
        return `${storageKey}.thumb`;
    }

    return `${storageKey.slice(0, extensionIndex)}.thumb${storageKey.slice(extensionIndex)}`;
}

export function getExtensionFromType(contentType = ''): string {
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
