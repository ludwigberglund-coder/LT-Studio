# AI-bokföringsmotor – säker integration i LT Studio

Status: **arkitekturförberedelse, inte driftsatt AI**. Ägare: GitHub issue #767. Datum: 2026-10-12.

## Vad som finns och vad som saknas

Aktiv delad UAT: GitHub Pages, Supabase Auth/RLS/PostgreSQL/Storage/Edge Functions. `apps/portal/automation.js` och `packages/automation/proposals.js` erbjuder redan förslagsstrukturer. `docs/AUTOMATION-ROADMAP.md` anger att modellen föreslår men inte skriver till huvudboken. Ingen AI-leverantör är i nuläget ansluten i `supabase/functions`. GitHub är källan för kod och migrationer, inte för ekonomidata, dokument eller API-hemligheter.

## Rekommenderat användarflöde

1. Behörig användare i företag A laddar upp en **passiv PDF**, enligt `AGENTS.md`. Dokumentinkorgen förvaltas separat i issue #728.
2. Servern autentiserar användare, session/MFA, företagsmedlemskap och roll. PDF hämtas endast från rätt företags privata Storage.
3. Säker PDF-extraktion körs på servern efter fil- och säkerhetskontroll. Fakturadata kontrolleras deterministiskt i första hand.
4. Vid behov skickas **minimerad data** till modellleverantören från en skyddad Edge Function. API-nyckeln lagras i **Supabase Edge Function Secrets**, aldrig i browser, databasrad, frontend eller GitHub.
5. Modellen returnerar **strukturerat förslag** med fakta, kontering, momshantering, förklaring, osäkra uppgifter, och hänvisningar till källfält.
6. LT Studio verifierar schemat och kontrollerar konto, kronor/ören, debet=kredit, momsregler, period, leverantör, dubbletter, företagsbehörighet och stöd i originalet. Modellens egen confidence räcker inte.
7. Godkänt förslag hamnar i befintlig automation-/attestkö, där en behörig människa granskar. Vanlig kontrollerad bokföringsväg gör därefter skrivningen; permanent audit och källkoppling sparas.
8. Vid tvetydighet, fel, leverantörsavbrott eller budgettak blir posten kvar i manuell kö. Ingen dold bokföring och ingen automatisk betalning.

## Föreslaget internkontrakt (design – ej implementerad route)

`POST /functions/v1/ai-bookkeeping-suggest`, autentiserat JWT; endast `document_id` och en unik begäran/idempotensnyckel som klientinmatning. Vald `company_id` tas från verifierat sessions-/medlemskapssammanhang och kontrolleras mot dokumentets `company_id` server-side.

Svar: förslags-id, status `needs_review` / `rejected`, verifierade källfält (leverantör, fakturanummer, datum, netto, momssats, momsbelopp, brutto, valuta), konteringsrader i heltal ören, momskod, kvalitetsflaggor, redovisningsmotivering, modell- och promptversion, referens till källdokument. Ingen exekveringsstatus `posted` tillåts i detta API.

## Leverantör och drift

Börja med en leverantörsoberoende adapter och mockad AI för syntetisk UAT. Utvärdera OpenAI API som förstaval, andra leverantörer som alternativ efter verifiering av pris, datahantering, personuppgiftsbiträdesavtal och EU-/Sverige-krav. Starta med ett gemensamt API-konto som LT Studio hanterar: separera kunders data genom strikt auktorisering och isolerade anrop. Lägg per-företag-funktion `ai_enabled` (opt-in), månadskvoter, budgettak, timeout, rate limits, retries, driftlarm, möjlighet att stänga av AI centralt och manuell fallback. Beräkna faktisk kostnad från token-/dokumentvolym innan aktivering. Alla verkliga dataöverföringar till extern modell måste granskas i förväg av ansvarig för dataskydd och redovisning.

## Hotmodell och säkerhetskrav

