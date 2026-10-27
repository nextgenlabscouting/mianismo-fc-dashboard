const assert = require("node:assert/strict");
const handler = require("../api/public/cards.js");

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

function sorareData(card, endCursor = null) {
  return {
    data: {
      user: {
        cards: {
          nodes: [card],
          pageInfo: { endCursor }
        }
      }
    }
  };
}

async function callHandler(fetchMock, req = { method: "GET", query: { slug: "mianismo" } }) {
  const originalFetch = global.fetch;
  const originalKey = process.env.SORARE_API_KEY;
  global.fetch = fetchMock;
  process.env.SORARE_API_KEY = "unit-test-key";
  try {
    const res = {
      headers: {},
      statusCode: 200,
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return body; }
    };
    await handler(req, res);
    return res;
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SORARE_API_KEY;
    else process.env.SORARE_API_KEY = originalKey;
  }
}

function cardFixture(extra = {}) {
  return {
    slug: "test-player-2026-common",
    assetId: "asset-1",
    rarityTyped: "common",
    seasonYear: 2026,
    serialNumber: 42,
    anyPositions: ["Goalkeeper"],
    anyTeam: { name: "Test FC" },
    anyPlayer: { displayName: "Test Player", fullPictureUrl: "https://cdn.example/player.png" },
    pictureUrl: "https://cdn.example/card.png",
    skinEdition: { skin: "shiny", skinName: "Shiny", variant: "SHINY", variantName: "Shiny", bonus: 1 },
    rawSo5Scores: [50, 60, 40, 55, 45],
    ...extra
  };
}

async function testVariantQueryFallback() {
  let calls = 0;
  const res = await callHandler(async (_url, options) => {
    calls++;
    const query = JSON.parse(options.body).query;
    assert.match(query, /cards\(after: \$cursor\)/);
    assert.doesNotMatch(query, /cards\(first:/);
    if (query.includes("rawPlayerGameScores")) {
      return response(422, { errors: [{ message: "Unsupported optional player scores field" }] });
    }
    return response(200, sorareData(cardFixture()));
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, "ok");
  assert.equal(res.body.queryTier, "card-details");
  assert.equal(res.body.items[0].name, "Test Player");
  assert.equal(res.body.items[0].imageUrl, "https://cdn.example/card.png");
  assert.equal(res.body.items[0].skinEdition.skinName, "Shiny");
  assert.equal(res.body.dataQuality.withVariant, 1);
  assert.equal(calls, 2);
}

async function testStandardFallbackWhenOptionalFieldsFail() {
  const unsupported = ["rawPlayerGameScores", "skinEdition", "cardEditionName", "rawSo5Scores", "pictureUrl("];
  const res = await callHandler(async (_url, options) => {
    const query = JSON.parse(options.body).query;
    const field = unsupported.find(name => query.includes(name));
    if (field) return response(422, { errors: [{ message: "Unsupported field: " + field }] });
    return response(200, sorareData({
      slug: "standard-player-2026-common",
      assetId: "asset-2",
      rarityTyped: "common",
      anyPositions: ["Defender"],
      anyTeam: { name: "Fallback FC" },
      anyPlayer: { displayName: "Fallback Player" }
    }));
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.queryTier, "standard");
  assert.equal(res.body.items[0].name, "Fallback Player");
  assert.equal(res.body.items[0].imageUrl, null);
  assert.ok(res.body.diagnostic.attemptedFallbacks >= 5);
}

async function testCursorAndMethodValidation() {
  const page = await callHandler(async () => response(200, sorareData(cardFixture(), "cursor-1")));
  assert.equal(page.statusCode, 200);
  assert.equal(page.body.hasMore, true);
  assert.equal(page.body.endCursor, "cursor-1");

  const method = await callHandler(async () => {
    throw new Error("Fetch must not be called for POST");
  }, { method: "POST", query: { slug: "mianismo" } });
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.Allow, "GET");
}

(async () => {
  await testVariantQueryFallback();
  await testStandardFallbackWhenOptionalFieldsFail();
  await testCursorAndMethodValidation();
  console.log("Sorare cards API tests passed (3 suites).");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
