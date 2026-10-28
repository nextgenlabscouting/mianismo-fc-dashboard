const ENDPOINT = "https://api.sorare.com/graphql";
const { getValidSession } = require("../../lib/sorare-session");
const JWT_AUD = "nexus-sorare-intelligence";
const MAX_PAGES = 1;

// Optional fields are isolated into query tiers. If the Sorare schema changes,
// the endpoint can still return the inventory using the documented base fields.
const QUERY_TIERS = [
{
    label: "rich",
    fields: [
      "__typename slug assetId name",
      "anyPlayer { displayName fullPictureUrl avatarPictureUrl squaredPictureUrl age slug activeClub { name slug pictureUrl } rawPlayerGameScores(last: 15) nextGame { date statusTyped homeTeam { name } awayTeam { name } } }",
      "anyTeam { name slug pictureUrl } anyPositions",
      "pictureUrl(derivative: \"full\") ipfsPictureUrl",
      "rarityTyped displayRarity seasonYear serialNumber cardEditionName formattedCardEditionName specialEdition",
      "skinEdition { skin skinName variant variantName bonus } cardSet { name slug } power grade",
      "... on Card { age rarity customCardEditionName rawSo5Scores(last: 10) }"
    ]
  },
  {
    label: "card-details-with-fixtures",
    fields: [
      "__typename slug assetId name",
      "anyPlayer { displayName fullPictureUrl nextGame { date statusTyped homeTeam { name } awayTeam { name } } }",
      "anyTeam { name } anyPositions",
      "pictureUrl(derivative: \"full\") ipfsPictureUrl",
      "rarityTyped displayRarity seasonYear serialNumber cardEditionName formattedCardEditionName specialEdition",
      "skinEdition { skin skinName variant variantName bonus } cardSet { name slug } power grade",
      "... on Card { age rarity customCardEditionName rawSo5Scores(last: 10) }"
    ]
  },
  {
    label: "card-details",
    fields: [
      "__typename slug assetId name",
      "anyPlayer { displayName fullPictureUrl }",
      "anyTeam { name } anyPositions",
      "pictureUrl(derivative: \"full\") ipfsPictureUrl",
      "rarityTyped displayRarity seasonYear serialNumber cardEditionName formattedCardEditionName specialEdition",
      "skinEdition { skin skinName variant variantName bonus } cardSet { name slug } power grade",
      "... on Card { age rarity customCardEditionName rawSo5Scores(last: 10) }"
    ]
  },
{
    label: "images-and-scores",
    fields: [
      "__typename slug assetId name",
      "anyPlayer { displayName fullPictureUrl }",
      "anyTeam { name } anyPositions",
      "pictureUrl(derivative: \"full\")",
      "rarityTyped seasonYear serialNumber",
      "... on Card { rawSo5Scores(last: 10) }"
    ]
  },
{
    label: "skin-variant",
    fields: [
      "slug assetId rarityTyped seasonYear serialNumber",
      "anyPositions anyTeam { name }",
      "anyPlayer { displayName fullPictureUrl }",
      "pictureUrl(derivative: \"full\")",
      "skinEdition { skin skinName variant variantName bonus }"
    ]
  },
{
    label: "edition-metadata",
    fields: [
      "slug assetId rarityTyped seasonYear serialNumber",
      "anyPositions anyTeam { name }",
      "anyPlayer { displayName }",
      "cardEditionName formattedCardEditionName specialEdition"
    ]
  },
{
    label: "scores",
    fields: [
      "slug assetId rarityTyped seasonYear serialNumber",
      "anyPositions anyTeam { name }",
      "anyPlayer { displayName }",
      "... on Card { rawSo5Scores(last: 10) }"
    ]
  },
{
    label: "images",
    fields: [
      "slug assetId rarityTyped seasonYear serialNumber",
      "anyPositions anyTeam { name }",
      "anyPlayer { displayName fullPictureUrl }",
      "pictureUrl(derivative: \"full\")"
    ]
  },
{
    label: "standard",
    fields: [
      "slug assetId rarityTyped seasonYear serialNumber",
      "anyPositions anyTeam { name }",
      "anyPlayer { displayName }"
    ]
  },
{
    label: "slug-only",
    fields: ["slug"]
  }
];

