# AI-pilot: operatorrunbook for staging

Senast uppdaterad: 2026-10-16. Spårar #774, #767, #797, #823 och PR #826.

## Syfte och hård avgränsning

Detta är klick-för-klick-processen för en framtida, separat godkänd syntetisk AI-repetition i **LT-Studio-Staging**. Runbooken aktiverar ingenting i sin nuvarande form. Den tillåter aldrig kund-PDF, fri prompt, verklig affärsdata, bokföring, betalning eller automatisk postning.

GitHub är källan till Edge Function, tester och migrationer. Dela aldrig API-nycklar, bearer-token, service-role-nycklar, skärmbilder med hemligheter eller fakturainnehåll i GitHub, chatt eller testprotokoll.

## Verifierat nuläge

- Staging är projekt **LT-Studio-Staging** med project ref `rwnqkgbbbxjjfhwtepsi`.
- UAT är projekt **LT-Studio UAT** med project ref `bwbhnotpuuhgghjpmflk` och ska lämnas orört av staging-repetitionen.
- Grundmigrationen `supabase/migrations/20261013071500_ai_pilot_atomic_quota.sql` installerades i staging den 15 oktober 2026 som live-version `20261015071358_ai_pilot_atomic_quota`. Kör den inte igen.
- PR #826:s nya `supabase/migrations/20261016171526_ai_pilot_shared_admission.sql` är inte verifierad som installerad i någon hosted miljö.
- Ingen AI Edge Function är verifierad som deployad i staging.
- Databasens singleton är verifierad med `enabled=false`; kundportalens `AI_PILOT_RELEASED=false`.
- PR #826 behåller serverlåset `RELEASE_APPROVED=false`. Den tidigare IP-header-grinden ersätts av en gemensam hållbar admissionsgräns; detta är inte bevis för betrodd klient-IP.
- Att secret-namnen uppges finnas är inte samma sak som att rätt projekt, scope eller fungerande värden är verifierade.

Nuvarande tillåtna slutpunkt är därför **förkontroll och dokumentation, ingen deployment och ingen aktivering**.

## Roller och fyrögonsprincip

Två olika behöriga personer krävs:

1. Operatören utför stegen i rätt Supabase-projekt.
2. Granskaren verifierar project ref, exakt GitHub-head, gröna kontroller, avstängda lås och evidens innan varje övergång.

Samma GitHub-identitet får inte räknas som oberoende approval. Avbryt om granskaren saknas.

## Fas A: säker förkontroll utan deployment

### 1. Lås arbetsversionen

1. Öppna GitHub och PR #826.
2. Kontrollera att PR:n är draft och att den inte har konflikter.
3. Kopiera endast head-SHA till arbetsprotokollet. Kopiera inga secrets eller testtoken.
4. Öppna fliken **Checks**.
5. Kräv grönt resultat för **Quality and security checks**, **CodeQL security analysis** och **Supabase clean rebuild** på samma head-SHA.
6. Kontrollera att `RELEASE_APPROVED=false`, `AI_PILOT_RELEASED=false` och databasläget `enabled=false` fortfarande är dokumenterade.
7. Stoppa om head ändras; verifiera om samtliga kontroller på den nya headen.

### 2. Bekräfta rätt Supabase-projekt

1. Logga in i Supabase Dashboard med operatörskontot.
2. Välj projektet **LT-Studio-Staging** i projektväljaren.
3. Öppna **Project Settings** och därefter **General**.
4. Läs **Project ID / Reference ID**.
5. Fortsätt endast om värdet är exakt `rwnqkgbbbxjjfhwtepsi`.
6. Om `bwbhnotpuuhgghjpmflk` visas är UAT valt: lämna sidan utan ändring.
7. Skriv project ref, UTC-tid, operatör och granskare i protokollet. Skriv inga nycklar.

### 3. Kontrollera secret-namn utan att läsa värden

1. I samma verifierade staging-projekt, öppna **Edge Functions** och **Secrets**.
2. Kontrollera att namnen `CLOUDFLARE_ACCOUNT_ID` och `CLOUDFLARE_AI_TOKEN` finns.
3. Öppna, kopiera, återge eller skärmdumpa aldrig secret-värden.
4. Kontrollera även att Supabases standardmiljö för funktionen erbjuder projekt-URL och servernyckel; skriv inte värdena i protokollet.
5. Om ett namn saknas eller miljön är oklar: stoppa. En behörig secret-administratör får lägga in ett nytt värde via Dashboard från sin privata secret manager.
6. Ett synligt secret-namn bevisar inte att token är giltig. Giltighet får endast verifieras senare genom det avgränsade syntetiska anropet efter separat releasebeslut.

### 4. Läs endast schema- och behörighetsmetadata

Öppna **SQL Editor**, skapa en ny query och kör följande i staging. Queryn läser metadata och inga reservationsrader:

```sql
select
  to_regclass('public.ai_pilot_runtime_settings') is not null
    as settings_table_exists,
  to_regclass('public.ai_pilot_request_reservations') is not null
    as reservations_table_exists,
  to_regclass('public.ai_pilot_admission_state') is not null
    as admission_table_exists,
  to_regprocedure('public.reserve_ai_pilot_request_server(text,uuid,uuid,text,text)') is not null
    as quota_rpc_exists,
  to_regprocedure('public.admit_ai_pilot_request_server()') is not null
    as admission_rpc_exists;
```

Före installation av PR #826:s migration ska de två sista admissionsvärdena vara `false`. Det är väntat, inte skäl att improvisera SQL.

Om tabellerna finns, kontrollera RLS och browserroller:

