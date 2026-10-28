const assert = require("node:assert/strict");
const passwordHandler = require("../api/auth/sorare/password.js");
const saltHandler = require("../api/auth/sorare/salt.js");
const sessionHandler = require("../api/auth/sorare/session.js");
const logoutHandler = require("../api/auth/sorare/logout.js");
const cardsHandler = require("../api/public/cards.js");
const { getValidSession } = require("../lib/sorare-session.js");

process.env.SORARE_SESSION_SECRET = "test-only-nexus-session-secret-32-chars-minimum";
delete process.env.SORARE_API_KEY;

function response(status, body) {
  const serialized = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => serialized
  };
}

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    getHeader(name) { return this.headers[name]; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    end() { this.ended = true; return this; }
  };
}

async function invoke(handler, req, fetchMock) {
  const oldFetch = global.fetch;
  global.fetch = fetchMock || oldFetch;
  const res = createRes();
  try {
    await handler(req, res);
    return res;
  } finally {
    global.fetch = oldFetch;
  }
}

function req(method, body = {}, headers = {}, query = {}) {
  return { method, body, headers, query };
}

const HASHED_PASSWORD = "$2a$11$abcdefghijklmnopqrstuuuuuuuuuuuuuuuuuuuuuuu";
const TEST_EMAIL = "tester@example.com";
const EXPIRY = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const FIXED_TOKEN = "test-jwt-secret-value-not-for-production";

function signInBody(result) {
  return { data: { signIn: result } };
}

async function testSaltEndpoint() {
  const badMethod = await invoke(saltHandler, req("GET"));
  assert.equal(badMethod.statusCode, 405);
  assert.equal(badMethod.headers.Allow, "POST");

  const badEmail = await invoke(saltHandler, req("POST", { email: "not-an-email" }));
  assert.equal(badEmail.statusCode, 400);

  let seenUrl = "";
  const good = await invoke(saltHandler, req("POST", { email: TEST_EMAIL }), async url => {
    seenUrl = String(url);
    return response(200, { salt: "$2a$11$SSOPxn8VSUP90llNuVn.nO" });
  });
  assert.equal(good.statusCode, 200);
  assert.match(seenUrl, /api\/v1\/users\/tester%40example\.com$/);
  assert.match(good.body.salt, /^\$2[aby]\$\d{2}\$/);
  assert.equal(Object.hasOwn(good.body, "email"), false);
}

async function testPasswordValidationAndBadCredentials() {
  const badMethod = await invoke(passwordHandler, req("GET"));
  assert.equal(badMethod.statusCode, 405);

  const oldSecret = process.env.SORARE_SESSION_SECRET;
  delete process.env.SORARE_SESSION_SECRET;
  try {
    const notConfigured = await invoke(passwordHandler, req("POST", { email: TEST_EMAIL, password: HASHED_PASSWORD }));
    assert.equal(notConfigured.statusCode, 503);
  } finally {
    process.env.SORARE_SESSION_SECRET = oldSecret;
  }

  let touchedSorare = false;
  const invalid = await invoke(passwordHandler, req("POST", { email: "bad", password: "plain-password" }), async () => {
    touchedSorare = true;
    throw new Error("This should not be called");
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(touchedSorare, false);

  const wrongPassword = await invoke(passwordHandler, req("POST", { email: TEST_EMAIL, password: HASHED_PASSWORD }), async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.variables.input.email, TEST_EMAIL);
    assert.equal(payload.variables.input.password, HASHED_PASSWORD);
    return response(200, signInBody({ currentUser: null, jwtToken: null, otpSessionChallenge: null, tcuToken: null, errors: [{ message: "Invalid email or password" }] }));
  });
  assert.equal(wrongPassword.statusCode, 401);
  assert.match(wrongPassword.body.error, /password/i);
  assert.equal(wrongPassword.headers["Set-Cookie"], undefined);
}

async function testTwoFactorChallengeWinsOverLegacyError() {
  const challenge = "3a390a0661cd6f4944205f68c13fd04f";
  const first = await invoke(passwordHandler, req("POST", { email: TEST_EMAIL, password: HASHED_PASSWORD }), async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.variables.input.email, TEST_EMAIL);
    return response(200, { data: { signIn: {
      currentUser: null,
      jwtToken: null,
      otpSessionChallenge: challenge,
      tcuToken: null,
      errors: [{ message: "2fa missing" }]
    } } });
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.requires2FA, true);
  assert.equal(first.body.otpSessionChallenge, challenge);
  assert.equal(first.headers["Set-Cookie"], undefined);

  const legacyShape = await invoke(passwordHandler, req("POST", { email: TEST_EMAIL, password: HASHED_PASSWORD }), async () =>
    response(200, { otp_session_challenge: challenge, error: "2fa_missing" })
  );
  assert.equal(legacyShape.statusCode, 200);
  assert.equal(legacyShape.body.requires2FA, true);
  assert.equal(legacyShape.body.otpSessionChallenge, challenge);
}

