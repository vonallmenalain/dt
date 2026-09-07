# Arbeitsweise in diesem Repository

<!-- Persönliche Standardvorgabe; soll in ALLEN meinen Repos gelten.
     Wie sie kontoweit ausgerollt wird: .claude/account-setup.md -->

## Jede Aufgabe endet mit Pull Request + Merge

Sobald eine Aufgabe Dateien im Repository ändert, ist das der verbindliche
Abschluss. Das ist ein **stehender Auftrag** – ich muss ihn nicht in jedem
einzelnen Prompt wiederholen, und es soll nicht jedes Mal nachgefragt werden:

1. Auf einem Feature-Branch arbeiten, nie direkt auf `main` committen.
2. Commit mit aussagekräftiger Nachricht, Branch pushen.
3. Pull Request gegen `main` öffnen.
4. CI abwarten. Rote Checks selbst analysieren und nachpushen, bis sie grün sind.
5. Den PR mergen (Squash-Merge), danach den Branch löschen.
6. Am Schluss PR-Link, Merge-Status und eine kurze Zusammenfassung nennen.

Das gilt **ausnahmslos**, auch für Änderungen an `.github/workflows/**`,
`netlify.toml`, `firebase.json`, `.firebaserc` und `firestore.rules`. Nicht
gemergt wird nur, wenn ich es im Prompt ausdrücklich sage („kein PR",
„nicht mergen", „nur Vorschlag") – oder wenn es gar keine Code-Änderung gibt,
weil ich bloss eine Frage gestellt habe.

## Warum das so gewollt ist

Die App wird statisch über Netlify ausgeliefert, und dort ist **Auto Publishing
gesperrt** („Stop auto publishing", siehe README, Abschnitt „Firebase-Web-Key &
Deploy"). Ein Merge auf `main` baut also nur einen Deploy, veröffentlicht ihn
aber nicht – das Publishen bleibt ein bewusster manueller Schritt in der
Netlify-Oberfläche.

Bewusst in Kauf genommen: Zwei Dinge wirken beim Merge trotzdem sofort, weil
sie nicht über Netlify laufen. Ein Merge, der `firestore.rules`,
`firebase.json` oder `.firebaserc` berührt, löst
`.github/workflows/deploy-firestore-rules.yml` aus und deployt die
Firestore-Sicherheitsregeln direkt nach Firebase. Und Änderungen an den
Cron-Workflows (z. B. `auto-points-upload.yml`) sind ab `main` beim nächsten
Lauf aktiv. Beides ist bekannt und ändert nichts an der Regel oben.
