# NEXUS — Divination Intelligence

NEXUS è una dashboard indipendente per leggere e organizzare una collezione Sorare, analizzare gli score storici disponibili e preparare bozze di formazione. **NEXUS è il nome dell'app; lo slug Sorare è soltanto l'account da cui leggere le carte.** L'interfaccia non è un prodotto ufficiale Sorare.

## Produzione

- App: https://mianismo-fc-dashboard.vercel.app/
- Mirror statico GitHub Pages: reindirizza automaticamente all'app Vercel; non ospita le API di autenticazione.
- Repository: https://github.com/nextgenlabscouting/mianismo-fc-dashboard
- API carte: https://mianismo-fc-dashboard.vercel.app/api/public/cards
- Stato account: https://mianismo-fc-dashboard.vercel.app/api/auth/sorare/session

## Divination — Set attivo dal 30 ottobre 2026

NEXUS adotta l'identità Divination: interfaccia scura con palette viola/oro, una pagina **Divination Hub** e una checklist operativa per il passaggio al nuovo Set. Il nome NEXUS resta il brand dell'app; Divination è il Set Sorare attualmente selezionato.

### Snapshot storico Hyperglitch

Le ricompense di transizione mostrate in NEXUS sono stime basate sullo snapshot storico che avevi dichiarato, non su dati live dell'account:
- Completamento Hyperglitch: 80% → stima 8.000 Essence del nuovo Set (1.000 per ogni 10%).
- Soglia collezione ≥70%: +10 Gems.
- Fascia Gems spese 200–349 (ricompense escluse): +15 Gems.
- Bonus Gems stimato: +25. Le 320 Gems riportate prima del passaggio e le 345 Gems teoriche dopo il bonus non sono un saldo corrente verificato.
- L'Essence Hyperglitch residua non viene trasferita. Le vecchie carte restano nello storico/archivio ma non sono idonee alle formazioni del nuovo Set.

La pagina **Risorse** separa il completamento storico Hyperglitch dal completamento corrente Divination. NEXUS non può leggere via questa integrazione i saldi Gems, Essence o il completamento della collezione: inserisci i valori correnti solo dopo averli verificati su Sorare.

### Meccaniche base Sorare Set Football

Il Centro Assistenza Sorare descrive una formazione di cinque carte: portiere, difensore, centrocampista, attaccante e un giocatore extra. Ogni livello parte con quattro vite; un tentativo che non raggiunge il target consuma una vita, mentre esaurirle riporta al primo livello. Una volta validato il target, la progressione è immediata. Il punteggio della serie non viene modificato da aggiornamenti arrivati oltre cinque minuti dalla fine della partita.

