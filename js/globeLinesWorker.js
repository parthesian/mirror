/**
 * Classic worker: fetch a globe-lines JSON file, decode it, and transfer
 * the typed arrays back to the explorer. importScripts the same versioned
 * globeDetail.js the page loads.
 */
importScripts('globeDetail.js?v=20261025a');

self.onmessage = (event) => {
    const data = event.data || {};
    if (data.type !== 'build') {
        return;
    }
    const detail = globalThis.GlobeDetail;
    const id = data.id;
    const url = data.url;
    if (!detail || !url) {
        self.postMessage({ id, ok: false, error: 'globe detail unavailable' });
        return;
    }
    fetch(url, { cache: 'force-cache' })
        .then((res) => {
            if (!res.ok) {
                throw new Error(`status ${res.status}`);
            }
            return res.json();
        })
        .then((doc) => {
            const built = detail.buildLineBuffers(doc, data.codeToId || {});
            self.postMessage({
                id,
                ok: true,
                positions: built.positions,
                meta: built.meta,
                index: built.index
            }, [built.positions.buffer, built.meta.buffer, built.index.buffer]);
        })
        .catch((err) => {
            self.postMessage({
                id,
                ok: false,
                error: String(err && err.message ? err.message : err)
            });
        });
};
