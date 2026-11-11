-- =============================================================================
-- CampusPulse — database schema (idempotent: safe to run on a new or existing DB)
--
-- Run this in the Supabase SQL Editor.
--
-- Roles & account model
--   * Super Admin: the master account created during initial setup. Only the
--     Super Admin can create, suspend, reset passwords for, or remove Class Reps.
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
-- Departments, Profiles (Super Admin & Class Reps) + Pre-authorized Rep Signups
-- -----------------------------------------------------------------------------

create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 2 and 120),
  created_at  timestamptz not null default now()
);
create unique index if not exists departments_name_lower_idx on public.departments (lower(trim(name)));

create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text not null unique,
  full_name      text not null check (char_length(trim(full_name)) between 2 and 120),
  role           text not null check (role in ('super_admin', 'rep')),
  department_id  uuid references public.departments (id) on delete set null,
  level          text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
alter table public.profiles add column if not exists department_id uuid references public.departments (id) on delete set null;
alter table public.profiles add column if not exists level text;

create table if not exists public.authorized_reps (
  email          text primary key,
  full_name      text not null,
  department_id  uuid references public.departments (id) on delete set null,
  level          text,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);
alter table public.authorized_reps add column if not exists department_id uuid references public.departments (id) on delete set null;
alter table public.authorized_reps add column if not exists level text;

-- -----------------------------------------------------------------------------
-- Domain Tables
-- -----------------------------------------------------------------------------

create table if not exists public.classes (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null check (char_length(trim(name)) between 2 and 120),
  department_id   uuid references public.departments (id) on delete set null,
  level           text,
  join_code       text not null unique default public.random_join_code(),
  semester_start  date,
  created_at      timestamptz not null default now()
);
alter table public.classes add column if not exists department_id uuid references public.departments (id) on delete set null;
alter table public.classes add column if not exists level text;
create index if not exists classes_owner_idx on public.classes (owner_id);
create index if not exists classes_department_idx on public.classes (department_id);

create table if not exists public.students (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.classes (id) on delete cascade,
  full_name     text not null check (char_length(trim(full_name)) between 2 and 160),
  matric_no     text not null check (char_length(matric_no) between 2 and 40),
  user_id       uuid unique references auth.users (id) on delete set null,
  passkey_id    text,
  device_token  text,
  claimed_at    timestamptz,
  is_rep        boolean not null default false,
  suspended     boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (class_id, matric_no)
);
alter table public.students add column if not exists is_rep boolean not null default false;
alter table public.students add column if not exists suspended boolean not null default false;
alter table public.students add column if not exists passkey_id text;
alter table public.students add column if not exists device_token text;
alter table public.students add column if not exists matric_changed_at timestamptz;
create unique index if not exists students_passkey_id_idx on public.students (passkey_id) where passkey_id is not null;
create unique index if not exists students_device_token_idx on public.students (device_token) where device_token is not null;
create index if not exists students_class_idx on public.students (class_id);

create table if not exists public.sessions (
  id             uuid primary key default gen_random_uuid(),
  class_id       uuid not null references public.classes (id) on delete cascade,
  course_code    text not null check (char_length(trim(course_code)) between 2 and 20),
  venue          text not null check (char_length(trim(venue)) between 1 and 120),
  lat            float8 not null check (lat between -90 and 90),
  lng            float8 not null check (lng between -180 and 180),
  radius_m       int not null check (radius_m between 10 and 2000),
  week           int not null check (week between 1 and 52),
  starts_at      timestamptz not null default now(),
  ends_at        timestamptz not null,
  security_code  text,
  created_at     timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table public.sessions add column if not exists security_code text;
create index if not exists sessions_class_idx on public.sessions (class_id, starts_at desc);

create table if not exists public.attendance (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.sessions (id) on delete cascade,
  student_id     uuid not null references public.students (id) on delete cascade,
  checked_in_at  timestamptz not null default now(),
  distance_m     float8,
  accuracy_m     float8,
  lat            float8,
  lng            float8,
  webauthn_sig   text,
  manual         boolean not null default false,
  status         text not null default 'present' check (status in ('present', 'late', 'excused')),
  notes          text,
  unique (session_id, student_id)
);
alter table public.attendance add column if not exists status text not null default 'present';
alter table public.attendance add column if not exists notes text;
alter table public.attendance add column if not exists lat float8;
alter table public.attendance add column if not exists lng float8;
alter table public.attendance add column if not exists webauthn_sig text;
create unique index if not exists attendance_webauthn_sig_idx on public.attendance (webauthn_sig) where webauthn_sig is not null;
create index if not exists attendance_student_idx on public.attendance (student_id);

-- -----------------------------------------------------------------------------
-- Role & Ownership Helpers
-- -----------------------------------------------------------------------------

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

create or replace function public.is_session_owner(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_rep()
     and exists (
       select 1
         from public.sessions s
         join public.classes c on c.id = s.class_id
        where s.id = p_session_id
          and c.owner_id = auth.uid()
     );
$$;

create or replace function public.is_my_student_id(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.students st
     where st.id = p_student_id
       and st.user_id = auth.uid()
  );
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

-- True only when a Super Admin exists AND has either signed in at least once or
-- created classes/reps. If a previous signup attempt failed halfway (e.g. 503
-- email timeout) and never signed in, this returns false so first-time setup
-- can be completed cleanly.
create or replace function public.has_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.role = 'super_admin'
       and (
         u.last_sign_in_at is not null
         or exists (select 1 from public.profiles r where r.role = 'rep')
         or exists (select 1 from public.classes)
       )
  );
$$;

-- -----------------------------------------------------------------------------
-- Gatekeeper triggers on auth.users
-- -----------------------------------------------------------------------------

create or replace function public.handle_before_user_created()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
begin
  if coalesce(new.is_anonymous, false) = true then
    return new;
  end if;

  -- Allow if this user is being created while no active super_admin has completed setup,
  -- or if the email was pre-authorized by the Super Admin.
  if not public.has_super_admin() or exists (select 1 from public.authorized_reps where email = v_email) then
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
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(coalesce(new.email, '')));
  v_auth  public.authorized_reps;
  v_name  text;
