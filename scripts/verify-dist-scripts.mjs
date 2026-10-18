import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const classic = html.match(/<script src=/g)?.length ?? 0;
const modules = html.match(/<script type="module"/g)?.length ?? 0;

if (classic < 1) {
    throw new Error('dist/index.html has no classic script tags');
}
if (modules !== 0) {
    throw new Error(`dist/index.html has ${modules} module scripts`);
}
if (!html.includes('js/app.js')) {
    throw new Error('dist/index.html does not load js/app.js');
}
if (!html.includes('js/generated/photo-colors.js')) {
    throw new Error('dist/index.html does not load the generated color bundle');
}

console.log(`dist classic scripts ${classic}, module scripts ${modules}`);
