/* =============================================================================
 *  tippgruppen.js – DreamTeamTippgruppen
 *
 *  Private Tippgruppen: ein bewusst UNAUFFÄLLIGES Feature. Der einzige
 *  Einstieg ist der Eintrag „Tippgruppen" im Profil-Dropdown (zwischen
 *  „Mein Team" und dem Turnier-Wechsel). Es gibt keine Banner, Badges oder
 *  sonstige Hinweise in der App – ist eine Gruppe ausgewählt, zeigen die
 *  Manager-Listen (Rangliste, Teams, Analyse, Startseite) einfach nur noch
 *  die Mitglieder dieser Gruppe. Welche Gruppe aktiv ist, steht allein als
 *  Statustext am Dropdown-Eintrag.
 *
 *  Konzept:
 *    • Eine Tippgruppe ist ein Firestore-Dokument in der Collection
 *      `tippgruppen` (global, NICHT turnier-namespaced – Mitglieder sind
 *      Accounts/UIDs, und ein Account hat pro Turnier höchstens ein Team;
 *      dieselbe Gruppe funktioniert damit in jedem Turnier).
 *    • `visibility: "public"`  → erscheint bei allen im Popup unter
 *      „Öffentliche Tippgruppen", jeder kann frei beitreten.
 *    • `visibility: "private"` → erscheint NIRGENDS in Listen. Beitreten
 *      geht nur über den Einladungs-Link; die zufällige Firestore-Doc-ID
 *      im Link ist das Geheimnis (die Rules erlauben `get` per ID, aber
 *      keine `list`-Query über private Gruppen – siehe firestore.rules).
 *    • Der Einladungs-Link (`index.html?tippgruppe=<id>`) öffnet die App;
 *      vor dem Beitritt zeigt ein Bestätigungs-Dialog Ersteller und
 *      bisherige Mitglieder. Beitritt erst nach explizitem Klick.
 *    • Ausgewählt ist höchstens EINE Gruppe (localStorage, geräteweit für
 *      alle Turniere). Die Auswahl ist eine reine Anzeige-Einstellung des
 *      Geräts – am Server ändert sie nichts.
 *
 *  Filter-Mechanik:
 *    Die Seiten-Skripte schicken ihre Team-Arrays durch
 *    `DreamTeamTippgruppen.filterTeams(teams)` (ein synchroner, reiner
 *    Filter über team.userId gegen die gecachten memberUids). Ohne Auswahl
 *    ist das ein No-op. Änderungen (Auswahl im Popup, storage-Event aus
 *    einem anderen Dokument/Frame der App-Shell, Hintergrund-Refresh der
 *    Mitgliederliste) melden sich über `onChange(cb)` – die Seiten hängen
 *    dort ihren bestehenden Re-Render an, ein Reload ist nie nötig.
 *
 *  Öffentliche API (window.DreamTeamTippgruppen):
 *    STORAGE_KEY        → localStorage-Key der Auswahl
 *    COLLECTION         → Firestore-Collection-Name ('tippgruppen')
 *    getSelection()     → { id, name, memberUids } | null
 *    isFilterActive()   → boolean
 *    filterTeams(teams) → gefiltertes Array (oder Original bei No-op)
 *    onChange(cb)       → unsubscribe(); cb({ selection })
 *    openPopup()        → Popup öffnen (Übersicht)
 *    clearSelection()   → Auswahl aufheben
 *
 *  Sicherheit: Alles hier ist UI. Die Durchsetzung (wer darf Gruppen
 *  lesen/anlegen/beitreten) liegt in den Firestore Rules; die Auswahl
 *  selbst ist bewusst nur ein lokaler Anzeigefilter.
 *
 *  Ladereihenfolge: nach tournament-config.js, auth.js und auth-modal.js
 *  einbinden (wie view-mode.js). Fehlt etwas (async/defer), wird kurz
 *  gepollt – wie an den übrigen Gates im Projekt.
 * ============================================================================= */
