# AI-bokföraren lär av attesterad och bokförd historik – första skarpa lässteget

Datum: 2026-10-15. Tillhör GitHub Issue #797 och AI-arkitekturen #774. GitHub `main` är kodens källa.

## Mål

LT Studio ska på sikt göra den löpande bokföringen åt kunden. Det betyder att systemet måste kunna lära sig **från korrekta, tidigare bokförda beslut**, inte bara visa guider. Det första konkreta steget använder befintlig företagsdata utan att träna om en extern modell, ändra verifikationer eller skapa en ny databas.

## Vad användaren kan göra

I `AI-bokföring`:

1. Välj en **textbaserad, passiv PDF** med en vanlig svensk leverantörsfaktura och klicka **Läs PDF lokalt**. Originalet lämnar inte webbläsaren.
2. Klicka **Hitta konto från tidigare bokföring**. En personlig, autentiserad session läser enbart de leverantörer och leverantörsfakturor som användaren redan har behörighet att läsa i **sitt aktuella företag**. Läsningen går till Supabase med befintlig RLS och explicit `company_id`-filter.
3. Systemet söker efter **exakt samma leverantörsnamn** i företagets leverantörsregister. Ingen fuzzy matching, ingen gemensam kunddatabas och inga liknande leverantörer från andra företag.
4. För att föreslå ett kostnadskonto krävs **minst tre unika PDF-original** från leverantören, med **samma momssats**, **samma kostnadskonto** och verifierbara metadata för **mänsklig attest och genomförd leverantörsskuldskontering**.
5. Om kriterierna uppfylls visas kontonummer, kontonamn och hur många tidigare bokförda underlag som stöder mönstret. Användaren måste uttryckligen klicka **Välj föreslaget konto** och sedan **Visa granskningsutkast**. Ingen bokföring, betalning, attest eller databasändring görs här.

Första versionen stöder endast de enkla kostnadskonton som redan finns i den lokala granskningsmotorn: `6110`, `5460` och `6540`. Fler BAS-konton, blandad moms, krediter och komplexa underlag ska **inte** gissas fram.

## Vilka historiska poster får räknas?

- Samma `company_id` och exakt matchande `supplier_id`, hämtade via befintliga tenant-skyddade tabeller `suppliers` och `supplier_invoices`.
- `approved_by` och `approved_at` finns **och** `liability_accounting_entry_id` och `liability_posted_at` finns; status är `approved`, `payment-prepared` eller `paid`.
- Både `pdf_sha256` och `coding_sha256` är giltiga SHA-256-fält. Samma originalhash får bara räknas en gång.
- Valuta `SEK`, momshantering `se-domestic-full-input-vat`, enkel balanserad kontering med ett tillåtet kostnadskonto, `2641` för ingående moms när moms finns och `2440` för leverantörsskuld. Beloppen måste stämma i ören.
- 0/6/12/25 % svensk moms endast när momssatsen är entydig. En annan momssats eller ett blandat underlag ger inget förslag.
- Om historiken innehåller **motstridiga konton** för samma leverantör och momssats stoppas förslaget helt. Även två identiska exempel är för få.

PDF:ens egen säkerhetsgrind från PR #815 gäller också: kreditfakturor, returkvitton, negativa summeringar, flera momssatser, beloppsavvikelser och utländsk valuta får **inte** användas för denna enkla rekommendation.

## Säkerhetsgränser och integritet

- **Ingen automatisk inlärning av obekräftade AI-svar eller användarens preliminära klick.** Endast historik som redan har attesterats och bokförts får påverka rekommendationen.
- Den här etappen är en **läsbaserad historikrekommendation**, inte finjustering/träning av Cloudflare/Gemini och inte autonom bokföring.
- Historiken laddas till användarens inloggade webbläsare genom befintlig RLS-skyddad läsning, utan nya `GRANT`-behörigheter. Ingen historik eller fakturatext skickas till en extern modell.
- Vid byte av företag, användare eller PDF under asynkron hämtning ignoreras resultatet. Resultat sparas inte i `localStorage`, `sessionStorage`, Supabase, GitHub eller automationskön.
- En läsning begränsas till högst 200 leverantörer och 200 tidigare fakturor. Om en leverantör saknas i den begränsade läsningen blir det inget förslag.
- Klientens rekommendation är **aldrig en servergodkänd bokföringsorder**. Den får inte återanvändas som attest, betalningsinstruktion eller auktorisation för automatisk bokföring.
- Ingen ny tabell, migration, Edge Function, hemlighet eller aktiverad AI-releaseflagga. `AI_PILOT_RELEASED=false`, `RELEASE_APPROVED=false` och `DURABLE_IP_LIMITER_VERIFIED=false` gäller fortsatt.

## Varför denna ordning?

Det finns redan ett äldre leverantörskonteringsförslag i `packages/automation/supplier-coding.js` för den lokala/legacy-backenden. Den använder bland annat historiska konton och leverantörens standardkonto. Den nya **aktiva Supabase-portalen** behöver striktare kriterier för verkliga företag: **genomförd bokföring, PDF- och konteringshash, isolerad tenant, entydig moms, flera oberoende exempel och ingen automatisk exekvering**. Vi återanvänder befintliga datatabeller och granskning, inte en parallell bokföringsmotor.

## Nästa steg mot riktig autonom bokföring

1. Flytta själva mönsterberäkningen till en **serverägd, versionsstyrd, auditerad gräns** som hämtar bevis från bokförda verifikationer och underlag. Klientens indata ska aldrig räcka för att kalla ett exempel `approved`.
2. Bygg ett tydligt **feedbackflöde**: ett mänskligt ändrat och attesterat förslag blir ett verifierat tränings-/regel-exempel först efter att bokföringen verkligen har genomförts. Vid rättelse ska tidigare mönster återkallas eller omvärderas.
3. Serverägd PDF/OCR-extraktion och kontrollerad AI-modell som kan föreslå kategorier för fler inköp, med GDPR/DPA-godkännande och strikt tenant-isolering.
4. Skapa förslag i **befintlig automationskö**, med oberoende kontroll av belopp, moms, BAS-konto, dubbletter, låst period och underlag. Människa godkänner osäkra fall.
5. Senare: företagsspecifikt opt-in och snäva, serververifierade regler för vissa återkommande fall. **Ingen modell får bokföra, betala eller attestera själv** utan godkänd domän-RPC, idempotens, audit och separat releasebeslut.

Regressionstester: `test/ai-posted-history.test.js` och befintliga PDF-/granskningstester. GitHub CI krävs före merge.
