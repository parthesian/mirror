export type PhotoCursor = {
    takenAt: string;
    uploadedAt: string;
    id: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function encodeCursor(record: { takenAt: string; uploadedAt: string; id: string }): string {
    return btoa(
        JSON.stringify({
            takenAt: record.takenAt,
            uploadedAt: record.uploadedAt,
            id: record.id,
        }),
    );
}

export function decodeCursor(rawCursor: string | null | undefined): PhotoCursor | null {
    if (!rawCursor) {
        return null;
    }

    try {
        const parsed: unknown = JSON.parse(atob(rawCursor));
        if (
            !isRecord(parsed) ||
            typeof parsed.takenAt !== 'string' ||
            typeof parsed.id !== 'string'
        ) {
            return null;
        }
        if (!parsed.takenAt || !parsed.id) {
            return null;
        }
        const uploadedAt =
            typeof parsed.uploadedAt === 'string' && parsed.uploadedAt
                ? parsed.uploadedAt
                : parsed.takenAt;
        return {
            takenAt: parsed.takenAt,
            uploadedAt,
            id: parsed.id,
        };
    } catch {
        return null;
    }
}
