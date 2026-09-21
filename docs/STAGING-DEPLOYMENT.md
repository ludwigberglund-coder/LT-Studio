# LT Studio staging deployment – synthetic data only

## Purpose

This is the deployment runbook for the first real LT Studio staging environment.

Staging exists to prove deployment, tenant isolation, backup/restore, R2 storage, monitoring, logging, audit evidence and UAT before any real pilot data is allowed.

## Absolute data rule

**Staging may contain synthetic/fictitious data only.**

Do not use Rolands data, copied customer data, anonymized Rolands exports, production/pilot backups, real invoices, real bank transactions, real documents or any other real customer information.

If there is any doubt about a dataset, treat it as real and do not load it.

The code also enforces this policy:
- startup requires `ROLLANDS_DATA_CLASSIFICATION=synthetic`,
- startup requires `ROLLANDS_REAL_DATA_ALLOWED=0`,
- staging runtime verifies the actual company identities in the database,
- staging restore flows reject non-synthetic databases,
- staging backup flows are intended to operate only on the approved synthetic database.

## Deployment templates

The repository now contains safe reference files in `deploy/staging/`:

- `staging.env.example`,
- `lt-studio-staging.service`,
- `Caddyfile.example`,
- installation notes in `deploy/staging/README.md`.

Copy and fill these only on the private staging server. The committed versions must remain placeholders without real secrets or customer data.

## 1. Infrastructure

Use a private Linux VM/server or equivalent with:
- persistent local SSD,
- Node.js 24,
- Git and npm,
- reverse proxy such as Caddy or nginx,
- HTTPS,
- process supervision such as systemd,
- outbound HTTPS access to R2, monitoring and logging providers.

Do not use GitHub Pages for staging. GitHub Pages remains demo-only.

## 2. Deploy one reviewed commit

Clone the current repository:

```bash
git clone https://github.com/ludwigberglund-coder/LT-Studio.git /opt/lt-studio/current
cd /opt/lt-studio/current
npm ci --omit=dev --ignore-scripts
```

Deploy an exact reviewed commit, not a floating branch.

## 3. Create private directories

Example:

```bash
sudo install -d -m 700 /srv/lt-studio-data
sudo install -d -m 700 /srv/lt-studio-backups
sudo install -d -m 700 /srv/lt-studio-restore
sudo install -d -m 700 /srv/lt-studio-ops
sudo install -d -m 700 /etc/lt-studio
```

The application user should own the runtime directories. Database, backups and evidence files must stay outside the Git checkout.

## 4. Private operations file

Copy `config/pilot-operations.example.json` to a private path outside GitHub, for example:

```text
/etc/lt-studio/staging-operations.json
```

Fill in real operational responsibility and contact routes, but keep:

```json
"approvedForPilot": false,
"approvedAt": null
```

The operations file is private runtime configuration and must not be committed.

## 5. Staging environment

Use `.env.example` as a template, but keep the actual values in the hosting provider's secret store or a private `0600` environment file.

The following staging flags are mandatory:

```text
NODE_ENV=production
ROLLANDS_ENV=staging
ROLLANDS_DATA_CLASSIFICATION=synthetic
ROLLANDS_REAL_DATA_ALLOWED=0
ROLLANDS_DEMO_DATA=0
ROLLANDS_API_SECURE_COOKIE=1
```

Use a dedicated staging hostname in `ROLLANDS_ALLOWED_HOSTS`.

Set:
- a new staging-only auth encryption key,
- a separate staging backup encryption key,
- unique staging-only Alpha/Beta passwords,
- unique staging-only Alpha/Beta MFA secrets.

Never reuse pilot/production credentials.

## 6. R2 separation

Use three private storage scopes:

1. runtime/private objects,
2. encrypted disaster-recovery backup,
3. audit anchor.

At minimum, use different buckets. The audit bucket must also have a separate credential scope. Keep all R2 credentials in the secret store, never GitHub.

## 7. First preflight

Before creating the database:

```bash
npm run staging:preflight
```

A warning that the database does not exist yet is expected before bootstrap. Fix all blocking configuration errors first.

## 8. Create the staging database

Create staging only with:

```bash
npm run staging:bootstrap:synthetic -- --apply
```

This creates exactly:
- Synthetic Alpha,
- Synthetic Beta.

Do not rename them to Rolands or any real customer.

The command refuses an existing database file.

## 9. Preflight again

After bootstrap:

```bash
npm run staging:preflight
```

The database should now exist with restrictive permissions and pass the synthetic staging configuration checks.

## 10. Start the service

Start the protected API behind the reverse proxy:

```bash
npm start
```

The server must not be directly exposed without HTTPS termination.

The core readiness endpoint is:

```text
https://<staging-host>/api/v1/readiness/core
```

A new staging environment may remain red until backup, R2, monitoring, logging and audit evidence have been produced. A red readiness response is not a reason to bypass checks.

## 11. Backup and restore evidence

Use only the synthetic staging database.

Run the staging backup chain:

```bash
npm run pilot:backup
npm run pilot:backup:offsite-r2
npm run pilot:restore:drill
npm run pilot:restore:r2-drill
```

The restore drills must use the same encrypted backup artifact that was uploaded and read back from R2.

Never substitute a Rolands, pilot or production backup.

## 12. Private object R2 evidence

Inventory and verify staging test objects only:

```bash
npm run storage:inventory
npm run storage:plan-copies
npm run storage:audit-r2
```

Use synthetic PDFs/documents created specifically for test purposes.

## 13. Monitoring

Configure an external HTTPS monitor against:

```text
/api/v1/readiness/core
```

Trigger a real provider test alert and confirm it reaches the intended operational route.

Then record the private evidence:

```bash
npm run staging:monitoring:evidence
```

Do not fabricate a green evidence file.

## 14. Central logging

Send structured stderr/stdout logs to the selected central provider.

Make a real request to staging, capture its `X-Request-Id`, and verify that exact ID is searchable in the central log destination.

Then record:

```bash
npm run staging:logging:evidence
```

The evidence must also reflect configured security, 5xx and missing-stream alerts.

## 15. Audit anchor

Create and verify the local audit anchor, then upload it to the separate audit bucket:

```bash
npm run audit:anchor:create
npm run audit:anchor:verify
R2_AUDIT_ENABLED=1 npm run audit:anchor:r2
```

## 16. UAT

Run UAT only with synthetic records.

Allowed:
- invented customers and suppliers,
- invented invoice numbers and amounts,
- invented bank transactions,
- generated test PDFs,
- invented products and payroll-like test records.

Not allowed:
- copied or anonymized Rolands records,
- real organisation numbers,
- real customer/supplier names,
- real invoices,
- real bank information,
- real employee data,
- any pilot/production database or backup.

Use both Synthetic Alpha and Synthetic Beta to prove tenant isolation.

## 17. Final staging evidence

When the real drift tests are complete:

```bash
npm run staging:evidence:verify
npm run staging:uat:verify
npm run staging:signoff
```

A staging signoff is evidence for a later human pilot decision. It is not itself permission to use real data.

## 18. Before any real pilot data

Do not move to `ROLLANDS_ENV=pilot` until:
- issue #226 is resolved with enforced GitHub main protection,
- issue #364 staging acceptance criteria are complete,
- staging signoff is valid,
- operational owners explicitly approve the release commit/signoff,
- the separate pilot decision is documented.

Until then, the system remains synthetic-only.
