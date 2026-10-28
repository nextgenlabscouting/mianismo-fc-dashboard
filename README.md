# NEXUS — Sorare Intelligence

NEXUS è una dashboard indipendente per leggere e organizzare una collezione Sorare, analizzare gli score storici disponibili e preparare bozze di formazione. **NEXUS è il nome dell'app; lo slug Sorare è soltanto l'account da cui leggere le carte.** L'interfaccia non è un prodotto ufficiale Sorare.

## Produzione

- App: https://mianismo-fc-dashboard.vercel.app/
- Repository: https://github.com/nextgenlabscouting/mianismo-fc-dashboard
- API carte: https://mianismo-fc-dashboard.vercel.app/api/public/cards
- Stato account: https://mianismo-fc-dashboard.vercel.app/api/auth/sorare/session

## Collegare l'account Sorare senza OAuth

NEXUS usa il flusso di autenticazione API documentato da Sorare tramite email, password hashata con bcrypt nel browser e mutazione GraphQL `signIn`. Non serve creare un'app OAuth né registrare un redirect URI.

1. In **Vercel Project Settings → Environment Variables**, configura `SORARE_SESSION_SECRET` con un segreto casuale di almeno 32 caratteri. È usato per cifrare il cookie di sessione.
2. Salva la variabile e ridistribuisci il progetto.
3. Apri NEXUS, vai su **Sorare Sync** e inserisci email e password Sorare. Se Sorare richiede 2FA, inserisci il codice monouso ricevuto.

La password viene hashata nel browser usando il salt restituito da Sorare. L'endpoint di login riceve l'hash, non la password originale. Email e hash non vengono scritti nei log o salvati come preferenze; il JWT Sorare viene conservato in un cookie HttpOnly cifrato AES-256-GCM e scade secondo la data restituita da Sorare (normalmente fino a 30 giorni). NEXUS non può revocare il JWT Sorare: il logout cancella la sessione locale. Il flusso 2FA dà precedenza alla sfida OTP anche se Sorare allega il marcatore legacy `2fa_missing`. Se la sfida non arriva, NEXUS mostra un errore recuperabile invece di richiedere un codice impossibile da verificare.

**Sicurezza:** usa solo il dominio HTTPS ufficiale di NEXUS, non inserire credenziali Sorare in copie o siti non verificati e non condividere il cookie di sessione. Il login diretto è documentato da Sorare, ma i suoi requisiti possono cambiare; se il provider modifica l'API, l'accesso potrebbe richiedere un aggiornamento.

## Inventario e sincronizzazione

- All'avvio e poi ogni **2 minuti**, mentre la pagina è visibile, NEXUS verifica la sessione Sorare, legge l'account collegato (oppure usa il profilo pubblico predefinito `mianismo` quando non si è autenticati) e prova a recuperare tutte le pagine dell'inventario.
- Le carte si importano e aggiornano in automatico: nome, immagine disponibile, squadra, rarità, stagione, variante, Power/Grade, storico score e prossime partite solo quando l'API espone quei campi. I doppioni vengono riconciliati con lo slug carta.
- Quando si collega un altro account, l'inventario Sorare importato in precedenza viene separato da quello del nuovo account. Le eventuali schede aggiunte a mano sono conservate.
- La paginazione è rallentata in modalità pubblica per rispettare i limiti noti dell'API Sorare. Un aggiornamento completo può richiedere buona parte dell'intervallo di due minuti per collezioni grandi; se Sorare limita le richieste, NEXUS conserva l'ultimo inventario valido invece di cancellarlo con dati incompleti.
- La griglia di performance colora L5/L10 e ruolo; il mini-grafico mostra gli ultimi punteggi effettivamente disponibili. La telemetria di squadra usa solo i dati presenti nell'inventario. Se Sorare non fornisce un logo ufficiale della squadra, la carta mostra una sigla testuale, non un logo inventato.
- `data/sorare-public.json` è una copia pubblica secondaria aggiornata dal workflow GitHub Actions ogni sei ore; la UI live interroga le API serverless su Vercel.

## Limiti ufficiali da conoscere

L'autenticazione diretta rende disponibili i dati che Sorare espone al JWT dell'account. Non garantisce l'accesso a dati non esposti dallo schema API, né rende automaticamente disponibili saldo Gems, premi riservati o formazioni future. Documentazione ufficiale: [Sorare API](https://github.com/sorare/api).

## Test

Con Node.js 20 o successivo:

```bash
node scripts/test-cards-api.cjs
node scripts/test-sorare-sync.mjs
node scripts/test-sorare-login.cjs
node scripts/test-dashboard-syntax.mjs
```

I valori locali di risorse, note e formazione sono dati modificabili salvati nel browser, non una conferma ufficiale del saldo Sorare. Le medie L5/L10/L15 sono valori storici, non previsioni garantite.
