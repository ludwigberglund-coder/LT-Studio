# Databasmigrationer och rollback

## Syfte

LT Studio använder privat SQLite i den nuvarande kontrollerade pilotvägen. Databasen har en migrationshistorik i `schema_migrations` som beskriver vilken kärnschemaversion databasen har öppnats med.

Migrationshistoriken är ett säkerhetsskydd. Den ska göra det möjligt att:

- identifiera exakt vilken känd schemaversion databasen använder,
- upptäcka om migrationshistoriken har ändrats i efterhand,
- stoppa en äldre programversion från att öppna en databas som redan använder en okänd framtida version,
- uppgradera dagens enklare migrationsledger utan att bygga om databastabellen eller skriva om affärsdata.

## Bakåtkompatibel uppgradering

Dagens tidigare ledger innehöll endast:

- `id`,
- `applied_at`.

Den nya modellen behåller dessa fält och lägger till:

- `version`,
- `name`,
- `checksum_sha256`.

Det betyder att befintliga databaser inte behöver få tabellen raderad eller återskapad. Vid första säkra uppstart kompletteras den kända baseline-posten med versionsmetadata i samma övergripande SQLite-transaktion som den vanliga schemainitieringen.

Om en gammal ledger innehåller en okänd migrationspost stoppas uppstarten. Systemet gissar inte vad den posten betyder.

## Verifiering

Varje känd migration definieras med:

- ett stigande versionsnummer,
- ett stabilt id,
- ett stabilt namn,
- en beskrivning,
- migrations-SQL,
- SHA-256 av migrationsdefinitionen.

Vid uppstart verifieras den sparade historiken mot programversionens definitioner.

Uppstarten stoppas bland annat om:

- versionsnumret är ogiltigt,
- samma version förekommer flera gånger,
- en tidigare version saknas före en senare version,
- id, namn eller checksumma inte stämmer,
- databasen innehåller en högre version än programmet känner till,
- en äldre ledger bara är delvis uppgraderad.

Migrationshistoriken skyddas append-only efter verifieringen. Vanlig UPDATE, DELETE och ersättande INSERT mot befintlig historik blockeras av databastriggers.

## Atomisk uppstart

Kärnschemat och migrationshistoriken behandlas inom samma SQLite-transaktion i databasens startup-flöde.

Om en schemauppgradering misslyckas ska både schemaändringen och den nya migrationsregistreringen rullas tillbaka. En halv migration ska alltså inte kunna markeras som genomförd.

## Rollback-policy

LT Studio ska inte automatiskt försöka köra destruktiva `down migrations` på bokföringshistorik.

Före en schemaändrande staging-/pilot-/produktionsrelease ska den befintliga backup- och restorekedjan användas:

1. skapa verifierad krypterad backup,
2. verifiera checksumma och offsite-kopia,
3. ha ett giltigt restore-bevis,
4. fastställ exakt release-commit,
5. kör först därefter schemaändringen.

Om en release måste rullas tillbaka ska kod och databas återställas till kompatibla versioner från verifierad backup. Att bara starta gammal kod mot en databas med en okänd senare schemaversion är uttryckligen blockerat.

## Fortsatt arbete

Version 1 är baseline för den redan etablerade SQLite-kärnan. Framtida schemaändringar ska successivt flyttas till explicita versionsstyrda migrationer i stället för tysta startup-patchar.

Detta är inte ett beslut att SQLite är det slutliga datalagret för all framtida SaaS-skala och stänger inte PostgreSQL-frågan. En framtida PostgreSQL-migrering ska behandlas som ett separat arkitekturbeslut och en separat driftövning.
