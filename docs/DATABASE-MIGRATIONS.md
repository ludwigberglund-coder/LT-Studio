# Databasmigrationer och rollback

## Syfte

LT Studio använder privat SQLite som nuvarande source of truth för den kontrollerade pilotvägen. Databasen har en append-only migrationsledger i `schema_migrations`.

Ledgermodellen löser två risker:

- det ska gå att se exakt vilken kärnschemaversion databasen har,
- en äldre programversion får inte öppna en databas som redan har migrerats till en okänd framtida version.

## Hur migrationer fungerar

Kärnmigrationer definieras versionsvis i `apps/api/schema-migrations.js`.

Varje version har:

- ett stigande heltalsnummer,
- ett stabilt namn,
- en beskrivning,
- SQL som hör till migrationen,
- en SHA-256-checksumma över definitionen.

SQL och ledger-raden körs inom samma SQLite-savepoint. En version registreras alltså inte som genomförd om dess SQL misslyckas.

Migrationshistoriken är append-only. Vanlig UPDATE, DELETE eller INSERT OR REPLACE mot redan registrerad historik stoppas av databastriggers.

Den första versionen är en baseline av det redan verifierade SQLite-kärnschemat per 2026-09-21. Den gör ingen destruktiv ändring av befintliga affärsdata.

## Fail-closed-regler

Databasstart stoppas om:

- en registrerad versions checksumma eller namn inte motsvarar programversionen,
- historiken har ett versionsgap,
- databasen innehåller en högre schema-version än programmet känner till.

Den sista kontrollen är särskilt viktig vid rollback: gammal applikationskod får inte försöka köra mot en databas som nyare kod redan har förändrat.

## Rollback-policy

LT Studio använder inte automatiska "down migrations" för bokföringsdata. Rollback av en release som har förändrat schema ska ske genom en verifierad backup från före migreringen och den befintliga isolerade restore-processen.

Före en schemaändrande pilot-/produktionsrelease ska därför:

1. en krypterad backup skapas,
2. checksumma verifieras,
3. restore-drill/evidens vara giltig enligt aktuell readiness-policy,
4. release-commit vara fastställd,
5. först därefter får migrationen köras.

Om release måste rullas tillbaka ska både kod och databas återställas till kompatibla versioner. Att enbart deploya äldre kod ovanpå en nyare databas är uttryckligen blockerat av schema-versionkontrollen.

## Begränsning

Detta inför versionsstyrning för kärnschemat framåt. Äldre historiska schemaändringar före baseline rekonstrueras inte i efterhand.

Flera modulära tabeller initieras fortfarande av respektive modul. När deras schema behöver ändras framåt ska ändringen flyttas till en explicit versionsstyrd migration i stället för att läggas till som en tyst startup-patch.

Detta arbete innebär inte att GitHub issue #2 är helt klar och innebär inte ett beslut att SQLite är det slutliga datalagret för all framtida SaaS-skala. Extern teknisk granskning och ett separat beslut om när/om PostgreSQL krävs återstår.
