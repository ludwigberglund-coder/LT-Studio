# Månadsguide – avgränsning och verifiering

Produktinitiativ: [#727](https://github.com/ludwigberglund-coder/LT-Studio/issues/727). Implementeringsärende: [#733](https://github.com/ludwigberglund-coder/LT-Studio/issues/733).

## Första versionen: hjälp till mänsklig avstämning, inte automatik

Guiden visas inne i befintlig **Bokföring & perioder** och bygger på den aktuella inlästa periodstatusen, kontrollerade tenant-sessionen och visade verifikationerna. Alla ekonomiska datakällor hämtas redan av bokföringsvyn; guiden inför **inga** nya API-anrop.

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
