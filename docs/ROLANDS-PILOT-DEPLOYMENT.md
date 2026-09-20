# Rolands Pilot Deployment

Detta dokument beskriver hur den skyddade Rollands-backenden sätts upp för en **kontrollerad single-instance pilot**. GitHub Pages är fortsatt endast publik demo. Riktig pilotdata får aldrig lagras i repositoryt eller GitHub Pages.

## Driftbedömning

### BLOCKER

Följande måste vara löst i den verkliga driftmiljön innan riktiga pilotdata används:

- en vald server/hosting med persistent disk,
- en vald pilotdomän och DNS,
- HTTPS-certifikat och reverse proxy,
- serverlagrade secrets utanför GitHub,
- absolut SQLite-path på persistent lagring utanför repositoryt,
- backup-path samt separat/offsite backupdestination,
- minst två namngivna användare om fyrögonflöden ska UAT-testas,
- genomförd `npm run pilot:preflight` utan FAIL.

### REQUIRED BEFORE PILOT

- Node.js 24,
- `NODE_ENV=production` och `ROLLANDS_ENV=pilot`,
- `Secure`, `HttpOnly`, `SameSite=Strict` sessionscookie,
- MFA-krypteringsnyckel på minst 32 starka slumpmässiga tecken,
- fresh pilotdatabas utan demoseedning,
- första personliga kontot skapat med bootstrap,
- daglig verifierad SQLite-backup och kopiering till annan server/tjänst,
- systemd eller motsvarande restart-policy,
- logginsamling och kontroll av `/api/v1/health`,
- manuell UAT enligt `docs/ROLANDS-PILOT-UAT.md` innan status kan bli READY FOR CONTROLLED ROLANDS PILOT.

### RECOMMENDED

- separat backupkonto/bucket med versionering eller immutability,
- extern uptime-monitor mot health endpoint,
- larm på processkrasch, låg disk och misslyckad backup,
- återställningsövning minst månadsvis under piloten,
- deploy från taggad/identifierad Git-commit i stället för flytande branch.

### OPTIONAL AFTER PILOT

- central secrets manager om serverplattformens secret store inte redan används,
- central loggplattform,
- automatiserad offsite-retention,
- PostgreSQL när flera samtidiga applikationsinstanser krävs.

---

## 1. Serverkrav

För pilotfasen är en Linux-server/VM med **en applikationsinstans** tillräcklig. Rekommenderad miniminivå är 2 vCPU, 2–4 GB RAM och SSD-baserad persistent disk med gott om marginal för databas, dokument och backup.

SQLite används med WAL, foreign keys, `synchronous=FULL` och busy timeout. Kör därför inte två Rollands-instanser mot samma SQLite-fil via nätverksfilsystem.

Operativsystemet ska ha:

- Node.js 24,
- npm,
- Git,
- reverse proxy, exempelvis Caddy eller nginx,
- systemd eller motsvarande processövervakning,
- tidssynkronisering aktiverad.

## 2. Installation

Exempel:

```bash
sudo mkdir -p /opt/rollands
sudo chown rollands:rollands /opt/rollands
sudo -u rollands git clone https://github.com/ludwigberglund-coder/Rollands.git /opt/rollands/current
cd /opt/rollands/current
npm ci --omit=dev --ignore-scripts
```

Deploya en specifik granskad commit/tagg. Kör inte en okontrollerad branch direkt i pilot.

`npm start` startar den skyddade SQLite-baserade servern i `apps/api/server.js`. Den gamla JSON-servern finns kvar för legacy/dev och ska inte vara pilotens startkommando.

## 3. Environment variables och secrets

`.env.example` i repositoryt är endast en mall. Kopiera aldrig riktiga värden tillbaka till GitHub.

Minimikrav för runtime:

```text
NODE_ENV=production
ROLLANDS_ENV=pilot
ROLLANDS_API_HOST=127.0.0.1
PORT=4180
ROLLANDS_ALLOWED_HOSTS=<pilotens riktiga hostname>
ROLLANDS_API_SECURE_COOKIE=1
ROLLANDS_DATABASE_PATH=/srv/rollands-data/platform.sqlite
ROLLANDS_BACKUP_PATH=/srv/rollands-backups
ROLLANDS_PILOT_OPERATIONS_PATH=/etc/rollands/pilot-operations.json
ROLLANDS_AUTH_ENCRYPTION_KEY=<stark slumpmässig hemlighet>
ROLLANDS_DEMO_DATA=0
```

