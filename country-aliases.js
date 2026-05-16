/* =====================================================================
 * country-aliases.js
 * ---------------------------------------------------------------------
 * Mapping englischer Länder-/Nationalmannschaftsnamen auf alternative
 * (vor allem deutsche) Schreibweisen. Wird von der Spielersuche genutzt,
 * damit z. B. „Schweiz“ Treffer für „Switzerland“ liefert oder
 * „Deutschland“ alle Spieler aus „Germany“ findet.
 *
 * Abdeckung: Alle Teilnehmer der WM 2026 sowie weitere europäische
 * Nationen aus früheren Turnieren. Neue Turniere können hier ergänzt
 * werden – die Suche bleibt dadurch automatisch konsistent
 * (siehe getCountrySearchAliases()).
 *
 * Schlüssel: Englischer Name in Kleinbuchstaben.
 * Werte:     Array von Aliasen (Sprachen, Kurzformen, Kürzel, etc.).
 * ===================================================================== */
(function (root) {
    'use strict';

    const COUNTRY_ALIASES_DE = {
        'algeria':              ['Algerien', 'ALG', 'DZA'],
        'argentina':            ['Argentinien', 'ARG'],
        'australia':            ['Australien', 'AUS'],
        'austria':              ['Österreich', 'Oesterreich', 'AUT'],
        'belgium':              ['Belgien', 'BEL'],
        'bosnia & herzegovina': ['Bosnien und Herzegowina', 'Bosnien-Herzegowina', 'Bosnien', 'BIH'],
        'brazil':               ['Brasilien', 'BRA'],
        'canada':               ['Kanada', 'CAN'],
        'cape verde islands':   ['Kap Verde', 'Kapverden', 'Kapverdische Inseln', 'CPV'],
        'colombia':             ['Kolumbien', 'COL'],
        'congo dr':             ['DR Kongo', 'Demokratische Republik Kongo', 'Kongo', 'COD'],
        'croatia':              ['Kroatien', 'CRO', 'HRV'],
        'curaçao':              ['Curacao', 'CUW'],
        'czech republic':       ['Tschechien', 'Tschechische Republik', 'CZE'],
        'ecuador':              ['Ekuador', 'ECU'],
        'egypt':                ['Ägypten', 'Aegypten', 'EGY'],
        'england':              ['ENG'],
        'france':               ['Frankreich', 'FRA'],
        'germany':              ['Deutschland', 'GER', 'DEU'],
        'ghana':                ['GHA'],
        'haiti':                ['HAI', 'HTI'],
        'iran':                 ['IRN'],
        'iraq':                 ['Irak', 'IRQ'],
        'ivory coast':          ['Elfenbeinküste', 'Elfenbeinkueste', 'Côte d’Ivoire', 'Cote d Ivoire', 'CIV'],
        'japan':                ['JPN'],
        'jordan':               ['Jordanien', 'JOR'],
        'mexico':               ['Mexiko', 'MEX'],
        'morocco':              ['Marokko', 'MAR'],
        'netherlands':          ['Niederlande', 'Holland', 'NED', 'NLD'],
        'new zealand':          ['Neuseeland', 'NZL'],
        'norway':               ['Norwegen', 'NOR'],
        'panama':               ['PAN'],
        'paraguay':             ['PAR', 'PRY'],
        'portugal':             ['POR', 'PRT'],
        'qatar':                ['Katar', 'QAT'],
        'saudi arabia':         ['Saudi-Arabien', 'Saudiarabien', 'KSA', 'SAU'],
        'scotland':             ['Schottland', 'SCO'],
        'senegal':              ['SEN'],
        'south africa':         ['Südafrika', 'Suedafrika', 'RSA', 'ZAF'],
        'south korea':          ['Südkorea', 'Suedkorea', 'Korea', 'Republik Korea', 'KOR'],
        'spain':                ['Spanien', 'ESP'],
        'sweden':               ['Schweden', 'SWE'],
        'switzerland':          ['Schweiz', 'Suisse', 'Svizzera', 'SUI', 'CHE'],
        'tunisia':              ['Tunesien', 'TUN'],
        'türkiye':              ['Türkei', 'Tuerkei', 'Turkey', 'Turkiye', 'TUR'],
        'usa':                  ['Vereinigte Staaten', 'Vereinigte Staaten von Amerika', 'Amerika', 'United States', 'United States of America'],
        'uruguay':              ['URU', 'URY'],
        'uzbekistan':           ['Usbekistan', 'UZB'],

        'albania':              ['Albanien', 'ALB'],
        'denmark':              ['Dänemark', 'Daenemark', 'DEN', 'DNK'],
        'georgia':              ['Georgien', 'GEO'],
        'hungary':              ['Ungarn', 'HUN'],
        'italy':                ['Italien', 'ITA'],
        'poland':               ['Polen', 'POL'],
        'romania':              ['Rumänien', 'Rumaenien', 'ROU', 'ROM'],
        'serbia':               ['Serbien', 'SRB'],
        'slovakia':             ['Slowakei', 'SVK'],
        'slovenia':             ['Slowenien', 'SVN'],
        'ukraine':              ['UKR'],
    };

    /**
     * Liefert für einen englischen Länder-/Nationalmannschaftsnamen alle
     * bekannten Aliase (deutsche Bezeichnung, Kurzformen, IOC/FIFA-Kürzel).
     * Unbekannte Namen ergeben ein leeres Array – die Suche funktioniert
     * dann unverändert über den Originalnamen.
     *
     * @param {string} name – z. B. "Switzerland"
     * @returns {string[]}  – z. B. ["Schweiz", "Suisse", "Svizzera", "SUI", "CHE"]
     */
    function getCountryAliases(name) {
        if (!name) return [];
        const key = String(name).trim().toLowerCase();
        const aliases = COUNTRY_ALIASES_DE[key];
        return Array.isArray(aliases) ? aliases.slice() : [];
    }

    /**
     * Variante mit zusammengesetztem String – praktisch um die Aliase direkt
     * an einen vorhandenen Such-Index anzuhängen (z. B. searchKey).
     *
     * @param {string} name
     * @returns {string} – Leerzeichen-getrennte Aliasliste (kann leer sein).
     */
    function getCountrySearchAliases(name) {
        return getCountryAliases(name).join(' ');
    }

    root.COUNTRY_ALIASES_DE = COUNTRY_ALIASES_DE;
    root.getCountryAliases = getCountryAliases;
    root.getCountrySearchAliases = getCountrySearchAliases;
})(typeof window !== 'undefined' ? window : globalThis);
