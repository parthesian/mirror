/**
 * Offline Natural Earth line builder.
 *
 * Not part of `npm run build`. Download Natural Earth v5.1.2 GeoJSON into a
 * temp directory and pass it with --src. Writes the two versioned JSON files
 * the explorer fetches, and fails if either file exceeds its byte cap.
 *
 *   node scripts/build-globe-lines.mjs --src /tmp/ne-v512
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import vm from 'node:vm';

const RAW_CAP = { '50m': 440 * 1024, '10m': 1080 * 1024 };
const GZIP_CAP = { '50m': 175 * 1024, '10m': 425 * 1024 };

function arg(name, fallback) {
    const index = process.argv.indexOf(name);
    if (index === -1) {
        return fallback;
    }
    return process.argv[index + 1] || fallback;
}

const srcDir = arg('--src', '');
const countriesPath = arg('--countries', 'public/data/ne_110m_admin_0_countries.geojson');
const outDir = arg('--out', 'public/data');
if (!srcDir) {
    console.error('Pass --src <dir> holding Natural Earth v5.1.2 GeoJSON');
    process.exit(1);
}

function loadGlobeDetail() {
    const code = readFileSync(new URL('../js/globeDetail.js', import.meta.url), 'utf8');
    const sandbox = { window: {}, console, Math, Number, String, Array, Map, Object, Float32Array, Uint8Array, Uint32Array };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    if (!sandbox.window.GlobeDetail) {
        throw new Error('GlobeDetail did not attach');
    }
    return sandbox.window.GlobeDetail;
}

const GlobeDetail = loadGlobeDetail();

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function finitePair(coord) {
    if (!Array.isArray(coord) || coord.length < 2) {
        return null;
    }
    const lon = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        return null;
    }
    return { lon, lat };
}

function linesFromGeometry(geometry) {
    if (!geometry) {
        return [];
    }
    const lines = [];
    const pushLine = (coords, closeRing) => {
        const points = [];
        for (const coord of coords || []) {
            const point = finitePair(coord);
            if (point) {
                points.push(point);
            }
        }
        if (points.length < 2) {
            return;
        }
        if (closeRing) {
            const first = points[0];
            const last = points[points.length - 1];
            if (first && last && (first.lon !== last.lon || first.lat !== last.lat)) {
                points.push({ lon: first.lon, lat: first.lat });
            }
        }
        lines.push(points);
    };
    const type = geometry.type;
    if (type === 'LineString') {
        pushLine(geometry.coordinates, false);
    } else if (type === 'MultiLineString') {
        for (const line of geometry.coordinates || []) {
            pushLine(line, false);
        }
    } else if (type === 'Polygon') {
        for (const ring of geometry.coordinates || []) {
            pushLine(ring, true);
        }
    } else if (type === 'MultiPolygon') {
        for (const polygon of geometry.coordinates || []) {
            for (const ring of polygon || []) {
                pushLine(ring, true);
            }
        }
    }
    return lines;
}

function splitPolyline(points) {
    const lines = [];
    let current = [];
    const commit = () => {
        if (current.length >= 2) {
            lines.push(current);
        }
        current = [];
    };
    const first = points[0];
    if (!first) {
        return lines;
    }
    current.push(first);
    for (let i = 1; i < points.length; i++) {
        const b = points[i];
        const a = current[current.length - 1] || points[i - 1];
        if (!a || !b) {
            continue;
        }
        const parts = GlobeDetail.splitSegment(a.lon, a.lat, b.lon, b.lat);
        if (parts.length === 0) {
            commit();
            current = [b];
            continue;
        }
        if (parts.length === 1) {
            current.push(b);
            continue;
        }
        const end = parts[0];
        const start = parts[1];
        current.push({ lon: end.lon2, lat: end.lat2 });
        commit();
        current = [
            { lon: start.lon1, lat: start.lat1 },
            { lon: start.lon2, lat: start.lat2 }
        ];
    }
    commit();
    return lines;
}

function perpDistance(point, start, end) {
    const dx = end.lon - start.lon;
    const dy = end.lat - start.lat;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) {
        return Math.hypot(point.lon - start.lon, point.lat - start.lat);
    }
    const t = Math.max(0, Math.min(1, ((point.lon - start.lon) * dx + (point.lat - start.lat) * dy) / len2));
    return Math.hypot(point.lon - (start.lon + t * dx), point.lat - (start.lat + t * dy));
}

function douglasPeucker(points, tolerance) {
    if (points.length < 3) {
        return points.slice();
    }
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
        const range = stack.pop();
        if (!range) {
            continue;
        }
        const startIndex = range[0];
        const endIndex = range[1];
        const start = points[startIndex];
        const end = points[endIndex];
        if (!start || !end) {
            continue;
        }
        let maxDist = 0;
        let maxIndex = -1;
        for (let i = startIndex + 1; i < endIndex; i++) {
            const point = points[i];
            if (!point) {
                continue;
            }
            const dist = perpDistance(point, start, end);
            if (dist > maxDist) {
                maxDist = dist;
                maxIndex = i;
            }
        }
        if (maxIndex !== -1 && maxDist > tolerance) {
            keep[maxIndex] = 1;
            stack.push([startIndex, maxIndex], [maxIndex, endIndex]);
        }
    }
    const out = [];
    for (let i = 0; i < points.length; i++) {
        if (keep[i]) {
            const point = points[i];
            if (point) {
                out.push(point);
            }
        }
    }
    return out;
}

function lineLength(points) {
    let length = 0;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        if (!a || !b) {
            continue;
        }
        length += Math.hypot(b.lon - a.lon, b.lat - a.lat);
    }
    return length;
}

function prepareLines(features, tolerance, minLength, rings) {
    const prepared = [];
    for (const feature of features) {
        const sourceLines = linesFromGeometry(feature.geometry);
        for (const source of sourceLines) {
            for (const piece of splitPolyline(source)) {
                const simplified = douglasPeucker(piece, tolerance);
                if (simplified.length < 2) {
                    continue;
                }
                if (minLength > 0 && lineLength(simplified) < minLength) {
                    continue;
                }
                prepared.push({
                    points: simplified,
                    code: rings ? '' : String(feature.properties?.ADM0_A3 || feature.properties?.adm0_a3 || '').trim()
                });
            }
        }
    }
    return prepared;
}

function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i];
        const b = ring[j];
        if (!a || !b) {
            continue;
        }
        const intersects = ((a.lat > lat) !== (b.lat > lat))
            && (lon < ((b.lon - a.lon) * (lat - a.lat)) / ((b.lat - a.lat) || 1e-12) + a.lon);
        if (intersects) {
            inside = !inside;
        }
    }
    return inside;
}

function buildCountries(collection, codeIndex) {
    const countries = [];
    for (const feature of collection.features || []) {
        const code = String(feature.properties?.ADM0_A3 || '').trim();
        const id = codeIndex.get(code) || 0;
        if (!id || !feature.geometry) {
            continue;
        }
        const polygons = feature.geometry.type === 'Polygon'
            ? [feature.geometry.coordinates]
            : feature.geometry.type === 'MultiPolygon'
                ? feature.geometry.coordinates
                : [];
        const rings = [];
        let minLon = Infinity;
        let maxLon = -Infinity;
        let minLat = Infinity;
        let maxLat = -Infinity;
        for (const polygon of polygons) {
            const ringSet = [];
            for (const ring of polygon || []) {
                const points = [];
                for (const coord of ring || []) {
                    const point = finitePair(coord);
                    if (!point) {
                        continue;
                    }
                    points.push(point);
                    minLon = Math.min(minLon, point.lon);
                    maxLon = Math.max(maxLon, point.lon);
                    minLat = Math.min(minLat, point.lat);
                    maxLat = Math.max(maxLat, point.lat);
                }
                if (points.length >= 3) {
                    ringSet.push(points);
                }
            }
            if (ringSet.length) {
                rings.push(ringSet);
            }
        }
        if (!rings.length || !Number.isFinite(minLon)) {
            continue;
        }
        countries.push({
            id,
            code,
            rings,
            bbox: { minLon, maxLon, minLat, maxLat },
            wide: (maxLon - minLon) > 300
        });
    }
    return countries;
}

function latInBbox(country, lat, pad) {
    return lat >= country.bbox.minLat - pad && lat <= country.bbox.maxLat + pad;
}

function lonInBbox(country, lon, pad) {
    if (country.wide) {
        return true;
    }
    return lon >= country.bbox.minLon - pad && lon <= country.bbox.maxLon + pad;
}

function containsCountry(country, lon, lat) {
    if (!latInBbox(country, lat, 0) || !lonInBbox(country, lon, 0)) {
        return false;
    }
    for (const polygon of country.rings) {
        const outer = polygon[0];
        if (!outer || !pointInRing(lon, lat, outer)) {
            continue;
        }
        let inHole = false;
        for (let i = 1; i < polygon.length; i++) {
            const hole = polygon[i];
            if (hole && pointInRing(lon, lat, hole)) {
                inHole = true;
                break;
            }
        }
        if (!inHole) {
            return true;
        }
    }
    return false;
}

function segmentDistance(lon, lat, ring) {
    const cosLat = Math.cos(lat * Math.PI / 180);
    let best = Infinity;
    for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1];
        const b = ring[i];
        if (!a || !b) {
            continue;
        }
        const ax = (a.lon - lon) * cosLat;
        const ay = a.lat - lat;
        const bx = (b.lon - lon) * cosLat;
        const by = b.lat - lat;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
        const dist = Math.hypot(ax + t * dx, ay + t * dy);
        if (dist < best) {
            best = dist;
        }
    }
    return best;
}

function countryDistance(country, lon, lat) {
    if (containsCountry(country, lon, lat)) {
        return 0;
    }
    let best = Infinity;
    for (const polygon of country.rings) {
        for (const ring of polygon) {
            const dist = segmentDistance(lon, lat, ring);
            if (dist < best) {
                best = dist;
            }
        }
    }
    return best;
}

function resolvePoint(countries, lon, lat, maxDist) {
    let bestId = 0;
    let bestDist = maxDist;
    for (const country of countries) {
        const pad = maxDist + 0.2;
        if (!latInBbox(country, lat, pad) || !lonInBbox(country, lon, pad)) {
            continue;
        }
        if (containsCountry(country, lon, lat)) {
            return country.id;
        }
        const dist = countryDistance(country, lon, lat);
        if (dist <= bestDist || (dist === bestDist && country.id < bestId)) {
            bestDist = dist;
            bestId = country.id;
        }
    }
    return bestId;
}

function twoNearest(countries, lon, lat) {
    const ranked = countries
        .map((country) => {
            const latDist = lat < country.bbox.minLat
                ? country.bbox.minLat - lat
                : lat > country.bbox.maxLat
                    ? lat - country.bbox.maxLat
                    : 0;
            return { country, latDist };
        })
        .sort((a, b) => a.latDist - b.latDist || a.country.id - b.country.id);
    const scored = [];
    for (let i = 0; i < ranked.length && i < 16; i++) {
        const country = ranked[i]?.country;
        if (!country) {
            continue;
        }
        scored.push({ id: country.id, dist: countryDistance(country, lon, lat) });
    }
    scored.sort((a, b) => a.dist - b.dist || a.id - b.id);
    const ids = [];
    for (const item of scored) {
        if (!ids.includes(item.id)) {
            ids.push(item.id);
        }
        if (ids.length === 2) {
            break;
        }
    }
    return ids;
}

function pointAtFraction(points, fraction) {
    const target = lineLength(points) * fraction;
    let walked = 0;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        if (!a || !b) {
            continue;
        }
        const step = Math.hypot(b.lon - a.lon, b.lat - a.lat);
        if (walked + step >= target || i === points.length - 1) {
            const t = step === 0 ? 0 : (target - walked) / step;
            const clamped = Math.max(0, Math.min(1, t));
            return {
                lon: a.lon + (b.lon - a.lon) * clamped,
                lat: a.lat + (b.lat - a.lat) * clamped,
                dLon: b.lon - a.lon,
                dLat: b.lat - a.lat
            };
        }
        walked += step;
    }
    const last = points[points.length - 1];
    const prev = points[points.length - 2] || last;
    return {
        lon: last?.lon || 0,
        lat: last?.lat || 0,
        dLon: (last?.lon || 0) - (prev?.lon || 0),
        dLat: (last?.lat || 0) - (prev?.lat || 0)
    };
}

function sideProbes(sample) {
    const cosLat = Math.max(0.2, Math.cos(sample.lat * Math.PI / 180));
    const tx = sample.dLon * cosLat;
    const ty = sample.dLat;
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const offset = 0.25;
    return [
        { lon: sample.lon + (nx * offset) / cosLat, lat: sample.lat + ny * offset },
        { lon: sample.lon - (nx * offset) / cosLat, lat: sample.lat - ny * offset }
    ];
}

function majority(votes) {
    const counts = new Map();
    let best = 0;
    let bestCount = 0;
    for (const vote of votes) {
        if (!vote) {
            continue;
        }
        const count = (counts.get(vote) || 0) + 1;
        counts.set(vote, count);
        if (count > bestCount || (count === bestCount && (best === 0 || vote < best))) {
            best = vote;
            bestCount = count;
        }
    }
    return best;
}

function attributeCoast(countries, points) {
    const votes = [];
    for (let i = 0; i < points.length; i += 10) {
        const point = points[i];
        if (!point) {
            continue;
        }
        votes.push(resolvePoint(countries, point.lon, point.lat, 1));
    }
    const id = majority(votes);
    return [id, id];
}

function attributeBorder(countries, points) {
    const leftVotes = [];
    const rightVotes = [];
    for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const sample = pointAtFraction(points, fraction);
        const probes = sideProbes(sample);
        leftVotes.push(resolvePoint(countries, probes[0].lon, probes[0].lat, 0.5));
        rightVotes.push(resolvePoint(countries, probes[1].lon, probes[1].lat, 0.5));
    }
    let left = majority(leftVotes);
    let right = majority(rightVotes);
    if (left && left === right) {
        const nearest = twoNearest(countries, pointAtFraction(points, 0.5).lon, pointAtFraction(points, 0.5).lat);
        left = nearest[0] || left;
        right = nearest[1] || right;
    }
    return [left, right];
}

function encodeLine(left, right, points) {
    const out = [left, right];
    let prevX = null;
    let prevY = null;
    for (const point of points) {
        const x = Math.round(point.lon * 1000);
        const y = Math.round(point.lat * 1000);
        if (prevX == null || prevY == null) {
            out.push(x, y);
        } else {
            const dx = x - prevX;
            const dy = y - prevY;
            if (dx === 0 && dy === 0) {
                continue;
            }
            out.push(dx, dy);
        }
        prevX = x;
        prevY = y;
    }
    return out.length >= 6 ? out : null;
}

function compareLines(a, b) {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i++) {
        const av = a[i] ?? 0;
        const bv = b[i] ?? 0;
        if (av !== bv) {
            return av - bv;
        }
    }
    return a.length - b.length;
}

function encodeLayer(lines) {
    const encoded = [];
    for (const line of lines) {
        if (line) {
            encoded.push(line);
        }
    }
    encoded.sort(compareLines);
    return encoded;
}

function buildCodeTable(collection) {
    const codes = [''];
    const codeIndex = new Map();
    for (const feature of collection.features || []) {
        const code = String(feature.properties?.ADM0_A3 || '').trim();
        if (!code || codeIndex.has(code)) {
            continue;
        }
        codeIndex.set(code, codes.length);
        codes.push(code);
    }
    return { codes, codeIndex };
}

function attributePrepared(countries, prepared, mode) {
    const encoded = [];
    for (const line of prepared) {
        let pair = [0, 0];
        if (mode === 'admin1') {
            const id = line.code ? 0 : 0;
            pair = [id, id];
        }
        encoded.push(null);
        line.pair = pair;
    }
    return encoded;
}

function codeId(codeIndex, code) {
    if (!code) {
        return 0;
    }
    return codeIndex.get(code) || 0;
}

function finishLayer(countries, prepared, mode, codeIndex) {
    const encoded = [];
    for (const line of prepared) {
        let pair;
        if (mode === 'admin1') {
            const id = codeId(codeIndex, line.code);
            pair = [id, id];
        } else if (mode === 'border') {
            pair = attributeBorder(countries, line.points);
        } else {
            pair = attributeCoast(countries, line.points);
        }
        encoded.push(encodeLine(pair[0] || 0, pair[1] || 0, line.points));
    }
    return encodeLayer(encoded);
}

function assemble(codes, layers) {
    return {
        v: 1,
        source: 'Natural Earth vector v5.1.2',
        scale: 1000,
        codes,
        layers: {
            coast: layers.coast || [],
            border: layers.border || [],
            lake: layers.lake || [],
            admin1: layers.admin1 || []
        }
    };
}

function measure(doc) {
    const text = `${JSON.stringify(doc)}\n`;
    const raw = Buffer.byteLength(text);
    const gzip = gzipSync(Buffer.from(text)).length;
    return { text, raw, gzip };
}

function vertexCount(layers) {
    let count = 0;
    for (const name of ['coast', 'border', 'lake', 'admin1']) {
        for (const line of layers[name] || []) {
            count += 1 + Math.max(0, (line.length - 4) / 2);
        }
    }
    return count;
}

console.log('Loading 110m countries…');
const countriesDoc = readJson(countriesPath);
const { codes, codeIndex } = buildCodeTable(countriesDoc);
const countries = buildCountries(countriesDoc, codeIndex);
console.log(`countries ${countries.length}, codes ${codes.length - 1}`);

function loadFeatures(name) {
    return readJson(`${srcDir}/${name}`).features || [];
}

console.log('Simplifying 50m sources…');
const coast50 = prepareLines(loadFeatures('ne_50m_coastline.geojson'), 0.02, 0, false);
const border50 = prepareLines(loadFeatures('ne_50m_admin_0_boundary_lines_land.geojson'), 0.02, 0, false);
const lakes50Regional = prepareLines(loadFeatures('ne_50m_lakes.geojson'), 0.02, 0.1, true);
const lakes50Local = prepareLines(loadFeatures('ne_50m_lakes.geojson'), 0.01, 0.05, true);
const border10 = prepareLines(loadFeatures('ne_10m_admin_0_boundary_lines_land.geojson'), 0.015, 0, false);
const admin1 = prepareLines(loadFeatures('ne_50m_admin_1_states_provinces_lines.geojson'), 0.01, 0, false);
const coast10Source = loadFeatures('ne_10m_coastline.geojson');

console.log('Attributing regional file…');
const regionalLayers = {
    coast: finishLayer(countries, coast50, 'coast', codeIndex),
    border: finishLayer(countries, border50, 'border', codeIndex),
    lake: finishLayer(countries, lakes50Regional, 'coast', codeIndex),
    admin1: []
};
const regional = assemble(codes, regionalLayers);
const regionalSize = measure(regional);
console.log(`50m raw ${regionalSize.raw} gzip ${regionalSize.gzip} vertices ${vertexCount(regionalLayers)}`);
if (regionalSize.raw > RAW_CAP['50m'] || regionalSize.gzip > GZIP_CAP['50m']) {
    throw new Error(`50m file exceeds cap raw ${regionalSize.raw} gzip ${regionalSize.gzip}`);
}

console.log('Attributing shared local layers…');
const localBorder = finishLayer(countries, border10, 'border', codeIndex);
const localAdmin = finishLayer(countries, admin1, 'admin1', codeIndex);
const localLakes = finishLayer(countries, lakes50Local, 'coast', codeIndex);

let coastTolerance = 0.03;
let local = null;
let localSize = null;
let used50Coast = false;
while (coastTolerance <= 0.04 + 1e-9) {
    console.log(`Simplifying 10m coast at ${coastTolerance.toFixed(3)}°…`);
    const coast10 = prepareLines(coast10Source, coastTolerance, 0.05, false);
    console.log(`Attributing 10m coast (${coast10.length} lines)…`);
    const localLayers = {
        coast: finishLayer(countries, coast10, 'coast', codeIndex),
        border: localBorder,
        lake: localLakes,
        admin1: localAdmin
    };
    local = assemble(codes, localLayers);
    localSize = measure(local);
    console.log(`10m raw ${localSize.raw} gzip ${localSize.gzip} vertices ${vertexCount(localLayers)} tol ${coastTolerance}`);
    if (localSize.raw <= RAW_CAP['10m'] && localSize.gzip <= GZIP_CAP['10m']) {
        break;
    }
    const next = Math.round((coastTolerance + 0.005) * 1000) / 1000;
    if (next > 0.04) {
        local = null;
        break;
    }
    coastTolerance = next;
}

if (!local || !localSize || localSize.raw > RAW_CAP['10m'] || localSize.gzip > GZIP_CAP['10m']) {
    console.log('10m coast still over cap; shipping 50m coast in the local file');
    used50Coast = true;
    const localLayers = {
        coast: regionalLayers.coast,
        border: localBorder,
        lake: localLakes,
        admin1: localAdmin
    };
    local = assemble(codes, localLayers);
    localSize = measure(local);
    console.log(`10m-with-50m-coast raw ${localSize.raw} gzip ${localSize.gzip}`);
    if (localSize.raw > RAW_CAP['10m'] || localSize.gzip > GZIP_CAP['10m']) {
        throw new Error(`local file exceeds cap raw ${localSize.raw} gzip ${localSize.gzip}`);
    }
}

writeFileSync(`${outDir}/globe-lines-50m.v1.json`, regionalSize.text);
writeFileSync(`${outDir}/globe-lines-10m.v1.json`, localSize.text);
console.log(JSON.stringify({
    regional: { raw: regionalSize.raw, gzip: regionalSize.gzip },
    local: { raw: localSize.raw, gzip: localSize.gzip, coastTolerance, used50Coast }
}, null, 2));
