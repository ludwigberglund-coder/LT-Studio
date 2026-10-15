# Extern tillgänglighetskontroll – issue #447

Senast uppdaterad: 2026-10-15. GitHub main är källan. **Detta är begränsad UAT-övervakning, inte komplett produktionslarm eller signoff för #447.**

## Kostnadsfri start

GitHub Actions kör .github/workflows/public-uat-monitor.yml vid minuterna **17 och 47** varje timme (UTC), samt manuellt. Jobbet körs på GitHubs servrar, utanför LT Studio och Supabase. Det använder endast publik konfiguration och inga konton, privata dokument, lösenord, service-role-nycklar eller ekonomidata.

Båda dessa läsande kontroller måste vara gröna:

1. **GitHub Pages:** GET mot https://ludwigberglund-coder.github.io/LT-Studio/portal/index.html. Kräver HTTP 200 och förväntade portalmarkörer i HTML.
2. **Supabase UAT Auth:** GET mot Supabase-UAT-projektets /auth/v1/health med publik publishable key. Kräver HTTP 200 och förväntad GoTrue-identitet. Publik URL och nyckel hämtas från apps/portal/supabase-config.js.

Varje probe gör ett nytt försök efter 1,5 sekunder om den misslyckas. Om en probe misslyckas båda gångerna blir GitHub Actions-jobbet rött. En grön statisk sida döljer inte ett Supabase-fel.

Grönt innebär **endast att dessa två tjänsters publika ytor är nåbara**. Det bevisar inte PostgREST, databasfrågor, MFA, Edge Functions, tenant-isolering, fakturor, betalningar, backuper eller produktionsberedskap.

GitHub Actions schedule är **best effort**: körningar kan bli försenade, hoppas över eller inaktiveras. Saknade körningar upptäcks inte av samma workflow. Detta får inte vara ensam övervakning för skarpa ekonomidata.

## Hur ni får larm

1. Öppna https://github.com/settings/notifications med det konto som ska ta emot larm.
2. Aktivera e-postnotiser för misslyckade **Actions-workflows** och kontrollera att e-postadressen fungerar. Se https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications.
3. Schemalagda workflows notifierar typiskt den som skapat eller senast ändrat schemat. Att två personer är medlemmar i repositoryt innebär **inte** att båda får dessa notiser. Verifiera faktisk leverans separat för ansvariga operatörer.

## Gör en riktig notifieringsövning efter merge

1. Öppna **Actions → Public UAT availability (best effort) → Run workflow** på main.
2. Sätt **simulate_alert = true**. Nätverkskontrollerna körs som vanligt, men jobbet blir medvetet rött som larmövning.
3. Kontrollera att mottagaren **verkligen fick** e-post eller Actions-notis. Dokumentera körningslänk, testtid och mottagarroll i #447, utan privata kontaktuppgifter.
4. Kör igen med **simulate_alert = false** och kontrollera att resultatet blir grönt. Om det blir rött är kontrollen inte godkänd.

En avsiktlig röd Actions-körning bevisar bara notifieringskanalen från GitHub, **inte** att en oberoende uptime-leverantör upptäcker ett verkligt tjänsteavbrott.

## Kvar för att få stänga #447

- Slutför stagingförutsättningarna i #364 och definiera riktiga, säkra staging-mål för GitHub Pages + Supabase.
- Lägg till separata kontroller för Supabase Data API och en kritisk Edge Function med **enbart syntetisk data** och ingen hemlighet i publik URL.
- Konfigurera en **fristående uptime-leverantör** med larmväg som fungerar även om LT Studio är helt nere. Verifiera gratisnivå och villkor innan ni ansluter den; skapa inga betalda resurser utan ägarbeslut.
- Kör leverantörens verkliga larmtest och bekräfta mottagandet. Dokumentera eskalering, beredskap, återställning och förnyelse av gammalt larmbevis.
- Lagra mottagarnas privata uppgifter, webhook-nycklar, tokens och skyddade bevis **utanför GitHub**. Endast sekretessfri status, datum och referens ska sparas i GitHub-issuet.

**Legacy-varning:** scripts/staging-monitoring-evidence.js testar den gamla Node/SQLite-routen /api/v1/readiness/core. Den är inte en readiness-gate för nuvarande GitHub Pages + Supabase och får inte ge falsk signoff.

## Felhantering

Vid röd Actions-körning: läs vilken probe som ger koden http-status, unexpected-page, unexpected-health-response, invalid-json eller network-error. Skriptet loggar aldrig råa svar, privata headers eller användardata. Bekräfta återställning genom en ny grön körning.
