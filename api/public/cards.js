const ENDPOINT = "https://api.sorare.com/graphql";

async function querySorare(query, variables) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(12000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Sorare HTTP " + response.status);
  if (body.errors && body.errors.length) throw new Error(body.errors.map(x => x.message || "GraphQL error").join("; ").slice(0, 200));
  if (!body.data) throw new Error("Sorare returned no data");
  return body.data;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const slug = String(req.query.slug || "mianismo").trim();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(slug)) return res.status(400).json({ error: "Invalid slug" });
  let lastError = "No supported public cards connection";
  for (const field of ["cards", "paginatedCards"]) {
    try {
      const query = "query PublicUserCards($slug: String!, $cursor: String) { user(slug: $slug) { " + field + "(after: $cursor) { nodes { slug } pageInfo { endCursor } } } }";
      const data = await querySorare(query, { slug, cursor: req.query.after || null });
      const connection = data && data.user && data.user[field];
      if (!connection) throw new Error("No " + field + " connection returned");
      const items = (connection.nodes || []).filter(x => x && x.slug).map(x => ({ slug: String(x.slug), name: String(x.slug) }));
      const endCursor = connection.pageInfo && connection.pageInfo.endCursor || null;
      return res.status(200).json({ status: "ok", source: "Sorare public GraphQL API", profileSlug: slug, count: items.length, items, endCursor, hasMore: Boolean(endCursor && endCursor !== (req.query.after || null)), fetchedAt: new Date().toISOString(), note: "Public read-only data only." });
    } catch (error) {
      lastError = String(error && error.message || "Sorare request failed").slice(0, 200);
    }
  }
  return res.status(502).json({ status: "unavailable", error: lastError, profileSlug: slug, items: [] });
};
