# Flerföretagsaudit – kund nummer två
Datum: 2026-09-20

## Syfte

Denna audit jämför den faktiska koden med beslutet i [SAAS-TARGET-ARCHITECTURE.md](SAAS-TARGET-ARCHITECTURE.md).

Målet är att skilja på:

1. sådant som redan är flerföretagsredo,
2. Rolands-specifika delar som ska vara konfiguration eller demo,
3. kvarvarande arbete innan en andra riktig kundmiljö kan tas i drift.

## Sammanfattning

Kärnan är längre kommen än gränssnittet. Datamodellen, medlemskapen och flera centrala ekonomiflöden är redan byggda runt ett internt `company_id`. Det finns dessutom automatiska tester med två företag som försöker läsa och ändra data över företagsgränsen.

De största identifierade luckorna i denna genomgång var inte att databasen saknade företagstillhörighet, utan att vissa standardprofiler och privata portaltexter fortfarande utgick från Rolands. De mest direkta av dessa har rättats i samma ändring som denna audit.

Systemet är fortfarande **inte godkänt för en andra skarp kund eller verkliga ekonomiska data**. Production-readiness-spärrarna gäller fortsatt.

## Redan flerföretagsredo

### Företag och medlemskap

Databasen har separata tabeller för:

- `companies`,
- `users`,
- `memberships`,
- `sessions`.

En session binds till ett specifikt företag. En användare kan ha medlemskap i flera företag. Vid inloggning måste företag väljas om användaren har mer än ett medlemskap.

### Privata affärsobjekt

Centrala privata objekt är kopplade till `company_id`, bland annat:

- kunder,
- kundfakturor,
- fakturatransaktioner,
- fakturakommentarer,
- påminnelser,
- leverantörer och leverantörsfakturor,
- bokföringsposter,
- dokument,
- lager,
- webbplats-CMS,
- löneflöden och flera övriga privata moduler.

### Servern väljer företag

Skyddade API-flöden använder sessionsföretaget. Objekt hämtas exempelvis med både objekt-id och `session.companyId`.

Klienten ska alltså inte kunna byta företag genom att skicka ett annat `company_id` i ett vanligt skyddat API-anrop.

### Databasspärrar

`apps/api/tenant-integrity.js` installerar och verifierar tenant-regler på databasnivå för relationer mellan företagsbundna tabeller.

Befintliga tester visar bland annat att:

- en faktura inte kan kopplas till en kund i ett annat företag,
- transaktioner inte kan flyttas mellan företag,
- leverantörsfakturor och dokumentrelationer kontrolleras,
- felaktig historisk data stoppar uppstart i stället för att tyst flyttas eller raderas.

### HTTP-isolering

Befintliga tester använder två företag och kontrollerar att inloggning i företag A inte kan läsa PDF:er, bokföringsposter, dokument eller fakturor i företag B.

Detta är en bra grund för den centrala SaaS-modellen.

## Problem som rättades i denna ändring

### 1. Fakturaprofil var globalt Rolands-baserad

Tidigare laddade `apps/api/app.js` `content/company.json` som global standardprofil för kundfakturering.

Det innebar att en annan kund kunde ha korrekt isolerad databasdata men ändå få Rolands profil som grund vid fakturakonfiguration. Organisationsnummerkontrollen kunde då blockera kund nummer två, och lösningen var inte verkligt företagsneutral.

**Rättat:** fakturaprofilen hämtas nu från det aktiva företagets egen publicerade CMS-/företagsprofil. Privata bankgiro- och skattestatusuppgifter fortsätter att hämtas från den privata databasen.

### 2. Ny kund ärvde Rolands webbtexter

CMS-databasen var isolerad per företag, men standardinnehållet för ett nytt företag klonade Rolands webbplats och bytte bara delar av företagsidentiteten.

Det gav ingen dataläcka, men var fel produktarkitektur och kunde leda till att en ny kund startade med Rolands texter, Billdal-referenser eller demolänkar.

**Rättat:** Rolands får fortsatt sitt egna referensinnehåll. Alla andra nya företag får ett neutralt webbplatsutkast med sitt eget företagsnamn och generiska texter som måste konfigureras.

### 3. Privat portal visade Rolands som plattformsnamn

Den centrala privata portalen hade flera synliga Rolands-texter även i API-läge.

**Rättat:** sessionens API-svar innehåller nu aktiv företagsidentitet. Portalen och den delade navigationen använder det aktiva företagets visningsnamn. LT Studio används som plattformsnamn. Rolands-namnet finns kvar i den uttryckliga Rolands-demon.

### 4. Saknat explicit kund-nummer-två-kontrakt

Det fanns redan flera tvåföretagstester, men inget sammanhållet test som säkerställde att den andra kundens session, fakturaprofil och CMS-startdata inte ärvde Rolands identitet.

**Rättat:** `test/saas-second-tenant.test.js` verifierar detta.

### 5. Privata portalskal och fakturautkast hade kvar Rolands-standarder

Flera privata portalsidor hade Rolands som laddningsnamn, sidomenynamn eller breadcrumb även när servern redan arbetade i ett annat företag. Fakturautkastet använde dessutom `https://rollands.se` som reservwebbadress när ett annat företag saknade egen webbplats.

**Rättat:** privata portalskal använder LT Studio som plattformsnamn och aktivt företagsnamn från session/CMS. Reservlänken till `rollands.se` är borttagen. Den uttryckliga Rolands-demon får fortsatt visa Rolands eftersom den representerar referenskunden.

