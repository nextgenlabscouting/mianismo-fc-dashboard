const { readSession, clearSession } = require("../../../lib/sorare-session");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = readSession(req);
  try {
    if (session?.accessToken && process.env.SORARE_CLIENT_ID && process.env.SORARE_CLIENT_SECRET) {
      const form = new URLSearchParams({
        client_id: process.env.SORARE_CLIENT_ID,
        client_secret: process.env.SORARE_CLIENT_SECRET,
        token: session.accessToken
      });
      await fetch("https://api.sorare.com/oauth/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
        signal: AbortSignal.timeout(8000)
      });
    }
  } catch {}
  clearSession(res);
  return res.status(200).json({ ok: true });
};
