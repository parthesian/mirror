/**
 * Shared location identity, country aliases, and trip grouping.
 *
 * Reason: globe dots, travel routes, filter menus, and the modal focus path
 * all need the same place keys. Keeping them in one module prevents a hover
 * highlight from resolving a different place than a click or an arc edge.
 */
const LocationModel = {
    normalizePart(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ');
    },

    normalizeCountryName(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    },

    stateKey(loc) {
        const state = this.normalizePart(loc?.state);
        if (!state) {
            return '';
        }
        const country = this.normalizePart(loc?.country);
        return `state:${state}|country:${country}`;
    },

    locationKey(loc) {
        const place = String(loc?.location || '').trim();
        if (place) {
            const state = this.normalizePart(loc?.state);
            const country = this.normalizePart(loc?.country);
            return `place:${this.normalizePart(place)}|state:${state}|country:${country}`;
        }
        const lat = Number(loc?.latitude);
        const lon = Number(loc?.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            return `coords:${lat.toFixed(3)},${lon.toFixed(3)}`;
        }
        return `photo:${String(loc?.id || '')}`;
    },

    formatWithRegion(loc) {
        const location = String(loc?.location || '').trim();
        const region = String(loc?.state || '').trim();
        if (!region || region.toLowerCase() === location.toLowerCase()) {
            return location;
        }
        return location ? `${location}, ${region}` : region;
    },

    seedCountryAliases(locationsByCountry = {}) {
        const aliasMap = new Map();
        const addAlias = (alias, canonical) => {
            const key = this.normalizeCountryName(alias);
            if (!key || !canonical) {
                return;
            }
            if (!aliasMap.has(key)) {
                aliasMap.set(key, canonical);
            }
        };

        const explicitAliases = {
            usa: 'USA',
            us: 'USA',
            'u s a': 'USA',
            'u s': 'USA',
            'united states': 'USA',
            'united states of america': 'USA',
            uk: 'United Kingdom',
            'united kingdom': 'United Kingdom',
            britain: 'United Kingdom',
            'great britain': 'United Kingdom',
            uae: 'United Arab Emirates',
            'united arab emirates': 'United Arab Emirates',
            russia: 'Russia',
            'russian federation': 'Russia',
            korea: 'South Korea',
            'south korea': 'South Korea',
            'republic of korea': 'South Korea',
            'north korea': 'North Korea',
            dprk: 'North Korea'
        };

        for (const [alias, canonical] of Object.entries(explicitAliases)) {
            addAlias(alias, canonical);
        }
        for (const country of Object.keys(locationsByCountry || {})) {
            if (!country || country === 'Unknown') {
                continue;
            }
            addAlias(country, country);
        }

        return aliasMap;
    },

    resolveCountryFilterValue(countryName, aliases, locationsByCountry, aliasMap) {
        const candidates = [countryName, ...(Array.isArray(aliases) ? aliases : [])];
        for (const candidate of candidates) {
            const key = this.normalizeCountryName(candidate);
            const mapped = aliasMap?.get(key);
            if (mapped && locationsByCountry?.[mapped]?.length > 0) {
                return mapped;
            }
            if (candidate && locationsByCountry?.[candidate]?.length > 0) {
                return candidate;
            }
        }
        return countryName || '';
    },

    groupTrips(locs) {
        const sorted = [...locs].sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt));
        if (!sorted.length) {
            return [];
        }

        const trips = [];
        let current = [sorted[0]];

        for (let i = 1; i < sorted.length; i++) {
            const gap = new Date(sorted[i].takenAt) - new Date(sorted[i - 1].takenAt);
            if (gap > 30 * 24 * 60 * 60 * 1000) {
                trips.push(current);
                current = [];
            }
            current.push(sorted[i]);
        }
        trips.push(current);
        return trips;
    }
};

if (typeof window !== 'undefined') {
    window.LocationModel = LocationModel;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = LocationModel;
}
