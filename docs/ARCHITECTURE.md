# Arkitektur och drift

## Två körlägen

### 1. Lokal Node-version
`server.js` serverar `public/` och exponerar API-flöden för fakturor, betalningar, bankimport och bokföring. Lokal data lagras som JSON i en datakatalog. PDF-generering sker via `invoice-pdf.js` och paketet `pdf-lib`.

Start:

```powershell
npm install
npm start
```

Öppna sedan `http://localhost:4173/#/overview`.

### 2. Statisk webb/demo
`dist/` är en statisk kopia av frontendkoden. Den kan publiceras utan Node-server, men då används webbläsarens lokala demo/localStorage där API-server saknas. Det gör demon enkel att dela, men data blir inte gemensam mellan användare.

## Frontend
- `public/index.html` – ingångssida.
- `public/app.js` – routing, vyer och övergripande adminflöden.
- `public/workspace.js` – navigation, dashboardskal, kund-/leverantörsregister och fakturainkorg.
- `public/customer-portal.js` – kund- och leverantörsreskontra.
- `public/receivables-tools*.js` – omföring, kvittning och reskontraverktyg.
- `public/finance.js` – bokförings- och beräkningslogik.
- `public/reports.js` – rapporter och export.
- `public/account-plan.js` – kontoplan.
- `public/assistant.js` – inbyggd hjälpassistent för systemets funktioner.
- `public/integration-guide.js` – tydlig integrationsplan och driftgränser.
- `public/styles.css` och `public/workspace.css` – publik och administrativ design.

## Backend
- `server.js` – HTTP-server, JSON-lagring, API, CAMT/BAM-import, faktura- och betalningsflöden.
- `invoice-pdf.js` – generering av fakturapdf.

## Data och delning
Den lokala servern använder som standard `%TEMP%/rollands-ekonomi/store.json`. För beständig lokal lagring bör `ROLLANDS_DATA_DIR` sättas till en kontrollerad katalog. Den statiska demon använder separata lokala webbläsardata och är därför inte ett gemensamt fleranvändarsystem.

## Produktion som återstår
För riktig gemensam drift bör följande läggas bakom ett autentiserat backend/API:
- gemensam databas,
- användare/roller,
- lagring av fakturaoriginal,
- Microsoft 365/Graph,
- verifierad Handelsbanken-integration,
- OCR/AI-tolkning,
- backup och körningsövervakning.
