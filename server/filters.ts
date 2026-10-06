import { and, type SQL, sql } from 'drizzle-orm';
import type { PhotoCursor } from '../shared/cursor.js';
import type { PhotoFilters } from '../shared/schemas.js';
import { photos } from './schema.js';

export function photoFilterSql(filters: PhotoFilters): SQL | undefined {
    const parts: SQL[] = [];
    if (filters.country) {
        parts.push(sql`LOWER(TRIM(${photos.country})) = LOWER(TRIM(${filters.country}))`);
    }
    if (filters.state) {
        parts.push(sql`LOWER(TRIM(${photos.state})) = LOWER(TRIM(${filters.state}))`);
    }
    if (filters.location) {
        parts.push(sql`LOWER(TRIM(${photos.location})) = LOWER(TRIM(${filters.location}))`);
    }
    if (filters.color) {
        parts.push(sql`EXISTS (
            SELECT 1 FROM json_each(
                CASE
                    WHEN ${photos.colors} IS NULL OR TRIM(${photos.colors}) = '' THEN '[]'
                    ELSE ${photos.colors}
                END
            )
            WHERE LOWER(TRIM(json_each.value)) = LOWER(TRIM(${filters.color}))
        )`);
    }
    if (filters.takenFrom) {
        parts.push(sql`${photos.takenAt} >= ${filters.takenFrom}`);
    }
    if (filters.takenTo) {
        parts.push(sql`${photos.takenAt} <= ${filters.takenTo}`);
    }
    if (!parts.length) {
        return undefined;
    }
    return and(...parts);
}

export function cursorSql(cursor: PhotoCursor): SQL {
    return sql`(
        ${photos.takenAt} < ${cursor.takenAt}
        OR (${photos.takenAt} = ${cursor.takenAt} AND ${photos.uploadedAt} < ${cursor.uploadedAt})
        OR (${photos.takenAt} = ${cursor.takenAt} AND ${photos.uploadedAt} = ${cursor.uploadedAt} AND ${photos.id} < ${cursor.id})
    )`;
}
