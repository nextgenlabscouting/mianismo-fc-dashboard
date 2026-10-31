const assert = require("node:assert/strict");
const handler = require("../api/public/cards.js");
const { writeSession } = require("../lib/sorare-session.js");

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
  const originalSecret = process.env.SORARE_SESSION_SECRET;
  process.env.SORARE_API_KEY = "unit-test-key";
  process.env.SORARE_SESSION_SECRET = originalSecret || "nexus-api-test-session-secret-at-least-32-chars";
  const request = { ...req, headers: { ...(req.headers || {}) } };
  const skipSession = request.skipSession === true;
  delete request.skipSession;
  if (!request.headers.cookie && !skipSession) {
    const cookieRes = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      getHeader(name) { return this.headers[name]; }
    };
    writeSession(cookieRes, {
      authType: "jwt", accessToken: "test-account-token", jwtAud: "nexus-sorare-intelligence",
      expiresAt: Date.now() + 60 * 60 * 1000,
      profile: { slug: request.query?.slug || "mianismo", nickname: "API Test" }
    });
    request.headers.cookie = cookieRes.headers["Set-Cookie"].find(value => value.startsWith("nexus_sorare_session=")).split(";")[0];
  }
  global.fetch = fetchMock;
  try {
    const res = {
      headers: {},
      statusCode: 200,
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return body; }
    };
    await handler(request, res);
    return res;
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SORARE_API_KEY;
    else process.env.SORARE_API_KEY = originalKey;
    if (originalSecret === undefined) delete process.env.SORARE_SESSION_SECRET;
    else process.env.SORARE_SESSION_SECRET = originalSecret;
  }
}

function cardFixture(extra = {}) {
  return {
    slug: "test-player-2026-common",
    sport: "FOOTBALL",
    assetId: "asset-1",
    rarityTyped: "common",
    seasonYear: 2026,
    serialNumber: 42,
    anyPositions: ["Goalkeeper"],
    anyTeam: { name: "Test FC" },
    anyPlayer: { displayName: "Test Player", fullPictureUrl: "https://cdn.example/player.png", nextGame: { date: "2026-10-31T15:00:00Z", statusTyped: "scheduled", homeTeam: { name: "Test FC" }, awayTeam: { name: "Away FC" } } },
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
    assert.match(query, /cards\(after: \$cursor, sport: \$sport\)/);
    assert.equal(JSON.parse(options.body).variables.sport, "FOOTBALL");
    assert.doesNotMatch(query, /cards\(first:/);
    if (query.includes("rawPlayerGameScores")) {
      return response(422, { errors: [{ message: "Unsupported optional player scores field" }] });
    }
    return response(200, sorareData(cardFixture()));
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, "ok");
  assert.equal(res.body.sport, "football");
  assert.equal(res.body.items[0].sport, "football");
  assert.equal(res.body.queryTier, "card-details-with-fixtures");
  assert.equal(res.body.items[0].name, "Test Player");
  assert.equal(res.body.items[0].imageUrl, "https://cdn.example/card.png");
  assert.equal(res.body.items[0].skinEdition.skinName, "Shiny");
  assert.equal(res.body.items[0].rawScores.length, 5);
  assert.equal(res.body.items[0].l5, 50);
  assert.equal(res.body.items[0].upcomingGames.length, 1);
  assert.equal(res.body.items[0].upcomingGames[0].awayTeam, "Away FC");
  assert.equal(res.body.dataQuality.withVariant, 1);
  assert.equal(res.body.dataQuality.withUpcomingGames, 1);
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

async function testSeparateNbaSportQuery() {
  let variables = null;
  const res = await callHandler(async (_url, options) => {
    const body = JSON.parse(options.body);
    variables = body.variables;
    assert.match(body.query, /sport: \$sport/);
    return response(200, sorareData(cardFixture({
      slug: "nba-player-2026-common",
      sport: "NBA",
      anyPositions: ["Guard"],
      anyTeam: { name: "Boston Celtics" },
      anyPlayer: { displayName: "NBA Player" }
    })));
  }, { method: "GET", query: { slug: "mianismo", sport: "NBA" } });
  assert.equal(variables.sport, "NBA", "La richiesta NBA deve essere separata dalla richiesta Football");
  assert.equal(res.body.sport, "nba");
  assert.equal(res.body.items[0].sport, "nba");
  assert.equal(res.body.items[0].name, "NBA Player");
}

async function testInvalidSportRejected() {
  let fetched = false;
  const res = await callHandler(async () => {
    fetched = true;
    throw new Error("Invalid sports must be rejected before Sorare is called");
  }, { method: "GET", query: { slug: "mianismo", sport: "BASEBALL" } });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /football or nba/i);
  assert.equal(fetched, false);
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

async function testAuthenticatedSlugCannotBeOverridden() {
  const oldSecret = process.env.SORARE_SESSION_SECRET;
  process.env.SORARE_SESSION_SECRET = "nexus-test-secret-at-least-32-characters-long";
  try {
    const cookieRes = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, getHeader(name) { return this.headers[name]; } };
    writeSession(cookieRes, {
      authType: "jwt", accessToken: "test-account-token", jwtAud: "nexus-sorare-intelligence",
      expiresAt: Date.now() + 60 * 60 * 1000, profile: { slug: "real-account", nickname: "Real Account" }
    });
    const cookiePair = cookieRes.headers["Set-Cookie"].find(value => value.startsWith("nexus_sorare_session=")).split(";")[0];
    let requestedSlug = null;
    const res = await callHandler(async (_url, options) => {
      requestedSlug = JSON.parse(options.body).variables.slug;
      return response(200, sorareData(cardFixture()));
    }, { method: "GET", query: { slug: "wrong-public-account" }, headers: { cookie: cookiePair } });
    assert.equal(res.statusCode, 200);
    assert.equal(requestedSlug, "real-account");
    assert.equal(res.body.profileSlug, "real-account");
    assert.equal(res.body.authenticated, true);
  } finally {
    if (oldSecret === undefined) delete process.env.SORARE_SESSION_SECRET;
    else process.env.SORARE_SESSION_SECRET = oldSecret;
  }
}


async function testUnauthenticatedRequestsCannotReadPublicFallback() {
  let fetched = false;
  const res = await callHandler(async () => {
    fetched = true;
    throw new Error("Sorare must not be contacted without a session");
  }, { method: "GET", query: { slug: "mianismo" }, skipSession: true });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.status, "not_authenticated");
  assert.equal(res.body.authenticated, false);
  assert.equal(fetched, false, "No account inventory query may run without a Sorare session");
}

(async () => {
  await testUnauthenticatedRequestsCannotReadPublicFallback();
  await testVariantQueryFallback();
  await testStandardFallbackWhenOptionalFieldsFail();
  await testSeparateNbaSportQuery();
  await testInvalidSportRejected();
  await testCursorAndMethodValidation();
  await testAuthenticatedSlugCannotBeOverridden();
  console.log("Sorare cards API tests passed (separate Football/NBA queries, sport isolation and authenticated account identity).");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
