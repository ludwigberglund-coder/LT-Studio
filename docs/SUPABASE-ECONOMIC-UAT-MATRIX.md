# Supabase economic UAT release matrix

Status: 2026-10-07.

This is the release evidence gate for the current shared architecture:

```text
GitHub main
-> GitHub Pages frontend
-> Supabase PostgreSQL/Auth/RLS/Storage/Realtime/RPC/Edge Functions
```

It is deliberately separate from the older Node/SQLite pilot UAT evidence.

## Goal

A specific Git commit must not be described as manually UAT-approved unless the required CI checks and all economic scenarios below have been verified against that same commit.

The evidence file is private operational evidence and must not contain real customer data or secrets.

Start from:

`config/supabase-uat-release-evidence.example.json`

Store the filled-in copy outside the public repository.

Verify it with:

```bash
export LT_SUPABASE_UAT_EVIDENCE_PATH=/private/path/supabase-uat-evidence.json
export LT_RELEASE_COMMIT=<full 40-character commit>
npm run supabase:uat:evidence:verify
```

## Status language

Use only these meanings:

- **CI green**: automated checks passed for the exact commit.
- **UAT approved**: every scenario in this matrix has passed manually with traceable evidence.
- **Blocked**: at least one blocking issue remains.
- **Not tested**: no claim is made about the scenario.

A successful GitHub Pages deploy is not the same thing as UAT approval.

## Required automated checks

| Check | Why |
| --- | --- |
| Quality and security checks | Full repository and browser regression chain |
| CodeQL | Static security analysis |
| Supabase clean rebuild | Proves versioned migrations/functions can rebuild the Supabase contract |

Each check reference should point to the GitHub Actions run or equivalent traceable run evidence for the same release commit.

## Manual economic scenarios

### 1. Auth, session and MFA

Verify login, required TOTP/AAL2, refresh/session continuity, logout and that browser Back cannot reopen an authenticated session.

### 2. Customers

Create and edit a synthetic customer. Verify another browser/user sees the change through the shared backend and that company scope is preserved.

### 3. Customer invoice

Create and issue a synthetic customer invoice. Verify:

- unique invoice number,
- expected VAT and totals,
- archived PDF,
- journal entry,
- customer receivable/open amount,
- no duplicate journal on retry.

### 4. Customer credit and settlement

Create a credit note for the same customer and verify the supported settlement/offset flow, approval requirements, accounting and remaining receivable.

### 5. Manual customer payment

Register a manual customer payment with date, amount and target invoice. Verify the Edge Function security boundary, batch/posting result, receivable update and audit trail.

### 6. Batches and approvals

Verify pending, approved and rejected batches, permissions, four-eyes rules where required, dashboard notifications and that UI status matches the economic state.

### 7. Supplier invoice

Create a supplier invoice with synthetic PDF, coding and VAT. Verify approval, liability posting, supplier ledger and journal.

### 8. Supplier payment

Prepare, release and confirm a synthetic supplier payment. Verify payment state transitions, 2440 settlement, bank-side accounting representation and idempotency.

### 9. Bank reconciliation

Verify synthetic bank events can be listed, filtered, proposed/matched and reviewed without creating duplicate accounting.

### 10. Accounting and reports

Verify journal list, ledger, receivables/payables and available report totals agree for the test transactions. CSV/PDF export where exposed must reflect active filters.

### 11. Documents and PDF

Open the archived source/PDF from the economic object. Verify company isolation, immutable archived document behavior, PDF-only restrictions and expected visual branding.

### 12. Tenant isolation

Use at least two synthetic tenants and prove that customer, supplier, invoice, accounting and document data from tenant B cannot be read or mutated by tenant A.

### 13. Idempotency

Repeat at least the central customer-invoice and payment mutations. The retry must not create duplicate economic effects.

### 14. Responsive UI, light and dark mode

Verify the core economic flows on normal desktop width and a narrow/mobile width in both light and dark mode. No hidden navigation, unreadable text or blocked primary action is allowed.

## Approval requirements

The evidence validator requires:

- exact full Git commit,
- synthetic data only,
- GitHub/Supabase source-of-truth verification,
- two UAT users,
- a second synthetic tenant,
- three named reviewers/roles,
- all required CI checks passed,
- all 14 scenarios passed,
- traceable references for every check and scenario,
- no blocking issues,
- evidence no older than seven days.

## Important boundary

This gate proves that a specific shared Supabase-UAT release has passed the defined checks. It does not by itself approve use of real production data.

Production/pilot approval still requires the broader readiness gates, backup/restore evidence, security decisions and explicit owner approval tracked elsewhere in the repository.
