const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const start = html.indexOf("function importSorareCards(silent=false){");
const end = html.indexOf("async function loadSorarePublicData(){", start);
assert.ok(start >= 0 && end > start, "La funzione importSorareCards deve esistere");
const functionSource = html.slice(start, end);
const detectorStart = html.indexOf("function isEndedHyperGlitch(card){");
const detectorEnd = html.indexOf("\nfunction currentTargetSet()", detectorStart);
assert.ok(detectorStart >= 0 && detectorEnd > detectorStart, "Il filtro Set deve esistere");
const detectorSource = html.slice(detectorStart, detectorEnd);
const isEndedHyperGlitch = new Function(detectorSource + "\nreturn isEndedHyperGlitch;")();
const sportSource = html.slice(html.indexOf("function normalizeSport(value){"), html.indexOf("\nconst DIVINATION_PREVIOUS_SNAPSHOT"));
const { normalizeSport } = new Function(sportSource + "\nreturn {normalizeSport};")();

function makeHarness({ cards = [], nbaCards = [], unclassifiedCards = [], items = [], nbaItems = [], liveSlug = "test-user", previousSlug = null, complete = true, authenticated = true } = {}) {
  const state = {
    cards: structuredClone(cards),
    nbaCards: structuredClone(nbaCards),
    unclassifiedCards: structuredClone(unclassifiedCards),
    sorareProfileSlug: previousSlug === null ? liveSlug : previousSlug,
    lineup: [],
    nbaLineup: [],
    sorareInventoryStatus: "stale"
  };
  const calls = { persisted: 0, toasts: [], renders: 0 };
  const importer = new Function(
    "state", "liveSorareFootballItems", "liveSorareNbaItems", "liveSorareProfileSlug",
    "persist", "toast", "renderLineup", "liveSorareComplete", "isSorareAuthenticated",
    "isEndedHyperGlitch", "normalizeSport",
    functionSource + "\nreturn importSorareCards;"
  )(
    state,
    items,
    nbaItems,
    liveSlug,
    () => { calls.persisted++; },
    message => calls.toasts.push(message),
    () => { calls.renders++; },
    complete,
    authenticated,
    isEndedHyperGlitch,
    normalizeSport
  );
  return { state, calls, importer };
}

const newCard = {
  slug: "player-one-limited-2026",
  sport: "football",
  assetId: "asset-1",
  name: "Player One",
  team: "Test FC",
  position: ["Defender"],
  rarity: "Limited",
  rarityTyped: "limited",
  l5: 60,
  l10: 55,
  l15: 50,
  rawScores: [50, 60, 70],
  playerRawScores: [50, 60, 70],
  skinEdition: null
};

{
  const { state, calls, importer } = makeHarness({ items: [newCard] });
  importer(false);
  assert.equal(state.cards.length, 1, "Una carta nuova Football deve essere importata");
  assert.equal(state.cards[0].name, "Player One");
  assert.equal(state.cards[0].sport, "football");
  assert.equal(state.cards[0].sorareSlug, newCard.slug);
  assert.equal(state.cards[0].source, "sorare");
  assert.equal(state.nbaCards.length, 0, "Una carta Football non deve finire nell'archivio NBA");
  assert.equal(calls.persisted, 1);
  assert.equal(calls.renders, 1);
  assert.match(calls.toasts[0], /Football 1 · NBA 0/);
}

{
  const existing = {
    id: "sorare-player-one-limited-2026",
    slug: newCard.slug,
    sorareSlug: newCard.slug,
    name: "Old Player Name",
    club: "Old FC",
    position: "Difensore",
    sport: "football",
    source: "sorare"
  };
  const { state, calls, importer } = makeHarness({ cards: [existing], items: [{ ...newCard, name: "Player One Updated" }] });
  importer(false);
  assert.equal(state.cards.length, 1, "Una carta esistente va aggiornata, non duplicata");
  assert.equal(state.cards[0].name, "Player One Updated");
  assert.match(calls.toasts[0], /Football 1 · NBA 0/);
}

{
  const nbaCard = {
    ...newCard,
    slug: "nba-player-limited-2026",
    sport: "nba",
    name: "NBA Player",
    team: "Boston Celtics",
    position: ["Guard"],
    l5: 42,
    l10: 40
  };
  const { state, importer } = makeHarness({ items: [newCard], nbaItems: [nbaCard] });
  importer(true);
  assert.equal(state.cards.length, 1);
  assert.equal(state.cards[0].name, "Player One");
  assert.equal(state.cards[0].sport, "football");
  assert.equal(state.nbaCards.length, 1);
  assert.equal(state.nbaCards[0].name, "NBA Player");
  assert.equal(state.nbaCards[0].sport, "nba");
  assert.equal(state.nbaCards[0].league, "NBA");
}

{
  const nbaCard = { ...newCard, slug: "nba-only", sport: "nba", name: "NBA Only", position: ["Guard"] };
  const { state, importer } = makeHarness({ items: [nbaCard] });
  importer(true);
  assert.equal(state.cards.length, 0, "Un record NBA arrivato nella richiesta Football deve essere rifiutato");
  assert.equal(state.nbaCards.length, 0, "Il mismatch non deve spostare automaticamente la carta in NBA");
}

