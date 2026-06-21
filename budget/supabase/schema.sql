-- Budget mobile/web schema.
-- Safe to run more than once. Tables are prefixed with budget_ so this app can
-- live beside other apps in the same Supabase project.

create extension if not exists pgcrypto;

create table if not exists public.budget_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now(),
  constraint budget_profiles_full_name_len check (full_name is null or char_length(trim(full_name)) between 1 and 120),
  constraint budget_profiles_email_len check (email is null or char_length(email) <= 320)
);

create table if not exists public.budget_families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  currency_code text not null default 'INR',
  monthly_budget numeric(12,2) not null default 0,
  invite_code text,
  invite_locked boolean not null default false,
  created_at timestamptz not null default now(),
  constraint budget_families_name_len check (char_length(trim(name)) between 1 and 80),
  constraint budget_families_currency_len check (char_length(currency_code) = 3),
  constraint budget_families_monthly_budget_nonnegative check (monthly_budget >= 0),
  constraint budget_families_invite_code_format check (invite_code is null or invite_code ~ '^BUDGET-[A-Z0-9]{4,12}$')
);

create table if not exists public.budget_family_users (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.budget_families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'MEMBER',
  created_at timestamptz not null default now(),
  unique (family_id, user_id),
  constraint budget_family_users_role_check check (role in ('OWNER', 'MEMBER'))
);

create table if not exists public.budget_people (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.budget_families(id) on delete cascade,
  display_name text not null,
  linked_user_id uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint budget_people_display_name_len check (char_length(trim(display_name)) between 1 and 80)
);

create table if not exists public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.budget_families(id) on delete cascade,
  name text not null,
  scope text not null default 'EXPENSE',
  color text not null default '#1B4332',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint budget_categories_name_len check (char_length(trim(name)) between 1 and 80),
  constraint budget_categories_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint budget_categories_scope_check check (scope in ('EXPENSE', 'INCOME'))
);

drop index if exists public.budget_categories_family_scope_name_uq;
create unique index budget_categories_family_scope_name_uq
on public.budget_categories (family_id, scope, lower(btrim(name)));

create unique index if not exists budget_people_family_linked_user_uq
on public.budget_people (family_id, linked_user_id)
where linked_user_id is not null;

create table if not exists public.budget_expenses (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.budget_families(id) on delete cascade,
  title text not null,
  amount numeric(12,2) not null,
  spent_on date not null default current_date,
  person_id uuid not null references public.budget_people(id) on delete restrict,
  category_id uuid references public.budget_categories(id) on delete set null,
  note text,
  entered_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_expenses_title_len check (char_length(trim(title)) between 1 and 120),
  constraint budget_expenses_note_len check (note is null or char_length(note) <= 500),
  constraint budget_expenses_amount_positive check (amount > 0)
);

create table if not exists public.budget_incomes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.budget_families(id) on delete cascade,
  title text not null,
  amount numeric(12,2) not null,
  day_of_month int not null default 1,
  category_id uuid references public.budget_categories(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_incomes_title_len check (char_length(trim(title)) between 1 and 120),
  constraint budget_incomes_amount_positive check (amount > 0),
  constraint budget_incomes_day_range check (day_of_month between 1 and 28)
);