async function querySorare(query, variables = {}, accessToken = null) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "NEXUS-Sorare-Intelligence/3.0",
      ...(accessToken ? { Authorization: "Bearer " + accessToken, "JWT-AUD": JWT_AUD } : {}),
      ...(process.env.SORARE_API_KEY ? { APIKEY: process.env.SORARE_API_KEY } : {})
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000)
  });

  const responseText = await response.text();
  let body = {};
  try { body = responseText ? JSON.parse(responseText) : {}; } catch {}
  const messages = Array.isArray(body.errors)
    ? body.errors.map(error => error?.message || "GraphQL error").join("; ")
    : "";
  if (!response.ok) {
    const detail = messages || (typeof body.message === "string" ? body.message : "") || responseText.slice(0, 350);
    throw new Error("Sorare HTTP " + response.status + (detail ? ": " + detail : ""));
  }
  if (messages) throw new Error(messages.slice(0, 500));
  if (!body.data) throw new Error("Sorare returned no data");
  return body.data;
}

function buildPageQuery(tier) {
  const fields = QUERY_TIERS[tier].fields.join("\n                ");
  return [
    "query PublicUserCards($slug: String!, $cursor: String) {",
    "  user(slug: $slug) {",
    "    cards(after: $cursor) {",
    "      nodes { " + fields + " }",
    "      pageInfo { endCursor }",
    "    }",
    "  }",
    "}"
  ].join("\n");
}

function numbersFrom(values) {
  return (Array.isArray(values) ? values : [])
    .map(value => typeof value === "object" && value !== null
      ? (value.score ?? value.points ?? value.value ?? null)
      : value)
    .filter(value => value != null && Number.isFinite(Number(value)))
    .map(Number);
}

function average(values) {
  const numbers = numbersFrom(values);
  return numbers.length
    ? Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length * 10) / 10
    : null;
}

function normalizeCard(card) {
  const rawScores = numbersFrom(card.rawSo5Scores);
  const playerRawScores = numbersFrom(card.anyPlayer?.rawPlayerGameScores);
  const player = card.anyPlayer || {};
  const nextGame = player.nextGame || null;
  const skin = card.skinEdition || null;
  return {
    slug: card.slug,
    assetId: card.assetId || null,
    playerSlug: player.slug || null,
    name: player.displayName || card.name || card.slug,
    team: card.anyTeam?.name || null,
    teamSlug: card.anyTeam?.slug || null,
    teamImageUrl: card.anyTeam?.pictureUrl || null,
    activeTeam: player.activeClub?.name || null,
    activeTeamSlug: player.activeClub?.slug || null,
    activeTeamImageUrl: player.activeClub?.pictureUrl || null,
    position: Array.isArray(card.anyPositions) ? card.anyPositions : [],
    imageUrl: card.pictureUrl || card.ipfsPictureUrl || null,
    playerImageUrl: player.fullPictureUrl || player.avatarPictureUrl || player.squaredPictureUrl || null,
    rarity: card.displayRarity || card.rarity || card.rarityTyped || "Unknown",
    rarityTyped: card.rarityTyped || null,
    season: card.seasonYear ?? null,
    serialNumber: card.serialNumber ?? null,
    edition: card.customCardEditionName || card.formattedCardEditionName || card.cardEditionName || card.specialEdition || null,
    specialEdition: card.specialEdition || null,
    set: card.cardSet ? { name: card.cardSet.name, slug: card.cardSet.slug } : null,
    skinEdition: skin ? {
      skin: skin.skin || null, skinName: skin.skinName || null,
      variant: skin.variant || null, variantName: skin.variantName || null,
      bonus: skin.bonus ?? null
    } : null,
    power: card.power ?? null,
    grade: card.grade ?? null,
    age: card.age ?? player.age ?? null,
    rawScores,
    playerRawScores,
    l5: average(playerRawScores.slice(0, 5)) ?? average(rawScores.slice(0, 5)),
    l10: average(playerRawScores.slice(0, 10)) ?? average(rawScores.slice(0, 10)),
    l15: average(playerRawScores.slice(0, 15)) ?? average(rawScores.slice(0, 15)),
    cardL5: average(rawScores.slice(0, 5)),
    upcomingGames: nextGame ? [{
      date: nextGame.date || null,
      homeTeam: nextGame.homeTeam?.name || null,
      awayTeam: nextGame.awayTeam?.name || null,
      status: nextGame.statusTyped || null
    }] : [],
    source: "Sorare GraphQL API"
  };
}

