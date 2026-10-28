import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ENDPOINT = 'https://api.sorare.com/graphql';
const SLUG = (process.env.SORARE_USER_SLUG || 'mianismo').trim();
const OUTPUT = 'data/sorare-public.json';
const CARDS_API_URL = (process.env.SORARE_CARDS_API_URL || 'https://mianismo-fc-dashboard.vercel.app/api/public/cards').trim();
const PAGE_SIZE_NOTE = 'La sincronizzazione usa cursori e segnala esplicitamente se raggiunge il limite di sicurezza.';
const MAX_PAGES_RAW = Number.parseInt(process.env.SORARE_MAX_PAGES || '200', 10);
const MAX_PAGES = Number.isFinite(MAX_PAGES_RAW) ? Math.max(1, Math.min(500, MAX_PAGES_RAW)) : 200;

const QUERY_TIERS = [
{ label: 'rich', fields: [
    '__typename slug assetId name',
    'anyPlayer { displayName fullPictureUrl avatarPictureUrl squaredPictureUrl age slug activeClub { name } rawPlayerGameScores(last: 15) nextGame { date statusTyped homeTeam { name } awayTeam { name } } }',
    'anyTeam { name } anyPositions',
    'pictureUrl(derivative: "full") ipfsPictureUrl',
    'rarityTyped displayRarity seasonYear serialNumber cardEditionName formattedCardEditionName specialEdition',
    'skinEdition { skin skinName variant variantName bonus } cardSet { name slug } power grade',
    '... on Card { age rarity customCardEditionName rawSo5Scores(last: 10) }'
  ]},
  {
    label: 'card-details-with-fixtures',
    fields: [
      '__typename slug assetId name',
      'anyPlayer { displayName fullPictureUrl nextGame { date statusTyped homeTeam { name } awayTeam { name } } }',
      'anyTeam { name } anyPositions',
      'pictureUrl(derivative: "full") ipfsPictureUrl',
      'rarityTyped displayRarity seasonYear serialNumber cardEditionName formattedCardEditionName specialEdition',
      'skinEdition { skin skinName variant variantName bonus } cardSet { name slug } power grade',
      '... on Card { age rarity customCardEditionName rawSo5Scores(last: 10) }'
    ]
  },
  {
    label: 'card-details',
    fields: [
      '__typename slug assetId name',
      'anyPlayer { displayName fullPictureUrl }',
      'anyTeam { name } anyPositions',
      'pictureUrl(derivative: "full") ipfsPictureUrl',
      'rarityTyped displayRarity seasonYear serialNumber cardEditionName formattedCardEditionName specialEdition',
      'skinEdition { skin skinName variant variantName bonus } cardSet { name slug } power grade',
      '... on Card { age rarity customCardEditionName rawSo5Scores(last: 10) }'
    ]
  },
{ label: 'images-and-scores', fields: [
    '__typename slug assetId name',
    'anyPlayer { displayName fullPictureUrl }',
    'anyTeam { name } anyPositions',
    'pictureUrl(derivative: "full")',
    'rarityTyped seasonYear serialNumber',
    '... on Card { rawSo5Scores(last: 10) }'
  ]},
{ label: 'skin-variant', fields: [
    'slug assetId rarityTyped seasonYear serialNumber',
    'anyPositions anyTeam { name }',
    'anyPlayer { displayName fullPictureUrl }',
    'pictureUrl(derivative: "full")',
    'skinEdition { skin skinName variant variantName bonus }'
  ]},
{ label: 'edition-metadata', fields: [
    'slug assetId rarityTyped seasonYear serialNumber',
    'anyPositions anyTeam { name }',
    'anyPlayer { displayName }',
    'cardEditionName formattedCardEditionName specialEdition'
  ]},
{ label: 'scores', fields: [
    'slug assetId rarityTyped seasonYear serialNumber',
    'anyPositions anyTeam { name }',
    'anyPlayer { displayName }',
    '... on Card { rawSo5Scores(last: 10) }'
  ]},
{ label: 'images', fields: [
    'slug assetId rarityTyped seasonYear serialNumber',
    'anyPositions anyTeam { name }',
    'anyPlayer { displayName fullPictureUrl }',
    'pictureUrl(derivative: "full")'
  ]},
{ label: 'standard', fields: [
    'slug assetId rarityTyped seasonYear serialNumber',
    'anyPositions anyTeam { name }',
    'anyPlayer { displayName }'
  ]},
{ label: 'slug-only', fields: ['slug'] }
];

