# Systembyte – atomisk import av ingående reskontra

## Syfte

När ett befintligt företag börjar använda LT Studio behöver tre delar kunna flyttas in tillsammans:

1. ingående balans i huvudboken,
2. öppna kundfordringar,
3. öppna leverantörsskulder.

De får inte importeras var för sig. Om huvudboken till exempel visar 125 000 öre på konto 1510 men kundreskontran bara innehåller 100 000 öre är startläget fel redan från första dagen.

Den här funktionen genomför därför hela systembytet som **allt eller inget**.

## Viktig princip: ingen historisk moms bokförs igen

De importerade kund- och leverantörsfakturorna är historiska underlag från tiden före LT Studio.

Deras ekonomiska effekt finns redan i den ingående balansverifikationen.

Därför skapar importen inte:

- ny försäljning,
- ny kostnad,
- ny utgående moms,
- ny ingående moms,
- en ny historisk fakturaverifikation per gammal faktura.

I stället kopplas varje importerad öppen post oföränderligt till det verifierade systembytespaketet och dess ingående balansverifikation.

## Före import

Samma paket måste först klara reglerna i systembytes-previewn.

Kontrollen kräver bland annat att:

- systemstarten är 1 januari valt år,
- ingående balans balanserar exakt,
- endast balanskonton i klass 1–2 används,
- nettot på 1510 exakt motsvarar öppna kundposter,
- nettot på 2440 exakt motsvarar öppna leverantörsposter,
- kund- och leverantörsnummer redan finns i samma företag,
- fakturanummer inte redan finns,
- fakturadatum ligger före systemstarten,
- öppet belopp är positivt och inte större än ursprungligt fakturabelopp,
- året inte redan innehåller en annan ingående balans eller annan bokföring.

## API

### Förhandskontroll

POST /api/v1/accounting/opening-migration/preview

Detta skriver fortfarande ingen affärsdata.

### Genomför import

POST /api/v1/accounting/opening-migration/import

Kräver:

- personlig företagsinloggning,
- giltig CSRF-token,
- bokföringsbehörighet,
- confirmImport: true.

Body använder samma ekonomiska paket som previewn:

- year,
- postingDate,
- lines,
- receivables,
- payables.

### Läs verifierad import

GET /api/v1/accounting/opening-migration/imports/YYYY

Läser tillbaka systembyteshistoriken och verifierar att den fortfarande stämmer mot:

- ingående balansverifikationen,
- importerade kundposter,
- importerade leverantörsposter,
- ursprungliga belopp,
- aktuella öppna belopp,
- kund- och leverantörsidentitet.

## Allt eller inget

Importen körs under ett databas-skrivlås och en gemensam transaktion.

Om exempelvis kundposterna går att skapa men en leverantörspost misslyckas, rullas även kundposterna och ingående balansverifikationen tillbaka.

Efter ett fel ska databasen därför vara i samma affärsläge som före importförsöket.

## Retry och dubbelklick

Hela paketet får ett SHA-256-fingeravtryck.

Om exakt samma paket skickas igen för samma företag och år:

- samma import återanvänds,
- inga nya fakturor skapas,
- ingen ny ingående balans skapas,
- ingen extra auditpost skapas.

Om ett annat paket skickas för ett år som redan importerats stoppas försöket.

## Kundfordringar efter systembyte

En importerad kundfaktura behåller:

- ursprungligt fakturadatum,
- ursprungligt förfallodatum,
- ursprungligt fakturabelopp,
- beloppet som faktiskt var öppet vid systemstarten.

När kunden senare betalar i LT Studio bokförs betalningen normalt mot 1510.

Systemet verifierar då att fakturan verkligen ingår i det oföränderliga systembytespaketet och att dagens restbelopp stämmer med öppningsbeloppet minus efterföljande betalningar.

## Leverantörsskulder efter systembyte

En importerad leverantörsfaktura behåller:

- ursprungligt fakturadatum,
- ursprungligt förfallodatum,
- ursprungligt fakturabelopp,
- beloppet som faktiskt var öppet vid systemstarten.

Om ursprungsfakturan exempelvis var 7 000 kr men 5 000 kr återstod vid systemstarten, kan LT Studio förbereda betalning av hela det aktuella öppna beloppet 5 000 kr.

Automatisk delbetalning av det aktuella öppna beloppet är fortfarande inte aktiverad i detta leverantörsflöde.

## Avstämning

Rapporterna för 1510 och 2440 accepterar två verifierade typer av ursprung:

- vanlig LT Studio-faktura med egen källverifikation,
- historisk faktura med oföränderlig koppling till ett verifierat systembytespaket.

Den globala kontrollen kräver fortfarande att:

- aktuellt kundreskontrasaldo = huvudbokens 1510,
- aktuellt leverantörsreskontrasaldo = huvudbokens 2440.

## Säkerhetsgränser i första versionen

Den första exekverande versionen accepterar endast positiva öppna poster.

Den stöder ännu inte automatisk import av:

- historiska kreditfakturor,
- negativa kund- eller leverantörssaldon,
- historiska betalningstransaktioner,
- komplett historisk huvudbok från tidigare system,
- automatisk återskapning av gamla PDF-original,
- SIE-import.

Dessa fall ska fortsätta blockeras eller hanteras i separata verifierade migreringsflöden.

## Pilotstatus

Backend-importen får inte beskrivas som pilotklar enbart för att koden finns.

Innan verklig företagsdata används krävs även:

- grön GitHub-CI,
- test med ett realistiskt anonymiserat systembytespaket,
- verifierad backup och återställning,
- manuell UAT av rapporter och reskontra efter import,
- fortsatt NO-GO om andra readiness-blockers fortfarande är öppna.
