# Krypterad offsite-backup till R2

Status: teknisk adapter för pilot/produktion. **En riktig offsite-körning är fortfarande ett driftbevis och kan inte ersättas av CI.**

## Säkerhetsmodell

Offsite-flödet får bara skicka den redan krypterade filen `.sqlite.enc` och dess `.sha256`-kontrollfil.

Den okrypterade `.sqlite`-filen laddas aldrig upp av adaptern.

R2-konfigurationen är separat från dokumentlagringens staging-konfiguration:

```text
R2_BACKUP_ENABLED=1
R2_BACKUP_JURISDICTION=eu
R2_BACKUP_ACCOUNT_ID=...
R2_BACKUP_BUCKET=...
R2_BACKUP_ACCESS_KEY_ID=...
R2_BACKUP_SECRET_ACCESS_KEY=...
```

`ROLLANDS_ENV` måste vara `staging`, `pilot` eller `production`.

Bucketen ska vara privat och skapad med R2:s EU-jurisdiktion. Använd en separat token som är begränsad till just backup-bucketen och minsta nödvändiga objektbehörighet. Credentials får inte lagras i GitHub.

Cloudflare-dokumentation som ska kontrolleras vid driftkonfiguration:

- https://developers.cloudflare.com/r2/reference/data-location/
- https://developers.cloudflare.com/r2/api/tokens/
- https://developers.cloudflare.com/r2/get-started/s3/

## Immutable objekt

Varje krypterad backup lagras med en innehållsspecifik nyckel:

```text
encrypted-sqlite-backups/<sha256>/rollands-<timestamp>.sqlite.enc
```

Checksumfilen lagras bredvid under samma SHA-prefix.

Upload använder `If-None-Match: *`. En retry får därför inte skriva över ett befintligt objekt. Om objektet redan finns måste adaptern fortfarande läsa tillbaka det och verifiera hela storleken och SHA-256 innan försöket räknas som lyckat.

Detta är viktigt eftersom en HTTP 412 i sig inte bevisar att den befintliga kopian är korrekt.

## Streaming

Den krypterade backupens SHA-256 beräknas lokalt innan upload. SigV4-signeringen kan använda den förberäknade hashen, medan filen streamas från disk.

Det gör att en stor backup inte behöver laddas i RAM som en enda Buffer.

Efter PUT görs alltid GET-readback. Svarskroppen hashberäknas strömmande och jämförs med den lokalt verifierade filen.

## Körning

Skapa först den lokala krypterade backupen:

```bash
export ROLLANDS_DATABASE_PATH=/privat/data/platform.sqlite
export ROLLANDS_BACKUP_PATH=/privat/backups
export ROLLANDS_BACKUP_ENCRYPTION_KEY='<separat stark nyckel>'
npm run pilot:backup
```

Kör sedan offsite-verifieringen:

```bash
export ROLLANDS_ENV=pilot
export R2_BACKUP_ENABLED=1
export R2_BACKUP_JURISDICTION=eu
export R2_BACKUP_ACCOUNT_ID='<account-id>'
export R2_BACKUP_BUCKET='<privat-backup-bucket>'
export R2_BACKUP_ACCESS_KEY_ID='<access-key>'
export R2_BACKUP_SECRET_ACCESS_KEY='<secret-key>'
export ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH=/privat/ops/offsite-backup-evidence.json
npm run pilot:backup:offsite-r2
```

Kommandot väljer den senaste lokala `.sqlite.enc`-filen och **stoppar** om dess lokala checksumfil saknas eller inte matchar.

Evidensfilen skrivs först efter verifierad remote read-back och ska ligga utanför repositoryt. Den innehåller inte credentials eller okrypterade databasbytes.

## Restore direkt från R2

Den externa backupen kan nu verifieras genom en separat restore-drill som **inte använder den lokala backupkopian**.

Kräv följande privata sökvägar utanför repositoryt:

```text
ROLLANDS_RESTORE_DRILL_PATH=/privat/restore-drill
ROLLANDS_OFFSITE_RESTORE_EVIDENCE_PATH=/privat/ops/offsite-restore-evidence.json
```

Kör:

```bash
npm run pilot:restore:offsite-r2
```

Kommandot:

1. läser det senaste verifierade `ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH`,
2. kräver att evidensen matchar den R2-bucket som är konfigurerad just nu,
3. hämtar den krypterade backupen och checksumobjektet direkt från R2,
4. streamar dem till en unik privat arbetskatalog och vägrar skriva över befintliga filer,
5. verifierar SHA-256, storlek, checksumfil och det krypterade backupformatet,
6. dekrypterar en temporär kopia,
7. verifierar SQLite-integritet, foreign keys, tenantrelationer, journaler och samtliga privata objekttyper,
8. raderar både den dekrypterade kopian och de nedladdade R2-kopiorna,
9. skriver först därefter ett separat `ROLLANDS_OFFSITE_RESTORE_EVIDENCE_PATH` med rättighet 0600.

Produktionsdatabasen öppnas eller ersätts aldrig av kommandot.

## Readiness-gate

I `staging`, `pilot` och `production` kräver `/api/v1/readiness` nu ett färskt privat bevis i `ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH`.

Beviset godtas endast när det visar:

- R2 som provider och EU-jurisdiktion,
- lyckad verifiering av både den krypterade backupen och checksumobjektet efter remote read-back,
- giltig SHA-256 och förväntade immutabla storage keys,
- positiv filstorlek,
- ett `verifiedAt` som inte är äldre än 26 timmar.

Saknat, manipulerat eller för gammalt bevis gör readiness röd (`503`). Det betyder inte att serverprocessen måste stängas av, men miljön ska inte betraktas som redo för trafik förrän en ny riktig offsite-körning har verifierats.

Skyddad readiness kräver dessutom ett separat, högst 30 dagar gammalt `ROLLANDS_OFFSITE_RESTORE_EVIDENCE_PATH` som bevisar att de faktiska R2-objekten har laddats ner, verifierats, dekrypterats och klarat full restore-kontroll. Saknat eller ogiltigt offsite-restore-bevis gör också readiness röd.

## Det som fortfarande återstår

Denna adapter löser inte allt katastrofskydd.

Före riktig pilot krävs fortfarande verkligt driftbevis för bland annat:

- schemalagd återkommande upload,
- larm om offsite-upload eller read-back misslyckas,
- fjärretention/versionsskydd eller motsvarande raderingsskydd,
- verkligt återkommande restore-drill från den faktiska offsite-kopian på stagingservern,
- separat säker återställning av backupkrypteringsnyckeln,
- dokumenterade RPO/RTO-resultat.

Ingen kod ska markera offsite-backup som driftsatt bara för att CI för adaptern är grön.
