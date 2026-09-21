# Backup och verifierad återställning – pilotgrund

Status 2026-09-18: kommandon och isolerade tester finns. **Extern, krypterad och övervakad driftbackup är ännu inte verifierad.** En testad lokal kopia är inte ett tillräckligt katastrofskydd.

## Vad som finns nu

`npm run pilot:backup` använder SQLite `VACUUM INTO` för en separat databasbild. Kopian får `.sha256` och filbehörighet 0600. Destination väljs genom `ROLLANDS_BACKUP_PATH`; den måste ligga utanför GitHub-arbetskopian. BLOB-dokument i samma databas följer med. Hemliga krypteringsnycklar följer inte automatiskt med och måste kunna återfås separat.

`npm run pilot:restore:verify` kräver kontrollfil, öppnar källan skrivskyddat utan migrering och kontrollerar SQLite-integritet, främmande nycklar, företagsrelationer, journalbalans, nuvarande modellens nummerserier **samt alla tre privata SQLite-filflöden**: allmänna dokument, leverantörsfakturors PDF-original och arkiverade kundfaktura-PDF:er. För varje privat objekt verifieras serverstyrd objektreferens, MIME, storlek och SHA-256 mot de faktiskt återlästa bytesen. Det kopierar till en **ny** destination, kontrollerar kopian och vägrar skriva över en befintlig fil eller angiven produktionsdatabas. En misslyckad kopiekontroll tar endast bort den just skapade destinationsfilen.

För nuvarande nativa verifikationsserier förväntas startnummer 1 per företag/serie/räkenskapsår. Import av ett äldre system med andra startnummer kräver en explicit och testad migrationsmodell. Verktyget ska inte kringgås genom att fabricera saknade poster.

SHA-256 är ett digitalt fingeravtryck, inte kryptering eller en signatur. Någon som kan skriva om både filen och fingeravtrycket kan förfalska jämförelsen. Separat åtkomstskydd och extern skyddad historik behövs.

## Staging-gate före verkliga driftbevis

Innan R2-audit, offsite-backup eller restore-drill körs i den riktiga stagingmiljön ska:

```bash
npm run staging:preflight
```

passera utan blockerande fel. Gaten verifierar den serverkonfiguration som går att bevisa lokalt utan att skriva affärsdata:

- `ROLLANDS_ENV=staging`, `NODE_ENV=production`, demo avstängt och secure cookies,
- persistent databas, backupkatalog och operationsfil utanför Git-repositoryt,
- privat R2 EU-konfiguration för stagingobjekt,
- separat privat R2 EU-konfiguration för krypterad offsite-backup,
- olika buckets för privata runtimeobjekt och katastrofbackup,
- evidensfiler för R2-audit, offsite-backup, restore-drill och monitorering utanför Git-repositoryt.

Kommandot gör **inga nätverksanrop till R2** och bevisar därför inte att credentials fungerar eller att objekten finns. Det är en fail-closed konfigurationskontroll som ska köras först. När den är grön fortsätter driftbeviset i denna ordning:

1. skapa/verifiera stagingdatabasen,
2. inventera och planera privata objekt,
3. kopiera testobjekt till R2,
4. köra `npm run storage:audit-r2`,
5. skapa krypterad backup och köra `npm run pilot:backup:offsite-r2`,
6. genomföra separat restore-drill,
7. genomföra verkligt monitorerings-/larmtest.

När de fyra privata evidensfilerna finns ska hela kedjan verifieras med:

```bash
npm run staging:evidence:verify
```

Kedjeverifieringen kräver färsk godkänd R2-audit, verifierad offsite-backup, godkänd restore-drill och fungerande extern HTTPS-monitorering/larm. Den kräver dessutom att R2-auditen gäller den bucket som är konfigurerad nu och att restore-drillen använder **exakt samma krypterade backupfil och SHA-256** som offsite-uploaden läste tillbaka från R2. Ett grönt resultat betyder därmed att bevisen är konsekventa med varandra; det ersätter fortfarande inte ett separat test av katastrofåterställning direkt från en senare R2-download.

## Krypterad offsite-upload

Den lokala krypterade artefakten kan nu skickas till en separat privat R2 EU-bucket med:

```bash
npm run pilot:backup:offsite-r2
```

Adaptern accepterar endast servergenererade `.sqlite.enc`-filer med korrekt lokal `.sha256`, använder immutable innehållsspecifika nycklar och gör full remote GET/read-back med SHA-256 innan privat evidens skrivs.

Se [offsite-backupens säkerhets- och driftkontrakt](OFFSITE-BACKUP-R2.md).

**Kodstöd är inte driftbevis.** Checklistan förblir delvis klar tills detta har körts återkommande i avsedd miljö med separat backup-bucket, begränsade credentials, retention/raderingsskydd, larm och verifierad restore från den faktiska offsite-kopian.

## Plan att godkänna och införa före pilot

Detta är föreslagna driftmål, inte redan aktiverade tjänster:

