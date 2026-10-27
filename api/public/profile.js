const SORARE_ENDPOINT = "https://api.sorare.com/graphql";

async function sorareGraphQL(query, variables = {}) {
  const response = await fetch(SORARE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "MIANISMO-FC-Dashboard/1.0",
      ...(process.env.SORARE_API_KEY ? { APIKEY: process.env.SORARE_API_KEY } : {})
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Sorare API returned HTTP ${response.status}`);
  if (Array.isArray(body.errors) && body.errors.length) {
    throw new Error(body.errors.map((error) => error?.message || "GraphQL error").join("; ").slice(0, 240));
  }
  if (!body.data) throw new Error("Sorare API returned no data");
  return body.data;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const rawSlug = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  const slug = (rawSlug || "mianismo").trim();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(slug)) {
    return res.status(400).json({ error: "Invalid profile slug." });
  }

  try {
    const query = `query PublicUser($slug: String!) {
      user(slug: $slug) { slug nickname }
    }`;
    const data = await sorareGraphQL(query, { slug });
    const user = data.user || null;

    return res.status(200).json({
      status: user ? "ok" : "not_found",
      source: "Sorare public GraphQL API",
      profile: user ? { slug: user.slug || slug, nickname: user.nickname || null } : null,
      apiKeyConfigured: Boolean(process.env.SORARE_API_KEY),
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(502).json({
      status: "error",
      error: String(error?.message || "Sorare public API request failed").slice(0, 240)
    });
  }
};
