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

## Nästa steg

Den framtida LT Studio-adminportalen kan läsa ett redigerat, read-only operatörs-API ovanpå dessa händelser. Det API:t ska få separat operatörsautentisering och får inte återanvända vanliga kundsessioner som administratörsbehörighet.
