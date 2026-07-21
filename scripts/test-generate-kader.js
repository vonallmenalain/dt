'use strict';

// Unit-Tests für die reine Mapping-Logik von generate-kader.js
// (Anzeigename + Nationenflagge). Kein Netzwerk – prüft nur die
// Transformation eines API-Football-Player-Objekts in unser Schema.

const assert = require('node:assert/strict');
const {
  buildRecord,
  playerDisplayName,
  resolveNationFlag,
  normalizeCountryName,
  FLAG_BASE
} = require('./generate-kader.js');

// /countries-Flaggenkarte (Schlüssel bereits normalisiert), wie sie
// fetchCountryFlagMap aufbaut.
const flagMap = new Map([
  ['spain', `${FLAG_BASE}/es.svg`],
  ['brazil', `${FLAG_BASE}/br.svg`],
  ['morocco', `${FLAG_BASE}/ma.svg`],
  ['england', `${FLAG_BASE}/gb-eng.svg`]
]);

function stat(teamName, teamLogo, position) {
  return { team: { id: 1, name: teamName, logo: teamLogo }, games: { position } };
}

// ── Anzeigename: kurzer API-`name` bevorzugt ────────────────────────────
(function testDisplayName() {
  assert.equal(
    playerDisplayName({ name: 'Lamine Yamal', firstname: 'Lamine', lastname: 'Yamal Nasraoui Ebana' }),
    'Lamine Yamal'
  );
  assert.equal(
    playerDisplayName({ name: 'Vinícius Júnior', firstname: 'Vinícius José Paixão de Oliveira', lastname: 'Júnior' }),
    'Vinícius Júnior'
  );
  assert.equal(
    playerDisplayName({ name: 'Achraf Hakimi', firstname: 'Achraf', lastname: 'Hakimi Mouh' }),
    'Achraf Hakimi'
  );
  // Fallback auf firstname+lastname, wenn kein `name` da ist.
  assert.equal(
    playerDisplayName({ name: '', firstname: 'Max', lastname: 'Muster' }),
    'Max Muster'
  );
  console.log('ok - display name prefers common API name');
})();

// ── Nationenflagge: /countries-Treffer, Alias, unmatched ────────────────
(function testNationFlag() {
  // Direkter Treffer in der /countries-Map.
  assert.equal(resolveNationFlag('Spain', flagMap), `${FLAG_BASE}/es.svg`);
  // Diakritika/Variante über Normalisierung.
  assert.equal(resolveNationFlag('Türkiye', flagMap), `${FLAG_BASE}/tr.svg`); // via Alias
  assert.equal(resolveNationFlag("Côte d'Ivoire", flagMap), `${FLAG_BASE}/ci.svg`); // via Alias
  assert.equal(resolveNationFlag('Czechia', flagMap), `${FLAG_BASE}/cz.svg`); // via Alias
  assert.equal(resolveNationFlag('Korea Republic', flagMap), `${FLAG_BASE}/kr.svg`); // via Alias
  // Nicht auflösbar → leer + in unmatched vermerkt.
  const unmatched = new Set();
  assert.equal(resolveNationFlag('Neverland', flagMap, unmatched), '');
  assert.ok(unmatched.has('Neverland'));
  // Leere Nationalität → leer, kein Eintrag.
  assert.equal(resolveNationFlag('', flagMap), '');
  console.log('ok - nation flag resolves via /countries, alias, and reports gaps');
})();

// ── normalizeCountryName ────────────────────────────────────────────────
(function testNormalize() {
  assert.equal(normalizeCountryName('Bosnia and Herzegovina'), 'bosniaandherzegovina');
  assert.equal(normalizeCountryName('Bosnia-and-Herzegovina'), 'bosniaandherzegovina');
  assert.equal(normalizeCountryName("Côte d'Ivoire"), 'cotedivoire');
  console.log('ok - country name normalization strips spaces/diacritics/punctuation');
})();

// ── buildRecord: vollständiger club-zentrierter Datensatz ───────────────
(function testBuildRecord() {
  const rec = buildRecord(
    {
      id: 42, name: 'Lamine Yamal', firstname: 'Lamine', lastname: 'Yamal Nasraoui Ebana',
      photo: 'https://x/42.png', nationality: 'Spain',
      birth: { date: '2007-07-13' }, height: '179 cm', weight: '72 kg'
    },
    stat('Barcelona', 'https://x/barca.png', 'Midfielder'),
    flagMap
  );
  assert.equal(rec['Spielername'], 'Lamine Yamal');
  assert.equal(rec['Position'], 'MIDFIELDER');
  assert.equal(rec['Club.name'], 'Barcelona');           // primär: Verein
  assert.equal(rec['Club.logo'], 'https://x/barca.png');
  assert.equal(rec['Nationalteam.name'], 'Spain');       // sekundär: Nation
  assert.equal(rec['Nationalteam.logo'], `${FLAG_BASE}/es.svg`); // Flagge gesetzt!
  assert.equal(rec['Groesse'], '179');
  assert.equal(rec['Gewicht'], '72');
  console.log('ok - buildRecord produces club-primary record with nation flag');
})();

console.log('generate-kader tests passed');
