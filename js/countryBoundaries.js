/**
 * Natural Earth 50m countries for the globe explorer.
 *
 * One TopoJSON file, built by scripts/build-globe-countries.mjs, serves
 * three jobs: point-in-polygon picking, the hover outline, and the far-view
 * coast and border hairlines. An arc used by one country is coast; an arc
 * two countries share is a border.
 *
 * Classic script. Sets window.countryBoundaries.
 */
class CountryBoundaries {
    constructor(url = '/data/globe-countries-50m.v1.json') {
        this.url = url;
        this.features = [];
        this.aliasMap = new Map();
        this.lines = CountryBoundaries.featureCollection([]);
        this._promise = null;
    }

    static featureCollection(features) {
        return { type: 'FeatureCollection', features };
    }

    async ensureLoaded() {
        if (this.features.length) return this;
        this._promise = this._promise || fetch(this.url, { cache: 'force-cache' })
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((topology) => this._index(topology))
            .catch((err) => {
                console.warn('[CountryBoundaries] country boundaries unavailable', err);
            })
            .finally(() => {
                this._promise = null;
            });
        await this._promise;
        return this;
    }

    _index(topology) {
        const arcs = CountryBoundaries.decodeArcs(topology);
        const uses = new Map();
        const geometries = topology.objects.countries.geometries;
        const polygonsOf = (geometry) => (geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs);
        for (const geometry of geometries) {
            for (const polygon of polygonsOf(geometry)) {
                for (const ring of polygon) {
                    for (const ref of ring) {
                        const index = ref < 0 ? ~ref : ref;
                        uses.set(index, (uses.get(index) || 0) + 1);
                    }
                }
            }
        }

        this.features = geometries.map((geometry, index) => {
            const props = geometry.properties;
            const [minLon, minLat, maxLon, maxLat] = geometry.bbox;
            const polygons = polygonsOf(geometry).map((polygon) => (
                polygon.map((ring) => CountryBoundaries.stitch(arcs, ring))
            ));
            return {
                name: props.name,
                names: props.names,
                iso2: props.iso2,
                iso3: props.iso3,
                adm0a3: props.adm0a3,
                runtimeId: index + 1,
                polygons,
                bbox: { minLon, maxLon, minLat, maxLat }
            };
        });

        this.aliasMap = new Map();
        for (const feature of this.features) {
            for (const name of feature.names) {
                const key = window.LocationModel.normalizeCountryName(name);
                if (key && !this.aliasMap.has(key)) this.aliasMap.set(key, feature);
            }
        }

        const lines = (kind, keep) => ({
            type: 'Feature',
            properties: { kind },
            geometry: {
                type: 'MultiLineString',
                coordinates: arcs.flatMap((arc, index) => (keep(uses.get(index) || 0) ? CountryBoundaries.drawable(arc) : []))
            }
        });
        this.lines = CountryBoundaries.featureCollection([
            lines('coast', (count) => count === 1),
            lines('border', (count) => count > 1)
        ]);
    }

    static decodeArcs(topology) {
        const [sx, sy] = topology.transform.scale;
        const [tx, ty] = topology.transform.translate;
        return topology.arcs.map((arc) => {
            let x = 0;
            let y = 0;
            return arc.map(([dx, dy]) => {
                x += dx;
                y += dy;
                return [x * sx + tx, y * sy + ty];
            });
        });
    }

    static stitch(arcs, refs) {
        const ring = [];
        for (const ref of refs) {
            const points = ref < 0 ? [...arcs[~ref]].reverse() : arcs[ref];
            ring.push(...(ring.length ? points.slice(1) : points));
        }
        return ring;
    }

    /**
     * Natural Earth cuts polygons along the antimeridian and closes
     * Antarctica along the bottom of the map. Those seams are not coast.
     */
    static drawable(line) {
        const out = [];
        let run = [];
        const seam = (a, b) => (Math.abs(a[0]) > 179.9 && Math.abs(b[0]) > 179.9) || (a[1] < -89.9 && b[1] < -89.9);
        for (let i = 0; i < line.length; i++) {
            if (i > 0 && seam(line[i - 1], line[i])) {
                if (run.length > 1) out.push(run);
                run = [];
            }
            run.push(line[i]);
        }
        if (run.length > 1) out.push(run);
        return out;
    }

    /** The hover outline for one country, seams removed. */
    outline(feature) {
        if (!feature) return CountryBoundaries.featureCollection([]);
        const coordinates = feature.polygons.flat().flatMap((ring) => CountryBoundaries.drawable(ring));
        return CountryBoundaries.featureCollection([
            { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates } }
        ]);
    }

    pointInRing(lon, lat, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i];
            const [xj, yj] = ring[j];
            if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi) {
                inside = !inside;
            }
        }
        return inside;
    }

    pointInPolygon(lon, lat, polygon) {
        const [outer, ...holes] = polygon;
        return Boolean(outer) && this.pointInRing(lon, lat, outer)
            && !holes.some((hole) => this.pointInRing(lon, lat, hole));
    }

    isWithinBbox(lon, lat, bbox) {
        return lat >= bbox.minLat && lat <= bbox.maxLat && lon >= bbox.minLon && lon <= bbox.maxLon;
    }

    findCountry(lon, lat) {
        const wrapped = ((lon + 540) % 360) - 180;
        return this.features.find((feature) => (
            this.isWithinBbox(wrapped, lat, feature.bbox)
            && feature.polygons.some((polygon) => this.pointInPolygon(wrapped, lat, polygon))
        )) || null;
    }

    countryFeatureKey(featureRef) {
        if (!featureRef) return '';
        return featureRef.adm0a3 || featureRef.iso3 || featureRef.name || '';
    }
}

window.CountryBoundaries = CountryBoundaries;
window.countryBoundaries = window.countryBoundaries || new CountryBoundaries();
