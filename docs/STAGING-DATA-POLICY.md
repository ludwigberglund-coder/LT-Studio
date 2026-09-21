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

## Allowed test data

Use clearly fictitious companies, people, customers, suppliers, invoices, products, payments and documents.

Test data may mimic the **shape and workflow** of real business data, but must not be copied from a real business and must not contain real identifiers.

## Backup and restore drills

Staging restore drills must restore only backups that were created from the synthetic staging dataset.

Never use a Rolands/pilot/production backup as a convenient restore-test source.

## UAT

Rolands users may test workflows in staging, but all records they work with must remain fictitious or generated specifically for testing.

## Evidence

Staging signoff should only be produced after the synthetic-only startup gate, staging preflight and the rest of the required readiness evidence pass.

If there is uncertainty about whether a dataset contains real customer data, treat it as real and do not load it into staging.
