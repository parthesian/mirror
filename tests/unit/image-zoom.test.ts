import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import modalSource from '../../js/modal.js?raw';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

interface ModalModule {
    isBrowserZoomWheel: (event?: { ctrlKey?: boolean; metaKey?: boolean } | null) => boolean;
}

function loadModal(): ModalModule {
    const module = { exports: {} as ModalModule };
    const runner = new Function(
        'module',
        'exports',
        'window',
        `${modalSource}\nreturn module.exports;`,
    );
    return runner(module, module.exports, {}) as ModalModule;
}

const Modal = loadModal();

describe('photo zoom stays off the globe controller', () => {
    it('treats ctrl and meta wheels as browser zoom, not a dismiss', () => {
        expect(Modal.isBrowserZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true);
        expect(Modal.isBrowserZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true);
        expect(Modal.isBrowserZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false);
        expect(Modal.isBrowserZoomWheel(null)).toBe(false);
        expect(Modal.isBrowserZoomWheel(undefined)).toBe(false);
    });

    it('does not cancel a ctrl-wheel unless the explorer overlay is open', () => {
        const source = readFileSync(join(repoRoot, 'js/globeExplorer.js'), 'utf8');
        expect(source).not.toContain('e.ctrlKey || this.isOpen');
        expect(source).toContain('_bindZoomInput');
        expect(source).toContain('_unbindZoomInput');
        const wheelAt = source.indexOf('_zoomWheelListener = (event) => {');
        const wheel = source.slice(wheelAt, source.indexOf('_zoomGestureListener', wheelAt));
        expect(wheel).toContain('if (!this.isOpen) return;');
        expect(wheel).toContain('event.preventDefault()');
        expect(wheel).not.toContain('ctrlKey');
    });
});
