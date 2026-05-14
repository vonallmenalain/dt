/* =============================================================================
 *  auth-modal.js
 *
 *  Thin presentation layer on top of `window.DreamTeamAuth`.
 *
 *  Public API (exposed as `window.DreamTeamAuthModal`):
 *
 *    install({ mountChip = true } = {})
 *        Lazily creates the modal DOM (idempotent) and optionally mounts the
 *        floating top-right Login / Account chip. The chip auto-updates from
 *        `DreamTeamAuth.onAuthStateChange`.
 *
 *    open({ mode, prefill, onAuthenticated, onClose })
 *        mode:  'login' | 'register' | 'verify'      (default: 'register')
 *        prefill.email                                  pre-fills the email field
 *        onAuthenticated({ user, isVerified })          called on successful sign-in
 *                                                       or after a fresh registration
 *                                                       (with isVerified=false)
 *        onClose()                                      called when the modal is
 *                                                       dismissed (user choice).
 *
 *    close()
 *
 *    showVerifyPending({ email })
 *        Switches the modal to the "Check your inbox" view. Useful right after
 *        registration, when the team payload is sitting in localStorage waiting
 *        for the user to click the verification link.
 *
 *  This module never reads localStorage or talks to Firestore directly; it
 *  only orchestrates the UI and delegates to DreamTeamAuth.
 * ============================================================================= */
