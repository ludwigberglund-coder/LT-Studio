# AUDIT HISTORY ANCHOR

Syftet är att upptäcka efterhandsändring av audit-historik även om någon skulle få direkt åtkomst till SQLite-filen.

## Vad som skyddas

Tre historikströmmar ingår:

- företagsaudit i `audit_events`,
- globala säkerhetshändelser i `security_events`,
- LT Studio-operatörsaudit i `platform_operator_audit_events`.

Alla tre är append-only i databasen: UPDATE, DELETE och INSERT OR REPLACE mot befintliga poster stoppas av persistenta SQLite-triggers.

## Skapa ett lokalt ankare

I skyddad drift ska `ROLLANDS_DATABASE_PATH` peka på den riktiga databasen och `ROLLANDS_AUDIT_ANCHOR_PATH` ligga utanför Git-repositoryt.

```bash
npm run audit:anchor:create
```

Kommandot öppnar databasen read-only, kör SQLite integrity_check och hashar varje auditström i fast ordning `created_at,id`. Ankaret innehåller antal poster, första/sista identitet och SHA-256 per ström samt en root-SHA som även binder ankartidpunkten.

## Verifiera ett tidigare ankare

```bash
npm run audit:anchor:verify
```

Verifieringen jämför det tidigare ankrade prefixet mot den nuvarande databasen. Nya legitima auditposter efter ankaret är tillåtna. Ändring, borttagning eller en bakdaterad inskjuten post i det redan ankrade prefixet gör kontrollen röd.

## Ladda upp ett oberoende ankare till R2

Audit-ankaret ska använda **annan bucket och annan access key** än både privata runtimeobjekt och katastrofbackup.

```bash
R2_AUDIT_ENABLED=1 npm run audit:anchor:r2
```

R2-objektet sparas innehållsadresserat under:

```text
audit-anchors/v1/<root-sha256>.json
```

Upload använder `If-None-Match: *` och följs alltid av full GET/read-back där byteantal, SHA-256 och root-SHA verifieras. Lokal upload-evidens skrivs till `ROLLANDS_AUDIT_ANCHOR_EVIDENCE_PATH` med privata filrättigheter.

## Driftprincip

- riktiga credentials får aldrig läggas i GitHub,
- auditbucket ska vara privat,
- access key ska ha minsta möjliga behörighet och vara separat från backup-/objektlagring,
- ankaret bör köras återkommande och före/efter känsliga driftmoment,
- ett externt ankare ersätter inte backup, journalförsegling, UAT eller incidentloggning,
- kodtesterna bevisar mekanismen men inte att den externa bucketen eller credential-separationen faktiskt är driftsatt.
