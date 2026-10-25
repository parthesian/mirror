import { describe, expect, it } from 'vitest';
import layoutSource from '../../js/galleryLayout.js?raw';

interface LayoutModule {
    COMPACT_QUERY: string;
    DESKTOP_QUERY: string;
    isCompact: (win: { innerWidth?: number; innerHeight?: number }) => boolean;
    fittingColumnCounts: (width: number) => number[];
}

function loadLayout(): LayoutModule {
    const module = { exports: {} as LayoutModule };
    const runner = new Function(
        'module',
        'exports',
        'window',
        `${layoutSource}\nreturn module.exports;`,
    );
    return runner(module, module.exports, undefined) as LayoutModule;
}

const GalleryLayout = loadLayout();

describe('compact breakpoint', () => {
    it('treats a plain width object the way the order check does', () => {
        expect(GalleryLayout.isCompact({ innerWidth: 768 })).toBe(true);
        expect(GalleryLayout.isCompact({ innerWidth: 769, innerHeight: 900 })).toBe(false);
        expect(GalleryLayout.isCompact({ innerWidth: 900, innerHeight: 400 })).toBe(true);
    });

    it('lists only desktop column counts that keep a 150px tile', () => {
        expect(GalleryLayout.fittingColumnCounts(1000)).toEqual([2, 3, 4, 5, 6]);
        expect(GalleryLayout.fittingColumnCounts(520)).toEqual([2, 3]);
    });
});
