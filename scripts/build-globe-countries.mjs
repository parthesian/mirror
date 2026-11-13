/**
 * Offline Natural Earth country builder.
 *
 * Not part of `npm run build`. Download Natural Earth's 50m admin-0
 * countries GeoJSON and pass it with --src. Writes the TopoJSON the globe
 * explorer fetches for country picking, the hover outline and the far-view
 * coast and border lines. Fails if the output grows past its byte cap.
 *
 *   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
 *   node scripts/build-globe-countries.mjs --src ne_50m_admin_0_countries.geojson
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { topology } from 'topojson-server';
import { presimplify, quantile, simplify } from 'topojson-simplify';

const RAW_CAP = 280 * 1024;
const GZIP_CAP = 85 * 1024;
/** 1e4 steps across 360° is about 4 km, under a pixel until the tiles take over. */
const QUANTIZATION = 1e4;
/** Keeps the quarter of vertices whose triangles carry the most area. */
const SIMPLIFY_QUANTILE = 0.25;

function arg(name, fallback) {
    const index = process.argv.indexOf(name);
    return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

const src = arg('--src', '');
const out = arg('--out', 'public/data/globe-countries-50m.v1.json');
if (!src) {
    console.error('Pass --src <ne_50m_admin_0_countries.geojson>');
    process.exit(1);
}

const clean = (value) => {
    const text = String(value ?? '').trim();
    return text === '-99' ? '' : text;
};

function countryProperties(props) {
    const names = [
        props.NAME,
        props.NAME_LONG,
        props.BRK_NAME,
        props.FORMAL_EN,
        props.ADMIN,
        props.ABBREV,
        props.ISO_A2,
        props.ISO_A3
    ].map(clean).filter(Boolean);
    return {
        name: clean(props.ADMIN || props.NAME || props.BRK_NAME || props.NAME_LONG),
        names: [...new Set(names)],
        iso2: clean(props.ISO_A2),
        iso3: clean(props.ISO_A3),
        adm0a3: clean(props.ADM0_A3)
    };
}

const source = JSON.parse(readFileSync(src, 'utf8'));
const features = source.features
    .filter((feature) => ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type))
    .map((feature) => ({ ...feature, properties: countryProperties(feature.properties || {}) }))
    .filter((feature) => feature.properties.name);

/** topojson-simplify returns absolute arcs. Quantize and delta-encode them again. */
function quantize(topo) {
    const [x0, y0, x1, y1] = topo.bbox;
    const kx = (x1 - x0) / (QUANTIZATION - 1);
    const ky = (y1 - y0) / (QUANTIZATION - 1);
    const arcs = topo.arcs.map((arc) => {
        const out = [];
        let px = 0;
        let py = 0;
        arc.forEach(([x, y], i) => {
            const qx = Math.round((x - x0) / kx);
            const qy = Math.round((y - y0) / ky);
            if (i > 0 && i < arc.length - 1 && qx === px && qy === py) return;
            out.push([qx - px, qy - py]);
            px = qx;
            py = qy;
        });
        return out;
    });
    const round = (value) => Math.round(value * 1000) / 1000;
    const geometries = topo.objects.countries.geometries.map(({ type, arcs: refs, bbox, properties }) => ({
        type,
        arcs: refs,
        bbox: bbox.map(round),
        properties
    }));
    return {
        type: 'Topology',
        transform: { scale: [kx, ky], translate: [x0, y0] },
        objects: { countries: { type: 'GeometryCollection', geometries } },
        arcs
    };
}

const presimplified = presimplify(topology({ countries: { type: 'FeatureCollection', features } }, 1e6));
const topo = quantize(simplify(presimplified, quantile(presimplified, SIMPLIFY_QUANTILE)));

const text = JSON.stringify(topo);
const gzip = gzipSync(text).length;
console.log(`${out}: ${features.length} countries, ${text.length} bytes, ${gzip} gzip`);
if (text.length > RAW_CAP || gzip > GZIP_CAP) {
    console.error(`Over the byte cap (${RAW_CAP} raw, ${GZIP_CAP} gzip)`);
    process.exit(1);
}
writeFileSync(out, text);