create table if not exists public.budget_invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.budget_families(id) on delete cascade,
  invite_code text not null unique,
  invited_email text,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  constraint budget_invites_code_format check (invite_code ~ '^BUDGET-[A-Z0-9]{4,12}$'),
  constraint budget_invites_email_len check (invited_email is null or char_length(invited_email) <= 320),
  constraint budget_invites_status_check check (status in ('PENDING', 'ACCEPTED', 'EXPIRED'))
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'budget_profiles_full_name_len') then
    alter table public.budget_profiles add constraint budget_profiles_full_name_len check (full_name is null or char_length(trim(full_name)) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'budget_profiles_email_len') then
    alter table public.budget_profiles add constraint budget_profiles_email_len check (email is null or char_length(email) <= 320);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'budget_families_name_len') then
    alter table public.budget_families add constraint budget_families_name_len check (char_length(trim(name)) between 1 and 80);
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'budget_families' and column_name = 'invite_code') then
    alter table public.budget_families add column invite_code text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'budget_families' and column_name = 'invite_locked') then
    alter table public.budget_families add column invite_locked boolean not null default false;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'budget_families_invite_code_format') then
    alter table public.budget_families add constraint budget_families_invite_code_format check (invite_code is null or invite_code ~ '^BUDGET-[A-Z0-9]{4,12}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'budget_people_display_name_len') then
    alter table public.budget_people add constraint budget_people_display_name_len check (char_length(trim(display_name)) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'budget_categories_name_len') then
    alter table public.budget_categories add constraint budget_categories_name_len check (char_length(trim(name)) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'budget_categories_color_hex') then
    alter table public.budget_categories add constraint budget_categories_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'budget_expenses_title_len') then
    alter table public.budget_expenses add constraint budget_expenses_title_len check (char_length(trim(title)) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'budget_expenses_note_len') then
    alter table public.budget_expenses add constraint budget_expenses_note_len check (note is null or char_length(note) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'budget_incomes_title_len') then
    alter table public.budget_incomes add constraint budget_incomes_title_len check (char_length(trim(title)) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'budget_invites_code_format') then
    alter table public.budget_invites add constraint budget_invites_code_format check (invite_code ~ '^BUDGET-[A-Z0-9]{4,12}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'budget_invites_email_len') then
    alter table public.budget_invites add constraint budget_invites_email_len check (invited_email is null or char_length(invited_email) <= 320);
  end if;
end;
$$;

update public.budget_families f
set invite_code = chosen.invite_code
from (
  select distinct on (family_id) family_id, invite_code
  from public.budget_invites
  order by family_id, created_at asc
) chosen
where f.id = chosen.family_id
  and f.invite_code is null;

do $$
declare
  family_row record;
  candidate text;
begin
  for family_row in select id from public.budget_families where invite_code is null loop
    loop
      candidate := 'BUDGET-' || upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
      exit when not exists (select 1 from public.budget_families where invite_code = candidate);
    end loop;
    update public.budget_families set invite_code = candidate where id = family_row.id;
  end loop;
end;
$$;

create unique index if not exists budget_families_invite_code_uq
on public.budget_families (invite_code);

alter table public.budget_families alter column invite_code set not null;

create index if not exists budget_family_users_user_idx on public.budget_family_users (user_id);
create index if not exists budget_people_family_idx on public.budget_people (family_id);
create index if not exists budget_categories_family_idx on public.budget_categories (family_id, scope);
create index if not exists budget_expenses_family_spent_on_idx on public.budget_expenses (family_id, spent_on desc);
create index if not exists budget_incomes_family_idx on public.budget_incomes (family_id);

create or replace function public.budget_set_family_invite_code()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  candidate text;
begin
  if new.invite_code is not null then
    new.invite_code = upper(trim(new.invite_code));
    return new;
  end if;

  loop
    candidate := 'BUDGET-' || upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
    exit when not exists (select 1 from public.budget_families where invite_code = candidate);
  end loop;

  new.invite_code = candidate;
  return new;
end;
$$;

drop trigger if exists budget_families_invite_code on public.budget_families;
create trigger budget_families_invite_code
before insert on public.budget_families
for each row execute function public.budget_set_family_invite_code();

create or replace function public.budget_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists budget_expenses_updated_at on public.budget_expenses;
create trigger budget_expenses_updated_at
before update on public.budget_expenses
for each row execute function public.budget_set_updated_at();

drop trigger if exists budget_incomes_updated_at on public.budget_incomes;
create trigger budget_incomes_updated_at
before update on public.budget_incomes
for each row execute function public.budget_set_updated_at();

create schema if not exists budget_private;

revoke all on schema budget_private from public;
grant usage on schema budget_private to authenticated;

create or replace function budget_private.is_budget_family_user(target_family uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.budget_family_users fu
    where fu.family_id = target_family
      and fu.user_id = auth.uid()
  );
$$;

revoke all on function budget_private.is_budget_family_user(uuid) from public;
grant execute on function budget_private.is_budget_family_user(uuid) to authenticated;

create or replace function public.is_budget_family_user(target_family uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select budget_private.is_budget_family_user(target_family);
$$;

revoke all on function public.is_budget_family_user(uuid) from public;
grant execute on function public.is_budget_family_user(uuid) to authenticated;

create or replace function budget_private.join_budget_invite(invite_code_input text, display_name_input text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  family_row public.budget_families%rowtype;
  normalized_code text := upper(trim(invite_code_input));
  member_name text := nullif(trim(display_name_input), '');
  current_email text := auth.email();
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select *
  into family_row
  from public.budget_families
  where invite_code = normalized_code
  limit 1;

  if family_row.id is null then
    raise exception 'Invite code is invalid';
  end if;

  if family_row.invite_locked then
    raise exception 'This family is locked. Ask the family creator to unlock joining.';
  end if;

  insert into public.budget_family_users (family_id, user_id, role)
  values (family_row.id, auth.uid(), 'MEMBER')
  on conflict (family_id, user_id) do nothing;

  insert into public.budget_people (family_id, display_name, linked_user_id, created_by)
  values (
    family_row.id,
    coalesce(member_name, current_email, 'Family member'),
    auth.uid(),
    auth.uid()
  )
  on conflict (family_id, linked_user_id) where linked_user_id is not null do update
    set display_name = excluded.display_name;

  return family_row.id;
end;
$$;

revoke all on function budget_private.join_budget_invite(text, text) from public;
grant execute on function budget_private.join_budget_invite(text, text) to authenticated;

create or replace function public.join_budget_invite(invite_code_input text, display_name_input text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select budget_private.join_budget_invite(invite_code_input, display_name_input);
$$;

revoke all on function public.join_budget_invite(text, text) from public;
grant execute on function public.join_budget_invite(text, text) to authenticated;

grant select, insert, update on public.budget_profiles to authenticated;
grant select, insert, update, delete on public.budget_families to authenticated;
grant select, insert, update, delete on public.budget_family_users to authenticated;
grant select, insert, update, delete on public.budget_people to authenticated;
grant select, insert, update, delete on public.budget_categories to authenticated;
grant select, insert, update, delete on public.budget_expenses to authenticated;
grant select, insert, update, delete on public.budget_incomes to authenticated;
grant select, insert, update on public.budget_invites to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter table public.budget_profiles enable row level security;
alter table public.budget_families enable row level security;
alter table public.budget_family_users enable row level security;
alter table public.budget_people enable row level security;
alter table public.budget_categories enable row level security;
alter table public.budget_expenses enable row level security;
alter table public.budget_incomes enable row level security;
alter table public.budget_invites enable row level security;

drop policy if exists "budget_profiles_self_select" on public.budget_profiles;
create policy "budget_profiles_self_select" on public.budget_profiles
for select to authenticated using (id = auth.uid());

drop policy if exists "budget_profiles_self_insert" on public.budget_profiles;
create policy "budget_profiles_self_insert" on public.budget_profiles
for insert to authenticated with check (id = auth.uid());

drop policy if exists "budget_profiles_self_update" on public.budget_profiles;
create policy "budget_profiles_self_update" on public.budget_profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "budget_families_read" on public.budget_families;
create policy "budget_families_read" on public.budget_families
for select to authenticated using (owner_id = auth.uid() or public.is_budget_family_user(id));

drop policy if exists "budget_families_insert" on public.budget_families;
create policy "budget_families_insert" on public.budget_families
for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "budget_families_owner_update" on public.budget_families;
create policy "budget_families_owner_update" on public.budget_families
for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "budget_family_users_read" on public.budget_family_users;
create policy "budget_family_users_read" on public.budget_family_users
for select to authenticated using (user_id = auth.uid() or public.is_budget_family_user(family_id));

drop policy if exists "budget_family_users_owner_insert" on public.budget_family_users;
create policy "budget_family_users_owner_insert" on public.budget_family_users
for insert to authenticated with check (
  user_id = auth.uid()
  and role = 'OWNER'
  and exists (
    select 1 from public.budget_families f
    where f.id = family_id and f.owner_id = auth.uid()
  )
);

drop policy if exists "budget_family_users_owner_delete" on public.budget_family_users;
create policy "budget_family_users_owner_delete" on public.budget_family_users
for delete to authenticated using (
  role = 'MEMBER'
  and exists (
    select 1 from public.budget_families f
    where f.id = family_id and f.owner_id = auth.uid()
  )
);

drop policy if exists "budget_people_read" on public.budget_people;
create policy "budget_people_read" on public.budget_people
for select to authenticated using (public.is_budget_family_user(family_id));

drop policy if exists "budget_people_insert" on public.budget_people;
create policy "budget_people_insert" on public.budget_people
for insert to authenticated with check (public.is_budget_family_user(family_id) and created_by = auth.uid());

drop policy if exists "budget_people_update" on public.budget_people;
create policy "budget_people_update" on public.budget_people
for update to authenticated using (public.is_budget_family_user(family_id)) with check (public.is_budget_family_user(family_id));

drop policy if exists "budget_categories_read" on public.budget_categories;
create policy "budget_categories_read" on public.budget_categories
for select to authenticated using (public.is_budget_family_user(family_id));

drop policy if exists "budget_categories_insert" on public.budget_categories;
create policy "budget_categories_insert" on public.budget_categories
for insert to authenticated with check (public.is_budget_family_user(family_id) and created_by = auth.uid());

drop policy if exists "budget_categories_update" on public.budget_categories;
create policy "budget_categories_update" on public.budget_categories
for update to authenticated using (public.is_budget_family_user(family_id)) with check (public.is_budget_family_user(family_id));

drop policy if exists "budget_categories_delete" on public.budget_categories;
create policy "budget_categories_delete" on public.budget_categories
for delete to authenticated using (public.is_budget_family_user(family_id));

drop policy if exists "budget_expenses_read" on public.budget_expenses;
create policy "budget_expenses_read" on public.budget_expenses
for select to authenticated using (public.is_budget_family_user(family_id));

drop policy if exists "budget_expenses_insert" on public.budget_expenses;
create policy "budget_expenses_insert" on public.budget_expenses
for insert to authenticated with check (
  public.is_budget_family_user(family_id)
  and entered_by = auth.uid()
  and exists (select 1 from public.budget_people p where p.id = person_id and p.family_id = budget_expenses.family_id)
  and (
    category_id is null
    or exists (select 1 from public.budget_categories c where c.id = category_id and c.family_id = budget_expenses.family_id)
  )
);

drop policy if exists "budget_expenses_update" on public.budget_expenses;
create policy "budget_expenses_update" on public.budget_expenses
for update to authenticated using (public.is_budget_family_user(family_id))
with check (
  public.is_budget_family_user(family_id)
  and exists (select 1 from public.budget_people p where p.id = person_id and p.family_id = budget_expenses.family_id)
);

drop policy if exists "budget_expenses_delete" on public.budget_expenses;
create policy "budget_expenses_delete" on public.budget_expenses
for delete to authenticated using (public.is_budget_family_user(family_id));

drop policy if exists "budget_incomes_read" on public.budget_incomes;
create policy "budget_incomes_read" on public.budget_incomes
for select to authenticated using (public.is_budget_family_user(family_id));

drop policy if exists "budget_incomes_insert" on public.budget_incomes;
create policy "budget_incomes_insert" on public.budget_incomes
for insert to authenticated with check (public.is_budget_family_user(family_id) and created_by = auth.uid());

drop policy if exists "budget_incomes_update" on public.budget_incomes;
create policy "budget_incomes_update" on public.budget_incomes
for update to authenticated using (public.is_budget_family_user(family_id)) with check (public.is_budget_family_user(family_id));

drop policy if exists "budget_incomes_delete" on public.budget_incomes;
create policy "budget_incomes_delete" on public.budget_incomes
for delete to authenticated using (public.is_budget_family_user(family_id));

drop policy if exists "budget_invites_owner_read" on public.budget_invites;
create policy "budget_invites_owner_read" on public.budget_invites
for select to authenticated using (
  public.is_budget_family_user(family_id)
  or lower(invited_email) = lower(auth.email())
);

drop policy if exists "budget_invites_owner_insert" on public.budget_invites;
create policy "budget_invites_owner_insert" on public.budget_invites
for insert to authenticated with check (
  inviter_id = auth.uid()
  and exists (
    select 1 from public.budget_families f
    where f.id = family_id and f.owner_id = auth.uid()
  )
);

drop policy if exists "budget_invites_owner_update" on public.budget_invites;
create policy "budget_invites_owner_update" on public.budget_invites
for update to authenticated using (
  public.is_budget_family_user(family_id)
  or lower(invited_email) = lower(auth.email())
) with check (
  status in ('PENDING', 'ACCEPTED', 'EXPIRED')
);
