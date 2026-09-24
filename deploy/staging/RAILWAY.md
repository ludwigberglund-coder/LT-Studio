# Railway staging profile

This file documents the non-secret Railway staging configuration for LT Studio.

GitHub remains the source of truth for code and deployment instructions. Runtime secrets, databases, generated evidence and customer data must never be committed.

## Scope

Railway hosts a separate synthetic-only staging project and service:

- project: `LT-Studio-Staging`
- service: `lt-studio-staging`
- source repository: `ludwigberglund-coder/LT-Studio`
- source branch: `main`
- application port: `4180`
- persistent volume mount: `/data`
- current baseline volume size: `100 MB`
- health check: `/health`

The temporary UAT project is separate and must not be repurposed as permanent staging.

## Data rule

The Railway staging environment is synthetic-only.

The following values are mandatory:

```text
NODE_ENV=production
ROLLANDS_ENV=staging
ROLLANDS_DATA_CLASSIFICATION=synthetic
ROLLANDS_REAL_DATA_ALLOWED=0
ROLLANDS_DEMO_DATA=0
ROLLANDS_API_HOST=0.0.0.0
PORT=4180
ROLLANDS_API_SECURE_COOKIE=1
ROLLANDS_DATABASE_PATH=/data/platform.sqlite
ROLLANDS_BACKUP_PATH=/data/backups
ROLLANDS_RESTORE_DRILL_PATH=/data/restore
ROLLANDS_PILOT_OPERATIONS_PATH=/data/ops/staging-operations.json
ROLLANDS_STRUCTURED_LOGS=1
ROLLANDS_LOGGING_RETENTION_DAYS=30
```

The database must be created only by the synthetic staging bootstrap. It creates Synthetic Alpha and Synthetic Beta. The database lives on the persistent `/data` volume and must survive redeploys.

## Private evidence paths

Generated evidence remains outside Git and on the private runtime volume:

```text
R2_STAGING_AUDIT_EVIDENCE_PATH=/data/ops/r2-staging-audit-evidence.json
ROLLANDS_OFFSITE_BACKUP_EVIDENCE_PATH=/data/ops/offsite-backup-evidence.json
ROLLANDS_RESTORE_DRILL_EVIDENCE_PATH=/data/ops/restore-drill-evidence.json
ROLLANDS_R2_RESTORE_DRILL_EVIDENCE_PATH=/data/ops/r2-restore-drill-evidence.json
ROLLANDS_MONITORING_EVIDENCE_PATH=/data/ops/monitoring-evidence.json
ROLLANDS_LOGGING_EVIDENCE_PATH=/data/ops/logging-evidence.json
ROLLANDS_AUDIT_ANCHOR_PATH=/data/ops/audit-anchor.json
ROLLANDS_AUDIT_ANCHOR_EVIDENCE_PATH=/data/ops/audit-anchor-evidence.json
ROLLANDS_UAT_EVIDENCE_PATH=/data/ops/uat-evidence.json
ROLLANDS_STAGING_SIGNOFF_PATH=/data/ops/staging-signoff.json
```

## Secrets

These variables must exist in Railway's private secret store and must never be copied into GitHub:

- `ROLLANDS_AUTH_ENCRYPTION_KEY`
- `ROLLANDS_BACKUP_ENCRYPTION_KEY`
- `ROLLANDS_STAGING_ALPHA_PASSWORD`
- `ROLLANDS_STAGING_ALPHA_MFA_SECRET`
- `ROLLANDS_STAGING_BETA_PASSWORD`
- `ROLLANDS_STAGING_BETA_MFA_SECRET`
- operator bootstrap password and MFA secret
- all future R2 access keys and secret keys
- credentials for external monitoring or central logging providers

GitHub may contain the variable names and placeholder templates only.

## Monitoring and logging baseline

The public staging service exposes the core readiness endpoint:

```text
https://<staging-host>/api/v1/readiness/core
```

Structured application logging is explicitly enabled. Final monitoring and central logging evidence still require real external providers, a delivered test alert and a verified request-id lookup before staging signoff can become green.

## R2 status

Cloudflare R2 integration is intentionally not configured yet.

Before pilot signoff, staging still requires three separated private R2 scopes:

1. runtime/private objects,
2. encrypted offsite backup,
3. audit anchor.

Do not fabricate R2, backup, restore, monitoring, logging or audit evidence while those external systems are not configured.

## Release verification

Every Railway deployment must be compared with the current reviewed GitHub release SHA before it is used as staging evidence.

A successful Railway deployment alone is not pilot approval. The full evidence chain in `docs/STAGING-DEPLOYMENT.md` and the final `staging:signoff` gate still apply.
