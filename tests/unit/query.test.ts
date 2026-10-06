import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../../shared/cursor.js';
import { preparePhotoPatch } from '../../shared/patch.js';
import { readPhotoQuery } from '../../shared/query.js';
import { buildImageUrl } from '../../shared/urls.js';

describe('gallery query contract', () => {
    it('builds a Cloudflare thumbnail URL with format=auto', () => {
        expect(buildImageUrl('abc', 'thumb')).toContain('format=auto');
        expect(buildImageUrl('abc', 'full')).toBe('/api/photos/abc/image');
    });

    it('caps the page size and rejects a bad cursor or color', () => {
        const wide = readPhotoQuery(new URLSearchParams({ limit: '1000' }));
        expect(wide.ok && wide.query.limit).toBe(60);
        const fallback = readPhotoQuery(new URLSearchParams({ limit: '0' }));
        expect(fallback.ok && fallback.query.limit).toBe(24);
        const badCursor = readPhotoQuery(new URLSearchParams({ cursor: '%%%' }));
        expect(badCursor.ok).toBe(false);
        const badColor = readPhotoQuery(new URLSearchParams({ color: 'navy' }));
        expect(badColor.ok).toBe(false);
    });

    it('keeps cursor fields stable', () => {
        const encoded = encodeCursor({
            takenAt: '2024-01-02T00:00:00.000Z',
            uploadedAt: '2024-01-03T00:00:00.000Z',
            id: 'photo-1',
        });
        expect(decodeCursor(encoded)).toEqual({
            takenAt: '2024-01-02T00:00:00.000Z',
            uploadedAt: '2024-01-03T00:00:00.000Z',
            id: 'photo-1',
        });
    });

    it('normalizes a date-only patch and rejects an empty place', () => {
        const dated = preparePhotoPatch({ takenAt: '2024-05-06', location: 'Kyoto' });
        expect(dated.ok && dated.patch.takenAt).toBe('2024-05-06T12:00:00.000Z');
        expect(dated.ok && dated.patch.location).toBe('Kyoto');
        const empty = preparePhotoPatch({ location: '   ' });
        expect(empty).toEqual({ ok: false, error: 'Location is required.' });
    });
});
