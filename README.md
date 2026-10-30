# NEXUS — Divination Intelligence

NEXUS è una dashboard indipendente per leggere e organizzare una collezione Sorare, analizzare gli score storici disponibili e preparare bozze di formazione. **NEXUS è il nome dell'app; lo slug Sorare è soltanto l'account da cui leggere le carte.** L'interfaccia non è un prodotto ufficiale Sorare.

## Produzione

- App: https://mianismo-fc-dashboard.vercel.app/
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

Il regolamento generale Sorare Set descrive team composti da cinque o più carte secondo lo sport. Tuttavia, non riutilizzare automaticamente cap, numero di vite, soglie, MVP, tier, prezzi dei pack, odds, missioni o bonus del Set precedente. Questi parametri vanno verificati nel Game Board Divination in-app. Il cap L10 120 e l'MVP escluso mostrati dal lineup builder restano uno scenario operativo, non una regola Divination confermata.

Ordine consigliato F2P: riscuotere/controllare le ricompense già maturate, verificare i saldi, leggere il board, completare le opportunità gratuite e solo dopo valutare l'uso di Essence o Gems. Evita di rottamare carte prima di controllare collezioni, missioni e bonus.

## Collegare l'account Sorare senza OAuth

NEXUS usa il flusso di autenticazione API documentato da Sorare tramite email, password hashata con bcrypt nel browser e mutazione GraphQL `signIn`. Non serve creare un'app OAuth né registrare un redirect URI.

1. In **Vercel Project Settings → Environment Variables**, configura `SORARE_SESSION_SECRET` con un segreto casuale di almeno 32 caratteri. È usato per cifrare il cookie di sessione.
2. Salva la variabile e ridistribuisci il progetto.
3. Apri NEXUS, vai su **Sorare Sync** e inserisci email e password Sorare. Se Sorare richiede 2FA, inserisci il codice monouso ricevuto.

La password viene hashata nel browser usando il salt restituito da Sorare. L'endpoint di login riceve l'hash, non la password originale. Email e hash non vengono scritti nei log o salvati come preferenze; il JWT Sorare viene conservato in un cookie HttpOnly cifrato AES-256-GCM e scade secondo la data restituita da Sorare (normalmente fino a 30 giorni). NEXUS non può revocare il JWT Sorare: il logout cancella la sessione locale. Il flusso 2FA dà precedenza alla sfida OTP anche se Sorare allega il marcatore legacy `2fa_missing`. Se la sfida non arriva, NEXUS mostra un errore recuperabile invece di richiedere un codice impossibile da verificare.

**Sicurezza:** usa solo il dominio HTTPS ufficiale di NEXUS, non inserire credenziali Sorare in copie o siti non verificati e non condividere il cookie di sessione. Il login diretto è documentato da Sorare, ma i suoi requisiti possono cambiare; se il provider modifica l'API, l'accesso potrebbe richiedere un aggiornamento.

## Inventario e sincronizzazione

- All'avvio e poi ogni **2 minuti**, mentre la pagina è visibile, NEXUS verifica la sessione e legge esclusivamente lo slug restituito per l'account autenticato. Non importa un profilo pubblico predefinito come se fosse la collezione dell'utente non autenticato.
- Una sincronizzazione è dichiarata completa soltanto se la sessione è autenticata, gli endpoint confermano lo stesso profilo e tutte le pagine superano i controlli. Una risposta parziale può essere mostrata come parziale, ma non aggiorna il catalogo né viene conteggiata come inventario totale.
- Al termine di una sincronizzazione completa, l'archivio Sorare viene riconciliato con le carte attuali: le vecchie carte non più presenti vengono rimosse, le note manuali delle carte corrispondenti sono mantenute e le carte aggiunte manualmente vengono conservate. Un inventario completo vuoto è distinto da un errore API.
- Se l'API limita le richieste o la paginazione non termina, NEXUS marca l'inventario come non verificato e non importa il sottoinsieme ricevuto.
- La griglia di performance colora L5/L10 e ruolo; il mini-grafico mostra gli ultimi punteggi effettivamente disponibili. La telemetria di squadra usa solo i dati presenti nell'inventario. Se Sorare non fornisce un logo ufficiale della squadra, la carta mostra una sigla testuale, non un logo inventato.
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
