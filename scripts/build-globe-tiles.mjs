/**
 * Offline Natural Earth tile slicer.
 *
 * Not part of `npm run build`. Download NE1_50M_SR.zip into a temp directory
 * and pass the TIFF plus its world file. Writes the versioned JPEG tiles the
 * explorer fetches, and fails if a tile or the tree exceeds its byte cap.
 *
 *   node scripts/build-globe-tiles.mjs \
 *     --src /tmp/NE1_50M_SR/NE1_50M_SR.tif \
 *     --tfw /tmp/NE1_50M_SR/NE1_50M_SR.tfw \
 *     --out public/data/globe-tiles/v1
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const WIDTH = 10800;
const HEIGHT = 5400;
const TILE = 450;
const COLS = 24;
const ROWS = 12;
const MAX_TILE_BYTES = 80000;
const MAX_TREE_BYTES = 20000000;
const QUALITIES = [80, 74, 68, 62];
const PIXEL_X = 0.03333333333333;
const PIXEL_Y = -0.03333333333333;
const ORIGIN_X = -179.98333333333333;
const ORIGIN_Y = 89.98333333333333;

function arg(name) {
    const index = process.argv.indexOf(name);
    if (index === -1) {
        return '';
    }
    return process.argv[index + 1] || '';
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

const srcPath = arg('--src');
const tfwPath = arg('--tfw');
const outDir = arg('--out');
if (!srcPath || !tfwPath || !outDir) {
    fail('Pass --src <tif> --tfw <tfw> --out <dir>');
}

let sharp;
try {
    const imported = await import('sharp');
    sharp = imported.default;
} catch {
    console.error('npm install --no-save sharp');
    process.exit(1);
}

function near(actual, expected, tolerance) {
    return Math.abs(actual - expected) <= tolerance;
}

function checkWorldFile(path) {
    const text = readFileSync(path, 'utf8');
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    if (lines.length < 6) {
        fail(`world file ${path} needs 6 values`);
    }
    const pixelX = Number(lines[0]);
    const pixelY = Number(lines[3]);
    const originX = Number(lines[4]);
    const originY = Number(lines[5]);
    if (!near(pixelX, PIXEL_X, 1e-9) || !near(pixelY, PIXEL_Y, 1e-9)) {
        fail(`world file pixel size ${pixelX}, ${pixelY} is not 1/30 degree`);
    }
    if (!near(originX, ORIGIN_X, 1e-6) || !near(originY, ORIGIN_Y, 1e-6)) {
        fail(`world file origin ${originX}, ${originY} is not the expected upper-left center`);
    }
}

async function checkRaster(path) {
    const meta = await sharp(path, { limitInputPixels: false }).metadata();
    if (meta.width !== WIDTH || meta.height !== HEIGHT) {
        fail(`TIFF size ${meta.width}x${meta.height}, expected ${WIDTH}x${HEIGHT}`);
    }
    if (meta.channels !== 3) {
        fail(`TIFF has ${meta.channels} channels, expected 3`);
    }
    if (meta.depth !== 'uchar') {
        fail(`TIFF depth ${meta.depth}, expected 8-bit uchar`);
    }
    const decoded = await sharp(path, { limitInputPixels: false })
        .toColourspace('srgb')
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== WIDTH || decoded.info.height !== HEIGHT || decoded.info.channels !== 3) {
        fail(
            `decoded raster ${decoded.info.width}x${decoded.info.height}x${decoded.info.channels}, expected ${WIDTH}x${HEIGHT}x3`,
        );
    }
    return decoded.data;
}

function extractTile(data, row, col) {
    const tile = Buffer.allocUnsafe(TILE * TILE * 3);
    for (let y = 0; y < TILE; y += 1) {
        const src = ((row * TILE + y) * WIDTH + col * TILE) * 3;
        data.copy(tile, y * TILE * 3, src, src + TILE * 3);
    }
    return tile;
}

async function encodeTile(tile) {
    let encoded = null;
    for (const quality of QUALITIES) {
        encoded = await sharp(tile, { raw: { width: TILE, height: TILE, channels: 3 } })
            .jpeg({
                quality,
                mozjpeg: true,
                chromaSubsampling: '4:2:0',
            })
            .toBuffer();
        if (encoded.length <= MAX_TILE_BYTES) {
            return encoded;
        }
    }
    return encoded;
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

checkWorldFile(resolve(tfwPath));
const raster = await checkRaster(resolve(srcPath));

const resolvedOut = resolve(outDir);
const parent = dirname(resolvedOut);
mkdirSync(parent, { recursive: true });
const staging = join(parent, `.${basename(resolvedOut)}-staging-${process.pid}`);
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

let total = 0;
let minBytes = Infinity;
let maxBytes = 0;
try {
    for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
            const encoded = await encodeTile(extractTile(raster, row, col));
            if (!encoded || encoded.length > MAX_TILE_BYTES) {
                throw new Error(`tile r${pad2(row)} c${pad2(col)} exceeds ${MAX_TILE_BYTES} bytes`);
            }
            const name = `r${pad2(row)}-c${pad2(col)}.jpg`;
            writeFileSync(join(staging, name), encoded);
            total += encoded.length;
            if (encoded.length < minBytes) minBytes = encoded.length;
            if (encoded.length > maxBytes) maxBytes = encoded.length;
        }
        console.log(`encoded rows 0..${pad2(row)} (${total} bytes)`);
    }
    if (total > MAX_TREE_BYTES) {
        throw new Error(`tile tree is ${total} bytes, ceiling is ${MAX_TREE_BYTES}`);
    }
    const manifest = {
        version: 1,
        source: 'NE1_50M_SR',
        sourceVersion: '3.2.0',
        width: WIDTH,
        height: HEIGHT,
        tileSize: TILE,
        cols: COLS,
        rows: ROWS,
        tileDeg: 15,
        jpegQuality: 80,
        maxTileBytes: MAX_TILE_BYTES,
    };
    writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const backup = join(parent, `.${basename(resolvedOut)}-replacing-${process.pid}`);
    rmSync(backup, { recursive: true, force: true });
    let moved = false;
    try {
        renameSync(resolvedOut, backup);
        moved = true;
    } catch (err) {
        if (!err || err.code !== 'ENOENT') {
            throw err;
        }
    }
    try {
        renameSync(staging, resolvedOut);
    } catch (err) {
        if (moved) {
            renameSync(backup, resolvedOut);
        }
        throw err;
    }
    rmSync(backup, { recursive: true, force: true });
    console.log(
        `wrote ${COLS * ROWS} tiles, ${total} bytes, min ${minBytes}, max ${maxBytes} -> ${resolvedOut}`,
    );
} catch (err) {
    rmSync(staging, { recursive: true, force: true });
    const message = err instanceof Error ? err.message : String(err);
    fail(message);
}
