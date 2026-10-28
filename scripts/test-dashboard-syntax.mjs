import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length, 1, 'La dashboard deve avere un solo script inline principale');
assert.doesNotThrow(() => new Function(scripts[0][1]), 'Lo script inline della dashboard deve essere sintatticamente valido');

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
console.log('Dashboard regression checks passed (' + (checks.length + 1) + ' checks).');
