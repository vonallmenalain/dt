# Standardvorgaben kontoweit ausrollen (alle Repos, nicht nur dieses)

Ziel: „jede Aufgabe endet mit PR + Merge" gilt in **jedem** Repository, ohne dass
die Regel in jedes Repo einzeln committet oder in jedem Prompt wiederholt wird.

## Kurzfassung

| Wo ich arbeite | Was die Regel dorthin bringt | Reichweite |
| --- | --- | --- |
| **Claude Code im Web / App** (claude.ai/code) | **Setup-Script der Cloud-Umgebung** → `.claude/cloud-setup-script.sh` | Alle Repos, alle Sessions dieser Umgebung |
| **Claude Code im Terminal** | `~/.claude/CLAUDE.md` auf dem eigenen Rechner | Alle Repos auf diesem Rechner |
| Einzelnes Repo | `CLAUDE.md` im Repo-Root | Nur dieses Repo (Team sieht es mit) |

Wichtig: Das lokale `~/.claude/CLAUDE.md` wird **nicht** in Cloud-Sessions
hochgeladen. Web und Terminal sind zwei getrennte Baustellen – deshalb beides.

## Web / App: Setup-Script einbauen

1. [claude.ai/code](https://claude.ai/code) öffnen → Umgebungs-Auswahl →
   Einstellungen der Umgebung.
2. Inhalt von `.claude/cloud-setup-script.sh` ins Feld **Setup script** kopieren,
   speichern.
3. Falls mehrere Umgebungen existieren: in **jeder** eintragen, die tatsächlich
   benutzt wird – das Script gehört zur Umgebung, nicht zum Konto.
4. Eine **neue** Session starten. Laufende Sessions laden das Script nicht nach.
5. Mit `/context` prüfen: unter **Memory files** muss
   `/etc/claude-code/CLAUDE.md` auftauchen.

Wie es funktioniert: Das Script läuft als root, bevor Claude Code startet, und
schreibt die Vorgabe nach `/etc/claude-code/CLAUDE.md` – dem Managed-Policy-Pfad,
der in jeder Session und in jedem Verzeichnis mit der höchsten Priorität aller
CLAUDE.md-Ebenen geladen wird. Anschliessend wird das Dateisystem gesnapshottet,
jede spätere Session startet also mit der Datei bereits an Ort und Stelle. Das
Script läuft nur neu, wenn es geändert wird oder der Cache nach ~7 Tagen abläuft.

## Terminal: gleiche Regel lokal

```bash
mkdir -p ~/.claude
$EDITOR ~/.claude/CLAUDE.md   # denselben Markdown-Block aus dem Setup-Script einfügen
```

## GitHub-Seite

Für den Merge ist **keine** Repo-Einstellung nötig: Claude merged den PR direkt
über die GitHub-API, sobald die Checks grün sind. Ein kontoweiter GitHub-Schalter
für „Auto-Merge" existiert für persönliche Repos ohnehin nicht.

Nur wenn stattdessen GitHubs eigenes **„Merge when ready"** genutzt werden soll,
braucht es pro Repo *Settings → General → Allow auto-merge* plus einen
Branch-Schutz mit Pflicht-Checks. Das ist der Umweg, nicht der Normalfall.

## Grenzen, die man kennen sollte

- Eine CLAUDE.md ist **Kontext, keine Zwangsregel**. Sie wirkt zuverlässig, aber
  sie ist keine technische Sperre. Für harte Garantien bräuchte es Hooks.
- Die Regel gilt ab der **nächsten** Session, nicht rückwirkend.
- Wenn ein Repo eine eigene, widersprechende `CLAUDE.md` hat, entsteht ein
  Konflikt. Der Managed-Policy-Pfad hat Vorrang, aber sauberer ist es, die
  Repo-Datei anzugleichen.

## Alternative: Skill oder Plugin über das Konto

Skills und Plugins, die im claude.ai-Konto aktiviert sind, werden in
Cloud-Sessions automatisch geladen – auch kontoweit. Sie greifen aber nur, wenn
Claude sie für passend hält, statt in jeder Session fix im Kontext zu stehen.
Für eine „gilt immer"-Regel ist das Setup-Script der direktere Weg.
