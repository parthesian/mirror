import { isKnownColor } from './colors.js';
import { decodeCursor, type PhotoCursor } from './cursor.js';
import { type PhotoFilters, photoQuerySchema } from './schemas.js';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;

export type PhotoQuery = {
    limit: number;
    cursor: PhotoCursor | null;
    filters: PhotoFilters;
};

export type QueryRead = { ok: true; query: PhotoQuery } | { ok: false; error: string };

export function parseLimit(rawValue: string | null | undefined): number {
    const parsed = Number.parseInt(rawValue ?? '', 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
        return DEFAULT_LIMIT;
    }
    return Math.min(parsed, MAX_LIMIT);
}

function blankFilters(): PhotoFilters {
    return {
        country: '',
        state: '',
        location: '',
        color: '',
        takenFrom: '',
        takenTo: '',
    };
}

export function readPhotoQuery(params: URLSearchParams): QueryRead {
    const parsed = photoQuerySchema.safeParse(Object.fromEntries(params.entries()));
    if (!parsed.success) {
        return { ok: false, error: 'Invalid query.' };
    }

    const color = (parsed.data.color ?? '').trim().toLowerCase();
    if (color && !isKnownColor(color)) {
        return { ok: false, error: 'Unknown color.' };
    }

    const rawCursor = parsed.data.cursor ?? '';
    if (rawCursor && !decodeCursor(rawCursor)) {
        return { ok: false, error: 'Invalid cursor supplied.' };
    }

    const filters = blankFilters();
    filters.country = (parsed.data.country ?? '').trim();
    filters.state = (parsed.data.state ?? '').trim();
    filters.location = (parsed.data.location ?? '').trim();
    filters.color = color && isKnownColor(color) ? color : '';
    filters.takenFrom = parsed.data.takenFrom ?? '';
    filters.takenTo = parsed.data.takenTo ?? '';

    return {
        ok: true,
        query: {
            limit: parseLimit(parsed.data.limit),
            cursor: rawCursor ? decodeCursor(rawCursor) : null,
            filters,
        },
    };
}
