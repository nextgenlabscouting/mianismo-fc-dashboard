import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
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
assert.equal(elements.loyaltyEssenceEstimate.textContent, '8.000 Essence');
assert.equal(elements.loyaltyGemsEstimate.textContent, '25 Gems');
elements.collectionInput.value = '65';
elements.legacyGemsSpentBracket.value = '';
updateEstimate();
assert.equal(elements.loyaltyEssenceEstimate.textContent, '6.000 Essence');
assert.equal(elements.loyaltyGemsEstimate.textContent, '0+ Gems (fascia da verificare)');

console.log('Dashboard regression checks passed (' + (checks.length + 5) + ' assertions).');
