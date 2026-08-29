/* =============================================================================
 *  shell.js – App-Shell (app.html): Seitenwechsel ohne Neuladen
 *
 *  Idee (Vorschlag E, Stufe 1): Die bestehenden Seiten bleiben unveraendert
 *  eigenstaendige Dokumente – die Shell laedt sie als persistente Frames und
 *  blendet sie erst um, wenn die Zielseite FERTIG gerendert ist. Bis dahin
 *  bleibt die alte Seite sichtbar und bedienbar; danach gleitet die neue
 *  dezent herein (kritisch gedaempfte Kurve, kein Overshoot). Der zuletzt
 *  besuchte Frame bleibt warm im Speicher: Zurueck ist augenblicklich,
 *  inklusive Scrollposition und Zustand.
 *
 *  Warum Frames statt eines echten Seiten-Merges: Die Seitenskripte sind
 *  unabhaengig gewachsene Vollseiten-Programme (globale Konstanten,
 *  Inline-Handler, eigene History-Logik) mit kollidierenden CSS-Klassen.
 *  In eigenen Dokumenten laufen sie byte-identisch wie beim direkten
 *  Aufruf – Datenpfade (Firestore via cache.js, LocalStorage-Bundles)
 *  verhalten sich exakt wie bisher, pro sichtbarer Seite genau eine
 *  Instanz. Das war die Bedingung fuer diesen Umbau.
 *
 *  Zusammenspiel:
 *  - Das Pre-Flight jeder Seite setzt <html data-dt-embedded>, sobald sie
 *    eingebettet laeuft; styles.css versteckt dann ihre eigene Navigation
 *    (die Shell bringt die feststehende Leiste mit) und nav.js ueberlaesst
 *    Hoehen-Messung + Service-Worker-Registrierung der Shell.
 *  - History: die Shell fuehrt Routen als app.html#/<seite>?<query> –
 *    Reload und App-Neustart landen damit wieder in der Shell. Interne
 *    Navigationen eines Frames (z.B. teams.html?manager=X) synchronisiert
 *    der load-Listener zurueck in Hash, Titel und aktiven Tab.
 *  - Sicherheitsnetz: Bei jedem Fehler oder Timeout faellt die Shell auf
 *    eine ECHTE Navigation zur Zielseite zurueck – schlimmstenfalls
 *    verhaelt sich die App wie vor der Shell.
 * ============================================================================= */
