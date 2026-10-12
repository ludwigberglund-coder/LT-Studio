# Etapp 2B – enklare kundfaktura utan att förenkla bort kontroller

Datum: 2026-10-12
Huvudplan: [#749](https://github.com/ludwigberglund-coder/LT-Studio/issues/749).
Tidigare leveranser: [#750](https://github.com/ludwigberglund-coder/LT-Studio/pull/750) (två menylägen) och [#753](https://github.com/ludwigberglund-coder/LT-Studio/pull/753) (snabbvägar).

## Utgångspunkt i aktuell GitHub-kod
Kundfakturans formulär i `apps/portal/invoices.js` kräver konto per fakturarad, även när företaget bara har ett upplagt intäktskonto för vald momssats. Det har också två valfria referensfält och låst OCR-information mitt bland förfallodatum och betalningsvillkor. Därför bör enklare informationsprioritering användas, utan att ta bort uppgifter eller kontroller.

## Implementerat i denna PR
- Den öppna datumsektionen heter **Datum och betalningsvillkor**. Frivilliga referenser och OCR visas under en expanderbar rubrik **Fler uppgifter (referenser och OCR)**.
- Referenserna förblir i samma fakturaformulär och i sparat utkast; de försvinner inte bara för att gruppen är stängd.
- **Intäktskonto:** När användaren väljer 25, 12 eller 6 % moms får systemet föreslå ett upplagt intäktskonto **endast om det finns exakt ett tillåtet konto för den momssatsen i företagets befintliga kontoplan**. Om det finns flera, eller inga, görs inget kontoval; användaren får tydlig förklaring.
- Valet är alltid synligt och ändringsbart. Föreslagna konton är aldrig ett löfte om att momssats, konto eller behandling är bokföringsmässigt korrekt.
- Om momssatsen ändras rensas tidigare inkompatibelt konto innan det eventuellt ersätts med ett enda tillåtet val.
- Bokföringsmotorns befintliga momskopplingsvalidering, fakturanummer, dataskydd, utkast, pdf-generering, CSRF, tenant-isolering och godkännandesteg har inte ändrats.

## Test och verifiering
- `test/menu-invoice-browser.cjs` kontrollerar att valfria fält faktiskt är stängda vid start och att inskriven referens finns kvar i FormData efter stängning.
- Samma webbläsartest verifierar att det **inte gissas** om flera konton är upplagda för momssatsen.
- Säkerhetsgränsen behålls: servern och bokföringsmotorn ska fortsätta neka ogiltiga konton/momskombinationer.
- GitHub Quality, CodeQL och Supabase clean rebuild måste vara gröna före merge.
- Därefter krävs publicerad Pages-UAT samt senare inloggat mänskligt test med syntetisk kund/faktura, inklusive mobil och mörkt läge.
- Ingen ekonomisk backend- eller migrationsändring ingår.

## Nästa del av #749 (fortfarande öppen)
Leverantörsfakturans konteringsöversikt och hjälptips kan organiseras i en tydligare ordning. Varje bortdöljning måste först kontrolleras mot attest, moms, bilagor och befintliga testsidor. Gör detta i separat PR efter avstämning med de andra agenterna.

GitHub main är alltid source of truth. Inga verkliga ekonomidata eller autentiseringsuppgifter hör hemma i GitHub.
