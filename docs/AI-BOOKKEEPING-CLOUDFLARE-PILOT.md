# Etapp 1: Cloudflare Workers AI – syntetisk bokföringspilot

Datum: 2026-10-12. Spårning: Issue #767. Relaterad beslutsplan: docs/AI-BOOKKEEPING-INTEGRATION-PLAN.md.

## Vad som faktiskt levereras

- Ny servermodul: packages/automation/cloudflare-bookkeeping.mjs.
- Anrop till Cloudflares fasta Workers AI REST-adress med JSON Mode, modell Llama 3.3 70B.
- Modulen är **avstängd som standard** och har **ingen publik route eller frontend-integration**.
- Syntetiska leverantörsfakturor får bara prövas när anroparen lämnar ett kontextobjekt med företags-ID, aktör, markering för verifiering, MFA/AAL2 och pilotläge. **Modulen verifierar ännu inte en faktisk Supabase-session och gör ingen databasuppslagning**. Därför är den inte kopplad till någon publik route och får inte exponeras förrän nästa etapp har verklig serverauktorisering och dokumentägarkontroll.
- Säkerhetsvalideringen sker **innan ett enda utgående AI-anrop**. Ett internt verifieringsmärke gör att ett vanligt klientobjekt inte kan skickas förbi kontrollerna via providern.
- Cloudflare-token och Account ID ska i ett framtida serverflöde hämtas från skyddad secret manager, aldrig sparas i GitHub eller läggas i webbläsaren. Tester använder en uppenbart falsk nyckel och mockade nätverkssvar.
- Tolkningsresultatet är en input till den befintliga automationsmodulen. Källbelopp hämtas enbart från det verifierade syntetiska underlaget och inte från AI-svaret.
- Levererad kod kan **inte bokföra verifikationer**, betala fakturor, spara kunddokument eller ändra Supabase. Den skapar enbart ett ännu icke sparat förslagsobjekt för manuell granskning.
- Separata automatiska tester i test/ai-cloudflare-bookkeeping.test.js ingår i ordinarie npm test och GitHub Quality.

## Tillåtna pilotfall

Enbart **påhittad** svensk leverantörsfaktura i SEK, 25 % moms, positivt nettobelopp och 25 % moms som går att verifiera matematiskt. Modellen får endast föreslå kostnadskonto 6110 (kontorsmateriel), 5460 (förbrukningsmaterial) eller 6540 (IT-tjänster). Raderna för ingående moms (2641) och leverantörsskuld (2440) sätts av applikationsregler, aldrig av AI. Debet och kredit måste balansera.

Exempel på syntetiskt underlag:
- Företag: tenant-a-001
- Referens: invoice-a-001
- Leverantör: Testkontor AB
- Inköp: Kontorspapper A4
- Netto: 1 000 kr, moms: 250 kr, brutto: 1 250 kr

Inget konto blir automatiskt bokfört oavsett AI:ns motivering. Alla förslag märks med osäkerhet och förs till manuell granskning via den befintliga automationsdomänen.

## Avsiktliga säkerhetsspärrar

- Kundföretag A kan inte använda underlag från företag B i samma anrop.
- Utan verifierad MFA-session och uttrycklig syntetisk pilotkontext stoppas anropet.
- Okända fält, kontrolltecken, felaktiga datum, obalanserade belopp och ogiltig moms stoppas.
- EU-handel, kreditnotor, blandmoms, utländska valutor, privata eller verkliga fakturor ingår INTE.
- Modellen får aldrig välja ett fritt bokföringskonto, mata in eget momsbelopp eller påstå att den har bokfört.
- PDF-text behandlas som opålitlig indata. AI:n får inga databasverktyg, webbhämtning eller användarbehörigheter.
- Fel från API, ogiltiga svar, överstora svar och brutna anslutningar blir generiska fel utan att exponera API-token eller privata uppgifter.
- Inga dolda återförsök som kan öka kostnaden. Ingen betald fallback.

## Hur modulen provas

Ordinarie automatiska tester: npm test. Avgränsat: node --test test/ai-cloudflare-bookkeeping.test.js.

Nätverksdelen provas med injicerad, fejkad fetch-funktion. Den har INTE kontaktat ett riktigt Cloudflare-konto och ger alltså ännu ingen verifiering av modellens faktiska konteringskvalitet.

## Nästa etapp innan externa anrop i UAT

1. Skyddad Supabase Edge Function med riktig Supabase-session, företagsmedlemskap, behörighet, MFA/AAL2 och per-användare/per-företag rate limit enligt AGENTS.md.
2. Idempotens, tids- och volymkvoter per företag samt central avstängning och användningsuppföljning. Cloudflares 10 000 Neurons/dag gäller hela Cloudflare-kontot.
3. Separat verifierad PDF-textutvinning från privata passiva PDF-filer. Filinnehåll och kvitton av andra filtyper får inte införas utan säkerhetsbeslut.
4. Anpassning till befintlig godkännandekö, revisionshistorik och konteringsregler – fortfarande ingen automatisk exekvering.
5. Cloudflare-konto och sekretessgranskad serverhemlighet, licenskontroll, leverantörsavtal samt svensk redovisningsgranskning innan riktiga kunddokument överförs.
6. UAT med två syntetiska företag och dokumenterade misslyckandefall innan production-readiness-beslut.

## Dokumentation från leverantören

- https://developers.cloudflare.com/workers-ai/get-started/rest-api/
- https://developers.cloudflare.com/workers-ai/features/json-mode/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/platform/data-usage/

All kod och dokumentation finns i GitHub. Inga permanenta lokala filer eller hemligheter ingår.
