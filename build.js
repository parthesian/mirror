#!/usr/bin/env node

/**
 * Build script for Cloudflare Pages
 * Injects environment variables into the config.js file at build time
 */

const fs = require('fs');
const path = require('path');

// Get environment variables
const API_BASE_URL = process.env.API_BASE_URL || '';

// Create the config content
const configContent = `/**
 * Configuration for the application
 * Generated at build time with environment variables
 */

window.CONFIG = {
    API_BASE_URL: "${API_BASE_URL}"
};

console.log('Configuration loaded:', {
    API_BASE_URL: window.CONFIG.API_BASE_URL || '[same-origin]'
});
`;

// Write the config file
const configPath = path.join(__dirname, 'js', 'config.js');
fs.writeFileSync(configPath, configContent);

console.log('✅ Configuration file generated successfully');
