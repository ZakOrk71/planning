-- =====================================================================
--  ÉQUIPES / BRIGADES  —  à coller dans Supabase (SQL Editor → Run)
--  À exécuter APRÈS le SQL de base (table "plannings" du GUIDE-SUPABASE).
-- =====================================================================

-- 1) Tables
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  code       text unique not null,
  owner      uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.group_members (
  group_id     uuid references public.groups(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,
  display_name text,
  joined_at    timestamptz default now(),
  primary key (group_id, user_id)
);

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

-- 2) Fonctions d'aide (security definer = pas de récursion RLS)
create or replace function public.my_group_ids()
returns setof uuid language sql security definer stable set search_path = public as $$
  select group_id from public.group_members where user_id = auth.uid();
$$;

create or replace function public.shares_group(target uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from public.group_members m1
    join public.group_members m2 on m1.group_id = m2.group_id
    where m1.user_id = auth.uid() and m2.user_id = target
  );
$$;

-- 3) Règles de lecture
drop policy if exists "voir mes groupes" on public.groups;
create policy "voir mes groupes" on public.groups
  for select using (id in (select public.my_group_ids()));

drop policy if exists "voir membres de mes groupes" on public.group_members;
create policy "voir membres de mes groupes" on public.group_members
  for select using (group_id in (select public.my_group_ids()));

-- Lecture des plannings des membres de mes groupes (en plus de l'accès à mes propres données)
drop policy if exists "voir plannings du groupe" on public.plannings;
create policy "voir plannings du groupe" on public.plannings
  for select using (public.shares_group(user_id));

-- 4) Actions (créer / rejoindre / quitter)
create or replace function public.create_group(group_name text, display text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups; c text;
begin
  c := upper(substr(md5(random()::text), 1, 6));
  insert into public.groups(name, code, owner) values (group_name, c, auth.uid()) returning * into g;
  insert into public.group_members(group_id, user_id, display_name) values (g.id, auth.uid(), display);
  return g;
end; $$;

create or replace function public.join_group(join_code text, display text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  select * into g from public.groups where code = upper(join_code);
  if g.id is null then raise exception 'Code invalide'; end if;
  insert into public.group_members(group_id, user_id, display_name)
    values (g.id, auth.uid(), display)
    on conflict (group_id, user_id) do update set display_name = excluded.display_name;
  return g;
end; $$;

create or replace function public.leave_group(gid uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.group_members where group_id = gid and user_id = auth.uid();
$$;

-- 5) Autoriser l'exécution par les utilisateurs connectés
grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.join_group(text, text)   to authenticated;
grant execute on function public.leave_group(uuid)        to authenticated;
grant execute on function public.my_group_ids()           to authenticated;
grant execute on function public.shares_group(uuid)       to authenticated;
