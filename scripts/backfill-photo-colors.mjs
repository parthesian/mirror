#!/usr/bin/env node

/**
 * Backfill ordered top-color metadata for existing photos.
 *
 * Preferred path — run on Cloudflare itself (after deploying this branch
 * and applying migrations/0006_add_colors.sql):
 *
 *   npx wrangler d1 execute PHOTO_DB --remote --file=migrations/0006_add_colors.sql
 *
 * Then either click "compute missing colors" on /admin/, or loop the
 * Access-protected worker from a signed-in session:
 *
 *   curl -X POST https://YOUR_DOMAIN/api/admin/backfill-colors
 *
 * This local script is the offline / wrangler alternative. It lists photos
 * from D1, samples a tiny JPEG through Cloudflare Image Transformations,
 * classifies pixels into the shared 12-color palette, and writes JSON
 * arrays such as ["blue","green","white"] back to D1.
 *
 *   node scripts/backfill-photo-colors.mjs --remote --site https://YOUR_DOMAIN
 */

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const PhotoColors = require('../js/photoColors.js');
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_DATABASE = 'PHOTO_DB';
const DEFAULT_BATCH = 25;
const SAMPLE_PATH = (id) => (
    `/cdn-cgi/image/width=96,height=96,fit=scale-down,quality=70,format=jpeg/api/photos/${encodeURIComponent(id)}/image`
);

function parseArgs(argv) {
    const options = {
        remote: false,
        dryRun: false,
        force: false,
        site: '',
        database: DEFAULT_DATABASE,
        limit: 0,
        batch: DEFAULT_BATCH
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];
        if (arg === '--remote') options.remote = true;
        else if (arg === '--dry-run') options.dryRun = true;
        else if (arg === '--force') options.force = true;
        else if (arg === '--site' && next) {
            options.site = next.replace(/\/$/, '');
            index += 1;
        } else if (arg === '--database' && next) {
            options.database = next;
            index += 1;
        } else if (arg === '--limit' && next) {
            options.limit = Number.parseInt(next, 10) || 0;
            index += 1;
        } else if (arg === '--batch' && next) {
            options.batch = Number.parseInt(next, 10) || DEFAULT_BATCH;
            index += 1;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return options;
}

function printUsage() {
    console.log(`Usage: node scripts/backfill-photo-colors.mjs --site https://YOUR_DOMAIN [--remote] [--dry-run] [--force]

Options:
  --site URL       Live gallery origin used to sample 96px JPEGs
  --remote         Talk to the remote D1 database (otherwise local)
  --dry-run        Classify colors but do not write
  --force          Recompute photos that already have colors
  --database NAME  D1 database or binding name (default: PHOTO_DB)
  --limit N        Process at most N photos
  --batch N        Photos per D1 write (default: ${DEFAULT_BATCH})
`);
}

function escapeSql(value) {
    return String(value ?? '').replace(/'/g, "''");
}

function extractD1Rows(parsed) {
    if (Array.isArray(parsed)) {
        for (const item of parsed) {
            if (Array.isArray(item?.results)) {
                return item.results;
            }
            if (Array.isArray(item?.result)) {
                return item.result;
            }
        }
    }
    if (Array.isArray(parsed?.results)) {
        return parsed.results;
    }
    if (Array.isArray(parsed?.result?.[0]?.results)) {
        return parsed.result[0].results;
    }
    return [];
}

async function runWrangler(args) {
    const { stdout, stderr } = await execFileAsync('npx', ['wrangler', ...args], {
        cwd: ROOT_DIR,
        maxBuffer: 10 * 1024 * 1024
    });
    if (stderr && /error/i.test(stderr) && !stdout.trim()) {
        throw new Error(stderr.trim());
    }
    return stdout;
}

async function d1Json(database, remote, command) {
    const args = ['d1', 'execute', database, '--json', '--command', command];
    if (remote) {
        args.splice(3, 0, '--remote');
    }
    const stdout = await runWrangler(args);
    const start = stdout.indexOf('{') === -1 ? stdout.indexOf('[') : Math.min(
        ...[stdout.indexOf('{'), stdout.indexOf('[')].filter((index) => index >= 0)
    );
    const parsed = JSON.parse(start >= 0 ? stdout.slice(start) : stdout);
    return extractD1Rows(parsed);
}

async function d1Exec(database, remote, command) {
    const args = ['d1', 'execute', database, '--command', command];
    if (remote) {
        args.splice(3, 0, '--remote');
    }
    await runWrangler(args);
}

async function loadJpegDecoder() {
    try {
        return require('jpeg-js');
    } catch {
        throw new Error('jpeg-js is required. Run `npm install` and try again.');
    }
}

function colorsFromJpeg(jpeg, bytes) {
    const decoded = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 64 });
    if (!decoded?.data?.length) {
        throw new Error('JPEG decoder returned no pixel data.');
    }
    return PhotoColors.extractColorsFromRgba(decoded.data);
}

async function fetchSample(site, photoId) {
    const url = `${site}${SAMPLE_PATH(photoId)}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${url}`);
    }
    return new Uint8Array(await response.arrayBuffer());
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printUsage();
        return;
    }
    if (!options.site) {
        printUsage();
        throw new Error('Pass --site https://your-gallery-domain so the script can sample photos.');
    }

    const jpeg = await loadJpegDecoder();
    const where = options.force ? '' : "WHERE colors IS NULL OR TRIM(colors) = ''";
    const limitSql = options.limit > 0 ? ` LIMIT ${options.limit}` : '';
    const rows = await d1Json(
        options.database,
        options.remote,
        `SELECT id FROM photos ${where} ORDER BY taken_at DESC, uploaded_at DESC, id DESC${limitSql};`
    );

    if (!rows.length) {
        console.log('No photos need color metadata.');
        return;
    }

    console.log(`Found ${rows.length} photo${rows.length === 1 ? '' : 's'} to classify.`);
    const updates = [];

    for (let index = 0; index < rows.length; index += 1) {
        const photoId = rows[index].id;
        try {
            const bytes = await fetchSample(options.site, photoId);
            const colors = colorsFromJpeg(jpeg, bytes);
            const serialized = PhotoColors.serializeColors(colors);
            updates.push({ id: photoId, colors, serialized });
            console.log(`${index + 1}/${rows.length} ${photoId} -> ${serialized}`);
        } catch (error) {
            console.warn(`${index + 1}/${rows.length} ${photoId} failed: ${error.message}`);
        }
    }

    if (!updates.length) {
        throw new Error('No photos could be classified.');
    }
    if (options.dryRun) {
        console.log(`Dry run complete. ${updates.length} updates were not written.`);
        return;
    }

    for (let index = 0; index < updates.length; index += options.batch) {
        const chunk = updates.slice(index, index + options.batch);
        const sql = chunk
            .map((item) => `UPDATE photos SET colors = '${escapeSql(item.serialized)}' WHERE id = '${escapeSql(item.id)}';`)
            .join('\n');
        await d1Exec(options.database, options.remote, sql);
        console.log(`Wrote ${Math.min(index + chunk.length, updates.length)}/${updates.length} updates.`);
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
