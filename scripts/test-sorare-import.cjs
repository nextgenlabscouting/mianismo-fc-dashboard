const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const start = html.indexOf("function importSorareCards(silent=false){");
const end = html.indexOf("\nasync function loadSorarePublicData(){", start);
assert.ok(start >= 0 && end > start, "La funzione importSorareCards deve esistere");
const functionSource = html.slice(start, end);

function makeHarness({ cards = [], items = [], liveSlug = "test-user", previousSlug = null, complete = true, authenticated = true } = {}) {
  const state = { cards: structuredClone(cards), sorareProfileSlug: previousSlug === null ? liveSlug : previousSlug, lineup: [] };
  const calls = { persisted: 0, toasts: [], renders: 0 };
  const importer = new Function(
    "state", "liveSorareItems", "liveSorareProfileSlug", "persist", "toast", "renderLineup", "liveSorareComplete", "isSorareAuthenticated",
    functionSource + "\nreturn importSorareCards;"
  )(
    state,
    items,
    liveSlug,
    () => { calls.persisted++; },
    message => calls.toasts.push(message),
    () => { calls.renders++; },
    complete,
    authenticated
  );
  return { state, calls, importer };
}

const newCard = {
  slug: "player-one-limited-2026",
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
  assert.equal(state.cards.length, 1, "Una carta nuova deve essere importata");
  assert.equal(state.cards[0].name, "Player One");
  assert.equal(state.cards[0].sorareSlug, newCard.slug);
  assert.equal(state.cards[0].source, "sorare");
  assert.equal(calls.persisted, 1);
  assert.equal(calls.renders, 1);
  assert.match(calls.toasts[0], /nuove: 1; aggiornate: 0/);
}

{
  const existing = {
    id: "sorare-player-one-limited-2026",
    slug: newCard.slug,
    sorareSlug: newCard.slug,
    name: "Old Player Name",
    club: "Old FC",
    position: "Difensore",
    source: "sorare"
  };
  const { state, calls, importer } = makeHarness({ cards: [existing], items: [{ ...newCard, name: "Player One Updated" }] });
  importer(false);
  assert.equal(state.cards.length, 1, "Una carta esistente va aggiornata, non duplicata");
  assert.equal(state.cards[0].name, "Player One Updated");
  assert.match(calls.toasts[0], /nuove: 0; aggiornate: 1/);
}

{
  const manual = { id: "manual-1", name: "Manual Player", source: "manual" };
  const oldSorare = { id: "old-sorare", slug: "old-card", sorareSlug: "old-card", name: "Old Account Card", source: "sorare" };
  const { state, importer } = makeHarness({
    cards: [manual, oldSorare],
    previousSlug: "old-user",
    liveSlug: "new-user",
    items: [newCard]
  });
  importer(true);
  assert.equal(state.sorareProfileSlug, "new-user");
  assert.equal(state.cards.some(card => card.id === "manual-1"), true, "Le carte manuali devono essere conservate nel cambio account");
  assert.equal(state.cards.some(card => card.id === "old-sorare"), false, "Le carte Sorare del vecchio account vanno isolate");
  assert.equal(state.cards.some(card => card.sorareSlug === newCard.slug), true);
}


{
  const manual = { id: "manual-keep", name: "Manual Keep", source: "manual" };
  const stale = { id: "sorare-stale", slug: "old-player-card", sorareSlug: "old-player-card", name: "Card no longer owned", source: "sorare" };
  const { state, importer } = makeHarness({ cards: [manual, stale], items: [newCard], previousSlug: "test-user", liveSlug: "test-user" });
  importer(true);
  assert.equal(state.cards.length, 2);
  assert.equal(state.cards.some(card => card.id === "manual-keep"), true);
  assert.equal(state.cards.some(card => card.id === "sorare-stale"), false);
  assert.equal(state.sorareInventoryStatus, "complete");
}
{
  const stale = { id: "sorare-stale", slug: "old-player-card", sorareSlug: "old-player-card", name: "Old card", source: "sorare" };
  const { state, calls, importer } = makeHarness({ cards: [stale], items: [newCard], complete: false });
  importer(true);
  assert.equal(state.cards.length, 1);
  assert.equal(calls.persisted, 0);
  assert.match(calls.toasts[0], /inventario completo/i);
}
{
  const stale = { id: "sorare-stale", slug: "old-player-card", sorareSlug: "old-player-card", name: "Old card", source: "sorare" };
  const { state, calls, importer } = makeHarness({ cards: [stale], items: [newCard], authenticated: false });
  importer(true);
  assert.equal(state.cards.length, 1);
  assert.equal(calls.persisted, 0);
}
{
  const stale = { id: "sorare-stale", slug: "old-player-card", sorareSlug: "old-player-card", name: "Old card", source: "sorare" };
  const { state, importer } = makeHarness({ cards: [stale], items: [], complete: true });
  importer(true);
  assert.equal(state.cards.length, 0);
  assert.equal(state.sorareInventoryStatus, "complete");
}

console.log("Sorare import regression tests passed (new/update, stale replacement, partial/auth guards, empty inventory, account isolation).");