| Fråga | Föreslagen pilotpolicy | Kräver bevis |
|---|---|---|
| Hur ofta? | Databaskopia varje timme samt före uppdatering/migrering. | Schemaläggning och larm om utebliven kopia. |
| Var? | Separat skyddad backupdestination utanför applikationsserverns felzon. | Faktisk leverantör, region, konto och åtkomsttest. |
| Skydd? | Kryptering vid överföring/lagring, separat nyckelhantering, minsta behörighet och versionsskydd. | Återläsning med nycklar samt nekad otillåten åtkomst/radering. |
| Hur länge? | Exempel: 48 timkopior, 35 dygnskopior och 12 månadskopior. Fastställ efter kapacitet och verksamhetskrav. | Retentionkonfiguration och avtal. Detta ersätter inte lagstadgat långtidsarkiv. |
| Vem återställer? | Utsedd driftansvarig; byte till produktionskopia kräver dokumenterat separat godkännande. | Personligt konto, logg och ansvarig ersättare. |
| Tillåten förlust? | Föreslaget mål högst 1 timmes dataförlust. | Mät hur aktuell senast återställbar kopia faktiskt är. |
| Avbrottstid? | Föreslaget mål återställning inom 4 timmar. | Tidtagning i verklig separat driftmiljö; detta är inte ett uppmätt resultat. |

## Genomför ett test

Använd en betrodd driftterminal. Byt exempelvägarna till separata privata kataloger. Kopiera inte ekonomidata eller secrets till GitHub, issue-bilagor eller den publika demon.

```sh
export ROLLANDS_DATABASE_PATH=/srv/rollands-data/platform.sqlite
export ROLLANDS_BACKUP_PATH=/srv/rollands-backups
npm run pilot:backup

# Välj den exakta backupfil som kommandot skapade. Kontrollfilen ska finnas bredvid.
export ROLLANDS_RESTORE_SOURCE=/srv/rollands-backups/rollands-VALD-TIDSSTAMP.sqlite
export ROLLANDS_RESTORE_TARGET=/srv/rollands-restore/NY-TESTKOPIA.sqlite
npm run pilot:restore:verify
```

Fortsätt bara vid exitkod 0 och `verified:true`. Ett lyckat `pilot:restore:drill` skriver evidensformat **schemaVersion 2** med antal verifierade privata objekt, bytes och uppdelning per objekttyp. Pilot-readiness accepterar inte äldre schema-1-bevis eller evidens där privatobjektantal, verifierat antal eller summerade bytes inte går ihop. Det betyder att de implementerade tekniska kontrollerna passerat, inte att alla bokföringsregler är granskade.

Därefter ska ansvarig, i separat isolerad miljö med utgående bank/e-post avstängt, prova inloggning, kund-/leverantörsreskontra, huvudbok, momsavstämning, dokumentöppning och revisionshistorik. Jämför förväntade antal, saldon och dokumentfingeravtryck. Dokumentera faktisk tid, backupens ålder, exakt kodversion och granskarens godkännande. Använd inte skarpa integrationsnycklar för testet.

## När något är fel

- Saknad/fel kontrollfil: behandla kopian som overifierad. Hämta en verifierbar kopia; beräkna inte bara ett nytt fingeravtryck för att få grönt.
- `RESTORE_FOREIGN_KEY_FAILED`, `RESTORE_TENANT_FAILED` eller `TENANT_INTEGRITY_ERROR`: stoppa, bevara underlaget och undersök skrivskyddat. Flytta inte poster mellan företag och radera inte historik som genväg.
- `RESTORE_JOURNAL_FAILED` eller `RESTORE_SEQUENCE_FAILED`: utred originalkälla, tidpunkt och version. Redovisningsrättelse och teknisk reparation kräver dokumenterat beslut, inte automatisk borttagning.
- Krypteringsnyckel saknas: kontrollera separat nyckelåterställning. En databas med oläsbara MFA-hemligheter är inte ett lyckat operativt återställningsprov.

Kommandot genomför **inte** övergång till produktion. Den kräver skrivstopp, slutavstämning, backup av nuvarande databas, godkänd migrering, kontrollerad omstart och verifiering av att tidigare sessioner och integrationsjobb inte återspelas felaktigt. Den processen är ännu inte verifierad hos en driftleverantör.

## Vad automatiska tester bevisar

`test/pilot-deployment.test.js`, `test/sqlite-backup-restore.test.js` och `test/restore-drill.test.js` kör verkliga backup-/restoreflöden mot temporära SQLite-filer. Det fyllda privata objekt-scenariot innehåller ett allmänt dokument, en leverantörs-PDF och en arkiverad kundfaktura-PDF och kräver att samtliga tre återläses med korrekt integritet. Ett separat korruptionsprov ändrar leverantörs-PDF:ens bytes utan att ändra metadata och kräver `RESTORE_PRIVATE_OBJECT_INTEGRITY_FAILED`.

Testerna bevisar fortfarande inte återställning från R2 eller annan extern objektlagring, faktisk offsite-drift, myndighetsgodkännande, katastrofåterställning i skarp infrastruktur eller avstämning av verkliga ingående balanser.
