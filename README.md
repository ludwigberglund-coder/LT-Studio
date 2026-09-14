# Rollands – senaste källkodsexport

Exporterad 2026-09-14 från den senaste lokala arbetsversionen. Innehåller även förbättringar som ännu inte har publicerats på den delade testsidan.

## Starta på en annan dator

Installera Node.js 20 eller senare (via IT om datorn är administrerad). Packa upp hela arkivet, öppna en terminal i mappen och kör:

```powershell
npm install
npm start
```

Öppna http://localhost:4173/#/overview. PDF-generering kräver paketet pdf-lib, som installeras av npm install. Servern lyssnar bara på den lokala datorn. Port kan väljas med miljövariabeln PORT.

## Innehåll

- public/: all aktuell HTML, JavaScript och CSS för hemsida och adminportal; även inbyggda demonstrationsdata och kontoplan.
- server.js: lokal server, API, fakturering, betalningar, bokföring och JSON-lagring.
- invoice-pdf.js: PDF-generator för kund- och kreditfakturor.
- test/: bokförings- och integrationstester samt webbläsartest och PDF-exempel.
- package.json: startkommandon och beroenden.
- open-rollands.cmd: befintlig Windows-startfil (installera beroenden först).
- dist/: aktuell statisk kopia av public/, för statisk demonstrationshosting. Den är skapad från senaste källkod, inte den äldre dist-versionen i arbetsmappen.
- .openai/hosting.json: befintlig Sites-projektkoppling, utan autentiseringsuppgifter. Ändra projektkopplingen om en ny webbplats ska användas.

## Senaste beteende

- Bedöm bankhändelse visar kundfakturor och intäktskonton för inbetalningar, leverantörsfakturor och kostnadskonton för utbetalningar. Servern validerar samma begränsningar.
- Alla reskontrarader visar fakturans aktuella restbelopp.
- Reskontraverktyg innehåller omföring och kvittning med förhandsgranskning, bokföringsdag, ny bunt och spårbar historik.
- Fakturanummer och OCR är samma sexsiffriga nummer. Bokföringsunderlag får fyrsiffriga buntnummer.
- PDF-generering stöder kreditbelopp och visar hela kronor.

## Lagring och begränsningar

Gemensam molndatabas och gemensamt sparande mellan användare är INTE anslutna. Statisk hosting använder separat localStorage i varje webbläsare. Den lokala servern sparar i JSON, inte i Excel. Excel-kompatibla rapporter exporteras som CSV.

Detta arkiv innehåller källkod och inbyggda testdata, inte befintliga inmatade fakturor, användarnas webbläsardata eller den lokala filen store.json. Inga autentiseringsuppgifter, .env-filer, Git-historik eller installerade beroenden ingår.

Serverns standardlagring är %TEMP%/rollands-ekonomi/store.json. För beständig lokal lagring, välj en egen lämplig datakatalog innan start:

```powershell
$env:ROLLANDS_DATA_DIR = 'C:\RollandsData'
npm start
```

Befintliga data flyttas inte automatiskt när katalogen ändras. Kör bara en serverprocess per datakatalog. Extern bankanslutning, mejlinläsning och extern AI är inte anslutna. Systemet är en utvecklings-/testversion; den statiska demon och lokala servern har inte full funktionsparitet.

## Tester

```powershell
npm test
```

Senast godkänt: 19 bokförings-/integrationstester och isolerad webbläsarkontroll av omföring, kvittning, sparande efter omladdning, restbelopp samt bankval i båda riktningar. Testerna använder separat temporär lagring.

Webbläsartestet test/receivables-browser.cjs kräver Playwright och Microsoft Edge. Ange PLAYWRIGHT_PATH till en installerad Playwright-modul om den inte finns bland lokala beroenden. Det använder en separat testwebbläsare.

## Kravbild från ChatGPT-konversationen (2026-09-14)

Projektet ska samla Rollands publika webbplats och ett modernt ekonomiadmin i samma plattform. Kravbilden omfattar kund- och leverantörsfakturor, kund- och leverantörsreskontra, bankimport (CAMT.054 och enkel BAM/textimport), bokföring, rapporter, kontoplan, PDF-fakturor, fakturainkorg, attest, avstämning och en granskningskö där osäkra bankhändelser aldrig bokförs automatiskt utan tydligt underlag. Dashboarden ska prioritera dagens åtgärder och visa enkla instrument.

Den visuella referensen är en modern ekonomidashboard med mörkgrön sidomeny, ljus arbetsyta, stora KPI-kort, prioriterad aktivitetslista och tydliga snabbåtgärder. Befintliga funktioner ska bevaras; nya ändringar ska i första hand fylla verkliga luckor.

Tillagt i denna revision: separata register för **Kunder** och **Leverantörer**, en **Fakturainkorg** för manuellt PDF-intag, förbättrad navigation och tydligare status kring produktionsintegrationer. Automatisk Microsoft 365-mejlhämtning och extern AI/OCR kräver fortfarande riktiga produktionsanslutningar och är därför inte falskt aktiverade i demon.

Konversationsreferens: `https://chatgpt.com/s/cx_6aa85ca0a3a48191ae636ebb88718a9b`
GitHub: `https://github.com/ludwigberglund-coder/Rollands`
