const { writeSession, clearSession } = require("../../../lib/sorare-session");
const ENDPOINT = "https://api.sorare.com/graphql";
const JWT_AUD = "nexus-sorare-intelligence";

async function signIn(input) {
  const query = `mutation NexusSignIn($input: signInInput!) {
    signIn(input: $input) {
      currentUser { slug nickname }
      jwtToken(aud: "nexus-sorare-intelligence") { token expiredAt }
      otpSessionChallenge
      tcuToken
      errors { message }
    }
  }`;
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "NEXUS-Sorare-Intelligence/1.0" },
    body: JSON.stringify({ query, variables: { input } }),
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors?.length || !body.data?.signIn) {
    throw new Error("Sorare non ha accettato la richiesta di accesso.");
  }
  return body.data.signIn;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const challenge = String(body.otpSessionChallenge || "");
  const otp = String(body.otpAttempt || "").trim();
  if (!process.env.SORARE_SESSION_SECRET || process.env.SORARE_SESSION_SECRET.length < 32) {
    return res.status(503).json({ error: "Sessione non configurata: manca SORARE_SESSION_SECRET su Vercel." });
  }
  if (!challenge && (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\$2[aby]\$\d{2}\$/.test(password))) {
    return res.status(400).json({ error: "Email o hash password non validi." });
  }
  if (challenge && (!/^[a-f0-9]{16,128}$/i.test(challenge) || !/^\d{4,10}$/.test(otp))) {
    return res.status(400).json({ error: "Inserisci il codice di verifica Sorare valido." });
  }

  try {
    const input = challenge
      ? { otpSessionChallenge: challenge, otpAttempt: otp }
      : { email, password };
    const result = await signIn(input);
    if (Array.isArray(result.errors) && result.errors.length) {
      const message = result.errors.map(e => e?.message).filter(Boolean).join(" ");
      return res.status(401).json({ error: /invalid|password|credential|email/i.test(message) ? "Email o password non corrette." : "Sorare ha rifiutato l'accesso: " + message.slice(0, 180) });
    }
    if (result.otpSessionChallenge && !result.currentUser) {
      return res.status(200).json({ requires2FA: true, otpSessionChallenge: result.otpSessionChallenge, message: "Inserisci il codice di verifica in due passaggi ricevuto da Sorare." });
    }
    if (result.tcuToken) {
      return res.status(409).json({ error: "Sorare richiede di accettare termini aggiornati. Accedi prima su sorare.com e completa la richiesta, poi riprova." });
    }
    const token = result.jwtToken?.token;
    const expiryDate = result.jwtToken?.expiredAt ? Date.parse(result.jwtToken.expiredAt) : NaN;
    const slug = result.currentUser?.slug;
    if (!token || !slug) return res.status(401).json({ error: "Sorare non ha restituito una sessione valida. Se hai la verifica in due passaggi, riprova con il codice." });
    writeSession(res, {
      authType: "jwt",
      accessToken: token,
      refreshToken: null,
      jwtAud: JWT_AUD,
      expiresAt: Number.isFinite(expiryDate) ? expiryDate : Date.now() + 30 * 24 * 60 * 60 * 1000,
      profile: { slug, nickname: result.currentUser.nickname || slug },
      createdAt: Date.now()
    });
    return res.status(200).json({ authenticated: true, profile: { slug, nickname: result.currentUser.nickname || slug }, expiresAt: Number.isFinite(expiryDate) ? expiryDate : null });
  } catch {
    clearSession(res);
    return res.status(502).json({ error: "Errore di connessione a Sorare. Riprova tra poco." });
  }
};
