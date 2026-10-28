import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const authFiles = [
  '../lib/sorare-session.js',
  '../api/auth/sorare/salt.js',
  '../api/auth/sorare/password.js',
  '../api/auth/sorare/session.js',
  '../api/auth/sorare/logout.js',
  '../api/public/cards.js',
  '../api/public/profile.js'
];
const authSources = await Promise.all(authFiles.map(path => readFile(new URL(path, import.meta.url), 'utf8')));
for (const [index, source] of authSources.entries()) {
  assert.doesNotThrow(() => new Function(source), 'Il modulo deve essere sintatticamente valido: ' + authFiles[index]);
}

const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].filter(match => match[1].trim());
assert.equal(scripts.length, 1, 'La dashboard deve avere un solo script inline principale');
assert.doesNotThrow(() => new Function(scripts[0][1]), 'Lo script inline della dashboard deve essere sintatticamente valido');

const declaredIds = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]));
const referencedIds = new Set([...scripts[0][1].matchAll(/\$\(["']([^"']+)["']\)/g)].map(match => match[1]));
const missingIds = [...referencedIds].filter(id => !declaredIds.has(id));
assert.deepEqual(missingIds, [], 'Ogni riferimento DOM statico deve avere un id dichiarato');

const staticMarkup = html.split('<script>')[0];
const staticIds = [...staticMarkup.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
assert.equal(new Set(staticIds).size, staticIds.length, 'Gli id del markup statico devono essere univoci');

const checks = [
  [/const CARDS_PAGE_SIZE=60/, 'paginazione del catalogo'],
  [/cardsPrevPage.*addEventListener/s, 'pulsante pagina precedente collegato'],
  [/cardsNextPage.*addEventListener/s, 'pulsante pagina successiva collegato'],
  [/MAX_CLIENT_PAGES=100/, 'limite di sicurezza paginazione API'],
  [/seenCursors\.has\(next\)/, 'rilevamento cursori ripetuti'],
  [/cardsQualityGood=hasCardsResponse/, 'controllo qualità prima dell’importazione'],
  [/eligibleCandidates=state\.cards\.filter\(isTargetSetCard\)/, 'ottimizzatore limitato al Set selezionato dall’utente'],
  [/function currentTargetSet\(\)/, 'nessuna formazione senza un Set selezionato'],
  [/legacyEssenceExpired=true/, 'migrazione Essence HyperGlitch scaduta'],
  [/reportItems=items\.slice\(0,60\)/, 'limite rendering del pannello tecnico'],
  [/function variantBonusLabel\(value\)/, 'bonus variante visualizzato in percentuale'],
  [/function updateLoyaltyRewardEstimate\(\)/, 'stima premi fedeltà implementata'],
  [/rewardByBracket=\{'750\+':60,'500-749':40,'350-499':25,'200-349':15,'100-199':10,'50-99':5\}/, 'fasce Gems allineate alla tabella ufficiale'],
  [/legacyGemsSpentBracket.*addEventListener/s, 'fascia Gems aggiorna la stima in tempo reale'],
  [/Dati conservati/, 'stato stale visibile'],
  [/function openModal\(/, 'editor carte implementato'],
  [/function deleteCard\(/, 'eliminazione carta implementata'],
  [/function saveResourcesFromForm\(/, 'salvataggio risorse implementato'],
  [/function resetResources\(/, 'ripristino risorse implementato'],
  [/function exportBackup\(/, 'esportazione backup implementata'],
  [/function importBackupFromFile\(/, 'importazione backup implementata'],
  [/\$\("cardForm"\)\.addEventListener\("submit",saveCardFromForm\)/, 'submit del modulo carta collegato'],
  [/\$\("resourcesForm"\)\.addEventListener\("submit",saveResourcesFromForm\)/, 'submit del modulo risorse collegato'],
  [/\$\("exportData"\)\.addEventListener\("click",exportBackup\)/, 'pulsante esportazione collegato'],
  [/\$\("importFile"\)\.addEventListener\("change",importBackupFromFile\)/, 'input importazione collegato']
,
  [/<title>NEXUS — Sorare Intelligence<\/title>/, 'brand indipendente dall’account'],
  [/id="page-analytics"/, 'Edge Lab presente come area autonoma'],
  [/function edgeMetrics\(card\)/, 'Edge Index calcolato su medie e volatilità disponibili'],
  [/function renderEdgeLab\(\)/, 'Decision Queue e classifica aggiornate dalla collezione'],
  [/id="edgeBoardBody"/, 'Edge Board renderizzato'],
  [/id="edgeRoleCoverage"/, 'copertura dati per ruolo renderizzata'],
  [/renderEdgeLab\(\);/, 'Edge Lab incluso nel ciclo di aggiornamento'],
  [/function scoreClass\(value\)/, 'colori punteggi basati sui valori reali'],
  [/function renderAnalytics\(\)/, 'telemetria dinamica per ruolo'],
  [/id="roleDistribution"/, 'grafico distribuzione ruoli'],
  [/id="rolePerformance"/, 'grafico media L5 per ruolo'],
  [/function updateSorareAuthUI\(session\)/, 'stato account Sorare diretto'],
  [/setInterval\(\(\)=>\{if\(!document\.hidden\)loadSorarePublicData\(\);\},120000\)/, 'sincronizzazione ogni 2 minuti'],
  [/const KEY='nexusSorareIntelligenceV1';/, 'chiave locale con il nuovo brand'],
  [/localStorage.getItem\('mianismoFcDashboardV1'\)/, 'migrazione dei dati salvati dalla vecchia versione']
];

for (const [pattern, label] of checks) {
  assert.match(html, pattern, 'Manca il controllo UI: ' + label);
}

const helperStart = scripts[0][1].indexOf('function updateLoyaltyRewardEstimate(){');
const helperEnd = scripts[0][1].indexOf('\nfunction renderResourcesForm(){', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Il calcolo loyalty deve essere estraibile per test');
const helperSource = scripts[0][1].slice(helperStart, helperEnd);
const elements = {
  collectionInput: { value: '80' },
  legacyGemsSpentBracket: { value: '200-349' },
  loyaltyEssenceEstimate: { textContent: '' },
  loyaltyGemsEstimate: { textContent: '' },
  loyaltyRewardDetail: { textContent: '' }
};
const updateEstimate = new Function('$', 'state', 'num', 'fmt', helperSource + String.fromCharCode(10) + 'return updateLoyaltyRewardEstimate;')(
  id => elements[id] || { value: '' },
  { resources: { collection: 80, legacyGemsSpentBracket: '200-349' } },
  value => Number.isFinite(Number(value)) ? Number(value) : 0,
  value => Number(value).toLocaleString('it-IT', { maximumFractionDigits: 1 })
);
updateEstimate();
assert.match(elements.loyaltyEssenceEstimate.textContent, /^8.?000 Essence$/);
assert.equal(elements.loyaltyGemsEstimate.textContent, '25 Gems');
elements.collectionInput.value = '65';
elements.legacyGemsSpentBracket.value = '';
updateEstimate();
assert.match(elements.loyaltyEssenceEstimate.textContent, /^6.?000 Essence$/);
assert.equal(elements.loyaltyGemsEstimate.textContent, '0+ Gems (fascia da verificare)');

assert.match(authSources[0], /createCipheriv\("aes-256-gcm"/, 'Il token Sorare deve essere cifrato nella sessione');
assert.match(authSources[0], /HttpOnly; SameSite=Lax/, 'La sessione deve usare cookie HttpOnly SameSite=Lax');
assert.match(authSources[0], /session.authType !== "jwt"/, 'La sessione deve riconoscere il JWT diretto Sorare');
assert.match(authSources[1], /api\/v1\/users\//, 'Il backend deve recuperare il salt ufficiale Sorare');
assert.match(authSources[2], /otpSessionChallenge/, 'Il login deve gestire la verifica 2FA');
assert.match(authSources[2], /writeSession\(res/, 'Il login deve creare una sessione cifrata');
assert.match(authSources[3], /getValidSession/, 'L’endpoint sessione deve verificare il token');
assert.match(authSources[5], /JWT-AUD/, 'L’API carte deve inviare JWT-AUD per il token Sorare');
assert.match(authSources[6], /JWT-AUD/, 'L’API profilo deve inviare JWT-AUD per il token Sorare');
assert.match(html, /bcryptjs@2\.4\.3/, 'Il modulo password deve hashare nel browser');
assert.doesNotMatch(html, /window\.location\.href=['"]\/api\/auth\/sorare\/login/, 'Il pulsante non deve usare OAuth');
assert.doesNotMatch(html, /previousSorare/, 'L’importazione non deve riferirsi a una variabile non definita');
assert.match(html, /if\(idx===undefined\)\{indexBySlug\.set\(card\.slug,merged\.length\);merged\.push\(item\);added\+\+;\}/, 'Le carte nuove incrementano il contatore senza dipendenze esterne');

console.log('Dashboard regression checks passed (' + (checks.length + authSources.length + 11) + ' assertions).');