(function () {
    'use strict';

    /* Nest-Schutz: laeuft app.html selbst eingebettet (z.B. Shell in
       Shell), sofort zur nackten Startseite ausbrechen. */
    try {
        if (window.self !== window.top) {
            window.top.location.replace('index.html');
            return;
        }
    } catch (_) {
        window.location.replace('index.html');
        return;
    }

    var PAGE_FILES = ['index.html', 'team-builder.html', 'teams.html',
        'spieleranalyse.html', 'rangliste.html', 'punktesystem.html'];

    /* Turnier-Kontext gehoert der SHELL, nie der Route. Traegt app.html
       selbst ?tournament=/?preview= (Admin-Deep-Link), reicht die Shell
       genau diese Parameter an JEDEN Frame weiter - Leiste und Inhalt
       loesen damit garantiert identisch auf. Ein Turnier-Parameter in
       Hash-Routen oder Seiten-Links stammt dagegen aus alten Lesezeichen
       oder der frueheren Link-Hydrierung und wird entfernt (siehe
       pageFileFromUrl): er wuerde einen einzelnen Frame auf ein anderes
       Turnier pinnen als die Shell-Leiste - genau die Durchmischung, die
       nie passieren darf. */
    var TOURNAMENT_PARAMS = ['tournament', 'preview'];
    var SHELL_CONTEXT_SEARCH = '';
    try {
        var ownParams = new URLSearchParams(window.location.search);
        var ctxParams = new URLSearchParams();
        TOURNAMENT_PARAMS.forEach(function (name) {
            if (ownParams.has(name)) ctxParams.set(name, ownParams.get(name));
        });
        SHELL_CONTEXT_SEARCH = ctxParams.toString();
    } catch (_) { /* ohne Kontext loesen Frames ambient auf (Storage/Domain) */ }
    // iOS/WebKit beendet speicherhungrige Tabs rigoros und laedt sie neu -
    // mit Shell + zwei kompletten Seiten-Dokumenten kann genau das nach
    // jedem Wechsel passieren und sieht dann aus wie "die App laedt bei
    // jedem Klick neu". Dort halten wir deshalb nur den sichtbaren Frame;
    // Zurueck laedt den Frame neu (SW-Cache, weiterhin in der Shell).
    var IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var MAX_LIVE_FRAMES = IS_IOS ? 1 : 2;
    var READY_GRACE_MS = 60;         // nach load: ein Atemzug fuers erste Rendern
    var PROGRESS_AFTER_MS = 350;     // Haarlinie erst, wenn es wirklich dauert
    var HARD_NAV_TIMEOUT_MS = 10000; // danach echte Navigation als Fallback

    /* Kaputt-Schalter gegen das Weiterleitungs-Ping-Pong: Scheitert die
       Shell DETERMINISTISCH (Boot-Fehler, Code-Fehler beim Wechseln),
       merkt sich die Sitzung das - die Seiten-Pre-Flights lassen die
       Stufe-3-Weiterleitung dann aus, und die App laeuft fuer diese
       Sitzung als klassische Navigation weiter statt bei jedem Klick
       Shell -> Fehler -> echte Navigation -> Weiterleitung -> Shell ...
       im Kreis zu laden. Beim naechsten App-Start (neue Sitzung) wird die
       Shell wieder versucht. Transiente Probleme (Netz-Timeout eines
       Frames) setzen den Schalter bewusst NICHT. */
    var SHELL_BROKEN_KEY = 'dreamteam_shell_broken';
    var SHELL_ERROR_KEY = 'dreamteam_shell_error';

    function rememberError(err, where) {
        try {
            var raw = String(err && err.message ? err.message : err);
            // Harmloses Rauschen nicht als "erster Fehler" festhalten - es
            // wuerde echte Fehler im Debug-Overlay verdecken (View
            // Transitions melden uebersprungene Uebergaenge als Rejection).
            if (/transition was skipped|abort/i.test(raw)) return;
            if (sessionStorage.getItem(SHELL_ERROR_KEY)) return; // erster Fehler zaehlt
            var msg = (where ? where + ': ' : '')
                + raw.slice(0, 300)
                + (err && err.stack ? ' | ' + String(err.stack).slice(0, 300) : '');
            sessionStorage.setItem(SHELL_ERROR_KEY, msg);
        } catch (_) { /* Diagnose darf nie selbst stoeren */ }
    }

    function markShellBroken(err) {
        try { console.error('[shell] Deaktiviert fuer diese Sitzung:', err); } catch (_) {}
        rememberError(err, 'broken');
        try { sessionStorage.setItem(SHELL_BROKEN_KEY, '1'); } catch (_) {}
    }

    /* Fern-Diagnose: Zaehler + letzte Ereignisse, ablesbar ueber das
       ?shelldebug=1-Overlay (siehe initShellDebug unten). */
    var DIAG = { boot: 'ausstehend', intercepted: 0, defaulted: 0, lastTap: '-', swaps: 0, heals: 0 };
    window.__dtShellDiag = DIAG;
    window.addEventListener('error', function (e) {
        rememberError(e && (e.error || e.message), 'window');
    });
    window.addEventListener('unhandledrejection', function (e) {
        rememberError(e && e.reason, 'promise');
    });

    var DEBUG_ON = false;
    try { DEBUG_ON = new URLSearchParams(location.search).get('shelldebug') === '1'; } catch (_) {}

    /* ?shelldebug=1: Diagnose-Overlay fuer Geraete ohne DevTools (Handy).
       Zeigt Boot-Status, Kaputt-Schalter, gespeicherten Fehler, Zaehler,
       Frames samt Embed-Status - ein Screenshot davon reicht, um ein
       Geraete-Problem einzugrenzen. Loest selbst nie etwas aus. */
    function initShellDebug() {
        if (!DEBUG_ON) return;
        try {
            var box = document.createElement('div');
            box.style.cssText = 'position:fixed;top:70px;left:8px;right:8px;z-index:99999;'
                + 'background:rgba(5,10,25,0.94);color:#cfe3ff;border:1px solid #3d8bff;'
                + 'border-radius:10px;padding:10px;font:11px/1.5 monospace;white-space:pre-wrap;'
                + 'word-break:break-all;pointer-events:auto;max-height:60vh;overflow:auto;';
            var btn = document.createElement('button');
            btn.textContent = 'Shell zuruecksetzen + neu laden';
            btn.style.cssText = 'display:block;margin-top:8px;padding:8px 10px;font:12px monospace;';
            btn.addEventListener('click', function () {
                try { sessionStorage.removeItem(SHELL_BROKEN_KEY); } catch (_) {}
                try { sessionStorage.removeItem(SHELL_ERROR_KEY); } catch (_) {}
                window.location.replace('./?shelldebug=1');
            });
            var text = document.createElement('div');
            box.appendChild(text);
            box.appendChild(btn);
            (document.body || document.documentElement).appendChild(box);

            var ownVersion = '?';
            try {
                var own = document.querySelector('script[src*="shell.js"]');
                var m = own && own.src.match(/[?&]v=([^&]+)/);
                if (m) ownVersion = m[1];
            } catch (_) {}

            var refresh = function () {
                var flag = '-'; var err = '-';
                try { flag = sessionStorage.getItem(SHELL_BROKEN_KEY) || '-'; } catch (_) {}
                try { err = sessionStorage.getItem(SHELL_ERROR_KEY) || '-'; } catch (_) {}
                var sw = '-';
                try { sw = navigator.serviceWorker.controller ? 'aktiv' : 'KEIN Controller'; } catch (_) {}
                var frameInfo = [];
                try {
                    document.querySelectorAll('.dt-shell-frame').forEach(function (f) {
                        var d = '-'; var emb = '-'; var nav = '-'; var tk = '-';
                        try {
                            var cd = f.contentDocument;
                            d = f.contentWindow.location.pathname;
                            emb = cd.documentElement.hasAttribute('data-dt-embedded') ? 'ja' : 'NEIN';
                            tk = cd.documentElement.getAttribute('data-tournament') || '-';
                            var bn = cd.querySelector('nav.bottom-nav');
                            nav = bn ? getComputedStyle(bn).display : 'fehlt';
                        } catch (_) { d = 'unlesbar'; }
                        frameInfo.push(d + ' [turnier:' + tk + ', embed:' + emb + ', eigene BottomNav:' + nav + (f.hidden ? ', versteckt' : ', sichtbar') + ']');
                    });
                } catch (_) {}
                var shellTk = '-';
                try { shellTk = document.documentElement.getAttribute('data-tournament') || '-'; } catch (_) {}
                text.textContent = 'DreamTeam Shell-Debug'
                    + '\nVersion: ' + ownVersion
                    + '\nBoot: ' + DIAG.boot
                    + '\nShell-Turnier: ' + shellTk
                    + '\nTurnier-Kontext (URL): ' + (SHELL_CONTEXT_SEARCH || '-')
                    + '\nKaputt-Schalter: ' + flag
                    + '\nLetzter Fehler: ' + err
                    + '\nAbgefangene Nav-Klicks: ' + DIAG.intercepted
                    + '\nDurchgelassene Nav-Klicks: ' + DIAG.defaulted
                    + '\nLetzter Tap: ' + DIAG.lastTap
                    + '\nSwaps: ' + DIAG.swaps
                    + '\nTurnier-Heilungen: ' + DIAG.heals
                    + '\nService Worker: ' + sw
                    + '\nFrames:\n  ' + (frameInfo.join('\n  ') || 'keine');
            };
            refresh();
            window.setInterval(refresh, 800);
        } catch (_) { /* Debug darf nie stoeren */ }
    }
    function markShellHealthy() {
        try { sessionStorage.removeItem(SHELL_BROKEN_KEY); } catch (_) {}
    }

    var stage = document.getElementById('dtShellStage');
    var progressEl = document.getElementById('dtShellProgress');
    if (!stage) {
        // Frueher stiller Abbruch - dann fing niemand die Nav-Klicks ab und
        // jede Navigation lief als Weiterleitungs-Ping-Pong. Jetzt: Kaputt-
        // Schalter setzen und klassisch zur Zielseite wechseln.
        markShellBroken(new Error('dtShellStage fehlt im DOM'));
        try {
            var t0 = routeFromHashEarly();
            window.location.replace(t0);
        } catch (_) { window.location.replace('index.html'); }
        return;
    }

    function routeFromHashEarly() {
        var h = String(window.location.hash || '');
        if (h.indexOf('#/') === 0) return h.slice(2) || 'index.html';
        return 'index.html';
    }

    var reduceMotion = false;
    try {
        reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) { /* Vollmotion */ }

    /* frames: file -> { el, file } – hoechstens MAX_LIVE_FRAMES Eintraege. */
    var frames = new Map();
    var currentFile = null;
    var navSeq = 0; // Unterbrechbarkeit: die juengste Navigation gewinnt

    function pageFileFromUrl(url) {
        try {
            var u = new URL(url, window.location.href);
            if (u.origin !== window.location.origin) return null;
            var file = (u.pathname.split('/').pop() || 'index.html').toLowerCase();
            // Netlify "Pretty URLs" hat in ausgelieferten Seiten die Links
            // auf endungslose Pfade umgeschrieben (rangliste statt
            // rangliste.html) - genau daran ist die Klick-Abfangung auf dem
            // Live-Server vorbeigelaufen (Debug-Overlay: "Durchgelassene
            // Nav-Klicks"). Das Post-Processing ist inzwischen abgeschaltet
            // (netlify.toml), aber solche Links kursieren weiter - beide
            // Formen zaehlen deshalb als dieselbe Seite.
            if (file.indexOf('.') === -1) file += '.html';
            if (file === 'app.html') file = 'index.html';
            // Turnier-Parameter aus jeder Route entfernen - das Turnier
            // bestimmt die Shell (SHELL_CONTEXT_SEARCH bzw. ambiente
            // Aufloesung), nie eine einzelne Route (Durchmischungsschutz).
            TOURNAMENT_PARAMS.forEach(function (name) { u.searchParams.delete(name); });
            return PAGE_FILES.indexOf(file) !== -1 ? { file: file, search: u.search || '' } : null;
        } catch (_) {
            return null;
        }
    }

    function routeToHash(file, search) {
        return '#/' + file + (search || '');
    }

    function routeFromHash() {
        var h = String(window.location.hash || '');
        if (h.indexOf('#/') === 0) {
            var target = pageFileFromUrl(h.slice(2));
            if (target) return target;
        }
        return { file: 'index.html', search: '' };
    }

    function setActiveTab(file) {
        document.querySelectorAll('body > nav.navbar .nav-item, body > nav.bottom-nav .nav-item')
            .forEach(function (link) {
                var target = pageFileFromUrl(link.getAttribute('href'));
                link.classList.toggle('active', !!target && target.file === file);
            });
    }

    function syncTitle(frameEl) {
        try {
            var t = frameEl.contentDocument && frameEl.contentDocument.title;
            if (t) document.title = t;
        } catch (_) { /* Titel behalten */ }
    }

    var progressTimer = null;
    function progressArm() {
        if (!progressEl) return;
        progressClear();
        progressTimer = setTimeout(function () {
            progressEl.classList.add('active');
        }, PROGRESS_AFTER_MS);
    }
    function progressClear() {
        if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
        if (progressEl) progressEl.classList.remove('active');
    }

    /* Frame-Animation: liest den AKTUELLEN Praesentationswert (Apple:
       "animate from the presentation value"), bricht laufende Animationen
       ab und faehrt von dort weiter – dadurch bleibt ein Wechsel jederzeit
       unterbrechbar, ohne Sprung. Nur transform/opacity (Compositor). */
    function animateFrame(el, to, durationMs, easing) {
        var cs = getComputedStyle(el);
        var from = {
            opacity: cs.opacity,
            transform: cs.transform === 'none' ? 'translateY(0px) scale(1)' : cs.transform
        };
        el.getAnimations().forEach(function (a) { a.cancel(); });
        var anim = el.animate([from, to], {
            duration: durationMs,
            easing: easing,
            fill: 'forwards'
        });
        return anim.finished.catch(function () { /* abgebrochen = ok */ });
    }

    function showInstant(el) {
        el.getAnimations().forEach(function (a) { a.cancel(); });
        el.style.opacity = '1';
        el.style.transform = 'none';
        el.hidden = false;
    }

    /* Choreografie (Apple-Werte: kritisch gedaempft, ~Response 0.35):
       vorwaerts steigt die neue Seite dezent von unten ein, die alte weicht
       nach oben – rueckwaerts exakt gespiegelt (raeumliche Konsistenz).
       Reduced Motion: kurzer Crossfade ohne Bewegung. */
    function swapFrames(oldEl, newEl, dir) {
        var enterFrom, exitTo;
        if (reduceMotion) {
            newEl.hidden = false;
            newEl.style.opacity = '0';
            newEl.style.transform = 'none';
            var fin = animateFrame(newEl, { opacity: 1, transform: 'none' }, 160, 'ease-out');
            if (oldEl) animateFrame(oldEl, { opacity: 0, transform: 'none' }, 160, 'ease-out');
            return fin;
        }

        enterFrom = dir === 'back' ? 'translateY(-14px) scale(0.985)' : 'translateY(14px) scale(0.985)';
        exitTo = dir === 'back' ? 'translateY(10px) scale(0.995)' : 'translateY(-10px) scale(0.995)';

        newEl.hidden = false;
        newEl.style.opacity = '0';
        newEl.style.transform = enterFrom;
        newEl.style.willChange = 'transform, opacity';
        if (oldEl) oldEl.style.willChange = 'transform, opacity';

        var entering = animateFrame(newEl,
            { opacity: 1, transform: 'translateY(0px) scale(1)' },
            340, 'cubic-bezier(0.22, 1, 0.36, 1)');
        if (oldEl) {
            animateFrame(oldEl,
                { opacity: 0, transform: exitTo },
                220, 'cubic-bezier(0.4, 0, 0.7, 0.4)');
        }
        return entering.then(function () {
            newEl.style.willChange = '';
            if (oldEl) oldEl.style.willChange = '';
        });
    }

    function pruneFrames() {
        if (frames.size <= MAX_LIVE_FRAMES) return;
        // Aeltesten nicht-aktuellen Frame verwerfen (Map ist insertion-
        // geordnet; ein erneuter Besuch haengt den Eintrag wieder hinten an).
        var it = frames.keys();
        var step = it.next();
        while (!step.done) {
            if (step.value !== currentFile) {
                var rec = frames.get(step.value);
                frames.delete(step.value);
                if (rec && rec.el) rec.el.remove();
                if (frames.size <= MAX_LIVE_FRAMES) return;
            }
            step = it.next();
        }
    }

    function touchFrame(file, rec) {
        // Ans Ende der Map ruecken = zuletzt benutzt.
        frames.delete(file);
        frames.set(file, rec);
    }

    /* Wachhund gegen Turnier-Durchmischung. data-tournament setzt das
       Pre-Flight jeder Seite (und der Shell) synchron im <head> - beim
       load-Event ist es also immer da und sagt, in welchem Turnier das
       Dokument WIRKLICH gebootet hat. Zeigt ein Frame ein anderes Turnier
       als die Shell-Leiste, wird er einmal auf die bereinigte Route +
       Shell-Kontext neu geladen. Hilft das nicht (z.B. Turnier-Wechsel in
       einem zweiten Tab: die Leiste HIER ist veraltet), startet die App
       komplett neu in die saubere Welt - und wenn selbst das nichts
       aendert, faellt sie per Kaputt-Schalter auf klassische Navigation
       zurueck (EIN Dokument kann nicht gemischt sein). Gemischte Anzeige
       gibt es damit in keinem Fall dauerhaft. */
    var HEAL_LIMIT = 2;
    var healCount = 0;
    var HEAL_RESTART_KEY = 'dreamteam_shell_heal_restarts';

    function shellTournamentKey() {
        return (document.documentElement.getAttribute('data-tournament') || '').toLowerCase();
    }

    function frameTournamentKey(rec) {
        try {
            return (rec.el.contentDocument.documentElement.getAttribute('data-tournament') || '').toLowerCase();
        } catch (_) { return ''; }
    }

    function healRestart(targetFile) {
        var n = 0;
        try { n = parseInt(sessionStorage.getItem(HEAL_RESTART_KEY) || '0', 10) || 0; } catch (_) {}
        if (n >= 2) {
            markShellBroken(new Error('Turnier-Durchmischung nicht heilbar'));
            window.location.replace(targetFile || 'index.html');
            return;
        }
        try { sessionStorage.setItem(HEAL_RESTART_KEY, String(n + 1)); } catch (_) {}
        window.location.replace('./');
    }

    /* Interne Navigationen eines Frames (Links im Seiteninhalt, z.B.
       teams.html?manager=X oder spieleranalyse.html?view=games) zurueck in
       Shell-Zustand spiegeln: Map-Schluessel, Tab, Hash, Titel. */
    function handleFrameLoad(rec) {
        var loc;
        try {
            loc = rec.el.contentWindow.location;
        } catch (_) {
            return;
        }
        var target = pageFileFromUrl(loc.href);
        if (!target) return;

        var shellKey = shellTournamentKey();
        var frameKey = frameTournamentKey(rec);
        if (shellKey && frameKey && frameKey !== shellKey) {
            DIAG.heals++;
            if (healCount >= HEAL_LIMIT) {
                healRestart(target.file);
                return;
            }
            healCount++;
            try {
                rec.el.contentWindow.location.replace(frameSrc(target.file, target.search));
            } catch (_) {
                healRestart(target.file);
            }
            return; // erst der konsistente Neu-Load wird synchronisiert
        }

        if (target.file !== rec.file) {
            var clash = frames.get(target.file);
            if (clash && clash !== rec) {
                frames.delete(target.file);
                if (clash.el) clash.el.remove();
            }
            frames.delete(rec.file);
            var wasCurrent = currentFile === rec.file;
            rec.file = target.file;
            frames.set(target.file, rec);
            if (wasCurrent) currentFile = target.file;
        }

        if (currentFile === rec.file) {
            setActiveTab(rec.file);
            syncTitle(rec.el);
            try {
                history.replaceState(null, '', routeToHash(rec.file, target.search));
            } catch (_) { /* Hash lassen */ }
        }
    }

    /* Frame-URL = bereinigte Route + Turnier-Kontext der Shell. Die Route
       ist durch pageFileFromUrl garantiert frei von tournament/preview. */
    function frameSrc(file, search) {
        var s = search || '';
        if (SHELL_CONTEXT_SEARCH) s += (s ? '&' : '?') + SHELL_CONTEXT_SEARCH;
        return file + s;
    }

    function createFrame(file, search) {
        var el = document.createElement('iframe');
        el.className = 'dt-shell-frame';
        el.hidden = true;
        el.style.opacity = '0';
        el.setAttribute('title', 'DreamTeam – ' + file.replace('.html', ''));
        var rec = { el: el, file: file };
        el.addEventListener('load', function () { handleFrameLoad(rec); });
        el.src = frameSrc(file, search);
        stage.appendChild(el);
        frames.set(file, rec);
        return rec;
    }

    function waitForFrameReady(rec, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var done = false;
            var finish = function (ok) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                if (ok) resolve(); else reject(new Error('Frame-Timeout'));
            };
            var timer = setTimeout(function () { finish(false); }, timeoutMs);

            var settle = function () {
                // Zwei Frames Renderzeit + kurzer Atemzug: die Seite steht
                // (Skeletons/Inhalt), erst DANN wird umgeblendet.
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () {
                        setTimeout(function () { finish(true); }, READY_GRACE_MS);
                    });
                });
            };

            var readyNow = false;
            try {
                readyNow = !!rec.el.contentDocument
                    && rec.el.contentDocument.readyState === 'complete'
                    && rec.el.contentWindow.location.href !== 'about:blank';
            } catch (_) { readyNow = false; }

            if (readyNow) {
                settle();
            } else {
                rec.el.addEventListener('load', settle, { once: true });
            }
        });
    }

    function navigateTo(target, opts) {
        var seq = ++navSeq;
        var push = !opts || opts.push !== false;
        var dir = (opts && opts.dir) || 'forward';
        var file = target.file;
        var search = target.search || '';
        var fullUrl = file + search;

        try {
            // Sofortige Antwort auf den Tap: Tab wechselt, bevor irgendetwas
            // laedt (Feedback auf Pointer-Down-Niveau, nicht erst am Ende).
            setActiveTab(file);

            if (push) {
                try { history.pushState(null, '', routeToHash(file, search)); } catch (_) {}
            }

            if (file === currentFile) {
                var cur = frames.get(file);
                if (cur) { progressClear(); syncTitle(cur.el); return; }
            }

            var rec = frames.get(file);
            var isFresh = false;
            if (!rec) {
                rec = createFrame(file, search);
                isFresh = true;
            }
            touchFrame(file, rec);
            progressArm();

            var retriedFresh = isFresh;
            var attempt = function (useRec, budget) {
                waitForFrameReady(useRec, budget)
                    .then(function () {
                        if (seq !== navSeq) return; // unterbrochen: neuere Navigation laeuft
                        try {
                            progressClear();

                            var oldRec = currentFile ? frames.get(currentFile) : null;
                            currentFile = file;
                            syncTitle(useRec.el);
                            markShellHealthy();
                            DIAG.swaps++;

                            var oldEl = oldRec && oldRec !== useRec ? oldRec.el : null;
                            swapFrames(oldEl, useRec.el, dir).then(function () {
                                if (seq !== navSeq) return;
                                if (oldEl) oldEl.hidden = true;
                                pruneFrames();
                            });
                        } catch (err) {
                            // Code-Fehler in der Swap-Phase = deterministisch:
                            // Kaputt-Schalter + klassische Navigation.
                            markShellBroken(err);
                            progressClear();
                            window.location.href = fullUrl;
                        }
                    })
                    .catch(function () {
                        if (seq !== navSeq) return;
                        // Antwortet ein WARMER Frame nicht rechtzeitig
                        // (z.B. mitten in einer internen Navigation
                        // eingeschlafen), wird zuerst der FRAME frisch
                        // geladen - nicht gleich die ganze App.
                        if (!retriedFresh) {
                            retriedFresh = true;
                            frames.delete(useRec.file);
                            if (useRec.el) useRec.el.remove();
                            var freshRec = createFrame(file, search);
                            touchFrame(file, freshRec);
                            attempt(freshRec, HARD_NAV_TIMEOUT_MS);
                            return;
                        }
                        progressClear();
                        // Letztes Sicherheitsnetz: echte Navigation. Bewusst
                        // OHNE Kaputt-Schalter - ein Netz-Timeout ist
                        // transient, die Shell darf es erneut versuchen.
                        window.location.href = fullUrl;
                    });
            };
            attempt(rec, isFresh ? HARD_NAV_TIMEOUT_MS : 1500);
        } catch (err) {
            // Synchroner Code-Fehler = deterministisch: Kaputt-Schalter
            // setzen (bricht das Weiterleitungs-Ping-Pong) und klassisch
            // navigieren.
            markShellBroken(err);
            progressClear();
            window.location.href = fullUrl;
        }
    }

    /* Klicks auf die Shell-Navigation abfangen; alles andere (Modifier,
       neue Tabs, Downloads, fremde Ziele) laeuft normal weiter.

       Bewusst EIN Listener auf document in der CAPTURE-Phase statt je
       einem Bubble-Listener auf den beiden Leisten: Capture laeuft vor
       jedem anderen Click-Handler (nichts kann den Klick vorher schlucken
       oder stoppen), und die Delegation ueberlebt jeden spaeteren Umbau
       der Leisten-DOM-Knoten. Ein frueherer Geraete-Befund (Android:
       Bottom-Taps navigierten hart auf /rangliste.html statt in der Shell
       zu bleiben) ist mit gebundenen Bubble-Listenern nicht sicher
       auszuschliessen - mit Capture-Delegation schon. */
    function handleShellNavClick(event) {
        try {
            if (event.defaultPrevented) return;
            if (event.button !== 0) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
            DIAG.lastTap = link
                ? (link.getAttribute('href') || link.href || '?')
                : String(event.target && event.target.tagName || '?');
            if (!link) return;
            if (!link.closest('body > nav.navbar, body > nav.bottom-nav')) return;
            if (link.target && link.target !== '_self') return;
            if (link.hasAttribute('download')) return;
            var target = pageFileFromUrl(link.href);
            if (!target) { DIAG.defaulted++; return; }
            event.preventDefault();
            DIAG.intercepted++;
            navigateTo(target, { push: true, dir: 'forward' });
        } catch (err) {
            // Nicht preventDefault-et -> der Browser navigiert normal;
            // der Kaputt-Schalter verhindert das Zurueck-Weiterleiten.
            markShellBroken(err);
        }
    }

    /* Buehne exakt zwischen Navbar und Bottom-Nav aufspannen – gemessen,
       nicht geraten (die Leisten atmen mit Auth-Knopf und Breite). */
    function syncStageInsets() {
        var bottomNav = document.querySelector('body > nav.bottom-nav');
        var apply = function () {
            var h = 0;
            if (bottomNav) {
                var rect = bottomNav.getBoundingClientRect();
                if (getComputedStyle(bottomNav).display !== 'none') h = Math.ceil(rect.height);
            }
            stage.style.bottom = h + 'px';
        };
        apply();
        if (typeof ResizeObserver === 'function') {
            var ro = new ResizeObserver(apply);
            if (bottomNav) ro.observe(bottomNav);
            ro.observe(document.documentElement);
        } else {
            window.addEventListener('resize', apply);
        }
    }

    function boot() {
        initShellDebug();
        try {
            bootInner();
            DIAG.boot = 'ok';
        } catch (err) {
            // Boot-Fehler = deterministisch fuer dieses Geraet: Kaputt-
            // Schalter setzen und zur nackten Zielseite wechseln. Ohne den
            // Schalter wuerde deren Pre-Flight sofort wieder hierher
            // weiterleiten - die App laege in einer Reload-Schleife.
            DIAG.boot = 'FEHLER';
            markShellBroken(err);
            if (DEBUG_ON) return; // Overlay stehen lassen statt wegzunavigieren
            var target = routeFromHash();
            window.location.replace(target.file + (target.search || ''));
        }
    }

    function bootInner() {
        document.addEventListener('click', handleShellNavClick, true);
        syncStageInsets();

        window.addEventListener('popstate', function () {
            navigateTo(routeFromHash(), { push: false, dir: 'back' });
        });

        var initial = routeFromHash();
        try { history.replaceState(null, '', routeToHash(initial.file, initial.search)); } catch (_) {}
        navigateTo(initial, { push: false, dir: 'forward' });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
