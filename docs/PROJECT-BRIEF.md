# Rollands – projektbrief

## Mål
Rollands ska vara en sammanhållen plattform för den publika företagswebbplatsen och ett modernt ekonomiadmin för Rolands Frukt o Grönt Aktiebolag. Plattformen ska vara enkel att navigera, visuellt modern och tydligt skilja automatiska förslag från sådant som kräver manuell kontroll.

## Visuell riktning
Den administrativa delen följer den referens som lämnats i projektkonversationen: mörkgrön sidomeny, ljus arbetsyta, stora KPI-kort, snabbåtgärder, prioriterad aktivitetslista och tydliga tabeller. Befintliga funktioner ska bevaras och nya ändringar ska i första hand fylla verkliga luckor.

## Funktionell kravbild
- Publik Rollands-webbplats i samma projekt som ekonomiadmin.
- Kundfakturor och leverantörsfakturor.
- Kund- och leverantörsregister.
- Kund- och leverantörsreskontra med restbelopp, förfallna poster, delbetalningar och historik.
- Fakturainkorg för leverantörs-PDF:er och attestflöde.
- Bankimport för CAMT.054 och ett enkelt BAM/textflöde.
- Automatisk matchning när referens, belopp och riktning är entydiga.
- Alla osäkra bankhändelser ska flaggas till admin och får inte bokföras automatiskt utan tillräckligt underlag.
- Bokföring, verifikationer, kontoplan, rapporter, periodlås och revisionslogg.
- Excel-kompatibel export via CSV.
- PDF-generering av kund- och kreditfakturor.
- Dashboard med enkla mätinstrument, snabbåtgärder och prioriteringslista.
- Sökning och förbättrad navigation mellan Försäljning, Inköp och Ekonomi.

## Reskontrakolumner
Kravet från projektkonversationen omfattar bland annat:

`Period`, `Avityp`, `Bet sätt`, `Avinr`, `Bokfdatum avi/fakt`, `Avibelopp`, `Ffd`, `Buntnr`, `Bokfdatum trans`, `Bokntyp`, `Transnr`, `Transbelopp`, `Restbelopp`.

## Integrationsmål
Produktionsversionen ska kunna byggas ut med:
- Microsoft 365/Graph för säker hämtning av fakturamejl och PDF-bilagor.
- Handelsbankens filtjänst för verkliga CAMT.054-filer och vid behov CAMT.053.
- Verifierad bank-specifik BAM-mappning.
- OCR/dokumenttolkning av leverantörsfakturor.
- AI-baserade konteringsförslag med tydliga säkerhetsgränser och revisionsspår.
- Gemensam beständig databas och fleranvändarstöd.

## Säkerhetsprincip
AI och automation får föreslå och automatisera endast när underlaget är entydigt och validerat. Osäkra poster ska stanna i granskningskön. Produktionsnycklar och autentiseringsuppgifter ska aldrig ligga i klientkod eller i Git-repot.

## Källreferenser från projektet
- Delad ChatGPT-konversation: https://chatgpt.com/s/cx_6aa85ca0a3a48191ae636ebb88718a9b
- GitHub-repo: https://github.com/ludwigberglund-coder/Rollands
- Ursprunglig företagswebbplats: https://rollands.se/
