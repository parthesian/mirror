/**
 * Local gallery stand-in. Serves the public site plus coloured photos of
 * mixed aspect ratios so masonry and filter transitions can be tested
 * without D1/R2. Production Pages still talks to the real photo API.
 *
 *   node scripts/mock-photos-server.mjs
 *   open http://127.0.0.1:4173/?mock=1
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const MockPhotos = require('../js/mockPhotos.js');

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || '127.0.0.1';

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2'
};

const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://${host}:${port}`);
    const mockResponse = MockPhotos.handleRequest(url.toString());
    if (mockResponse) {
        writeWhatwgResponse(response, mockResponse);
        return;
    }

    let filePath = path.normalize(path.join(repoRoot, decodeURIComponent(url.pathname)));
    if (!filePath.startsWith(repoRoot)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
    }
    if (url.pathname === '/' || url.pathname.endsWith('/')) {
        filePath = path.join(filePath, 'index.html');
    }

    fs.stat(filePath, (error, stat) => {
        if (error || !stat.isFile()) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return;
        }
        const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': type });
        fs.createReadStream(filePath).pipe(response);
    });
});

function writeWhatwgResponse(nodeResponse, whatwgResponse) {
    Promise.resolve(whatwgResponse).then(async (res) => {
        const headers = {};
        res.headers.forEach((value, key) => {
            headers[key] = value;
        });
        nodeResponse.writeHead(res.status, headers);
        nodeResponse.end(Buffer.from(await res.arrayBuffer()));
    }).catch((error) => {
        nodeResponse.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        nodeResponse.end(error.message);
    });
}

server.listen(port, host, () => {
    console.log(`Mock gallery at http://${host}:${port}/?mock=1`);
});