async function gql(query, variables = {}) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      'user-agent': 'MIANISMO-FC-Dashboard/2.1 (public read-only sync)',
      ...(process.env.SORARE_API_KEY ? { APIKEY: process.env.SORARE_API_KEY } : {})
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000)
  });
  const responseText = await response.text();
  let body = {};
  try { body = responseText ? JSON.parse(responseText) : {}; } catch {}
  const messages = Array.isArray(body.errors)
    ? body.errors.map(error => error?.message || 'GraphQL error').join('; ')
    : '';
  if (!response.ok) {
    const detail = messages || (typeof body.message === 'string' ? body.message : '') || responseText.slice(0, 300);
    throw new Error('Sorare API HTTP ' + response.status + (detail ? ': ' + detail : ''));
  }
  if (messages) throw new Error(messages.slice(0, 400));
  if (!body.data) throw new Error('La risposta GraphQL non contiene data.');
  return body.data;
}

function cleanError(error) {
  return String(error?.message || error || 'Errore sconosciuto')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/\S+/g, '[url]')
    .slice(0, 240);
}

function buildCardsQuery(field, tier) {
  const fields = QUERY_TIERS[tier].fields.join('\n                ');
  return [
    'query PublicUserCards($slug: String!, $cursor: String) {',
    '  user(slug: $slug) {',
    '    ' + field + '(after: $cursor) {',
    '      nodes { ' + fields + ' }',
    '      pageInfo { endCursor }',
    '    }',
    '  }',
    '}'
  ].join('\n');
}

function scoreNumbers(values) {
  return (Array.isArray(values) ? values : [])
    .map(value => typeof value === 'object' && value !== null
      ? (value.score ?? value.points ?? value.value ?? null)
      : value)
    .filter(value => value != null && Number.isFinite(Number(value)))
    .map(Number);
}

function average(values) {
  const numbers = scoreNumbers(values);
  return numbers.length
    ? Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length * 10) / 10
    : null;
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
    rarity: card.displayRarity || card.rarity || card.rarityTyped || 'Unknown',
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
    source: 'Sorare GraphQL API'
  };
}

async function findProfile() {
  const data = await gql(
    'query PublicUser($slug: String!) { user(slug: $slug) { slug nickname } }',
    { slug: SLUG }
  );
  return data.user || null;
}

async function fetchCardPages(field) {
  const items = [];
  const seen = new Set();
  const fallbackErrors = [];
  let cursor = null;
  let truncated = false;
  let activeTier = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    let connection = null;
    let lastError = null;

    for (let tier = activeTier; tier < QUERY_TIERS.length; tier++) {
      try {
        const data = await gql(buildCardsQuery(field, tier), { slug: SLUG, cursor });
        const candidate = data?.user?.[field];
        if (!candidate) throw new Error('La connessione ' + field + ' non è disponibile per questo profilo.');
        connection = candidate;
        activeTier = tier;
        break;
      } catch (error) {
        lastError = error;
        fallbackErrors.push({
          tier: QUERY_TIERS[tier].label,
          error: cleanError(error)
        });
      }
    }

    if (!connection) throw lastError || new Error('Tutte le query delle carte sono fallite.');

    for (const card of connection.nodes || []) {
      if (!card?.slug || seen.has(card.slug)) continue;
      seen.add(card.slug);
      items.push(normalizeCard(card));
    }

    const next = connection.pageInfo?.endCursor || null;
    if (!next || next === cursor || !(connection.nodes || []).length) {
      return { items, truncated: false, endCursor: next, queryTier: QUERY_TIERS[activeTier].label, fallbackErrors };
    }
    cursor = next;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return { items, truncated, endCursor: cursor, queryTier: QUERY_TIERS[activeTier].label, fallbackErrors };
}

