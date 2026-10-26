# MIANISMO FC Dashboard

Dashboard personale per Sorare.

## Componenti

- Dashboard statica pubblicata su GitHub Pages.
- Sincronizzazione periodica dei dati Sorare pubblici in `data/sorare-public.json`.
- Worker API separato in `worker/`, in sola lettura, per richieste al backend.

## Pubblicare il Worker API su Cloudflare

Il Worker si chiama `mianismo-sorare-api` ed è separato dal sito statico.

1. In Cloudflare crea un API Token con i permessi minimi necessari per distribuire Workers sul tuo account.
2. In GitHub apri **Settings → Secrets and variables → Actions → New repository secret**.
3. Aggiungi questi due repository secrets:
   - `CLOUDFLARE_API_TOKEN`: il token API Cloudflare.
   - `CLOUDFLARE_ACCOUNT_ID`: l'ID account Cloudflare.
4. Non inserire mai questi valori nel codice, nelle issue pubbliche o in chat.
5. Vai su **Actions → Deploy MIANISMO Sorare API → Run workflow**. Il deploy parte anche quando modifichi i file in `worker/` sul branch `main`.

## Endpoint dopo il deploy

Sostituisci `WORKER_URL` con l'URL assegnato da Cloudflare.

- `GET /health` — controllo servizio.
- `GET /api/public/profile?slug=mianismo` — verifica profilo pubblico.
- `GET /api/public/cards?slug=mianismo` — prima pagina di carte pubbliche.
- Per paginare, passa il valore `endCursor` restituito come parametro `after`.

## Limiti e sicurezza

- Questa API è pubblica e in sola lettura: non effettua azioni sul tuo account Sorare.
- Non utilizza password Sorare, JWT o chiavi private.
- Restituisce solo i campi che l'API pubblica Sorare consente di leggere; non garantisce saldo, inventario privato o tutti i dati di ogni carta.
- Le richieste dipendono da disponibilità, schema e limiti dell'API Sorare.
- I segreti di deploy devono restare in GitHub Actions Secrets, mai nel repository.
