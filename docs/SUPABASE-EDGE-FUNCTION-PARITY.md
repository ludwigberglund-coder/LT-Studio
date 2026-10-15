# Read-only jämförelse av driftsatta Supabase Edge Functions

Status: kontrollverktyg för #364 och #630. GitHub `main` och `supabase/config.toml` är källan. Verktyget gör **inga nätverksanrop** och ändrar aldrig Supabase, Auth, migrationshistorik eller kunddata.

## Vad testas?

Varje Edge Function som anges i GitHub-konfigurationen måste finnas i målmiljön, ha status `ACTIVE` och exakt samma `verify_jwt`-värde. Extra, dubblerade och felaktiga funktioner stoppar kontrollen. Detta är en metadata-kontroll, inte ett säkerhetsgodkännande av Edge-koden, dess autentisering, secrets eller driftversion.

## Körning med färsk metadata-snapshot

1. Läs aktuell GitHub `main` och `AGENTS.md`.
2. Hämta enbart Edge Function-metadata från **rätt** Supabase-projekt med behörig read-only `list_edge_functions`. Godkänt JSON-format är Management API:s funktionslista eller objektet `{"functions":[...]}` från verktyget. Eventuella exporter hålls **utanför Git-repositoryt**. Exportera inte tokens, request bodies eller kunddata.
3. Kör kontrollen på granskad GitHub-kod, utan nätverksåtkomst:

   `node scripts/verify-hosted-edge-parity.js --environment staging < /PRIVATE_PATH/staging-functions.json`

   Upprepa med `--environment uat` och en **separat** snapshot. Sökvägen är en platshållare, inte en begäran att lägga en fil i GitHub.
4. Exit code `0` och `"ok": true` betyder endast att **namn, ACTIVE-status och JWT-policy** matchar. Exit code `1` betyder avvikelse och `2` betyder felaktig indata. Rapporten visar enbart funktionsnamn och felkoder. Dokumentera miljö, datum, resultat och granskarens beslut i #364, aldrig råexport eller hemligheter i GitHub.

Testa parsern med syntetiska metadata: `node --test test/hosted-edge-parity.test.js`.

## Read-only verifierad drift 15 oktober 2026

- **Staging:** fem aktiva funktioner; GitHub `supabase/config.toml` beskriver sex. `company-activate` saknas.
- **UAT:** sex aktiva funktioner; `operator-admin` rapporterade `verify_jwt=true`, men GitHub-konfigurationen angav `false`.
- **Staging:** `operator-admin` rapporterade `verify_jwt=false`, vilket överensstämde med GitHub-konfigurationen.

**Ingen automatisk reparation.** JWT-skillnaden måste granskas mot Edge-funktionens egen tokenvalidering och avsiktliga releasepolicy. Att ändra JWT-inställningen utan analys kan antingen försvaga säkerheten eller bryta inloggning. Saknad `company-activate` får inte deployas automatiskt utan granskad staging-release, giltiga activation-invites och separata syntetiska testidentiteter.

## Stoppsignal

Vid varje avvikelse: #364 staging-signoff är **ej klar**. Eskalera till ansvarig agent och gör en separat förändrings-PR om fix behövs. Kontrollera även RLS, AAL2/sessioner, privata dokument, migrationsparitet, faktiska funktionshashar, syntetisk tenant-isolering och ekonomisk UAT.

**Arkitekturvarning:** `scripts/staging-monitoring-evidence.js` och `docs/STAGING-DEPLOYMENT.md` beskriver den äldre Node/SQLite-modellens `/api/v1/readiness/core`. Den routen får inte antas finnas i GitHub Pages + Supabase. Extern övervakning av nuvarande arkitektur kräver ett separat verifierat monitoreringsmål enligt #447.
