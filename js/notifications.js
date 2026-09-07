/**
 * Shared toast / init-error UI.
 *
 * Reason: app.js previously injected unescaped HTML and inline styles.
 * Building the nodes with textContent keeps the same look without XSS,
 * and one stylesheet class keeps mobile/web toasts consistent.
 */
class Notifications {
    showInitializationError() {
        if (document.querySelector('.app-init-error')) {
            return;
        }

        const backdrop = document.createElement('div');
        backdrop.className = 'app-init-error-backdrop';

        const panel = document.createElement('div');
        panel.className = 'app-init-error';

        const title = document.createElement('h3');
        title.textContent = 'Initialization Error';

        const copy = document.createElement('p');
        copy.textContent = 'Failed to initialize the photo gallery. Please refresh the page and try again.';

        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Refresh Page';
        button.addEventListener('click', () => window.location.reload());

        panel.appendChild(title);
        panel.appendChild(copy);
        panel.appendChild(button);
        document.body.appendChild(backdrop);
        document.body.appendChild(panel);
    }

    showError(message) {
        const errorNotification = document.createElement('div');
        errorNotification.className = 'app-error-toast';

        const row = document.createElement('div');
        row.className = 'app-error-toast-row';

        const icon = document.createElement('span');
        icon.className = 'app-error-toast-icon';
        icon.textContent = '⚠';

        const text = document.createElement('span');
        text.className = 'app-error-toast-text';
        text.textContent = DomSafe.text(message);

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'app-error-toast-close';
        close.setAttribute('aria-label', 'Dismiss error');
        close.textContent = '×';
        close.addEventListener('click', () => errorNotification.remove());

        row.appendChild(icon);
        row.appendChild(text);
        row.appendChild(close);
        errorNotification.appendChild(row);
        document.body.appendChild(errorNotification);

        window.setTimeout(() => {
            if (errorNotification.parentElement) {
                errorNotification.remove();
            }
        }, 5000);
    }
}

window.Notifications = Notifications;
window.notifications = window.notifications || new Notifications();
