# PostgreSQL-migreringsplan

Datum: 2026-09-20

## Beslut

**Uppdaterat 2026-09-24:** LT Studio har påbörjat migreringen till **Supabase/PostgreSQL** för gemensam SaaS-drift. Arbetet är fortfarande synthetic-only och innebär ännu inte produktions-cutover.

SQLite är fortfarande den backend som den befintliga applikationen använder. Supabase har nu den första versionsstyrda multi-tenant-grunden samt kund-/fakturakärnan, men portalen ska inte beskrivas som migrerad förrän applikationsadaptern, autentiseringen, skrivflödena, full tenant-UAT och backup/restore är verifierade.

Alla Supabase-schemaändringar ska finnas som migrationer i GitHub. Ingen verklig ekonomidata får flyttas innan staging-cutover-kriterierna längre ned är uppfyllda.

Målbilden är Supabase/PostgreSQL för den skalbara gemensamma SaaS-driften.

## Varför cutover fortfarande inte ska göras direkt

Nuvarande kod använder SQLite på flera nivåer samtidigt:

- synkron `DatabaseSync` från `node:sqlite`,
- inline-DDL i flera domänmoduler,
- SQLite-`PRAGMA`,
- `STRICT`-tabeller,
- SQLite-triggers med `RAISE(ABORT,...)`,
- `BEGIN IMMEDIATE`,
- `strftime`,
- `GLOB`,
- filbaserad backup med `VACUUM INTO`,
- restore-kontroller via `PRAGMA integrity_check` och `foreign_key_check`.

Att byta detta samtidigt som affärslogik ändras skulle öka risken för bokförings- och dataintegritetsfel. Migreringen ska därför göras som en separat teknisk förändring.

## Faktiska SQLite-kopplingar i dagens kod

### 1. Databasanslutning och transaktioner

`apps/api/database.js` använder:

- `DatabaseSync`,
- SQLite-fil som databas,
- WAL,
- `PRAGMA foreign_keys`,
- `PRAGMA recursive_triggers`,
- `BEGIN IMMEDIATE`.

PostgreSQL-klienter i Node är normalt asynkrona. Det innebär att datalagret måste få en tydlig asynkron gräns innan PostgreSQL kan bli huvuddatabas.

### 2. Schema skapas inne i moduler

Flera moduler kör `CREATE TABLE IF NOT EXISTS` direkt vid start, bland annat:

- kärndatabasen,
- kundfakturering,
- leverantörsfakturor,
- bokföring,
- bank,
- lager,
- lön,
- dokument,
- CMS,
- automation.

För PostgreSQL ska detta ersättas av versionsstyrda migrationer som ligger i GitHub och körs kontrollerat före applikationsstart.

### 3. Tenant-skyddet är SQLite-specifikt

`apps/api/tenant-integrity.js` läser:

- `sqlite_master`,
- `PRAGMA table_info`,
- `PRAGMA foreign_key_list`.

Skyddet installerar dessutom SQLite-triggers.

I PostgreSQL ska samma säkerhetsmål bevaras med flera lager:

1. `company_id` och foreign keys,
2. constraints som förhindrar korskoppling,
3. Row Level Security där det passar,
4. servervaliderad aktiv företagskontext,
5. samma A/B-isoleringstester som idag.

SQLite-reglerna får inte tas bort förrän PostgreSQL-reglerna har motsvarande automatiska bevis.

### 4. SQLite-specifik SQL

Identifierade exempel:

- `strftime(...)` för MFA-rensning,
- `GLOB` vid kontroll av numeriska fakturanummer,
- `INSERT OR IGNORE` i vissa lagringsflöden,
- SQLite-`PRAGMA` för schema- och integritetskontroller,
- `STRICT` efter tabell-DDL.

Dessa ska ersättas med databasneutrala operationer eller PostgreSQL-specifika implementationer bakom samma domänfunktion.

### 5. Backup och restore är filbaserade

Nuvarande pilotverktyg använder bland annat:

- `VACUUM INTO`,
- SQLite-filer,
- krypterade kopior av SQLite-filen,
- `PRAGMA integrity_check`,
- `PRAGMA foreign_key_check`.

PostgreSQL-versionen ska i stället använda kontrollerade databasbackuper/snapshots, verifierad restore till separat miljö och samma affärsmässiga integritetskontroller efter återställning.

## Målarkitektur för datalagret

Affärslogik ska inte känna till om lagringen är SQLite eller PostgreSQL.

Mål:

```text
HTTP / domänflöde
        ↓
affärsregler
        ↓
repository / storage-gräns
        ↓
PostgreSQL-adapter
        ↓
PostgreSQL
```

Under övergången kan SQLite-adaptern finnas kvar för befintliga tester och pilot, men den gemensamma domänlogiken ska inte dupliceras.

## Migreringsordning

### Fas 1 – införa tydlig datalagergräns

Görs före PostgreSQL.

