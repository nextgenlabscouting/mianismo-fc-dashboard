import assert from 'node:assert/strict';
import { fetchCardsViaProxy, cardQuality, isUsableInventory } from './sorare-public-sync.mjs';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

function card(slug) {
  return {
    slug,
    assetId: 'asset-' + slug,
    name: 'Player ' + slug,
    team: 'Test FC',
    activeTeam: 'Test FC',
    position: ['Midfielder'],
    rarity: 'Common',
    rarityTyped: 'common',
    playerImageUrl: 'https://assets.example/' + slug + '.png',
    imageUrl: null,
    skinEdition: { skin: 'STANDARD', skinName: 'Standard', variant: 'BASE', bonus: 1 },
    rawScores: [40, 50, 60, 45, 55],
    playerRawScores: [40, 50, 60, 45, 55],
    l5: 50,
    l10: 50,
    upcomingGames: []
  };
}

async function withFetch(mock, fn) {
  const original = global.fetch;
  global.fetch = mock;
  try { await fn(); } finally { global.fetch = original; }
}

async function testProxyPaginationAndDeduplication() {
  const requested = [];
  const result = await withFetch(async url => {
    const parsed = new URL(String(url));
    requested.push({ after: parsed.searchParams.get('after'), slug: parsed.searchParams.get('slug') });
    if (!parsed.searchParams.has('after')) {
      return response({ status: 'ok', queryTier: 'rich', items: [card('a'), card('b')], hasMore: true, endCursor: 'cursor-1', fetchedAt: '2026-10-28T10:00:00.000Z' });
    }
    assert.equal(parsed.searchParams.get('after'), 'cursor-1');
    return response({ status: 'ok', queryTier: 'rich', items: [card('b'), card('c')], hasMore: false, endCursor: 'cursor-2' });
  }, async () => {
    const value = await fetchCardsViaProxy({ slug: 'mianismo', baseUrl: 'https://example.test/api/cards', maxPages: 5 });
    assert.equal(value.items.length, 3);
    assert.deepEqual(value.items.map(item => item.slug), ['a', 'b', 'c']);
    assert.equal(value.pagesFetched, 2);
    assert.equal(value.queryTier, 'rich');
    assert.equal(value.truncated, false);
    assert.equal(value.sourceMode, 'vercel-api');
    assert.equal(requested.length, 2);
    assert.equal(requested[0].slug, 'mianismo');
  });
}

async function testCursorLoopIsRejected() {
  let calls = 0;
  await withFetch(async () => {
    calls++;
    return response({ status: 'ok', queryTier: 'rich', items: [card('loop-' + calls)], hasMore: true, endCursor: calls === 1 ? 'cursor-loop' : 'cursor-loop' });
  }, async () => {
    await assert.rejects(
      () => fetchCardsViaProxy({ baseUrl: 'https://example.test/api/cards', maxPages: 5 }),
      /Cursor Sorare ripetuto/
    );
    assert.equal(calls, 2);
  });
}

function testQualityGate() {
  const good = [card('one'), card('two'), card('three')];
  assert.equal(isUsableInventory(good), true);
  const slugOnly = ['one', 'two', 'three'].map(slug => ({
    slug, name: slug, assetId: null, team: null, activeTeam: null,
    position: [], rarity: 'Unknown', rarityTyped: null, imageUrl: null,
    playerImageUrl: null, rawScores: [], playerRawScores: [], upcomingGames: []
  }));
  assert.equal(isUsableInventory(slugOnly), false);
  const quality = cardQuality(good);
  assert.equal(quality.withResolvedNames, 3);
  assert.equal(quality.withUsefulData, 3);
  assert.equal(quality.withPlayerImage, 3);
}

await testProxyPaginationAndDeduplication();
await testCursorLoopIsRejected();
testQualityGate();
console.log('Sorare sync regression tests passed (3 suites).');
