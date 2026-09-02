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
        this.photoStateInput = document.getElementById('photo-state');
        this.photoCameraInput = document.getElementById('photo-camera');
        this.previewImage = document.getElementById('preview-image');
        this.fileStatusIcon = document.getElementById('file-status-icon');
        this.submitUploadBtn = document.getElementById('submit-upload');
        this.uploadProgress = document.getElementById('upload-progress');
        this.uploadError = document.getElementById('upload-error');
        this.uploadSuccess = document.getElementById('upload-success');
        this.sessionStatus = document.getElementById('admin-session-status');
        this.tabButtons = Array.from(document.querySelectorAll('[data-admin-tab]'));
        this.sections = Array.from(document.querySelectorAll('[data-admin-section]'));
        this.metadataTableBody = document.getElementById('metadata-table-body');
        this.metadataSearch = document.getElementById('metadata-search');
        this.metadataCount = document.getElementById('metadata-count');
        this.metadataSaveStatus = document.getElementById('metadata-save-status');
        this.metadataEmpty = document.getElementById('metadata-empty');
        this.loadMoreMetadataBtn = document.getElementById('load-more-metadata');
        this.confirmDialog = document.getElementById('admin-confirm-dialog');
        this.confirmTitle = document.getElementById('admin-confirm-title');
        this.confirmMessage = document.getElementById('admin-confirm-message');
        this.confirmCancelBtn = document.getElementById('admin-confirm-cancel');
        this.confirmAcceptBtn = document.getElementById('admin-confirm-accept');
        this.adminPhotos = [];
        this.metadataCursor = null;
        this.metadataHasMore = false;
        this.isLoadingMetadata = false;
        this.confirmResolver = null;
        this.confirmPreviousFocus = null;

        this.init();
    }

    async init() {
        this.bindEvents();
        this.resetForm();

        if (window.initializeCustomCalendars) {
            window.initializeCustomCalendars();
        }

        const authenticated = await this.loadSession();
        if (authenticated) {
            await this.loadMetadata();
        }
    }

    bindEvents() {
        this.photoFileInput.addEventListener('change', (event) => {
            this.handleFileSelect(event);
        });

        this.uploadForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            await this.handleSubmit();
        });

        const coordPasteHandler = (event) => {
            const text = (event.clipboardData || window.clipboardData).getData('text');
            const match = text.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
            if (match) {
                event.preventDefault();
                this.photoLatitudeInput.value = match[1];
                this.photoLongitudeInput.value = match[2];
            }
        };
        this.photoLatitudeInput.addEventListener('paste', coordPasteHandler);
        this.photoLongitudeInput.addEventListener('paste', coordPasteHandler);

        this.tabButtons.forEach((button) => {
            button.addEventListener('click', () => this.showSection(button.dataset.adminTab));
        });

        this.metadataSearch.addEventListener('input', () => this.filterMetadataRows());
        this.loadMoreMetadataBtn.addEventListener('click', () => this.loadMetadata({ append: true }));

        const markDirty = (event) => {
            const row = event.target.closest('tr');
            if (!row || !event.target.matches('input, textarea')) {
                return;
            }
            this.markMetadataRowDirty(row);
        };
        this.metadataTableBody.addEventListener('input', markDirty);
        this.metadataTableBody.addEventListener('change', markDirty);

        this.metadataTableBody.addEventListener('click', async (event) => {
            const saveButton = event.target.closest('[data-save-photo]');
            if (saveButton) {
                await this.saveMetadataRow(saveButton.closest('tr'), saveButton);
                return;
            }

            const deleteButton = event.target.closest('[data-delete-photo]');
            if (deleteButton) {
                await this.deleteMetadataRow(deleteButton.closest('tr'), deleteButton);
            }
        });

        this.confirmCancelBtn.addEventListener('click', () => this.closeConfirm(false));
        this.confirmAcceptBtn.addEventListener('click', () => this.closeConfirm(true));
        this.confirmDialog.addEventListener('click', (event) => {
            if (event.target === this.confirmDialog || event.target.dataset.adminConfirmDismiss !== undefined) {
                this.closeConfirm(false);
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !this.confirmDialog.classList.contains('hidden')) {
                event.preventDefault();
                this.closeConfirm(false);
            }
        });
    }

    async loadSession() {
        try {
            const session = await this.imageService.getAdminSession();
            this.sessionStatus.textContent = `Signed in as ${session.email}`;
            return true;
        } catch (error) {
            if (error.status === 401) {
                this.sessionStatus.textContent = 'Redirecting to complete admin login...';
                this.imageService.beginAdminSessionAuth('/admin/');
                return false;
            }

            this.sessionStatus.textContent = error.message;
            this.showUploadError(error.message);
            this.submitUploadBtn.disabled = true;
            this.setMetadataStatus(error.message, true);
            return false;
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
        const stateValue = this.photoStateInput ? this.photoStateInput.value.trim() : '';
        const cameraValue = this.photoCameraInput ? this.photoCameraInput.value.trim() : '';

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
        if (stateValue) {
            coords.state = stateValue;
        }

        try {
            this.showUploadProgress();
            this.hideUploadError();

            const result = await this.imageService.uploadPhoto(file, location, description, timestamp, coords, cameraValue);
            this.hideUploadProgress();
            this.resetForm();
            this.showUploadSuccess(result.message || 'Photo uploaded successfully.');
            await this.loadMetadata();
        } catch (error) {
            console.error('Admin upload failed:', error);
            this.hideUploadProgress();
            this.showUploadError(error.message || 'Failed to upload photo. Please try again.');
        }
    }

    showSection(sectionName) {
        this.tabButtons.forEach((button) => {
            const isActive = button.dataset.adminTab === sectionName;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', String(isActive));
        });
        this.sections.forEach((section) => {
            section.classList.toggle('hidden', section.dataset.adminSection !== sectionName);
        });
    }

    async loadMetadata(options = {}) {
        const append = Boolean(options.append);
        if (this.isLoadingMetadata) {
            return;
        }

        this.isLoadingMetadata = true;
        this.loadMoreMetadataBtn.disabled = true;
        this.loadMoreMetadataBtn.textContent = 'loading';
        if (!append) {
            this.metadataCount.textContent = 'Loading photos...';
            this.metadataCursor = null;
            this.metadataHasMore = false;
        }

        try {
            const page = await this.imageService.getAdminPhotos(append ? this.metadataCursor : null);
            this.adminPhotos = append ? [...this.adminPhotos, ...page.photos] : page.photos;
            this.metadataCursor = page.nextCursor;
            this.metadataHasMore = page.hasMore;
            this.renderMetadataRows(append ? page.photos : this.adminPhotos, append);
            this.loadMoreMetadataBtn.classList.toggle('hidden', !this.metadataHasMore);
            this.filterMetadataRows();
            this.setMetadataStatus('');
        } catch (error) {
            console.error('Failed to load admin metadata:', error);
            this.setMetadataStatus(error.message || 'Failed to load photo metadata.', true);
            if (!append) {
                this.metadataCount.textContent = 'Unable to load photos';
                this.metadataEmpty.classList.remove('hidden');
                this.metadataEmpty.textContent = 'Photo metadata could not be loaded.';
            }
        } finally {
            this.isLoadingMetadata = false;
            this.loadMoreMetadataBtn.disabled = false;
            this.loadMoreMetadataBtn.textContent = 'load more';
        }
    }

    renderMetadataRows(photos, append = false) {
        if (!append) {
            this.metadataTableBody.replaceChildren();
        }

        const fragment = document.createDocumentFragment();
        photos.forEach((photo) => fragment.appendChild(this.createMetadataRow(photo)));
        this.metadataTableBody.appendChild(fragment);
    }

    createMetadataRow(photo) {
        const row = document.createElement('tr');
        row.dataset.photoId = photo.id;
        row.dataset.search = this.getPhotoSearchText(photo);

        const photoCell = document.createElement('td');
        photoCell.className = 'admin-photo-cell';
        const imageLink = document.createElement('a');
        imageLink.className = 'admin-photo-thumb';
        imageLink.href = photo.url;
        imageLink.target = '_blank';
        imageLink.rel = 'noopener';
        imageLink.title = 'Open full photo';
        const image = document.createElement('img');
        image.src = photo.thumbnailUrl;
        image.alt = photo.location ? `Photo from ${photo.location}` : 'Gallery photo';
        image.width = 56;
        image.height = 56;
        image.loading = 'lazy';
        image.decoding = 'async';
        imageLink.appendChild(image);
        photoCell.appendChild(imageLink);
        row.appendChild(photoCell);

        const fields = [
            { name: 'takenAt', type: 'date', value: this.toDateInputValue(photo.timestamp), required: true },
            { name: 'location', type: 'text', value: photo.location, required: true },
            { name: 'country', type: 'text', value: photo.country },
            { name: 'state', type: 'text', value: photo.state },
            { name: 'camera', type: 'text', value: photo.camera },
            { name: 'latitude', type: 'number', value: photo.latitude, min: -90, max: 90 },
            { name: 'longitude', type: 'number', value: photo.longitude, min: -180, max: 180 },
            { name: 'description', type: 'textarea', value: photo.description }
        ];

        fields.forEach((field) => row.appendChild(this.createMetadataFieldCell(field)));

        const actionCell = document.createElement('td');
        actionCell.className = 'admin-row-actions';

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'btn btn-primary admin-save-button';
        saveButton.dataset.savePhoto = photo.id;
        saveButton.textContent = 'saved';
        saveButton.disabled = true;
        saveButton.setAttribute('aria-label', `Save metadata for ${photo.location || 'this photo'}`);
        actionCell.appendChild(saveButton);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'btn btn-danger admin-delete-button';
        deleteButton.dataset.deletePhoto = photo.id;
        deleteButton.textContent = 'delete';
        deleteButton.setAttribute('aria-label', `Delete photo ${photo.location || photo.id}`);
        actionCell.appendChild(deleteButton);

        row.appendChild(actionCell);

        return row;
    }

    createMetadataFieldCell(field) {
        const cell = document.createElement('td');
        const control = document.createElement(field.type === 'textarea' ? 'textarea' : 'input');
        control.dataset.field = field.name;
        control.setAttribute('aria-label', field.name);

        if (field.type !== 'textarea') {
            control.type = field.type;
        } else {
            control.rows = 2;
        }
        if (field.type === 'number') {
            control.step = 'any';
        }
        if (field.min !== undefined) {
            control.min = String(field.min);
        }
        if (field.max !== undefined) {
            control.max = String(field.max);
        }
        if (field.required) {
            control.required = true;
        }
        control.value = field.value ?? '';
        cell.appendChild(control);
        return cell;
    }

    markMetadataRowDirty(row) {
        row.classList.add('is-dirty');
        const saveButton = row.querySelector('[data-save-photo]');
        if (!saveButton || saveButton.dataset.busy === 'true') {
            return;
        }
        saveButton.disabled = false;
        saveButton.textContent = 'save';
    }

    getRowSummary(row) {
        const location = row.querySelector('[data-field="location"]')?.value.trim() || 'this photo';
        const takenAt = row.querySelector('[data-field="takenAt"]')?.value.trim();
        return takenAt ? `${location} (${takenAt})` : location;
    }

    async confirmAction({ title, message, confirmLabel, danger = false }) {
        if (this.confirmResolver) {
            this.closeConfirm(false);
        }

        this.confirmTitle.textContent = title;
        this.confirmMessage.textContent = message;
        this.confirmAcceptBtn.textContent = confirmLabel;
        this.confirmAcceptBtn.classList.toggle('btn-danger', danger);
        this.confirmAcceptBtn.classList.toggle('btn-primary', !danger);
        this.confirmDialog.classList.remove('hidden');
        this.confirmDialog.setAttribute('aria-hidden', 'false');
        this.confirmPreviousFocus = document.activeElement;
        this.confirmAcceptBtn.focus();

        return new Promise((resolve) => {
            this.confirmResolver = resolve;
        });
    }

    closeConfirm(confirmed) {
        if (!this.confirmResolver) {
            return;
        }

        const resolve = this.confirmResolver;
        this.confirmResolver = null;
        this.confirmDialog.classList.add('hidden');
        this.confirmDialog.setAttribute('aria-hidden', 'true');
        if (this.confirmPreviousFocus && typeof this.confirmPreviousFocus.focus === 'function') {
            this.confirmPreviousFocus.focus();
        }
        this.confirmPreviousFocus = null;
        resolve(confirmed);
    }

    setRowBusy(row, busy) {
        row.querySelectorAll('button').forEach((button) => {
            button.dataset.busy = busy ? 'true' : 'false';
            button.disabled = busy || (button.matches('[data-save-photo]') && !row.classList.contains('is-dirty'));
        });
    }

    async saveMetadataRow(row, saveButton) {
        const controls = Array.from(row.querySelectorAll('[data-field]'));
        if (controls.some((control) => !control.reportValidity())) {
            return;
        }

        const metadata = {};
        controls.forEach((control) => {
            const value = control.value.trim();
            metadata[control.dataset.field] = ['latitude', 'longitude'].includes(control.dataset.field)
                ? (value === '' ? null : Number(value))
                : value;
        });

        const confirmed = await this.confirmAction({
            title: 'Save metadata changes?',
            message: `Save updates to ${this.getRowSummary(row)}?`,
            confirmLabel: 'save'
        });
        if (!confirmed) {
            return;
        }

        this.setRowBusy(row, true);
        saveButton.textContent = 'saving';
        this.setMetadataStatus('Saving changes...');

        try {
            const result = await this.imageService.updatePhotoMetadata(row.dataset.photoId, metadata);
            const photoIndex = this.adminPhotos.findIndex((photo) => photo.id === result.photo.id);
            if (photoIndex !== -1) {
                this.adminPhotos[photoIndex] = result.photo;
            }
            row.dataset.search = this.getPhotoSearchText(result.photo);
            row.classList.remove('is-dirty');
            saveButton.textContent = 'saved';
            this.setMetadataStatus('Changes saved.');
            this.filterMetadataRows();
        } catch (error) {
            console.error('Failed to save metadata:', error);
            saveButton.textContent = 'retry';
            this.setMetadataStatus(error.message || 'Failed to save changes.', true);
        } finally {
            this.setRowBusy(row, false);
        }
    }

    async deleteMetadataRow(row, deleteButton) {
        const confirmed = await this.confirmAction({
            title: 'Delete this photo?',
            message: `This will permanently delete the photo and its metadata for ${this.getRowSummary(row)}. This cannot be undone.`,
            confirmLabel: 'delete',
            danger: true
        });
        if (!confirmed) {
            return;
        }

        const photoId = row.dataset.photoId;
        this.setRowBusy(row, true);
        deleteButton.textContent = 'deleting';
        this.setMetadataStatus('Deleting photo...');

        try {
            await this.imageService.deletePhoto(photoId);
            this.adminPhotos = this.adminPhotos.filter((photo) => photo.id !== photoId);
            row.remove();
            this.setMetadataStatus('Photo and metadata deleted.');
            this.filterMetadataRows();
        } catch (error) {
            console.error('Failed to delete photo:', error);
            deleteButton.textContent = 'delete';
            this.setMetadataStatus(error.message || 'Failed to delete photo.', true);
            this.setRowBusy(row, false);
        }
    }

    filterMetadataRows() {
        const query = this.metadataSearch.value.trim().toLowerCase();
        let visibleCount = 0;

        this.metadataTableBody.querySelectorAll('tr').forEach((row) => {
            const matches = !query || row.dataset.search.includes(query);
            row.classList.toggle('hidden', !matches);
            if (matches) {
                visibleCount += 1;
            }
        });

        const total = this.adminPhotos.length;
        this.metadataCount.textContent = query
            ? `${visibleCount} of ${total} loaded photos`
            : `${total} photo${total === 1 ? '' : 's'} loaded${this.metadataHasMore ? ' · more available' : ''}`;
        this.metadataEmpty.classList.toggle('hidden', visibleCount !== 0);
        this.metadataEmpty.textContent = query ? 'No loaded photos match your search.' : 'No photos found.';
    }

    getPhotoSearchText(photo) {
        return [
            photo.location,
            photo.country,
            photo.state,
            photo.camera,
            photo.description,
            this.toDateInputValue(photo.timestamp)
        ].join(' ').toLowerCase();
    }

    toDateInputValue(value) {
        if (!value) {
            return '';
        }
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
    }

    setMetadataStatus(message, isError = false) {
        this.metadataSaveStatus.textContent = message;
        this.metadataSaveStatus.classList.toggle('is-error', isError);
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
