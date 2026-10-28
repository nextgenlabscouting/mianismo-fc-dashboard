const { getValidSession } = require("../../../lib/sorare-session");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ authenticated: false, error: "Method not allowed" });
  }

  const session = await getValidSession(req, res);
  if (!session) return res.status(200).json({ authenticated: false, profile: null });

  return res.status(200).json({
    authenticated: true,
    profile: { slug: session.profile.slug, nickname: session.profile.nickname || session.profile.slug },
    expiresAt: session.expiresAt || null
  });
};