Lägg secrets i hostingplattformens secret store eller i en root/rollands-läsbar EnvironmentFile utanför repositoryt, exempelvis `/etc/rollands/pilot.env` med rättighet `600`.

Kopiera dessutom `config/pilot-operations.example.json` till den privata sökvägen i `ROLLANDS_PILOT_OPERATIONS_PATH`. Fyll i tekniskt ansvar, redovisningsansvar, dataskyddsansvar, backupansvar, övervakningsansvar, incidentkontakt, supportväg, vem som får stoppa piloten, rollbackbeslutsprocess, offsite-backupdestination samt logg- och backupretention. Filen får ligga utanför repositoryt och får inte innehålla placeholders. `approvedForPilot` ska bara sättas till `true` efter ett uttryckligt pilotbeslut med datum i `approvedAt`.

Systemet använder inte en signerad klient-session som kräver separat `SESSION_SECRET`. Sessionsvärdet genereras kryptografiskt slumpmässigt per inloggning och endast dess hash sparas i SQLite. `ROLLANDS_AUTH_ENCRYPTION_KEY` skyddar de krypterade MFA-hemligheterna och måste därför backupas säkert separat från databasen. Om den nyckeln tappas bort kan befintliga krypterade MFA-hemligheter inte dekrypteras.

## 4. Persistent datalagring

Skapa separata kataloger utanför Git-checkouten:

```bash
sudo install -d -o rollands -g rollands -m 700 /srv/rollands-data
sudo install -d -o rollands -g rollands -m 700 /srv/rollands-backups
```

Databasfilen bör efter skapande ha rättighet `600`.

```bash
chmod 600 /srv/rollands-data/platform.sqlite
```

Kör:

```bash
npm run pilot:preflight
```

Preflight stoppar bland annat databas/backup-path inne i repositoryt, osäker cookie, demoflagga, placeholder-nycklar, för öppna databasrättigheter och saknade/ej godkända pilotansvar i den externa operationsfilen.

## 5. Databasplacering

`ROLLANDS_DATABASE_PATH` ska vara en absolut path på persistent lokal disk, exempelvis `/srv/rollands-data/platform.sqlite`.

Den ska **inte** ligga i `/opt/rollands/current`, `/tmp`, en ephemeral container-disk eller GitHub Actions.

## 6. Dokumentlagring

I nuvarande pilotarkitektur lagras skyddade dokument/PDF-original som BLOB-data i samma SQLite-databas. De omfattas därför av samma transaktioner, företagsisolering och SQLite-backup som övrig pilotdata. Det finns ingen separat produktions-uploadkatalog som måste synkas i denna version.

Det betyder också att databasens storlek växer med dokumentmängden. Övervaka disk och backupstorlek under piloten.

## 7. Ny pilotdatabas och första personliga användaren

Pilotdatabasen ska börja som en ny fil. Ingen demoimport behövs.

Sätt endast under bootstrap:

```text
ROLLANDS_BOOTSTRAP_COMPANY_LEGAL_NAME=<verkligt företagsnamn>
ROLLANDS_BOOTSTRAP_COMPANY_DISPLAY_NAME=<visningsnamn>
ROLLANDS_BOOTSTRAP_COMPANY_ORG_NUMBER=<organisationsnummer>
ROLLANDS_BOOTSTRAP_USERNAME=<personligt användarnamn>
ROLLANDS_BOOTSTRAP_DISPLAY_NAME=<personens namn>
ROLLANDS_BOOTSTRAP_PASSWORD=<unikt långt lösenord>
ROLLANDS_BOOTSTRAP_MFA_SECRET=<ny TOTP-hemlighet>
```

Kör först preflight och sedan:

```bash
npm run platform:bootstrap -- --apply
```