- **Tenant-läckage:** ingen company-identifierare från klient får ge åtkomst; databas-RLS + serverkontroller; test A får aldrig läsa B.
- **Prompt injection i PDF:** behandla leverantörens PDF-text som opålitlig data, aldrig instruktion; inga modellstyrda verktyg för databas-/webbåtkomst.
- **Hallucinationer/ekonomiska fel:** enbart förslag; validering mot dokument och domänregler; svåra momskategorier och represention/omvänd moms stoppar auto.
- **API-kostnad/överbelastning:** per-user/per-company quotas, rate limit, maximal dokumentstorlek, budgetgräns och kill switch.
- **Nycklar och integritet:** endast hemligheter i servermiljö; inga privata dokument i telemetry; data-minimering, retention och leverantörsvillkor dokumenteras.
- **Dubbelbokning:** idempotens, duplicate detection, transaktionssäker godkännande-/skrivväg, append-only audit.
- **Behörighet:** avvisa otillåten roll eller utgången session, använd befintliga MFA- och financial write-gränser.

## Separat genomförande i PR:er

1. Denna arkitekturplan, issue #767, inget ingrepp i dokumentinkorgen eller andra aktiva agenters filer.
2. Provider-mock + strukturerat valideringsschema + syntetiska testsituationer.
3. Säker Supabase Edge Function, behörigheter och nödvändiga versionerade migrationer/CI.
4. Integrera förslag i befintliga automation-gränssnittet och företagsinställningar.
5. Välj riktig leverantör och opt-in-pilot efter sekretessgranskning, API-budget, säkerhetstester och godkänd produktion.

**Krav för acceptans:** två testföretag utan dataläckage, felaktiga momsrader/obalans/låsta perioder/dubbletter nekas, prompt injection har ingen effekt, leverantörsfel ger manuell fallback, inga nycklar i källkod, syntetisk UAT och Quality/CodeQL/Supabase clean rebuild gröna. Automatisk exekvering är **inte** en del av denna leverans.

## Kostnadsmål: 0 kr under testning och så långt gratisnivåerna räcker

**Prioritet 1:** befintliga deterministiska regler och företagsvis tidigare godkänd konteringshistorik – inget betalt AI-anrop när ett kontrollerat regelresultat räcker.

**Prioritet 2:** kostnadsfri AI-pilot på **Cloudflare Workers AI** med en modell som är tillåten på Workers Free, för enbart syntetiska fakturor. Enligt Cloudflares prisinformation 2026-10-09 ingår totalt **10 000 Neurons/dag**, därefter får gratisanvändaren fel tills kvoten återställs (ingen automatisk betald överanvändning). Neurons är en förbrukningsenhet, **inte** antal fakturor. Val av modell kräver svensk redovisningskvalitetstest och kontroll av aktuell Free-tillgänglighet. Cloudflare uppger att innehållet inte används för att träna modeller utan explicit samtycke; det ersätter **inte** granskning av DPA, EU-överföring, skydd och modellicens.

**Prioritet 3:** Supabase Edge Functions på befintlig Free-plan för serverkoppling. Supabase anger **500 000 anrop/månad** på Free. Andra användningsgränser gäller separat och måste mätas.

**Alternativ, ej rekommenderat till svenska kunders live-API på gratisnivå:** Google Gemini API erbjuder Free för utveckling, men dess Additional Terms (2026-03-23) anger att API-klienter till användare i EES/UK/Schweiz endast får använda **Paid Services**. Gratisnivån kan också innebära annan databehandling, inklusive modellförbättring. Använd inte för riktiga kunduppgifter i detta projekt utan ny bedömning.

**OpenAI API:** separat API-fakturering från ChatGPT och normalt användningskostnader; behåll som alternativ, inte som förstahandskrav.

**Hårda driftregler:** inga kreditkort eller uppgraderingar utan uttryckligt ägarbeslut; global kostnadsbrytare; gräns per företag och dag; när gratis AI-kvot är slut måste manuell/regeldriven bokföring fungera utan extern AI; endast syntetiska testunderlag tills dataskydd, redovisning och produktionssäkerhet godkänts. AI är ett förslagslager, inte direktbokföring.

Källor (kontrollerade 2026-10-12):
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/platform/data-usage/
- https://supabase.com/docs/guides/functions/pricing
- https://ai.google.dev/gemini-api/terms
- https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform
