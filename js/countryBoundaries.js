/**
 * Natural Earth country polygons for globe hover/click.
 *
 * Reason: boundary fetching and point-in-polygon sat inside the explorer
 * constructor path. Isolating it lets idle/hover prefetch the GeoJSON once
 * and keeps click-country matching identical on mobile and desktop.
 */
class CountryBoundaries {
    constructor() {
        this.features = [];
        this.aliasMap = new Map();
        this._promise = null;
    }

    async ensureLoaded() {
        if (this.features.length) {
            return this;
        }
        if (this._promise) {
            return this._promise;
        }
        this._promise = this._load().finally(() => {
            this._promise = null;
        });
        await this._promise;
        return this;
    }

    async _load() {
        const dataSources = [
            'public/data/ne_110m_admin_0_countries.geojson',
            'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson'
        ];

        let featureCollection = null;
        for (const src of dataSources) {
            try {
                const res = await fetch(src, { cache: 'force-cache' });
                if (!res.ok) {
                    continue;
                }
                featureCollection = await res.json();
                if (featureCollection?.features?.length) {
                    break;
                }
            } catch (_) {
                // Continue to next source.
            }
        }

        if (!featureCollection?.features?.length) {
            console.warn('[CountryBoundaries] country boundaries unavailable');
            this.features = [];
            this.aliasMap = new Map();
            return;
        }

        const aliases = new Map();
        const features = [];
        const normalizeLon = (lon) => {
            const out = ((Number(lon) + 540) % 360) - 180;
            return Number.isFinite(out) ? out : lon;
        };
        const getBbox = (rings) => {
            let minLon = Infinity;
            let maxLon = -Infinity;
            let minLat = Infinity;
            let maxLat = -Infinity;
            for (const ring of rings) {
                for (const point of ring) {
                    const lon = normalizeLon(point[0]);
                    const lat = Number(point[1]);
                    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
                        continue;
                    }
                    minLon = Math.min(minLon, lon);
                    maxLon = Math.max(maxLon, lon);
                    minLat = Math.min(minLat, lat);
                    maxLat = Math.max(maxLat, lat);
                }
            }
            if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) {
                return null;
            }
            return { minLon, maxLon, minLat, maxLat };
        };
        const addAlias = (value, featureRef) => {
            const key = LocationModel.normalizeCountryName(value);
            if (!key || aliases.has(key)) {
                return;
            }
            aliases.set(key, featureRef);
        };
        const cleanName = (value) => String(value || '').trim();
        const namesForProps = (props) => ([
            props?.NAME,
            props?.NAME_LONG,
            props?.BRK_NAME,
            props?.FORMAL_EN,
            props?.ADMIN,
            props?.ABBREV,
            props?.ISO_A2,
            props?.ISO_A3
        ].map(cleanName).filter(Boolean));

        for (const feature of featureCollection.features) {
            const geometry = feature?.geometry;
            if (!geometry) {
                continue;
            }
            const type = geometry.type;
            const polygons = [];
            if (type === 'Polygon') {
                if (Array.isArray(geometry.coordinates)) {
                    polygons.push(geometry.coordinates);
                }
            } else if (type === 'MultiPolygon') {
                if (Array.isArray(geometry.coordinates)) {
                    polygons.push(...geometry.coordinates);
                }
            } else {
                continue;
            }

            const ringsForBbox = [];
            for (const polygon of polygons) {
                if (!Array.isArray(polygon)) {
                    continue;
                }
                for (const ring of polygon) {
                    if (Array.isArray(ring)) {
                        ringsForBbox.push(ring);
                    }
                }
            }
            const bbox = getBbox(ringsForBbox);
            if (!bbox) {
                continue;
            }

            const props = feature.properties || {};
            const names = namesForProps(props);
            const primaryName = cleanName(props.ADMIN || props.NAME || props.BRK_NAME || props.NAME_LONG || '');
            if (!primaryName) {
                continue;
            }

            const featureRef = {
                name: primaryName,
                names,
                iso2: cleanName(props.ISO_A2),
                iso3: cleanName(props.ISO_A3),
                polygons,
                bbox
            };
            features.push(featureRef);
            for (const name of names) {
                addAlias(name, featureRef);
            }
        }

        this.features = features;
        this.aliasMap = aliases;
    }

    pointInRing(lon, lat, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = Number(ring[i][0]);
            const yi = Number(ring[i][1]);
            const xj = Number(ring[j][0]);
            const yj = Number(ring[j][1]);
            if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(xj) || !Number.isFinite(yj)) {
                continue;
            }
            const intersects = ((yi > lat) !== (yj > lat))
                && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
            if (intersects) {
                inside = !inside;
            }
        }
        return inside;
    }

    pointInPolygon(lon, lat, polygon) {
        if (!Array.isArray(polygon) || !polygon.length) {
            return false;
        }
        const [outer, ...holes] = polygon;
        if (!Array.isArray(outer) || !outer.length) {
            return false;
        }
        if (!this.pointInRing(lon, lat, outer)) {
            return false;
        }
        for (const hole of holes) {
            if (Array.isArray(hole) && hole.length && this.pointInRing(lon, lat, hole)) {
                return false;
            }
        }
        return true;
    }

    isWithinBbox(lon, lat, bbox) {
        if (!bbox) {
            return true;
        }
        const latOk = lat >= bbox.minLat && lat <= bbox.maxLat;
        if (!latOk) {
            return false;
        }
        if ((bbox.maxLon - bbox.minLon) > 300) {
            return true;
        }
        return lon >= bbox.minLon && lon <= bbox.maxLon;
    }

    dirToLatLon(THREE, worldDirection, group) {
        const localDir = worldDirection.clone().normalize();
        if (group) {
            const worldQuat = group.getWorldQuaternion(new THREE.Quaternion());
            localDir.applyQuaternion(worldQuat.invert()).normalize();
        }
        const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(localDir.y, -1, 1)));
        let lon = THREE.MathUtils.radToDeg(Math.atan2(-localDir.z, localDir.x));
        lon = ((lon + 540) % 360) - 180;
        return { lat, lon };
    }

    findCountryFromDirection(THREE, direction, group) {
        if (!this.features.length) {
            return null;
        }
        const { lat, lon } = this.dirToLatLon(THREE, direction, group);
        for (const feature of this.features) {
            if (!this.isWithinBbox(lon, lat, feature.bbox)) {
                continue;
            }
            for (const polygon of feature.polygons) {
                if (this.pointInPolygon(lon, lat, polygon)) {
                    return { feature, lat, lon };
                }
            }
        }
        return null;
    }

    countryFeatureKey(featureRef) {
        if (!featureRef) {
            return '';
        }
        return featureRef.iso3 || featureRef.iso2 || featureRef.name || '';
    }
}

window.CountryBoundaries = CountryBoundaries;
window.countryBoundaries = window.countryBoundaries || new CountryBoundaries();