- separera SQL-frågor från affärsregler där de idag är hårt sammanvävda,
- inför en gemensam transaktionsgräns,
- gör lagringsanrop asynkrona där PostgreSQL kräver det,
- behåll samma API-kontrakt utåt,
- ändra inte moms-, faktura- eller bokföringsregler i samma PR.

Godkännandekriterium:

- befintliga tester för fakturering, bokföring och tenant-isolering är oförändrat gröna.

### Fas 2 – versionsstyrt schema

- skapa en migrationskatalog i GitHub,
- återskapa dagens constraints uttryckligen,
- dokumentera varje tabells tenant-scope,
- inför PostgreSQL-schema i en separat testmiljö,
- lägg ingen produktionsdata där ännu.

Godkännandekriterium:

- ett tomt PostgreSQL-schema kan byggas från noll endast från GitHub,
- schemajämförelse visar att alla kritiska fält och constraints finns.

### Fas 3 – PostgreSQL tenant-säkerhet

- lägg `company_id` på alla direkt företagsägda tabeller,
- skapa säkra foreign keys,
- inför RLS för privata tabeller där modellen passar,
- sätt aktiv tenant-kontext från servervaliderad session,
- neka databasåtkomst när tenant-kontext saknas.

Godkännandekriterium:

- samma kund A/kund B-matris körs mot PostgreSQL,
- försök till korsläsning och korsskrivning stoppas både i app och databas.

### Fas 4 – migreringsverktyg och verifiering

Bygg ett separat, återkörbart migreringsverktyg.

Det ska:

- läsa en låst SQLite-kopia,
- skriva till en tom PostgreSQL-databas,
- bevara oföränderliga interna id:n,
- bevara fakturanummer och verifikationsnummer,
- bevara tidsstämplar,
- kontrollera antal rader per tabell och företag,
- kontrollera summeringar av kundfordringar, leverantörsskulder och bokföring,
- kontrollera dokumentens SHA-256,
- kontrollera tenant-isolering efter import.

Ingen tyst datarättning får ske under migration.

### Fas 5 – staging-cutover

- stoppa skrivningar till SQLite,
- ta slutbackup,
- migrera staging-kopia,
- kör full CI/UAT mot PostgreSQL,
- kör restore-test,
- verifiera fakturor, bokföring, bank, dokument och CMS,
- dokumentera avvikelse = NO-GO.

### Fas 6 – produktion

Först när staging är verifierad:

- planerat skrivstopp,
- slutbackup,
- migrering,
- integritetsverifiering,
- start mot PostgreSQL,
- omedelbar smoke/UAT,
- rollback till orörd SQLite-backup om kontrollen misslyckas.

## Ingen dual-write för ekonomidata

Vi ska inte börja med att skriva samma ekonomihändelse parallellt till SQLite och PostgreSQL i produktion.

Dual-write skapar en risk där en bokning lyckas i ena databasen men misslyckas i den andra.

För ekonomidata är en kontrollerad cutover med ett tydligt skrivstopp säkrare än långvarig dubbel skrivning.

## Data som måste bevaras exakt

Minst följande ska verifieras före och efter migrering:

- company-id,
- användare och medlemskap,
- kund- och leverantörsregister,
- fakturanummer,
- fakturadatum och förfallodatum,
- bokföringsdatum,
- belopp i ören,
- moms,
- verifikationsnummer och serier,
- bokföringsrader,
- betalningsreferenser,
- dokumenthashar,
- revisionslogg,
- publicerade CMS-versioner,
- idempotensnycklar och fakturanummerreservationer.

## Backup efter PostgreSQL

Ny backupmodell ska minst innehålla:

- automatiska databassnapshots eller `pg_dump` enligt vald driftplattform,
- kryptering,
- separat retention,
- separat dokumentbackup,
- regelbundna restore-drills,
- efterkontroll av tenant-isolering,
- dokumenterad RPO/RTO innan skarp drift.

## CI under övergången

När PostgreSQL-adaptern finns ska CI under en övergångsperiod köra kritiska kontrakt mot båda motorerna:

- fakturanummer/idempotens,
- bokföringsbalans,
- periodlås,
- tenant-isolering,
- dokumentintegritet,
- kund A/kund B-matris.

PostgreSQL får bli enda produktionsmotor först när dessa tester är gröna och backup/restore-flödet är verifierat.

## Sådant vi inte gör i denna etapp

- installerar inte PostgreSQL i produktion,
- flyttar ingen kunddata,
- inför ingen dual-write,
- ändrar inga ekonomiska affärsregler,
- tar inte bort SQLite-backuper,
- deklarerar inte plattformen produktionsredo.

## Nästa konkreta kodsteg

När production-readiness-arbetet tillåter nästa databasetapp bör första kod-PR:n vara liten:

1. definiera en asynkron datalager-/transaktionsgräns,
2. flytta ett begränsat läsflöde bakom gränsen,
3. behåll SQLite-implementationen,
4. kör hela testsuiten,
5. fortsätt modul för modul utan att ändra API-resultat eller affärsregler.

Det är säkrare än att först lägga till PostgreSQL och därefter försöka anpassa hela koden på en gång.
