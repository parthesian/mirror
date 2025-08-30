/**
 * Environment Variables Loader
 * Loads environment variables from .env file for client-side use
 */

// Function to load environment variables
async function loadEnvironmentVariables() {
    try {
        const response = await fetch('.env');
        if (!response.ok) {
            console.warn('Could not load .env file, using defaults');
            return;
        }
        
        const envText = await response.text();
        const envLines = envText.split('\n');
        
        envLines.forEach(line => {
            line = line.trim();
            if (line && !line.startsWith('#')) {
                const [key, ...valueParts] = line.split('=');
                if (key && valueParts.length > 0) {
                    const value = valueParts.join('=').trim();
                    // Remove quotes if present
                    const cleanValue = value.replace(/^["']|["']$/g, '');
                    window[key.trim()] = cleanValue;
                }
            }
        });
        
        console.log('Environment variables loaded successfully');
    } catch (error) {
        console.warn('Failed to load environment variables:', error);
    }
}
// Load environment variables immediately
loadEnvironmentVariables();
