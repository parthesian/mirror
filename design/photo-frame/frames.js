/*
 * Throwaway mockups for the photo viewer frame. Not loaded by the app.
 * index.html?o=<option>&p=<photo>
 */

const PHOTOS = {
    'ny-120': {
        src: 'photos/ny-square.jpg', w: 1362, h: 1362,
        place: 'New York', country: 'USA', date: '2026-11-20',
        camera: 'Rolleicord Vb White Face', cameraKind: 'tlr',
        film: 'Kodak Ektacolor Pro 400', format: '120',
        lat: 40.7128, lng: -74.006,
    },
    'istanbul-digital': {
        src: 'photos/istanbul-landscape.jpg', w: 1362, h: 908,
        place: 'Istanbul', country: 'Turkey', date: '2026-10-12',
        camera: 'Canon EOS 80D', cameraKind: 'dslr',
        film: null, format: 'digital',
        lat: 41.0082, lng: 28.9784,
    },
    // Crops of the two real photos with stand-in metadata, to exercise
    // 35mm and the other aspect ratios.
    'ny-35-portrait': {
        src: 'photos/ny-portrait.jpg', w: 908, h: 1362,
        place: 'New York', country: 'USA', date: '2026-11-21',
        camera: 'Nikon FM2', cameraKind: 'slr',
        film: 'Kodak Portra 400', format: '35mm',
        lat: 40.7128, lng: -74.006,
    },
    'ny-35-landscape': {
        src: 'photos/ny-landscape.jpg', w: 1362, h: 908,
        place: 'New York', country: 'USA', date: '2026-11-21',
        camera: 'Nikon FM2', cameraKind: 'slr',
        film: 'Kodak Portra 400', format: '35mm',
        lat: 40.7128, lng: -74.006,
    },
    'istanbul-digital-portrait': {
        src: 'photos/istanbul-portrait.jpg', w: 605, h: 908,
        place: 'Istanbul', country: 'Turkey', date: '2026-10-12',
        camera: 'Canon EOS 80D', cameraKind: 'dslr',
        film: null, format: 'digital',
        lat: 41.0082, lng: 28.9784,
    },
};

const ICONS = {
    dslr: '<svg viewBox="0 6 24 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    tlr: '<svg viewBox="0 1 24 22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="18" rx="2" ry="2"/><circle cx="12" cy="8.5" r="2.6"/><circle cx="12" cy="15.5" r="2.6"/></svg>',
    film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>',
};
ICONS.slr = ICONS.dslr;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

