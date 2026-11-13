/**
 * The explorer's MapLibre style: mirror's silver ink over a dark globe.
 *
 * Far out, the photo (a custom layer under everything here) carries the
 * globe and Natural Earth hairlines draw coasts and borders. Once the globe
 * fills the screen, the same Blue Marble imagery arrives as NASA GIBS
 * tiles, remapped to the lit photo's tones. Past BANDS.tiles the VersaTiles
 * basemap fades in on top: water at the photo's ocean tone, so coasts turn
 * crisp without a brightness jump, then admin-1 lines, roads and labels as
 * their zooms arrive. GIBS stops at zoom 8, so its tiles fade back out to the softened
 * photo before they blur. No tiled layer starts below BANDS.imagery.in, so
 * the far view fetches nothing but the photo and the country file.
 *
 * Colours are written before the explorer canvas's grayscale filter.
 *
 * Classic script. Sets window.GlobeStyle.
 */
(function attachGlobeStyle(root) {
    const INK = '#E3E8EC';
    const ADMIN1 = '#C5CCD3';
    /** Matches the lit photo's ocean once the canvas filter has run. */
    const WATER = '#1a1c1f';
    const HALO = 'rgba(8, 9, 10, 0.82)';

    const BANDS = {
        imagery: { in: [3, 3.8], out: [8.5, 10] },
        tiles: 3.5,
        handoff: [3.6, 4.4],
        soften: [4.5, 8]
    };

    const TILES = 'https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}';
    const IMAGERY = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
    /**
     * GIBS sits darker than the hazy 2048px photo. This sRGB remap lands its
     * land on the photo as lit at the centre of the view. Ice comes out a
     * little brighter; the remap is linear and cannot bend only the top.
     */
    const IMAGERY_TONE = { min: 0.055, max: 0.8 };
    const GLYPHS = 'https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf';

    /** The old ink levels: world, regional and local, now by zoom. */
    const ALPHA = {
        coast: [0.2, 0.26, 0.32],
        border: [0.36, 0.44, 0.52],
        lake: [0.12, 0.18, 0.24],
        admin1: 0.26,
        hover: 0.9
    };

    const zoomRamp = (stops) => ['interpolate', ['linear'], ['zoom'], ...stops.flat()];
    const fadeIn = ([from, to], value) => zoomRamp([[from, 0], [to, value]]);
    const label = ['coalesce', ['get', 'name_en'], ['get', 'name']];

    function inkColor(color, alpha) {
        const n = Number.parseInt(color.slice(1), 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }

    /** Photo-to-flat-tone blend for the earth layer, by zoom. */
    function soften(zoom) {
        const [from, to] = BANDS.soften;
        const t = Math.min(Math.max((zoom - from) / (to - from), 0), 1);
        return 0.35 * t * t * (3 - 2 * t);
    }

    /** Lines one device pixel wide. Thin lines read darker on 1x screens. */
    function hairline(dpr) {
        return { width: 1 / Math.max(dpr, 1), alpha: dpr < 1.5 ? 0.75 : 1 };
    }

    /** Natural Earth hairlines. They hand off to the tiles unless there are none. */
    function datasetLines(line, saveData) {
        return ['coast', 'border'].map((kind) => {
            const [world, regional, local] = ALPHA[kind].map((alpha) => alpha * line.alpha);
            const opacity = saveData
                ? zoomRamp([[2.5, world], [4, regional], [6, local]])
                : zoomRamp([[2.5, world], [BANDS.handoff[0], regional], [BANDS.handoff[1], 0]]);
            return {
                id: `countries-${kind}`,
                type: 'line',
                source: 'countries',
                filter: ['==', ['get', 'kind'], kind],
                layout: { 'line-join': 'round' },
                paint: { 'line-color': INK, 'line-width': line.width, 'line-opacity': opacity }
            };
        });
    }

    function basemapLayers(line) {
        const ink = (alpha) => inkColor(INK, alpha);
        const roads = (id, kinds, minzoom, stops) => ({
            id,
            type: 'line',
            source: 'basemap',
            'source-layer': 'streets',
            minzoom,
            filter: ['in', ['get', 'kind'], ['literal', kinds]],
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': INK,
                'line-width': zoomRamp([[minzoom, line.width], [13, Math.max(line.width, 0.9)]]),
                'line-opacity': zoomRamp(stops.map(([z, a]) => [z, a * line.alpha]))
            }
        });
        const places = (id, kinds, minzoom, size, alpha) => ({
            id,
            type: 'symbol',
            source: 'basemap',
            'source-layer': 'place_labels',
            minzoom,
            filter: ['in', ['get', 'kind'], ['literal', kinds]],
            layout: {
                'text-field': label,
                'text-font': ['roboto_regular'],
                'text-size': zoomRamp([[minzoom, size[0]], [minzoom + 4, size[1]]]),
                'text-max-width': 8,
                'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'population'], 0]]
            },
            paint: {
                'text-color': ink(alpha),
                'text-halo-color': HALO,
                'text-halo-width': 1.2,
                'text-opacity': fadeIn([minzoom, minzoom + 0.5], 1)
            }
        });
        const under = [
            {
                id: 'imagery',
                type: 'raster',
                source: 'imagery',
                minzoom: BANDS.imagery.in[0],
                paint: {
                    'raster-opacity': zoomRamp([
                        [BANDS.imagery.in[0], 0],
                        [BANDS.imagery.in[1], 1],
                        [BANDS.imagery.out[0], 1],
                        [BANDS.imagery.out[1], 0]
                    ]),
                    'raster-brightness-min': IMAGERY_TONE.min,
                    'raster-brightness-max': IMAGERY_TONE.max,
                    'raster-fade-duration': 200
                }
            },
            {
                id: 'land-tone',
                type: 'fill',
                source: 'basemap',
                'source-layer': 'land',
                minzoom: 7,
                paint: {
                    'fill-antialias': false,
                    'fill-color': ['match', ['get', 'kind'],
                        ['forest', 'wood'], '#000000',
                        ['glacier', 'sand', 'beach', 'bare_rock', 'scree'], '#ffffff',
                        ['residential', 'commercial', 'industrial', 'retail'], '#ffffff',
                        'rgba(0, 0, 0, 0)'],
                    'fill-opacity': fadeIn([7, 8.5], 0.07)
                }
            },
            {
                id: 'ocean',
                type: 'fill',
                source: 'basemap',
                'source-layer': 'ocean',
                minzoom: BANDS.tiles,
                paint: {
                    'fill-color': WATER,
                    'fill-outline-color': ink(ALPHA.coast[1] * line.alpha),
                    'fill-opacity': fadeIn(BANDS.handoff, 0.94)
                }
            },
            {
                id: 'water',
                type: 'fill',
                source: 'basemap',
                'source-layer': 'water_polygons',
                minzoom: BANDS.tiles,
                paint: {
                    'fill-color': WATER,
                    'fill-outline-color': ink(ALPHA.lake[2] * line.alpha),
                    'fill-opacity': fadeIn(BANDS.handoff, 0.94)
                }
            }
        ];
        const over = [
            {
                id: 'rivers',
                type: 'line',
                source: 'basemap',
                'source-layer': 'water_lines',
                minzoom: 8,
                filter: ['in', ['get', 'kind'], ['literal', ['river', 'canal']]],
                paint: {
                    'line-color': INK,
                    'line-width': line.width,
                    'line-opacity': fadeIn([8, 10], ALPHA.lake[2] * line.alpha)
                }
            },
            roads('roads-minor', ['secondary', 'tertiary', 'residential', 'unclassified', 'living_street'], 10, [[10, 0], [11, 0.1], [13, 0.16]]),
            roads('roads-major', ['motorway', 'trunk', 'primary'], 6.5, [[6.5, 0], [7.5, 0.14], [11, 0.26]]),
            {
                id: 'admin1',
                type: 'line',
                source: 'basemap',
                'source-layer': 'boundaries',
                minzoom: 5,
                filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], true]],
                layout: { 'line-join': 'round' },
                paint: {
                    'line-color': ADMIN1,
                    'line-width': line.width,
                    'line-opacity': fadeIn([5, 6], ALPHA.admin1 * line.alpha)
                }
            },
            {
                id: 'borders',
                type: 'line',
                source: 'basemap',
                'source-layer': 'boundaries',
                minzoom: BANDS.tiles,
                filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], true]],
                layout: { 'line-join': 'round' },
                paint: {
                    'line-color': INK,
                    'line-width': line.width,
                    'line-opacity': ['interpolate', ['linear'], ['zoom'],
                        BANDS.handoff[0], 0,
                        BANDS.handoff[1], ALPHA.border[1] * line.alpha,
                        6, ALPHA.border[2] * line.alpha]
                }
            },
            {
                id: 'lake-labels',
                type: 'symbol',
                source: 'basemap',
                'source-layer': 'water_polygons_labels',
                minzoom: 7,
                filter: ['>=', ['coalesce', ['get', 'way_area'], 0], 1e6],
                layout: {
                    'text-field': label,
                    'text-font': ['roboto_light_italic'],
                    'text-size': 11,
                    'text-max-width': 7
                },
                paint: { 'text-color': inkColor(ADMIN1, 0.5), 'text-halo-color': HALO, 'text-halo-width': 1 }
            },
            {
                id: 'region-labels',
                type: 'symbol',
                source: 'basemap',
                'source-layer': 'boundary_labels',
                minzoom: 6,
                maxzoom: 10,
                filter: ['==', ['get', 'admin_level'], 4],
                layout: {
                    'text-field': label,
                    'text-font': ['roboto_light'],
                    'text-transform': 'uppercase',
                    'text-letter-spacing': 0.18,
                    'text-size': 10,
                    'text-max-width': 9
                },
                paint: {
                    'text-color': inkColor(ADMIN1, 0.42),
                    'text-halo-color': HALO,
                    'text-halo-width': 1,
                    'text-opacity': fadeIn([6, 6.6], 1)
                }
            },
            {
                id: 'country-labels',
                type: 'symbol',
                source: 'basemap',
                'source-layer': 'boundary_labels',
                minzoom: BANDS.tiles,
                maxzoom: 9,
                filter: ['==', ['get', 'admin_level'], 2],
                layout: {
                    'text-field': label,
                    'text-font': ['roboto_light'],
                    'text-transform': 'uppercase',
                    'text-letter-spacing': 0.28,
                    'text-size': zoomRamp([[3.5, 10], [7, 13]]),
                    'text-max-width': 8,
                    'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'way_area'], 0]]
                },
                paint: {
                    'text-color': ink(0.6),
                    'text-halo-color': HALO,
                    'text-halo-width': 1.2,
                    'text-opacity': fadeIn(BANDS.handoff, 1)
                }
            },
            places('village-labels', ['village', 'suburb', 'quarter', 'neighbourhood'], 11, [10, 12], 0.6),
            places('town-labels', ['town'], 8.5, [10.5, 12.5], 0.7),
            places('city-labels', ['city', 'state_capital'], 5.5, [10.5, 13.5], 0.76),
            places('capital-labels', ['capital'], 4.2, [11, 14], 0.84)
        ];
        return { under, over };
    }

    function hoverLayers(line) {
        return ['a', 'b'].map((slot) => ({
            id: `country-hover-${slot}`,
            type: 'line',
            source: `country-hover-${slot}`,
            layout: { 'line-join': 'round' },
            paint: {
                'line-color': '#FFFFFF',
                'line-width': line.width,
                'line-opacity': 0
            }
        }));
    }

    /**
     * @param {{ dpr: number, saveData: boolean, countries: object }} options
     */
    function build({ dpr, saveData, countries }) {
        const line = hairline(dpr);
        const empty = { type: 'FeatureCollection', features: [] };
        const sources = {
            countries: { type: 'geojson', data: countries, tolerance: 0.2 },
            'country-hover-a': { type: 'geojson', data: empty },
            'country-hover-b': { type: 'geojson', data: empty }
        };
        if (!saveData) {
            sources.basemap = {
                type: 'vector',
                tiles: [TILES],
                maxzoom: 14,
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://versatiles.org">VersaTiles</a>'
            };
            sources.imagery = {
                type: 'raster',
                tiles: [IMAGERY],
                tileSize: 256,
                maxzoom: 8,
                attribution: '<a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a>'
            };
        }
        const basemap = saveData ? { under: [], over: [] } : basemapLayers(line);
        return {
            version: 8,
            projection: { type: 'vertical-perspective' },
            sky: { 'atmosphere-blend': 0 },
            glyphs: GLYPHS,
            sources,
            layers: [
                ...basemap.under,
                ...datasetLines(line, saveData),
                ...basemap.over,
                ...hoverLayers(line)
            ]
        };
    }

    root.GlobeStyle = { build, soften, hairline, BANDS, ALPHA, WATER };
})(window);
