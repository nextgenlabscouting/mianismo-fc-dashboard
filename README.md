# MIANISMO FC — Sorare Command Center

Dashboard personale per monitorare le carte Sorare pubblicamente esposte, consultare dati disponibili e simulare una formazione Set senza fingere che le regole non confermate siano ufficiali.

## Link in produzione

- Dashboard: https://mianismo-fc-dashboard.vercel.app/
- Profilo pubblico: https://mianismo-fc-dashboard.vercel.app/api/public/profile?slug=mianismo
- API carte (prima pagina): https://mianismo-fc-dashboard.vercel.app/api/public/cards?slug=mianismo
- Repository e workflow: https://github.com/nextgenlabscouting/mianismo-fc-dashboard/actions

L’API carte restituisce un cursore `endCursor` e il flag `hasMore`. Per leggere le pagine successive passa il cursore come parametro URL `after`. La dashboard segue la paginazione, deduplica i risultati e mostra soltanto una parte della collezione per mantenere fluida l’interfaccia; il conteggio e l’importazione comprendono tutti i record ricevuti.

## Componenti

- `index.html`: interfaccia del Command Center, archivio paginato, Weekend Radar, Set Strategy Lab, gestione risorse, backup/importazione locale e stima dei premi fedeltà HyperGlitch sulla base di valori dichiarati.
- `api/public/cards.js` e `api/public/profile.js`: endpoint serverless in sola lettura usati dalla dashboard distribuita su Vercel.
- `scripts/sorare-public-sync.mjs`: aggiornamento periodico di `data/sorare-public.json`. Usa prima l’API Vercel, segue i cursori e rifiuta risposte prive di dettagli sufficienti.
- `worker/index.js`: endpoint alternativo separato, destinato a Cloudflare Workers se vengono configurati i segreti necessari.
- `scripts/test-cards-api.cjs`, `scripts/test-sorare-sync.mjs`, `scripts/test-dashboard-syntax.mjs`: test di regressione per l’API, la paginazione/qualità dati e la sintassi/sicurezza minima della UI.

La sincronizzazione GitHub Actions è programmata ogni sei ore; una modifica ai file dello script o del workflow avvia anche una sincronizzazione. La dashboard aggiorna l’API live mentre la pagina è aperta, con un intervallo di quindici minuti.

## Qualità e integrità dei dati

Il report espone conteggi distinti per immagini delle carte, ritratti dei giocatori, varianti, storico punteggi e partite in programma. Un ritratto non viene etichettato come artwork della carta. Se una nuova risposta non risolve almeno l’80% dei nomi e dei dettagli essenziali, la UI non importa il risultato degradato; lo script conserva l’ultimo inventario valido invece di sostituirlo con identificativi senza informazioni.

Le medie L5/L10/L15 sono storiche, non previsioni garantite. La data delle partite, i punteggi e i campi della carta dipendono da ciò che Sorare espone in quel momento.

## Regole Set e formazione

Sorare ha annunciato che HyperGlitch si è concluso il **27 ottobre 2026 alle 17:00 CET**, che le carte HyperGlitch non sono più idonee alle formazioni e che l’Essence HyperGlitch è persa. La dashboard mostra una stima separata dei premi fedeltà (Essence per fasce di completamento, bonus Gems per collezione e fascia Gems usate); non aggiunge questi valori al saldo locale e li indica come non confermati fino alla verifica su Sorare. Il lancio del nuovo Set è stato annunciato per il 30 ottobre 2026; al momento dell’aggiornamento di questo README i dettagli del nuovo regolamento non erano ancora stati pubblicati.

Per evitare formazioni ingannevoli, l’ottimizzatore esclude HyperGlitch e resta bloccato finché il nome del Set corrente non viene impostato in **Risorse**. Una volta scelto il nome, prende in considerazione solo le carte il cui Set restituito dall’API coincide con quel nome. Questo filtro non sostituisce la convalida ufficiale di Sorare: prima di inviare una formazione bisogna comunque controllare il tabellone, il cap, i ruoli e i requisiti pubblicati per il nuovo Set.

Fonte ufficiale: [Sorare — From Hyperglitch to…](https://sorare.com/blog/football/%F0%9F%86%95-from-hyperglitch-to-%F0%9F%91%80).

## Esecuzione dei test

Con Node.js 22, dalla directory principale del repository:

```bash
node scripts/test-cards-api.cjs
node scripts/test-sorare-sync.mjs
node scripts/test-dashboard-syntax.mjs
```

I test sono eseguiti da GitHub Actions in caso di modifiche ai file che influenzano l’API, la sincronizzazione, i test o la dashboard.

## Sicurezza e limiti

- Le API descritte qui sono in sola lettura. Non inviano formazioni, non riscattano premi e non modificano l’account Sorare.
- La dashboard non chiede password Sorare, JWT o chiavi private.
- Il saldo Gems, le risorse, le note e la formazione salvata localmente nel browser sono un registro personale, non una lettura certificata del saldo o dello stato account.
- Non vengono inventati immagini, punteggi, partite, premi o regole mancanti.
- I segreti di deploy devono essere conservati in GitHub Actions Secrets, mai nel repository, nei log pubblici o nelle chat.
