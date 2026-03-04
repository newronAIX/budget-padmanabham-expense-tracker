-- Run this in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  currency_code text not null default 'INR',
  expense_secret text not null default encode(gen_random_bytes(32), 'base64'),
  created_at timestamptz not null default now(),
  constraint families_currency_len check (char_length(currency_code) = 3)
);

create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'MEMBER',
  display_name text,
  created_at timestamptz not null default now(),
  unique (family_id, user_id),
  constraint family_members_role_check check (role in ('OWNER', 'MEMBER'))
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  scope text not null default 'EXPENSE',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint categories_scope_check check (scope in ('EXPENSE', 'INCOME'))
);

drop index if exists categories_family_name_uq;
create unique index if not exists categories_family_scope_name_uq on public.categories (family_id, scope, lower(name));

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  amount numeric(12,2) not null,
  spent_by uuid not null references auth.users(id) on delete cascade,
  spent_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  constraint expenses_amount_positive check (amount > 0)
);

create table if not exists public.incomes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null,
  category_id uuid references public.categories(id) on delete set null,
  amount numeric(12,2) not null,
  day_of_month int not null,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incomes_amount_positive check (amount > 0),
  constraint incomes_day_range check (day_of_month between 1 and 28)
);

create table if not exists public.family_invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  invited_email text not null,
  invite_code text not null unique,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  currency_code text not null,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  constraint family_invites_status check (status in ('PENDING', 'ACCEPTED', 'EXPIRED'))
);

create index if not exists expenses_family_spent_at_idx on public.expenses (family_id, spent_at desc);
create index if not exists incomes_family_idx on public.incomes (family_id);
create index if not exists family_members_user_idx on public.family_members (user_id);

alter table public.families alter column currency_code set default 'INR';
alter table public.families add column if not exists expense_secret text;
update public.families
set expense_secret = encode(gen_random_bytes(32), 'base64')
where expense_secret is null or expense_secret = '';
alter table public.families alter column expense_secret set not null;
alter table public.families alter column expense_secret set default encode(gen_random_bytes(32), 'base64');
alter table public.categories add column if not exists scope text not null default 'EXPENSE';
alter table public.incomes add column if not exists category_id uuid references public.categories(id) on delete set null;

alter table public.categories drop constraint if exists categories_scope_check;
alter table public.categories
  add constraint categories_scope_check check (scope in ('EXPENSE', 'INCOME'));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists incomes_updated_at_trigger on public.incomes;
create trigger incomes_updated_at_trigger
before update on public.incomes
for each row
execute function public.set_updated_at();

