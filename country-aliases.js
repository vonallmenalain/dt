/* =====================================================================
 * country-aliases.js
 * ---------------------------------------------------------------------
 * Mapping englischer Länder-/Nationalmannschaftsnamen auf alternative
 * (vor allem deutsche) Schreibweisen. Wird von der Spielersuche genutzt,
 * damit z. B. „Schweiz“ Treffer für „Switzerland“ liefert oder
 * „Deutschland“ alle Spieler aus „Germany“ findet.
 *
 * Abdeckung: Alle Teilnehmer der WM 2026, weitere europäische Nationen
 * aus früheren Turnieren sowie alle Nationalitäten, die in den
 * CL-Klubkadern vorkommen. Neue Turniere können hier ergänzt werden –
 * die Suche bleibt dadurch automatisch konsistent
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

        /* Nationalitäten aus den CL-Klubkadern. Anders als bei einem
           Nationalturnier ist der Spielerpool dort weltweit gemischt –
           ohne diese Einträge fände „Nordmazedonien“ keinen Spieler mit
           der API-Nationalität „North Macedonia“. */
        'armenia':                  ['Armenien', 'ARM'],
        'azerbaijan':               ['Aserbaidschan', 'AZE'],
        'belarus':                  ['Weissrussland', 'Weißrussland', 'BLR'],
        'burkina faso':             ['BFA', 'BUR'],
        'cameroon':                 ['Kamerun', 'CMR'],
        'central african republic': ['Zentralafrikanische Republik', 'Zentralafrika', 'CAF'],
        'congo':                    ['Kongo', 'Republik Kongo', 'CGO', 'COG'],
        'cyprus':                   ['Zypern', 'CYP'],
        'finland':                  ['Finnland', 'FIN'],
        'gabon':                    ['Gabun', 'GAB'],
        'gambia':                   ['GAM', 'GMB'],
        'greece':                   ['Griechenland', 'GRE', 'GRC'],
        'guinea':                   ['GUI', 'GIN'],
        'guinea-bissau':            ['Guinea Bissau', 'GNB'],
        'iceland':                  ['Island', 'ISL'],
        'israel':                   ['ISR'],
        'jamaica':                  ['Jamaika', 'JAM'],
        'kazakhstan':               ['Kasachstan', 'KAZ'],
        'kosovo':                   ['KOS', 'XKX'],
        'liberia':                  ['LBR'],
        'luxembourg':               ['Luxemburg', 'LUX'],
        'mali':                     ['MLI'],
        'montenegro':               ['MNE'],
        'mozambique':               ['Mosambik', 'MOZ'],
        'nigeria':                  ['NGA', 'NGR'],
        'north macedonia':          ['Nordmazedonien', 'Mazedonien', 'Macedonia', 'MKD'],
        'northern ireland':         ['Nordirland', 'NIR'],
        'peru':                     ['PER'],
        'republic of ireland':      ['Irland', 'Ireland', 'IRL'],
        'russia':                   ['Russland', 'RUS'],
        'thailand':                 ['THA'],
        'venezuela':                ['VEN'],
        'wales':                    ['WAL'],
        'zimbabwe':                 ['Simbabwe', 'ZIM', 'ZWE'],
    };

    const COUNTRY_ALIAS_GROUPS = [
        ['Algeria', 'Algerien', 'ALG', 'DZA'],
        ['Argentina', 'Argentinien', 'ARG'],
        ['Australia', 'Australien', 'AUS'],
        ['Austria', 'Oesterreich', 'Austria', 'AUT'],
        ['Belgium', 'Belgien', 'BEL'],
        ['Bosnia And Herzegovina', 'Bosnia and Herzegovina', 'Bosnia & Herzegovina', 'Bosnien und Herzegowina', 'BIH'],
        ['Brazil', 'Brasilien', 'BRA'],
        ['Cabo Verde', 'Cape Verde', 'Cape Verde Islands', 'Cabo Verde Islands', 'Kap Verde', 'CPV'],
        ['Canada', 'Kanada', 'CAN'],
        ['Colombia', 'Kolumbien', 'COL'],
        ['Congo DR', 'DR Congo', 'Democratic Republic of the Congo', 'Kongo DR', 'COD'],
        ['Cote D Ivoire', 'Ivory Coast', 'Cote d Ivoire', "Cote d'Ivoire", 'Elfenbeinkueste', 'CIV'],
        ['Croatia', 'Kroatien', 'CRO', 'HRV'],
        ['Curacao', 'CUW'],
        ['Czechia', 'Czech Republic', 'Tschechien', 'CZE'],
        ['Ecuador', 'Ekuador', 'ECU'],
        ['Egypt', 'Aegypten', 'EGY'],
        ['England', 'ENG'],
        ['France', 'Frankreich', 'FRA'],
        ['Germany', 'Deutschland', 'GER', 'DEU'],
        ['Ghana', 'GHA'],
        ['Haiti', 'HAI', 'HTI'],
        ['IR Iran', 'Iran', 'IRN'],
        ['Iraq', 'Irak', 'IRQ'],
        ['Japan', 'JPN'],
        ['Jordan', 'Jordanien', 'JOR'],
        ['Korea Republic', 'South Korea', 'Republic of Korea', 'Suedkorea', 'KOR'],
        ['Mexico', 'Mexiko', 'MEX'],
        ['Morocco', 'Marokko', 'MAR'],
        ['Netherlands', 'Niederlande', 'Holland', 'NED', 'NLD'],
        ['New Zealand', 'Neuseeland', 'NZL'],
        ['Norway', 'Norwegen', 'NOR'],
        ['Panama', 'PAN'],
        ['Paraguay', 'PAR', 'PRY'],
        ['Portugal', 'POR', 'PRT'],
        ['Qatar', 'Katar', 'QAT'],
        ['Saudi Arabia', 'Saudi-Arabien', 'Saudiarabien', 'KSA', 'SAU'],
        ['Scotland', 'Schottland', 'SCO'],
        ['Senegal', 'SEN'],
        ['South Africa', 'Suedafrika', 'RSA', 'ZAF'],
        ['Spain', 'Spanien', 'ESP'],
        ['Sweden', 'Schweden', 'SWE'],
        ['Switzerland', 'Schweiz', 'Suisse', 'Svizzera', 'SUI', 'CHE'],
        ['Tunisia', 'Tunesien', 'TUN'],
        ['Turkiye', 'Turkey', 'Tuerkei', 'Turkei', 'TUR'],
        ['USA', 'United States', 'United States of America', 'Vereinigte Staaten', 'Vereinigte Staaten von Amerika'],
        ['Uruguay', 'URU', 'URY'],
        ['Uzbekistan', 'Usbekistan', 'UZB']
    ];

    function normalizeCountryKey(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/['`´’]/g, '')
            .replace(/&/g, ' and ')
            .replace(/[^a-zA-Z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();
    }

    /* Die deutschen Aliase zusätzlich über den normalisierten Schlüssel
       erreichbar machen. Die Kaderdaten schreiben dasselbe Land je nach
       Quelle unterschiedlich („Côte d’Ivoire“, „Guinea-Bissau“); ohne
       Normalisierung würde der exakte Kleinbuchstaben-Schlüssel dann
       danebengreifen. */
    const COUNTRY_ALIASES_DE_LOOKUP = Object.create(null);
    Object.keys(COUNTRY_ALIASES_DE).forEach(name => {
        const key = normalizeCountryKey(name);
        if (key) COUNTRY_ALIASES_DE_LOOKUP[key] = COUNTRY_ALIASES_DE[name];
    });

    const COUNTRY_ALIAS_GROUP_LOOKUP = Object.create(null);
    const COUNTRY_CANONICAL_KEY_LOOKUP = Object.create(null);

    COUNTRY_ALIAS_GROUPS.forEach(group => {
        const normalizedGroup = group
            .map(name => String(name || '').trim())
            .filter(Boolean);
        const canonicalKey = normalizeCountryKey(normalizedGroup[0]);
        normalizedGroup.forEach(name => {
            const key = normalizeCountryKey(name);
            if (!key) return;
            COUNTRY_ALIAS_GROUP_LOOKUP[key] = normalizedGroup;
            COUNTRY_CANONICAL_KEY_LOOKUP[key] = canonicalKey;
        });
    });

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
        const exactKey = String(name).trim().toLowerCase();
        const normalizedKey = normalizeCountryKey(name);
        const aliases = [];

        function add(value) {
            if (!value) return;
            const text = String(value).trim();
            if (!text) return;
            if (!aliases.some(existing => normalizeCountryKey(existing) === normalizeCountryKey(text))) {
                aliases.push(text);
            }
        }

        const exactAliases = COUNTRY_ALIASES_DE[exactKey] || COUNTRY_ALIASES_DE_LOOKUP[normalizedKey];
        if (Array.isArray(exactAliases)) exactAliases.forEach(add);

        const groupAliases = COUNTRY_ALIAS_GROUP_LOOKUP[normalizedKey];
        if (Array.isArray(groupAliases)) {
            groupAliases.forEach(add);
            /* Auch die deutschen Aliase der ÜBRIGEN Schreibweisen mitnehmen.
               Sonst hängt das Ergebnis davon ab, welche Variante die
               Datenquelle liefert: „Ivory Coast“ führt zu „Elfenbeinküste“,
               „Côte d’Ivoire“ dagegen nur zu den Gruppen-Einträgen. */
            groupAliases.forEach(groupName => {
                const key = normalizeCountryKey(groupName);
                const deAliases = COUNTRY_ALIASES_DE_LOOKUP[key];
                if (Array.isArray(deAliases)) deAliases.forEach(add);
            });
        }

        return aliases;
    }

    function getCanonicalCountryKey(name) {
        const key = normalizeCountryKey(name);
        return COUNTRY_CANONICAL_KEY_LOOKUP[key] || key;
    }

    /**
     * Variante mit zusammengesetztem String – praktisch um die Aliase direkt
     * an einen vorhandenen Such-Index anzuhängen (z. B. searchKey).
     *
     * Es dürfen MEHRERE Namensfelder übergeben werden. Das ist für die CL
     * nötig: der Club-Remap in data.js legt dort den Klub in die primären
     * Felder (Nationalteam.*) und die Nation in die sekundären (Club.*) –
     * je nach Turnier steckt der Ländername also im einen oder im anderen
     * Feld. Für Klubnamen liefert die Tabelle nichts, der zusätzliche
     * Aufruf bleibt damit folgenlos.
     *
     * @param {...string} names
     * @returns {string} – Leerzeichen-getrennte Aliasliste (kann leer sein).
     */
    function getCountrySearchAliases(...names) {
        const aliases = [];
        names.forEach(name => {
            getCountryAliases(name).forEach(alias => {
                if (!aliases.includes(alias)) aliases.push(alias);
            });
        });
        return aliases.join(' ');
    }

    root.COUNTRY_ALIASES_DE = COUNTRY_ALIASES_DE;
    root.COUNTRY_ALIAS_GROUPS = COUNTRY_ALIAS_GROUPS;
    root.normalizeCountryKey = normalizeCountryKey;
    root.getCanonicalCountryKey = getCanonicalCountryKey;
    root.getCountryAliases = getCountryAliases;
    root.getCountrySearchAliases = getCountrySearchAliases;
})(typeof window !== 'undefined' ? window : globalThis);
