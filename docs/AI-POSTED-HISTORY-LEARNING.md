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

## 2026-10-15: Säkra automatiska granskningsutkast efter PDF-läsning

Efter att användaren har läst en **vanlig, textbaserad leverantörsfaktura** lokalt på AI-bokföringsfliken startar nu historikjämförelsen **automatiskt** när grundkontrollerna inte visar kredit, negativa belopp, flera momssatser eller summeringsproblem. Som tidigare läses endast företagets egna, RLS-skyddade historiska poster via användarens inloggade session.

- Finns exakt **en** historiskt enhetlig kostnadskategori från **minst tre** unika, attesterade och bokförda PDF-original, och den gemensamma granskningsmotorn accepterar beloppen, fylls kostnadskontot i och **ett tillfälligt konteringsutkast visas direkt**.
- Om historik saknas, är motsägelsefull eller inte går att verifiera, används **inget standardkonto**. Användaren får uttryckligen välja inköpstyp. Vid kvitto krävs dessutom manuellt val av betalningssätt.
- Om användaren ändrar kostnadskonto medan jämförelsen pågår får det sena historiksvaret **inte** skriva över användarens val. Byte av underlag eller dokumenttyp ogiltigförklarar förra läsningens asynkrona jämförelser.
- När originalet är osäkert får historiken inte påbörja automatisk förberedelse; inga PDF-uppgifter, historik eller förslag skickas till modell.

**Detta är automatiserad förberedelse, inte automatisk bokföring och inte riktig AI.** All data stannar i befintliga webbläsarminnet och användarens vanliga, RLS-begränsade Supabase-läsningar. En föreslagen kontering är inte verifierad mot aktuell bokföringsperiod, dubbelbokning eller affärstransaktion; det finns fortfarande ingen godkänn-, spara-, attest- eller bokföringsåtgärd i detta steg. Inga externa AI-anrop, ändrade databasbehörigheter eller releaseflaggor.

Regressionstester: `test/ai-posted-history.test.js` (automatisk visning, manuell override, fel tenant, saknad/motsägelsefull historik, krediter, kvitton) samt befintlig `test/ai-document-review.test.js` och Quality/CodeQL/Supabase clean rebuild.

### Nästa säkra etapp

För produktion behövs fortfarande en serverägd dokument- och historikvalidering före förslagskö, en granskningsbar koppling till **befintlig** automationskö och en separat, auditerad bokförings-RPC. En faktisk Cloudflare AI-modell kan först användas med syntetiska fall när pilotens drifts-/IP-/kvotgrind har verifierats; verkliga kunddata kräver dessutom godkänd behandling. Öppna inte bokföringsspärrar enbart baserat på det lokala utkastet.

## 2026-10-15: Evidensbaserat konteringsutkast i vanliga Leverantörsfakturor

Den aktiva Supabase-fliken `Leverantörsfakturor` använder nu samma `apps/portal/ai-posted-history.js` som AI-bokföring. Därmed får kunderna en enda restriktiv historikmotor även i det vanliga fakturaflödet. Ingen ny parallell bokföringsväg har skapats.

- Vid **Hämta konteringsförslag** kontrolleras den valda, ännu inte konterade fakturans `company_id`, PDF-originalets SHA-256 mot dokumentregistret, MIME-typ/filstorlek, status, valuta, fakturanummer och momssats. Företagets befintliga historik läses med den redan etablerade personliga RLS- och MFA-skyddade Supabase-sessionen.
- Konteringsutkast skapas bara om **minst tre** unika, mänskligt attesterade **och bokförda** original från samma `supplier_id` visar samma kostnadskonto och moms. Dubblettkontroll av PDF-hash gäller även andra leverantörer; samma leverantör + fakturanummer är också blockerande. Motsägelsefull historik, oläsbart/orent underlag och olåsta eller felaktiga jämförelser lämnas till granskning.
- Om säkert historikstöd saknas ges **ingen fiktiv 94-procentig säkerhet och inget automatiskt konto 4010**. En användare kan i stället uttryckligen välja 4010, 6110, 5460 eller 6540 för ett *lokalt, tillfälligt* granskningsutkast – endast om original- och dubblettkontrollerna lyckas. Urvalet är en begränsad första version, inte en fullständig BAS-kontoplan.
- Utkastet visas som **ej sparat** och **inte AI-genererat**. Att spara kräver fortfarande den befintliga `save_supplier_invoice_coding`-RPC:n. Attest går via `approve_supplier_invoice` med käll-/konteringshash och leverantörsskulden via `post_supplier_invoice_liability` med befintliga finanskontroller. Varken AI:n eller historikförslaget får kalla dem automatiskt.
- PDF:en hämtas aldrig till en extern AI-modell; inga Cloudflare-anrop, databas-skrivningar, migreringar, nya behörigheter eller ändrade AI-releaseflaggor ingår. Sidan gör fortfarande enbart läsningar vid detta förslag. Klientdata är **aldrig serverbevis** för behörighet eller automatbokning.

Regressionerna i `test/ai-payables-posted-history.test.js` kontrollerar fel företag, samma PDF under annan leverantör, samma fakturanummer, osäker moms, fel dokumenthash, otillräcklig historik, manuell ersättning och UI utan modell-/bokföringsanrop. Utöver detta måste PR:ens fulla Quality/CodeQL/Supabase clean rebuild godkännas innan merge och GitHub Pages publiceringskörningen verifieras efter merge.

### Kvarstår inför skarp AI och automatisk bokföring

En extern modellkoppling behövs fortfarande via hostad, säker och godkänd servergateway. AI-förslag måste kopplas till befintlig automationskö genom versionerade serverbevis, inte genom dessa webbläsarutkast. Produktionsversionen måste även kontrollera aktiva BAS-konton, räkenskapsperiod, momsregler, dubbletter och source-hash atomärt i den vanliga revisionsspårade ekonomiska RPC:n innan en fördefinierad, företagsspecifik opt-in ens får möjliggöra autobokning. Detta ingår **inte** i dagens etapp.
