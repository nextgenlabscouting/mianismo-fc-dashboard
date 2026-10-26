const SORARE_ENDPOINT = "https://api.sorare.com/graphql";
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
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request)
    }
  });
}

async function sorareGraphQL(query, variables = {}) {
  const response = await fetch(SORARE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "MIANISMO-FC-Dashboard/1.0 (public read-only API)"
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

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    if (request.method !== "GET") {
      return json(request, { error: "Method not allowed. Use GET." }, 405);
    }

    if (url.pathname === "/health") {
      return json(request, {
        status: "ok",
        project: "MIANISMO FC",
        service: "Sorare public read-only API",
        connectedToSorare: false,
        timestamp: new Date().toISOString()
      });
    }

    if (url.pathname === "/api/public/profile") {
      const slug = (url.searchParams.get("slug") || "mianismo").trim();
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(slug)) {
        return json(request, { error: "Invalid profile slug." }, 400);
      }

      try {
        const query = `query PublicUser($slug: String!) { user(slug: $slug) { slug nickname } }`;
        const data = await sorareGraphQL(query, { slug });
        const user = data.user || null;
        return json(request, {
          status: user ? "ok" : "not_found",
          source: "Sorare public GraphQL API",
          profile: user ? { slug: user.slug || slug, nickname: user.nickname || null } : null,
          fetchedAt: new Date().toISOString()
        });
      } catch (error) {
        return json(request, {
          status: "error",
          error: String(error?.message || "Sorare public API request failed").slice(0, 240)
        }, 502);
      }
    }

    if (url.pathname === "/api/public/cards") {
      const slug = (url.searchParams.get("slug") || "mianismo").trim();
      const after = url.searchParams.get("after") || null;
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(slug)) {
        return json(request, { error: "Invalid profile slug." }, 400);
      }
      if (after && after.length > 500) {
        return json(request, { error: "Invalid pagination cursor." }, 400);
      }

      const fields = ["cards", "paginatedCards"];
      let lastError = null;
      for (const field of fields) {
        try {
          const query = `query PublicUserCards($slug: String!, $cursor: String) {
            user(slug: $slug) {
              ${field}(after: $cursor) {
                nodes { slug }
                pageInfo { endCursor }
              }
            }
          }`;
          const data = await sorareGraphQL(query, { slug, cursor: after });
          const connection = data?.user?.[field];
          if (!connection) throw new Error(`Sorare did not return the ${field} connection.`);
          const items = (connection.nodes || []).filter((item) => item?.slug).map((item) => ({
            slug: String(item.slug),
            name: String(item.slug)
          }));
          const endCursor = connection.pageInfo?.endCursor || null;
          return json(request, {
            status: "ok",
            source: "Sorare public GraphQL API",
            profileSlug: slug,
            count: items.length,
            items,
            endCursor,
            hasMore: Boolean(endCursor && endCursor !== after),
            fetchedAt: new Date().toISOString(),
            note: "Public read-only data only. This endpoint does not expose private account information."
          });
        } catch (error) {
          lastError = error;
        }
      }
      return json(request, {
        status: "unavailable",
        error: String(lastError?.message || "Could not read public cards").slice(0, 240),
        profileSlug: slug,
        items: []
      }, 502);
    }

    return json(request, {
      error: "Route not found.",
      availableRoutes: ["/health", "/api/public/profile?slug=mianismo", "/api/public/cards?slug=mianismo"]
    }, 404);
  }
};
