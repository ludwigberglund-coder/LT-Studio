# Automatiserad testtäckning – kritiska portalflöden

Detta dokument beskriver var de viktigaste säkerhets- och ekonomiflödena verifieras. Det är en karta över befintliga tester, inte ett påstående om att systemet är färdigt för pilot.

## Autentisering och session

- Inloggning, lösenord, MFA och personlig session: `test/api-v1.test.js`
- MFA-återanvändning: `test/api-v1.test.js`
- MFA-registreringskrav: `test/company-membership-http.test.js`
- MFA-rotation och återkallade sessioner: `test/mfa-rotation.test.js`
- Logout, CSRF, sessionsradering och revisionsspår: `test/api-v1.test.js`
- Inaktivitetsgräns och absolut sessionsgräns: `test/api-v1.test.js`
- Indraget medlemskap och avstängt konto: `test/company-membership-http.test.js`

## Företagsisolering

- Gemensam API-isolering över centrala API-familjer: `test/company-membership-http.test.js`
- Kundregister: `test/customer-registry-cross-company.test.js`
- Kundfakturor, PDF och IDOR: `test/company-membership-http.test.js` och kundfakturatester
- Leverantörer och leverantörsfakturor: cross-company- och HTTP-tester
- Bank: `test/bank-payment-cross-company.test.js`
- Lager: `test/inventory-tenant-http.test.js`
- Dokument: `test/documents-cross-company-http.test.js`
- Automationskö: `test/automation-proposal-cross-company.test.js`
- Andra kundens portal/CMS/data: `test/saas-second-tenant.test.js`
- Export: `test/exports.test.js`

Grundregeln är att företag A aldrig ska kunna läsa, ändra eller exportera data från företag B även om ett främmande objekts id är känt.

## Ekonomiska flöden

- Kundreskontra: `test/customer-receivables.test.js`
- Kundfakturor: kundfaktura-, PDF- och browsertester
- Leverantörsreskontra: payables- och supplier-accounting-tester
- Betalningar: `test/payment-overview.test.js`, `test/payment-confirmation.test.js`, `test/payment-release.test.js`
- Bokföring: `test/accounting-store.test.js`, `test/accounting-integrity.test.js`
- Momsavstämning: `test/reports-v1.test.js`
- Resultat, huvudbok och balans-/trial-balance-underlag: rapporttester
- Export och kalkylbladsformelskydd: `test/exports.test.js`

## Portal och webbläsare

- Gemensam navigation, användarmeny och responsiv portalram: `test/menu-invoice-browser.cjs`
- Portalens kontrakt för delad navigation/layout: `test/portal-sidebar.test.js`
- Leverantörsfakturaflöde i webbläsare: `test/payables-browser.test.cjs`
- Betalningsöversikt i webbläsare: `test/payments-overview-browser.cjs`
- Privata API/PDF/CMS-flöden: `test/private-workflows-browser.cjs`

## Återstående områden i den större arbetsordern

Följande kräver fortsatt arbete utöver testsviten:

- central LT Studio-adminportal
- utökade automatiska hälsokontroller
- strukturerad säkerhetsövervakning och varningsnivåer
- fler rapporttyper
- riktig XLSX-export där det är relevant
- driftövervakning av backup, integrationer och resurser

Nya funktioner i dessa områden ska kompletteras med tester innan de betraktas som färdiga.
