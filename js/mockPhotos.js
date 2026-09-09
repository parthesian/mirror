/**
 * Coloured stand-in gallery used when the real photo API is empty or the
 * page is opened with ?mock=1. Each country is a distinct hue so filter
 * changes are obvious; aspect ratios vary so masonry has real work to do.
 *
 * Production traffic never hits this unless someone opts in.
 */
const MOCK_PLACES = [
    { country: 'Japan', state: 'Kyoto', location: 'Fushimi Inari', lat: 34.9671, lng: 135.7727, color: '#c45c26', accent: '#f4d6b0' },
    { country: 'Japan', state: 'Tokyo', location: 'Shibuya', lat: 35.6595, lng: 139.7004, color: '#b42318', accent: '#ffd7c2' },
    { country: 'France', state: 'Île-de-France', location: 'Paris', lat: 48.8566, lng: 2.3522, color: '#2f5d8c', accent: '#f2d38a' },
    { country: 'France', state: 'Provence', location: 'Arles', lat: 43.6766, lng: 4.6278, color: '#3d6ea8', accent: '#f7e3b0' },
    { country: 'Italy', state: 'Tuscany', location: 'Siena', lat: 43.3188, lng: 11.3308, color: '#2f6b4f', accent: '#e8c3a0' },
    { country: 'Italy', state: 'Lazio', location: 'Rome', lat: 41.9028, lng: 12.4964, color: '#3b7a4a', accent: '#f0d2b0' },
    { country: 'United States', state: 'California', location: 'Big Sur', lat: 36.2704, lng: -121.8070, color: '#3a3d7c', accent: '#f0b45a' },
    { country: 'United States', state: 'Utah', location: 'Moab', lat: 38.5733, lng: -109.5498, color: '#4a3580', accent: '#f3c27a' },
    { country: 'Iceland', state: 'Southern Region', location: 'Vík', lat: 63.4186, lng: -19.0060, color: '#1f6f73', accent: '#d7eef0' },
    { country: 'Iceland', state: 'Capital Region', location: 'Reykjavík', lat: 64.1466, lng: -21.9426, color: '#1b5e6b', accent: '#e4f4f6' }
];

const MOCK_ASPECTS = [
    [1200, 800],
    [800, 1200],
    [1600, 900],
    [900, 1600],
    [1200, 900],
    [900, 1200],
    [1400, 1400],
    [2000, 860],
    [860, 1400],
    [1500, 1000]
];