function parts(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return { y, m, d };
}
const fmt = {
    long: (iso) => { const { y, m, d } = parts(iso); return `${MONTHS[m - 1]} ${d}, ${y}`; },
    short: (iso) => { const { y, m, d } = parts(iso); return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`; },
    databack: (iso) => { const { y, m, d } = parts(iso); return `'${String(y).slice(2)} ${String(m).padStart(2, '0')} ${String(d).padStart(2, '0')}`; },
    coords: (p) => `${Math.abs(p.lat).toFixed(2)}° ${p.lat >= 0 ? 'N' : 'S'}  ${Math.abs(p.lng).toFixed(2)}° ${p.lng >= 0 ? 'E' : 'W'}`,
};

const icon = (kind) => `<span class="ico" aria-hidden="true">${ICONS[kind] || ICONS.dslr}</span>`;
const cameraIcon = (p) => icon(p.cameraKind);
const globe = (p, cls = '') => `<canvas class="globe ${cls}" data-lat="${p.lat}" data-lng="${p.lng}" aria-label="Globe"></canvas>`;
const orientation = (p) => (p.w === p.h ? 'square' : p.w > p.h ? 'landscape' : 'portrait');
const img = (p) => `<img class="photo" src="${p.src}" width="${p.w}" height="${p.h}" alt="">`;

/* ---------- 1. Edge print ---------- */
function edgePrint(p) {
    const isFilm = Boolean(p.film);
    const vertical35 = p.format === '35mm' && orientation(p) === 'portrait';
    const stock = isFilm ? p.film.toUpperCase() : p.camera.toUpperCase();
    const formatMark = isFilm ? (p.format === '120' ? '120' : '35') : 'DIGITAL';
    const head = `
        <span class="edge-text">${isFilm ? '<span class="edge-arrow">▸</span>' : ''}${stock}</span>
        <span class="edge-text edge-text--dim">${isFilm ? formatMark : ''}</span>
        <span class="edge-text edge-databack">${fmt.databack(p.date)}</span>`;
    const sprockets = p.format === '35mm' ? '<i class="sprockets"></i>' : '';
    return `
    <figure class="edge edge--${p.format === '35mm' ? 'f35' : p.format === '120' ? 'f120' : 'digital'} ${vertical35 ? 'edge--vertical' : ''}">
        <div class="edge-film">
            ${vertical35 ? `<div class="edge-side edge-side--l">${sprockets}</div>` : ''}
            <div class="edge-col">
                <div class="edge-rebate edge-rebate--top">${vertical35 ? '' : sprockets}<div class="edge-row">${head}</div></div>
                ${img(p)}
                <div class="edge-rebate edge-rebate--bottom">${vertical35 ? '' : sprockets}
                    <div class="edge-row edge-row--label">
                        <span class="edge-place">${p.place}<span class="edge-country">${p.country}</span></span>
                        <span class="edge-cam">${cameraIcon(p)}${isFilm ? p.camera : 'Digital'}</span>
                    </div>
                </div>
            </div>
            ${vertical35 ? `<div class="edge-side edge-side--r">${sprockets}</div>` : ''}
        </div>
        <figcaption class="edge-globe">
            ${globe(p)}
            <span class="edge-coords">${fmt.coords(p)}</span>
        </figcaption>
    </figure>`;
}

/* ---------- 2. Instant ---------- */
function instant(p) {
    const lines = [
        `<span class="inst-line">${cameraIcon(p)}${p.camera}</span>`,
        p.film ? `<span class="inst-line">${icon('film')}${p.film}</span>` : '',
    ].join('');
    return `
    <figure class="inst inst--${orientation(p)}">
        <div class="inst-card">
            <div class="inst-window">${img(p)}</div>
            <figcaption class="inst-chin">
                <div class="inst-copy">
                    <span class="inst-place">${p.place}</span>
                    <span class="inst-sub">${p.country} <i>·</i> ${fmt.long(p.date)}</span>
                    <span class="inst-gear">${lines}</span>
                </div>
                ${globe(p, 'inst-globe')}
            </figcaption>
        </div>
    </figure>`;
}

/* ---------- 3. Placard ---------- */
function placard(p) {
    const medium = p.film
        ? `${p.film}<br><span class="plc-format">${p.format === '120' ? '120 roll film' : '35mm film'}</span>`
        : 'Digital capture';
    return `
    <figure class="plc plc--${orientation(p)}">
        <div class="plc-mat">
            <div class="plc-window">${img(p)}</div>
            <div class="plc-foot">
                <div class="plc-globe">${globe(p)}<span class="plc-coords">${fmt.coords(p).replace(/ {2}/, '<br>')}</span></div>
                <figcaption class="plc-label">
                    <span class="plc-title">${p.place}<span class="plc-country">, ${p.country}</span></span>
                    <span class="plc-date">${fmt.long(p.date)}</span>
                    <span class="plc-rule"></span>
                    <span class="plc-gear">${p.camera}</span>
                    <span class="plc-medium">${medium}</span>
                </figcaption>
            </div>
        </div>
    </figure>`;
}

/* ---------- 4. Strip ---------- */
function strip(p) {
    const specs = [
        `<span class="strip-spec">${cameraIcon(p)}<span>${p.camera}</span></span>`,
        p.film ? `<span class="strip-spec">${icon('film')}<span>${p.film}</span></span>` : '',
    ].join('');
    return `
    <figure class="strip strip--${orientation(p)} ${p.film ? 'has-film' : 'no-film'}">
        ${img(p)}
        <figcaption class="strip-bar">
            <div class="strip-grid">
                ${globe(p, 'strip-globe')}
                <span class="strip-head">
                    <span class="strip-place">${p.place}</span>
                    <span class="strip-sub">${p.country} · ${fmt.long(p.date)}</span>
                </span>
                <span class="strip-specs">${specs}</span>
            </div>
        </figcaption>
    </figure>`;
}

/* ---------- 5. Postmark ---------- */
function postmark(p) {
    const fields = [
        ['Date', fmt.long(p.date)],
        ['Camera', p.camera],
        p.film ? ['Film', `${p.film}${p.format === '120' ? ' · 120' : p.format === '35mm' ? ' · 35mm' : ''}`] : null,
        ['Position', fmt.coords(p)],
    ].filter(Boolean);
    const ring = `${p.place} · ${p.country} · ${fmt.short(p.date)} · `.toUpperCase();
    return `
    <figure class="pm pm--${orientation(p)}">
        <div class="pm-card">
            <div class="pm-photo">${img(p)}</div>
            <div class="pm-perf" aria-hidden="true"></div>
            <figcaption class="pm-stub">
                <div class="pm-top">
                <div class="pm-place"><span class="pm-k">Place</span><span class="pm-v">${p.place}, ${p.country}</span></div>
                <div class="pm-mark">
                    <svg class="pm-waves" viewBox="0 0 120 60" preserveAspectRatio="none" aria-hidden="true">
                        ${[12, 22, 32, 42, 52].map((y) => `<path d="M0 ${y} q7.5 -5 15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0"/>`).join('')}
                    </svg>
                    <div class="pm-stamp">
                        <svg class="pm-ring" viewBox="0 0 200 200" aria-hidden="true">
                            <defs><path id="pm-circle" d="M100,100 m-84,0 a84,84 0 1,1 168,0 a84,84 0 1,1 -168,0"/></defs>
                            <circle cx="100" cy="100" r="97"/>
                            <circle cx="100" cy="100" r="72"/>
                            <text><textPath href="#pm-circle" textLength="520">${ring}</textPath></text>
                        </svg>
                        ${globe(p, 'pm-globe')}
                    </div>
                </div>
                </div>
                <div class="pm-fields">
                    ${fields.map(([k, v]) => `<div class="pm-field"><span class="pm-k">${k}</span><span class="pm-v">${v}</span></div>`).join('')}
                </div>
            </figcaption>
        </div>
    </figure>`;
}

const OPTIONS = {
    edge: { name: 'Edge Print', render: edgePrint },
    instant: { name: 'Instant', render: instant },
    placard: { name: 'Placard', render: placard },
    strip: { name: 'Strip', render: strip },
    postmark: { name: 'Postmark', render: postmark },
};

/* ---------- Globe: orthographic projection of the repo's earth texture ---------- */
let texturePromise = null;
function loadTexture() {
    if (!texturePromise) {
        texturePromise = new Promise((resolve, reject) => {
            const t = new Image();
            t.onload = () => {
                const c = document.createElement('canvas');
                c.width = t.naturalWidth;
                c.height = t.naturalHeight;
                const ctx = c.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(t, 0, 0);
                resolve({ w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data });
            };
            t.onerror = reject;
            t.src = '../../public/earth_atmos_2048.jpg';
        });
    }
    return texturePromise;
}

async function drawGlobe(canvas) {
    const tex = await loadTexture();
    const css = canvas.getBoundingClientRect().width || 120;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const size = Math.round(css * dpr);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const out = ctx.createImageData(size, size);
    const lat = Number(canvas.dataset.lat);
    const lng = Number(canvas.dataset.lng);
    const rad = Math.PI / 180;
    const phi0 = (lat - 14) * rad;
    const lam0 = (lng + 8) * rad;
    const r = size / 2;
    const L = [-0.55, 0.5, 0.67];
    for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
            const x = (i + 0.5 - r) / r;
            const y = (r - j - 0.5) / r;
            const rho2 = x * x + y * y;
            if (rho2 > 1) continue;
            const rho = Math.sqrt(rho2);
            const z = Math.sqrt(1 - rho2);
            let phi;
            let lam;
            if (rho < 1e-9) {
                phi = phi0;
                lam = lam0;
            } else {
                const c = Math.asin(rho);
                const sc = Math.sin(c);
                const cc = Math.cos(c);
                phi = Math.asin(cc * Math.sin(phi0) + (y * sc * Math.cos(phi0)) / rho);
                lam = lam0 + Math.atan2(x * sc, rho * cc * Math.cos(phi0) - y * sc * Math.sin(phi0));
            }
            let u = ((lam / rad + 180) / 360) % 1;
            if (u < 0) u += 1;
            const v = (90 - phi / rad) / 180;
            const ti = (Math.min(tex.h - 1, Math.floor(v * tex.h)) * tex.w + Math.floor(u * tex.w)) * 4;
            const lum = 0.3 * tex.data[ti] + 0.59 * tex.data[ti + 1] + 0.11 * tex.data[ti + 2];
            const light = Math.max(0, x * L[0] + y * L[1] + z * L[2]);
            const shade = 0.16 + 0.95 * light ** 1.25;
            const limb = 0.65 + 0.35 * z;
            const g = Math.min(255, (lum * 1.08 + 6) * shade * limb);
            const edge = Math.min(1, (1 - rho) * r * 0.9);
            const o = (j * size + i) * 4;
            out.data[o] = g * 1.02;
            out.data[o + 1] = g;
            out.data[o + 2] = g * 0.96;
            out.data[o + 3] = 255 * edge;
        }
    }
    ctx.putImageData(out, 0, 0);

    // Forward-project the pin so it lands on the real location.
    const phi = lat * rad;
    const lam = lng * rad;
    const cosc = Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(lam - lam0);
    if (cosc > 0) {
        const px = r + r * Math.cos(phi) * Math.sin(lam - lam0);
        const py = r - r * (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(lam - lam0));
        const dot = Math.max(2.2 * dpr, size * 0.026);
        ctx.fillStyle = 'rgba(255, 178, 110, 0.28)';
        ctx.beginPath();
        ctx.arc(px, py, dot * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffc48a';
        ctx.beginPath();
        ctx.arc(px, py, dot, 0, Math.PI * 2);
        ctx.fill();
    }
}

