import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e',
    fullyParallel: false,
    retries: 0,
    use: {
        baseURL: 'http://127.0.0.1:4173',
        ...devices['Desktop Chrome'],
    },
    webServer: {
        command:
            'node build.js && node scripts/emit-shared-browser.mjs && npx vite --host 127.0.0.1 --port 4173',
        url: 'http://127.0.0.1:4173/?mock=1',
        reuseExistingServer: false,
        timeout: 30000,
    },
});