(function () {
    'use strict';

    /* Bewusst NICHT turnier-namespaced: die Auswahl gilt geräteweit über
       Turnier-Wechsel hinweg (Mitglieder sind Accounts, keine Teams). */
    const STORAGE_KEY   = 'dreamteam_tippgruppe_selected';
    /* Session-Drossel für den Hintergrund-Refresh der Mitgliederliste
       (App-Shell + Frames booten mehrfach; bezahlt wird pro Read). */
    const REFRESH_AT_KEY = 'dreamteam_tippgruppe_refreshed_at';
    const REFRESH_MIN_INTERVAL_MS = 60 * 1000;

    const COLLECTION   = 'tippgruppen';
    const URL_PARAM    = 'tippgruppe';
    const NAME_MAX     = 60;
    const MEMBER_LIMIT = 200;
    const MENU_ID      = 'tippgruppen';

    const listeners = new Set();

    let overlayEl   = null;   // Popup-Wurzel (lazy erstellt)
    let bodyEl      = null;   // wechselnder Inhaltsbereich des Popups
    let lastSeenUser = null;  // für die Logout-Erkennung (Transition user → null)
    let inviteHandled = false;

    /* ---------------------------------------------------------------------------
     *  Kleine Helfer (Stil wie auth-modal.js)
     * ------------------------------------------------------------------------- */
    function el(tag, attrs = {}, children = []) {
        const node = document.createElement(tag);
        Object.entries(attrs).forEach(([k, v]) => {
            if (k === 'class')      node.className = v;
            else if (k === 'html')  node.innerHTML = v;
            else if (k === 'on')    Object.entries(v).forEach(([ev, fn]) => node.addEventListener(ev, fn));
            else if (v !== null && v !== undefined) node.setAttribute(k, v);
        });
        (Array.isArray(children) ? children : [children]).forEach(c => {
            if (c == null) return;
            node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return node;
    }

    function getDb() {
        try {
            const APP = window.APP_CONFIG;
            if (APP && typeof APP.getDb === 'function') return APP.getDb();
        } catch (_) { /* fällt unten auf null */ }
        return null;
    }

    function getAuthUser() {
        try {
            const Auth = window.DreamTeamAuth;
            if (Auth && typeof Auth.getCurrentUser === 'function') return Auth.getCurrentUser();
        } catch (_) { /* fällt unten auf null */ }
        return null;
    }

    /* Anzeigename für Ersteller/Mitglieder: Manager-Name des eigenen Teams
       im aktiven Turnier; ohne Team der E-Mail-Localpart. Snapshot zum
       Zeitpunkt von Erstellen/Beitritt – bewusst keine Live-Verknüpfung. */
    async function resolveOwnDisplayName() {
        try {
            const Auth = window.DreamTeamAuth;
            if (Auth && typeof Auth.fetchUserTeam === 'function') {
                const result = await Auth.fetchUserTeam();
                const manager = result && result.data && result.data.manager;
                if (typeof manager === 'string' && manager.trim()) return manager.trim().slice(0, 80);
            }
        } catch (_) { /* Fallback unten */ }
        const user = getAuthUser();
        const email = (user && user.email) || '';
        const local = email.split('@')[0] || 'Unbekannt';
        return local.slice(0, 80);
    }

    /* ---------------------------------------------------------------------------
     *  Auswahl (localStorage)
     * ------------------------------------------------------------------------- */
    function readSelection() {
        try {
            const raw = window.localStorage && window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed.id !== 'string' || !parsed.id) return null;
            return {
                id: parsed.id,
                name: typeof parsed.name === 'string' ? parsed.name : '',
                memberUids: Array.isArray(parsed.memberUids) ? parsed.memberUids.filter(u => typeof u === 'string') : []
            };
        } catch (_) {
            return null;
        }
    }

    function selectionsEqual(a, b) {
        if (!a && !b) return true;
        if (!a || !b) return false;
        if (a.id !== b.id || a.name !== b.name) return false;
        const ua = (a.memberUids || []).slice().sort();
        const ub = (b.memberUids || []).slice().sort();
        return ua.length === ub.length && ua.every((v, i) => v === ub[i]);
    }

    function writeSelection(selection) {
        const before = readSelection();
        try {
            if (!selection) {
                window.localStorage.removeItem(STORAGE_KEY);
            } else {
                window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    id: selection.id,
                    name: selection.name || '',
                    memberUids: Array.isArray(selection.memberUids) ? selection.memberUids : [],
                    savedAt: Date.now()
                }));
            }
        } catch (_) {
            // localStorage geblockt (Private Mode) – Auswahl wirkt dann nur
            // nicht persistent; kein Grund, den Rest scheitern zu lassen.
        }
        if (!selectionsEqual(before, readSelection())) notifyChange();
    }

    function getSelection()   { return readSelection(); }
    function isFilterActive() {
        const sel = readSelection();
        return !!(sel && sel.memberUids && sel.memberUids.length);
    }
    function clearSelection() { writeSelection(null); }

    /* ---------------------------------------------------------------------------
     *  Team-Filter – der eigentliche Zweck des Moduls
     * ------------------------------------------------------------------------- */
    function filterTeams(teams) {
        if (!Array.isArray(teams) || !teams.length) return teams;
        const sel = readSelection();
        if (!sel || !Array.isArray(sel.memberUids) || !sel.memberUids.length) return teams;
        const uids = new Set(sel.memberUids);
        return teams.filter(team => team && typeof team.userId === 'string' && uids.has(team.userId));
    }

    /* ---------------------------------------------------------------------------
     *  Change-Benachrichtigung (eigenes Dokument + andere Dokumente/Frames)
     * ------------------------------------------------------------------------- */
    function notifyChange() {
        const selection = readSelection();
        listeners.forEach(cb => {
            try { cb({ selection }); } catch (err) {
                console.warn('[Tippgruppen] onChange-Callback fehlgeschlagen:', err);
            }
        });
        refreshMenu();
    }

    function onChange(cb) {
        if (typeof cb !== 'function') return function () {};
        listeners.add(cb);
        return function () { listeners.delete(cb); };
    }

    /* App-Shell: Auswahl im Shell-Dokument getroffen → storage-Event weckt
       jeden Frame (und umgekehrt). Gleicher Kanal wie view-mode.js. */
    window.addEventListener('storage', (event) => {
        if (event && event.key === STORAGE_KEY) notifyChange();
    });

    /* ---------------------------------------------------------------------------
     *  Firestore-Zugriffe
     * ------------------------------------------------------------------------- */
    function requireDb() {
        const db = getDb();
        if (!db) throw new Error('Firestore ist nicht verfügbar.');
        return db;
    }

    /* Schreibversuch mit einmaligem Token-Refresh-Retry.

       Direkt nach der E-Mail-Bestätigung trägt das gecachte ID-Token noch
       bis zu 1 h `email_verified: false` – die Rules (isVerified) lehnen
       den ersten Write dann mit permission-denied ab, obwohl der Client
       längst „verifiziert" anzeigt. auth.js schützt das Team-Speichern
       deshalb mit einem erzwungenen getIdToken(true); hier gilt dieselbe
       Medizin als Retry: bei permission-denied einmal das Token frisch
       holen und den Write wiederholen. Alle anderen Fehler laufen durch. */
    async function withFreshTokenRetry(user, writeFn) {
        try {
            return await writeFn();
        } catch (err) {
            const code = err && err.code ? String(err.code) : '';
            if (code !== 'permission-denied' || !user || typeof user.getIdToken !== 'function') throw err;
            try {
                await user.getIdToken(/* forceRefresh */ true);
            } catch (_) {
                throw err; // Refresh selbst gescheitert → urspruenglichen Fehler melden
            }
            return writeFn();
        }
    }

    function normalizeGroupDoc(doc) {
        const data = doc.data() || {};
        return {
            id: doc.id,
            name: typeof data.name === 'string' ? data.name : '(ohne Namen)',
            // Alles ausser 'public' zaehlt als privat – deckt auch Alt-Docs
            // mit dem frueheren Wert 'hidden' ab.
            visibility: data.visibility === 'public' ? 'public' : 'private',
            creatorUid: typeof data.creatorUid === 'string' ? data.creatorUid : '',
            creatorName: typeof data.creatorName === 'string' ? data.creatorName : '',
            memberUids: Array.isArray(data.memberUids) ? data.memberUids.filter(u => typeof u === 'string') : [],
            memberNames: (data.memberNames && typeof data.memberNames === 'object') ? data.memberNames : {}
        };
    }

    async function fetchGroup(groupId) {
        const db = requireDb();
        const snap = await db.collection(COLLECTION).doc(String(groupId)).get();
        if (!snap.exists) return null;
        return normalizeGroupDoc(snap);
    }

    async function fetchMyGroups(uid) {
        const db = requireDb();
        const snap = await db.collection(COLLECTION)
            .where('memberUids', 'array-contains', uid)
            .get();
        const groups = [];
        snap.forEach(doc => groups.push(normalizeGroupDoc(doc)));
        groups.sort((a, b) => a.name.localeCompare(b.name, 'de'));
        return groups;
    }

    async function fetchPublicGroups() {
        const db = requireDb();
        const snap = await db.collection(COLLECTION)
            .where('visibility', '==', 'public')
            .limit(100)
            .get();
        const groups = [];
        snap.forEach(doc => groups.push(normalizeGroupDoc(doc)));
        groups.sort((a, b) => a.name.localeCompare(b.name, 'de'));
        return groups;
    }

    async function createGroup(name, visibility) {
        const db = requireDb();
        const user = getAuthUser();
        if (!user || !user.emailVerified) throw new Error('Bitte zuerst anmelden und E-Mail bestätigen.');

        const trimmed = String(name || '').trim().slice(0, NAME_MAX);
        if (!trimmed) throw new Error('Bitte einen Namen für die Tippgruppe angeben.');

        const displayName = await resolveOwnDisplayName();
        const docData = {
            name: trimmed,
            visibility: visibility === 'public' ? 'public' : 'private',
            creatorUid: user.uid,
            creatorName: displayName,
            memberUids: [user.uid],
            memberNames: { [user.uid]: displayName },
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        const ref = await withFreshTokenRetry(user, () => db.collection(COLLECTION).add(docData));
        return Object.assign({ id: ref.id }, docData);
    }

    async function joinGroup(group, resolvedUser) {
        const db = requireDb();
        // Aufgeloesten User bevorzugen (Einladungs-Flow direkt nach dem
        // Boot) – der Wrapper-Stand kann dort noch hinterherhinken.
        const user = resolvedUser || getAuthUser();
        if (!user || !user.emailVerified) throw new Error('Bitte zuerst anmelden und E-Mail bestätigen.');
        if (group.memberUids.indexOf(user.uid) !== -1) return group;
        if (group.memberUids.length >= MEMBER_LIMIT) throw new Error('Diese Tippgruppe ist voll.');

        const displayName = await resolveOwnDisplayName();
        const update = {
            memberUids: firebase.firestore.FieldValue.arrayUnion(user.uid)
        };
        update['memberNames.' + user.uid] = displayName;
        await withFreshTokenRetry(user, () => db.collection(COLLECTION).doc(group.id).update(update));

        const next = Object.assign({}, group);
        next.memberUids = group.memberUids.concat([user.uid]);
        next.memberNames = Object.assign({}, group.memberNames);
        next.memberNames[user.uid] = displayName;
        return next;
    }

    async function leaveGroup(group) {
        const db = requireDb();
        const user = getAuthUser();
        if (!user) throw new Error('Nicht angemeldet.');
        const update = {
            memberUids: firebase.firestore.FieldValue.arrayRemove(user.uid)
        };
        update['memberNames.' + user.uid] = firebase.firestore.FieldValue.delete();
        await withFreshTokenRetry(user, () => db.collection(COLLECTION).doc(group.id).update(update));
    }

    async function deleteGroup(group) {
        const db = requireDb();
        await withFreshTokenRetry(getAuthUser(), () => db.collection(COLLECTION).doc(group.id).delete());
    }

    /* Fehlertext fuer gescheiterte Beitritte: eigene (deutsche) Meldungen
       durchreichen, permission-denied verstaendlich uebersetzen, sonst
       generisch bleiben. */
    function joinErrorMessage(err) {
        const code = err && err.code ? String(err.code) : '';
        if (!code && err && err.message && /[äöüÄÖÜ]|Bitte|Gruppe/.test(String(err.message))) {
            return String(err.message);
        }
        if (code === 'permission-denied') {
            return 'Der Server hat den Beitritt abgelehnt. Bitte einmal ab- und wieder anmelden und den Link erneut öffnen.';
        }
        if (code === 'unavailable') {
            return 'Keine Verbindung zum Server. Bitte Verbindung prüfen und erneut versuchen.';
        }
        return 'Beitritt fehlgeschlagen. Bitte später erneut versuchen.';
    }

    /* Nach einem gescheiterten Beitritts-Write die Wirklichkeit pruefen:
       Steht die Mitgliedschaft trotz Fehler bereits im Dokument (z. B.
       Antwort verloren gegangen oder paralleler zweiter Versuch), zaehlt
       das Ergebnis – dann gibt es keinen Grund fuer eine Fehlermeldung. */
    async function fetchMembershipAfterError(groupId, user) {
        if (!user) return null;
        try {
            const fresh = await fetchGroup(groupId);
            if (fresh && fresh.memberUids.indexOf(user.uid) !== -1) return fresh;
        } catch (_) { /* offline o. ä. – beim urspruenglichen Fehler bleiben */ }
        return null;
    }

    /* ---------------------------------------------------------------------------
     *  Einladungs-Link
     *
     *  Format: <origin>/index.html?tippgruppe=<docId>. Der Pre-Flight leitet
     *  Direktaufrufe in die App-Shell weiter (app.html#/index.html?…), der
     *  Seiten-Parameter bleibt dabei auf der Hash-Route – das Modul im
     *  index-Frame sieht ihn also in seiner eigenen Query.
     * ------------------------------------------------------------------------- */
    function buildInviteLink(groupId) {
        try {
            const url = new URL('index.html', window.location.href);
            url.search = '';
            url.hash = '';
            url.searchParams.set(URL_PARAM, groupId);
            return url.toString();
        } catch (_) {
            return 'index.html?' + URL_PARAM + '=' + encodeURIComponent(groupId);
        }
    }

    async function copyToClipboard(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) { /* Fallback unten */ }
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch (_) {
            return false;
        }
    }

    /* ---------------------------------------------------------------------------
     *  Popup-Grundgerüst
     * ------------------------------------------------------------------------- */
    function ensureOverlay() {
        if (overlayEl) return overlayEl;

        bodyEl = el('div', { class: 'dt-tg-body' });

        const card = el('div', {
            class: 'dt-tg-card',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': 'Tippgruppen'
        }, [
            el('div', { class: 'dt-tg-head' }, [
                el('h2', { class: 'dt-tg-title' }, ['Tippgruppen']),
                el('button', {
                    type: 'button',
                    class: 'dt-tg-close',
                    'aria-label': 'Schliessen',
                    on: { click: closePopup }
                }, ['×'])
            ]),
            bodyEl
        ]);

        overlayEl = el('div', { class: 'dt-tg-overlay', hidden: '' }, [card]);
        overlayEl.addEventListener('click', (event) => {
            if (event.target === overlayEl) closePopup();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && overlayEl && !overlayEl.hidden) closePopup();
        });

        (document.body || document.documentElement).appendChild(overlayEl);
        return overlayEl;
    }

    function openPopupShell() {
        ensureOverlay();
        overlayEl.hidden = false;
        // Erst nach dem Frame einblenden, damit die CSS-Transition greift.
        requestAnimationFrame(() => overlayEl.classList.add('is-open'));
    }

    function closePopup() {
        if (!overlayEl) return;
        overlayEl.classList.remove('is-open');
        overlayEl.hidden = true;
    }

    function setBody(children) {
        if (!bodyEl) return;
        bodyEl.innerHTML = '';
        (Array.isArray(children) ? children : [children]).forEach(c => { if (c) bodyEl.appendChild(c); });
    }

    function messageView(text, tone) {
        return el('p', { class: 'dt-tg-note' + (tone ? ' is-' + tone : '') }, [text]);
    }

    /* ---------------------------------------------------------------------------
     *  Popup: Übersicht (Auswahl, eigene Gruppen, öffentliche Gruppen, Erstellen)
     * ------------------------------------------------------------------------- */
    function openPopup() {
        openPopupShell();

        const user = getAuthUser();
        if (!user || !user.emailVerified) {
            setBody([
                messageView('Für Tippgruppen musst du angemeldet sein (mit bestätigter E-Mail-Adresse).'),
                el('div', { class: 'dt-tg-actions' }, [
                    el('button', {
                        type: 'button',
                        class: 'dt-tg-btn dt-tg-btn-primary',
                        on: {
                            click: () => {
                                closePopup();
                                try {
                                    const Modal = window.DreamTeamAuthModal;
                                    if (Modal && typeof Modal.open === 'function') {
                                        Modal.open({ mode: user ? 'verify' : 'chooser' });
                                    }
                                } catch (_) { /* ignore */ }
                            }
                        }
                    }, [user ? 'E-Mail bestätigen' : 'Anmelden / Registrieren'])
                ])
            ]);
            return;
        }

        setBody(messageView('Tippgruppen werden geladen …'));
        renderOverview().catch(err => {
            console.warn('[Tippgruppen] Übersicht konnte nicht geladen werden:', err);
            setBody(messageView('Tippgruppen konnten nicht geladen werden. Bitte Verbindung prüfen.', 'danger'));
        });
    }

    async function renderOverview(feedback) {
        const user = getAuthUser();
        if (!user) return;

        const [myGroups, publicGroups] = await Promise.all([
            fetchMyGroups(user.uid),
            fetchPublicGroups()
        ]);

        // Frische Mitgliederlisten sind gerade gratis mitgekommen – die
        // gecachte Auswahl gleich damit abgleichen. Fehlt die Gruppe in
        // „meinen" Gruppen, wurde sie gelöscht oder man ist nicht mehr
        // Mitglied → Auswahl aufheben.
        const sel = readSelection();
        if (sel) {
            const fresh = myGroups.find(g => g.id === sel.id);
            if (!fresh) {
                writeSelection(null);
            } else if (!selectionsEqual(sel, { id: fresh.id, name: fresh.name, memberUids: fresh.memberUids })) {
                writeSelection({ id: fresh.id, name: fresh.name, memberUids: fresh.memberUids });
            }
        }

        const selection = readSelection();
        const myIds = new Set(myGroups.map(g => g.id));
        const children = [];

        if (feedback) children.push(messageView(feedback.text, feedback.tone || 'ok'));

        /* — Auswahl — */
        children.push(el('h3', { class: 'dt-tg-section' }, ['Aktive Gruppe']));
        children.push(el('p', { class: 'dt-tg-hint' }, [
            'Ist eine Gruppe aktiv, zeigen Rangliste, Teams und Analyse nur noch deren Mitglieder. ',
            'Die Einstellung gilt nur auf diesem Gerät.'
        ]));

        const selectList = el('div', { class: 'dt-tg-list' });
        selectList.appendChild(buildSelectRow(null, !selection));
        myGroups.forEach(group => {
            selectList.appendChild(buildSelectRow(group, !!(selection && selection.id === group.id)));
        });
        children.push(selectList);

        if (!myGroups.length) {
            children.push(el('p', { class: 'dt-tg-hint' }, ['Du bist noch in keiner Tippgruppe.']));
        }

        /* — Öffentliche Gruppen — */
        const joinable = publicGroups.filter(g => !myIds.has(g.id));
        if (joinable.length) {
            children.push(el('h3', { class: 'dt-tg-section' }, ['Öffentliche Tippgruppen']));
            const publicList = el('div', { class: 'dt-tg-list' });
            joinable.forEach(group => publicList.appendChild(buildPublicRow(group)));
            children.push(publicList);
        }

        /* — Erstellen — */
        children.push(el('h3', { class: 'dt-tg-section' }, ['Neue Tippgruppe']));
        children.push(buildCreateForm());

        setBody(children);
    }

    function buildSelectRow(group, isActive) {
        const isNone = !group;
        const user = getAuthUser();
        const label = isNone ? 'Keine (alle Manager anzeigen)' : group.name;

        const row = el('div', { class: 'dt-tg-row' + (isActive ? ' is-active' : '') });

        const main = el('button', {
            type: 'button',
            class: 'dt-tg-row-main',
            title: isNone ? 'Filter aufheben' : 'Diese Gruppe aktivieren',
            on: {
                click: () => {
                    if (isNone) {
                        writeSelection(null);
                    } else {
                        writeSelection({ id: group.id, name: group.name, memberUids: group.memberUids });
                    }
                    renderOverview().catch(() => { /* Ansicht bleibt stehen */ });
                }
            }
        }, [
            el('span', { class: 'dt-tg-radio', 'aria-hidden': 'true' }),
            el('span', { class: 'dt-tg-row-label' }, [label]),
            isNone ? null : el('span', { class: 'dt-tg-row-meta' }, [
                (group.visibility === 'public' ? 'öffentlich · ' : 'privat · ')
                + group.memberUids.length
                + (group.memberUids.length === 1 ? ' Mitglied' : ' Mitglieder')
            ])
        ]);
        row.appendChild(main);

        if (!isNone) {
            const actions = el('div', { class: 'dt-tg-row-actions' });

            actions.appendChild(el('button', {
                type: 'button',
                class: 'dt-tg-icon-btn',
                title: 'Einladungs-Link kopieren',
                on: {
                    click: async (event) => {
                        const btn = event.currentTarget;
                        const ok = await copyToClipboard(buildInviteLink(group.id));
                        btn.textContent = ok ? '✓' : '✕';
                        setTimeout(() => { btn.textContent = '🔗'; }, 1500);
                    }
                }
            }, ['🔗']));

            const isCreator = !!(user && group.creatorUid === user.uid);
            actions.appendChild(el('button', {
                type: 'button',
                class: 'dt-tg-icon-btn is-danger',
                title: isCreator ? 'Tippgruppe löschen' : 'Tippgruppe verlassen',
                on: {
                    click: async (event) => {
                        event.stopPropagation();
                        const question = isCreator
                            ? `Tippgruppe „${group.name}" wirklich löschen? Das gilt für alle Mitglieder.`
                            : `Tippgruppe „${group.name}" verlassen?`;
                        if (!window.confirm(question)) return;
                        try {
                            if (isCreator) await deleteGroup(group);
                            else await leaveGroup(group);
                            const sel = readSelection();
                            if (sel && sel.id === group.id) writeSelection(null);
                            await renderOverview({
                                text: isCreator ? 'Tippgruppe gelöscht.' : 'Tippgruppe verlassen.',
                                tone: 'ok'
                            });
                        } catch (err) {
                            console.warn('[Tippgruppen] Verlassen/Löschen fehlgeschlagen:', err);
                            await renderOverview({
                                text: 'Das hat nicht geklappt. Bitte später erneut versuchen.',
                                tone: 'danger'
                            });
                        }
                    }
                }
            }, [isCreator ? '🗑' : '⏏']));

            row.appendChild(actions);
        }

        return row;
    }

    function buildPublicRow(group) {
        return el('div', { class: 'dt-tg-row' }, [
            el('div', { class: 'dt-tg-row-main is-static' }, [
                el('span', { class: 'dt-tg-row-label' }, [group.name]),
                el('span', { class: 'dt-tg-row-meta' }, [
                    'von ' + (group.creatorName || 'Unbekannt') + ' · '
                    + group.memberUids.length
                    + (group.memberUids.length === 1 ? ' Mitglied' : ' Mitglieder')
                ])
            ]),
            el('div', { class: 'dt-tg-row-actions' }, [
                el('button', {
                    type: 'button',
                    class: 'dt-tg-btn dt-tg-btn-small',
                    on: {
                        click: async () => {
                            try {
                                const joined = await joinGroup(group);
                                writeSelection({ id: joined.id, name: joined.name, memberUids: joined.memberUids });
                                await renderOverview({ text: `Du bist „${joined.name}" beigetreten.`, tone: 'ok' });
                            } catch (err) {
                                console.warn('[Tippgruppen] Beitritt fehlgeschlagen:', err);
                                const fresh = await fetchMembershipAfterError(group.id, getAuthUser());
                                if (fresh) {
                                    // Der Write ist trotz Fehlermeldung angekommen.
                                    writeSelection({ id: fresh.id, name: fresh.name, memberUids: fresh.memberUids });
                                    await renderOverview({ text: `Du bist „${fresh.name}" beigetreten.`, tone: 'ok' });
                                    return;
                                }
                                await renderOverview({ text: joinErrorMessage(err), tone: 'danger' });
                            }
                        }
                    }
                }, ['Beitreten'])
            ])
        ]);
    }

    function buildCreateForm() {
        const nameInput = el('input', {
            type: 'text',
            class: 'dt-tg-input',
            placeholder: 'Name der Tippgruppe',
            maxlength: String(NAME_MAX),
            'aria-label': 'Name der Tippgruppe'
        });

        const radioName = 'dt-tg-visibility-' + Math.random().toString(36).slice(2);
        const publicRadio = el('input', { type: 'radio', name: radioName, value: 'public' });
        const privateRadio = el('input', { type: 'radio', name: radioName, value: 'private', checked: '' });

        const errorSlot = el('div');

        const form = el('form', {
            class: 'dt-tg-create',
            on: {
                submit: async (event) => {
                    event.preventDefault();
                    errorSlot.innerHTML = '';
                    const visibility = publicRadio.checked ? 'public' : 'private';
                    let created;
                    try {
                        created = await createGroup(nameInput.value, visibility);
                    } catch (err) {
                        console.warn('[Tippgruppen] Erstellen fehlgeschlagen:', err);
                        errorSlot.appendChild(messageView(
                            err && err.message ? String(err.message) : 'Erstellen fehlgeschlagen.',
                            'danger'
                        ));
                        return;
                    }
                    // Neu erstellte Gruppe direkt aktivieren – wer eine Gruppe
                    // anlegt, will sie in aller Regel auch sehen.
                    writeSelection({ id: created.id, name: created.name, memberUids: created.memberUids });
                    if (created.visibility === 'private') {
                        renderInviteCreated(created);
                    } else {
                        await renderOverview({ text: `Tippgruppe „${created.name}" erstellt.`, tone: 'ok' });
                    }
                }
            }
        }, [
            nameInput,
            el('label', { class: 'dt-tg-choice' }, [
                privateRadio,
                el('span', {}, [
                    el('strong', {}, ['Privat']),
                    el('span', { class: 'dt-tg-choice-hint' }, [' – nur über Einladungs-Link auffind- und beitretbar.'])
                ])
            ]),
            el('label', { class: 'dt-tg-choice' }, [
                publicRadio,
                el('span', {}, [
                    el('strong', {}, ['Öffentlich']),
                    el('span', { class: 'dt-tg-choice-hint' }, [' – für alle sichtbar, jeder kann frei beitreten.'])
                ])
            ]),
            errorSlot,
            el('div', { class: 'dt-tg-actions' }, [
                el('button', { type: 'submit', class: 'dt-tg-btn dt-tg-btn-primary' }, ['Erstellen'])
            ])
        ]);

        return form;
    }

    /* Nach dem Erstellen einer privaten Gruppe: der Link ist der einzige
       Zugang – also sofort gross anzeigen und zum Kopieren anbieten. */
    function renderInviteCreated(group) {
        const link = buildInviteLink(group.id);
        const copyBtn = el('button', {
            type: 'button',
            class: 'dt-tg-btn dt-tg-btn-primary',
            on: {
                click: async (event) => {
                    // currentTarget VOR dem await sichern – nach dem Dispatch
                    // ist event.currentTarget null.
                    const btn = event.currentTarget;
                    const ok = await copyToClipboard(link);
                    btn.textContent = ok ? 'Kopiert ✓' : 'Kopieren fehlgeschlagen';
                    setTimeout(() => { btn.textContent = 'Link kopieren'; }, 1800);
                }
            }
        }, ['Link kopieren']);

        setBody([
            messageView(`Tippgruppe „${group.name}" erstellt und aktiviert.`, 'ok'),
            el('p', { class: 'dt-tg-hint' }, [
                'Die Gruppe ist privat. Nur wer diesen Link hat, kann sie sehen und beitreten:'
            ]),
            el('code', { class: 'dt-tg-link' }, [link]),
            el('div', { class: 'dt-tg-actions' }, [
                copyBtn,
                el('button', {
                    type: 'button',
                    class: 'dt-tg-btn',
                    on: { click: () => { renderOverview().catch(() => {}); } }
                }, ['Zur Übersicht'])
            ])
        ]);
    }

    /* ---------------------------------------------------------------------------
     *  Beitritt über Einladungs-Link (?tippgruppe=<id>)
     *
     *  Vor dem Beitritt zeigt der Dialog, wer die Gruppe erstellt hat und wer
     *  schon Mitglied ist – beigetreten wird erst nach explizitem Klick.
     * ------------------------------------------------------------------------- */
    function getInviteParamFromUrl() {
        try {
            const params = new URLSearchParams(window.location.search);
            const id = params.get(URL_PARAM);
            if (!id) return null;
            return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
        } catch (_) {
            return null;
        }
    }

    function stripInviteParamFromUrl() {
        try {
            const url = new URL(window.location.href);
            if (!url.searchParams.has(URL_PARAM)) return;
            url.searchParams.delete(URL_PARAM);
            window.history.replaceState(null, '', url.pathname + (url.search || '') + (url.hash || ''));
        } catch (_) { /* URL bleibt stehen */ }
    }

    /* Firebase stellt die Session ASYNCHRON wieder her: direkt nach dem
       Boot liefert getCurrentUser() noch null, auch wenn die Person laengst
       angemeldet ist. Der Einladungs-Dialog darf deshalb nicht sofort nach
       dem aktuellen Stand entscheiden, sondern wartet auf den ersten
       onAuthStateChanged-Callback des SDK – der kommt garantiert (mit User
       oder null), sobald der Session-Restore geprueft ist. Fallback +
       Timeout, falls Firebase fehlt (lokal ohne API-Key) oder haengt. */
    function waitForAuthResolution(timeoutMs) {
        return new Promise((resolve) => {
            let settled = false;
            let unsubscribe = null;
            let resolvedUser;

            function finish() {
                if (settled) return;
                settled = true;
                if (typeof unsubscribe === 'function') {
                    try { unsubscribe(); } catch (_) { /* egal */ }
                }
                resolve(resolvedUser !== undefined ? resolvedUser : getAuthUser());
            }

            function tryAttach() {
                try {
                    unsubscribe = window.firebase.auth().onAuthStateChanged(
                        (user) => { resolvedUser = user || null; finish(); },
                        () => finish()
                    );
                    return true;
                } catch (_) {
                    return false; // SDK fehlt oder App (noch) nicht initialisiert
                }
            }

            if (!tryAttach()) {
                // nav.js initialisiert Firebase u. U. erst einen Tick spaeter –
                // kurz nachfassen, wie an den uebrigen Gates im Projekt.
                let attempts = 0;
                const maxAttempts = 10; // ~1s
                const interval = setInterval(() => {
                    attempts += 1;
                    if (settled || tryAttach()) { clearInterval(interval); return; }
                    if (attempts >= maxAttempts) { clearInterval(interval); finish(); }
                }, 100);
            }

            setTimeout(finish, timeoutMs || 8000);
        });
    }

    function openInviteFlow(groupId) {
        openPopupShell();
        setBody(messageView('Einladung wird geladen …'));

        waitForAuthResolution(8000).then((user) => {
            if (!user || !user.emailVerified) {
                renderInviteSignInPrompt(groupId, user);
                return;
            }
            renderInvitePreview(groupId, user).catch(err => {
                console.warn('[Tippgruppen] Einladung konnte nicht geladen werden:', err);
                setBody(messageView('Diese Einladung konnte nicht geladen werden. Der Link ist ungültig oder die Gruppe existiert nicht mehr.', 'danger'));
            });
        });
    }

    /* Erst wenn die Auth-Aufloesung wirklich "abgemeldet" (oder unbestaetigt)
       ergeben hat: zur Anmeldung auffordern und die Einladung danach
       automatisch wieder oeffnen. */
    function renderInviteSignInPrompt(groupId, user) {
        setBody([
            messageView('Du wurdest zu einer Tippgruppe eingeladen. Melde dich an, um die Einladung zu öffnen.'),
            el('div', { class: 'dt-tg-actions' }, [
                el('button', {
                    type: 'button',
                    class: 'dt-tg-btn dt-tg-btn-primary',
                    on: {
                        click: () => {
                            closePopup();
                            try {
                                const Modal = window.DreamTeamAuthModal;
                                if (Modal && typeof Modal.open === 'function') {
                                    Modal.open({ mode: user ? 'verify' : 'chooser' });
                                }
                            } catch (_) { /* ignore */ }
                            // Nach erfolgreicher Anmeldung Einladung erneut öffnen.
                            waitForVerifiedThenInvite(groupId);
                        }
                    }
                }, [user ? 'E-Mail bestätigen' : 'Anmelden / Registrieren']),
                el('button', {
                    type: 'button',
                    class: 'dt-tg-btn',
                    on: { click: closePopup }
                }, ['Abbrechen'])
            ])
        ]);
    }

    function waitForVerifiedThenInvite(groupId) {
        try {
            const Auth = window.DreamTeamAuth;
            if (!Auth || typeof Auth.onAuthStateChange !== 'function') return;
            const unsubscribe = Auth.onAuthStateChange(({ user, isVerified }) => {
                if (user && isVerified) {
                    unsubscribe();
                    openInviteFlow(groupId);
                }
            });
        } catch (_) { /* Einladung bleibt über den Link wiederholbar */ }
    }

    async function renderInvitePreview(groupId, resolvedUser) {
        const group = await fetchGroup(groupId);
        if (!group) {
            setBody(messageView('Diese Tippgruppe existiert nicht mehr.', 'danger'));
            return;
        }

        // Aufgeloesten User bevorzugen: der Wrapper-Stand (getAuthUser) kann
        // direkt nach dem Boot noch hinterherhinken.
        const user = resolvedUser || getAuthUser();
        const alreadyMember = !!(user && group.memberUids.indexOf(user.uid) !== -1);

        const memberItems = group.memberUids.map(uid => {
            const name = group.memberNames[uid];
            const display = (typeof name === 'string' && name.trim()) ? name.trim() : 'Unbekanntes Mitglied';
            return el('li', {}, [
                display + (uid === group.creatorUid ? ' (Ersteller)' : '')
            ]);
        });

        const children = [
            el('h3', { class: 'dt-tg-section' }, ['Einladung: ' + group.name]),
            el('p', { class: 'dt-tg-hint' }, [
                (group.visibility === 'public' ? 'Öffentliche Tippgruppe' : 'Private Tippgruppe')
                + ' · erstellt von ' + (group.creatorName || 'Unbekannt')
            ]),
            el('p', { class: 'dt-tg-hint' }, [
                group.memberUids.length === 1
                    ? 'Bisher 1 Mitglied:'
                    : `Bisher ${group.memberUids.length} Mitglieder:`
            ]),
            el('ul', { class: 'dt-tg-members' }, memberItems)
        ];

        if (alreadyMember) {
            children.push(messageView('Du bist bereits Mitglied dieser Tippgruppe.', 'ok'));
            children.push(el('div', { class: 'dt-tg-actions' }, [
                el('button', {
                    type: 'button',
                    class: 'dt-tg-btn dt-tg-btn-primary',
                    on: {
                        click: () => {
                            writeSelection({ id: group.id, name: group.name, memberUids: group.memberUids });
                            closePopup();
                        }
                    }
                }, ['Gruppe aktivieren']),
                el('button', { type: 'button', class: 'dt-tg-btn', on: { click: closePopup } }, ['Schliessen'])
            ]));
        } else {
            children.push(el('div', { class: 'dt-tg-actions' }, [
                el('button', {
                    type: 'button',
                    class: 'dt-tg-btn dt-tg-btn-primary',
                    on: {
                        click: async (event) => {
                            event.currentTarget.disabled = true;
                            try {
                                const joined = await joinGroup(group, user);
                                writeSelection({ id: joined.id, name: joined.name, memberUids: joined.memberUids });
                                renderInviteJoined(joined.name);
                            } catch (err) {
                                console.warn('[Tippgruppen] Beitritt über Link fehlgeschlagen:', err);
                                const fresh = await fetchMembershipAfterError(group.id, user);
                                if (fresh) {
                                    // Der Write ist trotz Fehlermeldung angekommen.
                                    writeSelection({ id: fresh.id, name: fresh.name, memberUids: fresh.memberUids });
                                    renderInviteJoined(fresh.name);
                                    return;
                                }
                                setBody([
                                    messageView(joinErrorMessage(err), 'danger'),
                                    el('div', { class: 'dt-tg-actions' }, [
                                        el('button', {
                                            type: 'button',
                                            class: 'dt-tg-btn dt-tg-btn-primary',
                                            on: {
                                                click: () => {
                                                    setBody(messageView('Einladung wird geladen …'));
                                                    renderInvitePreview(group.id, user).catch(() => {
                                                        setBody(messageView('Diese Einladung konnte nicht geladen werden.', 'danger'));
                                                    });
                                                }
                                            }
                                        }, ['Erneut versuchen']),
                                        el('button', { type: 'button', class: 'dt-tg-btn', on: { click: closePopup } }, ['Schliessen'])
                                    ])
                                ]);
                            }
                        }
                    }
                }, ['Beitreten']),
                el('button', { type: 'button', class: 'dt-tg-btn', on: { click: closePopup } }, ['Abbrechen'])
            ]));
        }

        setBody(children);
    }

    function renderInviteJoined(groupName) {
        setBody([
            messageView(`Du bist „${groupName}" beigetreten. Die Gruppe ist jetzt aktiv.`, 'ok'),
            el('div', { class: 'dt-tg-actions' }, [
                el('button', { type: 'button', class: 'dt-tg-btn dt-tg-btn-primary', on: { click: closePopup } }, ['Fertig'])
            ])
        ]);
    }

    function maybeHandleInviteParam() {
        if (inviteHandled) return;
        const groupId = getInviteParamFromUrl();
        if (!groupId) return;
        inviteHandled = true;

        // Parameter sofort aus der eigenen URL räumen (ein Reload des
        // Dokuments soll den Dialog nicht erneut aufmachen). Hält die
        // App-Shell den Parameter noch kurz in ihrer Hash-Route, ist ein
        // erneutes Aufpoppen nach einem harten Reload verschmerzbar – der
        // Dialog zeigt Bestandsmitgliedern nur den „bereits Mitglied"-Stand.
        stripInviteParamFromUrl();
        openInviteFlow(groupId);
    }

    /* ---------------------------------------------------------------------------
     *  Dropdown-Eintrag: „Tippgruppen" zwischen „Mein Team" und den
     *  Turnier-Wechsel-Einträgen (die registrieren mit order 1, 2, …).
     * ------------------------------------------------------------------------- */
    function refreshMenu() {
        try {
            const Modal = window.DreamTeamAuthModal;
            if (Modal && Modal.menu && typeof Modal.menu.refresh === 'function') Modal.menu.refresh();
        } catch (_) { /* Menü zieht beim nächsten Öffnen nach */ }
    }

    function registerMenuEntry(Modal) {
        if (!Modal.menu || typeof Modal.menu.register !== 'function') return;
        Modal.menu.register({
            id: MENU_ID,
            order: -10,
            icon: '👥',
            label: 'Tippgruppen',
            value: () => {
                // Aktive Gruppe als Statustext – die EINZIGE Stelle in der
                // App, an der der aktive Filter sichtbar ist (gewollt).
                const sel = readSelection();
                if (!sel || !sel.name) return '';
                return sel.name.length > 18 ? sel.name.slice(0, 17) + '…' : sel.name;
            },
            title: 'Tippgruppen verwalten',
            onSelect: openPopup
        });
    }

    function whenAuthModalReady(callback) {
        const Modal = window.DreamTeamAuthModal;
        if (Modal && Modal.menu && typeof Modal.menu.register === 'function') {
            callback(Modal);
            return;
        }
        let attempts = 0;
        const maxAttempts = 50; // ~5s
        const interval = setInterval(() => {
            attempts += 1;
            const M = window.DreamTeamAuthModal;
            if (M && M.menu && typeof M.menu.register === 'function') {
                clearInterval(interval);
                callback(M);
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
            }
        }, 100);
    }

    /* ---------------------------------------------------------------------------
     *  Hintergrund-Abgleich + Logout-Verhalten
     * ------------------------------------------------------------------------- */

    /* Mitgliederliste der ausgewählten Gruppe einmal pro Boot nachziehen
       (nur im obersten Dokument, gedrosselt): Beitritte anderer erscheinen
       damit ohne Interaktion, und eine gelöschte Gruppe räumt sich weg. */
    async function refreshSelectedGroupOnce() {
        const sel = readSelection();
        if (!sel) return;
        try {
            if (window.self !== window.top) return; // Frames: die Shell macht's
        } catch (_) { /* Zugriff verweigert → wie eingebettet behandeln */ return; }
        try {
            const last = Number(window.sessionStorage && window.sessionStorage.getItem(REFRESH_AT_KEY)) || 0;
            if (Date.now() - last < REFRESH_MIN_INTERVAL_MS) return;
            if (window.sessionStorage) window.sessionStorage.setItem(REFRESH_AT_KEY, String(Date.now()));
        } catch (_) { /* ohne Drossel weiter */ }

        try {
            const group = await fetchGroup(sel.id);
            if (!group) {
                writeSelection(null);
                return;
            }
            const user = getAuthUser();
            if (user && group.memberUids.indexOf(user.uid) === -1) {
                // Aus der Gruppe entfernt (bzw. auf anderem Gerät verlassen).
                writeSelection(null);
                return;
            }
            writeSelection({ id: group.id, name: group.name, memberUids: group.memberUids });
        } catch (err) {
            // Offline oder (noch) keine Leseberechtigung – Auswahl unangetastet
            // lassen, der nächste Boot versucht es erneut.
            console.warn('[Tippgruppen] Hintergrund-Abgleich fehlgeschlagen:', err);
        }
    }

    function hookAuthState() {
        try {
            const Auth = window.DreamTeamAuth;
            if (!Auth || typeof Auth.onAuthStateChange !== 'function') return false;
            Auth.onAuthStateChange(({ user, isVerified }) => {
                // Explizite Abmeldung (Transition angemeldet → abgemeldet):
                // Auswahl aufheben, sonst bliebe ein unsichtbarer Filter aktiv,
                // ohne dass das Dropdown (nur für Angemeldete) ihn zeigen könnte.
                if (lastSeenUser && !user) writeSelection(null);
                lastSeenUser = user || null;

                if (user && isVerified) refreshSelectedGroupOnce();
            });
            return true;
        } catch (_) {
            return false;
        }
    }

    /* ---------------------------------------------------------------------------
     *  Boot
     * ------------------------------------------------------------------------- */
    function boot() {
        whenAuthModalReady(registerMenuEntry);

        if (!hookAuthState()) {
            let attempts = 0;
            const maxAttempts = 50; // ~5s
            const interval = setInterval(() => {
                attempts += 1;
                if (hookAuthState() || attempts >= maxAttempts) clearInterval(interval);
            }, 100);
        }

        maybeHandleInviteParam();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }

    window.DreamTeamTippgruppen = {
        STORAGE_KEY,
        COLLECTION,
        getSelection,
        isFilterActive,
        filterTeams,
        onChange,
        openPopup,
        clearSelection
    };
})();
