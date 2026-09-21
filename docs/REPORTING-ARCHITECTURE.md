# Rapportarkitektur

## Två olika typer av rapporter

Systemet skiljer på operativa rapporter och bokföringsrapporter.

### Operativ försäljningsrapport

Försäljningsrapporten bygger på kundfakturorna och grupperar dem efter **fakturadatum**.

Den visar:

- antal fakturor,
- netto exklusive moms,
- moms,
- brutto inklusive moms,
- betalt belopp,
- utestående belopp,
- genomsnittligt fakturabelopp,
- försäljning per dag,
- försäljning per kund.

API:

`GET /api/v1/reports/sales?from=ÅÅÅÅ-MM-DD&to=ÅÅÅÅ-MM-DD`

Export:

`GET /api/v1/exports/sales?from=ÅÅÅÅ-MM-DD&to=ÅÅÅÅ-MM-DD`

Exporten är semikolonseparerad CSV med UTF-8 BOM och är avsedd att kunna öppnas i Excel. Samma kalkylbladsformelskydd som övriga exporter används.

### Bokföringsmässig resultatrapport

Resultatrapporten bygger i stället på bokförda verifikationer och resultatkonton.

API:

`GET /api/v1/reports/profit-loss?from=ÅÅÅÅ-MM-DD&to=ÅÅÅÅ-MM-DD`

Den ska användas för bokföringsmässig omsättning och periodresultat.

## Varför de hålls isär

En kundfakturas fakturadatum och bokföringens periodisering kan ge olika perspektiv. Därför märks försäljningsrapporten som **operativ rapport** i gränssnittet.

Det förhindrar att en användare tolkar fakturaregistrets summering som ett bokföringsmässigt resultat.

## Företagsisolering

Både rapport- och export-endpointen använder `company_id` från den personliga serversessionen. Klienten skickar inte själv vilket företag som ska läsas.

Automatiska tester verifierar att:

- rapporten endast summerar det inloggade företagets fakturor,
- exporten endast innehåller det inloggade företagets data,
- rapport-API:t kräver en giltig personlig session,
- exporttext neutraliserar innehåll som annars kan tolkas som kalkylbladsformler.


## Åldersanalyser och inköp per leverantör

Rapportcentret har tre ytterligare operativa rapporter:

- **Kundfordringar efter förfalloålder** – grupperar nuvarande öppna kundfordringar i ej förfallet, förfaller idag, 1–30, 31–60, 61–90 och 91+ dagar.
- **Leverantörsskulder efter förfalloålder** – använder samma intervall och särredovisar bokförda respektive ännu ej bokförda öppna leverantörsfakturor.
- **Inköp per leverantör** – summerar leverantörsfakturor per fakturadatum med netto, moms, brutto och utestående saldo.

Åldersanalyserna är **nulägesrapporter**. De använder det nuvarande öppna saldot och jämför förfallodatumet mot valt rapportdatum. Att välja ett historiskt rapportdatum återskapar därför inte hur reskontran faktiskt såg ut den dagen. Detta står också uttryckligen i rapportens varningstext.

Alla tre rapporterna filtreras med `company_id` i databasen och deras export använder samma företagsisolerade rapportunderlag. Exportformatet i denna etapp är Excel-kompatibel CSV med befintligt skydd mot kalkylbladsformelinjektion.

API:

- `GET /api/v1/reports/receivables-aging?asOf=YYYY-MM-DD`
- `GET /api/v1/reports/payables-aging?asOf=YYYY-MM-DD`
- `GET /api/v1/reports/supplier-purchases?from=YYYY-MM-DD&to=YYYY-MM-DD`

Export:

- `GET /api/v1/exports/receivables-aging?asOf=YYYY-MM-DD`
- `GET /api/v1/exports/payables-aging?asOf=YYYY-MM-DD`
- `GET /api/v1/exports/supplier-purchases?from=YYYY-MM-DD&to=YYYY-MM-DD`

Dessa rapporter är operativa beslutsunderlag. Bokföringsmässig periodisering och resultat följs fortsatt i bokföringsrapporterna.
