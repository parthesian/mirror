import { spawn } from 'node:child_process';
import { cpSync, createReadStream, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const maplibreDist = path.join(root, 'node_modules/maplibre-gl/dist');
const maplibreVersion: string = JSON.parse(
    readFileSync(path.join(root, 'node_modules/maplibre-gl/package.json'), 'utf8'),
).version;
const maplibreFiles = ['maplibre-gl.js', 'maplibre-gl.css'];

/** GlobeMap loads MapLibre's UMD build from here when the explorer opens. */
export const maplibreVendorPath = `/vendor/maplibre-gl-${maplibreVersion}`;

function emitSharedBrowser(): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [path.join(root, 'scripts/emit-shared-browser.mjs')],
            {
                cwd: root,
                stdio: 'inherit',
            },
        );
        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`emit-shared-browser.mjs exited ${code ?? 'null'}`));
        });
    });
}

function copyRuntimeAssets() {
    return {
        name: 'copy-runtime-assets',
        apply: 'build',
        closeBundle() {
            const dist = path.join(root, 'dist');
            mkdirSync(dist, { recursive: true });
            cpSync(path.join(root, 'js'), path.join(dist, 'js'), { recursive: true });
            cpSync(path.join(root, 'styles.css'), path.join(dist, 'styles.css'));
            cpSync(path.join(root, 'mirror.svg'), path.join(dist, 'mirror.svg'));
            cpSync(path.join(root, '_headers'), path.join(dist, '_headers'));
            const vendor = path.join(dist, maplibreVendorPath);
            mkdirSync(vendor, { recursive: true });
            for (const file of maplibreFiles) {
                cpSync(path.join(maplibreDist, file), path.join(vendor, file));
            }
        },
    };
}

function serveMaplibre(): Plugin {
    return {
        name: 'serve-maplibre',
        apply: 'serve',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const file = maplibreFiles.find(
                    (name) => req.url?.split('?')[0] === `${maplibreVendorPath}/${name}`,
                );
                if (!file) {
                    next();
                    return;
                }
                res.setHeader(
                    'Content-Type',
                    file.endsWith('.css') ? 'text/css' : 'text/javascript',
                );
                createReadStream(path.join(maplibreDist, file)).pipe(res);
            });
        },
    };
}

export default defineConfig({
    appType: 'mpa',
    publicDir: 'public',
    plugins: [
        {
            name: 'emit-shared-browser',
            buildStart() {
                return emitSharedBrowser();
            },
            configureServer() {
                return emitSharedBrowser();
            },
        },
        copyRuntimeAssets(),
        serveMaplibre(),
    ],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: path.join(root, 'index.html'),
                admin: path.join(root, 'admin/index.html'),
            },
        },
    },
});
