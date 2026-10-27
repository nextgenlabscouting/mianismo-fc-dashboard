const SORARE_ENDPOINT = "https://api.sorare.com/graphql";

const CARD_QUERY_TIERS = [
  { label: "rich", fields: [
    "__typename slug assetId name",
    "anyPlayer { displayName fullPictureUrl avatarPictureUrl squaredPictureUrl age slug activeClub { name } rawPlayerGameScores(last: 15) nextGame { date statusTyped homeTeam { name } awayTeam { name } } }",
    "anyTeam { name } anyPositions",
    "pictureUrl(derivative: \"full\") ipfsPictureUrl",
    "rarityTyped displayRarity seasonYear serialNumber cardEditionName formattedCardEditionName specialEdition",
    "skinEdition { skin skinName variant variantName bonus } cardSet { name slug } power grade",
    "... on Card { age rarity customCardEditionName rawSo5Scores(last: 10) }"
  ]},
  { label: "skin-variant", fields: [
    "slug assetId rarityTyped seasonYear serialNumber",
    "anyPositions anyTeam { name }",
    "anyPlayer { displayName fullPictureUrl }",
    "pictureUrl(derivative: \"full\")",
    "skinEdition { skin skinName variant variantName bonus }"
  ]},
  { label: "edition-metadata", fields: [
    "slug assetId rarityTyped seasonYear serialNumber",
    "anyPositions anyTeam { name }",
    "anyPlayer { displayName }",
    "cardEditionName formattedCardEditionName specialEdition"
  ]},
  { label: "images-and-scores", fields: [
    "__typename slug assetId name",
    "anyPlayer { displayName fullPictureUrl }",
    "anyTeam { name } anyPositions",
    "pictureUrl(derivative: \"full\")",
    "rarityTyped seasonYear serialNumber",
    "... on Card { rawSo5Scores(last: 10) }"
  ]},
  { label: "scores", fields: [
    "slug assetId rarityTyped seasonYear serialNumber",
    "anyPositions anyTeam { name }",
    "anyPlayer { displayName }",
    "... on Card { rawSo5Scores(last: 10) }"
  ]},
  { label: "images", fields: [
    "slug assetId rarityTyped seasonYear serialNumber",
    "anyPositions anyTeam { name }",
    "anyPlayer { displayName fullPictureUrl }",
    "pictureUrl(derivative: \"full\")"
  ]},
  { label: "standard", fields: [
    "slug assetId rarityTyped seasonYear serialNumber",
    "anyPositions anyTeam { name }",
    "anyPlayer { displayName }"
  ]},
  { label: "slug-only", fields: ["slug"] }
];
const ALLOWED_ORIGINS = new Set([
  "https://nextgenlabscouting.github.io",
  "https://mianismo-fc-dashboard.pages.dev",
  "http://localhost:3000",
  "http://127.0.0.1:5500"
]);

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
function json(request, data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(request) }
  });
}
async function sorareGraphQL(query, variables = {}) {
  const response = await fetch(SORARE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "MIANISMO-FC-Dashboard/2.0 (public read-only API)" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000)
  });
  const responseText = await response.text();
  let body = {};
  try { body = responseText ? JSON.parse(responseText) : {}; } catch {}
  const messages = Array.isArray(body.errors) ? body.errors.map(error => error?.message || "GraphQL error").join("; ") : "";
  if (!response.ok) {
    const detail = messages || (typeof body.message === "string" ? body.message : "") || responseText.slice(0, 300);
    throw new Error(`Sorare API HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  if (messages) throw new Error(messages.slice(0, 400));
  if (!body.data) throw new Error("Sorare API returned no data");
  return body.data;
}
function average(values) {
  const numbers = (Array.isArray(values) ? values : []).filter(value => value != null && Number.isFinite(Number(value))).map(Number);
  return numbers.length ? Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length * 10) / 10 : null;
}
function scoreNumbers(values) {
  return (Array.isArray(values) ? values : [])
    .map(value => typeof value === "object" && value !== null
      ? (value.score ?? value.points ?? value.value ?? null)
      : value)
    .filter(value => value != null && Number.isFinite(Number(value)))
    .map(Number);
}
function average(values) {
  const numbers = scoreNumbers(values);
  return numbers.length ? Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length * 10) / 10 : null;
}
function normalizeCard(card) {
  const player = card.anyPlayer || {};
  const rawScores = scoreNumbers(card.rawSo5Scores);
  const playerRawScores = scoreNumbers(player.rawPlayerGameScores);
  const nextGame = player.nextGame || null;
  const skin = card.skinEdition || null;
  return {
    slug: card.slug,
    assetId: card.assetId || null,
    playerSlug: player.slug || null,
    name: player.displayName || card.name || card.slug,
    team: card.anyTeam?.name || null,
    activeTeam: player.activeClub?.name || null,
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
    skinEdition: skin ? { skin: skin.skin || null, skinName: skin.skinName || null, variant: skin.variant || null, variantName: skin.variantName || null, bonus: skin.bonus ?? null } : null,
    power: card.power ?? null,
    grade: card.grade ?? null,
    age: card.age ?? player.age ?? null,
    rawScores,
    playerRawScores,
    l5: average(playerRawScores.slice(0, 5)) ?? average(rawScores.slice(0, 5)),
    l10: average(playerRawScores.slice(0, 10)) ?? average(rawScores.slice(0, 10)),
    l15: average(playerRawScores.slice(0, 15)) ?? average(rawScores.slice(0, 15)),
    cardL5: average(rawScores.slice(0, 5)),
    upcomingGames: nextGame ? [{ date: nextGame.date || null, homeTeam: nextGame.homeTeam?.name || null, awayTeam: nextGame.awayTeam?.name || null, status: nextGame.statusTyped || null }] : [],
    source: "Sorare GraphQL API"
  };
}
function buildCardsQuery(field, tier) {
  const fields = CARD_QUERY_TIERS[tier].fields.join("\n                ");
  return [
    "query PublicUserCards($slug: String!, $cursor: String) {",
    "  user(slug: $slug) {",
    "    " + field + "(after: $cursor) {",
    "      nodes { " + fields + " }",
    "      pageInfo { endCursor }",
    "    }",
    "  }",
    "}"
  ].join("\n");
}
function cardQuality(items) {
  return {
    withCardImage: items.filter(card => card.imageUrl).length,
    withPlayerImage: items.filter(card => card.playerImageUrl).length,
    withVariant: items.filter(card => card.skinEdition || card.specialEdition || card.edition).length,
    withRecentScores: items.filter(card => card.rawScores.length || card.playerRawScores.length).length,
    withUpcomingGames: items.filter(card => card.upcomingGames.length).length
  };
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    const url = new URL(request.url);
    if (request.method !== "GET") return json(request, { error: "Method not allowed. Use GET." }, 405);

    if (url.pathname === "/health") {
      return json(request, { status: "ok", project: "MIANISMO FC", service: "Sorare public read-only API", connectedToSorare: false, timestamp: new Date().toISOString() });
    }
    if (url.pathname === "/api/public/profile") {
      const slug = (url.searchParams.get("slug") || "mianismo").trim();
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(slug)) return json(request, { error: "Invalid profile slug." }, 400);
      try {
        const data = await sorareGraphQL(`query PublicUser($slug: String!) { user(slug: $slug) { slug nickname } }`, { slug });
        const user = data.user || null;
        return json(request, { status: user ? "ok" : "not_found", source: "Sorare public GraphQL API", profile: user ? { slug: user.slug || slug, nickname: user.nickname || null } : null, fetchedAt: new Date().toISOString() });
      } catch (error) {
        return json(request, { status: "error", error: String(error?.message || "Sorare public API request failed").slice(0, 350) }, 502);
      }
    }
    if (url.pathname === "/api/public/cards") {
      const slug = (url.searchParams.get("slug") || "mianismo").trim();
      const after = url.searchParams.get("after") || null;
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(slug)) return json(request, { error: "Invalid profile slug." }, 400);
      if (after && after.length > 500) return json(request, { error: "Invalid pagination cursor." }, 400);
      try {
        let connection = null;
        let lastError = null;
        const fallbackErrors = [];
        let selectedField = "cards";
        let selectedTier = 0;

        for (const field of ["cards", "paginatedCards"]) {
          for (let tier = 0; tier < CARD_QUERY_TIERS.length; tier++) {
            try {
              const data = await sorareGraphQL(buildCardsQuery(field, tier), { slug, cursor: after });
              const candidate = data?.user?.[field];
              if (!candidate) throw new Error("Sorare did not return the " + field + " connection");
              connection = candidate;
              selectedField = field;
              selectedTier = tier;
              break;
            } catch (error) {
              lastError = error;
              fallbackErrors.push({ field, tier: CARD_QUERY_TIERS[tier].label, error: String(error?.message || error).slice(0, 220) });
            }
          }
          if (connection) break;
        }

        if (!connection) throw lastError || new Error("All Sorare card query variants failed");
        const items = (connection.nodes || []).filter(card => card?.slug).map(normalizeCard);
        const endCursor = connection.pageInfo?.endCursor || null;
        return json(request, {
          status: "ok",
          source: "Sorare public GraphQL API",
          profileSlug: slug,
          count: items.length,
          items,
          endCursor,
          hasMore: Boolean(endCursor && endCursor !== after),
          queryField: selectedField,
          queryTier: CARD_QUERY_TIERS[selectedTier].label,
          apiKeyConfigured: false,
          dataQuality: cardQuality(items),
          diagnostic: { attemptedFallbacks: fallbackErrors.length, fallbackErrors: fallbackErrors.slice(-5) },
          fetchedAt: new Date().toISOString(),
          note: "Public read-only data. Optional fields fall back automatically when the schema rejects them; pass endCursor as after for the next page."
        });
      } catch (error) {
        return json(request, {
          status: "unavailable",
          error: String(error?.message || "Could not read public cards").slice(0, 400),
          profileSlug: slug,
          items: []
        }, 502);
      }
    }
    return json(request, { error: "Route not found.", availableRoutes: ["/health", "/api/public/profile?slug=mianismo", "/api/public/cards?slug=mianismo"] }, 404);
  }
};
