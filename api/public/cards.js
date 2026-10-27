const ENDPOINT = "https://api.sorare.com/graphql";
const PAGE_SIZE = 50;
const MAX_PAGES = 8;

async function querySorare(query, variables = {}) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "MIANISMO-FC-Dashboard/2.0 (public read-only)",
      ...(process.env.SORARE_API_KEY
        ? { APIKEY: process.env.SORARE_API_KEY }
        : {})
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000)
  });

  const responseText = await response.text();
  let body = {};
  try {
    body = responseText ? JSON.parse(responseText) : {};
  } catch {}

  const messages = Array.isArray(body.errors)
    ? body.errors.map(error => error?.message || "GraphQL error").join("; ")
    : "";
  if (!response.ok) {
    const detail = messages || (typeof body.message === "string" ? body.message : "") || responseText.slice(0, 350);
    throw new Error(`Sorare HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  if (messages) throw new Error(messages.slice(0, 500));
  if (!body.data) throw new Error("Sorare returned no data");
  return body.data;
}

function average(values) {
  const numbers = (Array.isArray(values) ? values : [])
    .filter(value => value != null && Number.isFinite(Number(value)))
    .map(Number);
  return numbers.length
    ? Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length * 10) / 10
    : null;
}

function normalizeCard(card) {
  const rawScores = Array.isArray(card.rawSo5Scores)
    ? card.rawSo5Scores.filter(value => value != null && Number.isFinite(Number(value))).map(Number)
    : [];
  const playerRawScores = Array.isArray(card.anyPlayer?.rawPlayerGameScores)
    ? card.anyPlayer.rawPlayerGameScores.filter(value => value != null && Number.isFinite(Number(value))).map(Number)
    : [];
  const nextGame = card.anyPlayer?.nextGame || null;
  const games = nextGame ? [nextGame] : [];
  const skin = card.skinEdition || null;
  return {
    slug: card.slug,
    assetId: card.assetId || null,
    name: card.anyPlayer?.displayName || card.name || card.slug,
    team: card.anyTeam?.name || null,
    activeTeam: card.anyPlayer?.activeClub?.name || null,
    playerSlug: card.anyPlayer?.slug || null,
    position: Array.isArray(card.anyPositions) ? card.anyPositions : [],
    imageUrl: card.pictureUrl || card.ipfsPictureUrl || null,
    playerImageUrl: card.anyPlayer?.fullPictureUrl || card.anyPlayer?.avatarPictureUrl || card.anyPlayer?.squaredPictureUrl || null,
    rarity: card.displayRarity || card.rarity || card.rarityTyped || "Unknown",
    rarityTyped: card.rarityTyped || null,
    season: card.seasonYear ?? null,
    serialNumber: card.serialNumber ?? null,
    edition: card.customCardEditionName || card.formattedCardEditionName ||
      card.cardEditionName || card.specialEdition || null,
    specialEdition: card.specialEdition || null,
    set: card.cardSet ? { name: card.cardSet.name, slug: card.cardSet.slug } : null,
    skinEdition: skin ? {
      skin: skin.skin || null,
      skinName: skin.skinName || null,
      variant: skin.variant || null,
      variantName: skin.variantName || null,
      bonus: skin.bonus ?? null
    } : null,
    upcomingGames: games.map(game => ({
      date: game.date || null,
      homeTeam: game.homeTeam?.name || null,
      awayTeam: game.awayTeam?.name || null,
      status: game.statusTyped || null
    })),
    power: card.power ?? null,
    grade: card.grade ?? null,
    age: card.age ?? card.anyPlayer?.age ?? null,
    rawScores,
    playerRawScores,
    l5: average(rawScores.slice(0, 5)) ?? average(playerRawScores.slice(0, 5)),
    l10: average(playerRawScores.slice(0, 10)) ?? average(rawScores.slice(0, 10)),
    l15: average(playerRawScores.slice(0, 15)),
    source: "Sorare GraphQL API"
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawSlug = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  const slug = String(rawSlug || "mianismo").trim();
  const rawAfter = Array.isArray(req.query.after) ? req.query.after[0] : req.query.after;
  const after = rawAfter ? String(rawAfter) : null;

  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(slug)) {
    return res.status(400).json({ error: "Invalid slug" });
  }
  if (after && after.length > 500) {
    return res.status(400).json({ error: "Invalid pagination cursor" });
  }

  try {
    const items = [];
    const seen = new Set();
    let cursor = after;
    let hasMore = false;
    let pagesFetched = 0;

    const query = `query PublicUserCards($slug: String!, $cursor: String, $first: Int!) {
      user(slug: $slug) {
        cards(first: $first, after: $cursor) {
          nodes {
            __typename
            slug
            assetId
            name
            anyPlayer {
              displayName fullPictureUrl avatarPictureUrl squaredPictureUrl age slug
              activeClub { name }
              rawPlayerGameScores(last: 15)
              nextGame {
                date statusTyped homeTeam { name } awayTeam { name }
              }
            }
            anyTeam { name }
            anyPositions
            pictureUrl(derivative: "full")
            ipfsPictureUrl
            rarityTyped
            displayRarity
            seasonYear
            serialNumber
            cardEditionName
            formattedCardEditionName
            specialEdition
            skinEdition { skin skinName variant variantName bonus }
            cardSet { name slug }
            power
            grade
            ... on Card {
              age
              rarity
              customCardEditionName
              rawSo5Scores(last: 10)
            }
          }
          pageInfo { endCursor hasNextPage }
        }
      }
    }`;

    while (pagesFetched < MAX_PAGES) {
      const data = await querySorare(query, { slug, cursor, first: PAGE_SIZE });
      const connection = data?.user?.cards;
      if (!connection) throw new Error("Sorare did not return the public cards connection");

      for (const rawCard of connection.nodes || []) {
        if (!rawCard?.slug) continue;
        const key = rawCard.assetId || rawCard.slug;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(normalizeCard(rawCard));
      }

      pagesFetched += 1;
      const next = connection.pageInfo?.endCursor || null;
      hasMore = Boolean(connection.pageInfo?.hasNextPage && next && next !== cursor);
      if (!hasMore) {
        cursor = next;
        break;
      }
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
      dataQuality: {
        withCardImage: items.filter(card => card.imageUrl).length,
        withPlayerImage: items.filter(card => card.playerImageUrl).length,
        withVariant: items.filter(card => card.skinEdition).length,
        withRecentScores: items.filter(card => card.playerRawScores.length || card.rawScores.length).length,
        withUpcomingGames: items.filter(card => card.upcomingGames.length).length
      },
      fetchedAt: new Date().toISOString(),
      note: "Public read-only data. Card details are requested directly from the paginated connection; continue with endCursor when hasMore is true."
    });
  } catch (error) {
    return res.status(502).json({
      status: "unavailable",
      error: String(error?.message || "Sorare request failed").slice(0, 500),
      profileSlug: slug,
      apiKeyConfigured: Boolean(process.env.SORARE_API_KEY),
      items: []
    });
  }
};