{
  const manual = { id: "manual-1", name: "Manual Player", sport: "football", source: "manual" };
  const manualNba = { id: "manual-nba", name: "Manual NBA Player", sport: "nba", source: "manual" };
  const oldSorare = { id: "old-sorare", slug: "old-card", sorareSlug: "old-card", name: "Old Account Card", sport: "football", source: "sorare" };
  const oldNba = { id: "old-nba", slug: "old-nba-card", sorareSlug: "old-nba-card", name: "Old NBA Card", sport: "nba", source: "sorare" };
  const { state, importer } = makeHarness({
    cards: [manual, oldSorare],
    nbaCards: [manualNba, oldNba],
    previousSlug: "old-user",
    liveSlug: "new-user",
    items: [newCard]
  });
  importer(true);
  assert.equal(state.sorareProfileSlug, "new-user");
  assert.equal(state.cards.some(card => card.id === "manual-1"), true, "Le carte manuali Football restano");
  assert.equal(state.cards.some(card => card.id === "old-sorare"), false, "Le carte Football del vecchio account vengono rimosse");
  assert.equal(state.nbaCards.some(card => card.id === "manual-nba"), true, "Le carte NBA manuali restano");
  assert.equal(state.nbaCards.some(card => card.id === "old-nba"), false, "Le carte NBA Sorare del vecchio account vengono rimosse");
}

{
  const manual = { id: "manual-keep", name: "Manual Keep", sport: "football", source: "manual" };
  const manualNba = { id: "nba-manual", name: "NBA Manual", sport: "nba", source: "manual" };
  const stale = { id: "sorare-stale", slug: "old-player-card", sorareSlug: "old-player-card", name: "Card no longer owned", sport: "football", source: "sorare" };
  const { state, importer } = makeHarness({ cards: [manual, stale], nbaCards: [manualNba], items: [newCard], previousSlug: "test-user", liveSlug: "test-user" });
  importer(true);
  assert.equal(state.cards.length, 2, "La carta Football obsoleta viene rimossa e quella manuale conservata");
  assert.equal(state.nbaCards.length, 1, "L'archivio NBA non viene modificato da una lettura Football senza carte NBA nuove solo se le carte NBA sono manuali");
  assert.equal(state.cards.some(card => card.id === "manual-keep"), true);
  assert.equal(state.cards.some(card => card.id === "sorare-stale"), false);
  assert.equal(state.sorareInventoryStatus, "complete");
}

{
  const stale = { id: "sorare-stale", slug: "old-player-card", sorareSlug: "old-player-card", name: "Old card", sport: "football", source: "sorare" };
  const { state, calls, importer } = makeHarness({ cards: [stale], items: [newCard], complete: false });
  importer(true);
  assert.equal(state.cards.length, 1);
  assert.equal(calls.persisted, 0);
}

{
  const storedHyperglitch = {
    id: "old-hyperglitch", slug: "legacy-card", sorareSlug: "legacy-card",
    name: "Legacy player", source: "sorare", sport: "football", setName: "HyperGlitch"
  };
  const manualHyperglitch = {
    id: "manual-hyperglitch", name: "Legacy manual", source: "manual", sport: "football",
    edition: "HyperGlitch Limited"
  };
  const incomingHyperglitch = {
    ...newCard, slug: "glitch_standard_player", name: "Legacy player",
    set: { name: "HyperGlitch", slug: "hyperglitch" }, setName: "HyperGlitch", edition: "Glitch Standard"
  };
  const { state, importer } = makeHarness({
    cards: [storedHyperglitch, manualHyperglitch],
    items: [newCard, incomingHyperglitch]
  });
  importer(true);
  assert.equal(state.cards.length, 1, "Le carte Hyperglitch sono escluse dal solo archivio Football");
  assert.equal(state.cards[0].slug, newCard.slug);
}

{
  const divinationCard = {
    ...newCard,
    slug: "divination-glitch-standard-asset",
    name: "Divination Player",
    edition: "Glitch Limited",
    specialEdition: "Glitch Special",
    skinEdition: { skin: "glitch", skinName: "Glitch", variant: "glitch_standard", variantName: "Glitch Standard" },
    set: { name: "Divination", slug: "divination" },
    setName: "Divination"
  };
  const explicitHyperglitch = {
    ...newCard,
    slug: "player-hyperglitch-limited",
    name: "Old Hyperglitch Player",
    set: { name: "HyperGlitch", slug: "hyperglitch" },
    setName: "HyperGlitch"
  };
  assert.equal(isEndedHyperGlitch(divinationCard), false, "Una carta Divination non deve essere classificata Hyperglitch per edition, slug o skin");
  assert.equal(isEndedHyperGlitch(explicitHyperglitch), true, "Una carta con Set HyperGlitch esplicito deve essere esclusa");
  const { state, importer } = makeHarness({ items: [divinationCard, explicitHyperglitch] });
  importer(true);
  assert.equal(state.cards.length, 1, "L'importazione deve conservare Divination ed escludere HyperGlitch");
  assert.equal(state.cards[0].setName, "Divination");
  assert.equal(state.cards[0].name, "Divination Player");
}

console.log("Sorare import regression tests passed (separate sport archives, new/update, account isolation, Hyperglitch purge, Divination preservation).");