create or replace function public.is_family_member(target_family uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = target_family
      and fm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_family_member(uuid) from public;
grant execute on function public.is_family_member(uuid) to authenticated;

create or replace view public.expense_view with (security_invoker = true) as
select
  e.id,
  e.family_id,
  e.name,
  e.category_id,
  c.name as category_name,
  (e.amount::float8) as amount,
  e.spent_by,
  coalesce(fm.display_name, p.full_name, p.email) as spent_by_name,
  e.spent_at,
  e.notes
from public.expenses e
left join public.categories c on c.id = e.category_id
left join public.family_members fm on fm.family_id = e.family_id and fm.user_id = e.spent_by
left join public.profiles p on p.id = e.spent_by;

grant select on public.expense_view to authenticated;

create or replace view public.income_view with (security_invoker = true) as
select
  i.id,
  i.family_id,
  i.title,
  i.category_id,
  c.name as category_name,
  (i.amount::float8) as amount,
  i.day_of_month,
  i.is_active,
  i.created_at
from public.incomes i
left join public.categories c on c.id = i.category_id;

grant select on public.income_view to authenticated;

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.categories enable row level security;
alter table public.expenses enable row level security;
alter table public.incomes enable row level security;
alter table public.family_invites enable row level security;

drop policy if exists "profiles_self_select" on public.profiles;
create policy "profiles_self_select" on public.profiles
for select using (id = auth.uid());

drop policy if exists "profiles_self_insert" on public.profiles;
create policy "profiles_self_insert" on public.profiles
for insert with check (id = auth.uid());

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "families_member_select" on public.families;
create policy "families_member_select" on public.families
for select using (
  public.is_family_member(id)
  or owner_id = auth.uid()
);

drop policy if exists "families_owner_insert" on public.families;
create policy "families_owner_insert" on public.families
for insert with check (owner_id = auth.uid());

drop policy if exists "families_owner_update" on public.families;
create policy "families_owner_update" on public.families
for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "family_members_member_select" on public.family_members;
create policy "family_members_member_select" on public.family_members
for select using (
  public.is_family_member(family_id)
  or user_id = auth.uid()
);

drop policy if exists "family_members_owner_insert" on public.family_members;
create policy "family_members_owner_insert" on public.family_members
for insert with check (
  user_id = auth.uid()
  and role = 'OWNER'
  and (
  exists (
    select 1
    from public.families f
    where f.id = family_id
      and f.owner_id = auth.uid()
  )
  )
);

drop policy if exists "family_members_accept_invite_insert" on public.family_members;
create policy "family_members_accept_invite_insert" on public.family_members
for insert with check (
  user_id = auth.uid()
  and role = 'MEMBER'
  and exists (
    select 1
    from public.family_invites fi
    where fi.family_id = family_id
      and fi.status = 'PENDING'
      and lower(fi.invited_email) = lower(auth.jwt() ->> 'email')
  )
);

drop policy if exists "family_members_owner_delete" on public.family_members;
create policy "family_members_owner_delete" on public.family_members
for delete using (
  role = 'MEMBER'
  and exists (
    select 1
    from public.families f
    where f.id = family_id
      and f.owner_id = auth.uid()
  )
);

drop policy if exists "categories_family_read" on public.categories;
create policy "categories_family_read" on public.categories
for select using (public.is_family_member(family_id));

drop policy if exists "categories_family_insert" on public.categories;
create policy "categories_family_insert" on public.categories
for insert with check (
  public.is_family_member(family_id)
  and created_by = auth.uid()
);

drop policy if exists "expenses_family_read" on public.expenses;
create policy "expenses_family_read" on public.expenses
for select using (public.is_family_member(family_id));

drop policy if exists "expenses_family_insert" on public.expenses;
create policy "expenses_family_insert" on public.expenses
for insert with check (
  public.is_family_member(family_id)
  and spent_by = auth.uid()
);

drop policy if exists "expenses_family_update" on public.expenses;
create policy "expenses_family_update" on public.expenses
for update using (public.is_family_member(family_id))
with check (public.is_family_member(family_id));

drop policy if exists "expenses_family_delete" on public.expenses;
create policy "expenses_family_delete" on public.expenses
for delete using (public.is_family_member(family_id));

drop policy if exists "incomes_family_read" on public.incomes;
create policy "incomes_family_read" on public.incomes
for select using (public.is_family_member(family_id));

drop policy if exists "incomes_family_insert" on public.incomes;
create policy "incomes_family_insert" on public.incomes
for insert with check (public.is_family_member(family_id));

drop policy if exists "incomes_family_update" on public.incomes;
create policy "incomes_family_update" on public.incomes
for update using (public.is_family_member(family_id)) with check (public.is_family_member(family_id));

drop policy if exists "invites_owner_read" on public.family_invites;
create policy "invites_owner_read" on public.family_invites
for select using (
  exists (
    select 1
    from public.families f
    where f.id = family_id
      and f.owner_id = auth.uid()
  )
  or lower(invited_email) = lower(auth.jwt() ->> 'email')
);

drop policy if exists "invites_owner_insert" on public.family_invites;
create policy "invites_owner_insert" on public.family_invites
for insert with check (
  inviter_id = auth.uid()
  and exists (
    select 1
    from public.families f
    where f.id = family_id
      and f.owner_id = auth.uid()
      and f.currency_code = currency_code
  )
);

drop policy if exists "invites_accept_update" on public.family_invites;
create policy "invites_accept_update" on public.family_invites
for update using (
  lower(invited_email) = lower(auth.jwt() ->> 'email')
) with check (
  status in ('ACCEPTED', 'EXPIRED')
);
