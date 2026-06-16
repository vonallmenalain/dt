# Product

## Register

product

## Users

DreamTeam wird von Fantasy-Football-Teilnehmerinnen und -Teilnehmern genutzt, die vor und waehrend der WM 2026 ihr Team bauen, Captains setzen, andere Teams ansehen und Punkte live verfolgen. Die App wird haeufig mobil genutzt, oft zum schnellen Pruefen von Ranglisten, Spielern, Badges und Live-Updates.

## Product Purpose

DreamTeam ist eine statisch ausgelieferte Fantasy-App fuer die WM 2026. Sie hilft Nutzenden, ein gueltiges Team aus dem Spielerpool zusammenzustellen, Manager-Teams zu vergleichen, Spielerleistungen zu analysieren und Punkte ueber Firestore-gestuetzte Live-Daten zu verfolgen. Erfolg bedeutet: Teamaufbau, Analyse und Rangliste bleiben auch auf kleinen Screens schnell, lesbar und vertrauenswuerdig.

## Brand Personality

Modern, sportlich, ruhig und hochwertig. Die App soll nach einer ernsthaften Turnier-Companion-App wirken: energiegeladen genug fuer Fussball, aber nicht laut, generisch oder dekorativ.

## Anti-references

Keine sichtbaren Entwickler-Hinweise in der Nutzer-UI. Kein komplettes Redesign, keine Marketing-Landingpage-Anmutung, keine generischen Kartenraster, keine uebertriebenen Animationen, keine Layout-Experimente auf Kosten der Bedienbarkeit. Firebase, Auth, Firestore Rules, Punkteberechnung, Live-Sync, 30-Sekunden-Live-Modus, Kaderdaten und Manager-Team-Validierung sind nicht Teil des Design-Spielraums.

## Design Principles

Mobile first where it matters: Team bauen, Spieler pruefen, Captain setzen und Ranglisten scannen muessen auf 320px bis 430px Breite bedienbar bleiben.

Preserve the live product contract: Live-Modus, Datenladewege und Punkteberechnung werden respektiert; UI-Verbesserungen duerfen diese Mechanik nicht verschieben.

Reduce friction, not features: Auf Mobile wird gestapelt, gekuerzt oder besser umgebrochen, aber keine wichtige Funktion versteckt oder entfernt.

Dense but calm: Fussball- und Statistikdaten duerfen informationsreich sein, brauchen aber klare Hierarchie, robuste Textbehandlung und konsistente Touch-Ziele.

Polish through consistency: Kleine Verbesserungen an Abstand, Fokus, States, Lesbarkeit und Motion sollen die bestehende App-Struktur staerken, nicht ersetzen.

## Accessibility & Inclusion

Ziel ist eine pragmatische WCAG-AA-nahe Mobile-Erfahrung: ausreichende Kontraste, sichtbare Fokuszustaende, ungefaehr 44px grosse Touch-Ziele, robuste deutsche Texte, reduzierte Bewegung via `prefers-reduced-motion` und kein horizontales Scrollen ausser dort, wo tabellarische Daten bewusst einen Overflow brauchen.
