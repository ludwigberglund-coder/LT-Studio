-- Prevent concurrent activation rotations from leaving more than one usable invite.
-- This migration is additive and does not modify the onboarding implementation.

create unique index if not exists company_activation_invites_single_active_per_company
on public.company_activation_invites(company_id)
where claimed_at is null and revoked_at is null;
