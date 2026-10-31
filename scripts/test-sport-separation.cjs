const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const api = fs.readFileSync(path.join(__dirname, "..", "api", "public", "cards.js"), "utf8");
const match = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].find(item => item[1].trim());
assert.ok(match, "Lo script NEXUS deve essere presente");
const script = match[1];

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "Blocco non trovato: " + startMarker);
  return source.slice(start, end);
}

const normalizeSource = extract(script, "function normalizeSport(value){", "\nfunction detectCardSport");
const detectSource = extract(script, "function detectCardSport(card,fallback='unclassified'){", "\nconst DIVINATION_PREVIOUS_SNAPSHOT");
const helpers = new Function(normalizeSource + "\n" + detectSource + "\nreturn {normalizeSport,detectCardSport};")();

assert.equal(helpers.normalizeSport("FOOTBALL"), "football");
assert.equal(helpers.normalizeSport("soccer"), "football");
assert.equal(helpers.normalizeSport("NBA"), "nba");
assert.equal(helpers.normalizeSport("basketball"), "nba");
assert.equal(helpers.normalizeSport("BASEBALL"), "");

assert.equal(helpers.detectCardSport({ sport: "NBA", position: ["Defender"] }), "nba", "Lo sport esplicito prevale su ruoli testuali ambigui");
assert.equal(helpers.detectCardSport({ sport: "FOOTBALL", position: ["Guard"] }), "football", "Una carta Football esplicita non viene spostata nel basket");
assert.equal(helpers.detectCardSport({ position: ["Point Guard"] }), "nba", "Le vecchie carte NBA sono riconosciute dal ruolo");
assert.equal(helpers.detectCardSport({ position: ["Shooting Guard"] }), "nba");
assert.equal(helpers.detectCardSport({ position: ["Center"] }), "nba");
assert.equal(helpers.detectCardSport({ position: ["Goalkeeper"] }), "football");
assert.equal(helpers.detectCardSport({ position: ["Midfielder"] }), "football");
assert.equal(helpers.detectCardSport({ source: "manual", position: ["Difensore"] }), "football", "Le vecchie carte manuali di calcio restano nel Football");
assert.equal(helpers.detectCardSport({ source: "manual", position: ["Guard"] }), "nba", "Le carte manuali NBA possono essere classificate dal ruolo");
assert.equal(helpers.detectCardSport({ source: "sorare", position: ["Unknown role"] }), "unclassified", "Una carta incerta non viene assegnata arbitrariamente");

const archiveSource = [
  "function footballCards(){return (Array.isArray(state.cards)?state.cards:[]).filter(card=>normalizeSport(card?.sport)==='football'&&!isEndedHyperGlitch(card));}",
  "function basketballCards(){return (Array.isArray(state.nbaCards)?state.nbaCards:[]).filter(card=>normalizeSport(card?.sport)==='nba');}",
  "function collectionCards(){const sport=state.activeSport==='nba'?'nba':'football';return sport==='nba'?basketballCards():footballCards();}"
].join("\n");
const archives = new Function("state", "normalizeSport", "isEndedHyperGlitch", archiveSource + "\nreturn {footballCards,basketballCards,collectionCards};")(
  {
    activeSport: "football",
    cards: [{ id: "f1", sport: "football" }, { id: "wrong-in-football", sport: "nba" }],
    nbaCards: [{ id: "n1", sport: "nba" }, { id: "wrong-in-nba", sport: "football" }]
  },
  helpers.normalizeSport,
  () => false
);
assert.deepEqual(archives.collectionCards().map(card => card.id), ["f1"], "Il workspace Football non deve leggere carte NBA");
assert.deepEqual(archives.basketballCards().map(card => card.id), ["n1"], "L'archivio NBA deve contenere solo NBA");
archives.collectionCards();
const nbaState = { activeSport: "nba", cards: [{ id: "f1", sport: "football" }], nbaCards: [{ id: "n1", sport: "nba" }] };
const nbaArchives = new Function("state", "normalizeSport", "isEndedHyperGlitch", archiveSource + "\nreturn collectionCards();")(nbaState, helpers.normalizeSport, () => false);
assert.deepEqual(nbaArchives.map(card => card.id), ["n1"], "Il workspace NBA non deve leggere carte Football");

assert.match(script, /function footballCards\(\)/, "Deve esistere un archivio Football dedicato");
assert.match(script, /function basketballCards\(\)/, "Deve esistere un archivio NBA dedicato");
assert.match(script, /function collectionCards\(\).*state\.activeSport/s, "Le viste devono leggere lo sport selezionato");
assert.match(script, /const allCards=footballCards\(\),targetCards=allCards\.filter\(isTargetSetCard\)/, "L'ottimizzatore formazione calcio usa soltanto Football");
assert.match(script, /const availableCards=footballCards\(\),slots=\$\('lineupSlots'\)/, "Gli slot calcio non possono selezionare carte NBA");
assert.match(script, /const slot=lineupPickerSlot,role=.*all=footballCards\(\)/s, "Anche il selettore del Lineup Lab è solo Football");
assert.match(script, /state\.nbaCards=nba\.cards/, "L'importazione NBA salva nell'archivio NBA");
assert.match(script, /state\.cards=football\.cards/, "L'importazione Football salva nell'archivio Football");
assert.match(script, /function findStoredCard\(id\)/, "La modifica manuale individua la carta in entrambi gli archivi");
assert.match(html, /id="sportModeFootball"/, "Serve il selettore Football");
assert.match(html, /id="sportModeNBA"/, "Serve il selettore NBA");
assert.match(html, /id="playerSport"/, "La nuova carta deve indicare esplicitamente lo sport");
assert.match(script, /function fetchSorareSportInventory\(slug,sport\)/, "Sorare deve avere un fetch per sport");
assert.match(script, /fetchSorareSportInventory\(activeSorareSlug,'football'\)/, "La sincronizzazione deve leggere Football separatamente");
assert.match(script, /fetchSorareSportInventory\(activeSorareSlug,'nba'\)/, "La sincronizzazione deve leggere NBA separatamente");
assert.match(script, /if\(bothComplete\)importSorareCards\(true\)/, "Un inventario incompleto non deve sostituire l'archivio locale");
assert.match(api, /cards\(after: \$cursor, sport: \$sport\)/, "La query Sorare deve filtrare lo sport sul server");
assert.match(api, /sport: sport\.toLowerCase\(\)/, "L'endpoint deve restituire lo sport richiesto");

console.log("NEXUS sport separation tests passed (classification, quarantine, archive isolation, football lineup guard and dual Sorare sync).");
