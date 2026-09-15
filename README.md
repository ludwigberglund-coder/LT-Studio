# Rollands – webbplats och ekonomiplattform

Detta repository är projektets enda aktiva källa för kod, dokumentation och tester. Den körande bokföringsinformationen ligger **inte** i GitHub och ska aldrig läggas i ett publikt repository.

## Vad som finns i systemet

- Publik webbplats och administrativ ekonomiarbetsyta.
- Kund- och leverantörsfakturor, attest, reskontra, betalningar och motverifikationer.
- Bankimport för CAMT.054 samt en enkel, uttryckligen begränsad BAM/texttolkning.
- Verifikationer, fyrsiffriga buntnummer, periodlås och manipulationsupptäckande revisionskedja.
- PDF-fakturor, CSV-export, momsöversikt och grundläggande rapporter.
- Datakontroll, manuella säkerhetskopior och säker borttagning av kända demoposter.
- Automatisk GitHub CI som kontrollerar syntax, tester, beroenden och den statiska webbbyggnaden.

Systemet är nu betydligt säkrare än den ursprungliga utvecklingsversionen, men ska fortfarande betraktas som **förproduktionssystem**. Se [granskningsrapporten](docs/AUDIT-2026-09-15.md) för vad som är klart och vad som återstår före skarp bokföring.

## Starta lokalt

Krav: Node.js 24 LTS eller senare.

```powershell
npm ci
npm start
```

Öppna `http://127.0.0.1:4173/#/overview`.

Servern lyssnar som standard endast på den lokala datorn. Den lokala körningen kan användas utan administratörsnyckel. Ska servern nås från nätverket måste en slumpmässig nyckel på minst 24 tecken sättas; servern vägrar annars att starta utanför loopback.

```powershell
$env:ROLLANDS_ADMIN_TOKEN = 'en-lång-slumpmässig-hemlighet'
$env:ROLLANDS_HOST = '0.0.0.0'
$env:ROLLANDS_ALLOWED_HOSTS = 'rollands.example.se,192.168.1.50'
$env:ROLLANDS_SECURE_COOKIE = '1'   # endast när HTTPS används
npm start
```

`ROLLANDS_ALLOWED_HOSTS` ska innehålla de DNS-namn eller IP-adresser som användarna faktiskt öppnar. Det skyddar även den lokala, nyckelfria körningen mot anrop med förfalskat värdnamn. Lägg aldrig nyckeln i GitHub, källkod, skärmbilder eller dokumentation.

## Datalagring

Standardkatalog:

- Windows: `%LOCALAPPDATA%\RollandsEkonomi`
- Linux/macOS: `$XDG_DATA_HOME/rollands-ekonomi` eller `~/.local/share/rollands-ekonomi`

Egen katalog kan väljas före start:

```powershell
$env:ROLLANDS_DATA_DIR = 'C:\RollandsData'
npm start
```

Varje sparning valideras, skrivs via en temporär fil och ersätter sedan huvudfilen. Föregående version sparas som `store.json.bak`. En processlåsfil hindrar två serverprocesser från att skriva i samma datakatalog.

GitHub är basen för **kod och dokumentation**. Fakturor, verifikationer, kunduppgifter, bankhändelser, hemligheter och säkerhetskopior ska lagras i ett skyddat driftsystem – inte i det publika repot.

## Dataverktyg

Kontrollera datalagrets balans, dubbletter, revisionskedja och kända demoposter:

```powershell
npm run data:check
```

Skapa en tidsstämplad lokal säkerhetskopia med SHA-256-kontrollsumma:

```powershell
npm run data:backup
```

Förhandsgranska borttagning av kända demoposter:

```powershell
npm run data:remove-demo
```

Genomför rensningen efter kontroll:

```powershell
npm run data:remove-demo -- --apply
```

Rensningsverktyget skapar först en säkerhetskopia och registrerar sedan åtgärden i revisionsloggen.

## Demoläge

Normal serverstart skapar ett tomt datalager. Demonstrationsdata läggs endast in när det uttryckligen begärs:

```powershell
$env:ROLLANDS_DEMO_DATA = '1'
npm start
```

Använd aldrig demoläget mot en datakatalog som innehåller riktig bokföring.

## Tester och byggnad

```powershell
npm test
npm run build:static
```

GitHub Actions kör dessutom:

- installation från låst `package-lock.json`,
- syntaxkontroll av JavaScript,
- automatiska bokförings-, lagrings- och säkerhetstester,
- produktionsberoendegranskning,
- kontroll att `dist/` kan byggas exakt från `public/`.

## Viktiga driftgränser

Följande krävs fortfarande innan systemet kan klassas som komplett produktionssystem:

- extern transaktionsdatabas med migreringar, återläsningstest och redundans,
- riktiga användarkonton, roller, tvåfaktorsautentisering och attestseparation,
- originalarkiv för inkommande underlag och bilagor,
- verifierad fullständig BAS 2026-kontoplan för bolagets regelverk,
- öresprecision i hela bokföringsmotorn,
- fullständiga SIE-, boksluts-, årsredovisnings-, moms- och deklarationsflöden,
- verifierade bank-, e-post-, OCR- och AI-integrationer,
- extern säkerhetsgranskning och godkännande av redovisningskonsult/revisor.

Den inbyggda kontolistan är ett tekniskt arbetsunderlag, inte en fullständig eller verifierad BAS 2026-kontoplan. SIE-Gruppen beskriver SIE 4 som formatet för överföring av fullständiga verifikationer; sådan verifierad export är därför kvar som produktionskrav.

## Struktur

- `public/` – webbplats och administrationsgränssnitt.
- `dist/` – statisk kopia som byggs från `public/`.
- `server.js` – HTTP-server, API och bokföringsflöden.
- `lib/store.js` – validering, atomisk lagring, backup och revisionskedja.
- `invoice-pdf.js` – PDF-generator.
- `scripts/` – bygg- och dataverktyg.
- `test/` – automatiska tester.
- `docs/` – arkitektur, testplan och granskningsrapport.
- `.github/workflows/` – permanent kvalitets- och säkerhetskontroll i CI.
