/**
 * DOM / string safety helpers.
 *
 * Reason: globe panels and notifications previously mixed escaped and raw HTML.
 * One shared escaper keeps XSS fixes from drifting apart on mobile and web.
 */
const DomSafe = {
    escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    text(value) {
        return String(value ?? '');
    }
};

window.DomSafe = DomSafe;
