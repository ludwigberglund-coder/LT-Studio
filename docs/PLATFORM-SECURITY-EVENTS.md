# Plattformssäkerhetshändelser

Syftet är att ge LT Studios framtida centrala adminvy ett säkert underlag för varningar utan att blanda ihop operatörsövervakning med kundernas affärsdata.

## Första signalen

När samma pseudonymiserade inloggningsnyckel når fem felaktiga försök inom den befintliga 15-minutersperioden skapas en plattformshändelse:

- typ: `LOGIN_FAILURE_THRESHOLD`
- nivå: `warning`
- ett SHA-256-fingeravtryck
- antal felaktiga försök
- spärrfönster och retry-tid
- tidpunkt

Den sjätte begäran stoppas fortsatt av den befintliga rate limit-kontrollen.

## Integritet

Säkerhetshändelsen lagrar inte:

- rå IP-adress
- användarnamn
- lösenord
- MFA-kod
- kundens ekonomidata

Fingeravtrycket bygger på serverns befintliga hashade kombination av anslutningsadress och normaliserat användarnamn. Det används bara för att känna igen samma misslyckade inloggningskälla under säkerhetsanalys.

## Tenant-gräns

`security_events` är en uttrycklig plattformstabell, inte kunddata. Den är därför klassificerad som root scope i `tenant-integrity.js`. Kundernas vanliga privata API har ingen endpoint som läser tabellen.

Det är viktigt: en kundanvändare ska inte kunna se andra kunders eller plattformens säkerhetssignaler.

## Strukturerad driftlogg

När tröskeln nås speglas även en redigerad `security_event` med koden `LOGIN_FAILURE_THRESHOLD` till serverns strukturerade JSONL-logg. Fingeravtryck, användarnamn, rå IP-adress och inloggningsinnehåll följer inte med. Se [strukturerad driftloggning](OPERATIONAL-LOGGING.md).

## Nästa steg

LT Studio-adminportalen kan läsa det befintliga redigerade, read-only operatörs-API:t ovanpå dessa händelser. Extern central logginsamling måste fortfarande konfigureras och verifieras i den faktiska hostingmiljön.
