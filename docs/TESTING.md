# Testning

## Automatiska tester

Kör:

```powershell
npm install
npm test
```

Testsviten täcker bokföringslogik och reskontraverktyg. `test/receivables-browser.cjs` innehåller en separat webbläsarkontroll för reskontraflöden och kräver Playwright/Microsoft Edge i miljön där den körs.

## Viktiga manuella kontrollflöden
1. Skapa kundfaktura och kontrollera reskontra/restbelopp.
2. Registrera delbetalning och kontrollera att fakturastatus, reskontra och verifikation uppdateras tillsammans.
3. Importera CAMT.054 eller enkel BAM/text och kontrollera att osäkra poster hamnar i granskningskön.
4. Registrera leverantörsfaktura/PDF och kontrollera atteststatus.
5. Testa kvittning/omföring och kontrollera buntnummer och revisionsspår.
6. Kontrollera dashboard, kund-/leverantörsregister och mobilnavigation.

## Miljönotering
I en begränsad körmiljö där `npm install` inte kan hämta `pdf-lib` kommer server-/PDF-relaterade tester inte att kunna starta. JavaScript-syntax och de fristående reskontratesterna kan fortfarande valideras separat. På en normal utvecklingsdator installerar `npm install` det deklarerade beroendet.
