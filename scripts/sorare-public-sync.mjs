import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const ENDPOINT = 'https://api.sorare.com/graphql';
const SLUG = (process.env.SORARE_USER_SLUG || 'mianismo').trim();
const OUTPUT = 'data/sorare-public.json';
const PAGE_SIZE = 50;
const MAX_PAGES = 8;

async function gql(query, variables = {}) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      'user-agent': 'MIANISMO-FC-Dashboard/2.0 (public read-only sync)'
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000)
  });
  const responseText = await response.text();
  let body = {};
  try { body = responseText ? JSON.parse(responseText) : {}; } catch {}
  const messages = Array.isArray(body.errors)
    ? body.errors.map(e => e?.message || 'GraphQL error').join('; ')
    : '';
  if (!response.ok) {
    const detail = messages || (typeof body.message === 'string' ? body.message : '') || responseText.slice(0, 300);
    throw new Error(`Sorare API HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  if (messages) throw new Error(messages.slice(0, 400));
  if (!body.data) throw new Error('La risposta GraphQL non contiene data.');
  return body.data;
}

function cleanError(error) {
  return String(error?.message || error || 'Errore sconosciuto')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/\S+/g, '[url]')
    .slice(0, 220);
}
function average(values) {
  const scores = (Array.isArray(values) ? values : [])
    .filter(value => value != null && Number.isFinite(Number(value))).map(Number);
  return scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length * 10) / 10 : null;
}
function normalizeCard(card) {
  const rawScores = Array.isArray(card.rawSo5Scores)
    ? card.rawSo5Scores.filter(value => value != null && Number.isFinite(Number(value))).map(Number)
    : [];
  const skin = card.skinEdition || null;
  return {
    slug: card.slug,
    assetId: card.assetId || null,
    name: card.anyPlayer?.displayName || card.name || card.slug,
    team: card.anyTeam?.name || null,
    position: Array.isArray(card.anyPositions) ? card.anyPositions : [],
    imageUrl: card.pictureUrl || card.ipfsPictureUrl || null,
    playerImageUrl: card.anyPlayer?.pictureUrl || null,
    rarity: card.displayRarity || card.rarity || card.rarityTyped || 'Unknown',
    rarityTyped: card.rarityTyped || null,
    season: card.seasonYear ?? null,
    serialNumber: card.serialNumber ?? null,
    edition: card.customCardEditionName || card.formattedCardEditionName || card.cardEditionName || card.specialEdition || null,
    specialEdition: card.specialEdition || null,
    set: card.cardSet ? { name: card.cardSet.name, slug: card.cardSet.slug } : null,
    skinEdition: skin ? { skin: skin.skin || null, skinName: skin.skinName || null, variant: skin.variant || null, variantName: skin.variantName || null, bonus: skin.bonus ?? null } : null,
    power: card.power ?? null,
    grade: card.grade ?? null,
    age: card.age ?? null,
    rawScores,
    l5: average(rawScores.slice(0, 5)),
    l10: average(rawScores.slice(0, 10)),
    source: 'Sorare GraphQL API'
  };
}

async function findProfile() {
  const query = `query PublicUser($slug: String!) { user(slug: $slug) { slug nickname } }`;
  const data = await gql(query, { slug: SLUG });
  return data.user || null;
}

async function fetchCardPages(field) {
  const items = [];
  const seen = new Set();
  let cursor = null;
  let truncated = false;
  const query = `query PublicUserCards($slug: String!, $cursor: String, $first: Int!) {
    user(slug: $slug) {
      ${field}(first: $first, after: $cursor) {
        nodes {
          __typename slug assetId name
          anyPlayer { displayName pictureUrl }
          anyTeam { name }
          anyPositions
          pictureUrl(derivative: "full")
          ipfsPictureUrl
          rarityTyped displayRarity seasonYear serialNumber
          cardEditionName customCardEditionName formattedCardEditionName specialEdition
          skinEdition { skin skinName variant variantName bonus }
          cardSet { name slug }
          power grade
          ... on Card { age rarity customCardEditionName rawSo5Scores(last: 10) }
        }
        pageInfo { endCursor hasNextPage }
      }
    }
  }`;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await gql(query, { slug: SLUG, cursor, first: PAGE_SIZE });
    const connection = data?.user?.[field];
    if (!connection) throw new Error(`La connessione ${field} non è disponibile per questo profilo.`);
    for (const rawCard of connection.nodes || []) {
      if (!rawCard?.slug) continue;
      const key = rawCard.assetId || rawCard.slug;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(normalizeCard(rawCard));
    }
    const next = connection.pageInfo?.endCursor || null;
    if (!connection.pageInfo?.hasNextPage || !next || next === cursor) return { items, truncated: false, endCursor: next };
    cursor = next;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  return { items, truncated, endCursor: cursor };
}

async function main() {
  const report = {
    schemaVersion: 2,
    source: 'Sorare GraphQL API — public read-only probe',
    requestedSlug: SLUG,
    updatedAt: new Date().toISOString(),
    status: 'error',
    statusLabel: 'Controllo non riuscito',
    profile: { found: false, slug: SLUG, nickname: null },
    cards: { status: 'unavailable', count: null, items: [], truncated: false, endCursor: null, dataQuality: null, message: 'Non ancora verificato.' },
    message: 'Controllo non ancora completato.',
    detail: 'Verranno salvati solo dati ottenuti dalla fonte pubblica.'
  };
  try {
    const profile = await findProfile();
    if (!profile) {
      report.status = 'profile_not_found_or_not_public';
      report.statusLabel = 'Profilo non risolto';
      report.message = `L'API pubblica non ha restituito un profilo con slug "${SLUG}".`;
      report.detail = 'Il link My Club può usare un identificativo diverso dallo slug del manager, oppure i dati possono non essere esposti senza autenticazione.';
    } else {
      report.profile = { found: true, slug: profile.slug || SLUG, nickname: profile.nickname || null };
      report.status = 'ok';
      report.statusLabel = 'Profilo risolto';
      let cardResult;
      let lastCardError;
      for (const field of ['cards', 'paginatedCards']) {
        try { cardResult = await fetchCardPages(field); break; } catch (error) { lastCardError = error; }
      }
      if (cardResult) {
        const items = cardResult.items;
        report.cards = {
          status: 'available',
          count: items.length,
          items,
          truncated: cardResult.truncated,
          endCursor: cardResult.endCursor || null,
          dataQuality: {
            withCardImage: items.filter(card => card.imageUrl).length,
            withPlayerImage: items.filter(card => card.playerImageUrl).length,
            withVariant: items.filter(card => card.skinEdition).length,
            withRecentScores: items.filter(card => card.rawScores.length).length
          },
          message: items.length ? 'Carte con dettagli pubblici ricevute.' : 'La query è riuscita ma non ha restituito carte.'
        };
        report.statusLabel = cardResult.truncated ? 'Profilo e collezione parzialmente sincronizzati' : 'Profilo e collezione sincronizzati';
        report.message = `Profilo pubblico trovato; ${items.length} carte con dettagli recuperate.`;
        report.detail = cardResult.truncated
          ? 'L’elenco è parziale: usa endCursor per la pagina successiva. Le medie sono basate solo sui punteggi storici pubblicamente disponibili.'
          : 'Sono inclusi immagine carta, immagine giocatore, rarità, variante, bonus variante se esposto, squadra e punteggi storici disponibili. L’endpoint pubblico non certifica dati privati.';
      } else {
        report.cards = { status: 'unavailable', count: null, items: [], truncated: false, endCursor: null, dataQuality: null, message: 'Collezione non accessibile con la query pubblica.', detail: cleanError(lastCardError) };
        report.message = 'Profilo pubblico trovato, ma la query della collezione non è riuscita.';
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
  console.log(JSON.stringify({ status: report.status, profileFound: report.profile.found, cardStatus: report.cards.status, cardCount: report.cards.count, message: report.message }, null, 2));
}
main().catch(async error => {
  const minimal = { schemaVersion: 2, source: 'Sorare GraphQL API', requestedSlug: SLUG, updatedAt: new Date().toISOString(), status: 'error', statusLabel: 'Errore interno', profile: { found: false, slug: SLUG }, cards: { status: 'unavailable', count: null, items: [], truncated: false, message: 'Controllo fallito.' }, message: 'Non è stato possibile completare il controllo.', detail: cleanError(error) };
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(minimal, null, 2) + '\n', 'utf8');
  console.error(cleanError(error));
});
