/**
 * Image Service - Handles gallery metadata, chronology navigation, and uploads.
 */
class ImageService {
    constructor() {
        this.images = [];
        this.imagesById = new Map();
        this.orderedIds = [];
        this.isLoading = false;
        this.apiBaseUrl = this.getApiBaseUrl();
        this.limit = 24;
        this.hasMore = true;
        this.nextCursor = null;
        this.activeLoadPromise = null;
        this.activeLoadKind = null;
        this.countryFilter = null;
        this.locationFilter = null;
        this.takenFromFilter = null;
        this.takenToFilter = null;
    }

    /**
     * Get API base URL from config or fallback.
     * @returns {string} API base URL
     */
    getApiBaseUrl() {
        const configuredBaseUrl = (window.CONFIG?.API_BASE_URL || '').trim();
        return configuredBaseUrl.endsWith('/')
            ? configuredBaseUrl.slice(0, -1)
            : configuredBaseUrl;
    }

    /**
     * Build a fully qualified API URL.
     * @param {string} path - API path
     * @returns {string} Fully qualified URL
     */
    buildApiUrl(path) {
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        return this.apiBaseUrl ? `${this.apiBaseUrl}${normalizedPath}` : normalizedPath;
    }

    /**
     * Parse API responses, including legacy API Gateway wrappers.
     * @param {Response} response - Fetch response
     * @returns {Promise<Object>} Parsed response body
     */
    async parseJsonResponse(response) {
        const data = await response.json();

        if (data && data.body && typeof data.body === 'string') {
            try {
                return JSON.parse(data.body);
            } catch (parseError) {
                console.error('Failed to parse wrapped response body:', parseError);
                throw new Error('Invalid API response format');
            }
        }

        return data;
    }

    /**
     * Map API photo objects into the gallery model.
     * @param {Object} photo - Raw API photo object
     * @returns {Object} Normalized photo
     */
    mapPhoto(photo) {
        const width = photo.width || photo.image?.width || null;
        const height = photo.height || photo.image?.height || null;

        return {
            id: photo.id || photo.photoId || `img-${Date.now()}-${Math.random()}`,
            description: photo.description || '',
            location: photo.location || 'Unknown location',
            timestamp: photo.takenAt || photo.timestamp || photo.createdAt || new Date().toISOString(),
            uploadedAt: photo.uploadedAt || photo.timestamp || new Date().toISOString(),
            url: photo.image?.url || photo.imageUrl || photo.url || '',
            thumbnailUrl: photo.thumbnail?.url || photo.thumbnailUrl || photo.image?.url || photo.imageUrl || photo.url || '',
            storageKey: photo.storageKey || photo.s3Key || photo.key || '',
            width,
            height,
            aspectRatio: width && height ? width / height : (4 / 3),
            latitude: photo.latitude ?? null,
            longitude: photo.longitude ?? null,
            country: photo.country || '',
            camera: photo.camera || ''
        };
    }

    /**
     * Reset the in-memory gallery collection.
     */
    resetCollection() {
        this.images = [];
        this.imagesById = new Map();
        this.orderedIds = [];
        this.hasMore = true;
        this.nextCursor = null;
    }

    /**
     * Merge photos into the loaded chronology.
     * @param {Array<Object>} photos - Photos to merge
     * @param {Object} options - Merge options
     * @returns {Array<Object>} Newly added unique photos
     */
    mergePhotos(photos, options = {}) {
        const replace = Boolean(options.replace);
        const nextById = replace ? new Map() : new Map(this.imagesById);
        const nextOrderedIds = replace ? [] : [...this.orderedIds];
        const addedPhotos = [];

        photos.forEach((photo) => {
            if (!photo || !photo.id) {
                return;
            }

            if (nextById.has(photo.id)) {
                nextById.set(photo.id, {
                    ...nextById.get(photo.id),
                    ...photo
                });
                return;
            }

            nextById.set(photo.id, photo);
            nextOrderedIds.push(photo.id);
            addedPhotos.push(photo);
        });

        this.imagesById = nextById;
        this.orderedIds = nextOrderedIds;
        this.images = this.orderedIds
            .map((id) => this.imagesById.get(id))
            .filter(Boolean);

        return addedPhotos;
    }

