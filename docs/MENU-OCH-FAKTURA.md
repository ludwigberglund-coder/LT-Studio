# Gemensam meny och fullständigt fakturaunderlag

## Syfte och avgränsning

Denna ändring svarar på två konkreta problem: menyval försvann vid sidbyten/omrendering och mobilvisning; fakturaverktyget saknade fullständiga uppgifter, tydlig PDF-utskrift och valbar intäktskontering.

GitHub är källan för kod, dokumentation och byggd demo. CAMT/BAM-import ingår inte. Ingen riktig faktura, e-post eller bankbetalning skickas. Den moderna fakturautställningen är fortfarande en lokal webbläsardemo, inte en ansluten fleranvändartjänst eller produktionsgodkänd bokföringsprodukt.

## Menyn

`apps/portal/portal-nav.js` innehåller den enda menydefinitionen. Grupperna är **Arbetsyta**, **Ekonomi**, **Register & verksamhet**, **Systemadministration** och **Test & hjälp**. Samma 31 länkar finns i varje byggd arbetsvy; gruppens rubrik fäller ut eller ihop dess länkar. Den aktiva sidan markeras.

Alla ekonomiverktyg, inklusive kund- och leverantörsreskontra, bank, automation, bokföring, rapporter, kontoplan och lön, ligger under Ekonomi. Kund-/leverantörsregister och lager ligger under Register & verksamhet. Systemadministration innehåller bland annat webbplatsinnehåll, dokument, behörigheter och verksamhetsbeslut.

Byggscriptet installerar menyn och `shared-nav.css` i samtliga HTML-filer under de byggda mapparna `portal/`, `admin/` och `legacy/`. Det gäller även om en äldre sida ersätter sin sidomeny när ett formulär öppnas, sparas eller stängs. Mobilregler får inte gömma inaktiva länkar. Långa menyer är rullningsbara.

Den publika företagssidan är avsiktligt inte en intern arbetsvy. Synlig meny ger aldrig serverbehörighet. Äldre referensverktyg är märkta **äldre demo** eftersom de har separat demodata; en gemensam meny ändrar inte deras datalager.

## Fakturaverktyget – arbetsgång

1. Öppna Ekonomi → Kundfakturor → Ny kundfaktura.
2. Välj kund och komplettera fakturaadress. Kundregistret kan nu också spara adress och VAT-nummer.
3. Fyll i datum, referenser, leverans- och betalningsvillkor samt avsändaruppgifter.
4. Lägg till fakturarader och **välj intäktskonto på varje rad**. Olika rader får ha olika intäktskonton.
5. Granska fakturan/PDF utan att bokföra. Ett utkast kan sparas och fortsättas senare.
6. Välj Skapa och bokför faktura. Fakturan och en balanserad verifikation sparas tillsammans i den gemensamma demodatan.
7. Hämta kund-PDF, öppna dess utskriftsvy eller hämta hela det interna underlaget som PDF.

Kundfakturan har en sparad ögonblicksbild av parter, rader, priser, referenser och konton. Senare registerändringar skriver inte om dess ursprungsuppgifter. Äldre demofakturor utan kompletta uppgifter får en synlig varning; saknade uppgifter uppfinns inte.

## Fälten från den bifogade mallen

Underlaget bygger på fältindelningen i användarens ensidiga **fakturamall Rollands.pdf**. Originalmallen publiceras inte och dess leverantörslogotyp återanvänds inte.

| Mallens område | Inmatning och utskrift |
|---|---|
| Fakturaidentitet | Fakturanummer, fakturadatum, förfallodatum, kundnummer och ordernummer. Unikt fakturanummer tilldelas vid bokföring. |
| Avsändare och mottagare | Namn, fullständig adress, organisationsnummer och VAT-nummer. |
| Referenser och villkor | Vår referens, er referens, betalningsvillkor, dröjsmålsränta i avtalad text, leveransvillkor och leveranssätt. |
| Rader | Artikelnummer, benämning/beskrivning, antal, enhet, à-pris och radbelopp. |
| Moms och totalsummor | Underlag och moms per 25/12/6/0 %, expeditionsavgift, frakt, belopp före moms, total moms, öresutjämning och att betala i SEK. |
| Kontakt och betalning | Telefon, webbplats, e-post, org.nr, VAT.nr, SWIFT/BIC, IBAN, Bankgiro, Plusgiro och Swish. |

