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
