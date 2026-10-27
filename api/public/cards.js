const ENDPOINT = "https://api.sorare.com/graphql";
const MAX_PAGES = 8;
const DETAIL_BATCH_SIZE = 25;

async function querySorare(query, variables) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", ...(process.env.SORARE_API_KEY ? { APIKEY: process.env.SORARE_API_KEY } : {}) },
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

  try {
    const items = [];
    const seen = new Set();
    let cursor = null;
    let hasMore = false;
    let pagesFetched = 0;
    let detailsError = null;

    // Read every page in this request, up to a safe serverless limit.
    while (pagesFetched < MAX_PAGES) {
      const data = await querySorare(
        "query PublicUserCards($slug: String!, $cursor: String) { user(slug: $slug) { cards(after: $cursor) { nodes { slug } pageInfo { endCursor } } } }",
        { slug, cursor }
      );
      const connection = data?.user?.cards;
      if (!connection) throw new Error("Sorare did not return the public cards connection");
      const slugs = (connection.nodes || []).map(c => c?.slug).filter(s => s && !seen.has(s));
      slugs.forEach(s => seen.add(s));

      if (slugs.length) {
        try {
          const bySlug = new Map();
          // Keep each detail request small: large batches can be rejected by Sorare.
          for (let i = 0; i < slugs.length; i += DETAIL_BATCH_SIZE) {
            const batch = slugs.slice(i, i + DETAIL_BATCH_SIZE);
            const detailData = await querySorare(
              "query PublicCardDetails($slugs: [String!]) { anyCards(slugs: $slugs) { slug rarityTyped seasonYear serialNumber anyPlayer { displayName pictureUrl } anyTeam { name } } }",
              { slugs: batch }
            );
            const details = Array.isArray(detailData.anyCards) ? detailData.anyCards : [];
            details.forEach(c => bySlug.set(c.slug, c));
          }
          for (const cardSlug of slugs) {
            const c = bySlug.get(cardSlug) || {};
            items.push({
              slug: cardSlug,
              name: c.anyPlayer?.displayName || cardSlug,
              imageUrl: null,
              playerImageUrl: c.anyPlayer?.pictureUrl || null,
              rarity: c.rarityTyped || "Unknown",
              season: c.seasonYear || null,
              serialNumber: c.serialNumber ?? null,
              team: c.anyTeam?.name || null
            });
          }
        } catch (detailError) {
          detailsError = String(detailError?.message || "Card details query failed").slice(0, 200);
          // Keep the collection usable even if Sorare changes a detail field.
          slugs.forEach(cardSlug => items.push({ slug: cardSlug, name: cardSlug, imageUrl: null, rarity: "Unknown" }));
        }
      }

      pagesFetched += 1;
      const next = connection.pageInfo?.endCursor || null;
      hasMore = Boolean(next && next !== cursor);
      if (!hasMore) break;
      cursor = next;
    }

    return res.status(200).json({
      status: "ok",
      source: "Sorare public GraphQL API",
      profileSlug: slug,
      count: items.length,
      items,
      endCursor: cursor,
      hasMore,
      pagesFetched,
      apiKeyConfigured: Boolean(process.env.SORARE_API_KEY),
      detailsError,
      fetchedAt: new Date().toISOString(),
      note: "Public read-only data. Pagination is followed automatically up to the per-request safety limit."
    });
  } catch (error) {
    return res.status(502).json({
      status: "unavailable",
      error: String(error?.message || "Sorare request failed").slice(0, 200),
      profileSlug: slug,
      apiKeyConfigured: Boolean(process.env.SORARE_API_KEY),
      items: []
    });
  }
};