(function () {
    'use strict';

    /* ---------------------------------------------------------------------------
     *  State
     * ------------------------------------------------------------------------- */
    const state = {
        installed:    false,
        modalEl:      null,
        chipEl:       null,
        currentMode:  null,
        callbacks:    { onAuthenticated: null, onClose: null }
    };

    /* ---------------------------------------------------------------------------
     *  DOM helpers
     * ------------------------------------------------------------------------- */
    function el(tag, attrs = {}, children = []) {
        const node = document.createElement(tag);
        Object.entries(attrs).forEach(([k, v]) => {
            if (k === 'class')   node.className = v;
            else if (k === 'html') node.innerHTML = v;
            else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => node.addEventListener(ev, fn));
            else if (v !== null && v !== undefined) node.setAttribute(k, v);
        });
        (Array.isArray(children) ? children : [children]).forEach(c => {
            if (c == null) return;
            node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return node;
    }

    function friendlyAuthError(err) {
        const code = err && err.code ? err.code : '';
        switch (code) {
            case 'auth/invalid-email':            return 'Diese E-Mail-Adresse ist ungültig.';
            case 'auth/email-already-in-use':     return 'Diese E-Mail-Adresse ist bereits registriert. Bitte melde dich an.';
            case 'auth/weak-password':            return 'Passwort zu kurz (mindestens 6 Zeichen).';
            case 'auth/user-not-found':           return 'Kein Konto gefunden. Bitte registriere dich zuerst.';
            case 'auth/wrong-password':           return 'Falsches Passwort.';
            case 'auth/too-many-requests':        return 'Zu viele Versuche. Bitte versuche es später erneut.';
            case 'auth/network-request-failed':   return 'Netzwerkfehler. Bitte Verbindung prüfen.';
            case 'auth/invalid-credential':       return 'E-Mail oder Passwort stimmt nicht.';
            default:                              return (err && err.message) ? err.message : 'Ein unbekannter Fehler ist aufgetreten.';
        }
    }

    /* ---------------------------------------------------------------------------
     *  Modal markup (built lazily once)
     * ------------------------------------------------------------------------- */
    function buildModal() {
        if (state.modalEl) return state.modalEl;

        const card = el('div', { class: 'dt-auth-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dt-auth-title' });

        // Header
        const header = el('div', { class: 'dt-auth-card-header' }, [
            el('h2', { id: 'dt-auth-title', class: 'dt-auth-card-title' }, ['Konto erstellen']),
            el('button', { class: 'dt-auth-close', 'aria-label': 'Schliessen', type: 'button', on: { click: () => close({ userInitiated: true }) } }, ['×'])
        ]);
        card.appendChild(header);

        // Subtitle (mode-dependent)
        const subtitle = el('p', { class: 'dt-auth-card-subtitle', id: 'dt-auth-subtitle' }, [
            'Damit wir dein Team später wiedererkennen, brauchen wir nur eine E-Mail-Adresse.'
        ]);
        card.appendChild(subtitle);

        // Tabs
        const tabs = el('div', { class: 'dt-auth-tabs', role: 'tablist' }, [
            el('button', { class: 'dt-auth-tab', 'data-mode': 'register', type: 'button', role: 'tab', on: { click: () => setMode('register') } }, ['Registrieren']),
            el('button', { class: 'dt-auth-tab', 'data-mode': 'login',    type: 'button', role: 'tab', on: { click: () => setMode('login') } },    ['Anmelden'])
        ]);
        card.appendChild(tabs);

        // Body: form view
        const errorBox = el('p', { class: 'dt-auth-error', id: 'dt-auth-error', hidden: '' });

        const emailField = el('div', { class: 'dt-auth-field' }, [
            el('label', { class: 'dt-auth-label', for: 'dt-auth-email' }, ['E-Mail']),
            el('input', { class: 'dt-auth-input', id: 'dt-auth-email', type: 'email', autocomplete: 'email', required: '', placeholder: 'du@beispiel.com' })
        ]);

        const passwordField = el('div', { class: 'dt-auth-field' }, [
            el('label', { class: 'dt-auth-label', for: 'dt-auth-password' }, ['Passwort']),
            el('input', { class: 'dt-auth-input', id: 'dt-auth-password', type: 'password', autocomplete: 'current-password', required: '', minlength: '6', placeholder: 'Mindestens 6 Zeichen' })
        ]);

        const helper = el('p', { class: 'dt-auth-helper', id: 'dt-auth-helper' }, [
            'Wir verwenden deine E-Mail-Adresse nur, um dein Team zu schützen.'
        ]);

        const submitBtn = el('button', { class: 'dt-auth-submit', id: 'dt-auth-submit', type: 'submit' }, ['Konto erstellen & E-Mail bestätigen']);

        const forgotRow = el('div', { class: 'dt-auth-card-footer', id: 'dt-auth-forgot-row', style: 'padding-top:12px;padding-bottom:0;' }, [
            el('button', { class: 'dt-auth-link', type: 'button', id: 'dt-auth-forgot' }, ['Passwort vergessen?'])
        ]);

        const formView = el('form', { class: 'dt-auth-view', id: 'dt-auth-view-form', novalidate: '' }, [
            errorBox, emailField, passwordField, helper, submitBtn, forgotRow
        ]);

        // Body: verify view
        const verifyView = el('div', { class: 'dt-auth-view dt-auth-verify', id: 'dt-auth-view-verify', hidden: '' }, [
            el('div', { class: 'dt-auth-verify-icon' }, ['📬']),
            el('h3', { class: 'dt-auth-verify-title' }, ['Bestätige deine E-Mail-Adresse']),
            el('p', { class: 'dt-auth-verify-text', id: 'dt-auth-verify-text' }, [
                'Wir haben dir einen Bestätigungslink geschickt. Klicke ihn an, komm dann zurück – dein Team wird automatisch gespeichert.'
            ]),
            el('div', { class: 'dt-auth-info', id: 'dt-auth-verify-info', hidden: '' }, [
                'Dein Team wartet sicher auf deinem Gerät, bis du die E-Mail bestätigt hast.'
            ]),
            el('button', { class: 'dt-auth-submit', id: 'dt-auth-verify-check', type: 'button' }, ['Ich habe bestätigt – prüfen']),
            el('button', { class: 'dt-auth-secondary', id: 'dt-auth-verify-resend', type: 'button' }, ['E-Mail erneut senden']),
            el('p', { class: 'dt-auth-card-footer', style: 'padding:14px 0 0;' }, [
                el('button', { class: 'dt-auth-link', type: 'button', id: 'dt-auth-verify-logout' }, ['Andere E-Mail verwenden'])
            ])
        ]);

        const body = el('div', { class: 'dt-auth-card-body', id: 'dt-auth-body' }, [formView, verifyView]);
        card.appendChild(body);

        // Outer overlay
        const overlay = el('div', { class: 'dt-auth-modal', id: 'dt-auth-modal', 'aria-hidden': 'true', on: {
            click: (e) => { if (e.target === overlay) close({ userInitiated: true }); }
        } }, [card]);

        document.body.appendChild(overlay);

        // Form submission
        formView.addEventListener('submit', handleFormSubmit);

        // Forgot password
        forgotRow.querySelector('#dt-auth-forgot').addEventListener('click', handleForgotPassword);

        // Verify view buttons
        verifyView.querySelector('#dt-auth-verify-check').addEventListener('click', handleVerifyCheck);
        verifyView.querySelector('#dt-auth-verify-resend').addEventListener('click', handleResend);
        verifyView.querySelector('#dt-auth-verify-logout').addEventListener('click', handleVerifyLogout);

        // ESC to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && state.modalEl && state.modalEl.classList.contains('is-open')) {
                close({ userInitiated: true });
            }
        });

        state.modalEl = overlay;
        return overlay;
    }

    /* ---------------------------------------------------------------------------
     *  Floating chip (top-right) — Login / Verify / Account
     * ------------------------------------------------------------------------- */
    function mountChip() {
        if (state.chipEl) return state.chipEl;

        const chip = el('button', { class: 'dt-auth-chip', type: 'button', 'data-state': 'signed-out', on: { click: handleChipClick } }, [
            el('span', { class: 'dt-auth-chip-icon' }, ['👤']),
            el('span', { class: 'dt-auth-chip-label' }, ['Anmelden'])
        ]);
        document.body.appendChild(chip);
        state.chipEl = chip;

        if (window.DreamTeamAuth && typeof window.DreamTeamAuth.onAuthStateChange === 'function') {
            window.DreamTeamAuth.onAuthStateChange(renderChip);
        }
        return chip;
    }

    function renderChip({ user, isVerified }) {
        if (!state.chipEl) return;
        const labelEl = state.chipEl.querySelector('.dt-auth-chip-label');

        if (!user) {
            state.chipEl.dataset.state = 'signed-out';
            state.chipEl.setAttribute('aria-label', 'Anmelden oder registrieren');
            labelEl.innerHTML = 'Anmelden';
            return;
        }

        const email = user.email || '';
        if (!isVerified) {
            state.chipEl.dataset.state = 'unverified';
            state.chipEl.setAttribute('aria-label', `E-Mail-Adresse ${email} bestätigen`);
            labelEl.innerHTML = `<span class="dt-auth-chip-email">${escapeHtml(email)}</span> · Bestätigen`;
            return;
        }

        state.chipEl.dataset.state = 'verified';
        state.chipEl.setAttribute('aria-label', `Angemeldet als ${email}`);
        labelEl.innerHTML = `<span class="dt-auth-chip-email">${escapeHtml(email)}</span> · Abmelden`;
    }

    function escapeHtml(v) {
        return String(v ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
        }[c]));
    }

    async function handleChipClick() {
        const Auth = window.DreamTeamAuth;
        if (!Auth) return;

        const user = Auth.getCurrentUser();

        if (!user) {
            open({ mode: 'login' });
            return;
        }
        if (!user.emailVerified) {
            open({ mode: 'verify' });
            return;
        }
        // Verified → confirm logout
        if (confirm('Möchtest du dich abmelden?')) {
            try {
                await Auth.logout();
            } catch (err) {
                alert('Abmelden fehlgeschlagen: ' + friendlyAuthError(err));
            }
        }
    }

    /* ---------------------------------------------------------------------------
     *  Modal show / hide / mode switching
     * ------------------------------------------------------------------------- */
    function open(options) {
        options = options || {};
        buildModal();

        state.callbacks.onAuthenticated = options.onAuthenticated || null;
        state.callbacks.onClose         = options.onClose || null;

        // Pre-fill email if given
        if (options.prefill && options.prefill.email) {
            const emailEl = state.modalEl.querySelector('#dt-auth-email');
            if (emailEl) emailEl.value = options.prefill.email;
        }

        setMode(options.mode || 'register');
        state.modalEl.classList.add('is-open');
        state.modalEl.setAttribute('aria-hidden', 'false');

        // Focus first sensible field
        setTimeout(() => {
            const focusTarget = state.modalEl.querySelector('.dt-auth-view:not([hidden]) input, .dt-auth-view:not([hidden]) button');
            if (focusTarget) focusTarget.focus();
        }, 30);
    }

    function close(options) {
        if (!state.modalEl) return;
        state.modalEl.classList.remove('is-open');
        state.modalEl.setAttribute('aria-hidden', 'true');
        clearError();

        if (options && options.userInitiated && typeof state.callbacks.onClose === 'function') {
            try { state.callbacks.onClose(); } catch (e) { /* noop */ }
        }
    }

    function setMode(mode) {
        buildModal();
        state.currentMode = mode;

        const titleEl    = state.modalEl.querySelector('#dt-auth-title');
        const subtitleEl = state.modalEl.querySelector('#dt-auth-subtitle');
        const submitEl   = state.modalEl.querySelector('#dt-auth-submit');
        const passwordEl = state.modalEl.querySelector('#dt-auth-password');
        const tabs       = state.modalEl.querySelectorAll('.dt-auth-tab');
        const formView   = state.modalEl.querySelector('#dt-auth-view-form');
        const verifyView = state.modalEl.querySelector('#dt-auth-view-verify');
        const tabsBar    = state.modalEl.querySelector('.dt-auth-tabs');

        clearError();

        if (mode === 'verify') {
            tabsBar.style.display = 'none';
            formView.hidden       = true;
            verifyView.hidden     = false;
            titleEl.textContent   = 'E-Mail bestätigen';
            subtitleEl.textContent = '';
            subtitleEl.style.display = 'none';
            renderVerifyView();
            return;
        }

        tabsBar.style.display    = '';
        subtitleEl.style.display = '';
        formView.hidden          = false;
        verifyView.hidden        = true;

        tabs.forEach(t => t.classList.toggle('is-active', t.dataset.mode === mode));

        if (mode === 'login') {
            titleEl.textContent    = 'Willkommen zurück';
            subtitleEl.textContent = 'Melde dich an, um dein bestehendes Team zu bearbeiten.';
            submitEl.textContent   = 'Anmelden';
            passwordEl.setAttribute('autocomplete', 'current-password');
        } else {
            titleEl.textContent    = 'Konto erstellen';
            subtitleEl.textContent = 'Damit wir dein Team später wiedererkennen, brauchen wir nur eine E-Mail-Adresse.';
            submitEl.textContent   = 'Konto erstellen & E-Mail bestätigen';
            passwordEl.setAttribute('autocomplete', 'new-password');
        }
    }

    function renderVerifyView() {
        const Auth = window.DreamTeamAuth;
        const user = Auth && Auth.getCurrentUser();
        const textEl = state.modalEl.querySelector('#dt-auth-verify-text');
        const infoEl = state.modalEl.querySelector('#dt-auth-verify-info');

        if (user && user.email) {
            textEl.innerHTML = `Wir haben dir einen Bestätigungslink an <span class="dt-auth-verify-email">${escapeHtml(user.email)}</span> geschickt. Klicke ihn an, komm dann zurück – dein Team wird automatisch gespeichert.`;
        } else {
            textEl.textContent = 'Wir haben dir einen Bestätigungslink geschickt. Klicke ihn an, komm dann zurück – dein Team wird automatisch gespeichert.';
        }

        // Show the "your team is waiting" reassurance only if a pending team
        // is actually sitting in localStorage.
        if (Auth && typeof Auth.hasPendingTeam === 'function' && Auth.hasPendingTeam()) {
            infoEl.hidden = false;
        } else {
            infoEl.hidden = true;
        }
    }

    /* ---------------------------------------------------------------------------
     *  Form handlers
     * ------------------------------------------------------------------------- */
    function showError(message) {
        const box = state.modalEl.querySelector('#dt-auth-error');
        if (!box) return;
        box.textContent = message;
        box.hidden      = false;
    }
    function clearError() {
        if (!state.modalEl) return;
        const box = state.modalEl.querySelector('#dt-auth-error');
        if (box) { box.textContent = ''; box.hidden = true; }
    }

    function setSubmitting(isSubmitting, fallbackLabel) {
        const btn = state.modalEl.querySelector('#dt-auth-submit');
        if (!btn) return;
        btn.disabled = isSubmitting;
        if (isSubmitting) {
            btn.dataset.prevLabel = btn.textContent;
            btn.innerHTML = '<span class="dt-auth-spinner" aria-hidden="true"></span>Bitte warten…';
        } else {
            btn.textContent = fallbackLabel || btn.dataset.prevLabel || 'Bestätigen';
        }
    }

    async function handleFormSubmit(event) {
        event.preventDefault();
        clearError();

        const Auth = window.DreamTeamAuth;
        if (!Auth) { showError('Auth-Modul nicht initialisiert.'); return; }

        const email    = (state.modalEl.querySelector('#dt-auth-email').value || '').trim();
        const password = state.modalEl.querySelector('#dt-auth-password').value || '';

        if (!email)                 { showError('Bitte E-Mail-Adresse angeben.'); return; }
        if (!password)              { showError('Bitte Passwort angeben.'); return; }
        if (password.length < 6)    { showError('Das Passwort muss mindestens 6 Zeichen lang sein.'); return; }

        setSubmitting(true);

        try {
            if (state.currentMode === 'login') {
                const { user } = await Auth.login(email, password);
                if (typeof state.callbacks.onAuthenticated === 'function') {
                    state.callbacks.onAuthenticated({ user, isVerified: !!user.emailVerified });
                }
                if (!user.emailVerified) {
                    setMode('verify');
                    setSubmitting(false);
                    return;
                }
                close({ userInitiated: false });
            } else {
                const { user } = await Auth.registerWithEmail(email, password);
                if (typeof state.callbacks.onAuthenticated === 'function') {
                    state.callbacks.onAuthenticated({ user, isVerified: false });
                }
                setMode('verify');
                setSubmitting(false);
            }
        } catch (err) {
            console.error('[DreamTeamAuthModal] auth failed:', err);
            showError(friendlyAuthError(err));
            setSubmitting(false);
        }
    }

    async function handleForgotPassword() {
        const Auth = window.DreamTeamAuth;
        if (!Auth) return;
        const emailEl = state.modalEl.querySelector('#dt-auth-email');
        const email   = (emailEl && emailEl.value || '').trim();
        if (!email) { showError('Bitte zuerst E-Mail-Adresse eingeben.'); return; }
        try {
            await Auth.sendPasswordReset(email);
            clearError();
            showError('✅ Passwort-Reset-Link wurde an ' + email + ' gesendet.');
            const box = state.modalEl.querySelector('#dt-auth-error');
            if (box) {
                box.style.background = 'rgba(40,167,69,0.10)';
                box.style.borderColor = 'rgba(40,167,69,0.35)';
                box.style.color       = '#c9f0d4';
            }
        } catch (err) {
            showError(friendlyAuthError(err));
        }
    }

    async function handleVerifyCheck() {
        const Auth = window.DreamTeamAuth;
        if (!Auth) return;
        const btn = state.modalEl.querySelector('#dt-auth-verify-check');
        const prev = btn.textContent;
        btn.disabled = true;
        btn.innerHTML = '<span class="dt-auth-spinner" aria-hidden="true"></span>Prüfen…';
        try {
            const user = await Auth.reloadUser();
            if (user && user.emailVerified) {
                if (typeof state.callbacks.onAuthenticated === 'function') {
                    state.callbacks.onAuthenticated({ user, isVerified: true });
                }
                close({ userInitiated: false });
            } else {
                btn.disabled = false;
                btn.textContent = prev;
                showError('Noch nicht verifiziert. Bitte klicke den Link in der E-Mail und versuche es nochmals.');
            }
        } catch (err) {
            btn.disabled = false;
            btn.textContent = prev;
            showError(friendlyAuthError(err));
        }
    }

    async function handleResend() {
        const Auth = window.DreamTeamAuth;
        if (!Auth) return;
        const btn = state.modalEl.querySelector('#dt-auth-verify-resend');
        const prev = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Wird gesendet…';
        try {
            await Auth.resendVerification();
            btn.textContent = '✓ Erneut gesendet';
            setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2200);
        } catch (err) {
            btn.disabled = false;
            btn.textContent = prev;
            showError(friendlyAuthError(err));
        }
    }

    async function handleVerifyLogout() {
        const Auth = window.DreamTeamAuth;
        if (!Auth) return;
        try { await Auth.logout(); } catch (e) { /* noop */ }
        setMode('register');
    }

    /* ---------------------------------------------------------------------------
     *  Install / public surface
     * ------------------------------------------------------------------------- */
    function install(options) {
        options = options || {};
        if (state.installed) return;
        state.installed = true;

        buildModal();
        if (options.mountChip !== false) mountChip();
    }

    function showVerifyPending(/* options */) {
        open({ mode: 'verify' });
    }

    window.DreamTeamAuthModal = {
        install,
        open,
        close,
        setMode,
        showVerifyPending
    };
})();
