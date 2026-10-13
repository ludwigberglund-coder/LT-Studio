-- Establish a fail-closed direction/provenance contract for bank events.
-- Existing and unverified events remain unknown; positive amounts never imply direction.
-- This migration does not enable automatic posting or change current manual resolution flows.

alter table public.bank_payments
  add column if not exists direction text not null default 'unknown',
  add column if not exists direction_source text,
  add column if not exists direction_source_reference text,
  add column if not exists direction_evidence_sha256 text,
  add column if not exists direction_verified_at timestamptz;

alter table public.bank_payments
  drop constraint if exists bank_payments_direction_check,
  drop constraint if exists bank_payments_direction_provenance_complete_check,
  drop constraint if exists bank_payments_known_direction_provenance_check;

alter table public.bank_payments
  add constraint bank_payments_direction_check
    check (direction in ('incoming','outgoing','unknown')),
  add constraint bank_payments_direction_provenance_complete_check
    check (
      (direction_source is null
        and direction_source_reference is null
        and direction_evidence_sha256 is null
        and direction_verified_at is null)
      or
      (direction_source ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$'
        and char_length(btrim(direction_source_reference)) between 1 and 180
        and direction_evidence_sha256 ~ '^[0-9a-f]{64}$'
        and direction_verified_at is not null)
    ),
  add constraint bank_payments_known_direction_provenance_check
    check (
      direction = 'unknown'
      or (
        direction_source is not null
        and direction_source_reference is not null
        and direction_evidence_sha256 is not null
        and direction_verified_at is not null
      )
    );

alter table public.bank_payments
  add column if not exists direction_verified boolean
  generated always as (
    direction in ('incoming','outgoing')
    and direction_source is not null
    and direction_source_reference is not null
    and direction_evidence_sha256 is not null
    and direction_verified_at is not null
  ) stored;

comment on column public.bank_payments.direction is
  'Source-verified bank direction. unknown is fail-closed and is never inferred from amount_ore.';
comment on column public.bank_payments.direction_source is
  'Stable identifier for the trusted importer/provider that supplied direction evidence.';
comment on column public.bank_payments.direction_source_reference is
  'Provider/import reference used to trace the direction claim to its source record.';
comment on column public.bank_payments.direction_evidence_sha256 is
  'Lowercase SHA-256 of the canonical source evidence used to verify direction.';
comment on column public.bank_payments.direction_verified_at is
  'Timestamp when source direction evidence was verified.';
comment on column public.bank_payments.direction_verified is
  'Generated fail-closed flag; true only for incoming/outgoing with complete provenance.';