function dataQuality(items) {
  return {
    withCardImage: items.filter(card => card.imageUrl).length,
    withPlayerImage: items.filter(card => card.playerImageUrl).length,
    withVariant: items.filter(card => card.skinEdition || card.specialEdition || card.edition).length,
    withRecentScores: items.filter(card => card.playerRawScores.length || card.rawScores.length).length,
    withUpcomingGames: items.filter(card => card.upcomingGames.length).length
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getValidSession(req, res);
  const rawSlug = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  const slug = String(session?.profile?.slug || rawSlug || "mianismo").trim();
  const rawAfter = Array.isArray(req.query.after) ? req.query.after[0] : req.query.after;
  const requestedCursor = rawAfter ? String(rawAfter) : null;

  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(slug)) {
    return res.status(400).json({ error: "Invalid slug" });
  }
  if (requestedCursor && requestedCursor.length > 500) {
    return res.status(400).json({ error: "Invalid pagination cursor" });
  }

  try {
    const items = [];
    const seen = new Set();
    let cursor = requestedCursor;
    let pagesFetched = 0;
    let activeTier = 0;
    let hasMore = false;
    const fallbackErrors = [];

    while (pagesFetched < MAX_PAGES) {
      let connection = null;
      let lastError = null;

      for (let tier = activeTier; tier < QUERY_TIERS.length; tier++) {
        try {
          const data = await querySorare(buildPageQuery(tier), { slug, cursor }, session?.accessToken || null);
          const candidate = data?.user?.cards;
          if (!candidate) throw new Error("Sorare did not return the cards connection");
          connection = candidate;
          activeTier = tier;
          break;
        } catch (error) {
          lastError = error;
          fallbackErrors.push({
            tier: QUERY_TIERS[tier].label,
            error: String(error?.message || error).slice(0, 250)
          });
        }
      }

      if (!connection) throw lastError || new Error("All Sorare card query variants failed");

      for (const rawCard of connection.nodes || []) {
        if (!rawCard?.slug || seen.has(rawCard.slug)) continue;
        seen.add(rawCard.slug);
        items.push(normalizeCard(rawCard));
      }

      pagesFetched += 1;
      const next = connection.pageInfo?.endCursor || null;
      hasMore = Boolean(next && next !== cursor);
      if (!hasMore) {
        cursor = next;
        break;
      }
      cursor = next;
    }

    return res.status(200).json({
      status: "ok",
      source: session?.authType === "jwt" ? "Sorare authenticated GraphQL API" : session ? "Sorare OAuth GraphQL API" : "Sorare public GraphQL API",
      authenticated: Boolean(session),
      profileSlug: slug,
      count: items.length,
      items,
      endCursor: cursor,
      hasMore,
      pagesFetched,
      queryTier: QUERY_TIERS[activeTier].label,
      queryTierIndex: activeTier,
      apiKeyConfigured: Boolean(process.env.SORARE_API_KEY),
      dataQuality: dataQuality(items),
      diagnostic: {
        basicNamesResolved: items.filter(card => card.name !== card.slug).length,
        attemptedFallbacks: fallbackErrors.length,
        fallbackErrors: fallbackErrors.slice(-5)
      },
      fetchedAt: new Date().toISOString(),
      note: "Optional fields automatically fall back when not supported by the live Sorare GraphQL schema."
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
