const crypto = require("crypto");
const SESSION_COOKIE = "nexus_sorare_session";
const GRAPHQL_ENDPOINT = "https://api.sorare.com/graphql";
const JWT_AUD = "nexus-sorare-intelligence";

function key() {
  const secret = process.env.SORARE_SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  return crypto.createHash("sha256").update(secret).digest();
}
function secureCookie() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}
function cookieValue(req, name) {
  const header = String(req.headers?.cookie || "");
  for (const part of header.split(";")) {
    const entry = part.trim();
    const i = entry.indexOf("=");
    if (i >= 0 && entry.slice(0, i) === name) {
      try { return decodeURIComponent(entry.slice(i + 1)); } catch { return null; }
    }
  }
  return null;
}
function appendCookie(res, value) {
  const current = res.getHeader("Set-Cookie");
  const cookies = Array.isArray(current) ? current.slice() : current ? [String(current)] : [];
  cookies.push(value);
  res.setHeader("Set-Cookie", cookies);
}
function encrypt(payload) {
  const secretKey = key();
  if (!secretKey) throw new Error("SORARE_SESSION_SECRET must be a random secret with at least 32 characters.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
function decrypt(value) {
  const secretKey = key();
  if (!secretKey || !value) return null;
  try {
    const [version, ivText, tagText, encryptedText] = value.split(".");
    if (version !== "v1" || !ivText || !tagText || !encryptedText) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey, Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const plain = Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plain);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}
function readSession(req) { return decrypt(cookieValue(req, SESSION_COOKIE)); }
function writeSession(res, session) {
  const value = encodeURIComponent(encrypt(session));
  const maxAge = Math.max(0, Math.min(60 * 60 * 24 * 30, Math.floor((Number(session.expiresAt || 0) - Date.now()) / 1000)));
  const secure = secureCookie() ? "; Secure" : "";
  appendCookie(res, SESSION_COOKIE + "=" + value + "; Path=/; Max-Age=" + maxAge + "; HttpOnly; SameSite=Lax" + secure);
}
function clearSession(res) {
  const secure = secureCookie() ? "; Secure" : "";
  appendCookie(res, SESSION_COOKIE + "=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" + secure);
}
async function graphQL(accessToken, query, variables = {}) {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + accessToken, "JWT-AUD": JWT_AUD, "User-Agent": "NEXUS-Sorare-Intelligence/1.0" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.errors?.length || !body.data) {
    const reason = body.errors?.map(item => item?.message).filter(Boolean).join("; ");
    throw new Error(reason || "Sorare GraphQL returned HTTP " + response.status);
  }
  return body.data;
}
async function getValidSession(req, res) {
  const session = readSession(req);
  if (!session?.accessToken || !session?.profile?.slug || session.authType !== "jwt") return null;
  if (Number(session.expiresAt || 0) <= Date.now()) {
    clearSession(res);
    return null;
  }
  return session;
}
module.exports = { readSession, writeSession, clearSession, getValidSession, graphQL };
