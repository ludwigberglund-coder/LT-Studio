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


## Parity classification 2026-10-09

Efter live-verifiering och deployment av saknade säkerhetsmigrationer gäller:

- 86 migrationsfiler i GitHub `main`
- 61 poster i Supabase live migration history
- 16 kända alias där live-version och repo-timestamp skiljer sig
- 25 repo-only migrationer
- 25 av 25 repo-only migrationer har representativa schemaeffekter verifierade live
- 0 repo-only migrationer återstår som helt overifierade

Det betyder att den kvarvarande P0-frågan är migration-history-paritet, inte känd saknad schemafunktionalitet. History repair får fortfarande endast göras efter separat full effektgranskning per migration och via Supabases officiella `supabase migration repair`.

## AI-kvot: separat staging-paritet 2026-10-15

Detta avsnitt gäller **LT-Studio-Staging** (`rwnqkgbbbxjjfhwtepsi`) och förändrar **inte** UAT:s äldre aliaslista i `supabase/migration-history-parity.json` (den har `project_ref=bwbhnotpuuhgghjpmflk`).

| GitHub-migration | Staging live-version | Live-namn | Verifiering |
| --- | --- | --- | --- |
| `20261013071500_ai_pilot_atomic_quota.sql` | `20261015071358` | `ai_pilot_atomic_quota` | installerad 2026-10-15, båda tabeller, RPC och avstängt singleton-läge kontrollerade |

Migrationen applicerades från GitHub-filens oförändrade innehåll via Supabases migrationsverktyg. Schema, `enabled=false`, RLS, tabell- och RPC-behörigheter samt tom reservationskö kontrollerades efteråt. Supabase Security Advisor har två informationsnotiser om avsiktligt policylös RLS för AI-tabellerna. **UAT har inte fått migreringen.**

Framtida staging-`db push` måste hantera detta namngivna versionsalias via granskad Supabase-migreringshantering, annars finns risk att samma GitHub-migration uppfattas som väntande. Ändra aldrig historiken med rå SQL, och applicera aldrig AI-migrationen igen utan objekt-/historikkontroll. Se `docs/AI-PILOT-STAGING-PREFLIGHT.md` och [GitHub Issue #774](https://github.com/ludwigberglund-coder/LT-Studio/issues/774).


## AI-pilot: staging-paritet och avstängd Edge-installation 2026-10-22

Detta avsnitt gäller **endast** `LT-Studio-Staging` (`rwnqkgbbbxjjfhwtepsi`). Det ändrar inte UAT:s migrationsalias, produktionsnycklar eller bokföring. GitHub är alltid källan till kod, och alla driftavvikelser måste kontrolleras mot versionsstyrda filer.

| GitHub-källa | Installerad staging-version | Resultat |
| --- | --- | --- |
| `supabase/migrations/20261016171526_ai_pilot_shared_admission.sql` (PR #826) | `20261022134940_ai_pilot_shared_admission` | Tabell, server-RPC, RLS och nekad klientåtkomst verifierade |
| `supabase/functions/ai-bookkeeping-pilot/index.ts` med tillhörande 10 moduler (PR #826, commit `8a4eeaaf124df29a1c48d37239784a59a66754bb`) | Edge Function `ai-bookkeeping-pilot`, version 1 | 11 av 11 serverfiler jämförda tecken-för-tecken med GitHub-commiten och matchar |

Edge-paketets rapporterade SHA-256 är `6dd8ff99dce539c824ea5cbf1bbac343cec242fa5fe261418cfbf6c98c6b0d13`; stagingfunktionen rapporterades `ACTIVE` med `verify_jwt=false`. Det är avsiktligt för förfrågningarnas CORS-preflight; **intern autentisering krävs när release senare tillåts**.

**AI:n är inte aktiverad.** Den installerade funktionen har `RELEASE_APPROVED=false` och databasen har `ai_pilot_runtime_settings.enabled=false`. Serverns förstahandskontroll ska därför neka anrop innan autentisering, kvoter eller extern modellkontakt används. UAT-portalen använder ett **annat** Supabase-projekt och får inte visa staging-AI som tillgänglig. Ingen autentiserad HTTP-begäran, verkligt Cloudflare-svar eller secret-scope har verifierats vid denna mätpunkt.

**Säkerhetskontroll:** Tabellen `ai_pilot_admission_state` har RLS, och `anon`/`authenticated` saknar SELECT och EXECUTE på `admit_ai_pilot_request_server()`; endast `service_role` kan anropa. Ingen kunddata har använts.

**Historikregel:** De olika versionsnumren är ett dokumenterat staging-alias, inte en anledning att köra DDL igen. Rör **inte** `supabase_migrations.schema_migrations` direkt. Framtida migreringsreparation får endast göras enligt avsnittet *Säker reparationsregel* ovan, med verifierad schemaeffekt och officiellt verktyg.

**Driftstatus kan förändras efter 2026-10-22**. Kontrollera aktuell PR #826 och faktisk stagingversion före nästa deployment. Att en avstängd Edge Function är installerad innebär inte att piloten eller automatisk bokföring är klar.
