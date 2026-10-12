# Bokslut – etapp 2A: exakta serverantal och tidiga avvikelser

Huvudärende: #745. Den här ändringen bygger vidare på etapp 1 (PR #746) i den aktiva portalen, utan att ändra ekonomisk data eller införa ny databasstruktur.

## Levereras
- Välj kalenderår och hämta ett exakt antal verifikationer inom [1 januari, 1 januari nästa år), via Supabase/PostgREST `Prefer: count=exact` och samma personliga JWT/RLS och `company_id` som övriga portalen.
- Hämta exakta totalantal för hela företagets verifikationer och kontorader (ej årsskopade), öppna buntar och omatchade bankhändelser före årets slut.
- Markera väntande buntar/omatchade bankhändelser som *Behöver hanteras*. Misslyckade räkningsanrop, okänd status och ogiltiga värden ska vara **okända**.
- Visa aldrig en generell **Bokslut klart**-status. Antalsmatchning är inte en avstämning.

## Viktiga avgränsningar
- Detta är **inte** fullständighets-/avstämningsmotorn ännu. Särskilt kan kontorader ännu inte årsskopas med en enda befintlig `countExact`-förfrågan. En atomär databassnapshot finns inte. Skillnader mellan samtidiga anrop är möjliga.
- Oplacerade bankhändelser visas före kalenderårets slut; de kan innefatta händelser från tidigare år och gör ingen saldokontroll.
- Buntar räknas företagsövergripande; utan komplett data för status och år får de inte användas som godkännandebevis.
- En kalenderårsväljare fastställer inte företagets **räkenskapsår**, regelprofil K2 eller brutet år.
- 1510/2440, moms, bankens externa kontoutdrag, lagervärdering, underlag och signeringskrav är ännu inte automatiskt avstämda.

## Nästa etapp 2B (kräver separat granskning/migration)
Bygg en enda `SECURITY INVOKER` eller strikt verifierad serverbaserad årssammanställning med definierat start-/slutdatum för räkenskapsåret, en konsistent snapshot, komplett join av verifikationer och kontorader, belopp i heltalsören, källreferenser, avvikelser och totalsaldon. Skydda användare/företag med aktiv JWT, medlemskap, RLS, roll och test av åtkomst till ett annat företag. Låt inte någon av dessa kontroller bli `verified` utan explicit bevis.

## Test
`test/year-close-counts.test.js` täcker mer än 1 000 verifikationer, konsekvent företagsskopning, serverfel, åtgärdsvärden och kalenderårsgränser. CI kör Quality, CodeQL, Supabase clean rebuild och browser-screenshots. Skarp UAT måste verifieras med syntetiskt företag efter merge.
