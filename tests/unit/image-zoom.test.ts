import { describe, expect, it } from 'vitest';
import modalSource from '../../js/modal.js?raw';

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

describe('photo zoom wheel', () => {
    it('treats ctrl and meta wheels as browser zoom, not a dismiss', () => {
        expect(Modal.isBrowserZoomWheel({ ctrlKey: true, metaKey: false })).toBe(true);
        expect(Modal.isBrowserZoomWheel({ ctrlKey: false, metaKey: true })).toBe(true);
        expect(Modal.isBrowserZoomWheel({ ctrlKey: false, metaKey: false })).toBe(false);
        expect(Modal.isBrowserZoomWheel(null)).toBe(false);
        expect(Modal.isBrowserZoomWheel(undefined)).toBe(false);
    });
});
