(function resetDreamTeamStateIfRequested() {
    try {
        const url = new URL(window.location.href);
        if (url.searchParams.get('reset-cache') !== '1') return;

        const keysToDelete = [];
        for (let i = 0; i < window.localStorage.length; i += 1) {
            const key = window.localStorage.key(i);
            if (key && key.toLowerCase().startsWith('dreamteam')) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach((key) => window.localStorage.removeItem(key));

        Promise.resolve()
            .then(async () => {
                if ('caches' in window) {
                    const cacheKeys = await caches.keys();
                    await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
                }
            })
            .then(async () => {
                if ('serviceWorker' in navigator) {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(registrations.map((registration) => registration.unregister()));
                }
            })
            .finally(() => {
                url.searchParams.delete('reset-cache');
                const target = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ''}${url.hash}`;
                window.location.replace(target || '/');
            });
    } catch (err) {
        console.error('[PWA] reset-cache fehlgeschlagen:', err);
    }
})();



function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    if (window.location.protocol === 'file:') {
        console.info('[PWA] Service Worker wird unter file:// nicht registriert. Nutze HTTPS oder localhost.');
        return;
    }

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js', { scope: './' })
            .then(registration => {
                console.log('[PWA] Service Worker registriert:', registration.scope);
            })
            .catch(error => {
                console.error('[PWA] Service Worker Registrierung fehlgeschlagen:', error);
            });
    }, { once: true });
}

/* =============================================================================
 *  DEV TOURNAMENT SWITCHER
 *
 *  Kleiner, bewusst unauffälliger Dev-Knopf, mit dem zwischen den in
 *  tournament-config.js definierten Turnieren (z.B. EM 2024 / WM 2026)
 *  gewechselt werden kann.
 *
 *  Sichtbarkeit:
 *  - Standardmässig sichtbar, deutlich als "DEV:" markiert.
 *  - Kann mit ?dev=0 oder localStorage["dreamteam_hide_dev"]="1" versteckt
 *    werden, falls die App produktiv ausgeliefert wird.
 *
 *  Wirkung:
 *  - Klick öffnet ein kleines Dropdown mit allen verfügbaren Turnieren.
 *  - Wechsel speichert das gewählte Turnier in localStorage und lädt die
 *    Seite mit ?tournament=<key> neu, damit Firestore-Collections,
 *    LocalStorage-Prefix und Daten-Datei sauber zum neuen Turnier passen.
 * ============================================================================= */
function buildDevTournamentSwitcher(APP) {
    if (!APP || typeof APP.tournaments !== 'object') return;

    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('dev') === '0') return;
        if (window.localStorage.getItem('dreamteam_hide_dev') === '1') return;
    } catch (_) {
        // Wenn Storage/Params nicht lesbar sind, zeigen wir den Switcher trotzdem.
    }

    if (document.getElementById('dev-tournament-switcher')) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'dev-tournament-switcher';
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute('aria-label', 'Dev: Turnier wechseln');
    // Position bewusst unter der Navbar (Navbar ist 80px hoch, position:fixed),
    // damit weder das Brand-Logo noch die Navi-Links überdeckt werden.
    Object.assign(wrapper.style, {
        position: 'fixed',
        top: '88px',
        left: '8px',
        zIndex: '9999',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 8px',
        background: 'rgba(20, 20, 20, 0.78)',
        color: '#ffd166',
        border: '1px solid rgba(255, 209, 102, 0.35)',
        borderRadius: '999px',
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        fontSize: '11px',
        fontWeight: '600',
        letterSpacing: '0.3px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        backdropFilter: 'blur(6px)',
        pointerEvents: 'auto',
        userSelect: 'none',
        opacity: '0.85'
    });

    const label = document.createElement('span');
    label.textContent = 'DEV';
    Object.assign(label.style, {
        background: '#ffd166',
        color: '#1a1a1a',
        padding: '1px 6px',
        borderRadius: '999px',
        fontSize: '10px',
        fontWeight: '800',
        letterSpacing: '0.5px'
    });

    const select = document.createElement('select');
    select.id = 'dev-tournament-select';
    select.setAttribute('aria-label', 'Aktives Turnier wählen');
    Object.assign(select.style, {
        background: 'transparent',
        color: '#ffd166',
        border: '1px solid rgba(255, 209, 102, 0.4)',
        borderRadius: '999px',
        padding: '2px 8px',
        fontSize: '11px',
        fontWeight: '600',
        cursor: 'pointer',
        outline: 'none'
    });

    const allowedTournamentKeys = ['em2024', 'wm2026'];
    const tournamentKeys = allowedTournamentKeys.filter((key) => APP.tournaments[key]);
    if (!tournamentKeys.length) return;

    tournamentKeys.forEach((key) => {
        const t = APP.tournaments[key];
        const option = document.createElement('option');
        option.value = key;
        option.textContent = t && t.shortLabel ? t.shortLabel : key;
        option.style.color = '#111';
        select.appendChild(option);
    });

    select.value = tournamentKeys.includes(APP.activeTournamentKey)
        ? APP.activeTournamentKey
        : tournamentKeys[0];

    select.addEventListener('change', (event) => {
        const next = event.target.value;
        if (!next || next === APP.activeTournamentKey) return;
        if (typeof APP.setActiveTournament === 'function') {
            APP.setActiveTournament(next);
        }
    });

    wrapper.appendChild(label);
    wrapper.appendChild(select);

    document.body.appendChild(wrapper);
}

document.addEventListener("DOMContentLoaded", () => {
    const APP = window.APP_CONFIG;

    if (!APP) {
        console.error("APP_CONFIG fehlt. tournament-config.js wird nicht korrekt geladen.");
        return;
    }


    function withTournamentParam(href) {
        if (!href) return href;
        try {
            const url = new URL(href, window.location.href);
            if (APP && APP.key) url.searchParams.set('tournament', APP.key);
            return `${url.pathname.split('/').pop() || 'index.html'}${url.search ? url.search : ''}${url.hash || ''}`;
        } catch (_) {
            return href;
        }
    }

    const navItems = [
        { href: "index.html", label: "🏠 Dashboard", shortLabel: "Dashboard", icon: "🏠" },
        { href: "team-builder.html", label: "➕ Team erstellen", shortLabel: "Team", icon: "➕" },
        { href: "teams.html", label: "🛡️ Teams", shortLabel: "Teams", icon: "🛡️" },
        { href: "spieleranalyse.html", label: "🔍 Analyse", shortLabel: "Analyse", icon: "🔍" },
        { href: "rangliste.html", label: "🏆 Rangliste", shortLabel: "Rangliste", icon: "🏆" },
        { href: "punktesystem.html", label: "📊 Punktesystem", shortLabel: "Punkte", icon: "📊" }
    ];

    const topNavLinks = navItems
        .map(item => `<a href="${withTournamentParam(item.href)}" class="nav-item">${item.label}</a>`)
        .join("");

    const bottomNavLinks = navItems
        .map(item => `
            <a href="${withTournamentParam(item.href)}" class="nav-item">
                <span class="icon">${item.icon}</span>
                <span>${item.shortLabel}</span>
            </a>
        `)
        .join("");

    // Brand-Texte werden komplett dynamisch aus APP_CONFIG gespeist,
    // damit kein Turnier-Begriff fix im Code bleibt.
    const brandShortLabel = APP.shortLabel || "DreamTeam";
    const brandSecondary = "DreamTeam";
    const brandAria = `${brandShortLabel} ${brandSecondary}`;

    const navHTML = `
        <nav class="navbar">
            <a href="${withTournamentParam('index.html')}" class="navbar-brand" aria-label="${brandAria}">
                <span class="brand-gold">${brandShortLabel}</span>
                <span class="brand-green">${brandSecondary}</span>
            </a>
            <div class="nav-links">
                ${topNavLinks}
            </div>
        </nav>

        <nav class="bottom-nav">
            ${bottomNavLinks}
        </nav>
    `;

    document.body.insertAdjacentHTML("afterbegin", navHTML);

    const currentPage = window.location.pathname.split("/").pop() || "index.html";
    const navLinks = document.querySelectorAll(".nav-item");

    navLinks.forEach(link => {
        const href = link.getAttribute("href");
        let hrefPage = href;
        try {
            hrefPage = new URL(href, window.location.href).pathname.split("/").pop() || "index.html";
        } catch (_) {
            hrefPage = href;
        }

        if (hrefPage === currentPage) {
            link.classList.add("active");
        }
        // Also mark index.html active when on root "/"
        if ((currentPage === "" || currentPage === "/") && hrefPage === "index.html") {
            link.classList.add("active");
        }
    });

    document.body.setAttribute("data-tournament-key", APP.key || "");
    document.body.setAttribute("data-tournament-label", APP.tournamentLabel || "");

    console.log("[nav] APP_CONFIG geladen:", {
        activeTournamentKey: APP.activeTournamentKey,
        brandName: APP.brandName,
        pageTitlePrefix: APP.pageTitlePrefix
    });

    buildDevTournamentSwitcher(APP);

    registerServiceWorker();
});
