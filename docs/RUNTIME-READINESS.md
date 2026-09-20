# Liveness och readiness

Pilotservern skiljer nu på två olika frågor.

## `GET /api/v1/health`

Svarar på frågan: **lever serverprocessen och kan den svara HTTP?**

Ett svar med HTTP 200 betyder inte att databasen är användbar. Endpointen ska därför användas som liveness-kontroll.

## `GET /api/v1/ready`

Svarar på frågan: **kan instansen ta emot riktig trafik just nu?**

Kontrollen verifierar utan inloggning men utan att lämna ut databasvägar eller råa felmeddelanden:

- att SQLite har foreign keys aktiverade,
- att `PRAGMA quick_check` är OK,
- att inga foreign-key-brott finns,
- att databasen kan gå in i en skrivande operation och rulla tillbaka den igen,
- för permanent databas: WAL och FULL synchronous,
- att den privata databasfilen och katalogen går att läsa/skriva,
- i skyddat pilot-/produktionsläge: att databasfilens rättigheter inte är öppna för grupp/övriga,
- att det finns minst 128 MiB ledigt på filsystemet.

Om någon kontroll misslyckas svarar endpointen HTTP 503 och endast stabila felkoder, exempelvis `READINESS_STORAGE_LOW`. Den returnerar inte privata sökvägar, SQL eller stack traces.

## Varför skrivprovet rullas tillbaka

Readiness använder en liten teknisk rad i databasen. Kontrollen öppnar en savepoint, provar att uppdatera raden och rullar sedan tillbaka. På så sätt provas den normala SQLite-skrivvägen utan att fylla databasen med hälsokontrollhistorik.

## Driftkonfiguration

En framtida reverse proxy/orchestrator ska:

- använda `/api/v1/health` för liveness,
- använda `/api/v1/ready` för readiness,
- sluta skicka trafik till en instans som svarar 503 på readiness,
- larma en utsedd driftansvarig när readiness misslyckas under definierad tid.

Den sista punkten är **inte** automatiskt löst av applikationen. Uptime-tjänst, larmkanal, mottagare och eskaleringsrutin måste konfigureras hos den faktiska driftleverantören och provas före pilot.

## Återstående driftprov

Före pilot ska den tänkta driftmiljön bland annat prova:

1. databasfil eller lagringsvolym otillgänglig,
2. nästan/full disk,
3. databaslås eller långsam lagring,
4. omstart under trafik,
5. backup/restore efter ett simulerat haveri,
6. att 503 på readiness faktiskt leder till trafikstopp och larm.

Readiness är ett tekniskt underlag för driftövervakning, inte i sig ett komplett övervakningssystem.