    /**
     * Request a page of photos from the API.
     * @param {string|null} cursor - Cursor for pagination
     * @returns {Promise<Object>} Page result
     */
    async requestPhotos(cursor = null) {
        if (!this.apiBaseUrl && window.location.protocol === 'file:') {
            console.warn('API base URL not configured, using empty gallery');
            return {
                photos: [],
                nextCursor: null,
                hasMore: false
            };
        }

        const url = new URL(this.buildApiUrl('/api/photos'), window.location.origin);
        url.searchParams.set('limit', this.limit.toString());
        if (cursor) {
            url.searchParams.set('cursor', cursor);
        }
        if (this.countryFilter) {
            url.searchParams.set('country', this.countryFilter);
        }
        if (this.locationFilter) {
            url.searchParams.set('location', this.locationFilter);
        }
        if (this.takenFromFilter) {
            url.searchParams.set('takenFrom', this.takenFromFilter);
        }
        if (this.takenToFilter) {
            url.searchParams.set('takenTo', this.takenToFilter);
        }

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            },
            mode: 'cors'
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const parsedData = await this.parseJsonResponse(response);
        const rawPhotos = Array.isArray(parsedData.photos) ? parsedData.photos : [];
        const photos = rawPhotos.map((photo) => this.mapPhoto(photo));
        const nextCursor = parsedData.nextCursor || null;
        const hasMore = parsedData.hasMore !== undefined ? parsedData.hasMore : Boolean(nextCursor);

