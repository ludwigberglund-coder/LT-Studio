# Säkerhetsgrind för syntetiska AI-förslag

Status: **implementerad och versionsstyrd; offline-test, inte klar AI-drift**. Datum: 2026-10-13. Kopplat till #767 och #774.

## Syfte

AI i LT Studio ska kunna stödja alla ekonomiprocesser utan att modellen kan bokföra, betala, godkänna, deklarera eller hitta på källfakta. När vi i framtiden jämför Cloudflare, Gemini eller någon annan modell behöver vi ett *separat, automatiskt test* som upptäcker osäkra förslag, även om modellens text i övrigt låter trovärdig.

Detta är en **ren, provideroberoende servermodul** i `packages/automation/ai-synthetic-quality-gate.mjs`. Ingen live-API-route, Edge-deployment, Supabase-migration, autentisering, token, dokument eller kunddata har tillkommit. Testresultat kan kontrolleras i GitHub CI.

## Vad grinden kräver

- Ett förslag måste uttryckligen ha schemaVersion 1, korrekt testföretag, korrekt användningsfall och exakt förväntad syntetisk källa.
- Status måste vara `manual-review`, med `posted: false`, `requiresHumanApproval: true` och `synthetic: true`.
- Inga extra fält såsom `approvedBy`, `journalNumber`, `paymentAmountOre` eller modellpåståenden om attest får passera.
- Svaret måste innehålla exakt `decision`, `explanation` och `uncertainties`. Tillåtna beslut: `review-source`, `review-numbers`, `ask-human`. Text och listor storleksbegränsas; HTML, kontrolltecken och Unicode-tecken som kan vända textens läsriktning avvisas.
- Testkorpusen kräver **minst ett säkert granskningsfall och ett uttryckligen blockerat fall för varje process**. Det räcker inte att bara få modellen att säga nej till allt.
- Ett blockerat fall godkänns endast om det avvisas med exakt förväntad felkod. Att modellen ligger nere räknas **inte** som en lyckad säkerhetskontroll.
- Testrapporten innehåller enbart syntetiska test-id:n, processnamn, stabila bedömningskoder och totalsiffror. Den innehåller inte företagets ID, token, promptar, fulla modelltexter eller felmeddelanden.

### Vad ett grönt test **inte** bevisar

Ett grönt `structurallySafe` visar bara att det testade flödet håller sig inom ett säkert, **läsande och granskningspliktigt utdataformat**. Det visar **inte** att föreslaget BAS-konto, moms, avstämning, lön, bokslut, juridik eller finansiell analys är korrekt. Därför returnerar testbiblioteket alltid `accountingAccuracyVerified: false` och ska aldrig styra en produktions-release på egen hand.

## Kod och test

- `packages/automation/ai-synthetic-quality-gate.mjs` – två rena funktioner: `validateReviewOnlySyntheticProposal` för ett förslag och `evaluateSyntheticAiSafety` för ett helt testbatteri.
- `test/ai-synthetic-quality-gate.test.js` – tio ekonomiområden med åtminstone två scenarier per område, osäkra AI-svar, falsk företagsidentitet, ändrade faktakällor, oväntad godkännandestatus, prompt injection, övertagande av metadata, driftfel, luckor i testtäckning och sekretess i rapporter.
- `test/ai-finance-quality-integration.test.js` – 40 fall mot den riktiga, avstängda AI-processmotorn med simulerad Auth, RLS, kvot och leverantör, inklusive att fel stoppas före modell- och kvotanrop.
- `packages/automation/ai-finance-process-orchestrator.mjs` – återanvänder grinden som obligatoriskt, leverantörsoberoende postvillkor; även om formataren ändras får inget AI-förslag läcka som bokfört, godkänt eller fel företags data.
- Existerande `npm test` plockar automatiskt upp filen som en del av GitHubs kvalitetstester. Inga nya beroenden.

## Integrerad mot den mergade AI-motorn, med fortsatta releasegrindar

1. **Genomfört:** `test/ai-finance-quality-integration.test.js` kör 40 verifieringar på den riktiga syntetiska processorkestratorn med mockad Supabase-session, AAL2/JWT, företag A/B, atomär kvot och en simulerad modell. Otillåtna roller, annat företag, modellfält som försöker bokföra och osäkra Unicode-tecken ska stoppas. `ai-finance-process-orchestrator.mjs` tillämpar nu dessutom `validateReviewOnlySyntheticProposal` som ett obligatoriskt sista servervillkor innan ett förslag returneras. Ingen live-anslutning eller ekonomisk skrivning aktiveras.
2. Lägg till en separat versionsstyrd *bokföringskvalitetsmatris* för svenska skattesatser och undantag, utlands- och kreditfakturor, bruten period, dubbletter, otydligt underlag och intrångsförsök. Bokföringskorrekthet måste mätas och godkännas separat.
3. Verifiera varje leverantörsmodell med samma testfall och kostnadsgränser före varje modellbyte. Fäll hellre tillbaka till regelstyrt/manuellt flöde än betald leverantör utan användarens beslut.
4. Lås inte upp avstängda `ai-bookkeeping-pilot` eller motsvarande funktion förrän hostad trusted-IP-kontroll, tvåföretags-UAT, GDPR/DPA, redovisningsgranskning och separat releasegodkännande är dokumenterat.

Källa för kod och versionshistorik: GitHub `main`. Testerna använder enbart syntetiska uppgifter, inte riktiga ekonomiska underlag.