La guida generale descrive cinque Tier (Icon, Star, Impact, Roster, Reserve), pack Bronze/Silver/Gold, scarto permanente di carte in cambio di Essence, Collection Bonus fino al 5%, Daily/Collection Missions e Wheel Tickets. Queste sono meccaniche generali di Sorare Set Football, non una conferma automatica di prezzi, odds, target, premi o eccezioni specifiche del board Divination: verifica sempre la schermata in-app. Fonte: [Centro Assistenza Sorare — Cos’è Sorare Set (Football)](https://sorare.com/it/help/a/33949360053917/qu-est-ce-que-sorare-set-football).

### Regole del nuovo board

Il regolamento generale Sorare Set descrive team composti da cinque o più carte secondo lo sport. Tuttavia, non riutilizzare automaticamente cap, numero di vite, soglie, MVP, tier, prezzi dei pack, odds, missioni o bonus del Set precedente. Questi parametri vanno verificati nel Game Board Divination in-app. Il modello a cinque slot e l'eventuale cap L10 con esclusione del valore più alto restano parametri operativi da confrontare con il Game Board: NEXUS non li considera regole Divination confermate. Il cap è disattivato per impostazione predefinita e si applica soltanto quando viene attivato manualmente.

## Separazione Football / NBA

NEXUS mantiene **due archivi distinti**: `state.cards` per Football e `state.nbaCards` per NBA. Le carte vecchie vengono riclassificate durante la migrazione usando lo sport dichiarato da Sorare e, quando manca, i ruoli/metadata riconoscibili. I record senza indicazioni affidabili restano in `unclassifiedCards`: non vengono assegnati a caso. Ogni carta salvata riporta il proprio campo `sport`.

Il selettore laterale **Football / NBA** cambia workspace. Galleria, Scores, Market, Edge Lab, riepilogo e filtri leggono esclusivamente l'archivio dello sport attivo. Anche l'inserimento manuale richiede la scelta dello sport e usa ruoli diversi (calcio oppure Guard / Forward / Center). Il backup esporta e reimporta i due archivi separatamente e mantiene distinti i rispettivi ID.

La sincronizzazione usa il parametro ufficiale Sorare `sport` ed effettua due letture indipendenti: `FOOTBALL` e `NBA`. NEXUS sostituisce le carte salvate soltanto quando entrambe le letture e l'identità dell'account risultano complete; in caso contrario conserva l'archivio precedente. Le carte con sport incompatibile o non verificabile non vengono inserite nell'archivio sbagliato.

Il **Divination Lineup Lab resta esclusivamente Football**: usa solo le carte Football e non è visibile nel workspace NBA. Non viene riutilizzato per il basket perché i ruoli e i criteri di formazione sono differenti; il generatore NBA sarà una funzione separata, non una variante del lineup calcistico.

### NEXUS Smart Lineup

Il **Lineup Lab** genera una formazione con un solo pulsante. Inserisci il punteggio da raggiungere e le ore mancanti alla chiusura (da 1 a 336, predefinite 48). NEXUS considera soltanto carte Divination verificate con ruolo riconosciuto, una prossima partita futura restituita da Sorare entro la finestra scelta e una media L5 disponibile. Confronta più combinazioni, impedisce di selezionare due carte dello stesso giocatore e ordina le proposte in base al punteggio storico atteso, alla variabilità e all'indice modellato di raggiungimento del target. Mostra la prima scelta e fino a due alternative distinte applicabili con un clic.

Il cap L10 è facoltativo e disattivato all'apertura. Quando lo attivi, NEXUS richiede L10 per tutti i giocatori e applica il modello locale dei quattro valori L10 più bassi (il valore più alto viene escluso): usalo solo se il Game Board conferma che questa è la regola applicabile. I giocatori senza una prossima partita leggibile, con kickoff fuori dalla finestra o senza punteggi recenti sufficienti non vengono inventati né inseriti. La sorgente fixture attuale espone la prossima partita disponibile per carta, non l'intero calendario.

Le stime si basano su medie e variabilità storiche e includono il bonus d'edizione soltanto quando Sorare lo restituisce come moltiplicatore numerico valido nella carta; i bonus mancanti non vengono inventati. Non conoscono formazione titolare, infortuni, difficoltà dell'avversario o altri bonus ufficiali non esposti dall'API. L'indice target è un indicatore matematico interno, non una probabilità reale di vittoria. NEXUS prepara e salva la bozza nel browser; non invia la formazione a Sorare e non certifica l'idoneità ufficiale.

Ordine consigliato F2P: riscuotere/controllare le ricompense già maturate, verificare i saldi, leggere il board, completare le opportunità gratuite e solo dopo valutare l'uso di Essence o Gems. Evita di rottamare carte prima di controllare collezioni, missioni e bonus.

## Collegare l'account Sorare senza OAuth

NEXUS usa il flusso di autenticazione API documentato da Sorare tramite email, password hashata con bcrypt nel browser e mutazione GraphQL `signIn`. Non serve creare un'app OAuth né registrare un redirect URI.

1. In **Vercel Project Settings → Environment Variables**, configura `SORARE_SESSION_SECRET` con un segreto casuale di almeno 32 caratteri. È usato per cifrare il cookie di sessione.
2. Salva la variabile e ridistribuisci il progetto.
3. Apri NEXUS, vai su **Sorare Sync** e inserisci email e password Sorare una sola volta. Se Sorare richiede 2FA, inserisci il codice monouso ricevuto. NEXUS ripristina poi la sessione dal cookie e usa l'archivio locale alle aperture successive; per aggiornare le carte usa manualmente **Rileggi dati**.

La password viene hashata nel browser usando il salt restituito da Sorare. L'endpoint di login riceve l'hash, non la password originale. Email e hash non vengono scritti nei log o salvati come preferenze; il JWT Sorare viene conservato in un cookie HttpOnly cifrato AES-256-GCM e scade secondo la data restituita da Sorare (normalmente fino a 30 giorni). NEXUS non può revocare il JWT Sorare: il logout cancella la sessione locale. Il flusso 2FA dà precedenza alla sfida OTP anche se Sorare allega il marcatore legacy `2fa_missing`. Se la sfida non arriva, NEXUS mostra un errore recuperabile invece di richiedere un codice impossibile da verificare.

**Sicurezza:** usa solo il dominio HTTPS ufficiale di NEXUS, non inserire credenziali Sorare in copie o siti non verificati e non condividere il cookie di sessione. Il login diretto è documentato da Sorare, ma i suoi requisiti possono cambiare; se il provider modifica l'API, l'accesso potrebbe richiedere un aggiornamento.

## Inventario e sincronizzazione

- Dopo il login riuscito, NEXUS esegue una sincronizzazione iniziale e salva l'archivio nel browser. Alle aperture successive verifica soltanto il cookie di sessione e riapre le carte già salvate: **non rilegge la collezione e non richiede un nuovo login finché la sessione Sorare è valida**.
- Non esiste più il polling automatico ogni 2 minuti. Una nuova lettura completa parte solo dopo un nuovo login o quando l'utente preme **Rileggi dati**.
- Una sincronizzazione è dichiarata completa soltanto se la sessione è autenticata, gli endpoint confermano lo stesso profilo e tutte le pagine superano i controlli. Una risposta parziale non sostituisce l'archivio locale.
- Le carte Hyperglitch vengono escluse dall'importazione, rimosse dall'archivio locale esistente e filtrate anche dai backup importati. Questa pulizia riguarda esclusivamente NEXUS: non modifica né cancella le carte nell'account Sorare ufficiale.
- Al termine di una sincronizzazione completa, l'archivio Sorare viene riconciliato con le carte attuali: le vecchie carte non più presenti vengono rimosse, le note manuali delle carte corrispondenti sono mantenute e le carte aggiunte manualmente vengono conservate.
- Se l'API limita le richieste o la paginazione non termina, NEXUS conserva l'ultimo archivio valido e non importa un sottoinsieme incompleto.
- La griglia di performance colora L5/L10 e ruolo; il mini-grafico mostra gli ultimi punteggi effettivamente disponibili. La telemetria di squadra usa solo i dati presenti nell'inventario.
- `data/sorare-public.json` è una copia pubblica secondaria aggiornata dal workflow GitHub Actions ogni sei ore; la UI live interroga le API serverless su Vercel.

## Saldi e ricompense: cosa è verificato

Questa integrazione non legge direttamente il saldo Gems, il saldo Essence corrente o la percentuale di completamento della collezione. Per questi campi NEXUS mostra `—` finché non inserisci un valore manuale; il dato inserito manualmente è etichettato come tale, non come saldo verificato dall'API. Le stime di ricompensa sono stime basate sui dati inseriti, non saldo effettivo né prova di accredito. La documentazione Sorare descrive l'autenticazione JWT e la paginazione delle carte, ma non garantisce che ogni dato dell'interfaccia sia disponibile via API: [Sorare API](https://github.com/sorare/api).

## Test

Con Node.js 20 o successivo:

```bash
node scripts/test-cards-api.cjs
node scripts/test-sorare-sync.mjs
node scripts/test-sorare-login.cjs
node scripts/test-sorare-import.cjs
node scripts/test-dashboard-syntax.mjs
```

I valori manuali di risorse, note e formazione sono dati modificabili salvati nel browser, non una conferma ufficiale del saldo Sorare. L'archivio carte viene aggiornato come inventario corrente solo dopo una sincronizzazione completa autenticata. Le medie L5/L10/L15 sono valori storici, non previsioni garantite.
