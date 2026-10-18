import { spawn } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

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
