-- =============================================================================
-- CampusPulse — database schema (idempotent: safe to run on a new or existing DB)
--
-- Run this in the Supabase SQL Editor.
--
-- Roles & account model
--   * Super Admin: the master account created during initial setup. Only the
--     Super Admin can create, suspend, or remove Class Rep accounts.
--   * Class Rep: created by the Super Admin. Signs in with email + password,
--     imports student rosters, runs GPS sessions, and exports attendance.
--   * Student: signs in anonymously and claims a roster row. The claim binds
--     that row to the phone's anonymous auth user.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create or replace function public.normalize_matric(p text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p, ''), '\s+', '', 'g'));
$$;

-- Turns "OKAFOR,  Chinedu-John " into {okafor,chinedu,john}
create or replace function public.name_tokens(p text)
returns text[]
language sql
immutable
as $$
  select coalesce(
    array_remove(
      regexp_split_to_array(
        trim(lower(regexp_replace(coalesce(p, ''), '[^[:alpha:]]+', ' ', 'g'))),
        '\s+'
      ),
      ''
    ),
    '{}'
  );
$$;

-- A typed name matches a roster name when every typed word is in the roster
-- name and at least two words match (or all words, for single-word names).
-- Word order does not matter: "Chinedu Okafor" matches "OKAFOR Chinedu John".
create or replace function public.names_match(p_roster text, p_typed text)
returns boolean
language sql
immutable
as $$
  with r as (select public.name_tokens(p_roster) as t),
       u as (select public.name_tokens(p_typed)  as t)
  select cardinality(u.t) > 0
     and u.t <@ r.t
     and cardinality(array(select distinct unnest(u.t)))
         >= least(2, cardinality(array(select distinct unnest(r.t))))
  from r, u;
$$;

-- Great-circle distance in metres.
create or replace function public.distance_m(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8
language sql
immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

create or replace function public.random_join_code()
returns text
language sql
volatile
as $$
  -- No 0/O/1/I to avoid confusion when read aloud or written on a board.
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6);
$$;

-- -----------------------------------------------------------------------------
-- Profiles (Super Admin & Class Reps) + Pre-authorized Rep Signups
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text not null check (char_length(trim(full_name)) between 2 and 120),
  role        text not null check (role in ('super_admin', 'rep')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.authorized_reps (
  email       text primary key,
  full_name   text not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'super_admin' and active = true
  );
$$;

create or replace function public.is_active_rep()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('rep', 'super_admin') and active = true
  );
$$;

-- Gatekeeper on auth.users:
--   1. Anonymous sign-ins (students) are always allowed.
--   2. If no super_admin exists yet, the very first email/password sign-up is
--      allowed and auto-confirmed as the Super Admin.
--   3. After that, email/password sign-ups are ONLY allowed if the Super Admin
--      pre-authorized the email in `public.authorized_reps`.
create or replace function public.handle_before_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
begin
  if coalesce(new.is_anonymous, false) = true then
    return new;
  end if;

  if not exists (select 1 from public.profiles where role = 'super_admin') then
    new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
    return new;
  end if;

  if exists (select 1 from public.authorized_reps where email = v_email) then
    new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
    return new;
  end if;

  raise exception 'SIGNUP_NOT_ALLOWED';
end;
$$;

drop trigger if exists on_auth_user_before_created on auth.users;
create trigger on_auth_user_before_created
before insert on auth.users
for each row execute function public.handle_before_user_created();

create or replace function public.handle_after_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
  v_auth  public.authorized_reps;
  v_name  text;
begin
  if coalesce(new.is_anonymous, false) = true then
    return new;
  end if;

  if not exists (select 1 from public.profiles where role = 'super_admin') then
    v_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(v_email, '@', 1));
    if char_length(v_name) < 2 then
      v_name := 'Super Admin';
    end if;
    insert into public.profiles (id, email, full_name, role)
    values (new.id, v_email, v_name, 'super_admin')
    on conflict (id) do nothing;
    return new;
  end if;

  select * into v_auth from public.authorized_reps where email = v_email;
  if found then
    insert into public.profiles (id, email, full_name, role)
    values (new.id, v_email, v_auth.full_name, 'rep')
    on conflict (id) do nothing;
    delete from public.authorized_reps where email = v_email;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_after_created on auth.users;
create trigger on_auth_user_after_created
after insert on auth.users
for each row execute function public.handle_after_user_created();

-- Backfill: if an email/password user was created before this migration ran and
-- no super_admin exists yet, promote that user to super_admin automatically.
do $$
declare
  v_first record;
