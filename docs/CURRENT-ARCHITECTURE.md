# Current Architecture — LT Studio

Senast verifierad: 2026-10-09.

Detta dokument beskriver **det faktiska nuläget** i LT Studio. Vid konflikt med äldre arkitekturdokument gäller detta dokument tillsammans med aktuell GitHub `main`, CI-resultat och verifierad Supabase-UAT.

## Source of truth

GitHub är source of truth för:

- applikationskod,
- Supabase-migrationer,
- Edge Functions,
- tester,
- offentlig konfiguration,
- dokumentation,
- release- och ändringshistorik.

Runtime-data, användarkonton, ekonomidata och privata dokument lagras inte i GitHub.

## Delad UAT idag

Den delade UAT-miljön består av:

- **GitHub Pages** för det statiska gränssnittet,
- **Supabase PostgreSQL** för delad verksamhetsdata,
- **Supabase Auth + MFA** för personlig autentisering,
- **Row Level Security** och företagsmedlemskap för tenant-isolering,
- **Supabase Storage** för privata dokument,
- **Supabase Realtime** för utvalda delade tabeller,
- **Postgres RPC:er** för kontrollerade affärsflöden,
- **Supabase Edge Functions** för servergränser som inte ska köras direkt från webbläsaren.

UAT är fortfarande en testmiljö och ska inte beskrivas som färdig produktion.

## Frontend

Aktiv portal:

- `apps/portal/`

Aktiv Driftadmin/operatorportal:

- `apps/operator/`

Kompatibilitetsingång:

- `apps/admin/`

Publik webb:

- `apps/website/`

GitHub Pages publicerar den statiska frontend-koden. Frontend innehåller inte service-role-nycklar eller andra serverhemligheter.

## Supabase

Versionsstyrd källa:

- `supabase/migrations/`
- `supabase/functions/`
- `supabase/config.toml`

Aktiva Edge Functions i UAT som senast verifierats mot GitHub `main`:

- `operator-admin`
- `uat-bootstrap`
- `verify-customer-invoice-document`
- `manual-customer-payment`
- `resolve-unplaced-payment`
- `company-activate`

Dessa verifierades 2026-10-08 byte-för-byte mot GitHub `main`.

## Företagsisolering

Ett företag är en tenant.

Privat företagsdata kopplas till `company_id`.

Användares tillgång avgörs av:

- personlig Supabase-identitet,
- aktiv session,
- MFA/AAL2 där det krävs,
- medlemskap i `company_memberships`,
- roll,
- RLS/policyer,
- server-RPC/Edge Function för känsliga skrivningar.

UI-begränsningar räknas inte som säkerhetsgräns.

## Ekonomiska skrivningar

Ekonomiska kärntabeller skyddas mot fria direkta ändringar.

Känsliga flöden använder bland annat:

- kontrollerade RPC:er,
- financial write guards,
- idempotensnycklar,
- audit events,
- bunt-/godkännandeflöden,
- periodsäkring,
- tenant-kontroller.

Exempel på aktuella flöden:

- kundfakturor och kredit,
- manuella kundinbetalningar,
- oplacerade betalningar,
- buntgodkännande,
- leverantörsfakturor,
- bankavstämning,
- lager,
- lön,
- periodlås,
- kundkreditkvittning.

## Oplacerade betalningar

Manuella oplacerade betalningar går via serverflöde och skapas i `bank_payments` med status `unmatched`.

Migrationen som korrigerar financial-write-guard för detta flöde är versionsstyrd i GitHub och applicerad i UAT.

## Multi-company onboarding

Driftadmin kan skapa kundföretag via onboardingflödet.

Aktiveringsflödet använder separata activation invites och serverkontroller.

Aktuell härdning omfattar bland annat:

- högst en aktiv oanvänd activation invite per företag,
- säkra roller/medlemskap,
- skydd mot att ta bort sista aktiva admin,
- verifierad tenant-isolering,
- separat operator-/kundgräns.

## Sessioner och lösenord

Driftadmin-lösenord följer starkare krav och HIBP-kontroll.

Administrativ lösenordsreset verifierar gamla sessioner efter reset innan systemet får rapportera att sessionsåterkallning är bekräftad.

Databasens personliga sessionsskydd kontrollerar bland annat JWT `session_id` mot `auth.sessions`.

## Dokument och Storage

Privata dokument ligger i Supabase Storage, inte GitHub.

Färdigställda dokument ska inte kunna raderas genom vanlig browseråtkomst.

Storage DELETE-policy skyddar både generella dokumentposter och färdigställda kundfakturadokument.

## Realtime

Utvalda tenant-tabeller publiceras via Supabase Realtime.

För tenanttabeller där DELETE-filtrering behöver `company_id` används `REPLICA IDENTITY FULL`.

Realtime ersätter inte RLS eller tenant-auktorisering.

## Migrationer och parity

GitHub ska kunna återskapa databasen från tom miljö.

CI kör **Supabase clean rebuild** från GitHub-migrationerna.

Parity-status och kända skillnader mellan GitHub-filnamn och Supabase live migration history dokumenteras i:

- `supabase/migration-history-parity.json`
- `docs/SUPABASE-PARITY.md`

Kvarvarande skillnader i migration history får inte repareras med rå SQL. Använd Supabases officiella migration-repair-flöde efter verifiering.

## Legacy/lokal backend

Följande finns kvar för regression, lokal utveckling eller historisk referens:

- `apps/api/`
- `public/`
- `server.js`
- äldre Node/SQLite/JSON-flöden

De ska **inte** beskrivas som den aktiva delade UAT-backenden.

De kan fortfarande vara viktiga för tester och jämförelse och ska därför inte tas bort utan separat beslut.

## CI och releasegrind

Normalt arbetsflöde:

`senaste main → branch → ändring → tester → PR → Quality/CodeQL/Supabase clean rebuild → merge → UAT-verifiering`

Kritiska kontroller omfattar bland annat:

- full Git-history secret scan,
- browser-secret scan,
- syntax,
- automatiska tester,
- dependency audit,
- statisk build,
- CodeQL,
- Supabase clean rebuild,
- databasfunktionslint,
- säkerhetskontrakt,
- visuella/browserbaserade smoke-tester.

En grön GitHub Pages-deploy är inte samma sak som produktionsgodkännande.

## Vad som fortfarande inte är production ready

LT Studio ska fortfarande inte användas med verkliga skarpa ekonomidata innan production-readiness-gates är verifierade.

Kvarvarande större driftfrågor omfattar bland annat:

- leaked password protection är plan-blockerad på Supabase Free,
- extern monitoring/larm,
- separat syntetisk staging,
- produktionsdomän/origin-skydd,
- verifierad backup/restore i framtida produktionsmiljö,
- GitHub native security alerts-kontroll,
- bankintegration/fake-bank-gate,
- redovisningsmässig och juridisk slutverifiering.

## Historiska dokument

Följande dokument innehåller fortfarande värdefull historik men beskriver inte längre hela nuläget:

- `docs/ARCHITECTURE.md`
- `docs/SYSTEM-OVERVIEW.md`

De ska läsas som historiska etappbeskrivningar där detta dokument har företräde för aktuell arkitektur.