### 6. Kund nummer två verifieras nu över fler kärnmoduler

Det tidigare tvåkundstestet täckte främst identitet, fakturaprofil och CMS, medan andra isoleringstester täckte ekonomi och dokument var för sig.

**Utökat:** `test/saas-second-tenant.test.js` skapar nu data för kund B i bank, lager, lön och automationskö och läser samma API:er med både kund A:s och kund B:s autentiserade sessioner. Testet verifierar också CMS-identiteten för båda företagen och direkta objektuppslag med fel `company_id`.

Detta gör definitionen av “kund nummer två” betydligt närmare ett sammanhängande blockerande CI-test i stället för en samling isolerade modultester.

## Rolands-specifikt som ska vara kvar

Följande är inte i sig fel eftersom Rolands är referenskund och har en egen publik demo:

- `content/company.json`,
- `content/site.json`,
- Rolands texter och design i den publika GitHub Pages-demon,
- fiktiva Rolands-demodata i portalens uttryckliga demoläge.

Regeln är att dessa värden inte får fungera som dold global standard för andra privata företagsmiljöer.

## Kvarvarande teknisk skuld före riktig kund nummer två

### Legacy-namn i tekniska identifierare

Flera interna namn använder fortfarande `ROLLANDS_*`, `rollands_session`, `rollands-csrf` och globala JavaScript-namn med Rolands-prefix.

Detta är främst teknisk namn-/migrationsskuld, inte i sig en företagsisolationsbugg. Vi bör migrera dem kontrollerat med bakåtkompatibilitet i stället för att byta allt samtidigt och riskera driftfel.

### SQLite är fortfarande pilotdatabasen

Nuvarande backend använder SQLite. Målarkitekturen anger PostgreSQL eller jämförbar transaktionsdatabas för skarp skalbar drift.

Den kontrollerade vägen från dagens SQLite till PostgreSQL är nu dokumenterad i [POSTGRESQL-MIGRATION-PLAN.md](POSTGRESQL-MIGRATION-PLAN.md). Själva databasmigreringen är **inte** påbörjad; nästa kodsteg är först en tydlig datalager- och transaktionsgräns utan ändrade affärsregler.

Innan många samtidiga kundmiljöer bör databasstrategi, migreringar, låsning och tenant-skydd verifieras i den framtida produktionsdatabasen.

### Dokument lagras ännu inte i extern objektlagring

Flera dokument/PDF-flöden lagrar innehåll i nuvarande databas. Målarkitekturen är skyddad objektlagring med serverkontrollerad åtkomst och företagsspecifik metadata.

### Publika kundwebbplatser saknar generell distributionsmodell

Rolands publika statiska webb finns som referens. Det finns ännu ingen färdig produktionslösning för att publicera flera kunders webbplatser till separata egna domäner från samma plattform.

### Modulaktivering behöver bli verklig konfiguration

Målbilden säger att olika företag kan ha olika aktiverade moduler. Nuvarande privata medlemmar har samma funktioner inom sitt företag och navigationen är i huvudsak gemensam. Företagsspecifika feature flags/modulval behöver införas innan olika abonnemang eller kundpaket används.

### Automatisk tenant-schemakontroll

Etapp 2 inför ett maskinläsbart schema-kontrakt i `apps/api/tenant-integrity.js`.

Varje databastabell måste nu vara en av följande:

- uttryckligen plattforms-/identitetsnivå,
- direkt företagsägd med `company_id`,
- eller ha exakt en obligatorisk foreign key till en direkt företagsägd förälder.

En okänd tabell utan tenant-scope gör att tenant-guard-installationen stoppas. För tabeller som ärver scope via en förälder installeras dessutom en trigger som stoppar omkoppling till en förälder i ett annat företag.

Detta minskar risken att en framtida modul råkar skapa privat kunddata utanför flerföretagsskyddet.

### Driftmiljö och releaseprocess

GitHub är källan för kod och dokumentation, men en verklig gemensam staging- och produktionsmiljö med säkra secrets, databas, objektlagring, övervakning och rollback behöver fortfarande etableras.

## Nästa rekommenderade ordning

1. Låt CI verifiera denna ändring och kund-nummer-två-testet.
2. Behåll production-readiness som högsta prioritet för Rolands.
3. Kartlägg alla tabeller med privat data mot krav på `company_id` och tenant-integritetsregler.
4. ✅ Maskinläsbart tenant-schemakontrakt är infört och stoppar okända oskopade tabeller.
5. ✅ PostgreSQL-migreringen är dokumenterad; nästa kodsteg är en datalagergräns utan ändrade affärsregler.
6. Planera skyddad objektlagring för dokument och PDF-original.
7. Inför företagsspecifik modulaktivering först när kärnflödena är säkra.
8. Bygg generell publicering av kundhemsidor separat från den privata appen.

## Godkännandekriterium för nästa kund

Kund nummer två ska inte betraktas som produktionsredo förrän:

- samma kodversion kör båda företagen,
- sessionen visar rätt företag,
- fakturor och bokföring använder rätt företagsprofil,
- CMS och publik webb har eget innehåll,
- privata objekt inte kan läsas eller ändras mellan företag,
- backup och återställning bevarar isoleringen,
- staging och produktion använder verifierad release från GitHub,
- inga skarpa hemligheter eller kunddata ligger i GitHub.
