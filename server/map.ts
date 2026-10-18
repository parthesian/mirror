import { parseColors } from '../shared/colors.js';
import type { PhotoDetail, PhotoListItem } from '../shared/schemas.js';
import { buildImageUrl } from '../shared/urls.js';
import type { PhotoRow } from './schema.js';

function size(value: number | null): number | null {
    return value ?? null;
}

export function mapPhotoListItem(
    row: Pick<PhotoRow, 'id' | 'takenAt' | 'uploadedAt' | 'width' | 'height'>,
): PhotoListItem {
    return {
        id: row.id,
        takenAt: row.takenAt,
        uploadedAt: row.uploadedAt,
        width: size(row.width),
        height: size(row.height),
    };
}

export function mapPhotoDetail(row: PhotoRow): PhotoDetail {
    const width = size(row.width);
    const height = size(row.height);
    return {
        id: row.id,
        location: row.location,
        description: row.description ?? '',
        takenAt: row.takenAt,
        uploadedAt: row.uploadedAt,
        width,
        height,
        latitude: row.latitude ?? null,
        longitude: row.longitude ?? null,
        country: row.country ?? '',
        state: row.state ?? '',
        camera: row.camera ?? '',
        colors: parseColors(row.colors),
        storageKey: row.storageKey,
        image: {
            url: buildImageUrl(row.id, 'full'),
            width,
            height,
        },
        thumbnail: {
            url: buildImageUrl(row.id, 'thumb'),
            width,
            height,
        },
    };
}