Bootstrap kräver nu företagsidentiteten från servermiljön och läser inte pilotföretaget från GitHub-innehåll. Databas-path måste ligga utanför repositoryt. Scriptet skriver inte lösenord, MFA-hemlighet eller krypteringsnyckel i loggen.

Ta bort `ROLLANDS_BOOTSTRAP_PASSWORD` och `ROLLANDS_BOOTSTRAP_MFA_SECRET` ur runtime-miljön efter bootstrap. Förvara TOTP i användarens autentiseringsapp, inte i GitHub.

## 8. Start och restart/crash recovery

Exempel på systemd-unit:

```ini
[Unit]
Description=Rollands Pilot API
After=network.target

[Service]
Type=simple
User=rollands
Group=rollands
WorkingDirectory=/opt/rollands/current
EnvironmentFile=/etc/rollands/pilot.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Aktivera:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rollands
sudo systemctl status rollands
```

SQLite WAL återhämtar commitad data efter processkrasch. systemd startar om processen. En hård disk-/filskada ska däremot hanteras med restore från verifierad backup.

## 9. HTTPS och reverse proxy

API:t ska normalt bindas till `127.0.0.1:4180`. Reverse proxyn är enda publika ingången och terminerar TLS.

Portalen och API:t ska ligga på **samma origin**. Backenden skickar inga generella CORS-tillåtelser; detta är avsiktligt. Alla muterande API-anrop kräver dessutom CSRF-token.

Exempelprincip för Caddy:

```text
<pilot-hostname> {
    encode zstd gzip

    handle /api/* {
        reverse_proxy 127.0.0.1:4180
    }

    handle /shared/* {
        root * /opt/rollands/current/apps
        file_server
    }

    handle /portal/* {
        root * /opt/rollands/current/apps
        file_server
    }

    redir / /portal/ 302
}
```

Kontrollera den exakta reverse-proxy-konfigurationen på pilotservern innan användning. Exponera **inte repositoryts rot** med `file_server`.

`ROLLANDS_ALLOWED_HOSTS` ska innehålla det hostname som reverse proxyn skickar vidare i `Host`-headern.

## 10. MFA och sessionssäkerhet

Servern använder:

- personliga användarkonton,
- scrypt-hashade lösenord,
- serverlagrade sessionshashar,
- `HttpOnly` sessioncookie,
- `SameSite=Strict`,
- `Secure` i pilot,
- CSRF-token för muterande requests,
- AES-256-GCM för MFA-hemligheter.

Alla personliga användare kräver MFA. Dela aldrig ett konto mellan personer.

## 11. Backup i pilotdrift

Kör på servern, exempelvis från systemd timer/cron:

```bash
cd /opt/rollands/current
npm run pilot:backup
```

Scriptet:

1. kör `PRAGMA integrity_check` på live-databasen,
2. skapar en konsistent SQLite-backup med `VACUUM INTO`,
3. sätter backupfilen till `600`,
4. skapar en SHA-256-fil,
5. öppnar backupen separat och kör `integrity_check` igen.

Rekommenderad pilotnivå:

- backup minst varje natt,
- extra backup före varje deploy och före riskfylld administrativ åtgärd,
- behåll 14 dagliga, 8 veckovisa och 12 månatliga kopior om lagringskostnaden tillåter,
- kopiera varje backup till en **annan disk/server/object-storage**. En kopia endast i `/srv/rollands-backups` på samma maskin är inte tillräckligt katastrofskydd.

Offsite-destination och retention måste beslutas av Theodor/Ludwig innan pilotstart.

## 12. Restore

Restore ska alltid testas i en separat fil/instans först.

```bash
export ROLLANDS_RESTORE_SOURCE=/srv/rollands-backups/<backup>.sqlite
export ROLLANDS_RESTORE_TARGET=/srv/rollands-restore-test/platform.sqlite
npm run pilot:restore:verify
```

Scriptet vägrar:

- skriva över en befintlig target,
- återställa direkt ovanpå `ROLLANDS_DATABASE_PATH`,
- fortsätta om SHA-256 inte stämmer,
- godkänna en fil som inte klarar SQLite integrity check.

