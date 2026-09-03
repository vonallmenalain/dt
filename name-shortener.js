/* =============================================================================
 *  name-shortener.js – „Vorname Nachname" aus vollen bürgerlichen Namen
 *
 *  api-football liefert pro Spieler drei Namensfelder: einen gebräuchlichen
 *  Kurznamen (`name`, oft abgekürzt: "A. Tchouaméni"), den Vornamen
 *  (`firstname`, oft MIT Zweit-/Mittelnamen: "Aurélien Djani") und den
 *  Nachnamen (`lastname`, in spanischsprachigen Ländern MIT dem
 *  Mutternamen: "Cubarsí Paredes"). Naiv zusammengesetzt entstehen daraus
 *  Anzeigenamen mit drei und mehr Wörtern, die in Karten, Chips und Listen
 *  umbrechen oder abgeschnitten werden.
 *
 *  Dieses Modul kürzt Namen auf die Form „Vorname Nachname" – und zwar an
 *  zwei Stellen mit derselben Logik:
 *
 *    1. Im Generator (scripts/generate-kader.js, scripts/generate-cl-pool.js)
 *       über `buildDisplayName()`. Dort sind firstname/lastname bekannt, das
 *       Ergebnis ist deshalb präziser (siehe Doppelnachnamen unten).
 *    2. Beim Laden im Browser (data.js) über `shortenPlayerName()`, damit
 *       bestehende, bereits generierte Kaderdateien sofort korrekt angezeigt
 *       werden, ohne sie neu zu erzeugen.
 *
 *  Bewusst ERHALTEN bleiben:
 *    - Nachnamens-Partikel: "Virgil van Dijk", "Frenkie de Jong",
 *      "Marc-André ter Stegen", "Kevin De Bruyne", "Alexis Mac Allister",
 *      "Giovani Lo Celso", "Ameen Al Dakhil", "Bilal El Khannouss".
 *    - Bindestrich-Namen (ein Wort): "Trent Alexander-Arnold",
 *      "Vanja Milinković-Savić", "Myles Lewis-Skelly".
 *    - Vornamen mit vorangestelltem Artikel: "El Chadaille Bitshiabu".
 *    - Abgekürzte Profile ("A. Le Borgne", "T. van der Leij"): unangetastet,
 *      weil dort nicht zu erkennen ist, was Vor- und was Nachname ist.
 *
 *  Was diese Logik NICHT wissen kann, sind Rufnamen, die vom ersten
 *  Vornamen abweichen ("Damián Emiliano Martínez" → "Emiliano Martínez")
 *  und – im Browser-Pfad ohne firstname/lastname – spanische
 *  Doppelnachnamen ("Pau Cubarsí Paredes" → "Pau Cubarsí"). Für diese
 *  wenigen Fälle gibt es name-overrides.js; die Overrides laufen NACH
 *  dieser Kürzung und haben damit immer das letzte Wort.
 * ============================================================================= */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NAME_SHORTENER = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // Partikel, die zum NACHNAMEN gehören und deshalb nicht als Mittelname
  // wegfallen dürfen. Verglichen wird kleingeschrieben und ohne Diakritika,
  // "De"/"de"/"DE" sind also derselbe Eintrag.
  var SURNAME_PARTICLES = [
    // niederländisch/deutsch/flämisch
    'van', 'von', 'der', 'den', 'de', 'te', 'ten', 'ter', 'vande', 'vanden',
    'vander', 'op', 'in', 'zu',
    // romanisch
    'del', 'della', 'delle', 'dello', 'degli', 'dei', 'di', 'da', 'das', 'dos',
    'do', 'du', 'la', 'le', 'lo', 'los', 'las', 'y', 'e',
    // arabisch/afrikanisch
    'el', 'al', 'abu', 'ben', 'bin', 'ibn', 'ould',
    // gälisch/romanisch (Heiligennamen)
    'mac', 'mc', 'san', 'santa', 'saint', 'st'
  ];

  // Artikel, die einem VORNAMEN vorangestellt sind ("El Chadaille",
  // "El Hadji"). Steht so ein Wort am Anfang, umfasst der Vorname zwei
  // Wörter statt einem.
  var GIVEN_NAME_PREFIXES = ['el', 'al', 'le', 'la', 'de', 'da', 'di', 'du', 'ben', 'bin', 'abu', 'san', 'saint', 'st'];

  var SURNAME_PARTICLE_SET = toSet(SURNAME_PARTICLES);
  var GIVEN_NAME_PREFIX_SET = toSet(GIVEN_NAME_PREFIXES);

  function toSet(list) {
    var set = {};
    for (var i = 0; i < list.length; i++) set[list[i]] = true;
    return set;
  }

  // Die API liefert Apostrophe teils als HTML-Entität ("Nico O&apos;Reilly").
  // Unbehandelt landet die Entität wortwörtlich in der Anzeige.
  function decodeNameEntities(value) {
    return String(value == null ? '' : value)
      .replace(/&apos;|&#0*39;|&#x0*27;/gi, "'")
      .replace(/&quot;|&#0*34;/gi, '"')
      .replace(/&nbsp;|&#0*160;/gi, ' ')
      .replace(/&amp;/gi, '&');
  }

  /* Doppelt kodierte Namen reparieren (Mojibake).
   *
   * Ein Teil der Namen kommt bei api-football doppelt kodiert an: die
   * UTF-8-Bytes wurden einmal als Latin-1 gelesen und erneut als UTF-8
   * gespeichert. Sichtbar wird das an Namen wie
   *
   *   "Andrija MaksimoviA<0x87>"  statt  "Andrija Maksimovic'"
   *   "Dani MartA<0xAD>nez"       statt  "Dani Martinez"
   *
   * Das Erkennungsmerkmal ist eindeutig: ein Zeichen aus dem Bereich der
   * UTF-8-Startbytes (U+00C2 bis U+00F4) gefolgt von einem oder mehreren
   * Zeichen aus dem Bereich der Fortsetzungsbytes (U+0080 bis U+00BF). In
   * dieser Kombination kommt keine echte Schreibweise vor - der zweite
   * Bereich enthaelt C1-Steuerzeichen, die in Personennamen nichts zu
   * suchen haben.
   *
   * Repariert wird nur der erkannte Abschnitt, nicht der ganze String: so
   * bleiben Namen unangetastet, die daneben legitime Zeichen ausserhalb
   * von Latin-1 tragen. Ergibt das Rueckrechnen kein sauberes Zeichen,
   * bleibt der Originaltext stehen - lieber ein kaputter Name als ein
   * falsch geratener.
   *
   * Bewusst hier und nicht nur im Generator: so greift die Korrektur
   * sofort auf den bestehenden Kaderdateien, ohne sie neu zu erzeugen -
   * dieselbe Begruendung wie bei der Kuerzung selbst.
   */
  function repairMojibake(value) {
    var text = String(value == null ? '' : value);
    if (!/[\u00C2-\u00F4][\u0080-\u00BF]/.test(text)) return text;
    return text.replace(/[\u00C2-\u00F4][\u0080-\u00BF]{1,3}/g, function (run) {
      var percent = '';
      for (var i = 0; i < run.length; i++) {
        var byte = run.charCodeAt(i);
        percent += '%' + (byte < 16 ? '0' : '') + byte.toString(16);
      }
      var decoded;
      try {
        decoded = decodeURIComponent(percent);
      } catch (err) {
        return run;                      // keine gueltige UTF-8-Folge
      }
      // Steuerzeichen oder Ersatzzeichen: die Annahme war falsch.
      if (/[\u0000-\u001F\u007F-\u009F\uFFFD]/.test(decoded)) return run;
      return decoded;
    });
  }

  function cleanName(value) {
    return repairMojibake(decodeNameEntities(value)).replace(/\s+/g, ' ').trim();
  }

  function normalizeToken(token) {
    return String(token == null ? '' : token)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
  }

  function isSurnameParticle(token) {
    return SURNAME_PARTICLE_SET[normalizeToken(token)] === true;
  }

  function isGivenNamePrefix(token) {
    return GIVEN_NAME_PREFIX_SET[normalizeToken(token)] === true;
  }

  // Einzelbuchstabe mit Punkt ("A.", "J.") – Kennzeichen eines abgekürzten
  // Namens.
  function isInitialToken(token) {
    return /^[A-Za-zÀ-ÖØ-öø-ÿ]\.$/.test(String(token || ''));
  }

  function tokens(name) {
    return cleanName(name).split(' ').filter(Boolean);
  }

  function hasInitial(name) {
    var parts = tokens(name);
    for (var i = 0; i < parts.length; i++) {
      if (isInitialToken(parts[i])) return true;
    }
    return false;
  }

  /* ───────────────────────────────────────────────────────────────────────────
   *  Kürzung allein aus dem Anzeigenamen (Browser-Pfad, data.js)
   * ─────────────────────────────────────────────────────────────────────────── */
  function shortenPlayerName(fullName) {
    var parts = tokens(fullName);
    if (parts.length <= 2) return parts.join(' ');
    // Abgekürzte Profile bleiben, wie sie sind – "A. Le Borgne" liesse sich
    // sonst zu "A. Borgne" verstümmeln.
    if (hasInitial(parts.join(' '))) return parts.join(' ');

    // Nachname von hinten aufsammeln: letztes Wort plus alle unmittelbar
    // davorstehenden Partikel ("van der Leij", "De La Cruz").
    var surname = [parts[parts.length - 1]];
    var i = parts.length - 2;
    while (i >= 1 && isSurnameParticle(parts[i])) {
      surname.unshift(parts[i]);
      i--;
    }

    // Vorname: erstes Wort – bei vorangestelltem Artikel die ersten zwei.
    var given = [parts[0]];
    if (i >= 1 && isGivenNamePrefix(parts[0])) given.push(parts[1]);

    return given.concat(surname).join(' ');
  }

  /* ───────────────────────────────────────────────────────────────────────────
   *  Anzeigename aus einem api-football-Spielerobjekt (Generator-Pfad)
   * ─────────────────────────────────────────────────────────────────────────── */

  // Aus `lastname` den Nachnamen für die Anzeige gewinnen: führende Partikel
  // plus das erste echte Nachnamen-Wort. Schneidet den spanischen
  // Mutternamen ab ("Cubarsí Paredes" → "Cubarsí", "Yamal Nasraoui Ebana" →
  // "Yamal") und lässt zusammengesetzte Nachnamen intakt ("Mac Allister",
  // "van Dijk", "ter Stegen").
  function surnameFromLastName(lastName) {
    var parts = tokens(lastName);
    if (parts.length <= 1) return parts.join(' ');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      out.push(parts[i]);
      if (!isSurnameParticle(parts[i])) break;
    }
    return out.join(' ');
  }

  // Rufname aus `firstname` wählen. Ist im Kurznamen der Anfangsbuchstabe
  // bekannt ("E. Martínez"), gewinnt das Vornamen-Wort mit genau diesem
  // Buchstaben – so wird aus "Damián Emiliano" korrekt "Emiliano" und nicht
  // "Damián". Ohne Treffer bleibt es beim ersten Wort.
  function givenNameFromFirstName(firstName, initial) {
    var parts = tokens(firstName);
    if (!parts.length) return '';
    var wanted = normalizeToken(initial).charAt(0);
    if (wanted) {
      for (var i = 0; i < parts.length; i++) {
        if (normalizeToken(parts[i]).charAt(0) === wanted) {
          // Vorangestellter Artikel gehört zum Vornamen ("El Hadji").
          if (isGivenNamePrefix(parts[i]) && parts[i + 1]) return parts[i] + ' ' + parts[i + 1];
          return parts[i];
        }
      }
    }
    if (isGivenNamePrefix(parts[0]) && parts[1]) return parts[0] + ' ' + parts[1];
    return parts[0];
  }

  // Vollständige Namenslogik für den Generator.
  //
  //   1. Ein kurzer, gebräuchlicher `name` (≤ 2 Wörter, keine Initiale) ist
  //      die beste Quelle und wird unverändert übernommen – "Rodri",
  //      "Lamine Yamal", "Vinícius Júnior", "Dayot Upamecano".
  //   2. Sonst aus Kurzname und firstname/lastname bauen: Rufname (per
  //      Initiale des Kurznamens bestimmt) + der Nachname, den der
  //      abgekürzte Kurzname nennt.
  //   3. Ohne firstname/lastname bleibt nur der Kurzname, gekürzt.
  function buildDisplayName(player) {
    var p = player || {};
    var common = cleanName(p.name);
    var firstName = cleanName(p.firstname);
    var lastName = cleanName(p.lastname);

    var commonTokens = tokens(common);
    var commonAbbreviated = hasInitial(common);
    if (common && !commonAbbreviated && commonTokens.length <= 2) return common;

    var initial = commonAbbreviated ? commonTokens[0].charAt(0) : '';
    var given = givenNameFromFirstName(firstName, initial);
    // Nachname: der abgekürzte Kurzname hat Vorrang vor dem lastname-Feld.
    //
    // Im `lastname` steckt je nach Herkunft Verschiedenes, und dem Feld ist
    // nicht anzusehen, was davon:
    //
    //   "Cubarsí Paredes"      → Vater- + Muttername   → "Cubarsí"  (erstes)
    //   "Hamlet Mkhitaryan"    → Mittel- + Nachname    → "Mkhitaryan" (letztes)
    //   "Braut Haaland"        → Mittel- + Nachname    → "Haaland"
    //   "Blom Due Hjulmand"    → zwei Mittelnamen      → "Hjulmand"
    //
    // Eine Regel über das Feld allein trifft immer die eine oder die andere
    // Sorte falsch – so standen Erling Haaland als "Erling Braut" und
    // Henrikh Mkhitaryan als "Henrikh Hamlet" im Pool. Der Kurzname
    // ("E. Haaland", "H. Mkhitaryan") nennt dagegen genau den Nachnamen, den
    // die API als gebräuchlich führt; er ist deshalb die bessere Quelle.
    // Partikel bleiben dabei erhalten ("T. van der Leij" → "van der Leij").
    var surname = '';
    if (commonAbbreviated && commonTokens.length > 1) {
      surname = surnameFromLastName(commonTokens.slice(1).join(' '));
    }
    // Kein abgekürzter Kurzname (oder einer ohne Nachnamen-Teil): dann bleibt
    // nur das lastname-Feld – dort weiterhin ohne Mutternamen.
    if (!surname) surname = surnameFromLastName(lastName);
    if (given && surname) return shortenPlayerName(given + ' ' + surname);

    return shortenPlayerName(common) || cleanName(given + ' ' + surname) ||
      cleanName(firstName + ' ' + lastName);
  }

  return {
    shortenPlayerName: shortenPlayerName,
    buildDisplayName: buildDisplayName,
    surnameFromLastName: surnameFromLastName,
    givenNameFromFirstName: givenNameFromFirstName,
    decodeNameEntities: decodeNameEntities,
    repairMojibake: repairMojibake,
    isSurnameParticle: isSurnameParticle,
    SURNAME_PARTICLES: SURNAME_PARTICLES,
    GIVEN_NAME_PREFIXES: GIVEN_NAME_PREFIXES
  };
});
