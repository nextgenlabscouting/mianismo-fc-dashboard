const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const scriptMatch = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].find(match => match[1].trim());
assert.ok(scriptMatch, "Lo script principale NEXUS deve esistere");
const script = scriptMatch[1];

function extract(startMarker, endMarker) {
  const start = script.indexOf(startMarker);
  const end = script.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "Funzione non trovata: " + startMarker);
  return script.slice(start, end);
}

const searchSource = extract("function searchLineupCombinations(roleLists,options={}){", "\nfunction nextLineupFixture");
const fixtureSource = extract("function nextLineupFixture(card,now=Date.now()){", "\nfunction lineupFixtureText");
const engine = new Function(searchSource + "\n" + fixtureSource + "\nreturn {searchLineupCombinations,nextLineupFixture};")();

function candidate(id, role, expected, identity = id, l10 = 40, sd = 4) {
  return {
    identity,
    card: { id, name: id, playerSlug: identity, activeTeam: "Test FC" },
    stats: { expected, sd, capL10: l10 },
    kinds: [role]
  };
}

const roles = [
  [candidate("gk-best", "GK", 58), candidate("gk-alt", "GK", 54)],
  [candidate("df-best", "DF", 62), candidate("df-alt", "DF", 55)],
  [candidate("md-best", "MD", 64), candidate("md-alt", "MD", 58)],
  [candidate("fw-best", "FW", 66), candidate("fw-alt", "FW", 60)],
  [
    candidate("flex-duplicate", "DF", 99, "gk-best"),
    candidate("flex-best", "MD", 52),
    candidate("flex-alt", "FW", 48)
  ]
];

const best = engine.searchLineupCombinations(roles, { target: 300, limit: 3 });
assert.equal(best.length, 3, "Il motore deve restituire la prima scelta e fino a due alternative");
assert.equal(best[0].projected, 345, "La prima formazione deve massimizzare il punteggio atteso senza duplicare lo stesso giocatore");
assert.equal(best[0].targetIndex > 50, true, "Il motore deve calcolare un indice indicativo rispetto al target");
for (const option of best) {
  assert.equal(option.team.length, 5, "Ogni formazione deve contenere cinque carte");
  const identities = option.team.map(item => item.identity);
  assert.equal(new Set(identities).size, 5, "Un giocatore non può comparire in due slot");
  if (option.team.some(item => item.card.id === "flex-duplicate")) {
    assert.equal(option.team.some(item => item.card.id === "gk-best"), false, "La carta extra che rappresenta il portiere migliore non può convivere con la stessa carta in un altro slot");
  }
}
assert.equal(new Set(best.map(option => option.team.map(item => item.card.id).sort().join("|"))).size, best.length, "Le alternative devono essere formazioni distinte");

const capped = engine.searchLineupCombinations(roles, { target: 300, capEnabled: true, cap: 160, limit: 3 });
assert.equal(capped.length, 3, "Il cap facoltativo deve permettere le formazioni entro soglia");
assert.equal(capped[0].capUsed, 160, "Il cap test deve corrispondere ai quattro L10 più bassi");
const tooStrict = engine.searchLineupCombinations(roles, { target: 300, capEnabled: true, cap: 159, limit: 3 });
assert.equal(tooStrict.length, 0, "Il cap deve bloccare le formazioni oltre soglia");

const withoutL10 = roles.map(list => list.map(item => ({ ...item, stats: { ...item.stats, capL10: null } })));
assert.equal(engine.searchLineupCombinations(withoutL10, { target: 300, capEnabled: false, limit: 1 }).length, 1, "Senza cap L10, carte prive di L10 non devono essere escluse");
assert.equal(engine.searchLineupCombinations(withoutL10, { target: 300, capEnabled: true, cap: 500, limit: 1 }).length, 0, "Con cap attivo, una carta senza L10 non è verificabile");

const now = Date.now();
const validGame = { date: new Date(now + 2 * 60 * 60 * 1000).toISOString(), status: "SCHEDULED" };
const staleGame = { date: new Date(now - 2 * 60 * 60 * 1000).toISOString(), status: "FINISHED" };
assert.equal(engine.nextLineupFixture({ upcomingGames: [staleGame, validGame] }, now).game, validGame, "Il motore deve selezionare la prossima partita futura");
assert.equal(engine.nextLineupFixture({ upcomingGames: [staleGame] }, now), null, "Le partite concluse non devono essere considerate future");

console.log("NEXUS Smart Lineup tests passed (target ranking, alternatives, duplicate players, optional L10 cap, fixture timing).");
