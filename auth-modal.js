/* =============================================================================
 *  auth-modal.js
 *
 *  Thin presentation layer on top of `window.DreamTeamAuth`.
 *
 *  Modal flow / view modes:
 *    'chooser'         – initial view: three sign-in options
 *                        (Google · Email-Link · Email & Password fallback)
 *    'email-link'      – passwordless email-link form (just an e-mail field)
 *    'email-link-sent' – confirmation after the link has been sent
 *    'register'        – classic email + password registration (tabs)
 *    'login'           – classic email + password login          (tabs)
 *    'verify'          – "Check your inbox" view for the password flow
 *
 *  Public API (exposed as `window.DreamTeamAuthModal`):
 *
 *    install({ navbarMountTarget = '#dt-auth-nav-slot', teamBuilderHref } = {})
 *        Lazily creates the modal DOM (idempotent) and mounts the small auth
 *        icon directly into the global navbar. The icon is grey when signed
 *        out and green once the user is signed in & verified, and clicking it
 *        opens the existing sign-in modal (signed-out) or a small dropdown
 *        with the user's e-mail, a "Mein Team" shortcut and a "Abmelden"
 *        button (signed-in). It auto-updates from
 *        `DreamTeamAuth.onAuthStateChange`.
 *
 *        Pass `navbarMountTarget: false` to skip mounting the navbar icon
 *        (tests, embedding scenarios). `teamBuilderHref` overrides the URL
 *        used by the "Mein Team" dropdown entry; defaults to
 *        `team-builder.html` (tournament param appended automatically when
 *        APP_CONFIG is present).
 *
 *    open({ mode, prefill, onAuthenticated, onClose })
 *        mode:  see view modes above (default: 'chooser')
 *        prefill.email                                  pre-fills the email field
 *        onAuthenticated({ user, isVerified })          called on successful sign-in
 *                                                       or after a fresh registration
 *                                                       (with isVerified=false)
 *        onClose()                                      called when the modal is
 *                                                       dismissed (user choice).
 *
 *    close()
 *    setMode(mode)
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
        installed:        false,
        modalEl:          null,
        navIconEl:        null,
        navDropdownEl:    null,
        navWrapperEl:     null,
        navAuthListener:  null,
        teamBuilderHref:  'team-builder.html',
        currentMode:      null,
        callbacks:        { onAuthenticated: null, onClose: null }
    };

    const VIEW_IDS = {
        chooser:           'dt-auth-view-chooser',
        'email-link':      'dt-auth-view-emaillink',
        'email-link-sent': 'dt-auth-view-emaillink-sent',
        register:          'dt-auth-view-form',
        login:             'dt-auth-view-form',
        verify:            'dt-auth-view-verify'
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

    /** Inline Google "G" logo (official 4-colour mark). */
    function googleLogoSvg() {
        return '<svg class="dt-auth-google-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true" focusable="false">'
            + '<path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>'
            + '<path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z"/>'
            + '<path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>'
            + '<path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>'
            + '</svg>';
    }

    function friendlyAuthError(err) {
        const code = err && err.code ? err.code : '';
        switch (code) {
            case 'auth/invalid-email':                 return 'Diese E-Mail-Adresse ist ungültig.';
            case 'auth/email-already-in-use':          return 'Diese E-Mail-Adresse ist bereits registriert. Bitte melde dich an.';
            case 'auth/weak-password':                 return 'Passwort zu kurz (mindestens 6 Zeichen).';
            case 'auth/user-not-found':                return 'Kein Konto gefunden. Bitte registriere dich zuerst.';
            case 'auth/wrong-password':                return 'Falsches Passwort.';
            case 'auth/too-many-requests':             return 'Zu viele Versuche. Bitte versuche es später erneut.';
            case 'auth/network-request-failed':        return 'Netzwerkfehler. Bitte Verbindung prüfen.';
            case 'auth/invalid-credential':            return 'E-Mail oder Passwort stimmt nicht.';
            case 'auth/popup-closed-by-user':          return 'Anmeldefenster geschlossen, bevor die Anmeldung abgeschlossen wurde.';
            case 'auth/popup-blocked':                 return 'Das Anmeldefenster wurde vom Browser blockiert. Bitte Pop-ups erlauben.';
            case 'auth/cancelled-popup-request':       return 'Ein anderes Anmeldefenster ist bereits geöffnet.';
            case 'auth/account-exists-with-different-credential':
                                                       return 'Es existiert bereits ein Konto mit dieser E-Mail-Adresse, aber mit einer anderen Anmeldemethode.';
            case 'auth/invalid-action-code':           return 'Der Anmeldelink ist ungültig oder bereits verwendet. Bitte fordere einen neuen Link an.';
            case 'auth/expired-action-code':           return 'Der Anmeldelink ist abgelaufen. Bitte fordere einen neuen Link an.';
            case 'auth/unauthorized-continue-uri':     return 'Diese Domain ist in Firebase nicht für Anmelde-Links freigeschaltet.';
            default:                                   return (err && err.message) ? err.message : 'Ein unbekannter Fehler ist aufgetreten.';
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
            el('h2', { id: 'dt-auth-title', class: 'dt-auth-card-title' }, ['Anmelden']),
            el('button', { class: 'dt-auth-close', 'aria-label': 'Schliessen', type: 'button', on: { click: () => close({ userInitiated: true }) } }, ['×'])
        ]);
        card.appendChild(header);

        // Subtitle (mode-dependent)
        const subtitle = el('p', { class: 'dt-auth-card-subtitle', id: 'dt-auth-subtitle' }, [
            'Wähle, wie du dich anmelden möchtest.'
        ]);
        card.appendChild(subtitle);

        // Tabs (only shown for the classic password flow)
        const tabs = el('div', { class: 'dt-auth-tabs', role: 'tablist', id: 'dt-auth-tabs' }, [
            el('button', { class: 'dt-auth-tab', 'data-mode': 'register', type: 'button', role: 'tab', on: { click: () => setMode('register') } }, ['Registrieren']),
            el('button', { class: 'dt-auth-tab', 'data-mode': 'login',    type: 'button', role: 'tab', on: { click: () => setMode('login') } },    ['Anmelden'])
        ]);
        card.appendChild(tabs);

        /* -------------------------------------------------------------------
         *  View: Chooser (default initial view)
         * ----------------------------------------------------------------- */
        const chooserView = el('div', { class: 'dt-auth-view dt-auth-chooser', id: VIEW_IDS.chooser }, [
            el('button', {
                class: 'dt-auth-provider dt-auth-provider-google',
                type:  'button',
                id:    'dt-auth-google-btn',
                'aria-label': 'Mit Google anmelden'
            }, [
                el('span', { class: 'dt-auth-provider-icon', html: googleLogoSvg() }),
                el('span', { class: 'dt-auth-provider-label' }, ['Mit Google anmelden'])
            ]),

            el('div', { class: 'dt-auth-divider' }, [
                el('span', { class: 'dt-auth-divider-text' }, ['oder'])
            ]),

            el('button', {
                class: 'dt-auth-provider dt-auth-provider-email-link',
                type:  'button',
                id:    'dt-auth-emaillink-btn'
            }, [
                el('span', { class: 'dt-auth-provider-icon', html: '✉️' }),
                el('span', { class: 'dt-auth-provider-label' }, [
                    'Mit E-Mail-Link anmelden',
                    el('small', { class: 'dt-auth-provider-sub' }, ['ohne Passwort'])
                ])
            ]),

            el('button', {
                class: 'dt-auth-provider dt-auth-provider-password',
                type:  'button',
                id:    'dt-auth-password-btn'
            }, [
                el('span', { class: 'dt-auth-provider-icon', html: '🔑' }),
                el('span', { class: 'dt-auth-provider-label' }, [
                    'Mit E-Mail & Passwort',
                    el('small', { class: 'dt-auth-provider-sub' }, ['klassisch'])
                ])
            ]),

            el('p', { class: 'dt-auth-helper dt-auth-chooser-helper' }, [
                'Wir verwenden deine E-Mail-Adresse nur, um dein Team zu schützen.'
            ])
        ]);

        /* -------------------------------------------------------------------
         *  View: Email-Link (passwordless)
         * ----------------------------------------------------------------- */
        const emailLinkError = el('p', { class: 'dt-auth-error', id: 'dt-auth-emaillink-error', hidden: '' });

        const emailLinkField = el('div', { class: 'dt-auth-field' }, [
            el('label', { class: 'dt-auth-label', for: 'dt-auth-emaillink-email' }, ['E-Mail']),
            el('input', {
                class: 'dt-auth-input',
                id:    'dt-auth-emaillink-email',
                type:  'email',
                autocomplete: 'email',
                required: '',
                placeholder: 'du@beispiel.com'
            })
        ]);

        const emailLinkHelper = el('p', { class: 'dt-auth-helper' }, [
            'Wir senden dir einen einmaligen Anmeldelink. Kein Passwort nötig.'
        ]);

        const emailLinkSubmit = el('button', {
            class: 'dt-auth-submit',
            id:    'dt-auth-emaillink-submit',
            type:  'submit'
        }, ['Anmeldelink senden']);

        const emailLinkView = el('form', {
            class: 'dt-auth-view dt-auth-emaillink',
            id:    VIEW_IDS['email-link'],
            novalidate: '',
            hidden: ''
        }, [
            emailLinkError,
            emailLinkField,
            emailLinkHelper,
            emailLinkSubmit,
            el('button', {
                class: 'dt-auth-secondary',
                id:    'dt-auth-emaillink-back',
                type:  'button'
            }, ['Zurück'])
        ]);

        /* -------------------------------------------------------------------
         *  View: Email-Link sent confirmation
         * ----------------------------------------------------------------- */
        const emailLinkSentView = el('div', {
            class: 'dt-auth-view dt-auth-verify',
            id:    VIEW_IDS['email-link-sent'],
            hidden: ''
        }, [
            el('div', { class: 'dt-auth-verify-icon' }, ['📩']),
            el('h3', { class: 'dt-auth-verify-title' }, ['Anmeldelink wurde gesendet']),
            el('p', { class: 'dt-auth-verify-text', id: 'dt-auth-emaillink-sent-text' }, [
                'Wir haben dir einen Anmeldelink geschickt. Öffne die E-Mail auf diesem Gerät und klicke den Link – du wirst automatisch angemeldet.'
            ]),
            el('div', { class: 'dt-auth-info', id: 'dt-auth-emaillink-sent-info', hidden: '' }, [
                'Dein Team wartet sicher auf diesem Gerät, bis du dich angemeldet hast.'
            ]),
            el('button', {
                class: 'dt-auth-secondary',
                id:    'dt-auth-emaillink-resend',
                type:  'button'
            }, ['Erneut senden']),
            el('p', { class: 'dt-auth-card-footer', style: 'padding:14px 0 0;' }, [
                el('button', {
                    class: 'dt-auth-link',
                    type:  'button',
                    id:    'dt-auth-emaillink-restart'
                }, ['Andere E-Mail-Adresse verwenden'])
            ])
        ]);

        /* -------------------------------------------------------------------
         *  View: Classic email + password (login / register)
         * ----------------------------------------------------------------- */
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

        const backToChooserRow = el('div', { class: 'dt-auth-card-footer', style: 'padding-top:8px;padding-bottom:0;' }, [
            el('button', { class: 'dt-auth-link', type: 'button', id: 'dt-auth-form-back' }, ['← Zurück zu allen Anmeldeoptionen'])
        ]);

        const formView = el('form', { class: 'dt-auth-view', id: VIEW_IDS.register, novalidate: '', hidden: '' }, [
            errorBox, emailField, passwordField, helper, submitBtn, forgotRow, backToChooserRow
        ]);

        /* -------------------------------------------------------------------
         *  View: Verify pending (after password registration)
         * ----------------------------------------------------------------- */
        const verifyView = el('div', { class: 'dt-auth-view dt-auth-verify', id: VIEW_IDS.verify, hidden: '' }, [
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

        const body = el('div', { class: 'dt-auth-card-body', id: 'dt-auth-body' }, [
            chooserView, emailLinkView, emailLinkSentView, formView, verifyView
        ]);
        card.appendChild(body);

        // Outer overlay
        const overlay = el('div', { class: 'dt-auth-modal', id: 'dt-auth-modal', 'aria-hidden': 'true', on: {
            click: (e) => { if (e.target === overlay) close({ userInitiated: true }); }
        } }, [card]);

        document.body.appendChild(overlay);

        /* ---------------------- Event wiring ---------------------- */

        // Chooser buttons
        chooserView.querySelector('#dt-auth-google-btn').addEventListener('click', handleGoogleSignIn);
        chooserView.querySelector('#dt-auth-emaillink-btn').addEventListener('click', () => setMode('email-link'));
        chooserView.querySelector('#dt-auth-password-btn').addEventListener('click', () => setMode('register'));

        // Email-link view
        emailLinkView.addEventListener('submit', handleEmailLinkSubmit);
        emailLinkView.querySelector('#dt-auth-emaillink-back').addEventListener('click', () => setMode('chooser'));

        // Email-link confirmation view
        emailLinkSentView.querySelector('#dt-auth-emaillink-resend').addEventListener('click', handleEmailLinkResend);
        emailLinkSentView.querySelector('#dt-auth-emaillink-restart').addEventListener('click', () => setMode('email-link'));

        // Classic form
        formView.addEventListener('submit', handleFormSubmit);
        forgotRow.querySelector('#dt-auth-forgot').addEventListener('click', handleForgotPassword);
        backToChooserRow.querySelector('#dt-auth-form-back').addEventListener('click', () => setMode('chooser'));

        // Verify view
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
     *  Navbar auth icon + dropdown
     *
     *  The auth icon is a small, discreet button embedded in the global navbar
     *  (rendered by nav.js). It looks like a plain person icon — grey when
     *  signed out, green when signed in & verified, amber when the user is
     *  signed in but the e-mail is not yet verified.
     *
     *  Click behaviour:
     *    - signed out  → open the sign-in modal directly (chooser view)
     *    - unverified  → open the modal in the "verify" view
     *    - verified    → toggle a small dropdown anchored to the icon with
     *                    the e-mail address, a "Mein Team" shortcut and a
     *                    "Abmelden" button.
     * ------------------------------------------------------------------------- */
    function userIconSvg() {
        // Inline person silhouette so the colour can be controlled via CSS
        // (currentColor) and we don't depend on any external asset.
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
            + '<path fill="currentColor" d="M12 12.5a4.25 4.25 0 1 0 0-8.5a4.25 4.25 0 0 0 0 8.5Zm0 1.75c-3.314 0-9 1.667-9 5v1.5c0 .414.336.75.75.75h16.5a.75.75 0 0 0 .75-.75v-1.5c0-3.333-5.686-5-9-5Z"/>'
            + '</svg>';
    }

    function mountNavbarIcon(target) {
        if (state.navIconEl) return state.navIconEl;

        let mountEl = null;
        if (typeof target === 'string')      mountEl = document.querySelector(target);
        else if (target instanceof Element)  mountEl = target;
        if (!mountEl) {
            // Fallback: append to <body>. This keeps the API graceful on
            // pages that haven't added the slot yet — the icon still works
            // but is positioned by CSS, not by the navbar.
            mountEl = document.body;
        }

        const wrapper = el('div', { class: 'dt-auth-nav-wrapper' });

        const button = el('button', {
            type: 'button',
            class: 'dt-auth-nav-icon',
            'data-state': 'signed-out',
            'aria-haspopup': 'menu',
            'aria-expanded': 'false',
            'aria-label': 'Anmelden oder registrieren',
            title: 'Anmelden',
            on: { click: handleNavIconClick }
        }, [
            el('span', { class: 'dt-auth-nav-icon-glyph', html: userIconSvg() }),
            el('span', { class: 'dt-auth-nav-icon-status', 'aria-hidden': 'true' })
        ]);

        const dropdown = el('div', {
            class: 'dt-auth-nav-dropdown',
            role: 'menu',
            hidden: ''
        }, [
            el('div', { class: 'dt-auth-nav-dropdown-header' }, [
                el('span', { class: 'dt-auth-nav-dropdown-label' }, ['Angemeldet als']),
                el('span', { class: 'dt-auth-nav-dropdown-email', id: 'dt-auth-nav-email' }, [''])
            ]),
            el('div', { class: 'dt-auth-nav-dropdown-divider' }),
            el('button', {
                type: 'button',
                role: 'menuitem',
                class: 'dt-auth-nav-dropdown-item',
                id: 'dt-auth-nav-myteam',
                on: { click: handleMyTeamClick }
            }, [
                el('span', { class: 'dt-auth-nav-dropdown-icon', html: '🛡️' }),
                el('span', {}, ['Mein Team'])
            ]),
            el('button', {
                type: 'button',
                role: 'menuitem',
                class: 'dt-auth-nav-dropdown-item dt-auth-nav-dropdown-item-danger',
                id: 'dt-auth-nav-logout',
                on: { click: handleLogoutClick }
            }, [
                el('span', { class: 'dt-auth-nav-dropdown-icon', html: '🚪' }),
                el('span', {}, ['Abmelden'])
            ])
        ]);

        wrapper.appendChild(button);
        wrapper.appendChild(dropdown);
        mountEl.appendChild(wrapper);

        state.navIconEl     = button;
        state.navDropdownEl = dropdown;
        state.navWrapperEl  = wrapper;

        // Close dropdown on outside click / Escape.
        document.addEventListener('click', (event) => {
            if (!state.navWrapperEl) return;
            if (!state.navWrapperEl.contains(event.target)) closeNavDropdown();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeNavDropdown();
        });

        if (window.DreamTeamAuth && typeof window.DreamTeamAuth.onAuthStateChange === 'function') {
            // Replay current state immediately and on every change.
            state.navAuthListener = window.DreamTeamAuth.onAuthStateChange(renderNavIcon);
        } else {
            renderNavIcon({ user: null, isVerified: false });
        }

        return button;
    }

    function renderNavIcon({ user, isVerified }) {
        if (!state.navIconEl) return;

        if (!user) {
            state.navIconEl.dataset.state = 'signed-out';
            state.navIconEl.setAttribute('aria-label', 'Anmelden oder registrieren');
            state.navIconEl.setAttribute('title', 'Anmelden');
            closeNavDropdown();
            return;
        }

        const email = user.email || '';
        if (!isVerified) {
            state.navIconEl.dataset.state = 'unverified';
            state.navIconEl.setAttribute('aria-label', `E-Mail-Adresse ${email} bestätigen`);
            state.navIconEl.setAttribute('title', `E-Mail bestätigen (${email})`);
            return;
        }

        state.navIconEl.dataset.state = 'verified';
        state.navIconEl.setAttribute('aria-label', `Angemeldet als ${email}`);
        state.navIconEl.setAttribute('title', `Angemeldet als ${email}`);

        // Keep the email shown inside the dropdown in sync.
        const emailEl = state.navDropdownEl && state.navDropdownEl.querySelector('#dt-auth-nav-email');
        if (emailEl) emailEl.textContent = email;
    }

    function openNavDropdown() {
        if (!state.navDropdownEl || !state.navIconEl) return;
        state.navDropdownEl.hidden = false;
        state.navDropdownEl.classList.add('is-open');
        state.navIconEl.setAttribute('aria-expanded', 'true');
    }

    function closeNavDropdown() {
        if (!state.navDropdownEl || !state.navIconEl) return;
        state.navDropdownEl.hidden = true;
        state.navDropdownEl.classList.remove('is-open');
        state.navIconEl.setAttribute('aria-expanded', 'false');
    }

    function escapeHtml(v) {
        return String(v ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
        }[c]));
    }

    function handleNavIconClick(event) {
        event.stopPropagation();
        const Auth = window.DreamTeamAuth;
        if (!Auth) {
            // Auth module not loaded yet — fall back to opening the team
            // builder (where the legacy lazy-registration flow lives).
            window.location.href = resolveTeamBuilderHref();
            return;
        }

        const user = Auth.getCurrentUser();

        if (!user) {
            closeNavDropdown();
            open({ mode: 'chooser' });
            return;
        }
        if (!user.emailVerified) {
            closeNavDropdown();
            open({ mode: 'verify' });
            return;
        }

        // Signed in & verified → toggle the dropdown.
        if (state.navDropdownEl && state.navDropdownEl.hidden) {
            openNavDropdown();
        } else {
            closeNavDropdown();
        }
    }

    function resolveTeamBuilderHref() {
        let href = state.teamBuilderHref || 'team-builder.html';
        try {
            const APP = window.APP_CONFIG;
            if (APP && APP.key) {
                const url = new URL(href, window.location.href);
                url.searchParams.set('tournament', APP.key);
                const fileName = url.pathname.split('/').pop() || 'team-builder.html';
                href = `${fileName}${url.search ? url.search : ''}${url.hash || ''}`;
            }
        } catch (_) { /* keep raw href */ }
        return href;
    }

    /**
     * Build a `teams.html` URL preserving the active tournament and optionally
     * pre-selecting a specific manager so the page jumps directly to that
     * team's view.
     */
    function resolveTeamsViewHref(managerName) {
        let href = 'teams.html';
        try {
            const APP = window.APP_CONFIG;
            const url = new URL(href, window.location.href);
            if (APP && APP.key) url.searchParams.set('tournament', APP.key);
            if (managerName) url.searchParams.set('manager', managerName);
            const fileName = url.pathname.split('/').pop() || 'teams.html';
            href = `${fileName}${url.search ? url.search : ''}${url.hash || ''}`;
        } catch (_) { /* keep raw href */ }
        return href;
    }

    /**
     * Decide whether the app is in "Nach Start" mode. Mirrors the logic of
     * the dev toggle on index.html (localStorage key `dreamteamIndexViewMode`
     * with values "auto" | "pre" | "post"), so an admin override on the
     * dashboard transparently steers the "Mein Team" shortcut as well.
     */
    function isPostStartMode() {
        try {
            const override = window.localStorage
                && window.localStorage.getItem('dreamteamIndexViewMode');
            if (override === 'pre') return false;
            if (override === 'post') return true;
        } catch (_) { /* localStorage may be blocked */ }

        try {
            const APP = window.APP_CONFIG;
            const start = APP && APP.DREAMTEAM_START;
            if (start instanceof Date && !isNaN(start.getTime())) {
                return Date.now() >= start.getTime();
            }
        } catch (_) { /* ignore */ }

        // Conservative default: treat unknown state as pre-start so the user
        // still ends up in the editable team builder instead of a possibly
        // empty teams view.
        return false;
    }

    /**
     * Resolve the target for the "Mein Team" dropdown entry:
     *   - Pre-Start  →  team-builder.html (Bearbeitung des eigenen Teams)
     *   - Nach Start →  teams.html?manager=<eigener Manager> (Ansicht)
     *
     * Looks up the user's manager name via DreamTeamAuth.fetchUserTeam so
     * teams.html opens directly on the signed-in user's team. If the lookup
     * fails or no team exists yet (e.g. user hasn't created one), we still
     * navigate to teams.html — the page can then prompt for / pick any team.
     */
    async function resolveMyTeamHref() {
        if (!isPostStartMode()) {
            return resolveTeamBuilderHref();
        }

        let managerName = null;
        try {
            const Auth = window.DreamTeamAuth;
            if (Auth && typeof Auth.fetchUserTeam === 'function') {
                const result = await Auth.fetchUserTeam();
                if (result && result.data && typeof result.data.manager === 'string') {
                    managerName = result.data.manager.trim() || null;
                }
            }
        } catch (err) {
            console.warn('[DreamTeamAuthModal] Could not look up user team for "Mein Team" navigation:', err);
        }

        return resolveTeamsViewHref(managerName);
    }

    async function handleMyTeamClick(event) {
        event.stopPropagation();
        const myTeamBtn = state.navDropdownEl
            && state.navDropdownEl.querySelector('#dt-auth-nav-myteam');

        // Provide immediate feedback for the post-start flow where we briefly
        // wait for the Firestore lookup to resolve. Pre-start navigation is
        // synchronous so the indicator never flickers in that case.
        let prevLabel = null;
        if (myTeamBtn && isPostStartMode()) {
            prevLabel = myTeamBtn.textContent;
            myTeamBtn.disabled = true;
            myTeamBtn.dataset.busy = '1';
        }

        let target;
        try {
            target = await resolveMyTeamHref();
        } finally {
            if (myTeamBtn && prevLabel !== null) {
                myTeamBtn.disabled = false;
                delete myTeamBtn.dataset.busy;
            }
        }

        closeNavDropdown();
        // Navigate even when already on the page so the target view fully
        // re-runs its "load my existing team" flow.
        window.location.href = target;
    }

    async function handleLogoutClick(event) {
        event.stopPropagation();
        closeNavDropdown();
        const Auth = window.DreamTeamAuth;
        if (!Auth) return;
        try {
            await Auth.logout();
        } catch (err) {
            alert('Abmelden fehlgeschlagen: ' + friendlyAuthError(err));
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

        // Pre-fill email (both form variants) if given.
        if (options.prefill && options.prefill.email) {
            const emailEl = state.modalEl.querySelector('#dt-auth-email');
            const linkEl  = state.modalEl.querySelector('#dt-auth-emaillink-email');
            if (emailEl) emailEl.value = options.prefill.email;
            if (linkEl)  linkEl.value  = options.prefill.email;
        }

        setMode(options.mode || 'chooser');
        state.modalEl.classList.add('is-open');
        state.modalEl.setAttribute('aria-hidden', 'false');

        // Focus first sensible field once the transition has settled.
        setTimeout(() => {
            const focusTarget = state.modalEl.querySelector('.dt-auth-view.is-visible input, .dt-auth-view.is-visible button:not(.dt-auth-close)');
            if (focusTarget) focusTarget.focus();
        }, 60);
    }

    function close(options) {
        if (!state.modalEl) return;
        state.modalEl.classList.remove('is-open');
        state.modalEl.setAttribute('aria-hidden', 'true');
        clearError();
        clearEmailLinkError();

        if (options && options.userInitiated && typeof state.callbacks.onClose === 'function') {
            try { state.callbacks.onClose(); } catch (e) { /* noop */ }
        }
    }

    /**
     * Switch between views with a small fade/slide transition.
     * The classic email + password form is shared between 'login' and
     * 'register' modes; only the labels + tab state change.
     */
    function setMode(mode) {
        buildModal();
        state.currentMode = mode;

        clearError();
        clearEmailLinkError();

        const titleEl    = state.modalEl.querySelector('#dt-auth-title');
        const subtitleEl = state.modalEl.querySelector('#dt-auth-subtitle');
        const tabsBar    = state.modalEl.querySelector('#dt-auth-tabs');
        const allViews   = state.modalEl.querySelectorAll('.dt-auth-view');

        const targetId = VIEW_IDS[mode] || VIEW_IDS.chooser;
        allViews.forEach(v => {
            const isTarget = v.id === targetId;
            v.hidden = !isTarget;
            v.classList.toggle('is-visible', isTarget);
        });

        // Tabs are only meaningful for the password form.
        if (mode === 'login' || mode === 'register') {
            tabsBar.style.display = '';
            tabsBar.querySelectorAll('.dt-auth-tab').forEach(t => {
                t.classList.toggle('is-active', t.dataset.mode === mode);
            });
        } else {
            tabsBar.style.display = 'none';
        }

        // Title / subtitle per mode.
        switch (mode) {
            case 'chooser':
                titleEl.textContent    = 'Anmelden';
                subtitleEl.textContent = 'Wähle, wie du dich anmelden möchtest.';
                subtitleEl.style.display = '';
                break;
            case 'email-link':
                titleEl.textContent    = 'Anmeldelink per E-Mail';
                subtitleEl.textContent = 'Wir senden dir einen Link, mit dem du dich ohne Passwort anmeldest.';
                subtitleEl.style.display = '';
                break;
            case 'email-link-sent':
                titleEl.textContent    = 'E-Mail unterwegs';
                subtitleEl.textContent = '';
                subtitleEl.style.display = 'none';
                renderEmailLinkSentView();
                break;
            case 'login':
                titleEl.textContent    = 'Willkommen zurück';
                subtitleEl.textContent = 'Melde dich an, um dein bestehendes Team zu bearbeiten.';
                subtitleEl.style.display = '';
                {
                    const submitEl   = state.modalEl.querySelector('#dt-auth-submit');
                    const passwordEl = state.modalEl.querySelector('#dt-auth-password');
                    if (submitEl)   submitEl.textContent = 'Anmelden';
                    if (passwordEl) passwordEl.setAttribute('autocomplete', 'current-password');
                }
                break;
            case 'register':
                titleEl.textContent    = 'Konto erstellen';
                subtitleEl.textContent = 'Damit wir dein Team später wiedererkennen, brauchen wir nur eine E-Mail-Adresse.';
                subtitleEl.style.display = '';
                {
                    const submitEl   = state.modalEl.querySelector('#dt-auth-submit');
                    const passwordEl = state.modalEl.querySelector('#dt-auth-password');
                    if (submitEl)   submitEl.textContent = 'Konto erstellen & E-Mail bestätigen';
                    if (passwordEl) passwordEl.setAttribute('autocomplete', 'new-password');
                }
                break;
            case 'verify':
                titleEl.textContent    = 'E-Mail bestätigen';
                subtitleEl.textContent = '';
                subtitleEl.style.display = 'none';
                renderVerifyView();
                break;
            default:
                titleEl.textContent    = 'Anmelden';
                subtitleEl.textContent = 'Wähle, wie du dich anmelden möchtest.';
                subtitleEl.style.display = '';
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

    function renderEmailLinkSentView() {
        const Auth   = window.DreamTeamAuth;
        const textEl = state.modalEl.querySelector('#dt-auth-emaillink-sent-text');
        const infoEl = state.modalEl.querySelector('#dt-auth-emaillink-sent-info');
        const linkEl = state.modalEl.querySelector('#dt-auth-emaillink-email');
        const email  = (linkEl && linkEl.value || '').trim();

        if (email) {
            textEl.innerHTML = `Wir haben einen Anmeldelink an <span class="dt-auth-verify-email">${escapeHtml(email)}</span> geschickt. Öffne die E-Mail <strong>auf diesem Gerät</strong> und klicke den Link – du wirst automatisch angemeldet.`;
        } else {
            textEl.textContent = 'Wir haben dir einen Anmeldelink geschickt. Öffne die E-Mail auf diesem Gerät und klicke den Link – du wirst automatisch angemeldet.';
        }

        if (Auth && typeof Auth.hasPendingTeam === 'function' && Auth.hasPendingTeam()) {
            infoEl.hidden = false;
        } else {
            infoEl.hidden = true;
        }
    }

    /* ---------------------------------------------------------------------------
     *  Error helpers
     * ------------------------------------------------------------------------- */
    function showError(message) {
        const box = state.modalEl.querySelector('#dt-auth-error');
        if (!box) return;
        box.textContent = message;
        box.hidden      = false;
        box.style.background = '';
        box.style.borderColor = '';
        box.style.color = '';
    }
    function clearError() {
        if (!state.modalEl) return;
        const box = state.modalEl.querySelector('#dt-auth-error');
        if (box) { box.textContent = ''; box.hidden = true; }
    }

    function showEmailLinkError(message) {
        const box = state.modalEl.querySelector('#dt-auth-emaillink-error');
        if (!box) return;
        box.textContent = message;
        box.hidden      = false;
        box.style.background = '';
        box.style.borderColor = '';
        box.style.color = '';
    }
    function clearEmailLinkError() {
        if (!state.modalEl) return;
        const box = state.modalEl.querySelector('#dt-auth-emaillink-error');
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

    function setEmailLinkSubmitting(isSubmitting) {
        const btn = state.modalEl.querySelector('#dt-auth-emaillink-submit');
        if (!btn) return;
        btn.disabled = isSubmitting;
        if (isSubmitting) {
            btn.dataset.prevLabel = btn.textContent;
            btn.innerHTML = '<span class="dt-auth-spinner" aria-hidden="true"></span>Wird gesendet…';
        } else {
            btn.textContent = btn.dataset.prevLabel || 'Anmeldelink senden';
        }
    }

    /* ---------------------------------------------------------------------------
     *  Handlers – Google
     * ------------------------------------------------------------------------- */
    async function handleGoogleSignIn() {
        const Auth = window.DreamTeamAuth;
        if (!Auth) return;

        const btn = state.modalEl.querySelector('#dt-auth-google-btn');
        const prevHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="dt-auth-spinner dt-auth-spinner-dark" aria-hidden="true"></span><span class="dt-auth-provider-label">Wird angemeldet…</span>';
        }

        try {
            const { user } = await Auth.signInWithGoogle();
            if (typeof state.callbacks.onAuthenticated === 'function') {
                state.callbacks.onAuthenticated({ user, isVerified: !!user.emailVerified });
            }
            close({ userInitiated: false });
        } catch (err) {
            console.error('[DreamTeamAuthModal] Google sign-in failed:', err);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = prevHtml;
            }
            // Surface the error inside the chooser. We piggy-back on the
            // shared `#dt-auth-error` box, which is hidden when not in the
            // password form view, so we use a tiny inline element instead.
            inlineChooserError(friendlyAuthError(err));
        }
    }

    function inlineChooserError(message) {
        const view = state.modalEl.querySelector('#' + VIEW_IDS.chooser);
        if (!view) return;
        let box = view.querySelector('.dt-auth-error');
        if (!box) {
            box = el('p', { class: 'dt-auth-error' });
            view.insertBefore(box, view.firstChild);
        }
        box.textContent = message;
        box.hidden      = false;
    }

    /* ---------------------------------------------------------------------------
     *  Handlers – Email-Link
     * ------------------------------------------------------------------------- */
    async function handleEmailLinkSubmit(event) {
        event.preventDefault();
        clearEmailLinkError();

        const Auth = window.DreamTeamAuth;
        if (!Auth) { showEmailLinkError('Auth-Modul nicht initialisiert.'); return; }

        const inputEl = state.modalEl.querySelector('#dt-auth-emaillink-email');
        const email   = (inputEl && inputEl.value || '').trim();

        if (!email) { showEmailLinkError('Bitte E-Mail-Adresse angeben.'); return; }

        setEmailLinkSubmitting(true);
        try {
            await Auth.sendSignInLinkToEmail(email);
            setEmailLinkSubmitting(false);
            setMode('email-link-sent');
        } catch (err) {
            console.error('[DreamTeamAuthModal] email-link send failed:', err);
            showEmailLinkError(friendlyAuthError(err));
            setEmailLinkSubmitting(false);
        }
    }

    async function handleEmailLinkResend() {
        const Auth = window.DreamTeamAuth;
        if (!Auth) return;
        const btn   = state.modalEl.querySelector('#dt-auth-emaillink-resend');
        const linkEl = state.modalEl.querySelector('#dt-auth-emaillink-email');
        const email = (linkEl && linkEl.value || '').trim();
        if (!email) { setMode('email-link'); return; }

        const prev = btn.textContent;
        btn.disabled    = true;
        btn.textContent = 'Wird gesendet…';
        try {
            await Auth.sendSignInLinkToEmail(email);
            btn.textContent = '✓ Erneut gesendet';
            setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 2200);
        } catch (err) {
            btn.disabled    = false;
            btn.textContent = prev;
            alert(friendlyAuthError(err));
        }
    }

    /* ---------------------------------------------------------------------------
     *  Handlers – classic email + password
     * ------------------------------------------------------------------------- */
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
        setMode('chooser');
    }

    /* ---------------------------------------------------------------------------
     *  Install / public surface
     * ------------------------------------------------------------------------- */
    function install(options) {
        options = options || {};
        if (state.installed) {
            // Allow callers to retry mounting the navbar icon if the slot
            // was added to the DOM after a first install() call (e.g. when
            // nav.js runs after the auth-modal script).
            if (!state.navIconEl && options.navbarMountTarget !== false) {
                if (options.teamBuilderHref) state.teamBuilderHref = options.teamBuilderHref;
                mountNavbarIcon(options.navbarMountTarget || '#dt-auth-nav-slot');
            }
            return;
        }
        state.installed = true;

        if (options.teamBuilderHref) state.teamBuilderHref = options.teamBuilderHref;

        buildModal();

        // Backwards compatibility: legacy callers used `mountChip: false` to
        // disable any visible affordance. Treat that the same as
        // `navbarMountTarget: false` so old call sites don't suddenly grow
        // a navbar icon they didn't ask for.
        const skipNav = options.mountChip === false || options.navbarMountTarget === false;
        if (!skipNav) {
            mountNavbarIcon(options.navbarMountTarget || '#dt-auth-nav-slot');
        }
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
