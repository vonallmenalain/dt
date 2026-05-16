#!/usr/bin/env node
/* =============================================================================
 *  scripts/apply-manual-overlay-wm2026.mjs
 *
 *  Wendet die handgepflegten Overlays aus `manual-kader-wm2026.js` direkt
 *  auf das vorhandene `data-wm2026.js` an — ohne API-Football-Lauf.
 *
 *  Hintergrund:
 *    Die "richtige" Anwendung der Overlays passiert sonst in
 *    `adm-generate-kader-wm2026.html` (Browser, mit API-Lauf) oder am Ende
 *    eines vollständigen Node-Generator-Laufs. Wenn man aber nur einen
 *    Spieler manuell ergänzen oder einen Namen korrigieren will, ist
 *    weder ein RAPIDAPI-Key vorhanden noch sind die ~600 API-Calls
 *    sinnvoll.
 *
 *    Dieses Script liest die bestehende `data-wm2026.js`, übernimmt
 *    sämtliche `addPlayers` / `removeIds` / `nameOverrides` aus
 *    `manual-kader-wm2026.js` und schreibt `data-wm2026.js` zurück.
 *    Reihenfolge identisch zur Browser-Pipeline:
 *
 *      1) MANUAL_REMOVE_IDS entfernen
 *      2) MANUAL_ADD_PLAYERS anhängen (player.id-Kollision → manuell gewinnt)
 *      3) MANUAL_NAME_OVERRIDES auf alle Einträge anwenden
 *      4) Nach (Nationalteam, Spielername) sortieren
 *      5) Datei mit aktualisiertem Header schreiben
 *
 *  Aufruf:
 *      node scripts/apply-manual-overlay-wm2026.mjs
 *
 *  Optionen:
 *      --dry-run    Keine Datei schreiben, nur Bilanz ausgeben.
 * ============================================================================= */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { repoRootFromScript } from "./lib/kaderHelpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = repoRootFromScript(__dirname);

const DATA_FILE = path.join(REPO_ROOT, "data-wm2026.js");
const MANUAL_FILE = path.join(REPO_ROOT, "manual-kader-wm2026.js");

function log(msg) {
    console.log(`[apply-manual-overlay] ${msg}`);
}

function parseArgs(argv) {
    const args = { dryRun: false };
    for (const a of argv.slice(2)) {
        if (a === "--dry-run") args.dryRun = true;
        else if (a === "--help" || a === "-h") args.help = true;
    }
    return args;
}

/* ---------- data-wm2026.js: playersData-Array extrahieren ---------------- */

/**
 * Lädt das `playersData`-Array aus `data-wm2026.js`. Die Datei ist als
 * `const playersData = [ ... ];` formuliert; wir führen sie in einer
 * minimalen Sandbox via `new Function` aus und liefern das Array zurück.
 */
function loadPlayersData(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    const fn = new Function(`${raw}\nreturn playersData;`);
    const data = fn();
    if (!Array.isArray(data)) {
        throw new Error(`playersData ist kein Array (Typ: ${typeof data}).`);
    }
    return data;
}

/* ---------- manual-kader-wm2026.js: Overlay-API laden -------------------- */

async function loadManualOverlay(filePath) {
    const mod = await import(`file://${filePath}`);
    const overlay = mod.default || mod;
    return {
        addPlayers: Array.isArray(overlay.addPlayers) ? overlay.addPlayers : [],
        removeIds: Array.isArray(overlay.removeIds) ? overlay.removeIds.map(String) : [],
        nameOverrides:
            overlay.nameOverrides && typeof overlay.nameOverrides === "object"
                ? overlay.nameOverrides
                : {},
    };
}

/* ---------- Overlay anwenden ---------------------------------------------- */

function applyOverlay(playersData, overlay) {
    const stats = {
        removed: 0,
        added: 0,
        overwritten: 0,
        renamed: 0,
        renamedDetails: [],
    };

    /* 1) Entfernen */
    if (overlay.removeIds.length > 0) {
        const removeSet = new Set(overlay.removeIds);
        const before = playersData.length;
        playersData = playersData.filter((p) => !removeSet.has(String(p["player.id"])));
        stats.removed = before - playersData.length;
    }

    /* 2) Ergänzen / überschreiben */
    if (overlay.addPlayers.length > 0) {
        const idx = new Map();
        playersData.forEach((p, i) => idx.set(String(p["player.id"]), i));
        for (const manual of overlay.addPlayers) {
            if (!manual || manual["player.id"] == null) continue;
            const key = String(manual["player.id"]);
            const existing = idx.get(key);
            if (existing !== undefined) {
                playersData[existing] = manual;
                stats.overwritten++;
            } else {
                playersData.push(manual);
                idx.set(key, playersData.length - 1);
                stats.added++;
            }
        }
    }

    /* 3) Namens-Overrides */
    const overrideKeys = Object.keys(overlay.nameOverrides);
    if (overrideKeys.length > 0) {
        const overrideMap = new Map(
            overrideKeys.map((k) => [String(k), String(overlay.nameOverrides[k])]),
        );
        for (const p of playersData) {
            const key = String(p["player.id"]);
            const target = overrideMap.get(key);
            if (target && p.Spielername !== target) {
                stats.renamedDetails.push({
                    id: key,
                    from: p.Spielername,
                    to: target,
                });
                p.Spielername = target;
                stats.renamed++;
            }
        }
    }

    /* 4) Sortierung */
    playersData.sort((a, b) => {
        const nation = String(a["Nationalteam.name"] || "").localeCompare(
            String(b["Nationalteam.name"] || ""),
            "de",
        );
        if (nation !== 0) return nation;
        return String(a["Spielername"] || "").localeCompare(
            String(b["Spielername"] || ""),
            "de",
        );
    });

    return { playersData, stats };
}

