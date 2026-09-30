-- Applied to Supabase UAT on 2026-09-25.
-- Inventory items, movements and four-eyes inventory adjustments.

create table if not exists public.inventory_items(
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  sku text not null,
  name text not null,
  unit text not null check(unit in ('st','kg','l')),
  purchase_account text not null check(purchase_account ~ '^[0-9]{4}$'),
  inventory_account text not null check(inventory_account ~ '^[0-9]{4}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,sku),
  unique(company_id,id)
);
alter table public.inventory_items enable row level security;

create table if not exists public.inventory_movements(
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  item_id text not null,
  movement_date date not null,
  type text not null check(type in ('receipt','sale','waste','adjustment')),
  quantity_milli bigint not null check(quantity_milli<>0),
  unit_cost_ore bigint,
  reference_type text,
  reference_id text,
  note text,
  actor_id uuid not null references auth.users(id),
  request_id text,
  created_at timestamptz not null default now(),
  foreign key(company_id,item_id) references public.inventory_items(company_id,id) on delete restrict,
  unique(company_id,request_id)
);
alter table public.inventory_movements enable row level security;
create index if not exists inventory_movements_company_item_date_idx on public.inventory_movements(company_id,item_id,movement_date desc,created_at desc);
create index if not exists inventory_movements_actor_idx on public.inventory_movements(actor_id);

create table if not exists public.inventory_adjustments(
  id text primary key,
  company_id text not null references public.companies(id) on delete cascade,
  item_id text not null,
  adjustment_date date not null,
  current_quantity_milli bigint not null,
  counted_quantity_milli bigint not null check(counted_quantity_milli>=0),
  difference_milli bigint not null check(difference_milli<>0),
  reason text not null,
  status text not null check(status in ('pending','approved','rejected')),
  counted_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejected_by uuid references auth.users(id),
  rejected_at timestamptz,
  request_id text,
  created_at timestamptz not null default now(),
  foreign key(company_id,item_id) references public.inventory_items(company_id,id) on delete restrict,
  unique(company_id,request_id),
  unique(company_id,id)
);
alter table public.inventory_adjustments enable row level security;
create index if not exists inventory_adjustments_company_status_idx on public.inventory_adjustments(company_id,status,created_at desc);
create index if not exists inventory_adjustments_counted_by_idx on public.inventory_adjustments(counted_by);
create index if not exists inventory_adjustments_approved_by_idx on public.inventory_adjustments(approved_by);
create index if not exists inventory_adjustments_rejected_by_idx on public.inventory_adjustments(rejected_by);

create policy "members read inventory items" on public.inventory_items for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=inventory_items.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members manage inventory items" on public.inventory_items for all to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=inventory_items.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (exists(select 1 from public.company_memberships m where m.company_id=inventory_items.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

create policy "members read inventory movements" on public.inventory_movements for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=inventory_movements.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members insert inventory movements" on public.inventory_movements for insert to authenticated
with check (actor_id=(select auth.uid()) and exists(select 1 from public.company_memberships m where m.company_id=inventory_movements.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

create policy "members read inventory adjustments" on public.inventory_adjustments for select to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=inventory_adjustments.company_id and m.auth_user_id=(select auth.uid())));
create policy "accounting members insert inventory adjustments" on public.inventory_adjustments for insert to authenticated
with check (counted_by=(select auth.uid()) and exists(select 1 from public.company_memberships m where m.company_id=inventory_adjustments.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));
create policy "accounting members update inventory adjustments" on public.inventory_adjustments for update to authenticated
using (exists(select 1 from public.company_memberships m where m.company_id=inventory_adjustments.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')))
with check (exists(select 1 from public.company_memberships m where m.company_id=inventory_adjustments.company_id and m.auth_user_id=(select auth.uid()) and m.role in ('admin','accountant')));

revoke all on public.inventory_items,public.inventory_movements,public.inventory_adjustments from anon;
grant select,insert,update,delete on public.inventory_items to authenticated;
grant select,insert on public.inventory_movements to authenticated;
grant select,insert,update on public.inventory_adjustments to authenticated;

create or replace function public.create_inventory_item(
  p_company_id text,p_sku text,p_name text,p_unit text,p_purchase_account text,p_inventory_account text
)
returns table(item_id text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_existing public.inventory_items%rowtype;v_id text;
begin
  perform set_config('app.controlled_inventory_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if btrim(coalesce(p_sku,''))='' or char_length(btrim(p_sku))>60 then raise exception 'INVALID_ITEM'; end if;
  if char_length(btrim(coalesce(p_name,'')))<2 or char_length(btrim(p_name))>160 then raise exception 'INVALID_ITEM'; end if;
  if lower(p_unit) not in ('st','kg','l') then raise exception 'INVALID_UNIT'; end if;
  if p_purchase_account !~ '^[0-9]{4}$' or p_inventory_account !~ '^[0-9]{4}$' then raise exception 'INVALID_ACCOUNT'; end if;
  select * into v_existing from public.inventory_items i where i.company_id=p_company_id and i.sku=upper(btrim(p_sku));
  if found then
    if v_existing.name<>btrim(p_name) or v_existing.unit<>lower(p_unit) or v_existing.purchase_account<>p_purchase_account or v_existing.inventory_account<>p_inventory_account then
      raise exception 'INVENTORY_ITEM_IDEMPOTENCY_CONFLICT';
    end if;
    return query select v_existing.id,true;return;
  end if;
  v_id='item_'||replace(gen_random_uuid()::text,'-','');
  insert into public.inventory_items(id,company_id,sku,name,unit,purchase_account,inventory_account)
  values(v_id,p_company_id,upper(btrim(p_sku)),btrim(p_name),lower(p_unit),p_purchase_account,p_inventory_account);
  return query select v_id,false;
end;
$$;
revoke all on function public.create_inventory_item(text,text,text,text,text,text) from public,anon;
grant execute on function public.create_inventory_item(text,text,text,text,text,text) to authenticated;

create or replace function public.add_inventory_movement(
  p_company_id text,p_request_id text,p_item_id text,p_movement_date date,p_type text,p_quantity_milli bigint,p_note text default null
)
returns table(movement_id text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_existing public.inventory_movements%rowtype;v_current bigint;v_id text;
begin
  perform set_config('app.controlled_inventory_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if p_request_id !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'INVALID_INVENTORY_REQUEST_ID'; end if;
  if p_type not in ('receipt','sale','waste') then raise exception 'INVALID_MOVEMENT_TYPE'; end if;
  if p_quantity_milli=0 then raise exception 'INVALID_QUANTITY'; end if;
  if p_type='receipt' and p_quantity_milli<0 then raise exception 'INVALID_RECEIPT_QUANTITY'; end if;
  if p_type in ('sale','waste') and p_quantity_milli>0 then raise exception 'INVALID_OUTFLOW_QUANTITY'; end if;
  if not exists(select 1 from public.inventory_items i where i.company_id=p_company_id and i.id=p_item_id and i.active) then raise exception 'ITEM_NOT_FOUND'; end if;
  select * into v_existing from public.inventory_movements m where m.company_id=p_company_id and m.request_id=p_request_id;
  if found then
    if v_existing.item_id<>p_item_id or v_existing.movement_date<>p_movement_date or v_existing.type<>p_type or v_existing.quantity_milli<>p_quantity_milli or coalesce(v_existing.note,'')<>coalesce(nullif(left(btrim(p_note),500),''),'') or v_existing.actor_id<>v_uid then
      raise exception 'INVENTORY_IDEMPOTENCY_CONFLICT';
    end if;
    return query select v_existing.id,true;return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':inventory:'||p_item_id,0));
  select coalesce(sum(m.quantity_milli),0) into v_current from public.inventory_movements m where m.company_id=p_company_id and m.item_id=p_item_id;
  if v_current+p_quantity_milli<0 then raise exception 'NEGATIVE_STOCK'; end if;
  v_id='imov_'||replace(gen_random_uuid()::text,'-','');
  insert into public.inventory_movements(id,company_id,item_id,movement_date,type,quantity_milli,note,actor_id,request_id)
  values(v_id,p_company_id,p_item_id,p_movement_date,p_type,p_quantity_milli,nullif(left(btrim(p_note),500),''),v_uid,p_request_id);
  return query select v_id,false;
end;
$$;
revoke all on function public.add_inventory_movement(text,text,text,date,text,bigint,text) from public,anon;
grant execute on function public.add_inventory_movement(text,text,text,date,text,bigint,text) to authenticated;

create or replace function public.create_inventory_adjustment(
  p_company_id text,p_request_id text,p_item_id text,p_adjustment_date date,p_counted_quantity_milli bigint,p_reason text
)
returns table(adjustment_id text,duplicate boolean)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_existing public.inventory_adjustments%rowtype;v_current bigint;v_diff bigint;v_id text;
begin
  perform set_config('app.controlled_inventory_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  if p_request_id !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'INVALID_INVENTORY_REQUEST_ID'; end if;
  if p_counted_quantity_milli<0 then raise exception 'INVALID_COUNTED_QUANTITY'; end if;
  if not exists(select 1 from public.inventory_items i where i.company_id=p_company_id and i.id=p_item_id and i.active) then raise exception 'ITEM_NOT_FOUND'; end if;
  select * into v_existing from public.inventory_adjustments a where a.company_id=p_company_id and a.request_id=p_request_id;
  if found then
    if v_existing.item_id<>p_item_id or v_existing.adjustment_date<>p_adjustment_date or v_existing.counted_quantity_milli<>p_counted_quantity_milli or v_existing.reason<>coalesce(nullif(left(btrim(p_reason),500),''),'Inventering') or v_existing.counted_by<>v_uid then raise exception 'INVENTORY_IDEMPOTENCY_CONFLICT'; end if;
    return query select v_existing.id,true;return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id||':inventory:'||p_item_id,0));
  select coalesce(sum(m.quantity_milli),0) into v_current from public.inventory_movements m where m.company_id=p_company_id and m.item_id=p_item_id;
  v_diff=p_counted_quantity_milli-v_current;
  if v_diff=0 then raise exception 'NO_ADJUSTMENT_REQUIRED'; end if;
  v_id='iadj_'||replace(gen_random_uuid()::text,'-','');
  insert into public.inventory_adjustments(id,company_id,item_id,adjustment_date,current_quantity_milli,counted_quantity_milli,difference_milli,reason,status,counted_by,request_id)
  values(v_id,p_company_id,p_item_id,p_adjustment_date,v_current,p_counted_quantity_milli,v_diff,coalesce(nullif(left(btrim(p_reason),500),''),'Inventering'),'pending',v_uid,p_request_id);
  return query select v_id,false;
end;
$$;
revoke all on function public.create_inventory_adjustment(text,text,text,date,bigint,text) from public,anon;
grant execute on function public.create_inventory_adjustment(text,text,text,date,bigint,text) to authenticated;

create or replace function public.decide_inventory_adjustment(
  p_company_id text,p_adjustment_id text,p_decision text
)
returns table(adjustment_id text,status text,movement_id text)
language plpgsql security invoker set search_path=''
as $$
declare v_uid uuid:=auth.uid();v_adj public.inventory_adjustments%rowtype;v_current bigint;v_movement_id text;
begin
  perform set_config('app.controlled_inventory_write','1',true);
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=p_company_id and m.auth_user_id=v_uid and m.role in ('admin','accountant')) then raise exception 'ACCESS_DENIED'; end if;
  select * into v_adj from public.inventory_adjustments a where a.company_id=p_company_id and a.id=p_adjustment_id for update;
  if not found then raise exception 'ADJUSTMENT_NOT_FOUND'; end if;
  if v_adj.status<>'pending' then
    if p_decision='approve' and v_adj.status='approved' and v_adj.approved_by=v_uid then
      select m.id into v_movement_id from public.inventory_movements m where m.company_id=p_company_id and m.reference_type='inventory-adjustment' and m.reference_id=v_adj.id order by m.created_at limit 1;
      return query select v_adj.id,v_adj.status,v_movement_id;return;
    elsif p_decision='reject' and v_adj.status='rejected' and v_adj.rejected_by=v_uid then
      return query select v_adj.id,v_adj.status,null::text;return;
    else
      raise exception 'ADJUSTMENT_ALREADY_DECIDED';
    end if;
  end if;
  if p_decision='approve' then
    if v_adj.counted_by=v_uid then raise exception 'SEPARATION_OF_DUTIES_FAILED'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_company_id||':inventory:'||v_adj.item_id,0));
    select coalesce(sum(m.quantity_milli),0) into v_current from public.inventory_movements m where m.company_id=p_company_id and m.item_id=v_adj.item_id;
    if v_current<>v_adj.current_quantity_milli then raise exception 'STOCK_CHANGED_SINCE_COUNT'; end if;
    if v_current+v_adj.difference_milli<0 then raise exception 'NEGATIVE_STOCK'; end if;
    v_movement_id='imov_'||replace(gen_random_uuid()::text,'-','');
    insert into public.inventory_movements(id,company_id,item_id,movement_date,type,quantity_milli,reference_type,reference_id,note,actor_id,request_id)
    values(v_movement_id,p_company_id,v_adj.item_id,v_adj.adjustment_date,'adjustment',v_adj.difference_milli,'inventory-adjustment',v_adj.id,v_adj.reason,v_uid,'inventory-adjustment-'||v_adj.id);
    update public.inventory_adjustments as a set status='approved',approved_by=v_uid,approved_at=now() where a.company_id=p_company_id and a.id=v_adj.id and a.status='pending';
    return query select v_adj.id,'approved'::text,v_movement_id;return;
  elsif p_decision='reject' then
    update public.inventory_adjustments as a set status='rejected',rejected_by=v_uid,rejected_at=now() where a.company_id=p_company_id and a.id=v_adj.id and a.status='pending';
    return query select v_adj.id,'rejected'::text,null::text;return;
  else
    raise exception 'INVALID_DECISION';
  end if;
end;
$$;
revoke all on function public.decide_inventory_adjustment(text,text,text) from public,anon;
grant execute on function public.decide_inventory_adjustment(text,text,text) to authenticated;

create or replace function private.require_controlled_inventory_write()
returns trigger
language plpgsql security invoker set search_path=''
as $$
begin
  if coalesce(current_setting('app.controlled_inventory_write',true),'')<>'1' then
    raise exception 'DIRECT_INVENTORY_WRITE_BLOCKED';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['inventory_items','inventory_movements','inventory_adjustments']
  loop
    execute format('drop trigger if exists controlled_inventory_write_guard on public.%I',t);
    execute format('create trigger controlled_inventory_write_guard before insert or update or delete on public.%I for each row execute function private.require_controlled_inventory_write()',t);
  end loop;
end
$$;
