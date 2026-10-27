import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const ENDPOINT = 'https://api.sorare.com/graphql';
const SLUG = (process.env.SORARE_USER_SLUG || 'mianismo').trim();
const OUTPUT = 'data/sorare-public.json';
const PAGE_SIZE_NOTE = 'Sorare uses cursor pagination; this sync stops at the configured safety limit.';
const MAX_PAGES = 9;

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
  { label: 'images-and-scores', fields: [
    '__typename slug assetId name',
    'anyPlayer { displayName fullPictureUrl }',
    'anyTeam { name } anyPositions',
    'pictureUrl(derivative: "full")',
    'rarityTyped seasonYear serialNumber',
    '... on Card { rawSo5Scores(last: 10) }'
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
      'user-agent': 'MIANISMO-FC-Dashboard/2.1 (public read-only sync)'
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
    '      pageInfo { endCursor hasNextPage }',
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
    if (connection.pageInfo?.hasNextPage === false || !next || next === cursor) {
      return { items, truncated: false, endCursor: next, queryTier: QUERY_TIERS[activeTier].label, fallbackErrors };
    }
    cursor = next;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  return { items, truncated, endCursor: cursor, queryTier: QUERY_TIERS[activeTier].label, fallbackErrors };
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

async function main() {
  const report = {
    schemaVersion: 3,
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

      for (const field of ['cards', 'paginatedCards']) {
        try {
          result = await fetchCardPages(field);
          break;
        } catch (error) {
          lastCardError = error;
        }
      }

      if (result) {
        report.cards = {
          status: 'available',
          count: result.items.length,
          items: result.items,
          truncated: result.truncated,
          endCursor: result.endCursor || null,
          queryTier: result.queryTier,
          dataQuality: cardQuality(result.items),
          message: result.items.length ? 'Carte pubbliche con dettagli disponibili ricevute.' : 'La query è riuscita ma non ha restituito carte.',
          detail: result.truncated ? PAGE_SIZE_NOTE : null,
          diagnostics: {
            attemptedFallbacks: result.fallbackErrors.length,
            fallbackErrors: result.fallbackErrors.slice(-5)
          }
        };
        report.statusLabel = result.truncated ? 'Inventario parzialmente sincronizzato' : 'Inventario sincronizzato';
        report.message = 'Profilo trovato; ' + result.items.length + ' identificativi carta elaborati.';
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

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({
    status: report.status,
    profileFound: report.profile.found,
    cardStatus: report.cards.status,
    cardCount: report.cards.count,
    queryTier: report.cards.queryTier,
    dataQuality: report.cards.dataQuality,
    message: report.message
  }, null, 2));
}

main().catch(async error => {
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
