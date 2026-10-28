const crypto = require("crypto");
const { writeState } = require("../../../lib/sorare-session");

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
  if (!process.env.SORARE_CLIENT_ID || !process.env.SORARE_CLIENT_SECRET ||
      !process.env.SORARE_SESSION_SECRET || process.env.SORARE_SESSION_SECRET.length < 32) {
    res.setHeader("Location", "/?auth_error=oauth_not_configured");
    return res.status(302).end();
  }

  const state = crypto.randomBytes(32).toString("base64url");
  writeState(res, state);
  const params = new URLSearchParams({
    client_id: process.env.SORARE_CLIENT_ID,
    redirect_uri: callbackUri(req),
    response_type: "code",
    scope: "",
    state
  });
  res.setHeader("Location", "https://sorare.com/oauth/authorize?" + params.toString());
  return res.status(302).end();
};