const MockPhotos = {
    LIMIT: 24,

    enabled(search = typeof window !== 'undefined' ? window.location.search : '') {
        const raw = String(search || '');
        if (!/(?:^|[?&])mock(?:=|$|&)/.test(raw)) {
            return false;
        }
        return !/(?:^|[?&])mock=0(?:&|$)/.test(raw);
    },

    catalog() {
        if (this._catalog) {
            return this._catalog;
        }
        const photos = [];
        for (let i = 0; i < 48; i++) {
            const place = MOCK_PLACES[i % MOCK_PLACES.length];
            const [width, height] = MOCK_ASPECTS[i % MOCK_ASPECTS.length];
            const month = String((i % 12) + 1).padStart(2, '0');
            const day = String((i % 27) + 1).padStart(2, '0');
            const year = 2019 + (i % 6);
            photos.push({
                id: `mock-${String(i + 1).padStart(3, '0')}`,
                width,
                height,
                country: place.country,
                state: place.state,
                location: place.location,
                latitude: place.lat + ((i % 5) * 0.01),
                longitude: place.lng + ((i % 4) * 0.01),
                takenAt: `${year}-${month}-${day}T12:00:00.000Z`,
                uploadedAt: `${year}-${month}-${day}T18:00:00.000Z`,
                description: `${place.location} ${i + 1}`,
                color: place.color,
                accent: place.accent
            });
        }
        photos.sort((a, b) => {
            if (a.takenAt === b.takenAt) {
                return a.id < b.id ? 1 : -1;
            }
            return a.takenAt < b.takenAt ? 1 : -1;
        });
        this._catalog = photos;
        return photos;
    },

    svgMarkup(photo) {
        const width = photo.width || 1200;
        const height = photo.height || 900;
        const color = photo.color || '#888888';
        const accent = photo.accent || '#f0f0f0';
        const label = `${photo.location || 'Photo'} · ${width}×${height}`;
        const font = Math.max(22, Math.round(Math.min(width, height) / 14));
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
            <rect width="100%" height="100%" fill="${color}"/>
            <rect x="${Math.round(width * 0.07)}" y="${Math.round(height * 0.07)}" width="${Math.round(width * 0.86)}" height="${Math.round(height * 0.86)}" fill="none" stroke="${accent}" stroke-width="${Math.max(6, Math.round(width / 90))}"/>
            <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.22)}" r="${Math.round(Math.min(width, height) * 0.08)}" fill="${accent}" fill-opacity="0.35"/>
            <text x="50%" y="50%" fill="${accent}" font-family="Georgia, serif" font-size="${font}" text-anchor="middle" dominant-baseline="middle">${escapeXml(label)}</text>
        </svg>`;
    },

    svgDataUrl(photo) {
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.svgMarkup(photo))}`;
    },

    filterPhotos(photos, query = {}) {
        return photos.filter((photo) => {
            if (query.country && !sameText(photo.country, query.country)) return false;
            if (query.state && !sameText(photo.state, query.state)) return false;
            if (query.location && !sameText(photo.location, query.location)) return false;
            if (query.takenFrom && photo.takenAt < query.takenFrom) return false;
            if (query.takenTo && photo.takenAt > query.takenTo) return false;
            return true;
        });
    },

    page(query = {}, cursor = null, limit = this.LIMIT) {
        const filtered = this.filterPhotos(this.catalog(), query);
        let start = 0;
        if (cursor) {
            const index = filtered.findIndex((photo) => photo.id === cursor.id);
            start = index >= 0 ? index + 1 : 0;
        }
        const slice = filtered.slice(start, start + limit);
        const next = filtered[start + limit] ? slice[slice.length - 1] : null;
        return {
            photos: slice.map((photo) => ({
                id: photo.id,
                takenAt: photo.takenAt,
                uploadedAt: photo.uploadedAt,
                width: photo.width,
                height: photo.height
            })),
            hasMore: Boolean(next),
            nextCursor: next ? encodeMockCursor(slice[slice.length - 1]) : null
        };
    },

    locations() {
        return this.catalog().map((photo) => ({
            id: photo.id,
            latitude: photo.latitude,
            longitude: photo.longitude,
            country: photo.country,
            state: photo.state,
            location: photo.location,
            takenAt: photo.takenAt
        }));
    },

    timeline(query = {}) {
        const groups = new Map();
        for (const photo of this.filterPhotos(this.catalog(), query)) {
            const year = Number(photo.takenAt.slice(0, 4));
            const month = Number(photo.takenAt.slice(5, 7));
            const key = `${year}-${month}`;
            const current = groups.get(key) || { year, month, count: 0 };
            current.count += 1;
            groups.set(key, current);
        }
        return [...groups.values()].sort((a, b) => (a.year === b.year ? b.month - a.month : b.year - a.year));
    },

    byId(id) {
        return this.catalog().find((photo) => photo.id === id) || null;
    },

    metadata(id) {
        const photo = this.byId(id);
        if (!photo) return null;
        return {
            id: photo.id,
            location: photo.location,
            description: photo.description,
            takenAt: photo.takenAt,
            uploadedAt: photo.uploadedAt,
            width: photo.width,
            height: photo.height,
            latitude: photo.latitude,
            longitude: photo.longitude,
            country: photo.country,
            state: photo.state,
            camera: 'Mock Camera',
            image: { url: `/api/photos/${photo.id}/image`, width: photo.width, height: photo.height },
            thumbnail: { url: this.svgDataUrl(photo), width: photo.width, height: photo.height }
        };
    },

    handleRequest(urlString) {
        let url;
        try {
            url = new URL(urlString, 'http://mock.local');
        } catch {
            return null;
        }
        const path = url.pathname.replace(/\/+$/, '') || '/';
        const imageMatch = path.match(/(?:\/cdn-cgi\/image\/[^/]+)?\/api\/photos\/([^/]+)\/image$/);
        if (imageMatch) {
            const photo = this.byId(decodeURIComponent(imageMatch[1]));
            if (!photo) return jsonResponse({ error: 'Photo not found.' }, 404);
            return svgResponse(this.svgMarkup(photo));
        }
        const metaMatch = path.match(/^\/api\/photos\/([^/]+)\/metadata$/);
        if (metaMatch) {
            const payload = this.metadata(decodeURIComponent(metaMatch[1]));
            if (!payload) return jsonResponse({ error: 'Photo not found.' }, 404);
            return jsonResponse(payload);
        }
        if (path === '/api/photos/geo') {
            return jsonResponse({ locations: this.locations() });
        }
        if (path === '/api/photos/timeline') {
            return jsonResponse({ groups: this.timeline(queryFrom(url)) });
        }
        if (path === '/api/photos') {
            return jsonResponse(this.page(queryFrom(url), decodeMockCursor(url.searchParams.get('cursor')), Number(url.searchParams.get('limit')) || this.LIMIT));
        }
        return null;
    },

    install(fetchImpl = typeof window !== 'undefined' ? window.fetch : null) {
        if (this._installed || typeof fetchImpl !== 'function') {
            return Boolean(this._installed);
        }
        if (typeof window !== 'undefined' && !this.enabled(window.location.search)) {
            return false;
        }
        const original = fetchImpl.bind(typeof window !== 'undefined' ? window : globalThis);
        const patched = (input, init) => {
            const url = typeof input === 'string' ? input : input?.url;
            const response = url ? this.handleRequest(url) : null;
            if (response) {
                return Promise.resolve(response);
            }
            return original(input, init);
        };
        if (typeof window !== 'undefined') {
            window.fetch = patched;
        }
        this._installed = true;
        this._originalFetch = original;
        return true;
    }
};

function sameText(left, right) {
    return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function queryFrom(url) {
    return {
        country: url.searchParams.get('country') || '',
        state: url.searchParams.get('state') || '',
        location: url.searchParams.get('location') || '',
        takenFrom: url.searchParams.get('takenFrom') || '',
        takenTo: url.searchParams.get('takenTo') || ''
    };
}

function encodeMockCursor(photo) {
    return btoa(JSON.stringify({
        takenAt: photo.takenAt,
        uploadedAt: photo.uploadedAt,
        id: photo.id
    }));
}

function decodeMockCursor(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(atob(raw));
    } catch {
        return null;
    }
}

function escapeXml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=UTF-8' }
    });
}

function svgResponse(markup) {
    return new Response(markup, {
        status: 200,
        headers: {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}

if (typeof window !== 'undefined') {
    window.MockPhotos = MockPhotos;
    MockPhotos.install();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MockPhotos;
}