Dessutom finns leverans-/utförandedatum, rabatt per rad, styrelsens säte, skattestatus, avvikande leveransadress, momsupplysning, kundmeddelande, bokföringsdatum och interna anteckningar. Uppgifter som inte är tillämpliga får vara tomma; kärnuppgifter och valbart intäktskonto valideras. Minst ett betalningssätt måste anges. Okända betalningsuppgifter fylls inte i automatiskt.

Kontroll av fälten ersätter inte kontroll av faktisk företagsidentitet, avtal, momssats eller rättslig grund. För vanliga fullständiga fakturor finns extern vägledning hos Skatteverket: https://www.skatteverket.se/foretagochorganisationer/moms/saljavarorochtjanster/fakturering.4.58d555751259e4d66168000403.html

## Intäktskontering och pengar

`packages/invoicing/invoice.js` använder den befintliga exakta öresmodellen. Kontoplan & intäktskonton låter användaren lägga till ett eget namngivet konto i klass 3 eller 83; 3740 är reserverat för öresutjämning. Bank-, moms- och kostnadskonton kan inte väljas som intäktskonto.

Frakt och expeditionsavgift har egna konto- och momsval och räknas bara en gång. Verifikationen använder valda intäktskonton, 1510 för kundfordran, 2611/2621/2631 för utgående moms enligt vald momssats och 3740 för eventuell öresutjämning. Kontonamnet bestämmer inte automatiskt vilken momssats som är korrekt för en vara eller tjänst.

Ogiltiga belopp, saknade kärnuppgifter, låst period, dubbelt internt id och obalans stoppas före sparning. För 0 % moms krävs en förklaring i underlaget.

## Två PDF-utskrifter

**Kundfaktura:** en verklig A4-PDF med samtliga externa fakturauppgifter, tydlig betalningssumma, momsuppdelning, betalningsuppgifter och sidnumrering. Långa fakturor får flera sidor. PDF-filen öppnas separat; menyn och bakomliggande fakturalista skrivs inte ut.

**Hela underlaget:** samma kundfaktura plus en intern bilaga med intäktskonton per rad, verifikation, bokföringsdatum, buntnummer, status, restbelopp, interna anteckningar och eventuell betalningshistorik. Interna uppgifter läcker därför inte in i kund-PDF:n.

`packages/invoicing/pdf.js` används även av den äldre API-PDF-adaptern `invoice-pdf.js`. PDF-biblioteket kommer från projektets låsta npm-beroende och byggs med i webbplatsen; ingen extern CDN krävs. Svenska tecken fungerar. Tecken som standardfonten inte stödjer, exempelvis emoji, ger ett tydligt fel före ny fakturabokföring i stället för att tappas bort.

## Regression och granskning

- `npm test` innehåller faktiska beräknings-, validerings-, konterings-, snapshot- och PDF-tester, inte enbart textsökning efter kontonummer.
- `node test/menu-invoice-browser.cjs` går igenom 31 arbetsvyer, länkar under en nästlad publiceringsadress, fyra skärmbredder, omrendering, expanderade/ihopfällda grupper och ett komplett fakturaflöde med eget konto 3099.
- Webbläsartestet kontrollerar att en förhandsvisning inte bokför, att fel inte tappar formuläruppgifter, att rätt konto finns i den verkliga demoverifikationen och att PDF-filer kan hämtas.
- GitHub Actions sparar fiktiva exempel-PDF:er, fler­sidigt test, skärmbilder och resultat i `rollands-invoice-navigation-qa` för visuell kontroll. Genererade filer ska inte föras in som källkod eller verkliga företagsdata.
