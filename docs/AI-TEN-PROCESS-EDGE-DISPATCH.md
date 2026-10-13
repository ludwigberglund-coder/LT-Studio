# AI-pilot för tio ekonomiprocesser – gemensam spärrad gateway

Status 2026-10-13: **koden är förberedd, inte deployad eller aktiverad**. Relaterar till #767, #774 och #794.

## Vad som byggts

Den befintliga Supabase Edge-funktionen `ai-bookkeeping-pilot` stöder i nästa granskade pilotrelease två typer av strikta syntetiska anrop. En ny parallell AI-route skapas inte.

- Tidigare leverantörsfakturapilot: `companyId`, `scenario`, `requestId` – samma kontrakt och svar som tidigare.
- Gemensam ekonomipilot: `companyId`, `purpose`, `requestId` – tio versionerade processer från befintliga `ai-finance-process-contract.mjs`.
- Om fältet `purpose` finns går begäran till `runSyntheticFinanceProcess` och `createFinanceCloudflareProvider`. Varje gren avvisar oväntade fält, fria promptar, PDF:er, betalningsuppgifter, klientvalda modeller och fel företag.
- Det nya svaret är endast `schemaVersion`, företag, process, syntetiskt sourceId, `manual-review`, `posted:false`, `synthetic:true`, `requiresHumanApproval:true` och strikt validerad rådgivning.
- Ingen bokföring, betalning, dokumentläsning, deklaration, sparad automationspost eller databasändring sker.

## Befintliga spärrar förblir orörda

`RELEASE_APPROVED=false` och `DURABLE_IP_LIMITER_VERIFIED=false` stoppar fortfarande funktionen med HTTP 503 innan hemligheter, nätverk, IP eller JSON läses. Det finns ingen Supabase deploy-konfiguration för piloten.

Samma server hanterar origin-kontroll, verifierad JWT, personlig AAL2-session, företagsmedlemskap via användarscoperad RLS, betrodd IP-hash med salt, samma atomära kvot-RPC för företag/användare/IP/globalt och hemligheter enbart i Supabase Secrets. De nya processerna går inte förbi detta skydd.

`test/ai-edge-ten-process-dispatch.test.js` testar statiskt att samma Edge-funktion används, att spärren ligger först, att alla fem kvotfält skickas vidare, att det gamla fakturasvaret bevaras och att den nya processgrenen aldrig skriver pengar eller bokföring.

## Gränssnitt: säker syntetisk testpanel

`apps/portal/ai-assistant.js` och `ai-assistant.css` lägger till en responsiv testpanel i den redan befintliga AI-fliken för inloggade administratörer och redovisare.
Det går att välja alla tio fasta ekonomiska testprocesser och – först när serverpiloten separat godkänts – klicka **Prova AI (pilot)**. Fram till dess visar servern 503/404 och ett begripligt meddelande.
Panelen skickar **endast** `companyId`, en fördefinierad `purpose` och ett nytt `requestId` via `LTSupabase.functions.invoke('ai-bookkeeping-pilot', ...)`, aldrig sökfrågor, belopp, PDF eller annan inmatad data.
UI:t verifierar företag, källa, process, schema och manuellt granskningskrav i svaret innan det visas. Svaret HTML-escapas och sparas aldrig som bokföring eller automationsförslag.
I demovyn sker inga externa anrop och användare utan rätt roll får inga pilotkontroller. `test/ai-assistant-synthetic-pilot.test.js` och uppdaterade portaltester täcker alla tio processer, säkerhetsfel, obehörighet, tenant-byte och svarsförfalskning.

## Kvar innan verklig AI

1. Bevisa i hostad Supabase UAT att `x-real-ip` kommer från betrodd proxy och inte kan förfalskas. Välj och dokumentera explicit `verify_jwt = true` före en godkänd framtida deployment.
2. Kör tvåföretags-UAT med syntetiska identiteter, personliga sessioner, avvisade roller, konkurrerande anrop och atomär kvot.
3. Slutför GDPR/DPA, modelllicens och kostnadsgränser före några externa AI-anrop med kunduppgifter.
4. Bygg betrodd serverhämtning av befintliga PDF-underlag med källhash och kontrollerad BAS-/moms-/belopps-/periodvalidering. Lämna sedan bara granskade förslag till **befintlig automationskö**, inte ett parallellt bokföringssystem.
5. Kräv särskilt redovisnings-, säkerhets- och releasegodkännande innan verkliga kunddata eller bokföring hanteras av modellen.

GitHub main är den enda källan för kod och dokumentation. Att tester är gröna betyder inte att något är godkänt för produktion.