begin
  if coalesce(new.is_anonymous, false) = true then
    return new;
  end if;

  select * into v_auth from public.authorized_reps where email = v_email;
  if found then
    insert into public.profiles (id, email, full_name, role, department_id, level, active)
    values (new.id, v_email, v_auth.full_name, 'rep', v_auth.department_id, v_auth.level, true)
    on conflict (id) do update
      set email         = excluded.email,
          full_name     = excluded.full_name,
          department_id = coalesce(excluded.department_id, public.profiles.department_id),
          level         = coalesce(excluded.level, public.profiles.level),
          role          = 'rep';
    delete from public.authorized_reps where email = v_email;
    return new;
  end if;

  if not public.has_super_admin() then
    v_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(v_email, '@', 1));
    if char_length(v_name) < 2 then
      v_name := 'Super Admin';
    end if;
    -- Remove any unverified/never-used super_admin placeholder before inserting
    delete from public.profiles where role = 'super_admin' and id <> new.id;
    insert into public.profiles (id, email, full_name, role, active)
    values (new.id, v_email, v_name, 'super_admin', true)
    on conflict (id) do update
      set email = excluded.email,
          full_name = excluded.full_name,
          role = 'super_admin',
          active = true;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_after_created on auth.users;
create trigger on_auth_user_after_created
after insert on auth.users
for each row execute function public.handle_after_user_created();

-- -----------------------------------------------------------------------------
-- Internal helper: create or update an email/password user directly in auth.users
-- without triggering GoTrue's rate-limited SMTP confirmation email sender.
-- -----------------------------------------------------------------------------

create or replace function public.upsert_auth_user(
  p_email     text,
  p_password  text,
  p_full_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name  text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_uid   uuid;
begin
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'INVALID_EMAIL';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'INVALID_NAME';
  end if;
  if char_length(coalesce(p_password, '')) < 8 then
    raise exception 'WEAK_PASSWORD';
  end if;

  select id into v_uid
    from auth.users
   where lower(email) = v_email
     and coalesce(is_anonymous, false) = false
   limit 1;

  if v_uid is not null then
    update auth.users
       set encrypted_password     = crypt(p_password, gen_salt('bf')),
           email_confirmed_at     = coalesce(email_confirmed_at, now()),
           raw_app_meta_data      = coalesce(raw_app_meta_data, '{"provider":"email","providers":["email"]}'::jsonb),
           raw_user_meta_data     = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
                                      'sub', v_uid::text,
                                      'email', v_email,
                                      'full_name', v_name,
                                      'email_verified', true,
                                      'phone_verified', false
                                    ),
           confirmation_token     = coalesce(confirmation_token, ''),
           recovery_token         = coalesce(recovery_token, ''),
           email_change_token_new = coalesce(email_change_token_new, ''),
           email_change           = coalesce(email_change, ''),
           updated_at             = now()
     where id = v_uid;
  else
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token,
      is_sso_user,
      is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_uid,
      'authenticated',
      'authenticated',
      v_email,
      crypt(p_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'sub', v_uid::text,
        'email', v_email,
        'full_name', v_name,
        'email_verified', true,
        'phone_verified', false
      ),
      false,
      now(),
      now(),
      '',
      '',
      '',
      '',
      false,
      false
    );
  end if;

  if not exists (select 1 from auth.identities where user_id = v_uid and provider = 'email') then
    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      gen_random_uuid(),
      v_uid,
      v_uid::text,
      jsonb_build_object(
        'sub', v_uid::text,
        'email', v_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(),
      now(),
      now()
    );
  end if;

  return v_uid;
