-- Handover: database setup
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run more than once.

create extension if not exists pgcrypto;

-- One household per account. The account holder is the person who runs the home.
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null unique references auth.users(id) on delete cascade,
  owner_name  text not null check (char_length(owner_name) between 1 and 40),
  created_at  timestamptz not null default now()
);

-- Family members she hands tasks to. Each one gets an invite (token) and joins with their own account.
create table if not exists public.members (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 40),
  token           uuid not null unique default gen_random_uuid(),
  user_id         uuid unique references auth.users(id) on delete set null,
  joined_at       timestamptz,
  last_opened_at  timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.members add column if not exists user_id uuid unique references auth.users(id) on delete set null;
alter table public.members add column if not exists joined_at timestamptz;

create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  member_id     uuid references public.members(id) on delete set null,
  title         text not null check (char_length(title) between 1 and 80),
  how_to        text check (char_length(how_to) <= 600),
  where_is      text check (char_length(where_is) <= 300),
  photo_url     text check (char_length(photo_url) <= 500),
  due_at        timestamptz not null,
  first_due_at  timestamptz not null,
  status        text not null default 'open' check (status in ('open','done','cant','cancelled')),
  member_note   text check (char_length(member_note) <= 200),
  seen_at       timestamptz,
  done_at       timestamptz,
  done_by       text check (done_by in ('member','owner')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists tasks_household_idx on public.tasks (household_id, status, due_at);
create index if not exists tasks_member_idx on public.tasks (member_id, status);
create index if not exists members_household_idx on public.members (household_id);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

-- On sign-up: someone with an invite joins that household as a family member.
-- Everyone else gets their own household.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  invite text := new.raw_user_meta_data->>'invite';
begin
  if invite ~* '^[0-9a-f-]{36}$' then
    update public.members set user_id = new.id, joined_at = now()
      where token = invite::uuid and user_id is null;
    return new;
  end if;
  insert into public.households (owner_id, owner_name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), 'Me'), 40))
  on conflict (owner_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row level security: the account holder sees only her own household.
alter table public.households enable row level security;
alter table public.members    enable row level security;
alter table public.tasks      enable row level security;

create or replace function public.my_household() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.households where owner_id = auth.uid()
$$;

drop policy if exists households_owner on public.households;
create policy households_owner on public.households
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists members_owner on public.members;
create policy members_owner on public.members
  for all to authenticated
  using (household_id = public.my_household())
  with check (household_id = public.my_household());

drop policy if exists members_self on public.members;
create policy members_self on public.members
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists tasks_owner on public.tasks;
create policy tasks_owner on public.tasks
  for all to authenticated
  using (household_id = public.my_household())
  with check (
    household_id = public.my_household()
    and (member_id is null or exists (
      select 1 from public.members m
      where m.id = member_id and m.household_id = public.my_household()))
  );

-- Family members sign in with their own account. They can't write to tables directly:
-- they see and update only their own tasks, through the functions below.

-- Shown on the invite page before sign-up: who invited you, and under what name.
create or replace function public.invite_info(p_token uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('member_name', m.name, 'owner_name', h.owner_name, 'joined', m.user_id is not null)
  from public.members m join public.households h on h.id = m.household_id
  where m.token = p_token
$$;

-- For someone who already has an account and opens an invite.
create or replace function public.accept_invite(p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Log in first'; end if;
  if exists (select 1 from public.households where owner_id = auth.uid()) then
    raise exception 'This account already runs a home. Use a different email to join as family.';
  end if;
  if exists (select 1 from public.members where user_id = auth.uid() and token <> p_token) then
    raise exception 'This account has already joined another home.';
  end if;
  update public.members set user_id = auth.uid(), joined_at = coalesce(joined_at, now())
    where token = p_token and (user_id is null or user_id = auth.uid());
  if not found then raise exception 'This invite has already been used.'; end if;
end $$;

drop function if exists public.member_view(uuid);
drop function if exists public.member_update(uuid, uuid, text, text, int);

create or replace function public.my_tasks() returns json
language plpgsql security definer set search_path = public as $$
declare
  m public.members;
  h public.households;
  result json;
begin
  select * into m from public.members where user_id = auth.uid();
  if not found then
    return null;
  end if;
  select * into h from public.households where id = m.household_id;

  update public.members set last_opened_at = now() where id = m.id;
  update public.tasks set seen_at = now()
    where member_id = m.id and status = 'open' and seen_at is null;

  select json_build_object(
    'member', json_build_object('id', m.id, 'name', m.name),
    'owner_name', h.owner_name,
    'tasks', coalesce((
      select json_agg(t order by (t.status <> 'open'), t.due_at)
      from (
        select id, title, how_to, where_is, photo_url, due_at, first_due_at,
               status, member_note, done_at
        from public.tasks
        where member_id = m.id
          and (status in ('open','cant')
               or (status = 'done' and done_at > now() - interval '24 hours'))
      ) t), '[]'::json)
  ) into result;
  return result;
end $$;

create or replace function public.update_my_task(
  p_task_id uuid, p_action text, p_note text default null, p_minutes int default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  m public.members;
  t public.tasks;
  note text := nullif(left(trim(coalesce(p_note, '')), 200), '');
begin
  select * into m from public.members where user_id = auth.uid();
  if not found then
    raise exception 'You are not part of a home any more';
  end if;

  select * into t from public.tasks where id = p_task_id and member_id = m.id for update;
  if not found or t.status = 'cancelled' then
    raise exception 'This task is no longer assigned to you';
  end if;

  if p_action = 'done' then
    update public.tasks
      set status = 'done', done_at = now(), done_by = 'member'
      where id = t.id;
  elsif p_action = 'undo' then
    if t.status <> 'done' or t.done_at < now() - interval '15 minutes' then
      raise exception 'This can no longer be undone';
    end if;
    update public.tasks set status = 'open', done_at = null, done_by = null where id = t.id;
  elsif p_action = 'late' then
    if p_minutes is null or p_minutes < 15 or p_minutes > 480 then
      raise exception 'Pick a time between 15 minutes and 8 hours';
    end if;
    if t.status <> 'open' then
      raise exception 'This task is not open';
    end if;
    update public.tasks
      set due_at = greatest(t.due_at, now()) + make_interval(mins => p_minutes),
          member_note = coalesce(note, t.member_note)
      where id = t.id;
  elsif p_action = 'cant' then
    if note is null then
      raise exception 'Add a short reason so she knows what to do';
    end if;
    if t.status <> 'open' then
      raise exception 'This task is not open';
    end if;
    update public.tasks set status = 'cant', member_note = note where id = t.id;
  else
    raise exception 'Unknown action';
  end if;
end $$;

revoke all on function public.invite_info(uuid) from public;
revoke all on function public.accept_invite(uuid) from public;
revoke all on function public.my_tasks() from public;
revoke all on function public.update_my_task(uuid, text, text, int) from public;
grant execute on function public.invite_info(uuid) to anon, authenticated;
grant execute on function public.accept_invite(uuid) to authenticated;
grant execute on function public.my_tasks() to authenticated;
grant execute on function public.update_my_task(uuid, text, text, int) to authenticated;

-- Photos of where things are kept. Public bucket, file names are random.
-- Only a signed-in account holder can upload, and only into her own folder.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public)
      values ('task-photos', 'task-photos', true)
      on conflict (id) do nothing;

    drop policy if exists task_photos_insert on storage.objects;
    create policy task_photos_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'task-photos' and (storage.foldername(name))[1] = auth.uid()::text);

    drop policy if exists task_photos_delete on storage.objects;
    create policy task_photos_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'task-photos' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;

-- Live updates on her home screen when a family member marks something.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and tablename = 'tasks') then
    alter publication supabase_realtime add table public.tasks;
  end if;
end $$;
