# Webbaserad UAT-miljö

Den tillfälliga UAT-miljön kör LT Studios skyddade Node-backend från GitHub-repositoryts granskade `main`-gren på Railway.

## Syfte

Miljön används för samlad UAT av:

- LT Studio Admin Control Center under `/operator/`,
- Säkerhetsportalen som en vy i samma LT Studio-adminportal,
- kundsystemet under `/portal/`,
- företagsskiljning och syntetiska arbetsflöden.

LT Studio-adminportalen innehåller en tydlig länk till kundsystemet så testaren kan gå mellan de två ytorna på samma webbplats.

## Datapolicy

Miljön är **syntetisk-only**. Inga riktiga Rollands-data, fakturor, bankuppgifter, dokument, personuppgifter eller andra verkliga kunduppgifter får användas.

Testföretagen skapas av `scripts/bootstrap-staging-synthetic.js`. Inloggningsuppgifter och MFA-hemligheter lagras endast som privata hosting-secrets och får inte committas till GitHub.

## Drift

Hosting: Railway, tillfällig syntetisk UAT.

Källkod: GitHub `main`.

Server: `apps/api/server.js`.

Kundportal: `/portal/`.

LT Studio admin: `/operator/`.

Säkerhetsportal: välj **Säkerhetsportal** i LT Studio-adminens meny.

## Viktigt

Detta är inte en pilot- eller produktionsmiljö och innebär inte att systemet är godkänt för verkliga ekonomiska data. Full readiness, backup/restore, extern monitoring och övriga pilotkrav följer den separata staging- och pilotprocessen.
