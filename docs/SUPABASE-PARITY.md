# Supabase UAT parity

GitHub `main` är source of truth för LT Studios Supabase-schema och Edge Functions.

## Verifierat 2026-10-08

Supabase-projekt: `bwbhnotpuuhgghjpmflk`.

### Edge Functions

Följande live-funktioner är verifierade byte-för-byte mot GitHub `main`:

- `operator-admin`
- `uat-bootstrap`
- `verify-customer-invoice-document`
- `manual-customer-payment`
- `resolve-unplaced-payment`
- `company-activate`

### Migration history

Live-databasen och repo:t har samma logiska migrationsinnehåll på flera senare ändringar, men vissa live-poster har andra versionsnummer än motsvarande GitHub-fil. Dessa alias dokumenteras i:

`supabase/migration-history-parity.json`

Det finns även repo-migrationer som inte har en 1:1-post i live-historiken. Dessa får **inte** markeras som applied enbart utifrån filnamn. För varje sådan migration måste schemaeffekten verifieras mot live-databasen först.

## Säker reparationsregel

Använd endast Supabases officiella migration-history-reparation:

`supabase migration repair <version> --status applied|reverted`

Skriv inte direkt i `supabase_migrations.schema_migrations`.

Innan en repair:

1. verifiera att migrationens schemaeffekt redan finns live,
2. dokumentera motsvarande live/repo-version,
3. kör clean rebuild från GitHub,
4. kör Supabase Security Advisor,
5. gör repair,
6. kör `supabase migration list` igen och spara resultatet i GitHub-issue/PR.

## Viktigt

Att en migration saknas i live-historiken betyder inte automatiskt att schemaändringen saknas live. Äldre UAT-ändringar har delvis applicerats via sammanlagda migrationer eller andra verktygsflöden. Därför är blind history repair förbjuden.