/* ---------- Strip tint: the bar borrows the photo's lower-edge color ---------- */
function tintFromPhoto(figure) {
    const photo = figure.querySelector('.photo');
    const apply = () => {
        const c = document.createElement('canvas');
        c.width = 24;
        c.height = 24;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(photo, 0, photo.naturalHeight * 0.7, photo.naturalWidth, photo.naturalHeight * 0.3, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        let rr = 0;
        let gg = 0;
        let bb = 0;
        for (let k = 0; k < d.length; k += 4) {
            rr += d[k];
            gg += d[k + 1];
            bb += d[k + 2];
        }
        const n = d.length / 4;
        figure.style.setProperty('--tint', `${Math.round(rr / n)}, ${Math.round(gg / n)}, ${Math.round(bb / n)}`);
    };
    if (photo.complete) apply();
    else photo.addEventListener('load', apply, { once: true });
}

function render() {
    const params = new URLSearchParams(location.search);
    const optionKey = OPTIONS[params.get('o')] ? params.get('o') : 'edge';
    const photo = PHOTOS[params.get('p')] || PHOTOS['ny-120'];
    const stage = document.getElementById('stage');
    document.body.dataset.option = optionKey;
    document.title = `${OPTIONS[optionKey].name} · ${photo.place}`;
    stage.innerHTML = `
        <button class="close-btn" type="button" aria-label="Close">×</button>
        <div class="viewer viewer--${optionKey}">${OPTIONS[optionKey].render(photo)}</div>`;
    const strips = stage.querySelectorAll('.strip');
    strips.forEach(tintFromPhoto);
    const imgs = [...stage.querySelectorAll('img')].map((el) => (el.complete ? null : new Promise((res) => {
        el.addEventListener('load', res, { once: true });
        el.addEventListener('error', res, { once: true });
    })));
    const globes = [...stage.querySelectorAll('canvas.globe')];
    Promise.all([...imgs, document.fonts.ready])
        .then(() => Promise.all(globes.map(drawGlobe)))
        .then(() => {
            document.body.dataset.ready = 'true';
        });
}

render();
