-- Secure UAT path for manually reviewed automation proposals.
-- Keeps proposal edits inside a company-scoped, role-checked RPC and removes
-- destructive table privileges that browser clients never need.

create or replace function public.save_automation_proposal_review(
  p_company_id text,
  p_proposal_id text,
  p_suggestion jsonb
)
returns table(proposal_id text, status text)
language plpgsql
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.company_memberships m
    where m.company_id = p_company_id
      and m.auth_user_id = v_uid
      and m.role in ('admin','accountant')
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  select p.status
    into v_status
  from public.automation_proposals p
  where p.company_id = p_company_id
    and p.id = p_proposal_id
  for update;

  if not found then
    raise exception 'PROPOSAL_NOT_FOUND';
  end if;

  if v_status not in ('manual-review','ready-for-approval') then
    raise exception 'INVALID_PROPOSAL_STATUS';
  end if;

  update public.automation_proposals
     set suggestion_json = coalesce(p_suggestion, '{}'::jsonb),
         status = 'manual-review',
         deterministic = false,
         ambiguous = true,
         decision_reason = 'Förslaget ändrades manuellt och behöver därför granskas på nytt.'
   where company_id = p_company_id
     and id = p_proposal_id;

  return query select p_proposal_id, 'manual-review'::text;
end;
$function$;

revoke all on function public.save_automation_proposal_review(text,text,jsonb) from public;
grant execute on function public.save_automation_proposal_review(text,text,jsonb) to authenticated;

revoke delete, truncate, trigger, references
on table public.automation_proposals
from authenticated;
