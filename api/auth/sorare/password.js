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
  const payload = body?.data?.signIn || body?.signIn || null;
  const challenge = payload?.otpSessionChallenge
    || payload?.otp_session_challenge
    || body?.otpSessionChallenge
    || body?.otp_session_challenge
    || null;
  const apiError = String(body?.error || body?.message || "");
  const graphErrors = Array.isArray(body?.errors) ? body.errors : [];

  // Sorare's documented GraphQL response is camelCase. Some legacy/edge
  // responses have used snake_case and/or returned "2fa_missing" beside a
  // usable OTP challenge. The challenge must win over that error marker.
  if (challenge && !(payload?.currentUser || body?.currentUser)) {
    return {
      ...(payload || {}),
      currentUser: null,
      jwtToken: null,
      otpSessionChallenge: String(challenge),
      tcuToken: payload?.tcuToken || body?.tcuToken || null,
      errors: []
    };
  }

  if (payload) {
    // Do not let an empty nested errors array hide GraphQL errors returned
    // at the top level. Normalize common response shapes before interpreting
    // authentication failures so "2fa_missing" is not lost.
    const payloadErrors = Array.isArray(payload.errors) ? payload.errors : [];
    const normalizedErrors = payloadErrors.length
      ? payloadErrors
      : (graphErrors.length ? graphErrors : (apiError ? [{ message: apiError }] : []));
    return {
      ...payload,
      currentUser: payload.currentUser || payload.current_user || body?.currentUser || body?.current_user || null,
      jwtToken: payload.jwtToken || payload.jwt_token || body?.jwtToken || body?.jwt_token || null,
      tcuToken: payload.tcuToken || payload.tcu_token || body?.tcuToken || body?.tcu_token || null,
      otpSessionChallenge: challenge ? String(challenge) : null,
      errors: normalizedErrors
    };
  }

  if (challenge) {
    return {
      currentUser: null,
      jwtToken: null,
      otpSessionChallenge: String(challenge),
      tcuToken: body?.tcuToken || null,
      errors: []
    };
  }

  const topLevelMessage = graphErrors.map(error => error?.message || "").filter(Boolean).join("; ");
  if (!response.ok || graphErrors.length || !body?.data) {
    throw new Error(topLevelMessage || apiError || "Sorare non ha accettato la richiesta di accesso.");
  }
  throw new Error("Sorare non ha restituito una risposta di accesso valida.");
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
  if (challenge && (!/^[a-z0-9_-]{8,256}$/i.test(challenge) || !/^\d{4,10}$/.test(otp))) {
    return res.status(400).json({ error: "Inserisci il codice di verifica Sorare valido." });
  }

  try {
    const input = challenge
      ? { otpSessionChallenge: challenge, otpAttempt: otp }
      : { email, password };
    const result = await signIn(input);
    if (result.tcuToken || (Array.isArray(result.errors) && result.errors.some(error => /must_accept_tcus|terms|conditions/i.test(String(error?.message || "")))) ) {
      return res.status(409).json({ error: "Sorare richiede di accettare termini aggiornati. Accedi prima su sorare.com e completa la richiesta, poi riprova." });
    }
    const otpChallenge = String(result.otpSessionChallenge || result.otp_session_challenge || "").trim();
    // Check the challenge before result.errors: some Sorare responses include
    // the legacy "2fa missing" marker even when an OTP challenge is usable.
    if (otpChallenge && !result.currentUser) {
      if (!/^[a-z0-9_-]{8,256}$/i.test(otpChallenge)) {
        return res.status(502).json({ error: "Sorare ha richiesto la verifica 2FA ma ha restituito una sfida non valida. Riavvia l'accesso e riprova." });
      }
      return res.status(200).json({ requires2FA: true, otpSessionChallenge: otpChallenge, message: "Inserisci il codice monouso richiesto da Sorare." });
    }
    if (Array.isArray(result.errors) && result.errors.length) {
      const message = result.errors.map(e => e?.message).filter(Boolean).join(" ");
      if (/2fa[\s_-]*missing|two[\s_-]*factor[\s_-]*missing|otp[\s_-]*session[\s_-]*challenge[\s_-]*missing/i.test(message)) {
        return res.status(409).json({ error: "Sorare segnala una verifica 2FA ma non ha restituito la sfida OTP. Non è possibile completare il secondo passaggio senza quella sfida: riavvia l'accesso e riprova. Se continua, accedi direttamente su sorare.com e completa eventuali avvisi di sicurezza." });
      }
      return res.status(401).json({ error: /invalid|password|credential|email/i.test(message) ? "Email o password non corrette." : "Sorare ha rifiutato l'accesso: " + message.slice(0, 180) });
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
  } catch (error) {
    clearSession(res);
    const message = String(error?.message || "");
    if (/2fa[\s_-]*missing|two[\s_-]*factor[\s_-]*missing|otp[\s_-]*session[\s_-]*challenge[\s_-]*missing/i.test(message)) {
      return res.status(409).json({ error: "Sorare richiede la verifica in due passaggi ma non ha restituito una sfida OTP utilizzabile. Riavvia l'accesso; se continua, accedi su sorare.com e completa eventuali richieste di sicurezza, poi riprova." });
    }
    return res.status(502).json({ error: "Errore di connessione a Sorare. Riprova tra poco." });
  }
};