Starta sedan en separat testinstans mot restore-filen och genomför Scenario F i `ROLANDS-PILOT-UAT.md`. Produktionsfilen ersätts endast efter ett dokumenterat incidentbeslut, med processen stoppad och en kopia av den skadade databasen bevarad.

## 13. Loggning

API:t loggar till stdout/stderr. Vid interna serverfel används ett request-id som även skickas som `X-Request-Id` till klienten. Klienten får inte stack trace.

I systemd:

```bash
journalctl -u rollands -f
```

Skicka aldrig environment/secrets till loggen. Bootstrap och preflight skriver inte ut hemliga värden.

För piloten bör loggar behållas enligt en beslutad retention och skyddas från obehörig läsning.

## 14. Health check

När tjänsten är startad:

```bash
curl -fsS https://<pilot-hostname>/api/v1/health
```

Förväntat svar innehåller `ok: true` och `service: rollands-api-v1`.

En extern monitor bör kontrollera endpointen minst var 1–5 minut. Health check visar att processen svarar; den ersätter inte backup-, disk- eller UAT-kontroller.

## 15. Preflight före start/release

Med den verkliga servermiljön laddad:

```bash
npm run pilot:check
npm run pilot:preflight
```

Båda måste passera utan blockerande FAIL. `pilot:preflight` skriver aldrig ut secret-värden.

## 16. Uppdatering till ny version

1. dokumentera nuvarande commit,
2. kör `npm run pilot:backup`,
3. verifiera att offsite-kopian finns,
4. hämta den granskade nya committen/taggen,
5. `npm ci --omit=dev --ignore-scripts`,
6. `npm run pilot:check`,
7. `npm run pilot:preflight`,
8. starta om tjänsten,
9. kontrollera `/api/v1/health`,
10. gör kort UAT-smoke med testdata innan normal användning fortsätter.

## 17. Rollback

Kodrollback:

1. stoppa tjänsten,
2. checka ut tidigare dokumenterad fungerande commit,
3. `npm ci --omit=dev --ignore-scripts`,
4. starta tjänsten och kontrollera health.

Databasrollback är en separat och mer riskfylld åtgärd. Återställ **inte** automatiskt en äldre databas bara för att kodrollback sker; ny pilotdata kan då gå förlorad. Använd backuprestore endast vid databasincident och efter separat verifiering enligt avsnitt 12.

## 18. Vad som aldrig får lagras i GitHub

- pilotens SQLite-databas eller WAL/SHM-filer,
- backupfiler,
- riktiga `.env`-filer,
- lösenord,
- `ROLLANDS_AUTH_ENCRYPTION_KEY`,
- TOTP/MFA-hemligheter,
- sessionscookies eller CSRF-token,
- riktiga privata kund-, leverantörs-, bank-, löne- eller dokumentdata,
- serverloggar som innehåller personuppgifter eller säkerhetsinformation.

`.gitignore` blockerar vanliga runtimeformat, men det är inte ett substitut för korrekt serverseparation.

---

## ACTION REQUIRED FROM THEODOR/LUDWIG

Före faktisk pilotinstallation behöver ni välja och meddela:

1. **Hosting/server** – VM/dedikerad server med persistent lokal SSD och Node 24. Single-instance krävs för SQLite-piloten.
2. **Pilotdomän** – exempelvis en separat subdomän. Jag ska inte hitta på ett riktigt namn.
3. **DNS** – domänen måste peka till pilotservern innan HTTPS kan verifieras.
4. **Backupdestination offsite** – exempelvis krypterad object storage eller separat backupserver. Den får inte endast vara samma disk som produktion.
5. **Namngivna pilotpersonliga användare och företagsmedlemskap** – minst de personer som behövs för fyrögonmomenten. Dela inte konton.
6. **Vem som är första personliga användaren** – personligt användarnamn och MFA ska skapas direkt på servern, aldrig skickas in i repositoryt.
7. **Logg- och övervakningslösning** – minst vem som tar emot larm vid driftstopp/backupfel och hur länge driftloggar sparas.

När servern är installerad ska `pilot:preflight`, health check, verklig backup→restore och hela manuella `ROLANDS-PILOT-UAT.md` genomföras. Först därefter kan beslut om **READY FOR CONTROLLED ROLANDS PILOT** tas.
