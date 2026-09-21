# LT Studio Operator API v1

Operator-API:t är en separat kontrollplan-yta för LT Studio. Det använder inte kundernas sessioner och ligger under:

`/api/operator/v1`

## Publik endpoint

`GET /api/operator/v1/health`

Returnerar endast att operator-API:t kör.

## Inloggning

`POST /api/operator/v1/auth/login`

Kräver JSON med:

- `username`
- `password`
- `totp`

En lyckad inloggning sätter den separata HttpOnly-cookien `lt_operator_session` och returnerar en CSRF-token.

Operatörssessionen använder normalt:

- 15 minuters inaktivitetsgräns,
- 120 minuters absolut maxgräns.

Fem misslyckade operatörsinloggningar inom spärrfönstret skapar en `critical` säkerhetssignal och nästa försök stoppas temporärt.

## Session och logout

`GET /api/operator/v1/session`

Returnerar endast operatörens id, användarnamn och visningsnamn.

`POST /api/operator/v1/auth/logout`

Kräver operator-session och `X-CSRF-Token`. Server-sessionen raderas och logout skrivs i separat operatörsaudit.

## Read-only driftdata

`GET /api/operator/v1/overview`

Visar företag och tekniska metadata från `platform-overview.js`.

Den ska inte returnera:

- kundernas slutkundsnamn,
- fakturanummer,
- fakturabelopp,
- dokumentinnehåll,
- bank-/lönedata.

`GET /api/operator/v1/readiness`

Visar samma readiness-underlag som plattformens driftkontroll, men bakom operatörsinloggning.

`GET /api/operator/v1/security-events?limit=50`

Visar en redigerad lista med endast:

- typ,
- allvarlighetsgrad,
- tidpunkt.

Fingeravtryck och tekniska detaljfält lämnas inte ut via HTTP.

## Viktig gräns

En vanlig `rollands_session` kan inte användas mot operator-API:t. En `lt_operator_session` kan inte användas som kundsession.

Detta är inte ett rollsystem för kunder. Det är en separat plattformsidentitet för LT Studios driftadministration.

## Nästa etapp

När API:t är mergat och grönt kopplas en separat `/operator/`-webb på:

- inloggning,
- kund-/företagsöversikt,
- readiness-status,
- säkerhetsvarningar,
- session/utloggning.

Första webbversionen ska vara read-only.
