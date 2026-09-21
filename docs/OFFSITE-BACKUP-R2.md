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

## Det som fortfarande återstår

Denna adapter löser inte allt katastrofskydd.

Före riktig pilot krävs fortfarande verkligt driftbevis för bland annat:

- schemalagd återkommande upload,
- larm om offsite-upload eller read-back misslyckas,
- fjärretention/versionsskydd eller motsvarande raderingsskydd,
- genomfört restore-drill från den faktiska offsite-kopian,
- separat säker återställning av backupkrypteringsnyckeln,
- dokumenterade RPO/RTO-resultat.

Ingen kod ska markera offsite-backup som driftsatt bara för att CI för adaptern är grön.
