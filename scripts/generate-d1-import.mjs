#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

function escapeSql(value) {
    return String(value ?? '').replace(/'/g, "''");
}

function normalizeMetadata(record) {
    const id = record.id || record.photoId;
    const storageKey = record.storage_key || record.storageKey || record.s3Key;
    const location = record.location || '';
    const description = record.description || '';
    const takenAt = record.taken_at || record.takenAt || record.timestamp || record.uploadedAt;
    const uploadedAt = record.uploaded_at || record.uploadedAt || record.timestamp || takenAt;

    if (!id || !storageKey || !location || !takenAt || !uploadedAt) {
        throw new Error(`Record is missing required migration fields: ${JSON.stringify(record)}`);
    }

    const latitude = record.latitude ?? null;
    const longitude = record.longitude ?? null;
    const country = record.country || '';
    const state = record.state || '';
    const camera = record.camera || '';

    return {
        id,
        storageKey,
        location,
        description,
        takenAt,
        uploadedAt,
        width: record.width ?? null,
        height: record.height ?? null,
        latitude: typeof latitude === 'number' && Number.isFinite(latitude) ? latitude : null,
        longitude: typeof longitude === 'number' && Number.isFinite(longitude) ? longitude : null,
        country,
        state,
        camera
    };
}

async function main() {
    const [inputPath, outputDirArg = 'migration-output'] = process.argv.slice(2);

    if (!inputPath) {
        console.error('Usage: node scripts/generate-d1-import.mjs <metadata.json> [output-directory]');
        process.exit(1);
    }

    const raw = await fs.readFile(inputPath, 'utf8');
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed) ? parsed : parsed.Items || parsed.items || parsed.photos || [];

    if (!Array.isArray(records) || records.length === 0) {
        throw new Error('No metadata records were found in the provided JSON file.');
    }

    const normalized = records.map(normalizeMetadata);
    const outputDir = path.resolve(outputDirArg);
    await fs.mkdir(outputDir, { recursive: true });

    const sqlPath = path.join(outputDir, 'photo-metadata-import.sql');
    const manifestPath = path.join(outputDir, 'r2-copy-manifest.json');

    const sqlStatements = normalized.map(record => {
        const width = Number.isInteger(record.width) ? record.width : 'NULL';
        const height = Number.isInteger(record.height) ? record.height : 'NULL';
        const latitude = record.latitude !== null ? record.latitude : 'NULL';
        const longitude = record.longitude !== null ? record.longitude : 'NULL';
        const country = escapeSql(record.country);
        const state = escapeSql(record.state);

        const camera = escapeSql(record.camera);

        return `INSERT INTO photos (id, storage_key, location, description, taken_at, uploaded_at, width, height, latitude, longitude, country, state, camera) VALUES ('${escapeSql(record.id)}', '${escapeSql(record.storageKey)}', '${escapeSql(record.location)}', '${escapeSql(record.description)}', '${escapeSql(record.takenAt)}', '${escapeSql(record.uploadedAt)}', ${width}, ${height}, ${latitude}, ${longitude}, '${country}', '${state}', '${camera}');`;
    });

    const copyManifest = normalized.map(record => ({
        id: record.id,
        sourceKey: record.storageKey,
        destinationKey: record.storageKey
    }));

    await fs.writeFile(sqlPath, `${sqlStatements.join('\n')}\n`, 'utf8');
    await fs.writeFile(manifestPath, `${JSON.stringify(copyManifest, null, 2)}\n`, 'utf8');

    console.log(`Wrote ${normalized.length} SQL inserts to ${sqlPath}`);
    console.log(`Wrote R2 copy manifest to ${manifestPath}`);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