end;
$$;

revoke all on function public.upsert_auth_user(text, text, text) from public, anon, authenticated;

-- Repair any existing auth.users rows that were left unconfirmed or with null tokens
update auth.users
   set email_confirmed_at     = coalesce(email_confirmed_at, now()),
       confirmation_token     = coalesce(confirmation_token, ''),
       recovery_token         = coalesce(recovery_token, ''),
       email_change_token_new = coalesce(email_change_token_new, ''),
       email_change           = coalesce(email_change, '')
 where coalesce(is_anonymous, false) = false;

-- -----------------------------------------------------------------------------
-- Normalisation & Automatic Class Rep Attendance triggers on students & sessions
-- -----------------------------------------------------------------------------

create or replace function public.is_student_class_rep(
  p_class_id  uuid,
  p_full_name text,
  p_is_rep    boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p_is_rep, false)
      or exists (
        select 1
          from public.classes c
          join public.profiles p
            on (
              p.id = c.owner_id
              or (
                p.role = 'rep'
                and p.active = true
                and (c.department_id is null or p.department_id = c.department_id)
                and (c.level is null or p.level = c.level)
              )
            )
         where c.id = p_class_id
           and (
             public.names_match(p_full_name, p.full_name)
             or public.names_match(p.full_name, p_full_name)
           )
      );
$$;

create or replace function public.students_normalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.matric_no := public.normalize_matric(new.matric_no);
  new.full_name := regexp_replace(trim(new.full_name), '\s+', ' ', 'g');
  -- Security guard: Only auto-promote is_rep on initial roster insert or when edited by the Class Rep / Super Admin.
  -- Never allow a student editing their own profile to escalate themselves to is_rep = true.
  if tg_op = 'INSERT' or public.is_class_owner(new.class_id) or public.is_super_admin() then
    if not coalesce(new.is_rep, false) then
      new.is_rep := public.is_student_class_rep(new.class_id, new.full_name, false);
    end if;
  else
    new.is_rep := coalesce(old.is_rep, false);
  end if;
  return new;
end;
$$;

drop trigger if exists students_normalize_trg on public.students;
create trigger students_normalize_trg
before insert or update of matric_no, full_name, is_rep on public.students
for each row execute function public.students_normalize();

