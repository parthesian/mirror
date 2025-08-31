/**
 * Exposure Dial Controller
 * Handles the exposure dial functionality and theme switching
 */

class ExposureDial {
    constructor() {
        this.currentExposure = 0; // Default exposure value
        this.exposureValues = [-3, -2, -1, 0, 1, 2, 3];
        
        this.init();
    }

    init() {
        this.dialElement = document.getElementById('exposure-dial');
        this.dialMarks = this.dialElement.querySelectorAll('.dial-mark');
        
        // Set initial state
        this.setExposure(0);
        
        // Add event listeners
        this.addEventListeners();
    }

    addEventListeners() {
        // Add click listeners to dial marks
        this.dialMarks.forEach(mark => {
            mark.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = parseInt(mark.dataset.value);
                this.setExposure(value);
            });
        });

        // Add click listener to dial container for dragging functionality
        this.dialElement.addEventListener('mousedown', this.handleMouseDown.bind(this));
        
        // Add keyboard support
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
    }

    handleMouseDown(e) {
        e.preventDefault();
        
        const rect = this.dialElement.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const handleMouseMove = (e) => {
            const angle = this.calculateAngle(e.clientX, e.clientY, centerX, centerY);
            const exposure = this.angleToExposure(angle);
            this.setExposure(exposure);
        };
        
        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }

    handleKeyDown(e) {
        // Only handle keys when no input is focused
        if (document.activeElement.tagName === 'INPUT' || 
            document.activeElement.tagName === 'TEXTAREA') {
            return;
        }

        // Don't handle exposure controls when modal is open
        if (window.app && window.app.modal && window.app.modal.isModalOpen()) {
            return;
        }

        let newExposure = this.currentExposure;
        
        switch(e.key) {
            case 'ArrowUp':
            case 'ArrowRight':
                e.preventDefault();
                newExposure = Math.min(3, this.currentExposure + 1);
                break;
            case 'ArrowDown':
            case 'ArrowLeft':
                e.preventDefault();
                newExposure = Math.max(-3, this.currentExposure - 1);
                break;
        }
        
        if (newExposure !== this.currentExposure) {
            this.setExposure(newExposure);
        }
    }

    calculateAngle(mouseX, mouseY, centerX, centerY) {
        const deltaX = mouseX - centerX;
        const deltaY = mouseY - centerY;
        let angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
        
        // Normalize angle to 0-360 degrees
        if (angle < 0) angle += 360;
        
        // Adjust so 0 degrees is at the top (12 o'clock position)
        angle = (angle + 270) % 360;
        
        return angle;
    }

    angleToExposure(angle) {
        // Map angles to exposure values
        // 0° = 0, 45° = +1, 90° = +2, 135° = +3
        // 315° = -1, 270° = -2, 225° = -3
        
        const exposureAngles = {
            0: 0,     // 0°
            45: 1,    // 45°
            90: 2,    // 90°
            135: 3,   // 135°
            225: -3,  // 225°
            270: -2,  // 270°
            315: -1   // 315°
        };
        
        // Find the closest angle
        let closestAngle = 0;
        let minDiff = 360;
        
        for (const [targetAngle, exposure] of Object.entries(exposureAngles)) {
            const diff = Math.min(
                Math.abs(angle - targetAngle),
                Math.abs(angle - targetAngle + 360),
                Math.abs(angle - targetAngle - 360)
            );
            
            if (diff < minDiff) {
                minDiff = diff;
                closestAngle = parseInt(targetAngle);
            }
        }
        
        return exposureAngles[closestAngle];
    }

    setExposure(value) {
        if (!this.exposureValues.includes(value)) {
            console.warn(`Invalid exposure value: ${value}`);
            return;
        }
        
        this.currentExposure = value;
        
        // Update dial visual state
        this.updateDialVisual();
        
        // Apply theme
        this.applyTheme(value);
        
        // Store preference
        this.storeExposurePreference(value);
        
        // Dispatch custom event
        this.dispatchExposureChangeEvent(value);
    }

    updateDialVisual() {
        // Update dial data attribute for CSS pointer positioning
        this.dialElement.setAttribute('data-exposure', this.currentExposure);
        
        // Update active mark
        this.dialMarks.forEach(mark => {
            const markValue = parseInt(mark.dataset.value);
            mark.classList.toggle('active', markValue === this.currentExposure);
        });
    }

    applyTheme(exposure) {
        // Remove all existing exposure classes
        document.body.className = document.body.className.replace(/exposure-[-\d]+/g, '');
        
        // Add new exposure class
        const exposureClass = `exposure-${exposure}`;
        document.body.classList.add(exposureClass);
    }

    storeExposurePreference(value) {
        try {
            localStorage.setItem('mirror-exposure', value.toString());
        } catch (e) {
            console.warn('Could not store exposure preference:', e);
        }
    }

    loadExposurePreference() {
        try {
            const stored = localStorage.getItem('mirror-exposure');
            if (stored !== null) {
                const value = parseInt(stored);
                if (this.exposureValues.includes(value)) {
                    this.setExposure(value);
                    return true;
                }
            }
        } catch (e) {
            console.warn('Could not load exposure preference:', e);
        }
        return false;
    }

    dispatchExposureChangeEvent(value) {
        const event = new CustomEvent('exposureChange', {
            detail: { exposure: value }
        });
        document.dispatchEvent(event);
    }

    // Public API methods
    getExposure() {
        return this.currentExposure;
    }

    increaseExposure() {
        const newValue = Math.min(3, this.currentExposure + 1);
        this.setExposure(newValue);
    }

    decreaseExposure() {
        const newValue = Math.max(-3, this.currentExposure - 1);
        this.setExposure(newValue);
    }

    resetExposure() {
        this.setExposure(0);
    }
}

// Initialize exposure dial when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.exposureDial = new ExposureDial();
    
    // Load saved preference
    window.exposureDial.loadExposurePreference();
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExposureDial;
}