async function fetchCardsViaProxy({ slug = SLUG, baseUrl = CARDS_API_URL, maxPages = MAX_PAGES } = {}) {
  const items = [];
  const seen = new Set();
  const cursors = new Set();
  const fallbackErrors = [];
  let cursor = null;
  let endCursor = null;
  let queryTier = null;
  let fetchedAt = null;
  let pagesFetched = 0;
  let truncated = false;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(baseUrl);
    url.searchParams.set('slug', slug);
    if (cursor) url.searchParams.set('after', cursor);
    else url.searchParams.delete('after');

    const response = await fetch(url.toString(), {
      headers: {
        accept: 'application/json',
        'user-agent': 'MIANISMO-FC-Dashboard/2.1 (public inventory sync)'
      },
      signal: AbortSignal.timeout(25000)
    });
    const responseText = await response.text();
    let body = {};
    try { body = responseText ? JSON.parse(responseText) : {}; } catch {}
    if (!response.ok || body.status !== 'ok' || !Array.isArray(body.items)) {
      const detail = body.error || body.message || responseText.slice(0, 220);
      throw new Error('Vercel cards API HTTP ' + response.status + (detail ? ': ' + detail : ''));
    }
    if (!body.items.length && body.hasMore) {
      throw new Error('La paginazione API ha segnalato altre pagine ma ha restituito una pagina vuota.');
    }

    for (const card of body.items) {
      const key = card?.assetId || card?.slug;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(card);
    }
    pagesFetched += 1;
    queryTier = body.queryTier || queryTier;
    fetchedAt = body.fetchedAt || fetchedAt;
    if (Array.isArray(body.diagnostic?.fallbackErrors)) {
      fallbackErrors.push(...body.diagnostic.fallbackErrors.map(item => ({
        tier: item.tier || 'api-fallback',
        error: cleanError(item.error || 'Fallback segnalato dal backend')
      })));
    }

    const next = body.endCursor || null;
    if (!body.hasMore || !next) {
      endCursor = next;
      truncated = false;
      break;
    }
    if (next === cursor || cursors.has(next)) {
      throw new Error('Cursor Sorare ripetuto: sincronizzazione interrotta per evitare duplicati o loop.');
    }
    cursors.add(next);
    cursor = next;
    endCursor = next;
    if (page === maxPages - 1) truncated = true;
  }

  return {
    items, truncated, endCursor, queryTier, fallbackErrors, pagesFetched,
    fetchedAt, sourceMode: 'vercel-api'
  };
}

function cardQuality(items) {
  const safe = Array.isArray(items) ? items : [];
  const nameResolved = card => Boolean(card?.name && card?.slug && String(card.name).trim().toLowerCase() !== String(card.slug).trim().toLowerCase());
  const hasUsefulData = card => Boolean(
    card?.imageUrl || card?.playerImageUrl || card?.team || card?.activeTeam ||
    (Array.isArray(card?.position) && card.position.length) ||
    (card?.rarityTyped && String(card.rarityTyped).toLowerCase() !== 'unknown') ||
    (Array.isArray(card?.rawScores) && card.rawScores.length) ||
    (Array.isArray(card?.playerRawScores) && card.playerRawScores.length)
  );
  return {
    withResolvedNames: safe.filter(nameResolved).length,
    withUsefulData: safe.filter(hasUsefulData).length,
    withCardImage: safe.filter(card => card?.imageUrl).length,
    withPlayerImage: safe.filter(card => card?.playerImageUrl).length,
    withVariant: safe.filter(card => card?.skinEdition || card?.specialEdition || card?.edition).length,
    withRecentScores: safe.filter(card => (Array.isArray(card?.rawScores) && card.rawScores.length) || (Array.isArray(card?.playerRawScores) && card.playerRawScores.length)).length,
    withUpcomingGames: safe.filter(card => Array.isArray(card?.upcomingGames) && card.upcomingGames.length).length
  };
}

