# AI-pilot: verifierbar förkontroll före staging

Senast kontrollerat: 2026-10-15. Spårar #774, #767 och #797.

## Verifierat nuläge

GitHub `main` är källan till Edge Function, testfall och databasens migrationer. Den versionerade filen `supabase/migrations/20261013071500_ai_pilot_atomic_quota.sql` **är installerad i LT-Studio-Staging den 15 oktober 2026**, men **inte i UAT**. Ingen AI Edge Function är deployad i staging. Följande steg gäller fortsatt som krav för ny miljö och inför varje aktivering. Att SQL-schema finns är inte godkännande att slå på AI.

Den syntetiska Edge-funktionen `supabase/functions/ai-bookkeeping-pilot/index.ts` har två källkodslås: `RELEASE_APPROVED = false` och `DURABLE_IP_LIMITER_VERIFIED = false`. Kundportalens `AI_PILOT_RELEASED` är också `false`. Frånvaron av databasmigrationen är bara ett av flera releasehinder.

## Staging-installation verifierad 2026-10-15

- Miljö: **LT-Studio-Staging** (`rwnqkgbbbxjjfhwtepsi`); **LT-Studio UAT** (`bwbhnotpuuhgghjpmflk`) lämnades orörd.
- Källa: exakt innehåll ur GitHub `main`, `supabase/migrations/20261013071500_ai_pilot_atomic_quota.sql` (Git blob `40a6bead9122211a06fdc052ec5b2596b384f57b`). Den befintliga versionsstyrda SQL-filen ändrades inte.
- Installation: Supabase migrationsverktyg returnerade `success=true`. Staging-historiken innehåller `20261015071358_ai_pilot_atomic_quota`; detta är **ett versionsalias** för GitHub-filen `20261013071500_ai_pilot_atomic_quota.sql`, inte en extra migration som ska köras igen.
- Efterkontroll av schema: `ai_pilot_runtime_settings`, `ai_pilot_request_reservations` och `reserve_ai_pilot_request_server(text,uuid,uuid,text,text)` finns.
- Inställningar: exakt en `singleton=true` med **`enabled=false`**. Tak: 20 globalt/dag, 5/företag/dag, 2/användare/dag samt 2/IP per 600 sekunder. Dessa gränser har inte aktiverats eller stresstestats på riktiga företag.
- Åtkomst: RLS är påslagen på båda tabeller. `anon` och `authenticated` har ingen direkt SELECT/INSERT/UPDATE-åtkomst. RPC:n har ingen EXECUTE-behörighet för dessa roller, men `service_role` har EXECUTE.
- Verifierat läge: **0 reservationsrader**. Ingen AI Edge Function deployades, inga AI- eller ekonomianrop gjordes och inget ändrades i UAT.
- Supabase Security Advisor: enbart två **INFO**-notiser om `rls_enabled_no_policy` på de två nya tabellerna. Policylös RLS tillsammans med återkallade tabellrättigheter är här ett avsiktligt spärrläge: lägg inte till breda browserpolicyer för att tysta notiserna.
- **Kvarstående grind:** Inget synligt staging-resultat från tvåföretags-test, MFA/sessionstest, atomära samtidighets-/kvottester eller verifierad betrodd IP-väg. Ingen produktions- eller UAT-aktivering är godkänd.

**Viktigt om migrationshistorik:** före en framtida `supabase db push` eller `migration repair` ska versionsaliaset ovan granskas tillsammans med övriga redan kända staging-avvikelser. Anta inte att staging-versionen och GitHub-tidsstämpeln är identiska och kör inte samma SQL två gånger. Historik får inte korrigeras med direkt skrivning i `supabase_migrations.schema_migrations`.

## Staging-förkontroll (endast läsning)

Kör nedanstående SQL separat i staging och UAT via en behörig **read-only granskning**, och dokumentera miljö, datum och resultat i GitHub-ärende (inga personuppgifter, nycklar, token eller raddata). Detta är en inspektion, ingen driftsättning:

```sql
select
  to_regclass('public.ai_pilot_runtime_settings') is not null
    as settings_table_exists,
  to_regclass('public.ai_pilot_request_reservations') is not null
    as reservations_table_exists,
  to_regprocedure('public.reserve_ai_pilot_request_server(text,uuid,uuid,text,text)') is not null
    as quota_rpc_exists;
```

Om strukturen finns, kontrollera **metadata**, behörighet och RLS utan att läsa privata reservationsrader:

```sql
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_can_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_select,
       has_table_privilege('anon', c.oid, 'INSERT') as anon_can_insert,
       has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_can_insert
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in ('ai_pilot_runtime_settings','ai_pilot_request_reservations')
  and c.relkind in ('r','p')
order by c.relname;
```

```sql
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.oid=to_regprocedure('public.reserve_ai_pilot_request_server(text,uuid,uuid,text,text)');
```

Efter en godkänd, versionsstyrd staging-migration ska en **separat behörig granskare** dessutom verifiera att den enda raden i `ai_pilot_runtime_settings` har `enabled=false`. Läs inte eller exponera privata reservationsrader.

## Säker ordning för nästa etapp

1. Säkerställ migrationsparitet mot GitHub och lös eventuella redan kända skillnader i `docs/SUPABASE-PARITY.md`; rätta aldrig migrationshistorik genom direkt skrivning.
2. Kör befintlig migration i **staging först**, via godkänt, versionsstyrt migrationsflöde. Migreringens tabeller/RPC ska installeras med `enabled=false`. Applicera inte blint på UAT. Ingen publik Edge Function driftsätts i detta steg.
3. Upprepa förkontrollen ovan och Supabase säkerhetsråd; kräv RLS, inga tabellbehörigheter för `anon`/`authenticated`, ingen klientåtkomst till RPC och att `service_role` är enda uttryckligen tillåtna anropsrollen.
4. Verifiera med två syntetiska företag och separata autentiserade testidentiteter: rätt/fel tenant, MFA AAL2, utgångna sessioner, användar-/företags-/IP-/globala kvoter, dubbel-request-id samt samtidiga anrop. Gör inga riktiga modell- eller betalningsanrop.
5. **Separat releasebeslut** krävs innan betrodd klient-IP kan intygas, Edge-funktionen deployas, AI-modellen kontaktas eller någon data från riktiga kunder används. Dataskydd (GDPR/DPA), modellvillkor, redovisningskvalitet, budget/kostnadstak och ekonomisk audit måste först godkännas.

## Stoppsignal

Om någon kontroll avviker: avbryt driftsättningen, håll båda releaseflaggorna och klientflaggan på `false`, öppna ett GitHub-ärende med enbart teknisk status (inga hemligheter) och låt befintlig regelstyrd/manuell bokföring fortsätta.

Denna guide lägger inte in tabeller, aktiverar inga secrets, använder inte riktiga fakturor och ger inte användaren ett sätt att slå på AI via webbläsaren.
