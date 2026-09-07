#!/bin/bash
# =============================================================================
# Setup-Script für Claude-Code-Cloud-Umgebungen (claude.ai/code → Environment).
#
# Zweck: meine persönliche Standardvorgabe "jede Aufgabe endet mit PR + Merge"
# in JEDEM Repository gültig machen, ohne sie in jedes Repo einzeln zu committen.
#
# Wie es wirkt: das Script läuft als root, BEVOR Claude Code startet, und legt
# die Vorgabe unter dem Managed-Policy-Pfad ab (/etc/claude-code/CLAUDE.md).
# Claude Code lädt diese Datei in jeder Session, in jedem Verzeichnis, mit der
# höchsten Priorität aller CLAUDE.md-Ebenen. Anthropic snapshottet danach das
# Dateisystem, jede weitere Session startet also mit der Datei bereits da.
#
# Einbauen: claude.ai/code → Umgebung → Einstellungen → Feld "Setup script"
# → diesen Inhalt einfügen → speichern. Danach eine NEUE Session starten
# (laufende Sessions laden das Script nicht nach) und mit /context prüfen, dass
# die Datei unter "Memory files" auftaucht.
#
# Das Script darf nicht mit != 0 enden, sonst startet die Session nicht.
# =============================================================================
set -u

mkdir -p /etc/claude-code /root/.claude

# tee schreibt denselben Inhalt an beide Stellen:
#   /etc/claude-code/CLAUDE.md  – Managed Policy, höchste Priorität, liegt
#                                 ausserhalb von ~/.claude und überlebt dort
#                                 stattfindendes Aufräumen.
#   /root/.claude/CLAUDE.md     – User-Memory, Gürtel und Hosenträger.
tee /etc/claude-code/CLAUDE.md /root/.claude/CLAUDE.md > /dev/null <<'MARKDOWN'
# Persönliche Standardvorgaben (gelten in jedem Repository)

## Jede Aufgabe endet mit Pull Request + Merge

Sobald eine Aufgabe Dateien im Repository ändert, ist das der verbindliche
Abschluss. Das ist ein **stehender Auftrag** – ich muss ihn nicht in jedem
einzelnen Prompt wiederholen, und es soll nicht jedes Mal nachgefragt werden:

1. Auf einem Feature-Branch arbeiten, nie direkt auf den Default-Branch committen.
2. Commit mit aussagekräftiger Nachricht, Branch pushen.
3. Pull Request gegen den Default-Branch öffnen.
4. CI abwarten. Rote Checks selbst analysieren und nachpushen, bis sie grün sind.
5. Den PR mergen (Squash-Merge), danach den Branch löschen.
6. Am Schluss PR-Link, Merge-Status und eine kurze Zusammenfassung nennen.

Das gilt **ausnahmslos**, auch für Deploy-, CI- und Regel-Konfiguration wie
`.github/workflows/**`, `netlify.toml`, `firebase.json`, `.firebaserc` oder
`firestore.rules`. Nicht gemergt wird nur, wenn ich es im Prompt ausdrücklich
sage („kein PR", „nicht mergen", „nur Vorschlag") – oder wenn es gar keine
Code-Änderung gibt, weil ich bloss eine Frage gestellt habe.

## Warum das so gewollt ist

Bei meinen Netlify-Projekten ist Auto Publishing gesperrt
(„Stop auto publishing"). Ein Merge auf den Default-Branch baut also nur einen
Deploy, veröffentlicht ihn aber nicht live – das Publishen bleibt ein bewusster
manueller Schritt. Dass einzelne Merges (Firebase-Rules, Cron-Workflows) an
Netlify vorbei sofort wirken, ist mir bekannt und ändert die Regel nicht.
MARKDOWN

exit 0