        return {
            photos,
            nextCursor,
            hasMore
        };
    }

    /**
     * Fetch the authenticated admin session if one exists.
     * @returns {Promise<Object>} Session payload
     */
    async getAdminSession() {
        const response = await fetch(this.buildApiUrl('/api/admin/session'), {
            method: 'GET',
            credentials: 'same-origin'
        });

        const payload = await this.parseJsonResponse(response);

        if (!response.ok) {
            const error = new Error(payload.error || 'Unable to verify admin session.');
            error.status = response.status;
            throw error;
        }

        return payload;
    }

    /**
     * Complete Cloudflare Access auth for the admin API in a top-level navigation.
     * @param {string} returnTo - Path to return to after auth succeeds
     */
    beginAdminSessionAuth(returnTo = '/admin/') {
        const targetUrl = new URL(this.buildApiUrl('/api/admin/session'), window.location.origin);
        targetUrl.searchParams.set('redirectTo', returnTo);
        window.location.assign(targetUrl.toString());
    }

    /**
     * Load the first page of image metadata.
     * @returns {Promise<Array>} Loaded image metadata
     */
    async fetchImages() {
        if (this.activeLoadPromise) {
            if (this.activeLoadKind === 'fetch') {
                return this.activeLoadPromise;
            }

            await this.activeLoadPromise;
            return this.images;
        }

        this.activeLoadKind = 'fetch';
        this.activeLoadPromise = this.fetchImagesInternal();
        try {
            return await this.activeLoadPromise;
        } finally {
            this.activeLoadPromise = null;
            this.activeLoadKind = null;
        }
    }

    async fetchImagesInternal() {
        this.isLoading = true;

        try {
            this.resetCollection();

            const result = await this.requestPhotos();
            this.mergePhotos(result.photos, { replace: true });
            this.nextCursor = result.nextCursor;
            this.hasMore = result.hasMore;

            console.log(`Loaded ${this.images.length} initial photos. Has more: ${this.hasMore}`);
            return this.images;
        } catch (error) {
            console.error('Failed to fetch images:', error);

            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                console.warn('Network error detected, using empty gallery');
                this.resetCollection();
                this.hasMore = false;
                return this.images;
            }

            throw new Error(`Failed to fetch images: ${error.message}`);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Load the next page of image metadata.
     * @returns {Promise<Array>} Newly loaded images
     */
    async loadMorePhotos() {
        if (!this.hasMore) {
            return [];
        }

        if (this.activeLoadPromise) {
            if (this.activeLoadKind === 'loadMore') {
                return this.activeLoadPromise;
            }

            await this.activeLoadPromise;
            return this.loadMorePhotos();
        }

        this.activeLoadKind = 'loadMore';
        this.activeLoadPromise = this.loadMorePhotosInternal();
        try {
            return await this.activeLoadPromise;
        } finally {
            this.activeLoadPromise = null;
            this.activeLoadKind = null;
        }
    }

    async loadMorePhotosInternal() {
        if (!this.nextCursor) {
            this.hasMore = false;
            return [];
        }

        this.isLoading = true;

        try {
            const result = await this.requestPhotos(this.nextCursor);
            const addedPhotos = this.mergePhotos(result.photos);
            this.nextCursor = result.nextCursor;
            this.hasMore = result.hasMore;

            console.log(`Loaded ${addedPhotos.length} more photos. Total: ${this.images.length}. Has more: ${this.hasMore}`);
            return addedPhotos;
        } catch (error) {
            console.error('Failed to load more photos:', error);
            throw new Error(`Failed to load more photos: ${error.message}`);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Ensure the collection contains the requested index.
     * @param {number} targetIndex - Desired collection index
     * @returns {Promise<boolean>} Whether the index is now available
     */
    async ensureIndexLoaded(targetIndex) {
        if (targetIndex < this.images.length) {
            return true;
        }

        while (this.hasMore && targetIndex >= this.images.length) {
            const added = await this.loadMorePhotos();
            if (!added.length) {
                break;
            }
        }

        return targetIndex < this.images.length;
    }

    /**
     * Load the entire remaining chronology when boundary wrapping requires it.
     * @returns {Promise<Array>} Full loaded collection
     */
    async loadRemainingPhotos() {
        while (this.hasMore) {
            const added = await this.loadMorePhotos();
            if (!added.length) {
                break;
            }
        }

        return this.images;
    }

    /**
     * Get a specific image by ID.
     * @param {string} id - Image ID
     * @returns {Object|null} Image object or null if not found
     */
    getImageById(id) {
        return this.imagesById.get(id) || null;
    }

    /**
     * Get the index of an image in the chronological collection.
     * @param {string} id - Image ID
     * @returns {number} Index or -1 if not found
     */
    getImageIndex(id) {
        return this.orderedIds.indexOf(id);
    }

    /**
     * Peek at an adjacent loaded image without fetching more metadata.
     * @param {string} currentId - Current image ID
     * @param {'previous'|'next'} direction - Navigation direction
     * @returns {Object|null} Adjacent loaded image
     */
    peekAdjacentImage(currentId, direction) {
        const currentIndex = this.getImageIndex(currentId);
        if (currentIndex === -1 || this.images.length <= 1) {
            return null;
        }

        if (direction === 'previous') {
            if (currentIndex > 0) {
                return this.images[currentIndex - 1];
            }

            return this.hasMore ? null : this.images[this.images.length - 1];
        }

        if (currentIndex < this.images.length - 1) {
            return this.images[currentIndex + 1];
        }

        return this.hasMore ? null : this.images[0];
    }

    /**
     * Resolve navigation asynchronously, fetching more metadata when needed.
     * `previous` wraps from the newest image to the true oldest image, which
     * requires loading the rest of the chronology if it is not known yet.
     * @param {string} currentId - Current image ID
     * @param {'previous'|'next'} direction - Navigation direction
     * @returns {Promise<Object|null>} Resolved image
     */
    async getAdjacentImage(currentId, direction) {
        const currentIndex = this.getImageIndex(currentId);
        if (currentIndex === -1 || this.images.length === 0) {
            return null;
        }

        if (direction === 'previous') {
            if (currentIndex > 0) {
                return this.images[currentIndex - 1];
            }

            if (this.hasMore) {
                await this.loadRemainingPhotos();
            }

            return this.images.length > 1 ? this.images[this.images.length - 1] : null;
        }

        if (currentIndex < this.images.length - 1) {
            return this.images[currentIndex + 1];
        }

        if (this.hasMore) {
            const ensured = await this.ensureIndexLoaded(currentIndex + 1);
            if (ensured) {
                return this.images[currentIndex + 1] || null;
            }
        }

        return this.images.length > 1 ? this.images[0] : null;
    }

    /**
     * Check whether modal navigation should be available.
     * @returns {boolean} Whether at least one neighbor can exist
     */
    hasNavigableImages() {
        return this.images.length > 1 || this.hasMore;
    }

    /**
     * Upload a new photo to the API.
     * @param {File} file - Image file to upload
     * @param {string} location - Required location information
     * @param {string} description - Optional description
     * @param {Object} timestamp - Optional timestamp object with day, month, year
     * @returns {Promise<Object>} Upload response
     */
    async uploadPhoto(file, location, description = '', timestamp = null, coords = null, camera = '') {
        try {
            if (!this.apiBaseUrl && window.location.protocol === 'file:') {
                throw new Error('API base URL not configured. Cannot upload photos.');
            }

            const preparedAssets = await this.prepareUploadAssets(file);
            const formData = new FormData();
            formData.append('photo', preparedAssets.photoFile, preparedAssets.photoFile.name);
            if (preparedAssets.thumbnailFile) {
                formData.append('thumbnail', preparedAssets.thumbnailFile, preparedAssets.thumbnailFile.name);
            }
            formData.append('location', location);
            formData.append('description', description);

            if (preparedAssets.width) {
                formData.append('width', preparedAssets.width.toString());
            }

            if (preparedAssets.height) {
                formData.append('height', preparedAssets.height.toString());
            }

            const normalizedTimestamp = this.normalizeTimestamp(timestamp);
            if (normalizedTimestamp) {
                formData.append('takenAt', normalizedTimestamp);
            }

            if (coords) {
                if (coords.latitude != null && Number.isFinite(Number(coords.latitude))) {
                    formData.append('latitude', coords.latitude.toString());
                }
                if (coords.longitude != null && Number.isFinite(Number(coords.longitude))) {
                    formData.append('longitude', coords.longitude.toString());
                }
                if (coords.country) {
                    formData.append('country', coords.country);
                }
            }

            const cameraTrimmed = (camera || '').toString().trim();
            if (cameraTrimmed) {
                formData.append('camera', cameraTrimmed);
            }

            console.log('Uploading photo with multipart payload:', {
                location,
                description,
                contentType: preparedAssets.photoFile.type,
                takenAt: normalizedTimestamp || 'not provided',
                fileSize: preparedAssets.photoFile.size,
                thumbnailSize: preparedAssets.thumbnailFile?.size || 0,
                width: preparedAssets.width,
                height: preparedAssets.height,
                latitude: coords?.latitude ?? 'not provided',
                longitude: coords?.longitude ?? 'not provided',
                country: coords?.country || 'not provided',
                camera: cameraTrimmed || 'not provided'
            });

            const response = await fetch(this.buildApiUrl('/api/admin/photos'), {
                method: 'POST',
                mode: 'cors',
                credentials: 'same-origin',
                body: formData
            });

            if (!response.ok) {
                console.error('Upload failed with status:', response.status, response.statusText);
                if (response.status === 401 || response.status === 403) {
                    throw new Error('Upload access is restricted. Sign in through Cloudflare Access and try again.');
                }
                if (response.status === 413) {
                    throw new Error('Image file is too large. Please try a smaller image or reduce the quality.');
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await this.parseJsonResponse(response);
            console.log('Upload response received:', result);
            await this.fetchImages();
            return result;
        } catch (error) {
            console.error('Failed to upload photo:', error);

            if (error.message.includes('413') || error.message.includes('too large')) {
                throw new Error('Image file is too large. Please try a smaller image.');
            }
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                throw new Error('Network error. Please check your connection and try again.');
            }

            throw new Error(`Failed to upload photo: ${error.message}`);
        }
    }

    /**
     * Normalize the legacy timestamp input into an ISO timestamp.
     * @param {Object|null} timestamp - Legacy timestamp object
     * @returns {string|null} ISO timestamp
     */
    normalizeTimestamp(timestamp) {
        if (!timestamp || !timestamp.year || !timestamp.month || !timestamp.day) {
            return null;
        }

        const year = timestamp.year;
        const month = String(timestamp.month).padStart(2, '0');
        const day = String(timestamp.day).padStart(2, '0');
        return `${year}-${month}-${day}T12:00:00.000Z`;
    }

    /**
     * Prepare a full-size upload plus a smaller thumbnail derivative.
     * @param {File} file - Original user-selected file
     * @returns {Promise<Object>} Prepared upload assets
     */
    async prepareUploadAssets(file) {
        const photoFile = await this.compressImage(file);

        if (!photoFile.type.startsWith('image/')) {
            return {
                photoFile,
                thumbnailFile: null,
                width: null,
                height: null
            };
        }

        const imageElement = await this.loadImageElement(photoFile);
        const width = imageElement.naturalWidth || imageElement.width || null;
        const height = imageElement.naturalHeight || imageElement.height || null;
        const thumbnailFile = await this.createDerivedImageFile(photoFile, {
            maxWidth: 640,
            maxHeight: 640,
            quality: 0.82,
            suffix: '-thumb'
        });

        return {
            photoFile,
            thumbnailFile,
            width,
            height
        };
    }

    /**
     * Compress image to reduce file size.
     * @param {File} file - Image file to compress
     * @param {number} maxWidth - Maximum width
     * @param {number} maxHeight - Maximum height
     * @param {number} quality - Compression quality
     * @returns {Promise<File>} Compressed image file
     */
    compressImage(file, maxWidth = 2560, maxHeight = 1440, quality = 0.92) {
        if (!file.type.startsWith('image/')) {
            return Promise.resolve(file);
        }

        if (file.size < 2 * 1024 * 1024) {
            return Promise.resolve(file);
        }

        return this.createDerivedImageFile(file, {
            maxWidth,
            maxHeight,
            quality
        });
    }

    /**
     * Create a resized derivative for uploads.
     * @param {File} file - Source image
     * @param {Object} options - Resize options
     * @returns {Promise<File>} Derived image file
     */
    async createDerivedImageFile(file, options = {}) {
        const {
            maxWidth = 2560,
            maxHeight = 1440,
            quality = 0.92,
            suffix = ''
        } = options;
        const imageElement = await this.loadImageElement(file);
        const sourceWidth = imageElement.naturalWidth || imageElement.width;
        const sourceHeight = imageElement.naturalHeight || imageElement.height;
        const ratio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight, 1);
        const width = Math.max(1, Math.round(sourceWidth * ratio));
        const height = Math.max(1, Math.round(sourceHeight * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');

        if (!context) {
            throw new Error('Canvas is not available for image processing.');
        }

        context.drawImage(imageElement, 0, 0, width, height);

        const extensionIndex = file.name.lastIndexOf('.');
        const baseName = extensionIndex === -1 ? file.name : file.name.slice(0, extensionIndex);
        const extension = extensionIndex === -1 ? '' : file.name.slice(extensionIndex);

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((nextBlob) => {
                if (nextBlob) {
                    resolve(nextBlob);
                    return;
                }

                reject(new Error('Failed to generate resized image.'));
            }, file.type || 'image/jpeg', quality);
        });

        return new File([blob], `${baseName}${suffix}${extension}`, {
            type: file.type || 'image/jpeg',
            lastModified: Date.now()
        });
    }

    /**
     * Load a file into an HTML image element.
     * @param {File} file - File to load
     * @returns {Promise<HTMLImageElement>} Loaded image element
     */
    loadImageElement(file) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            const objectUrl = URL.createObjectURL(file);

            image.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(image);
            };

            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('Failed to load image for processing.'));
            };

            image.src = objectUrl;
        });
    }

    /**
     * Convert file to base64 data URL.
     * @param {File} file - File to convert
     * @returns {Promise<string>} Base64 data URL
     */
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    /**
     * Format timestamp for display.
     * @param {string} timestamp - ISO timestamp string
     * @returns {string} Formatted date string
     */
    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    /**
     * Filter gallery by country. Re-fetches from page 1.
     * @param {string} country - Country name to filter by
     * @returns {Promise<Array>} Filtered photos
     */
    async setCountryFilter(country, takenFrom = null, takenTo = null) {
        this.countryFilter = country || null;
        this.locationFilter = null;
        this.takenFromFilter = takenFrom || null;
        this.takenToFilter = takenTo || null;
        return this.fetchImages();
    }

    /**
     * Filter gallery by exact location string. Re-fetches from page 1.
     * @param {string} location - Location label to filter by
     * @returns {Promise<Array>} Filtered photos
     */
    async setLocationFilter(location, takenFrom = null, takenTo = null) {
        this.locationFilter = location || null;
        this.countryFilter = null;
        this.takenFromFilter = takenFrom || null;
        this.takenToFilter = takenTo || null;
        return this.fetchImages();
    }

    /**
     * Clear any active country filter and reload unfiltered.
     * @returns {Promise<Array>} All photos
     */
    async clearFilter() {
        this.countryFilter = null;
        this.locationFilter = null;
        this.takenFromFilter = null;
        this.takenToFilter = null;
        return this.fetchImages();
    }

    /**
     * Check if service is currently loading.
     * @returns {boolean} Loading state
     */
    getLoadingState() {
        return this.isLoading;
    }
}

window.ImageService = ImageService;
