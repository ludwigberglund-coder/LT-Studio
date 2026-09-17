# Gemensam meny och godkänd kundfaktura

## Syfte och avgränsning

GitHub är källan för kod, dokumentation och byggd demo. CAMT/BAM-import ingår inte i denna ändring. Ingen riktig faktura, e-post eller bankbetalning skickas från den öppna demon.

## Menyn

`apps/portal/portal-nav.js` är den gemensamma menydefinitionen. Samma grupperade navigation används i byggda portal-, admin- och legacy-vyer. Synlig meny ger aldrig i sig serverbehörighet.

## Godkänt kundfakturaflöde

1. Välj **Kundnummer**.
2. Kontrollera eller komplettera **Företagsnamn - kund**, **Organisationsnummer - Kund**, **Fakturaadress, postnummer och ort - kund** och valfri **Mottagarens E-post - kund**.
3. **Fakturadatum** och **Bokföringsdatum** fylls automatiskt med dagens datum men kan ändras. Bokföringsdatum visas inte på kundens PDF.
4. **Betalningsvillkor dagar** är 30 som standard och styr automatiskt **Förfallodatum**. Förfallodatum kan därefter kontrolleras i formuläret.
5. **Vår referens** och **Er referens** är valfria.
6. OCR är ett låst systemvärde och blir alltid identiskt med det sexsiffriga fakturanumret när fakturan bokförs.
7. Lägg till en eller flera fakturarader med **Benämning**, **Antal**, valfri **Enhet**, **À-pris exkl. moms, SEK**, **Momssats** och **Intäktskonto**.
8. Vald momssats styr vilka intäktskonton som kan väljas. Motorn gör samma kontroll igen före bokföring.
9. Fakturaavgift/frakt aktiveras med en checkbox. Fakturaavgift är 25 % moms på konto 3690. Frakt är 25 % moms på konto 3520 Fakturerade frakter. Konto 5710 används inte för fraktintäkt eftersom det är ett kostnadskonto.
10. Öresutjämning beräknas alltid automatiskt och bokförs separat på 3740.
11. Avsändaruppgifterna ligger i en stängd utfällbar sektion och hämtas centralt från företagsinformationen. De ändras inte i fakturafönstret.
12. Meddelande på faktura är valfritt och aktiveras med checkbox.
13. Utkast kan sparas. PDF kan öppnas eller skrivas ut före bokföring. **Skapa och bokför faktura** skapar kundfaktura och balanserad verifikation tillsammans.

## Fält som inte längre finns i nya fakturaflödet

Följande tas inte längre in manuellt på en ny kundfaktura: mottagarens VAT-nummer och telefon, leverans-/utförandedatum, betalningsvillkorstillägg, ordernummer, redigerbar OCR, redigerbar dröjsmålsränta, leveransvillkor, leveranssätt, avvikande leveransadress, artikelnummer, rabatt, förklaring för 0 % moms, styrelsens säte, Plusgiro, IBAN, SWIFT/BIC, Swish och interna anteckningar.

Dröjsmålsräntan skrivs i stället automatiskt på kundfakturan som:

> Efter förfallodagen debiteras dröjsmålsränta enligt räntelagen med referensränta + 8 %enheter.

## Intäktskonto och moms

`packages/invoicing/invoice.js` använder heltal i ören. Standardkontona är momsmärkta och fakturaverktyget visar bara konton som matchar vald momssats:

- 25 %: bland annat 3041 och 3051 samt systemkontona 3520 och 3690 när de används för respektive avgift.
- 12 %: 3042 och 3052.
- 6 %: 3043 och 3053.
- 0 %: 3044 och 3054.

Egna faktureringskonton måste ligga i klass 3, ha namn och en explicit momssats 25/12/6/0. Konto 3740 är reserverat för öresutjämning. Ett konto med fel momskoppling stoppas både i formuläret och i bokföringsmotorn.

Verifikationen använder 1510 för kundfordran, valt intäktskonto, 2611/2621/2631 för utgående moms och vid behov 3740 för automatisk öresutjämning. Verifikationen måste balansera innan något sparas.

## Avsändaruppgifter

Företagets juridiska namn, organisationsnummer, adress, VAT-nummer, telefon, e-post, webbplats, skattestatus och Bankgiro hämtas från `content/company.json`. Den öppna demon innehåller inte påhittade skarpa bankuppgifter; demo-bankgiro är tydligt markerat och måste ersättas med verifierad information före pilot/skarp användning.

## Kund-PDF

Kundens PDF innehåller fakturanummer, fakturadatum, förfallodatum, kundnummer, betalningsvillkor, OCR, valfria referenser, parterna, fakturarader, momsuppdelning, fakturaavgift/frakt när de används, automatisk öresutjämning, slutsumma, dröjsmålsräntetext, valfritt meddelande samt företagets kontakt- och Bankgiroinformation.

Bokföringsdatum och interna intäktskonton visas inte på kundens PDF. De kan finnas i separat internt underlag. Långa fakturor pagineras.

## Regression och kontrollkedja

- `npm test` testar beräkningar, momskontokoppling, OCR, öresutjämning, bokföringsbalans, periodlås, PDF och att övriga domäner fortfarande fungerar.
- `test/menu-invoice-browser.cjs` går igenom den gemensamma navigationen och ett verkligt browserflöde: kontoplan → kundfaktura → bokföring → kundreskontra → bokföringsvy → rapporter.
- Leverantörsfakturans befintliga browserflöde körs också vid varje CI-körning så att kundfakturaändringar inte får slå sönder inköpsflödet.
- GitHub Actions måste vara grön innan ändringen slås ihop till `main`.
