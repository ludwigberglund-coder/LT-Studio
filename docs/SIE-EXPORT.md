# SIE 4I – säker export från privat SQLite

## Status

`npm run export:sie4i` läser endast den privata SQLite-bokföringen. Kommandot använder inte det äldre `store.json`-lagret.

Detta är en härdad exportväg för verifierade verifikationer. Den ska inte beskrivas som fullständig eller externt godkänd SIE-/BAS-funktion förrän filerna har validerats mot SIE-Gruppens testverktyg och minst ett avsett mottagande ekonomisystem.

## Körning

Exempel:

```bash
npm run export:sie4i -- \
  --database=/secure/path/platform.sqlite \
  --company-id=company_... \
  --year=2026 \
  --company-type=AB \
  --output=/secure/export/rolands-2026.SI
```

`--database` kan ersättas av `ROLLANDS_DATABASE_PATH`. Företag, räkenskapsår, företagsform och output måste fortfarande anges uttryckligt. Exporten gissar inte företag eller företagsform.

## Fail-closed-kontroller

Före export krävs:

- SQLite `PRAGMA integrity_check = ok`,
- explicit företag och räkenskapsår,
- att företaget finns i databasen,
- minst en verifikation för valt år,
- att varje verifikation klarar den befintliga journalförseglingen och SHA-256-integritetskontrollen,
- balanserade rader i heltalsören,
- konton med fyra siffror,
- text som kan representeras i PC8/Codepage 437.

Varje belopp formateras direkt från heltalsören. Ingen flyttalsberäkning används för att skapa SIE-belopp.

Output skrivs med exklusiv create: befintlig `.SI` eller `.sha256` skrivs aldrig över. Efter skrivning läses filen tillbaka och jämförs byte-för-byte med det verifierade exportunderlaget innan SHA-256-sidecar skapas.

## Företagsisolering

SQL-frågan är explicit skopad med `company_id` och valt räkenskapsår. Varje hämtad verifikation läses därefter genom `Accounting.entryById(db, companyId, id)`, som både kontrollerar företagsägarskap och journalförsegling.

## Kända begränsningar

Denna etapp löser inte hela GitHub issue #4.

Återstår bland annat:

- extern validering av genererade filer,
- bevisad import i avsett mottagande ekonomisystem,
- SIE-import,
- dimensioner/kostnadsställen/projekt,
- formellt godkänd BAS 2026-kontoplan och kontomappning,
- verifierat stöd för andra räkenskapsår än den nuvarande kalenderårsmodellen,
- full boksluts-, periodiserings-, lager- och avskrivningsvalidering.

Källor för formatet:

- https://sie.se/sie-1-4/
- https://sie.se/format/
