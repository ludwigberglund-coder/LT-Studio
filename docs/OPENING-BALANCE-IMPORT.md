# Ingående balans – säker pilotimport

## Syfte

När ett befintligt företag börjar använda LT Studio behöver balanskonton kunna föras in utan att skapa dolda fel mellan huvudbok och reskontra.

Den första versionen använder en särskild verifikationsserie `IB` och källtypen `opening-balance`.

## Tillåtna konton

Importen tillåter endast balanskonton i klass 1 och 2.

Exempel som kan importeras:

- bankkonton,
- kassa,
- inventarier,
- eget kapital,
- andra balanskonton som inte kräver separat detaljreskontra.

## Konton som medvetet blockeras

`1510 Kundfordringar` och `2440 Leverantörsskulder` får inte importeras som fristående totalsummor.

Anledningen är att ett totalsaldo på 1510 eller 2440 utan de bakomliggande kund- eller leverantörsfakturorna skulle kunna få huvudboken att se korrekt ut samtidigt som reskontran är tom eller felaktig.

Öppna kundfordringar och leverantörsskulder vid systemstart ska därför inte gå genom denna enkla totalsaldoimport. Det finns ett separat systembytesflöde där varje öppen post och huvudbokssaldot kontrolleras och importeras tillsammans.

## Regler

- Året anges med fyra siffror.
- Bokföringsdatum måste vara exakt 1 januari det året.
- Importen måste ske innan andra verifikationer skapats i samma räkenskapsår.
- Minst två rader krävs.
- Verifikationen måste balansera exakt i debet och kredit.
- Samma identiska import kan skickas igen utan att skapa en dublett.
- Ett ändrat återförsök efter första importen stoppas som idempotenskonflikt.
- Importen skrivs i auditloggen endast första gången.
- En ingående balans kan inte rättas genom det generella manuella rättelseflödet.

## API

`GET /api/v1/accounting/opening-balances/YYYY`

Hämtar den importerade ingående balansen för året.

`POST /api/v1/accounting/opening-balances/YYYY`

Kräver personlig session, CSRF och bokföringsåtkomst. Body innehåller `postingDate` och kompletta balanserade `lines`.

## Pilotgräns

Detta endpoint löser endast import av vanliga balanskonton. Öppna kund- och leverantörsfakturor vid systemstart hanteras i stället av det separata, källanknutna systembytesflödet i `docs/OPENING-MIGRATION-IMPORT.md`.

Fortfarande utanför den automatiska första versionen ligger bland annat:

- historiska betalningstransaktioner före systemstart,
- historiska kreditfakturor och negativa öppna saldon,
- komplett historisk huvudbok från ett annat ekonomisystem,
- SIE-import.