/* ---------- Header aus bestehender Datei extrahieren ---------------------- */

/**
 * Liest die führenden Kommentar-Zeilen (bis zur ersten Leerzeile gefolgt
 * von `const playersData`) aus der bestehenden `data-wm2026.js`. Damit
 * bleibt z.B. der "OFFIZIELL"- bzw. "PROVISORISCH"-Header sowie das
 * Generierungs-Datum erhalten. Die Overlay-Bilanz-Zeilen werden im
 * Header refresht.
 */
function buildUpdatedHeader(rawFileContent, overlay, stats) {
    const lines = rawFileContent.split(/\r?\n/);
    const headerLines = [];
    for (const line of lines) {
        if (line.startsWith("//") || line.trim() === "") {
            headerLines.push(line);
            continue;
        }
        if (line.startsWith("const playersData")) break;
        // Sicherheitsabbruch: kein anderer Code vor playersData.
        break;
    }

    /* Vorhandenen Overlay-Block (von "Manuelle Overlays …" bis zum
     * Ende der Diakritika-Notiz) abschneiden, damit er nicht doppelt
     * im neuen Header landet. */
    const overlayMarker = "Manuelle Overlays (aus manual-kader-wm2026.js)";
    let cutIndex = headerLines.length;
    for (let i = 0; i < headerLines.length; i++) {
        if (headerLines[i].includes(overlayMarker)) {
            cutIndex = i;
            // Auch vorangehende reine "//"-Trenner entfernen.
            while (cutIndex > 0 && headerLines[cutIndex - 1].trim() === "//") {
                cutIndex--;
            }
            break;
        }
    }
    const cleaned = headerLines.slice(0, cutIndex);

    /* Trailing-Leerzeilen abschneiden */
    while (cleaned.length && cleaned[cleaned.length - 1].trim() === "") {
        cleaned.pop();
    }

    const overlayBlock = [
        "//",
        "// Manuelle Overlays (aus manual-kader-wm2026.js) automatisch angewendet:",
        `//   - Manuell ergänzte Spieler:   ${stats.added}`,
        `//   - Manuell überschriebene IDs: ${stats.overwritten}`,
        `//   - Manuell entfernte IDs:      ${stats.removed}`,
        `//   - Namens-Overrides definiert: ${Object.keys(overlay.nameOverrides).length}`,
        `//   - Namens-Overrides angewendet: ${stats.renamed}`,
        "//",
        "// Originalnamen mit Diakritika (Dembélé, Ødegaard, Vinícius Júnior, …)",
        "// bleiben erhalten — die App-Suche ist diakritikatolerant.",
    ];

    return [...cleaned, ...overlayBlock].join("\n");
}

/* ---------- Main ---------------------------------------------------------- */

async function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        console.log(
            "Usage: node scripts/apply-manual-overlay-wm2026.mjs [--dry-run]\n" +
                "\n" +
                "  Wendet die Overlays aus manual-kader-wm2026.js auf das vorhandene\n" +
                "  data-wm2026.js an (ohne API-Lauf). --dry-run schreibt die Datei nicht,\n" +
                "  sondern gibt nur die Bilanz aus.",
        );
        return;
    }

    if (!fs.existsSync(DATA_FILE)) {
        log(`FEHLER: ${DATA_FILE} nicht gefunden.`);
        process.exit(1);
    }
    if (!fs.existsSync(MANUAL_FILE)) {
        log(`FEHLER: ${MANUAL_FILE} nicht gefunden.`);
        process.exit(1);
    }

    log(`Lese ${path.relative(REPO_ROOT, DATA_FILE)} …`);
    const rawData = fs.readFileSync(DATA_FILE, "utf8");
    const playersData = loadPlayersData(DATA_FILE);
    log(`  → ${playersData.length} Spieler geladen.`);

    log(`Lese ${path.relative(REPO_ROOT, MANUAL_FILE)} …`);
    const overlay = await loadManualOverlay(MANUAL_FILE);
    log(
        `  → addPlayers=${overlay.addPlayers.length}, ` +
            `removeIds=${overlay.removeIds.length}, ` +
            `nameOverrides=${Object.keys(overlay.nameOverrides).length}.`,
    );

    const { playersData: merged, stats } = applyOverlay(playersData, overlay);
    log(
        `Overlay-Bilanz: +${stats.added} ergänzt, ` +
            `${stats.overwritten} überschrieben, ` +
            `${stats.removed} entfernt, ` +
            `${stats.renamed} umbenannt.`,
    );
    if (stats.renamedDetails.length) {
        for (const r of stats.renamedDetails) {
            log(`  ✏️  ${r.id}: "${r.from}" → "${r.to}"`);
        }
    }

    const header = buildUpdatedHeader(rawData, overlay, stats);
    const body = `const playersData = ${JSON.stringify(merged, null, 4)};\n`;
    const fileContent = `${header}\n\n${body}`;

    if (args.dryRun) {
        log(`[--dry-run] Datei nicht geschrieben. Würde ${merged.length} Spieler exportieren.`);
        return;
    }

    fs.writeFileSync(DATA_FILE, fileContent, "utf8");
    log(`✅ ${path.relative(REPO_ROOT, DATA_FILE)} geschrieben (${merged.length} Spieler).`);
}

main().catch((err) => {
    console.error(`[apply-manual-overlay] UNERWARTETER FEHLER: ${err && err.stack ? err.stack : err}`);
    process.exit(1);
});
