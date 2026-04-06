#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import XLSX from 'xlsx';

function parsePhotoId(imageLink) {
    const match = imageLink.match(/\/api\/photos\/([0-9a-f-]{36})\//i);
    if (!match) {
        throw new Error(`Could not extract photo ID from: ${imageLink}`);
    }
    return match[1];
}

function parseLatLon(latLonStr) {
    const parts = latLonStr.split(',').map(s => s.trim());
    if (parts.length !== 2) {
        throw new Error(`Expected "lat, lon" but got: ${latLonStr}`);
    }

    const lat = Number.parseFloat(parts[0]);
    const lon = Number.parseFloat(parts[1]);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error(`Invalid coordinates: ${latLonStr}`);
    }
    if (lat < -90 || lat > 90) {
        throw new Error(`Latitude out of range (-90..90): ${lat}`);
    }
    if (lon < -180 || lon > 180) {
        throw new Error(`Longitude out of range (-180..180): ${lon}`);
    }

    return { lat, lon };
}

function escapeSql(value) {
    return String(value ?? '').replace(/'/g, "''");
}

async function main() {
    const [inputPath, outputPath = 'backfill-coordinates.sql'] = process.argv.slice(2);

    if (!inputPath) {
        console.error('Usage: node scripts/backfill-coordinates.mjs <spreadsheet.xlsx> [output.sql]');
        console.error('');
        console.error('XLSX format: two columns, first row is a header');
        console.error('  Column A: Image link  (https://.../api/photos/<id>/image?variant=full)');
        console.error('  Column B: Lat, Lon    (e.g. 35.6762, 139.6503)');
        process.exit(1);
    }

    const workbook = XLSX.readFile(inputPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rows.length < 2) {
        throw new Error('Spreadsheet must have a header row and at least one data row.');
    }

    const dataRows = rows.slice(1);
    const statements = [];

    for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const imageLink = String(row[0] || '').trim();
        const latLonStr = String(row[1] || '').trim();

        if (!imageLink || !latLonStr) {
            console.warn(`Skipping empty row ${i + 2}`);
            continue;
        }

        const photoId = parsePhotoId(imageLink);
        const { lat, lon } = parseLatLon(latLonStr);

        statements.push(
            `UPDATE photos SET latitude = ${lat}, longitude = ${lon}, country = location WHERE id = '${escapeSql(photoId)}';`
        );
    }

    if (statements.length === 0) {
        throw new Error('No valid rows found in the spreadsheet.');
    }

    const resolvedOutput = path.resolve(outputPath);
    await fs.writeFile(resolvedOutput, `${statements.join('\n')}\n`, 'utf8');

    console.log(`Wrote ${statements.length} UPDATE statements to ${resolvedOutput}`);
    console.log('');
    console.log('Run against your D1 database with:');
    console.log(`  npx wrangler d1 execute PHOTO_DB --remote --file=${outputPath}`);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
