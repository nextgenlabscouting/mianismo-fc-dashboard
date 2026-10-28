const { writeSession, clearState, readState, graphQL } = require("../../../lib/sorare-session");

const TOKEN_ENDPOINT = "https://api.sorare.com/oauth/token";

function callbackUri(req) {
  if (process.env.SORARE_REDIRECT_URI) return process.env.SORARE_REDIRECT_URI;
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "mianismo-fc-dashboard.vercel.app").split(",")[0].trim();
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  return proto + "://" + host + "/api/auth/sorare/callback";
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method not allowed");
  }

  const query = req.query || {};
  const fail = (reason) => {
    clearState(res);
    res.setHeader("Location", "/?auth_error=" + encodeURIComponent(reason));
    return res.status(302).end();
  };

  if (query.error) return fail("oauth_denied");
  const code = Array.isArray(query.code) ? query.code[0] : query.code;
  const state = Array.isArray(query.state) ? query.state[0] : query.state;
  if (!code || !state || state !== readState(req)) return fail("oauth_state_invalid");
  if (!process.env.SORARE_CLIENT_ID || !process.env.SORARE_CLIENT_SECRET ||
      !process.env.SORARE_SESSION_SECRET || process.env.SORARE_SESSION_SECRET.length < 32) {
    return fail("oauth_not_configured");
  }

  try {
    const form = new URLSearchParams({
      client_id: process.env.SORARE_CLIENT_ID,
      client_secret: process.env.SORARE_CLIENT_SECRET,
      code: String(code),
      grant_type: "authorization_code",
      redirect_uri: callbackUri(req)
    });
    const tokenResponse = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(15000)
    });
    const tokens = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokens.access_token) return fail("oauth_token_failed");

    const data = await graphQL(tokens.access_token, "query NexusCurrentUser { currentUser { slug nickname } }");
    const user = data?.currentUser;
    if (!user?.slug) return fail("oauth_profile_failed");

    writeSession(res, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      expiresAt: Date.now() + Number(tokens.expires_in || 7200) * 1000,
      profile: { slug: user.slug, nickname: user.nickname || user.slug },
      createdAt: Date.now()
    });
    clearState(res);
    res.setHeader("Location", "/?connected=1");
    return res.status(302).end();
  } catch {
    return fail("oauth_callback_failed");
  }
};
