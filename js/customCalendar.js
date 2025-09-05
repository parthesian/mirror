/**
 * CustomCalendar - A floating glass-themed calendar component
 */
class CustomCalendar {
    constructor(inputElement) {
        this.inputElement = inputElement;
        this.calendarElement = null;
        this.currentDate = new Date();
        this.selectedDate = null;
        this.isOpen = false;
        
        this.monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        
        this.dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
        this.init();
    }
    
    init() {
        this.createCalendar();
        this.bindEvents();
        
        // Parse existing value if present
        if (this.inputElement.value) {
            this.selectedDate = new Date(this.inputElement.value);
            this.currentDate = new Date(this.selectedDate);
        }
    }
    
    createCalendar() {
        // Create calendar popup
        this.calendarElement = document.createElement('div');
        this.calendarElement.className = 'custom-calendar';
        this.calendarElement.innerHTML = `
            <div class="calendar-header">
                <button type="button" class="calendar-nav-btn prev-month">&lt;</button>
                <div class="calendar-month-year"></div>
                <button type="button" class="calendar-nav-btn next-month">&gt;</button>
            </div>
            <div class="calendar-weekdays"></div>
            <div class="calendar-days"></div>
        `;
        
        // Insert calendar after the input
        this.inputElement.parentNode.insertBefore(this.calendarElement, this.inputElement.nextSibling);
        
        this.renderCalendar();
    }
    
