# Etapp 2C – vägledning för leverantörsfakturor

Datum: 2026-10-12. Huvudplan: [#749](https://github.com/ludwigberglund-coder/LT-Studio/issues/749).
Föregående steg: [#750](https://github.com/ludwigberglund-coder/LT-Studio/pull/750), [#753](https://github.com/ludwigberglund-coder/LT-Studio/pull/753) och [#756](https://github.com/ludwigberglund-coder/LT-Studio/pull/756).

## Utgångspunkt
I den befintliga leverantörsfakturaportalen finns redan PDF, belopp, momsbehandling, konteringsförslag, balanseringskontroll, attest, buntbokföring och betalningsflöde. Men användaren måste själv avgöra vad nästa steg är utifrån tekniska etiketter. Vi ska återanvända det befintliga flödet, **inte** ersätta affärslogik eller säkerhetskontroller.

## Levererat i denna PR
- På leverantörsfakturans granskningssida visas **Så gör du med fakturan** före detaljerna.
- Texten utgår från **den valda fakturans verkliga status**, utan automatiska skrivningar: ny/konteringsgranskning, sparad kontering som väntar attest, attesterad men ej bokförd, bunt som väntar godkännande, bokförd skuld, förberedd betalning och betald.
- Mottagarens namn, moms, fakturadatum, förfallodatum, konteringsrader, balansvarning och fakturaoriginalet finns kvar i samma vy.
- En hopfällbar förklaring av *debet, kredit och attest* ger stöd utan att dölja eller ändra några bokföringsfält.
- Vägledningen skiljer uttryckligen mellan attest, bokförd skuld och bankbekräftad betalning; den får aldrig felaktigt ange att skulden är betald.
- Inga nya API:er, mutationer, migrationsfiler, roller, kontoförslag eller automatisk attest.
- Responsiv design och tangentbordstillgängligt `details/summary`; ingen extra extern tjänst.

## Tester / godkännandekriterier
- Befintligt `test/payables-browser.test.cjs` går igenom en syntetisk faktura från registrering till attest, bokförd skuld och bekräftad betalning, och verifierar vägledningens status vid varje steg.
- Testet verifierar också att förklaringen är frivillig, medan den fullständiga bokföringstabellen är fortsatt synlig.
- Säkerställ kvalitetstest/CodeQL/Supabase clean rebuild före merge, mot senaste `main`.
- Efter merge: verifiera GitHub Pages UAT-publicering. Inloggat manuellt test med syntetiska företag återstår före produktionsbedömning.

## Nästa steg – separat ärende/PR
Kartlägg fortsatt hur tekniska kontoval, momsbehandling och uppladdning av PDF-underlag kan få tydligare förklaringar. Automatisk kontering och automatisk attest kräver eget säkerhets-/redovisningsgodkännande; gissa aldrig momssats eller undvik manuell granskning vid osäkerhet.

**GitHub main är source of truth** för kod och arbetsplan. Kunddata och autentiseringsuppgifter ska aldrig sparas i repositoryt.
