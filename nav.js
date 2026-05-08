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
 *  Sehr unauffälliger Dev-Knopf oben links (neben dem ggf. vorhandenen
 *  "DEV: Auto/Vor Start/Nach Start"-Toggle in index.html). Beschriftet nur
 *  mit "Dev". Erst beim Klick öffnet sich ein kleines Popover, in dem
 *  zwischen den in tournament-config.js definierten Turnieren
 *  (EM 2024 / WM 2026) gewechselt werden kann.
 *
 *  Wichtig:
 *  - Der eigentliche Standard kommt aus dem Domain-Mapping in
 *    tournament-config.js (em24dt.alae.app → EM 2024,
 *    dt.alae.app → WM 2026).
 *  - Der Dev-Knopf dient nur noch als TEST-OVERRIDE und schreibt
 *    seine Auswahl host-spezifisch in localStorage
 *    (`dreamteam_dev_override_${hostname}`).
 *  - Wenn ein Override aktiv ist, zeigt der Knopf das per Farbakzent an
 *    und erlaubt mit "↺ Domain-Default" das Zurücksetzen auf die
 *    domain-basierte Standardwahl.
 *
 *  Sichtbarkeit:
 *  - Standardmässig sichtbar.
 *  - Kann mit ?dev=0 oder localStorage["dreamteam_hide_dev"]="1" versteckt
 *    werden.
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

    const allowedTournamentKeys = ['em2024', 'wm2026'];
    const tournamentKeys = allowedTournamentKeys.filter((key) => APP.tournaments[key]);
    if (!tournamentKeys.length) return;

    const overrideActive = typeof APP.isDevOverrideActive === 'function'
        ? APP.isDevOverrideActive()
        : false;
    const urlOverrideActive = typeof APP.isUrlOverrideActive === 'function'
        ? APP.isUrlOverrideActive()
        : false;

    const RESET_VALUE = '__reset_to_domain_default__';
    const domainDefaultKey = APP.domainDefaultKey;
    const domainDefaultLabel = (APP.domainDefaultTournament && APP.domainDefaultTournament.shortLabel)
        || domainDefaultKey
        || '–';

    // Container nimmt Button + Popover auf, damit beides gemeinsam positioniert
    // werden kann (oben links, neben einem evtl. vorhandenen #dev-index-toggle).
    const wrapper = document.createElement('div');
    wrapper.id = 'dev-tournament-switcher';
    Object.assign(wrapper.style, {
        position: 'fixed',
        top: '8px',
        left: '8px',
        zIndex: '9999',
        fontFamily: 'monospace, system-ui, -apple-system, Segoe UI, sans-serif',
        userSelect: 'none',
        WebkitUserSelect: 'none'
    });

    // Falls der DEV-Ansichtsmodus-Knopf (#dev-index-toggle, nur auf index.html)
    // existiert, setzen wir den Turnier-Switcher direkt rechts daneben.
    function placeNextToIndexToggle() {
        const toggle = document.getElementById('dev-index-toggle');
        if (!toggle) return;
        const rect = toggle.getBoundingClientRect();
        if (!rect || !rect.width) return;
        wrapper.style.left = `${Math.round(rect.right + 6)}px`;
        wrapper.style.top = `${Math.round(rect.top)}px`;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'dev-tournament-toggle';
    button.textContent = 'Dev';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute(
        'aria-label',
        overrideActive
            ? `Dev: Turnier wechseln (Override aktiv, Domain-Default: ${domainDefaultLabel})`
            : `Dev: Turnier wechseln (Domain-Default: ${domainDefaultLabel})`
    );
    button.title = overrideActive
        ? `Dev Override aktiv – Domain-Default: ${domainDefaultLabel}`
        : `Domain-Default: ${domainDefaultLabel}`;
    Object.assign(button.style, {
        fontSize: '11px',
        fontFamily: 'monospace',
        fontWeight: '700',
        padding: '4px 8px',
        borderRadius: '6px',
        border: overrideActive
            ? '1px solid rgba(255, 120, 120, 0.55)'
            : '1px solid rgba(255, 255, 255, 0.2)',
        background: 'rgba(0, 0, 0, 0.55)',
        color: overrideActive ? 'rgba(255, 180, 162, 0.95)' : 'rgba(255, 255, 255, 0.7)',
        cursor: 'pointer',
        opacity: '0.55',
        transition: 'opacity 0.2s ease, background 0.2s ease',
        lineHeight: '1.4',
        letterSpacing: '0.3px'
    });
    button.addEventListener('mouseenter', () => {
        button.style.opacity = '0.9';
        button.style.background = 'rgba(0, 0, 0, 0.8)';
    });
    button.addEventListener('mouseleave', () => {
        button.style.opacity = '0.55';
        button.style.background = 'rgba(0, 0, 0, 0.55)';
    });

    // Popover mit den Auswahl-Optionen, standardmässig versteckt.
    const popover = document.createElement('div');
    popover.id = 'dev-tournament-popover';
    popover.setAttribute('role', 'menu');
    Object.assign(popover.style, {
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: '0',
        minWidth: '180px',
        padding: '6px',
        display: 'none',
        flexDirection: 'column',
        gap: '2px',
        background: 'rgba(20, 20, 20, 0.95)',
        border: overrideActive
            ? '1px solid rgba(255, 120, 120, 0.55)'
            : '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(6px)',
        fontSize: '11px',
        fontWeight: '600',
        color: 'rgba(255,255,255,0.85)'
    });

    // Header zeigt den Domain-Default zur Orientierung.
    const header = document.createElement('div');
    header.textContent = overrideActive
        ? `Dev Override aktiv (Default: ${domainDefaultLabel})`
        : `Domain-Default: ${domainDefaultLabel}`;
    Object.assign(header.style, {
        padding: '4px 8px 6px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        marginBottom: '4px',
        fontSize: '10px',
        fontWeight: '700',
        letterSpacing: '0.3px',
        color: overrideActive ? '#ffb4a2' : '#ffd166',
        textTransform: 'uppercase'
    });
    popover.appendChild(header);

    function closePopover() {
        popover.style.display = 'none';
        button.setAttribute('aria-expanded', 'false');
    }

    function openPopover() {
        placeNextToIndexToggle();
        popover.style.display = 'flex';
        button.setAttribute('aria-expanded', 'true');
    }

    function makeItem({ text, isActive, isDomain, accent, onClick }) {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.textContent = text;
        Object.assign(item.style, {
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '6px 8px',
            borderRadius: '6px',
            border: '1px solid transparent',
            background: isActive ? 'rgba(255, 209, 102, 0.12)' : 'transparent',
            color: accent || (isActive ? '#ffd166' : 'rgba(255,255,255,0.85)'),
            fontSize: '11px',
            fontWeight: isActive ? '800' : '600',
            cursor: 'pointer',
            outline: 'none',
            lineHeight: '1.3'
        });
        if (isDomain) {
            item.style.borderColor = 'rgba(255, 209, 102, 0.35)';
        }
        item.addEventListener('mouseenter', () => {
            item.style.background = 'rgba(255,255,255,0.08)';
        });
        item.addEventListener('mouseleave', () => {
            item.style.background = isActive ? 'rgba(255, 209, 102, 0.12)' : 'transparent';
        });
        item.addEventListener('click', (event) => {
            event.stopPropagation();
            try {
                onClick();
            } finally {
                closePopover();
            }
        });
        return item;
    }

    tournamentKeys.forEach((key) => {
        const t = APP.tournaments[key];
        const baseLabel = t && t.shortLabel ? t.shortLabel : key;
        const isDomainDefault = key === domainDefaultKey;
        const isActive = key === APP.activeTournamentKey;
        const marks = [];
        if (isDomainDefault) marks.push('★ Domain');
        if (isActive) marks.push(overrideActive ? 'Override aktiv' : 'aktiv');
        const suffix = marks.length ? ` — ${marks.join(' · ')}` : '';
        popover.appendChild(makeItem({
            text: `${baseLabel}${suffix}`,
            isActive,
            isDomain: isDomainDefault,
            onClick: () => {
                if (isActive && !urlOverrideActive) return;
                if (typeof APP.setActiveTournament === 'function') {
                    APP.setActiveTournament(key);
                }
            }
        }));
    });

    if (overrideActive) {
        popover.appendChild(makeItem({
            text: '↺ Zurück auf Domain-Default',
            accent: '#ffb4a2',
            onClick: () => {
                if (typeof APP.resetToDomainDefault === 'function') {
                    APP.resetToDomainDefault();
                }
            }
        }));
    }

    button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (popover.style.display === 'none') {
            openPopover();
        } else {
            closePopover();
        }
    });

    document.addEventListener('click', (event) => {
        if (!wrapper.contains(event.target)) closePopover();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closePopover();
    });
    window.addEventListener('resize', () => {
        if (popover.style.display !== 'none') placeNextToIndexToggle();
    });

    wrapper.appendChild(button);
    wrapper.appendChild(popover);
    document.body.appendChild(wrapper);

    // Initiale Positionierung neben #dev-index-toggle, falls vorhanden.
    placeNextToIndexToggle();
    // Kleiner Retry, falls der index-Toggle erst nach uns gerendert wird.
    setTimeout(placeNextToIndexToggle, 0);
    setTimeout(placeNextToIndexToggle, 250);
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
        hostname: APP.hostname,
        domainDefaultKey: APP.domainDefaultKey,
        activeTournamentKey: APP.activeTournamentKey,
        devOverrideActive: typeof APP.isDevOverrideActive === "function" ? APP.isDevOverrideActive() : false,
        urlOverrideActive: typeof APP.isUrlOverrideActive === "function" ? APP.isUrlOverrideActive() : false,
        brandName: APP.brandName,
        pageTitlePrefix: APP.pageTitlePrefix
    });

    buildDevTournamentSwitcher(APP);

    registerServiceWorker();
});
