# Gemensam AI-motor för ekonomiprocesser – syntetisk serveretapp

Datum: 2026-10-13. Status: **ny serverkod, ingen aktivering, inga skarpa kunduppgifter**. Relaterade ärenden: #767 och #774.

## Vad som är implementerat

- `packages/automation/ai-finance-process-contract.mjs` – strikt och versionsstyrt kontrakt för tio ekonomiområden: kundfakturor, leverantörsfakturor, bankavstämning, oplacerade betalningar, moms, rapporter, månadsavstämning, bokslut, lön och lager.
- `packages/automation/ai-gateway-session.mjs` – gemensam verifiering av riktig Supabase Auth-användare, JWT:s AAL2/session-id, medlemskap och roll under **användarscoperad RLS**. Endast denna verifiering kan skapa ett internt, WeakSet-bundet sessionsbevis. Den gamla syntetiska bokföringspiloten återanvänder samma verifiering.
- `packages/automation/ai-finance-process-orchestrator.mjs` – säker ordning: global pilotspärr, strikt begäran, verifierad företagssession, beständig atomär budgetreservation, först därefter syntetiskt fall och AI-anrop. Request-id och sessions-id går till budgetspärren, **aldrig till AI-leverantören**.
- `packages/automation/ai-finance-cloudflare.mjs` – leverantörsadapter med fast Cloudflare URL/modell, JSON-schema, hård svarskontroll och avstängning som standard. Endast internmarkerade, helt påhittade testfall accepteras. Inga godtyckliga instruktioner, externa URL:er eller dokument från klienten.
- `test/ai-finance-process-contract.test.js` och `test/ai-finance-cloudflare.test.js` – tester för tio processer, företag A/B, nekade roller, AAL1, fel JWT, saknad och misslyckad kvot, felaktig AI-JSON, oväntade ekonomiåtgärder, provideravbrott och sekretess.

## Serverkontrakt: syntetisk begäran

Detta är **en intern funktion, ingen publicerad HTTP-route**:

```json
{"companyId":"tenant-a-001","purpose":"vat-review","requestId":"finance-pilot-0000001"}
```

Alla tre fälten valideras strikt. Inga belopp, personuppgifter, källdokument, PDF:er, bankreferenser, fritextpromptar eller klientstyrda modellval accepteras. `purpose` är en låst enum med tio processer. För varje process används en oföränderlig, serverdefinierad syntetisk exempelpost. Framtida riktig data kräver ett **separat** kontrakt med serverhämtat dokument-id och källkontroll.

Alla utdata har `schemaVersion: 1`, serverkontrollerat företag, en `synthetic-`-källa och `status: manual-review`, `posted: false`, `requiresHumanApproval: true`. Modellen kan bara föreslå `review-source`, `review-numbers` eller `ask-human` med kort förklaring och högst tre osäkerheter. Svar som innehåller `posted`, `approved`, `companyId` eller andra extra fält avvisas.

## Säkerhets- och införandegrind

Koden har **ingen** databas- eller Storage-skrivning, inga betalnings- eller verifikationsfunktioner och ingen publik Edge-route. Den nya leverantörsadaptern är inte ansluten till `supabase/functions/ai-bookkeeping-pilot/index.ts`, vilken fortsatt ska vara avstängd med `RELEASE_APPROVED=false` och `DURABLE_IP_LIMITER_VERIFIED=false` och fortfarande inte ska deployas. Ett godkänt UI-test eller en grön PR innebär inte godkänd driftsättning.

Före nästa skarpa steg krävs **verifierad trusted IP/proxy i hostad Supabase**, per-IP/användare/företag/global atomär kvot/idempotens samt syntetiska tvåföretagstester, brutna sessioner, GDPR/DPA, modelllicens, svensk bokföringskvalitet, kostnadstak, explicit `verify_jwt` och separat releasebeslut. Se `docs/AI-EDGE-GATEWAY-DEPLOYMENT-GATE.md`.

## Användarupplevelse och nästa PR

Den redan mergade `AI-hjälp`-sidan (PR #791) visar fortfarande lokal, regelstyrd hjälp, **inte ett AI-svar**. Denna serveretapp lägger grunden för en enda AI-motor som kan användas av den sidan samt fakturor, bank, moms, bokföring, rapporter och bokslut. Nästa arbetsordning:

1. Säkra och verifiera den centrala Edge-gatewayn i hostad syntetisk UAT. Lås upp **endast** en granskningsbar pilot efter releasegrind.
2. Tillför serververifierade käll-id:n och verkligt underlag först efter dataskyddsgodkännande. Lägg till processpecifik deterministisk beräkningskontroll; resultat får inte baseras på modellens säkerhetsvärde.
3. Visa versionsmärkt AI-förslag med källa/osäkerhet i rätt kundportalflik. Spara via befintlig automations- och attestkö med append-only audit och ny validering vid mänskligt godkännande.

**GitHub är source of truth för kod och tester.** Riktiga uppgifter hör enbart hemma i skyddad Supabase-miljö; hemligheter i Edge Secrets. Ingen lokal projektfil eller betald API-tjänst krävs för detta steg.
