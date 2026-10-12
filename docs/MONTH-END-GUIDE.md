# Månadsguide – avgränsning och verifiering

Produktinitiativ: [#727](https://github.com/ludwigberglund-coder/LT-Studio/issues/727). Implementeringsärende: [#733](https://github.com/ludwigberglund-coder/LT-Studio/issues/733).

## Första versionen: hjälp till mänsklig avstämning, inte automatik

Guiden visas inne i befintlig **Bokföring & perioder** och bygger på den aktuella inlästa periodstatusen, kontrollerade tenant-sessionen och visade verifikationerna. Den första guiden använde enbart bokföringsvyns inlästa poster. Nästa steg tillför tre **skrivskyddade, exakt räknade Supabase REST-frågor**. De jämför hur många rader databasen rapporterar med hur många som lästes in.

Den erbjuder länkar till samma portal för att manuellt kontrollera:
1. Bank och fakturamatchning.
2. Oplacerade betalningar.
3. Kundfakturor.
4. Leverantörsfakturor.
5. PDF-underlag.
6. Bokföringsbuntar.
7. Rapporter och moms.

**Alla sju punkter säger ”Kontrollera manuellt”.** Även en helt tom kö betyder inte att en månadsavstämning är utförd. Visat antal verifikationer betyder antal poster i den inlästa listan, inte fullständighet.

Före användaren väljer att låsa aktuell period visar gränssnittet en uttrycklig bekräftelsedialog. Den befintliga bokförings- och periodlåsningen på serversidan är oförändrad och kräver fortfarande sina ordinarie kontroller. Ingen ny automations-/godkännanderätt införs.

## Testkrav
- Node-test av länkarnas korrekta mål, demo-query, ofullständig information och låst/okänt periodläge.
- Integrationstest för script-/CSS-laddning och dialog före periodlås.
- CI: Quality, CodeQL och Supabase clean rebuild innan PR merge.
- UAT: kör bara syntetiskt företag; kontrollera mobil, ljus/mörkt läge, tangentbord, att länkarna öppnar rätt modul och att avbryt i dialogen lämnar perioden oförändrad.

## Fortfarande framtida arbete
- Verifierbara bank-/reskontra-/momsavstämningar, per-period underlagsstatus och beslutslogg ska byggas via egna granskade server-/databasflöden om de behövs. UI:t ska inte införa ”klart”-markörer förrän dessa kontroller finns.
- Komplett skarp periodavslutsfunktion kräver redovisningsmässig slutverifiering, formella säkerhetsgrindar och godkänd produktion. **Systemet är fortfarande UAT.**
- Projektets `AGENTS.md` PDF-policy (endast passiva PDF) och tenant-isolering gäller fortsatt.

## Steg 2 – serverantal och kontroll av ofullständig inläsning (#741)

Från och med nästa etapp räknas i den autentiserade UAT-miljön tre saker direkt i Supabase/PostgREST, med **samma personliga session och `company_id`-filter** som resten av bokföringsvyn:

1. Totalt antal verifikationer användaren har tillgång till för sitt företag.
2. Totalt antal kontorader användaren har tillgång till för sitt företag.
3. Antal verifikationer under aktuell kalendermånad.

Dessa värden jämförs med de journal- och kontorader som portalen faktiskt fått tillbaka. Det skyddar särskilt mot tyst trunkering vid PostgRESTs maxantal returnerade rader, exempelvis när det finns fler än 1 000 poster.

**Viktig avgränsning:** Om antalen matchar betyder det *enbart* att de tre antalsjämförelserna stämmer när förfrågningarna gjordes, under aktuell sessions RLS-behörighet. De tre serveranropen och de vanliga läsanropen har inte en gemensam transaktionsögonblicksbild; samtidiga bokföringar kan ge tillfälliga differenser. Antalsmatchning bevisar inte att varje verifikation har identiskt innehåll, att periodens huvudbok är fullt genomgången eller att bank/reskontra/moms är avstämd.

Om någon räkningsförfrågan misslyckas, ger oläsbar `Content-Range`, har fel företag/period eller inte går att lita på visas **"Inläsningen behöver kontrolleras"** i stället för en grön status. När antalen skiljer visas en tydlig varning med vilka tal som inte stämmer. Demo/äldre lokal backend saknar denna verifiering och ska aldrig markeras som fullständigt kontrollerad.

Ingen ny migration, RPC, Edge Function, databasrättighet eller ekonomisk skrivning har tillkommit. Gränsen för företag och användare är fortfarande Supabase RLS tillsammans med personlig session och MFA. Detta är inte en ersättning för serverbaserad periodavstämning och utgör inte produktionsgodkännande.

### Kontrollfall
- Supabase svarar 0, 1 och över 1 000: `Content-Range` ska hanteras korrekt.
- Antal huvudboksrader i databasen större än listan → tydlig varning.
- Antal kontorader större än listan → tydlig varning.
- Saknat åtkomsttillstånd, fel i nätverk eller inget exakt count-header → okänd status.
- Fel företag eller fel period får inte återanvända tidigare kontroll.
- Bokföringsvyns korta, sökbara verifikationslista får inte ändras.
- Ingen automatiskt attest och ingen ny möjlighet att ändra bokföringen.

## Tidsgräns för antalskontroller (2026-10-12)

De autentiserade antalsjämförelserna är ögonblicksbilder, inte löpande övervakning. När de är äldre än **fem minuter**, saknar tidsstämpel eller innehåller en orimligt framtida tidsstämpel går kontrollstatus från `matched`/`mismatch` till **okänd**. Användaren kan trycka på **Uppdatera kontrollen** för att ladda om bokföringssidan och hämta aktuell data.

När användaren återvänder till fliken uppdaterar gränssnittet tidsbedömningen, och det gör även en lättviktig kontroll var 30:e sekund medan sidan är öppen. Ingen bakgrundsbokföring, ny databaskostnad eller ändrad rättighet tillkommer.

**Begränsning:** Ett färskt radantal bekräftar bara att radantalsjämförelsen gjordes nyligen. Det betyder inte att ingen annan användare har bokfört efter tidpunkten, eller att perioden är avstämd. Kontroll med två fiktiva företags-ID:n finns i automatiska testfall; en verklig inloggad UAT med två separata företag kräver fortfarande separat verifiering.

## Oplacerade bankbetalningar – första läsbaserade indikation (2026-10-12)

Månadsavstämningen visar antalet registrerade bankbetalningar med `status=unmatched` för **det personligt inloggade företaget** genom Supabase/PostgREST `countExact`. Räkningsförfrågan är separat från journalernas fullständighetskontroll, och den använder befintlig personlig token, `company_id`-filter och RLS. Fel, utgången tidsgräns (fem minuter), fel företagsidentitet eller misslyckad hämtning ger **okänd** status; det visas aldrig som en lyckad avstämning.

Antalet gäller **hela företagets registrerade bankhändelser** och är inte avgränsat till vald månad eller avstämt mot bankens verkliga kontoutdrag. Noll oplacerade betalningar betyder inte att bank eller moms är avstämd. I demo/äldre backend anges att antalet inte verifierats. Ingen ny databasmigration, ekonomisk skrivning, automatisk betalningsmatchning eller kostnadskrävande tjänst ingår.

Verifieras genom syntetiska testfall för 0, 1, flera, fel tenant, ogiltig tidpunkt, gammalt svar och oläsbart databassvar. Inloggad UAT med två olika testföretag kräver fortfarande separat verifiering.