begin
  if not exists (select 1 from public.profiles where role = 'super_admin') then
    select id, lower(trim(email)) as email, raw_user_meta_data
      into v_first
      from auth.users
     where coalesce(is_anonymous, false) = false
       and email is not null
     order by created_at asc
     limit 1;

    if found then
      update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where id = v_first.id;
      insert into public.profiles (id, email, full_name, role)
      values (
        v_first.id,
        v_first.email,
        coalesce(nullif(trim(v_first.raw_user_meta_data ->> 'full_name'), ''), split_part(v_first.email, '@', 1), 'Super Admin'),
        'super_admin'
      )
      on conflict (id) do update set role = 'super_admin', active = true;
    end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Domain Tables
-- -----------------------------------------------------------------------------

create table if not exists public.classes (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null check (char_length(trim(name)) between 2 and 120),
  join_code       text not null unique default public.random_join_code(),
  semester_start  date,
  created_at      timestamptz not null default now()
);
create index if not exists classes_owner_idx on public.classes (owner_id);

create table if not exists public.students (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes (id) on delete cascade,
  full_name   text not null check (char_length(trim(full_name)) between 2 and 160),
  matric_no   text not null check (char_length(matric_no) between 2 and 40),
  user_id     uuid unique references auth.users (id) on delete set null,
  claimed_at  timestamptz,
  suspended   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (class_id, matric_no)
);
alter table public.students add column if not exists suspended boolean not null default false;
create index if not exists students_class_idx on public.students (class_id);

create table if not exists public.sessions (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.classes (id) on delete cascade,
  course_code  text not null check (char_length(trim(course_code)) between 2 and 20),
  venue        text not null check (char_length(trim(venue)) between 1 and 120),
  lat          float8 not null check (lat between -90 and 90),
  lng          float8 not null check (lng between -180 and 180),
  radius_m     int not null check (radius_m between 10 and 2000),
  week         int not null check (week between 1 and 52),
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz not null,
  created_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists sessions_class_idx on public.sessions (class_id, starts_at desc);

create table if not exists public.attendance (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.sessions (id) on delete cascade,
  student_id     uuid not null references public.students (id) on delete cascade,
  checked_in_at  timestamptz not null default now(),
  distance_m     float8,
  accuracy_m     float8,
  manual         boolean not null default false,
  unique (session_id, student_id)
);
create index if not exists attendance_student_idx on public.attendance (student_id);

-- Keep stored values normalised regardless of how the client sends them.
create or replace function public.students_normalize()
returns trigger
language plpgsql
as $$
begin
  new.matric_no := public.normalize_matric(new.matric_no);
  new.full_name := regexp_replace(trim(new.full_name), '\s+', ' ', 'g');
  return new;
end;
$$;

drop trigger if exists students_normalize_trg on public.students;
create trigger students_normalize_trg
before insert or update of matric_no, full_name on public.students
for each row execute function public.students_normalize();

create or replace function public.sessions_normalize()
returns trigger
language plpgsql
as $$
begin
  new.course_code := upper(regexp_replace(trim(new.course_code), '\s+', ' ', 'g'));
  new.venue := trim(new.venue);
  return new;
end;
$$;

drop trigger if exists sessions_normalize_trg on public.sessions;
create trigger sessions_normalize_trg
before insert or update of course_code, venue on public.sessions
for each row execute function public.sessions_normalize();

-- -----------------------------------------------------------------------------
-- Ownership helpers (SECURITY DEFINER avoids recursive RLS evaluation)
-- -----------------------------------------------------------------------------

create or replace function public.is_class_owner(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_rep()
     and exists (select 1 from classes where id = p_class_id and owner_id = auth.uid());
$$;

create or replace function public.my_student_class_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select class_id from students where user_id = auth.uid() limit 1;
$$;

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.authorized_reps enable row level security;
alter table public.classes         enable row level security;
alter table public.students        enable row level security;
alter table public.sessions        enable row level security;
alter table public.attendance      enable row level security;

-- profiles
drop policy if exists profiles_self_or_admin_read on public.profiles;
create policy profiles_self_or_admin_read on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_super_admin());

-- authorized_reps
drop policy if exists authorized_reps_admin_all on public.authorized_reps;
create policy authorized_reps_admin_all on public.authorized_reps
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- classes
drop policy if exists classes_owner_all on public.classes;
create policy classes_owner_all on public.classes
  for all to authenticated
  using (owner_id = auth.uid() and public.is_active_rep())
  with check (owner_id = auth.uid() and public.is_active_rep());

drop policy if exists classes_student_read on public.classes;
create policy classes_student_read on public.classes
  for select to authenticated
  using (id = public.my_student_class_id());

-- students
drop policy if exists students_owner_all on public.students;
create policy students_owner_all on public.students
  for all to authenticated
  using (public.is_class_owner(class_id))
  with check (public.is_class_owner(class_id));

drop policy if exists students_self_read on public.students;
create policy students_self_read on public.students
  for select to authenticated
  using (user_id = auth.uid());

-- sessions
drop policy if exists sessions_owner_all on public.sessions;
create policy sessions_owner_all on public.sessions
  for all to authenticated
  using (public.is_class_owner(class_id))
  with check (public.is_class_owner(class_id));

drop policy if exists sessions_student_read on public.sessions;
create policy sessions_student_read on public.sessions
  for select to authenticated
  using (class_id = public.my_student_class_id());

-- attendance (students never write directly; see check_in())
drop policy if exists attendance_owner_read on public.attendance;
create policy attendance_owner_read on public.attendance
  for select to authenticated
  using (exists (select 1 from sessions s where s.id = session_id and public.is_class_owner(s.class_id)));

drop policy if exists attendance_owner_insert on public.attendance;
create policy attendance_owner_insert on public.attendance
  for insert to authenticated
  with check (exists (select 1 from sessions s where s.id = session_id and public.is_class_owner(s.class_id)));

drop policy if exists attendance_owner_delete on public.attendance;
create policy attendance_owner_delete on public.attendance
  for delete to authenticated
  using (exists (select 1 from sessions s where s.id = session_id and public.is_class_owner(s.class_id)));

drop policy if exists attendance_self_read on public.attendance;
create policy attendance_self_read on public.attendance
  for select to authenticated
  using (exists (select 1 from students st where st.id = student_id and st.user_id = auth.uid()));

-- -----------------------------------------------------------------------------
-- RPC: Super Admin management & setup
-- -----------------------------------------------------------------------------

create or replace function public.has_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where role = 'super_admin');
$$;

