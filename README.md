# NEXUS — Sorare Intelligence

NEXUS è una dashboard indipendente per leggere e organizzare una collezione Sorare, analizzare gli score storici disponibili e preparare bozze di formazione. **NEXUS è il nome dell'app; lo slug Sorare è soltanto l'account da cui leggere le carte.** L'interfaccia non è un prodotto ufficiale Sorare.

## Produzione

- App: https://mianismo-fc-dashboard.vercel.app/
- Repository: https://github.com/nextgenlabscouting/mianismo-fc-dashboard
- OAuth callback: https://mianismo-fc-dashboard.vercel.app/api/auth/sorare/callback
- API carte: https://mianismo-fc-dashboard.vercel.app/api/public/cards
- Stato account: https://mianismo-fc-dashboard.vercel.app/api/auth/sorare/session

## Primo collegamento con Sorare (obbligatorio per il login)

NEXUS usa il flusso **OAuth Authorization Code** ufficiale: non chiede né memorizza la password Sorare. I token sono mantenuti in un cookie HttpOnly, cifrato con AES-256-GCM; il backend prova a rinnovarli usando il refresh token.

1. Aprire [Sorare Developer Settings](https://sorare.com/settings/developer) e creare una OAuth application.
2. Registrare esattamente questo Redirect URI: `https://mianismo-fc-dashboard.vercel.app/api/auth/sorare/callback`. L'URI registrato e quello configurato in Vercel devono corrispondere esattamente.
3. Nelle **Vercel Project Settings → Environment Variables**, aggiungere le variabili seguenti per gli ambienti da usare:

   - `SORARE_CLIENT_ID`: Client ID mostrato da Sorare.
   - `SORARE_CLIENT_SECRET`: secret OAuth mostrato da Sorare. Va tenuto segreto.
   - `SORARE_SESSION_SECRET`: segreto casuale di almeno 32 caratteri, da generare con un password manager o un generatore crittografico.
   - `SORARE_REDIRECT_URI`: `https://mianismo-fc-dashboard.vercel.app/api/auth/sorare/callback`.

4. Salvare le variabili e fare un nuovo deploy di Vercel. Poi usare **Accedi con Sorare** nell'app.

Non incollare mai qui, nel repository o nei log il Client Secret, il session secret, i token OAuth o chiavi API. Se il dominio di produzione viene cambiato, aggiornare anche il Redirect URI nella dashboard Sorare e la variabile `SORARE_REDIRECT_URI`.

## Inventario e sincronizzazione

- All'avvio e poi ogni **2 minuti**, mentre la pagina è visibile, NEXUS verifica la sessione Sorare, legge l'account collegato (oppure usa il profilo pubblico predefinito `mianismo` quando non si è autenticati) e prova a recuperare tutte le pagine dell'inventario.
- Le carte si importano e aggiornano in automatico: nome, immagine disponibile, squadra, rarità, stagione, variante, Power/Grade, storico score e prossime partite solo quando l'API espone quei campi. I doppioni vengono riconciliati con lo slug carta.
- Quando si collega un altro account, l'inventario Sorare importato in precedenza viene separato da quello del nuovo account. Le eventuali schede aggiunte a mano sono conservate.
- La paginazione è rallentata in modalità pubblica per rispettare i limiti noti dell'API Sorare. Un aggiornamento completo può richiedere buona parte dell'intervallo di due minuti per collezioni grandi; se Sorare limita le richieste, NEXUS conserva l'ultimo inventario valido invece di cancellarlo con dati incompleti.
- La griglia di performance colora L5/L10 e ruolo; il mini-grafico mostra gli ultimi punteggi effettivamente disponibili. La telemetria di squadra usa solo i dati presenti nell'inventario. Se Sorare non fornisce un logo ufficiale della squadra, la carta mostra una sigla testuale, non un logo inventato.
- `data/sorare-public.json` è una copia pubblica secondaria aggiornata dal workflow GitHub Actions ogni sei ore; la UI live interroga le API serverless su Vercel.

## Limiti ufficiali da conoscere

Il login OAuth rende disponibili le informazioni utente e le carte che Sorare autorizza attraverso i propri scope. La documentazione Sorare indica però che OAuth **non** concede accesso a email, future lineups e premi, riscossione premi o operazioni di trading come acquisti/vendite/offerte. Perciò NEXUS non finge di leggere saldo Gems, premi riservati o formazioni non esposte dall'API. Queste limitazioni non sono bug dell'interfaccia.

Documentazione ufficiale: [Sorare API / OAuth](https://github.com/sorare/api).

## Test

Con Node.js 20 o successivo:

```bash
node scripts/test-cards-api.cjs
node scripts/test-sorare-sync.mjs
node scripts/test-dashboard-syntax.mjs
```

I valori locali di risorse, note e formazione sono dati modificabili salvati nel browser, non una conferma ufficiale del saldo Sorare. Le medie L5/L10/L15 sono valori storici, non previsioni garantite.
