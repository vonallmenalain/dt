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
    var MAX_LIVE_FRAMES = 2;         // sichtbarer + zuletzt besuchter Frame
    var READY_GRACE_MS = 60;         // nach load: ein Atemzug fuers erste Rendern
    var PROGRESS_AFTER_MS = 350;     // Haarlinie erst, wenn es wirklich dauert
    var HARD_NAV_TIMEOUT_MS = 10000; // danach echte Navigation als Fallback

    var stage = document.getElementById('dtShellStage');
    var progressEl = document.getElementById('dtShellProgress');
    if (!stage) return;

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
            if (file === '' || file === 'app.html') file = 'index.html';
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

    function createFrame(file, search) {
        var el = document.createElement('iframe');
        el.className = 'dt-shell-frame';
        el.hidden = true;
        el.style.opacity = '0';
        el.setAttribute('title', 'DreamTeam – ' + file.replace('.html', ''));
        var rec = { el: el, file: file };
        el.addEventListener('load', function () { handleFrameLoad(rec); });
        el.src = file + (search || '');
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

        waitForFrameReady(rec, isFresh ? HARD_NAV_TIMEOUT_MS : 1500)
            .then(function () {
                if (seq !== navSeq) return; // unterbrochen: neuere Navigation laeuft
                progressClear();

                var oldRec = currentFile ? frames.get(currentFile) : null;
                currentFile = file;
                syncTitle(rec.el);

                var oldEl = oldRec && oldRec !== rec ? oldRec.el : null;
                swapFrames(oldEl, rec.el, dir).then(function () {
                    if (seq !== navSeq) return;
                    if (oldEl) oldEl.hidden = true;
                    pruneFrames();
                });
            })
            .catch(function () {
                if (seq !== navSeq) return;
                progressClear();
                // Sicherheitsnetz: echte Navigation - schlimmstenfalls
                // verhaelt sich die App wie ohne Shell.
                window.location.href = fullUrl;
            });
    }

    /* Klicks auf die Shell-Navigation abfangen; alles andere (Modifier,
       neue Tabs, Downloads, fremde Ziele) laeuft normal weiter. */
    function interceptNavClicks(nav) {
        if (!nav) return;
        nav.addEventListener('click', function (event) {
            if (event.defaultPrevented) return;
            if (event.button !== 0) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
            if (!link || !nav.contains(link)) return;
            if (link.target && link.target !== '_self') return;
            if (link.hasAttribute('download')) return;
            var target = pageFileFromUrl(link.href);
            if (!target) return;
            event.preventDefault();
            navigateTo(target, { push: true, dir: 'forward' });
        });
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
        interceptNavClicks(document.querySelector('body > nav.navbar'));
        interceptNavClicks(document.querySelector('body > nav.bottom-nav'));
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
