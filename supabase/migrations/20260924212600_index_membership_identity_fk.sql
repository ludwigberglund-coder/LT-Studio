-- Cover the composite app-user identity foreign key used by company memberships.
create index if not exists idx_company_memberships_user_identity
  on public.company_memberships(user_id, auth_user_id);
