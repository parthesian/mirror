import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function emitSharedBrowser() {
    await esbuild.build({
        entryPoints: [path.join(root, 'shared/browser.ts')],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        target: 'es2022',
        outfile: path.join(root, 'js/generated/photo-colors.js'),
        legalComments: 'none',
    });
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
    await emitSharedBrowser();
}