```sql
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'SELECT') as anon_can_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_can_select,
       has_table_privilege('anon', c.oid, 'INSERT') as anon_can_insert,
       has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_can_insert
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in (
    'ai_pilot_runtime_settings',
    'ai_pilot_request_reservations',
    'ai_pilot_admission_state'
  )
  and c.relkind in ('r','p')
order by c.relname;
```

Kontrollera funktionsbehörigheter:

```sql
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_can_execute
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.oid in (
    to_regprocedure('public.reserve_ai_pilot_request_server(text,uuid,uuid,text,text)'),
    to_regprocedure('public.admit_ai_pilot_request_server()')
  )
order by p.proname;
```

Krav: RLS är på, `anon` och `authenticated` saknar direkt tabellåtkomst och EXECUTE, och endast `service_role` har avsedd serveråtkomst. Verifiera separat att singleton-raden fortsatt har **enabled=false**. Läs inte privata reservationsrader.

### 5. Avsluta nuvarande körning

1. Stäng SQL Editor utan någon skrivande query.
2. Öppna **Edge Functions** och verifiera att `ai-bookkeeping-pilot` inte har deployats av denna förkontroll.
3. Dokumentera enbart booleska kontrollresultat, project ref, head-SHA, workflow-runnummer och UTC-tid.
4. Lämna `RELEASE_APPROVED=false`, `AI_PILOT_RELEASED=false` och `enabled=false`.

## Fas B: framtida hosted repetition efter separat godkännande

Fas B får börja först när en ny eller uppdaterad PR uttryckligen godkänts av oberoende granskare och dokumenterar GDPR/DPA, modellvillkor, redovisningsavgränsning, budget, rätt staging-projekt och rollback-ägare.

1. Skapa versionsstyrd migration för varje ändring av runtime-läget. Ändra inte `ai_pilot_runtime_settings` manuellt i SQL Editor.
2. Hantera det kända staging-aliaset `20261015071358` enligt `docs/SUPABASE-PARITY.md`. Skriv aldrig direkt i `supabase_migrations.schema_migrations`.
3. Applicera först `20261016171526_ai_pilot_shared_admission.sql` genom det granskade migrationsflödet medan `enabled=false`.
4. Upprepa metadata-, RLS- och behörighetskontrollerna. Kräv tomt eller förklarat syntetiskt testläge; radera ingen historik.
5. Deploya endast den exakt godkända Edge Function-headen till staging. Deploya inte till UAT eller produktion.
6. Verifiera först fail-closed: med server- och klientrelease låsta ska anrop ge `AI_PILOT_NOT_RELEASED` och inget modell-anrop eller reservation skapas.
7. Låt en separat, granskad kodändring hantera server- och klientrelease och en separat versionsstyrd migration hantera `enabled=true`. Miljövariabler eller Dashboard-klick får inte ensamma låsa upp piloten.
8. Använd två påhittade staging-företag och separata testidentiteter med AAL2. Använd endast repositoryts hårdkodade scenarier.
9. Testa rätt tenant, fel tenant, nekad roll, utgången session, korrupt JSON, okänd nyckel, återanvänd request-id, samtidiga anrop, per-user/per-company/global dagskvot, gemensam 2/600-sekundersbucket, 60 admissions per rullande minut och providerfel.
10. Kontrollera att varje godkänt svar anger syntetiskt/manuell granskning och `posted=false`; huvudbok, bank, leverantörer, fakturor och betalningar ska vara oförändrade.
11. Dokumentera statuskod, säker felkod, scenario-id, request-id, tider och räknade syntetiska reservationer. Dokumentera aldrig bearer-token, modellpayload, secrets eller fria affärstexter.
12. Kör åter Quality, CodeQL och Supabase clean rebuild på exakt slutlig head före merge.

## Stoppsignaler

Avbryt omedelbart vid fel project ref, okänd migrationsparitet, läckta eller saknade secrets, annan input än hårdkodade syntetiska fall, saknad AAL2, tenantavvikelse, browseråtkomst till skyddade tabeller/RPC:er, oväntad databasskrivning, okontrollerad kostnad, okänd CI-status eller ändrad head.

Öppna ett GitHub-ärende med enbart teknisk status. Låt den regelstyrda/manuella bokföringen fortsätta.

## Rollback

Rollback-ägaren ska vara utsedd innan Fas B.

1. Stoppa nya testanrop.
2. Återställ först `enabled=false` genom en granskad, versionsstyrd migration.
3. Återdeploya den senast godkända hårdlåsta versionen med `RELEASE_APPROVED=false`.
4. Behåll eller återställ klientens `AI_PILOT_RELEASED=false`.
5. Verifiera `AI_PILOT_NOT_RELEASED`, oförändrad huvudbok/bank och att inga nya reservationer skapas.
6. Radera inte admissions- eller reservationshistorik. Bevara auditunderlaget.
7. Vid misstänkt secret-exponering: låt behörig administratör revoke/rotera Cloudflare-token och Supabase-servernyckel enligt respektive incidentprocess; lägg aldrig nya värden i GitHub.
8. Dokumentera orsak, head-SHA, migrationer, tider, verifiering och ansvarig utan person- eller secret-data.

Databasmigrationerna ska normalt inte backas genom destruktiv `DROP`; avstängt läge och hårdlåst Edge Function är den säkra operativa återställningen.

## Merge- och releasegrind

PR #826 får inte mergeas eller markeras releaseklar enbart för att denna runbook finns. Kräv fortfarande:

- oberoende approval och lösta reviewtrådar,
- konfliktfri och strict up-to-date branch,
- alla obligatoriska kontroller gröna på aktuell head,
- verifierad hosted staging-paritet och fail-closed-test,
- godkänt syntetiskt end-to-end-test enligt Fas B,
- dokumenterat rollback-resultat,
- fortsatt förbud mot verkliga kundunderlag tills GDPR/DPA- och redovisningsgrindarna är godkända.