function isUsableInventory(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  const quality = cardQuality(items);
  return quality.withResolvedNames / items.length >= 0.8 &&
    quality.withUsefulData / items.length >= 0.8;
}

async function readPreviousReport() {
  try {
    return JSON.parse(await readFile(OUTPUT, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const previousReport = await readPreviousReport();
  let report = {
    schemaVersion: 4,
    source: 'Sorare GraphQL API — public read-only sync',
    requestedSlug: SLUG,
    updatedAt: new Date().toISOString(),
    status: 'error',
    statusLabel: 'Controllo non riuscito',
    profile: { found: false, slug: SLUG, nickname: null },
    cards: {
      status: 'unavailable', count: null, items: [], truncated: false,
      endCursor: null, queryTier: null, dataQuality: null,
      message: 'Non ancora verificato.'
    },
    message: 'Controllo non ancora completato.',
    detail: 'Verranno salvati solo dati ottenuti dalla fonte pubblica.'
  };

  try {
    const profile = await findProfile();
    if (!profile) {
      report.status = 'profile_not_found_or_not_public';
      report.statusLabel = 'Profilo non risolto';
      report.message = 'L’API pubblica non ha restituito un profilo con slug "' + SLUG + '".';
      report.detail = 'Il profilo pubblico non è stato risolto; non sono state usate credenziali private.';
    } else {
      report.profile = { found: true, slug: profile.slug || SLUG, nickname: profile.nickname || null };
      report.status = 'ok';
      report.statusLabel = 'Profilo risolto';
      let result = null;
      let lastCardError = null;
      let proxyError = null;

      try {
        result = await fetchCardsViaProxy();
      } catch (error) {
        proxyError = error;
        lastCardError = error;
      }

      // Direct GraphQL is a fallback only. Its lower-access schema is rejected
      // later if it returns identifiers without resolved player/card details.
      if (!result) {
        for (const field of ['cards', 'paginatedCards']) {
          try {
            result = await fetchCardPages(field);
            result.sourceMode = 'direct-graphql';
            if (proxyError) result.fallbackErrors.unshift({ tier: 'vercel-api', error: cleanError(proxyError) });
            break;
          } catch (error) {
            lastCardError = error;
          }
        }
      }

      if (result && !isUsableInventory(result.items)) {
        lastCardError = new Error('Risposta inventario rifiutata: nomi o dettagli essenziali non risolti (' + result.items.length + ' record). Nessun dato degradato verrà presentato come inventario valido.');
        result = null;
      }

      if (result) {
        report.cards = {
          status: 'available',
          count: result.items.length,
          items: result.items,
          truncated: result.truncated,
          endCursor: result.endCursor || null,
          queryTier: result.queryTier,
          sourceMode: result.sourceMode || 'direct-graphql',
          pagesFetched: result.pagesFetched || null,
          fetchedAt: result.fetchedAt || null,
          stale: false,
          dataQuality: cardQuality(result.items),
          message: result.items.length ? 'Carte pubbliche con dettagli verificati ricevute.' : 'La query è riuscita ma non ha restituito carte.',
          detail: result.truncated ? PAGE_SIZE_NOTE : null,
          diagnostics: {
            attemptedFallbacks: result.fallbackErrors.length,
            fallbackErrors: result.fallbackErrors.slice(-8)
          }
        };
        report.statusLabel = result.truncated ? 'Inventario parzialmente sincronizzato' : 'Inventario sincronizzato';
        report.message = 'Profilo trovato; ' + result.items.length + ' carte con dettagli risolti elaborate tramite ' + (result.sourceMode || 'GraphQL') + '.';
        report.detail = result.truncated
          ? 'L’elenco supera il limite prudenziale per questa esecuzione; riavvia la sincronizzazione per proseguire.'
          : 'La disponibilità di immagini, varianti, punteggi e partite dipende dai campi esposti dall’API.';
      } else {
        report.cards = {
          status: 'unavailable', count: null, items: [], truncated: false,
          endCursor: null, queryTier: null, dataQuality: null,
          message: 'Collezione non accessibile con le query pubbliche.',
          detail: cleanError(lastCardError)
        };
        report.message = 'Profilo trovato, ma la query della collezione non è riuscita.';
        report.detail = cleanError(lastCardError);
      }
    }
  } catch (error) {
    report.status = 'error';
    report.statusLabel = 'Errore API';
    report.message = 'La richiesta alla fonte pubblica Sorare non è riuscita.';
    report.detail = cleanError(error);
    report.cards.message = 'Il controllo API è fallito prima di verificare le carte.';
  }

  const currentHasGoodData = report.cards?.status === 'available' && isUsableInventory(report.cards.items);
  const previousHasGoodData = previousReport?.cards?.status === 'available' && isUsableInventory(previousReport.cards.items);
  const candidateIsSuspiciouslySmall = currentHasGoodData && report.cards.truncated && previousHasGoodData &&
    report.cards.items.length < previousReport.cards.items.length * 0.8;

  if ((!currentHasGoodData || candidateIsSuspiciouslySmall) && previousHasGoodData) {
    const failedAttemptAt = new Date().toISOString();
    const reason = candidateIsSuspiciouslySmall
      ? 'Aggiornamento parziale molto più piccolo del precedente inventario valido.'
      : (report.detail || report.cards?.detail || report.message || 'La nuova risposta non ha superato i controlli di qualità.');
    report = {
      ...previousReport,
      status: 'stale',
      statusLabel: 'Ultimo inventario valido conservato',
      refreshAttemptedAt: failedAttemptAt,
      message: 'Aggiornamento non accettato; mantenuto l’ultimo inventario che aveva superato i controlli.',
      detail: reason,
      cards: {
        ...previousReport.cards,
        stale: true,
        refreshAttemptedAt: failedAttemptAt,
        refreshError: reason,
        message: 'Dati precedenti conservati: l’ultimo aggiornamento non ha superato i controlli di integrità.'
      }
    };
  } else if (!currentHasGoodData) {
    report.status = report.status === 'ok' ? 'degraded' : report.status;
    report.statusLabel = 'Inventario non verificato';
    report.cards = {
      ...report.cards,
      status: 'unavailable', count: null, items: [], dataQuality: null, stale: false,
      message: 'Nessun inventario salvato: la risposta ricevuta non ha superato i controlli di qualità.'
    };
  }

  report.updatedAt = report.status === 'stale' ? (previousReport?.updatedAt || report.updatedAt) : new Date().toISOString();
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({
    status: report.status,
    profileFound: report.profile.found,
    cardStatus: report.cards.status,
    cardCount: report.cards.count,
    truncated: report.cards.truncated,
    sourceMode: report.cards.sourceMode,
    pagesFetched: report.cards.pagesFetched,
    queryTier: report.cards.queryTier,
    dataQuality: report.cards.dataQuality,
    message: report.message
  }, null, 2));
}

export { fetchCardsViaProxy, cardQuality, isUsableInventory };

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(async error => {
  const minimal = {
    schemaVersion: 3,
    source: 'Sorare GraphQL API',
    requestedSlug: SLUG,
    updatedAt: new Date().toISOString(),
    status: 'error',
    statusLabel: 'Errore interno',
    profile: { found: false, slug: SLUG },
    cards: { status: 'unavailable', count: null, items: [], truncated: false, message: 'Controllo fallito.' },
    message: 'Non è stato possibile completare il controllo.',
    detail: cleanError(error)
  };
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(minimal, null, 2) + '\n', 'utf8');
  console.error(cleanError(error));
});
