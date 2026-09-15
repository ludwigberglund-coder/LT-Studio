# Arkitektur och drift

## Körlägen

### Lokal Node-server

`server.js` serverar `public/` och exponerar API för fakturor, betalningar, attest, bankimport, reskontra och verifikationer. PDF skapas av `invoice-pdf.js` med det låsta npm-beroendet `pdf-lib`.

Normal start:

```powershell
npm ci
npm start
```

Servern binder till `127.0.0.1` som standard. Nätverksbindning kräver `ROLLANDS_ADMIN_TOKEN`.

### Statisk demo

`dist/` byggs från `public/`. Utan Node-server använder demon webbläsarens `localStorage`. Den är endast en visnings- och testmiljö; data delas inte mellan användare och är inte företagets bokföringsdatabas.

## Backend

### API och säkerhetsgräns

- JSON krävs för alla ändrande API-anrop.
- Kroppsstorleken begränsas och för stora anrop får HTTP 413.
- En administratörsnyckel kan växlas mot en tidsbegränsad HttpOnly-session.
- Cookie är `SameSite=Strict`; `Secure` aktiveras bakom HTTPS.
- Inloggningsförsök begränsas per IP-adress.
- Säkerhetsrubriker inkluderar CSP, clickjacking-skydd, MIME-skydd och restriktiv resurs-/referenspolicy.
- HTTP-värdnamnet kontrolleras mot loopback eller `ROLLANDS_ALLOWED_HOSTS` för att minska risken för DNS-rebinding.
- Statiska sökvägar normaliseras och kontrolleras även efter upplösning av symboliska länkar.
- CSV-export neutraliserar celler som annars kan tolkas som kalkylbladsformler.

Autentiseringen är avsedd som lokal/första driftspärr. Produktionsmiljö kräver riktiga användaridentiteter, roller, tvåfaktor och central sessionshantering.

### Datalager

`lib/store.js` ansvarar för:

- beständig plattformsspecifik standardkatalog,
- schema- och bokföringsvalidering före varje skrivning,
- kontroll av balanserade verifikationer, unika nummer och grundläggande belopps-/datumregler,
- SHA-256-kedja för att upptäcka ändringar i revisionsloggen,
- temporär fil, `fsync`, ersättning av huvudfil och föregående `.bak`-version,
- återläsning från backup om primär JSON är skadad,
- separat processlås för datakatalogen.

Ett datalager som inte klarar integritetskontrollen spärras för normal läsning och ändring. Den autentiserade hälsokontrollen kan fortfarande visa felrapporten för felsökning.

JSON-lagret är en förbättrad lokal lösning, men inte slutarkitektur för flera samtidiga användare. Produktionsmålet är en transaktionsdatabas med migreringar, versionshantering, krypterade offsite-backuper och regelbundna återläsningstester.

## Bokföringsmotor

- Verifikationer måste balansera exakt.
- Bokföringsperioder kan låsas.
- Rättelser skapar nya verifikationer; bokförda original ska inte skrivas om.
- Kund- och leverantörsbetalningar uppdaterar reskontra och verifikation tillsammans.
- Bankrader får unika referenser och osäkra träffar stannar för manuell kontroll.
- Leverantörskonton måste finnas i den inbyggda kontolistan.
- Kund- och leverantörsfakturanummer dubblettkontrolleras.

Motorn använder fortfarande heltal i kronor. Öresprecision måste införas som en gemensam, migrerad datamodell innan produktionsklassning.

## Frontend

- `public/app.js` – routing, API-klient, fakturering och huvudvyer.
- `public/workspace.js` – arbetsyta, register, reskontra och kontextflöden.
- `public/finance.js` – beräkningar och reskontralogik.
- `public/invoice-model.js` – fakturarader, moms och konteringsförslag.
- `public/receivables-tools*.js` – omföring och kvittning.
- `public/reports.js` – översikter och rapportpresentation.
- `public/account-plan.js` – begränsad intern kontolista.
- `public/integration-guide.js` – tydliga gränser för ännu ej anslutna integrationer.

## Källkod och data

GitHub är den auktoritativa källan för kod, dokumentation, CI och ändringshistorik. Runtime-data hör inte hemma där, särskilt eftersom repot är publikt. `.gitignore` skyddar kända datafiler, men driftmiljön måste dessutom ha rätt filbehörigheter, kryptering och backup.