-- If no super_admin exists in profiles yet, promotes the currently signed-in
-- non-anonymous user to super_admin. Safe recovery if a user was created before
-- the trigger existed.
create or replace function public.ensure_first_super_admin(p_full_name text default null)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_name  text;
  v_row   public.profiles;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_row from public.profiles where id = v_uid;
  if found then
    return v_row;
  end if;

  if exists (select 1 from public.profiles where role = 'super_admin') then
    raise exception 'SIGNUP_NOT_ALLOWED';
  end if;

  select lower(trim(email)) into v_email from auth.users where id = v_uid and coalesce(is_anonymous, false) = false;
  if v_email is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  v_name := coalesce(nullif(trim(p_full_name), ''), split_part(v_email, '@', 1), 'Super Admin');
  if char_length(v_name) < 2 then
    v_name := 'Super Admin';
  end if;

  insert into public.profiles (id, email, full_name, role, active)
  values (v_uid, v_email, v_name, 'super_admin', true)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.pre_authorize_rep(p_email text, p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name  text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
begin
  if not public.is_super_admin() then
    raise exception 'PERMISSION';
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'INVALID_EMAIL';
  end if;

  if char_length(v_name) < 2 then
    raise exception 'INVALID_NAME';
  end if;

  if exists (select 1 from profiles where email = v_email) then
    raise exception 'REP_EXISTS';
  end if;

  insert into authorized_reps (email, full_name, created_by)
  values (v_email, v_name, auth.uid())
  on conflict (email) do update set full_name = excluded.full_name;
end;
$$;

create or replace function public.list_reps()
returns table (
  id            uuid,
  email         text,
  full_name     text,
  active        boolean,
  created_at    timestamptz,
  class_count   bigint,
  student_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'PERMISSION';
  end if;

  return query
  select
    p.id,
    p.email,
    p.full_name,
    p.active,
    p.created_at,
    count(distinct c.id) as class_count,
    count(st.id) as student_count
  from profiles p
  left join classes c on c.owner_id = p.id
  left join students st on st.class_id = c.id
  where p.role = 'rep'
  group by p.id
  order by p.created_at desc;
end;
$$;

create or replace function public.set_rep_active(p_rep_id uuid, p_active boolean)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row profiles;
begin
  if not public.is_super_admin() then
    raise exception 'PERMISSION';
  end if;

  update profiles
     set active = p_active
   where id = p_rep_id and role = 'rep'
  returning * into v_row;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  return v_row;
end;
$$;

create or replace function public.delete_rep(p_rep_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_super_admin() then
    raise exception 'PERMISSION';
  end if;

  if not exists (select 1 from public.profiles where id = p_rep_id and role = 'rep') then
    raise exception 'NOT_FOUND';
  end if;

  delete from auth.users where id = p_rep_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: Keep-alive ping (prevents Supabase free tier from pausing after 7 days)
-- -----------------------------------------------------------------------------

create or replace function public.ping()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'ok'::text from (select count(*) from public.profiles) _;
$$;

-- -----------------------------------------------------------------------------
-- RPC: public class lookup for the join page
-- -----------------------------------------------------------------------------

create or replace function public.get_class_by_code(p_code text)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name from classes c where c.join_code = upper(trim(p_code));
$$;

-- -----------------------------------------------------------------------------
-- RPC: student claims their roster entry
-- -----------------------------------------------------------------------------

create or replace function public.claim_student(p_code text, p_matric text, p_name text)
returns public.students
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_class   classes;
  v_student students;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_class from classes where join_code = upper(trim(p_code));
  if not found then
    raise exception 'CLASS_NOT_FOUND';
  end if;

  if exists (select 1 from profiles where id = v_uid) then
    raise exception 'REP_CANNOT_CLAIM';
  end if;

  -- This device already holds a claim.
  select * into v_student from students where user_id = v_uid;
  if found then
    if v_student.class_id = v_class.id and v_student.matric_no = normalize_matric(p_matric) then
      return v_student;
    end if;
    raise exception 'DEVICE_ALREADY_CLAIMED';
  end if;

  select * into v_student
  from students
  where class_id = v_class.id and matric_no = normalize_matric(p_matric)
  for update;

  if not found then
    raise exception 'MATRIC_NOT_FOUND';
  end if;

  if v_student.user_id is not null then
    raise exception 'ALREADY_CLAIMED';
  end if;

  if not names_match(v_student.full_name, p_name) then
    raise exception 'NAME_MISMATCH';
  end if;

  update students
     set user_id = v_uid, claimed_at = now()
   where id = v_student.id
  returning * into v_student;

  return v_student;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: student checks in to an open session
-- -----------------------------------------------------------------------------

create or replace function public.check_in(
  p_session_id uuid,
  p_lat        float8,
  p_lng        float8,
  p_accuracy   float8
)
returns public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_session  sessions;
  v_student  students;
  v_distance float8;
  v_row      attendance;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'INVALID_LOCATION';
  end if;

  select * into v_session from sessions where id = p_session_id;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  select * into v_student from students where user_id = v_uid and class_id = v_session.class_id;
  if not found then
    raise exception 'NOT_IN_CLASS';
  end if;

  if v_student.suspended = true then
    raise exception 'STUDENT_SUSPENDED';
  end if;

  if now() < v_session.starts_at then
    raise exception 'SESSION_NOT_STARTED';
  end if;
  if now() > v_session.ends_at then
    raise exception 'SESSION_CLOSED';
  end if;

  select * into v_row from attendance where session_id = v_session.id and student_id = v_student.id;
  if found then
    raise exception 'ALREADY_CHECKED_IN';
  end if;

  if p_accuracy is null or p_accuracy > 150 then
    raise exception 'LOW_ACCURACY';
  end if;

  v_distance := distance_m(v_session.lat, v_session.lng, p_lat, p_lng);

  if v_distance - least(p_accuracy, 25) > v_session.radius_m then
    raise exception 'OUT_OF_RANGE' using detail = round(v_distance)::text;
  end if;

  insert into attendance (session_id, student_id, distance_m, accuracy_m)
  values (v_session.id, v_student.id, v_distance, p_accuracy)
  returning * into v_row;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

revoke all on function public.claim_student(text, text, text) from public, anon;
revoke all on function public.check_in(uuid, float8, float8, float8) from public, anon;
revoke all on function public.pre_authorize_rep(text, text) from public, anon;
revoke all on function public.list_reps() from public, anon;
revoke all on function public.set_rep_active(uuid, boolean) from public, anon;
revoke all on function public.delete_rep(uuid) from public, anon;

grant execute on function public.ping() to anon, authenticated;
grant execute on function public.has_super_admin() to anon, authenticated;
grant execute on function public.ensure_first_super_admin(text) to authenticated;
grant execute on function public.get_class_by_code(text) to anon, authenticated;
grant execute on function public.claim_student(text, text, text) to authenticated;
grant execute on function public.check_in(uuid, float8, float8, float8) to authenticated;
grant execute on function public.pre_authorize_rep(text, text) to authenticated;
grant execute on function public.list_reps() to authenticated;
grant execute on function public.set_rep_active(uuid, boolean) to authenticated;
grant execute on function public.delete_rep(uuid) to authenticated;
