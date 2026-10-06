import { parseColors, serializeColors } from './colors.js';
import { type PhotoPatchInput, photoPatchSchema } from './schemas.js';

export type PhotoPatch = {
    location?: string;
    description?: string;
    country?: string;
    state?: string;
    camera?: string;
    takenAt?: string;
    latitude?: number | null;
    longitude?: number | null;
    colors?: string;
};

export type PatchRead = { ok: true; patch: PhotoPatch } | { ok: false; error: string };

const TEXT_FIELDS = ['location', 'description', 'country', 'state', 'camera'] as const;

type TextField = (typeof TEXT_FIELDS)[number];

export function normalizeTakenAt(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    const normalized = dateOnlyMatch ? `${trimmed}T12:00:00.000Z` : trimmed;
    const timestamp = Date.parse(normalized);
    if (!Number.isFinite(timestamp)) {
        return null;
    }

    const isoTimestamp = new Date(timestamp).toISOString();
    if (dateOnlyMatch && isoTimestamp.slice(0, 10) !== trimmed) {
        return null;
    }

    return isoTimestamp;
}

export function normalizeCoordinate(
    value: unknown,
    minimum: number,
    maximum: number,
): { valid: true; value: number | null } | { valid: false; value: null } {
    if (value === null || value === '') {
        return { valid: true, value: null };
    }

    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
        return { valid: false, value: null };
    }

    return { valid: true, value: parsed };
}

function textValue(input: PhotoPatchInput, field: TextField): string | undefined {
    const value = input[field];
    return typeof value === 'string' ? value.trim() : undefined;
}

export function preparePhotoPatch(payload: unknown): PatchRead {
    const parsed = photoPatchSchema.safeParse(payload);
    if (!parsed.success) {
        return { ok: false, error: 'A valid metadata object is required.' };
    }

    const input = parsed.data;
    const patch: PhotoPatch = {};

    for (const field of TEXT_FIELDS) {
        if (input[field] === undefined) {
            continue;
        }
        const value = textValue(input, field) ?? '';
        if (field === 'location' && !value) {
            return { ok: false, error: 'Location is required.' };
        }
        patch[field] = value;
    }

    if (input.takenAt !== undefined) {
        const takenAt = normalizeTakenAt(input.takenAt);
        if (!takenAt) {
            return { ok: false, error: 'A valid date is required.' };
        }
        patch.takenAt = takenAt;
    }

    if (input.latitude !== undefined) {
        const latitude = normalizeCoordinate(input.latitude, -90, 90);
        if (!latitude.valid) {
            return { ok: false, error: 'Latitude must be between -90 and 90.' };
        }
        patch.latitude = latitude.value;
    }

    if (input.longitude !== undefined) {
        const longitude = normalizeCoordinate(input.longitude, -180, 180);
        if (!longitude.valid) {
            return { ok: false, error: 'Longitude must be between -180 and 180.' };
        }
        patch.longitude = longitude.value;
    }

    if (input.colors !== undefined) {
        patch.colors = serializeColors(parseColors(input.colors));
    }

    if (Object.keys(patch).length === 0) {
        return { ok: false, error: 'No editable metadata fields were supplied.' };
    }

    return { ok: true, patch };
}
