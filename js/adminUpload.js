/**
 * Admin upload page controller.
 * Requires Cloudflare Access on the admin route and API.
 */
class AdminUploadPage {
    constructor() {
        this.imageService = new ImageService();
        this.uploadForm = document.getElementById('upload-form');
        this.photoFileInput = document.getElementById('photo-file');
        this.photoLocationInput = document.getElementById('photo-location');
        this.photoDescriptionInput = document.getElementById('photo-description');
        this.photoTimestampInput = document.getElementById('photo-timestamp');
        this.photoLatitudeInput = document.getElementById('photo-latitude');
        this.photoLongitudeInput = document.getElementById('photo-longitude');
        this.photoCountryInput = document.getElementById('photo-country');
        this.previewImage = document.getElementById('preview-image');
        this.fileStatusIcon = document.getElementById('file-status-icon');
        this.submitUploadBtn = document.getElementById('submit-upload');
        this.uploadProgress = document.getElementById('upload-progress');
        this.uploadError = document.getElementById('upload-error');
        this.uploadSuccess = document.getElementById('upload-success');
        this.sessionStatus = document.getElementById('admin-session-status');

        this.init();
    }

    async init() {
        this.bindEvents();
        this.resetForm();

        if (window.initializeCustomCalendars) {
            window.initializeCustomCalendars();
        }

        await this.loadSession();
    }

    bindEvents() {
        this.photoFileInput.addEventListener('change', (event) => {
            this.handleFileSelect(event);
        });

        this.uploadForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            await this.handleSubmit();
        });
    }

    async loadSession() {
        try {
            const session = await this.imageService.getAdminSession();
            this.sessionStatus.textContent = `Signed in as ${session.email}`;
        } catch (error) {
            if (error.status === 401) {
                this.sessionStatus.textContent = 'Redirecting to complete admin login...';
                this.imageService.beginAdminSessionAuth('/admin/');
                return;
            }

            this.sessionStatus.textContent = error.message;
            this.showUploadError(error.message);
            this.submitUploadBtn.disabled = true;
        }
    }

    resetForm() {
        this.uploadForm.reset();
        this.uploadProgress.classList.remove('active');
        this.uploadError.classList.add('hidden');
        this.uploadSuccess.classList.add('hidden');
        this.previewImage.src = '';
        this.submitUploadBtn.disabled = false;
        this.submitUploadBtn.textContent = 'upload';
        this.fileStatusIcon.textContent = '✕';
        this.fileStatusIcon.classList.remove('selected');
    }

    handleFileSelect(event) {
        const file = event.target.files[0];

        this.uploadSuccess.classList.add('hidden');

        if (!file) {
            this.previewImage.src = '';
            this.fileStatusIcon.textContent = '✕';
            this.fileStatusIcon.classList.remove('selected');
            return;
        }

        if (!file.type.startsWith('image/')) {
            this.showUploadError('Please select a valid image file.');
            this.photoFileInput.value = '';
            this.previewImage.src = '';
            this.fileStatusIcon.textContent = '✕';
            this.fileStatusIcon.classList.remove('selected');
            return;
        }

        this.hideUploadError();
        this.fileStatusIcon.textContent = '✓';
        this.fileStatusIcon.classList.add('selected');

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            this.previewImage.src = loadEvent.target.result;
        };
        reader.readAsDataURL(file);
    }

    async handleSubmit() {
        const file = this.photoFileInput.files[0];
        const location = this.photoLocationInput.value.trim();
        const description = this.photoDescriptionInput.value.trim();
        const timestampValue = this.photoTimestampInput.value;
        const latitudeValue = this.photoLatitudeInput.value.trim();
        const longitudeValue = this.photoLongitudeInput.value.trim();
        const countryValue = this.photoCountryInput.value.trim();

        if (!file) {
            this.showUploadError('Please select a photo to upload.');
            return;
        }

        if (!location) {
            this.showUploadError('Please enter a location for the photo.');
            return;
        }

        let timestamp = null;
        if (timestampValue) {
            const date = new Date(timestampValue);
            timestamp = {
                day: date.getDate(),
                month: date.getMonth() + 1,
                year: date.getFullYear()
            };
        }

        const coords = {};
        if (latitudeValue !== '' && longitudeValue !== '') {
            const lat = Number.parseFloat(latitudeValue);
            const lon = Number.parseFloat(longitudeValue);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
                coords.latitude = lat;
                coords.longitude = lon;
            }
        }
        if (countryValue) {
            coords.country = countryValue;
        }

        try {
            this.showUploadProgress();
            this.hideUploadError();

            const result = await this.imageService.uploadPhoto(file, location, description, timestamp, coords);
            this.hideUploadProgress();
            this.resetForm();
            this.showUploadSuccess(result.message || 'Photo uploaded successfully.');
        } catch (error) {
            console.error('Admin upload failed:', error);
            this.hideUploadProgress();
            this.showUploadError(error.message || 'Failed to upload photo. Please try again.');
        }
    }

    showUploadProgress() {
        this.uploadProgress.classList.add('active');
        this.submitUploadBtn.disabled = true;
        this.submitUploadBtn.textContent = 'uploading';
    }

    hideUploadProgress() {
        this.uploadProgress.classList.remove('active');
        this.submitUploadBtn.disabled = false;
        this.submitUploadBtn.textContent = 'upload';
    }

    showUploadError(message) {
        this.uploadError.querySelector('p').textContent = message;
        this.uploadError.classList.remove('hidden');
    }

    hideUploadError() {
        this.uploadError.classList.add('hidden');
    }

    showUploadSuccess(message) {
        this.uploadSuccess.querySelector('p').textContent = message;
        this.uploadSuccess.classList.remove('hidden');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new AdminUploadPage();
    });
} else {
    new AdminUploadPage();
}