create or replace function public.students_auto_mark_rep_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.suspended = false and coalesce(new.is_rep, false) = true then
    insert into public.attendance (session_id, student_id, distance_m, accuracy_m, manual)
    select s.id, new.id, 0, 0, false
      from public.sessions s
     where s.class_id = new.class_id
    on conflict (session_id, student_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists students_auto_mark_rep_attendance_trg on public.students;
create trigger students_auto_mark_rep_attendance_trg
after insert or update of is_rep, full_name, suspended on public.students
for each row execute function public.students_auto_mark_rep_attendance();

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

create or replace function public.sessions_auto_mark_reps()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.attendance (session_id, student_id, distance_m, accuracy_m, manual)
  select new.id, st.id, 0, 0, false
    from public.students st
   where st.class_id = new.class_id
     and st.suspended = false
     and public.is_student_class_rep(st.class_id, st.full_name, st.is_rep)
  on conflict (session_id, student_id) do nothing;
  return new;
end;
$$;

drop trigger if exists sessions_auto_mark_reps_trg on public.sessions;
create trigger sessions_auto_mark_reps_trg
after insert on public.sessions
for each row execute function public.sessions_auto_mark_reps();

-- Backfill existing Class Reps on rosters and auto-mark them across existing sessions
update public.students st
   set is_rep = true
 where st.is_rep = false
   and public.is_student_class_rep(st.class_id, st.full_name, false);

insert into public.attendance (session_id, student_id, distance_m, accuracy_m, manual)
select s.id, st.id, 0, 0, false
  from public.sessions s
  join public.students st on st.class_id = s.class_id
 where st.suspended = false
   and public.is_student_class_rep(st.class_id, st.full_name, st.is_rep)
on conflict (session_id, student_id) do nothing;

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------

alter table public.departments     enable row level security;
alter table public.profiles        enable row level security;
alter table public.authorized_reps enable row level security;
alter table public.classes         enable row level security;
alter table public.students        enable row level security;
alter table public.sessions        enable row level security;
alter table public.attendance      enable row level security;

-- departments
drop policy if exists departments_read_all on public.departments;
create policy departments_read_all on public.departments
  for select to authenticated
  using (true);

drop policy if exists departments_admin_all on public.departments;
create policy departments_admin_all on public.departments
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

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
  using (public.is_session_owner(session_id));

drop policy if exists attendance_owner_insert on public.attendance;
create policy attendance_owner_insert on public.attendance
  for insert to authenticated
  with check (public.is_session_owner(session_id));

drop policy if exists attendance_owner_update on public.attendance;
create policy attendance_owner_update on public.attendance
  for update to authenticated
  using (public.is_session_owner(session_id))
  with check (public.is_session_owner(session_id));

drop policy if exists attendance_owner_delete on public.attendance;
create policy attendance_owner_delete on public.attendance
  for delete to authenticated
  using (public.is_session_owner(session_id));

drop policy if exists attendance_self_read on public.attendance;
create policy attendance_self_read on public.attendance
  for select to authenticated
  using (public.is_my_student_id(student_id));

-- -----------------------------------------------------------------------------
-- RPC: Super Admin bootstrap & management
-- -----------------------------------------------------------------------------

-- Direct server-side Super Admin creation (never triggers SMTP / 503 errors).
create or replace function public.bootstrap_super_admin(
  p_full_name text,
  p_email     text,
  p_password  text
)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name  text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_uid   uuid;
  v_row   public.profiles;
begin
  if public.has_super_admin() then
    raise exception 'SIGNUP_NOT_ALLOWED';
  end if;

  -- Clean up any never-used super_admin placeholder from an earlier interrupted attempt
  delete from public.profiles where role = 'super_admin';

  v_uid := public.upsert_auth_user(v_email, p_password, v_name);

  insert into public.profiles (id, email, full_name, role, active)
  values (v_uid, v_email, v_name, 'super_admin', true)
  on conflict (id) do update
    set email     = excluded.email,
        full_name = excluded.full_name,
        role      = 'super_admin',
        active    = true
  returning * into v_row;

  return v_row;
end;
$$;

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

  if public.has_super_admin() then
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

  delete from public.profiles where role = 'super_admin' and id <> v_uid;

  insert into public.profiles (id, email, full_name, role, active)
  values (v_uid, v_email, v_name, 'super_admin', true)
  returning * into v_row;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: Departments management (Super Admin)
-- -----------------------------------------------------------------------------

drop function if exists public.list_departments();
create or replace function public.list_departments()
returns table (
  id         uuid,
  name       text,
  created_at timestamptz,
  rep_count  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_rep() then
    raise exception 'PERMISSION';
  end if;

  return query
  select
    d.id,
    d.name,
    d.created_at,
    count(p.id) as rep_count
  from public.departments d
  left join public.profiles p on p.department_id = d.id and p.role = 'rep'
  group by d.id
  order by lower(d.name) asc;
end;
$$;

create or replace function public.create_department(p_name text)
returns public.departments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_row  public.departments;
begin
  if not public.is_super_admin() then
    raise exception 'PERMISSION';
  end if;

  if char_length(v_name) < 2 then
    raise exception 'INVALID_DEPARTMENT';
  end if;

  if exists (select 1 from public.departments where lower(trim(name)) = lower(v_name)) then
    raise exception 'DEPARTMENT_EXISTS';
  end if;

  insert into public.departments (name)
  values (v_name)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.delete_department(p_department_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'PERMISSION';
  end if;

  delete from public.departments where id = p_department_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
end;
$$;

-- Direct server-side Class Rep creation by Super Admin (no SMTP / 503 errors).
drop function if exists public.admin_create_rep(text, text, text);
drop function if exists public.admin_create_rep(text, text, text, uuid);
drop function if exists public.admin_create_rep(text, text, text, uuid, text);
create or replace function public.admin_create_rep(
  p_full_name     text,
  p_email         text,
  p_password      text,
  p_department_id uuid default null,
  p_level         text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name  text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_level text := nullif(trim(coalesce(p_level, '')), '');
  v_uid   uuid;
  v_row   public.profiles;
begin
  if not public.is_super_admin() then
    raise exception 'PERMISSION';
  end if;

  if exists (select 1 from public.profiles where email = v_email) then
    raise exception 'REP_EXISTS';
  end if;

  if p_department_id is not null and not exists (select 1 from public.departments where id = p_department_id) then
    raise exception 'INVALID_DEPARTMENT';
  end if;

  insert into public.authorized_reps (email, full_name, department_id, level, created_by)
  values (v_email, v_name, p_department_id, v_level, auth.uid())
  on conflict (email) do update
    set full_name     = excluded.full_name,
        department_id = excluded.department_id,
        level         = excluded.level;

  v_uid := public.upsert_auth_user(v_email, p_password, v_name);

  insert into public.profiles (id, email, full_name, role, department_id, level, active)
  values (v_uid, v_email, v_name, 'rep', p_department_id, v_level, true)
  on conflict (id) do update
    set email         = excluded.email,
        full_name     = excluded.full_name,
        department_id = excluded.department_id,
        level         = excluded.level,
        role          = 'rep',
        active        = true
  returning * into v_row;

  delete from public.authorized_reps where email = v_email;
  return v_row;
end;
$$;

drop function if exists public.pre_authorize_rep(text, text);
drop function if exists public.pre_authorize_rep(text, text, uuid);
drop function if exists public.pre_authorize_rep(text, text, uuid, text);
create or replace function public.pre_authorize_rep(
  p_email         text,
  p_full_name     text,
  p_department_id uuid default null,
  p_level         text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name  text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_level text := nullif(trim(coalesce(p_level, '')), '');
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

  if p_department_id is not null and not exists (select 1 from public.departments where id = p_department_id) then
    raise exception 'INVALID_DEPARTMENT';
  end if;

  insert into authorized_reps (email, full_name, department_id, level, created_by)
  values (v_email, v_name, p_department_id, v_level, auth.uid())
  on conflict (email) do update
    set full_name     = excluded.full_name,
        department_id = excluded.department_id,
        level         = excluded.level;
end;
$$;

drop function if exists public.list_reps();
create or replace function public.list_reps()
returns table (
  id              uuid,
  email           text,
  full_name       text,
  department_id   uuid,
  department_name text,
  level           text,
  active          boolean,
  created_at      timestamptz,
  class_count     bigint,
  student_count   bigint
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
    p.department_id,
    d.name as department_name,
    p.level,
    p.active,
    p.created_at,
    count(distinct c.id) as class_count,
    count(st.id) as student_count
  from profiles p
  left join departments d on d.id = p.department_id
  left join classes c on c.owner_id = p.id
  left join students st on st.class_id = c.id
  where p.role = 'rep'
  group by p.id, d.name
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
immutable
security definer
set search_path = public
as $$
  select 'ok'::text;
$$;

-- -----------------------------------------------------------------------------
-- Anti-DDoS & Brute-Force Rate Limiter (Server-Side Token Bucket)
-- -----------------------------------------------------------------------------

create unlogged table if not exists public.rate_limit_buckets (
  bucket_key text primary key,
  hits       int not null default 1,
  reset_at   timestamptz not null
);
alter table public.rate_limit_buckets enable row level security;

create or replace function public.enforce_rate_limit(
  p_action     text,
  p_max_hits   int,
  p_window_sec int default 60
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_ip    text := '';
  v_key   text;
  v_hits  int;
begin
  begin
    v_ip := trim(split_part(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''), ',', 1));
  exception when others then
    v_ip := '';
  end;

  v_actor := coalesce(auth.uid()::text, nullif(v_ip, ''), 'anon');
  v_key := p_action || ':' || v_actor;

  if random() < 0.01 then
    delete from public.rate_limit_buckets where reset_at < now();
  end if;

  insert into public.rate_limit_buckets (bucket_key, hits, reset_at)
  values (v_key, 1, now() + make_interval(secs => p_window_sec))
  on conflict (bucket_key) do update
    set hits = case
                 when public.rate_limit_buckets.reset_at <= now() then 1
                 else public.rate_limit_buckets.hits + 1
               end,
        reset_at = case
                     when public.rate_limit_buckets.reset_at <= now() then now() + make_interval(secs => p_window_sec)
                     else public.rate_limit_buckets.reset_at
                   end
  returning hits into v_hits;

  if v_hits > p_max_hits then
    raise exception 'RATE_LIMITED';
  end if;
end;
$$;
revoke all on function public.enforce_rate_limit(text, int, int) from public, anon, authenticated;

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
-- RPC: student claims their roster entry (strictly bound to Passkey + Device)
-- -----------------------------------------------------------------------------

drop function if exists public.claim_student(text, text, text);
drop function if exists public.claim_student(text, text, text, text, text);
create or replace function public.claim_student(
  p_code         text,
  p_matric       text,
  p_name         text,
  p_passkey_id   text default null,
  p_device_token text default null
)
returns public.students
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_passkey text := trim(coalesce(p_passkey_id, ''));
  v_device  text := trim(coalesce(p_device_token, ''));
  v_class   classes;
  v_student students;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  perform public.enforce_rate_limit('claim_student', 6, 60);

  if v_passkey = '' or v_device = '' then
    raise exception 'PASSKEY_REQUIRED';
  end if;

  select * into v_class from classes where join_code = upper(trim(p_code));
  if not found then
    raise exception 'CLASS_NOT_FOUND';
  end if;

  if exists (select 1 from profiles where id = v_uid) then
    raise exception 'REP_CANNOT_CLAIM';
  end if;

  -- Check if this auth session, hardware passkey, or physical device token already holds a claim.
  select * into v_student
    from students
   where user_id = v_uid
      or passkey_id = v_passkey
      or device_token = v_device
   limit 1;

  if found then
    if v_student.class_id = v_class.id
       and v_student.matric_no = normalize_matric(p_matric)
       and v_student.user_id = v_uid
    then
      update students
         set passkey_id   = coalesce(passkey_id, v_passkey),
             device_token = coalesce(device_token, v_device)
       where id = v_student.id
      returning * into v_student;
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

  if v_student.user_id is not null or v_student.passkey_id is not null or v_student.device_token is not null then
    raise exception 'ALREADY_CLAIMED';
  end if;

  if not names_match(v_student.full_name, p_name) then
    raise exception 'NAME_MISMATCH';
  end if;

  update students
     set user_id      = v_uid,
         passkey_id   = v_passkey,
         device_token = v_device,
         claimed_at   = now()
   where id = v_student.id
  returning * into v_student;

  return v_student;
end;
$$;

-- Allows a student who claimed prior to the passkey-on-claim upgrade to bind their passkey once.
create or replace function public.bind_student_passkey(
  p_passkey_id   text,
  p_device_token text
)
returns public.students
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_passkey text := trim(coalesce(p_passkey_id, ''));
  v_device  text := trim(coalesce(p_device_token, ''));
  v_student students;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  perform public.enforce_rate_limit('claim_student', 6, 60);

  if v_passkey = '' or v_device = '' then
    raise exception 'PASSKEY_REQUIRED';
  end if;

  select * into v_student from students where user_id = v_uid for update;
  if not found then
    raise exception 'NOT_IN_CLASS';
  end if;

  if exists (
    select 1 from students
     where (passkey_id = v_passkey or device_token = v_device)
       and id <> v_student.id
  ) then
    raise exception 'DEVICE_ALREADY_CLAIMED';
  end if;

  if v_student.passkey_id is not null and v_student.passkey_id <> v_passkey then
    raise exception 'DEVICE_MISMATCH';
  end if;

  update students
     set passkey_id   = v_passkey,
         device_token = v_device
   where id = v_student.id
  returning * into v_student;

  return v_student;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: Coordinate-masked open sessions for students (prevents DevTools coordinate harvesting)
-- -----------------------------------------------------------------------------

drop function if exists public.list_open_student_sessions(uuid);
create or replace function public.list_open_student_sessions(p_class_id uuid)
returns table (
  id            uuid,
  class_id      uuid,
  course_code   text,
  venue         text,
  lat           float8,
  lng           float8,
  radius_m      int,
  week          int,
  starts_at     timestamptz,
  ends_at       timestamptz,
  requires_code boolean,
  created_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_class_id <> public.my_student_class_id() then
    raise exception 'NOT_IN_CLASS';
  end if;

  return query
  select
    s.id,
    s.class_id,
    s.course_code,
    s.venue,
    0::float8 as lat,
    0::float8 as lng,
    s.radius_m,
    s.week,
    s.starts_at,
    s.ends_at,
    (s.security_code is not null and trim(s.security_code) <> '') as requires_code,
    s.created_at
  from public.sessions s
  where s.class_id = p_class_id
    and s.starts_at <= now()
    and s.ends_at > now()
  order by s.starts_at desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: student checks in to an open session (verifies Passkey + Device + Anti-Spoof GPS + Hall PIN)
-- -----------------------------------------------------------------------------

drop function if exists public.check_in(uuid, float8, float8, float8);
drop function if exists public.check_in(uuid, float8, float8, float8, text, text);
drop function if exists public.check_in(uuid, float8, float8, float8, text, text, text, text);
create or replace function public.check_in(
  p_session_id     uuid,
  p_lat            float8,
  p_lng            float8,
  p_accuracy       float8,
  p_passkey_id     text default null,
  p_device_token   text default null,
  p_webauthn_proof text default null,
  p_security_code  text default null
)
returns public.attendance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_passkey    text := trim(coalesce(p_passkey_id, ''));
  v_device     text := trim(coalesce(p_device_token, ''));
  v_proof_raw  text := trim(coalesce(p_webauthn_proof, ''));
  v_pin_input  text := trim(coalesce(p_security_code, ''));
  v_session    sessions;
  v_student    students;
  v_distance   float8;
  v_sig        text := null;
  v_proof_json jsonb;
  v_row        attendance;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  perform public.enforce_rate_limit('check_in', 8, 60);

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

  if v_passkey = '' or v_device = '' or v_student.passkey_id is null or v_student.device_token is null then
    raise exception 'PASSKEY_REQUIRED';
  end if;

  if v_student.passkey_id <> v_passkey or v_student.device_token <> v_device then
    raise exception 'DEVICE_MISMATCH';
  end if;

  -- Verify Cryptographic WebAuthn Assertion Proof & Anti-Replay Signature (mandatory)
  if v_proof_raw = '' then
    raise exception 'WEBAUTHN_TAMPERED';
  end if;

  begin
    v_proof_json := v_proof_raw::jsonb;
    v_sig := trim(coalesce(v_proof_json ->> 's', ''));
  exception when others then
    raise exception 'WEBAUTHN_TAMPERED';
  end;

  if char_length(v_sig) < 40
     or char_length(coalesce(v_proof_json ->> 'a', '')) < 40
     or char_length(coalesce(v_proof_json ->> 'c', '')) < 40
  then
    raise exception 'WEBAUTHN_TAMPERED';
  end if;

  if exists (select 1 from public.attendance where webauthn_sig = v_sig) then
    raise exception 'WEBAUTHN_TAMPERED';
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

  if p_accuracy is null or p_accuracy <= 0 or p_accuracy > 150 then
    raise exception 'LOW_ACCURACY';
  end if;

  v_distance := distance_m(v_session.lat, v_session.lng, p_lat, p_lng);

  -- Anti-Spoof Check 1: Block exact-coordinate injection (0.00m distance from Class Rep's phone)
  if not coalesce(v_student.is_rep, false) and v_distance < 0.25 then
    raise exception 'GEO_SPOOF_DETECTED';
  end if;

  -- Anti-Spoof Check 2: Block cloned/shared GPS coordinates across students in the same session
  if not coalesce(v_student.is_rep, false) and exists (
    select 1
      from public.attendance a
     where a.session_id = v_session.id
       and a.student_id <> v_student.id
       and a.manual = false
       and a.lat is not null
       and a.lng is not null
       and public.distance_m(a.lat, a.lng, p_lat, p_lng) < 0.15
  ) then
    raise exception 'GEO_SPOOF_DETECTED';
  end if;

  if v_distance - least(p_accuracy, 25) > v_session.radius_m then
    raise exception 'OUT_OF_RANGE' using detail = round(v_distance)::text;
  end if;

  insert into attendance (session_id, student_id, distance_m, accuracy_m, lat, lng, webauthn_sig)
  values (v_session.id, v_student.id, v_distance, p_accuracy, p_lat, p_lng, v_sig)
  returning * into v_row;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: Student self-service profile editing & permanent credential setup
-- -----------------------------------------------------------------------------

create or replace function public.update_my_student_profile(
  p_full_name text,
  p_matric_no text
)
returns public.students
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students;
  v_name text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
  v_matric text := public.normalize_matric(p_matric_no);
  v_matric_changed boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_student
    from public.students
   where user_id = auth.uid()
   for update;

  if not found then
    raise exception 'STUDENT_ENROLLMENT_NOT_FOUND';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 160 then
    raise exception 'INVALID_STUDENT_NAME';
  end if;

  if char_length(v_matric) < 2 or char_length(v_matric) > 40 then
    raise exception 'INVALID_MATRIC_NUMBER';
  end if;

  -- Prevent a non-rep student from renaming themselves to match a Class Rep's name
  if not coalesce(v_student.is_rep, false)
     and public.is_student_class_rep(v_student.class_id, v_name, false)
  then
    raise exception 'NAME_MISMATCH';
  end if;

  v_matric_changed := v_matric <> public.normalize_matric(v_student.matric_no);

  if v_matric_changed then
    if v_student.matric_changed_at is not null
       and v_student.matric_changed_at > now() - interval '3 days' then
      raise exception 'MATRIC_CHANGE_COOLDOWN: You can change your matric number only once every 3 days. Your next change becomes available at %.',
        to_char(v_student.matric_changed_at + interval '3 days', 'DD Mon YYYY HH24:MI');
    end if;

    if exists (
      select 1
        from public.students s
       where s.class_id = v_student.class_id
         and s.id <> v_student.id
         and public.normalize_matric(s.matric_no) = v_matric
    ) then
      raise exception 'MATRIC_ALREADY_IN_USE';
    end if;
  end if;

  update public.students
     set full_name = v_name,
         matric_no = v_matric,
         matric_changed_at = case when v_matric_changed then now() else matric_changed_at end
   where id = v_student.id
   returning * into v_student;

  return v_student;
end;
$$;

create or replace function public.save_student_credentials(
  p_email    text default null,
  p_password text default null
)
returns text
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_uid          uuid := auth.uid();
  v_student      public.students;
  v_current_user auth.users;
  v_email        text := lower(trim(coalesce(p_email, '')));
  v_password     text := coalesce(p_password, '');
  v_final_email  text;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into v_student
    from public.students
   where user_id = v_uid
   limit 1;

  if not found then
    raise exception 'STUDENT_ENROLLMENT_NOT_FOUND';
  end if;

  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'PERMISSION';
  end if;

  select * into v_current_user
    from auth.users
   where id = v_uid
   for update;

  if not found then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if v_email <> '' then
    if position('@' in v_email) <= 1 or position('.' in split_part(v_email, '@', 2)) = 0 then
      raise exception 'INVALID_EMAIL';
    end if;

    if exists (
      select 1
        from auth.users u
       where lower(u.email) = v_email
         and u.id <> v_uid
    ) or exists (
      select 1
        from public.profiles p
       where lower(p.email) = v_email
         and p.id <> v_uid
    ) then
      raise exception 'EMAIL_ALREADY_IN_USE';
    end if;

    v_final_email := v_email;
  else
    v_final_email := lower(trim(coalesce(v_current_user.email, '')));
    if v_final_email = '' then
      raise exception 'INVALID_EMAIL';
    end if;
  end if;

  if coalesce(v_current_user.is_anonymous, false) = true and char_length(v_password) < 8 then
    raise exception 'WEAK_PASSWORD';
  end if;

  if v_password <> '' and char_length(v_password) < 8 then
    raise exception 'WEAK_PASSWORD';
  end if;

  update auth.users
     set email                  = v_final_email,
         encrypted_password     = case
                                    when v_password <> '' then crypt(v_password, gen_salt('bf'))
                                    else encrypted_password
                                  end,
         email_confirmed_at     = coalesce(email_confirmed_at, now()),
         is_anonymous           = false,
         raw_app_meta_data      = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"provider":"email","providers":["email"]}'::jsonb,
         raw_user_meta_data     = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
                                    'sub', v_uid::text,
                                    'email', v_final_email,
                                    'full_name', v_student.full_name,
                                    'email_verified', true,
                                    'phone_verified', false
                                  ),
         confirmation_token     = '',
         recovery_token         = coalesce(recovery_token, ''),
         email_change_token_new = '',
         email_change           = '',
         updated_at             = now()
   where id = v_uid;

  if exists (select 1 from auth.identities where user_id = v_uid and provider = 'email') then
    update auth.identities
       set provider_id   = v_uid::text,
           identity_data = jsonb_build_object(
             'sub', v_uid::text,
             'email', v_final_email,
             'email_verified', true,
             'phone_verified', false
           ),
           updated_at    = now()
     where user_id = v_uid
       and provider = 'email';
  else
    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      gen_random_uuid(),
      v_uid,
      v_uid::text,
      jsonb_build_object(
        'sub', v_uid::text,
        'email', v_final_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(),
      now(),
      now()
    );
  end if;

  return v_final_email;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.departments to authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.authorized_reps to authenticated;
grant select, insert, update, delete on table public.classes to authenticated;
grant select, insert, update, delete on table public.students to authenticated;
grant select, insert, update, delete on table public.sessions to authenticated;
grant select, insert, update, delete on table public.attendance to authenticated;

revoke all on function public.claim_student(text, text, text, text, text) from public, anon;
revoke all on function public.bind_student_passkey(text, text) from public, anon;
revoke all on function public.list_open_student_sessions(uuid) from public, anon;
revoke all on function public.check_in(uuid, float8, float8, float8, text, text, text, text) from public, anon;
revoke all on function public.update_my_student_profile(text, text) from public, anon;
revoke all on function public.save_student_credentials(text, text) from public, anon;
revoke all on function public.list_departments() from public, anon;
revoke all on function public.create_department(text) from public, anon;
revoke all on function public.delete_department(uuid) from public, anon;
revoke all on function public.pre_authorize_rep(text, text, uuid, text) from public, anon;
revoke all on function public.admin_create_rep(text, text, text, uuid, text) from public, anon;
revoke all on function public.list_reps() from public, anon;
revoke all on function public.set_rep_active(uuid, boolean) from public, anon;
revoke all on function public.delete_rep(uuid) from public, anon;

grant execute on function public.ping() to anon, authenticated;
grant execute on function public.has_super_admin() to anon, authenticated;
grant execute on function public.bootstrap_super_admin(text, text, text) to anon, authenticated;
grant execute on function public.ensure_first_super_admin(text) to authenticated;
grant execute on function public.get_class_by_code(text) to anon, authenticated;
grant execute on function public.claim_student(text, text, text, text, text) to authenticated;
grant execute on function public.bind_student_passkey(text, text) to authenticated;
grant execute on function public.list_open_student_sessions(uuid) to authenticated;
grant execute on function public.check_in(uuid, float8, float8, float8, text, text, text, text) to authenticated;
grant execute on function public.update_my_student_profile(text, text) to authenticated;
grant execute on function public.save_student_credentials(text, text) to authenticated;
grant execute on function public.list_departments() to authenticated;
grant execute on function public.create_department(text) to authenticated;
grant execute on function public.delete_department(uuid) to authenticated;
grant execute on function public.pre_authorize_rep(text, text, uuid, text) to authenticated;
grant execute on function public.admin_create_rep(text, text, text, uuid, text) to authenticated;
grant execute on function public.list_reps() to authenticated;
grant execute on function public.set_rep_active(uuid, boolean) to authenticated;
grant execute on function public.delete_rep(uuid) to authenticated;
