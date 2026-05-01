

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

document.addEventListener("DOMContentLoaded", () => {
    const APP = window.APP_CONFIG;

    if (!APP) {
        console.error("APP_CONFIG fehlt. tournament-config.js wird nicht korrekt geladen.");
        return;
    }

    const brandName = APP.brandName || "DreamTeam";

    const navItems = [
        { href: "index.html", label: "🏠 Dashboard", shortLabel: "Dashboard", icon: "🏠" },
        { href: "team-builder.html", label: "➕ Team erstellen", shortLabel: "Team", icon: "➕" },
        { href: "teams.html", label: "🛡️ Teams", shortLabel: "Teams", icon: "🛡️" },
        { href: "spieleranalyse.html", label: "🔍 Spieler-Analyse", shortLabel: "Analyse", icon: "🔍" },
        { href: "rangliste.html", label: "🏆 Rangliste", shortLabel: "Rangliste", icon: "🏆" },
        { href: "punktesystem.html", label: "📊 Punktesystem", shortLabel: "Punkte", icon: "📊" }
    ];

    const topNavLinks = navItems
        .map(item => `<a href="${item.href}" class="nav-item">${item.label}</a>`)
        .join("");

    const bottomNavLinks = navItems
        .map(item => `
            <a href="${item.href}" class="nav-item">
                <span class="icon">${item.icon}</span>
                <span>${item.shortLabel}</span>
            </a>
        `)
        .join("");

    const navHTML = `
        <nav class="navbar">
            <a href="index.html" class="navbar-brand">⚽ ${brandName}</a>
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
        if (href === currentPage) {
            link.classList.add("active");
        }
        // Also mark index.html active when on root "/"
        if ((currentPage === "" || currentPage === "/") && href === "index.html") {
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

    registerServiceWorker();
});