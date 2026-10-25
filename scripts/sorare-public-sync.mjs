import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const ENDPOINT = 'https://api.sorare.com/graphql';
const SLUG = (process.env.SORARE_USER_SLUG || 'mianismo').trim();
const OUTPUT = 'data/sorare-public.json';
const MAX_PAGES = 8;

async function gql(query, variables = {}) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      'user-agent': 'MIANISMO-FC-Dashboard/1.0 (public read-only sync)'
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Sorare API HTTP ${response.status}`);
  if (Array.isArray(body.errors) && body.errors.length) {
    const message = body.errors.map(e => e?.message || 'GraphQL error').join('; ');
    throw new Error(message.slice(0, 280));
  }
  if (!body.data) throw new Error('La risposta GraphQL non contiene data.');
  return body.data;
}

function cleanError(error) {
  return String(error?.message || error || 'Errore sconosciuto')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/https?:\/\/\S+/g, '[url]')
    .slice(0, 220);
}

async function findProfile() {
  const queries = [
    `query PublicUser($slug: String!) { user(slug: $slug) { slug nickname } }`,
    `query PublicUser($slug: String!) { user(slug: $slug) { slug } }`
  ];
  let lastError;
  for (const query of queries) {
    try {
      const data = await gql(query, { slug: SLUG });
      return data.user || null;
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('Impossibile interrogare il profilo pubblico.');
}

async function fetchCardPages(field) {
  const items = [];
  let cursor = null;
  let truncated = false;
  const query = `query PublicUserCards($slug: String!, $cursor: String) {
    user(slug: $slug) {
      ${field}(after: $cursor) {
        nodes { slug }
        pageInfo { endCursor }
      }
    }
  }`;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await gql(query, { slug: SLUG, cursor });
    const connection = data?.user?.[field];
    if (!connection) throw new Error(`La connessione ${field} non è disponibile per questo profilo.`);
    for (const item of (connection.nodes || [])) {
      if (item?.slug) items.push({ slug: String(item.slug), name: String(item.slug) });
    }
    const next = connection.pageInfo?.endCursor || null;
    if (!next || next === cursor) return { items, truncated: false };
    cursor = next;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  return { items, truncated };
}

async function main() {
  const report = {
    schemaVersion: 1,
    source: 'Sorare GraphQL API — public read-only probe',
    requestedSlug: SLUG,
    updatedAt: new Date().toISOString(),
    status: 'error',
    statusLabel: 'Controllo non riuscito',
    profile: { found: false, slug: SLUG, nickname: null },
    cards: { status: 'unavailable', count: null, items: [], truncated: false, message: 'Non ancora verificato.' },
    message: 'Controllo non ancora completato.',
    detail: 'Verranno salvati solo dati ottenuti dalla fonte pubblica.'
  };

  try {
    const profile = await findProfile();
    if (!profile) {
      report.status = 'profile_not_found_or_not_public';
      report.statusLabel = 'Profilo non risolto';
      report.message = `L'API pubblica non ha restituito un profilo con slug "${SLUG}".`;
      report.detail = 'Il link My Club può usare un identificativo diverso dallo slug del manager, oppure i dati possono non essere esposti senza autenticazione. Il test non ha utilizzato credenziali.';
    } else {
      report.profile = { found: true, slug: profile.slug || SLUG, nickname: profile.nickname || null };
      report.status = 'ok';
      report.statusLabel = 'Profilo risolto';
      report.message = 'Profilo pubblico trovato. Ora verifichiamo se la collezione è accessibile.';
      report.detail = 'Il profilo è stato risolto con una query pubblica; la disponibilità delle carte viene testata separatamente.';
      let cardResult;
      let lastCardError;
      for (const field of ['cards', 'paginatedCards']) {
        try { cardResult = await fetchCardPages(field); break; }
        catch (error) { lastCardError = error; }
      }
      if (cardResult) {
        report.cards = {
          status: 'available',
          count: cardResult.items.length,
          items: cardResult.items,
          truncated: cardResult.truncated,
          message: cardResult.items.length ? 'Identificativi carta ricevuti dalla fonte pubblica.' : 'La query è riuscita ma non ha restituito identificativi di carta.'
        };
        report.message = cardResult.items.length
          ? `Profilo pubblico trovato; ${cardResult.items.length} identificativi di carta recuperati.`
          : 'Profilo trovato; la query sulle carte non ha restituito elementi.';
        report.detail = cardResult.truncated
          ? 'L’elenco è parziale: è stato raggiunto il limite prudenziale di pagine per singola esecuzione.'
          : 'Il report contiene solo gli identificativi resi disponibili dall’API pubblica, non saldo, rewards o altre informazioni private.';
      } else {
        report.cards = { status: 'unavailable', count: null, items: [], truncated: false, message: 'Collezione non accessibile con la query pubblica.', detail: cleanError(lastCardError) };
        report.message = 'Profilo pubblico trovato, ma la query della collezione non è riuscita.';
        report.detail = 'Il profilo si risolve; per leggere le carte dovremo verificare il campo GraphQL disponibile o la necessità di autorizzazione. Nessuna credenziale è stata usata.';
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

main().catch(async (error) => {
  const minimal = { schemaVersion: 1, source: 'Sorare GraphQL API', requestedSlug: SLUG, updatedAt: new Date().toISOString(), status: 'error', statusLabel: 'Errore interno', profile: { found: false, slug: SLUG }, cards: { status: 'unavailable', count: null, items: [], truncated: false, message: 'Controllo fallito.' }, message: 'Non è stato possibile completare il controllo.', detail: cleanError(error) };
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(minimal, null, 2) + '\n', 'utf8');
  console.error(cleanError(error));
});
