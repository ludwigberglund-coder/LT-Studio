# Staging data policy: synthetic data only

## Purpose

The LT Studio staging environment exists to verify deployment, security, backup/restore, R2, monitoring, logging, tenant isolation and UAT without exposing real customer information.

## Non-negotiable rule

**Staging must contain synthetic/fictitious data only.**

Do not copy, import, restore or manually enter real Rolands data or data from any other real customer into staging.

This includes, but is not limited to:

- company master data and real organisation numbers,
- real users or personal details,
- customers and suppliers,
- invoices, payments and accounting entries,
- bank transactions or bank exports,
- payroll or employee information,
- inventory records copied from a real business,
- uploaded documents or invoice PDFs,
- production/pilot databases,
- production/pilot backups or restored backup copies,
- logs or exports containing customer content.

## Runtime gate

When `ROLLANDS_ENV=staging`, startup/preflight requires:

```text
ROLLANDS_DATA_CLASSIFICATION=synthetic
ROLLANDS_REAL_DATA_ALLOWED=0
```

If either condition is missing or changed, protected runtime validation fails closed and the staging server must not start.

These variables are a deployment safety gate. They do not replace operational discipline: the staging database itself must be created from synthetic fixtures or fictitious bootstrap data.

The protected API runtime also verifies the **database contents on every staging startup**. The database must contain exactly the two approved synthetic fixture companies created by `staging:bootstrap:synthetic`, with their original synthetic identities and matching `SYNTHETIC_STAGING_BOOTSTRAP` audit evidence. If a different database is selected, a company identity is replaced, or the synthetic bootstrap provenance is missing, startup fails closed before the server accepts requests.

This second gate is intentionally stricter than checking environment variables alone. It protects against an operator accidentally pointing staging at a pilot, production or other customer database while the environment still says `synthetic`.

## Safe staging bootstrap

Do not use the generic `platform:bootstrap` command in staging. It is intentionally blocked there because it accepts manually supplied company identity.

Create a brand-new synthetic staging database with:

```bash
npm run staging:bootstrap:synthetic -- --apply
```

The command requires separate secret values for the two synthetic test users:

```text
ROLLANDS_STAGING_ALPHA_PASSWORD
ROLLANDS_STAGING_ALPHA_MFA_SECRET
ROLLANDS_STAGING_BETA_PASSWORD
ROLLANDS_STAGING_BETA_MFA_SECRET
```

The command itself supplies the company identities and usernames. It creates two clearly synthetic tenants, **Synthetic Alpha** and **Synthetic Beta**, so tenant-isolation checks can be performed without importing any customer data.

Safety properties:

- it runs only with `ROLLANDS_ENV=staging`,
- it requires `ROLLANDS_DATA_CLASSIFICATION=synthetic`,
- it requires `ROLLANDS_REAL_DATA_ALLOWED=0`,
- it requires demo data to be disabled,
- it refuses to touch an existing database file,
- it places the database outside the Git repository,
- it stores the database with mode `0600`,
- it never prints passwords, MFA secrets or the encryption key.

Do not rename these fixture companies to a real customer and do not replace their identifiers with real organisation numbers.

## Allowed test data

Use clearly fictitious companies, people, customers, suppliers, invoices, products, payments and documents.

Test data may mimic the **shape and workflow** of real business data, but must not be copied from a real business and must not contain real identifiers.

## Backup and restore drills

Staging restore drills must restore only backups that were created from the synthetic staging dataset.

Never use a Rolands/pilot/production backup as a convenient restore-test source.

Restore verification now enforces this rule in code when `ROLLANDS_ENV=staging`: both local restore verification/drills and the R2 restore drill require the restored database to match the approved synthetic staging identities and bootstrap audit provenance. A backup from Rolands or any other customer is rejected before it can become a valid staging restore result.

## UAT

Rolands users may test workflows in staging, but all records they work with must remain fictitious or generated specifically for testing.

## Evidence

Staging signoff should only be produced after the synthetic-only startup gate, staging preflight and the rest of the required readiness evidence pass.

If there is uncertainty about whether a dataset contains real customer data, treat it as real and do not load it into staging.
