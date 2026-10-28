const USER_ENDPOINT = "https://api.sorare.com/api/v1/users/";
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Inserisci un indirizzo email valido." });
  }
  try {
    const response = await fetch(USER_ENDPOINT + encodeURIComponent(email), {
      headers: { Accept: "application/json", "User-Agent": "NEXUS-Sorare-Intelligence/1.0" },
      signal: AbortSignal.timeout(10000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || typeof body.salt !== "string" || !/^\$2[aby]\$\d{2}\$/.test(body.salt)) {
      return res.status(502).json({ error: "Sorare non ha restituito il salt di accesso. Riprova più tardi." });
    }
    return res.status(200).json({ salt: body.salt });
  } catch {
    return res.status(502).json({ error: "Impossibile contattare Sorare per avviare l'accesso." });
  }
};