async function testTwoFactorAndEncryptedSession() {
  const challenge = "3a390a0661cd6f4944205f68c13fd04f";
  let calls = 0;
  const challengeResponse = await invoke(passwordHandler, req("POST", { email: TEST_EMAIL, password: HASHED_PASSWORD }), async (_url, options) => {
    calls++;
    const payload = JSON.parse(options.body);
    assert.equal(payload.variables.input.email, TEST_EMAIL);
    return response(200, signInBody({ currentUser: null, jwtToken: null, otpSessionChallenge: challenge, tcuToken: null, errors: [] }));
  });
  assert.equal(challengeResponse.statusCode, 200);
  assert.equal(challengeResponse.body.requires2FA, true);
  assert.equal(challengeResponse.body.otpSessionChallenge, challenge);
  assert.equal(challengeResponse.headers["Set-Cookie"], undefined);

  const login = await invoke(passwordHandler, req("POST", { otpSessionChallenge: challenge, otpAttempt: "123456" }), async (_url, options) => {
    calls++;
    const payload = JSON.parse(options.body);
    assert.deepEqual(payload.variables.input, { otpSessionChallenge: challenge, otpAttempt: "123456" });
    assert.doesNotMatch(options.body, /tester@example\.com/);
    return response(200, signInBody({
      currentUser: { slug: "nexus-test-user", nickname: "Nexus Test" },
      jwtToken: { token: FIXED_TOKEN, expiredAt: EXPIRY },
      otpSessionChallenge: null,
      tcuToken: null,
      errors: []
    }));
  });
  assert.equal(calls, 2);
  assert.equal(login.statusCode, 200);
  assert.equal(login.body.authenticated, true);
  assert.equal(login.body.profile.slug, "nexus-test-user");

  const cookieHeader = login.headers["Set-Cookie"];
  assert.ok(Array.isArray(cookieHeader));
  const cookiePair = cookieHeader.find(item => item.startsWith("nexus_sorare_session=")).split(";")[0];
  assert.ok(cookiePair);
  assert.equal(cookiePair.includes(FIXED_TOKEN), false, "JWT must not appear in readable cookie text");

  const authenticatedSession = await getValidSession({ headers: { cookie: cookiePair } }, createRes());
  assert.equal(authenticatedSession.authType, "jwt");
  assert.equal(authenticatedSession.accessToken, FIXED_TOKEN);
  assert.equal(authenticatedSession.profile.slug, "nexus-test-user");

  const status = await invoke(sessionHandler, req("GET", {}, { cookie: cookiePair }));
  assert.equal(status.statusCode, 200);
  assert.equal(status.body.authenticated, true);
  assert.equal(status.body.profile.slug, "nexus-test-user");

  let cardsAuthHeaders = null;
  const cards = await invoke(cardsHandler, req("GET", {}, { cookie: cookiePair }, { slug: "nexus-test-user" }), async (_url, options) => {
    cardsAuthHeaders = options.headers;
    const card = {
      slug: "test-player-2026-common",
      assetId: "asset-1",
      rarityTyped: "common",
      seasonYear: 2026,
      serialNumber: 42,
      anyPositions: ["Goalkeeper"],
      anyTeam: { name: "Test FC", slug: "test-fc", pictureUrl: null },
      anyPlayer: { displayName: "Test Player", fullPictureUrl: null, slug: "test-player", activeClub: { name: "Test FC", slug: "test-fc", pictureUrl: null }, rawPlayerGameScores: [60, 55, 50] },
      pictureUrl: null,
      rawSo5Scores: [50, 60, 40, 55, 45],
      skinEdition: null,
      nextGame: null
    };
    return response(200, { data: { user: { cards: { nodes: [card], pageInfo: { endCursor: null } } } } });
  });
  assert.equal(cards.statusCode, 200);
  assert.equal(cards.body.status, "ok");
  assert.equal(cards.body.authenticated, true);
  assert.equal(cards.body.profileSlug, "nexus-test-user");
  assert.equal(cards.body.items[0].name, "Test Player");
  assert.equal(cardsAuthHeaders.Authorization, "Bearer " + FIXED_TOKEN);
  assert.equal(cardsAuthHeaders["JWT-AUD"], "nexus-sorare-intelligence");

  const logout = await invoke(logoutHandler, req("POST", {}, { cookie: cookiePair }));
  assert.equal(logout.statusCode, 200);
  assert.equal(logout.body.ok, true);
  assert.ok(logout.headers["Set-Cookie"].some(value => value.startsWith("nexus_sorare_session=;") && value.includes("Max-Age=0")));
}

async function testDirectApiContract() {
  const passwordFile = require("node:fs").readFileSync(require.resolve("../api/auth/sorare/password.js"), "utf8");
  const html = require("node:fs").readFileSync(require.resolve("../index.html"), "utf8");
  assert.match(passwordFile, /signIn\(input\)/);
  assert.match(passwordFile, /jwtToken\(aud: "nexus-sorare-intelligence"\)/);
  assert.match(passwordFile, /otpSessionChallenge/);
  const challengeCheck = passwordFile.indexOf("if (otpChallenge && !result.currentUser)");
  const errorsCheck = passwordFile.indexOf("if (Array.isArray(result.errors) && result.errors.length)");
  assert.ok(challengeCheck >= 0 && errorsCheck > challengeCheck, "2FA challenge handling must run before error handling");
  assert.match(html, /bcryptjs@2\.4\.3/);
  assert.match(html, /window\.dcodeIO\.bcrypt\.hashSync\(password,sb\.salt\)/);
  assert.doesNotMatch(html, /window\.location\.href=['"]\/api\/auth\/sorare\/login/);
}

(async () => {
  await testSaltEndpoint();
  await testPasswordValidationAndBadCredentials();
  await testTwoFactorChallengeWinsOverLegacyError();
  await testTwoFactorAndEncryptedSession();
  await testDirectApiContract();
  console.log("Direct Sorare login tests passed (4 suites: salt, validation, 2FA/session, authenticated card sync).");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
