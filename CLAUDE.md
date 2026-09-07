# Arbeitsweise in diesem Repository

<!-- Die Regeln unten sind meine persönliche Standardvorgabe. Sie sollen in ALLEN
     meinen Repos gelten; wie man sie kontoweit ausrollt, steht in
     .claude/account-setup.md. Diese Datei hier ist die Repo-Kopie. -->

## Jede Aufgabe endet mit Pull Request + Merge

Sobald eine Aufgabe Dateien im Repository ändert, ist das der verbindliche
Abschluss. Das ist ein **stehender Auftrag** – ich muss ihn nicht in jedem
einzelnen Prompt wiederholen, und es soll nicht jedes Mal nachgefragt werden:

1. Auf einem Feature-Branch arbeiten, nie direkt auf `main` committen.
2. Commit mit aussagekräftiger Nachricht, Branch pushen.
3. Pull Request gegen `main` öffnen.
4. CI abwarten. Rote Checks selbst analysieren und nachpushen, bis sie grün sind.
5. Den PR selbst mergen (Squash-Merge), danach den Branch löschen.
6. Am Schluss PR-Link, Merge-Status und eine kurze Zusammenfassung nennen.

## Ausnahmen: PR öffnen, aber NICHT mergen – zuerst bei mir nachfragen

- Der PR ändert Deploy-, CI- oder Regel-Konfiguration:
  `.github/workflows/**`, `netlify.toml`, `firebase.json`, `.firebaserc`,
  `firestore.rules`. Solche Merges werden **sofort live wirksam** und gehen an
  der Netlify-Publishing-Sperre vorbei (z. B. deployt
  `.github/workflows/deploy-firestore-rules.yml` bei jedem Push auf `main`,
  der die Rules berührt, direkt nach Firebase; die Cron-Workflows laufen
  ebenfalls ab `main`).
- Änderungen, die sich nicht trivial rückgängig machen lassen
  (Datenmigrationen, Löschen von Turnierdaten).
- Die CI ist nach zwei eigenen Korrekturversuchen immer noch rot.
- Ich habe im Prompt „kein PR", „nicht mergen", „nur Vorschlag" o. Ä.
  geschrieben – oder es ist eine reine Frage/Analyse ohne Code-Änderung.

## Warum der Auto-Merge unkritisch ist

Die App wird statisch über Netlify ausgeliefert, und dort ist **Auto Publishing
gesperrt** („Stop auto publishing", siehe README, Abschnitt „Firebase-Web-Key &
Deploy"). Ein Merge auf `main` baut also nur einen Deploy, veröffentlicht ihn
aber nicht – das Publishen bleibt ein bewusster manueller Schritt in der
Netlify-Oberfläche. Genau deshalb gelten oben die Ausnahmen: sie sind die
Stellen, an denen ein Merge *doch* sofort nach aussen wirkt.