    bindEvents() {
        // Input click to toggle calendar
        this.inputElement.addEventListener('click', (e) => {
            console.log('Input clicked');
            e.preventDefault();
            this.toggle();
        });
        
        // Input focus to show calendar
        this.inputElement.addEventListener('focus', (e) => {
            console.log('Input focused');
            e.preventDefault();
            this.show();
        });
        
        // Input change to update calendar
        this.inputElement.addEventListener('change', (e) => {
            console.log('Input changed:', e.target.value);
            this.updateFromInput();
        });
        
        // Input blur to update calendar
        this.inputElement.addEventListener('blur', (e) => {
            setTimeout(() => {
                this.updateFromInput();
            }, 100);
        });
        
        // Calendar navigation
        this.calendarElement.querySelector('.prev-month').addEventListener('click', () => {
            this.currentDate.setMonth(this.currentDate.getMonth() - 1);
            this.renderCalendar();
        });
        
        this.calendarElement.querySelector('.next-month').addEventListener('click', () => {
            this.currentDate.setMonth(this.currentDate.getMonth() + 1);
            this.renderCalendar();
        });
        
        // Day selection
        this.calendarElement.addEventListener('click', (e) => {
            if (e.target.classList.contains('calendar-day') && !e.target.classList.contains('disabled')) {
                const day = parseInt(e.target.textContent);
                this.selectDate(day);
            }
        });
        
        // Close calendar when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.inputElement.contains(e.target) && !this.calendarElement.contains(e.target)) {
                this.hide();
            }
        });
        
        // Keyboard navigation
        this.inputElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggle();
            } else if (e.key === 'Escape') {
                this.hide();
            }
        });
    }
    
    renderCalendar() {
        const monthYearElement = this.calendarElement.querySelector('.calendar-month-year');
        const weekdaysElement = this.calendarElement.querySelector('.calendar-weekdays');
        const daysElement = this.calendarElement.querySelector('.calendar-days');
        
        // Render month/year header
        monthYearElement.textContent = `${this.monthNames[this.currentDate.getMonth()]} ${this.currentDate.getFullYear()}`;
        
        // Render weekday headers
        weekdaysElement.innerHTML = this.dayNames.map(day => 
            `<div class="calendar-weekday">${day}</div>`
        ).join('');
        
        // Render days
        const firstDay = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
        const lastDay = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 0);
        const startDate = new Date(firstDay);
        startDate.setDate(startDate.getDate() - firstDay.getDay());
        
        const days = [];
        const currentMonth = this.currentDate.getMonth();
        
        for (let i = 0; i < 42; i++) { // 6 weeks * 7 days
            const date = new Date(startDate);
            date.setDate(startDate.getDate() + i);
            
            const isCurrentMonth = date.getMonth() === currentMonth;
            const isSelected = this.selectedDate && 
                date.getDate() === this.selectedDate.getDate() &&
                date.getMonth() === this.selectedDate.getMonth() &&
                date.getFullYear() === this.selectedDate.getFullYear();
            const isToday = this.isToday(date);
            
            days.push(`
                <div class="calendar-day ${!isCurrentMonth ? 'disabled' : ''} ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}">
                    ${date.getDate()}
                </div>
            `);
        }
        
        daysElement.innerHTML = days.join('');
    }
    
    selectDate(day) {
        this.selectedDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), day);
        
        // Format date as YYYY-MM-DD for input value
        const formattedDate = this.selectedDate.toISOString().split('T')[0];
        this.inputElement.value = formattedDate;
        
        // Trigger change event
        this.inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        
        this.renderCalendar();
        this.hide();
    }
    
    updateFromInput() {
        const inputValue = this.inputElement.value;
        if (inputValue) {
            try {
                const newDate = new Date(inputValue + 'T00:00:00'); // Add time to avoid timezone issues
                if (!isNaN(newDate.getTime())) {
                    this.selectedDate = newDate;
                    this.currentDate = new Date(newDate);
                    this.renderCalendar();
                    console.log('Updated calendar from input:', inputValue);
                }
            } catch (e) {
                console.log('Invalid date in input:', inputValue);
            }
        } else {
            this.selectedDate = null;
            this.renderCalendar();
        }
    }
    
    isToday(date) {
        const today = new Date();
        return date.getDate() === today.getDate() &&
               date.getMonth() === today.getMonth() &&
               date.getFullYear() === today.getFullYear();
    }
    
    show() {
        if (this.isOpen) return;
        
        console.log('Showing calendar');
        this.isOpen = true;
        this.calendarElement.classList.add('active');
        
        // Position calendar
        this.positionCalendar();
        
        // Force visibility and positioning
        this.calendarElement.style.display = 'block';
        this.calendarElement.style.visibility = 'visible';
        this.calendarElement.style.opacity = '1';
        
        console.log('Calendar should now be visible', this.calendarElement);
    }
    
    hide() {
        if (!this.isOpen) return;
        
        console.log('Hiding calendar');
        this.isOpen = false;
        this.calendarElement.classList.remove('active');
        
        // Reset inline styles to let CSS handle the transition
        setTimeout(() => {
            if (!this.isOpen) {
                this.calendarElement.style.display = '';
                this.calendarElement.style.visibility = '';
                this.calendarElement.style.opacity = '';
            }
        }, 300); // Match CSS transition duration
    }
    
    toggle() {
        if (this.isOpen) {
            this.hide();
        } else {
            this.show();
        }
    }
    
    positionCalendar() {
        const inputRect = this.inputElement.getBoundingClientRect();
        const calendarRect = this.calendarElement.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        
        // Set calendar width to match input width
        this.calendarElement.style.width = `${inputRect.width}px`;
        
        // Reset positioning
        this.calendarElement.style.top = '';
        this.calendarElement.style.bottom = '';
        this.calendarElement.style.left = '';
        this.calendarElement.style.right = '';
        
        // Position below input by default
        let top = inputRect.bottom + 8;
        let left = inputRect.left;
        
        // Check if calendar would go off-screen vertically
        if (inputRect.bottom + calendarRect.height + 8 > viewportHeight) {
            // Position above input instead
            top = inputRect.top - calendarRect.height - 8;
        }
        
        // Check if calendar would go off-screen horizontally
        if (left + inputRect.width > viewportWidth) {
            left = viewportWidth - inputRect.width - 16;
        }
        
        if (left < 16) {
            left = 16;
        }
        
        this.calendarElement.style.position = 'fixed';
        this.calendarElement.style.top = `${top}px`;
        this.calendarElement.style.left = `${left}px`;
        this.calendarElement.style.zIndex = '10001';
    }
    
    destroy() {
        if (this.calendarElement) {
            this.calendarElement.remove();
        }
    }
}

// Function to initialize custom calendars for date inputs
function initializeCustomCalendars() {
    const dateInputs = document.querySelectorAll('input[type="date"]:not([data-custom-calendar])');
    dateInputs.forEach(input => {
        // Mark as processed to avoid duplicate initialization
        input.setAttribute('data-custom-calendar', 'true');
        
        // Hide the native date picker
        input.style.position = 'relative';
        input.style.colorScheme = 'dark';
        
        // Initialize custom calendar
        new CustomCalendar(input);
    });
}

// Auto-initialize custom calendars for date inputs on page load
document.addEventListener('DOMContentLoaded', initializeCustomCalendars);

// Also initialize when new elements are added (for dynamic content like modals)
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check if the added node contains date inputs or is a date input itself
                    if (node.matches && node.matches('input[type="date"]')) {
                        initializeCustomCalendars();
                    } else if (node.querySelector) {
                        const dateInputs = node.querySelectorAll('input[type="date"]');
                        if (dateInputs.length > 0) {
                            initializeCustomCalendars();
                        }
                    }
                }
            });
        }
    });
});

// Start observing the document for changes
observer.observe(document.body, {
    childList: true,
    subtree: true
});

// Export for use in other modules
window.CustomCalendar = CustomCalendar;
window.initializeCustomCalendars = initializeCustomCalendars;
