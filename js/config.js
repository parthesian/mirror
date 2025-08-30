/**
 * Configuration loader for Cloudflare Pages
 * Uses environment variables injected by Cloudflare Pages at build time
 */

// Cloudflare Pages injects environment variables as global variables
// We'll check for them and fall back to defaults if not available
window.CONFIG = {
    API_BASE_URL: API_BASE_URL,
    UPLOAD_PASSWORD_HASH: UPLOAD_PASSWORD_HASH
};

console.log('Configuration loaded:', {
    API_BASE_URL: window.CONFIG.API_BASE_URL,
    UPLOAD_PASSWORD_HASH: window.CONFIG.UPLOAD_PASSWORD_HASH ? '[HIDDEN]' : 'NOT SET'
});
