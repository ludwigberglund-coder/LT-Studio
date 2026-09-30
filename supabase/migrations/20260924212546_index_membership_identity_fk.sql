-- Recovered from live Supabase migration history (20260924212546 index_membership_identity_fk).
-- GitHub is source of truth for rebuilds.

create index if not exists idx_company_memberships_user_identity
  on public.company_memberships(user_id, auth_user_id);;
