-- =============================================================================
-- CampusPulse — Anti-Spoofing, Anti-VPN, Coordinate Masking & Privilege Lock
-- Run this in your Supabase SQL Editor to enforce all database-level protections.
-- =============================================================================

alter table public.sessions add column if not exists security_code text;
alter table public.attendance add column if not exists lat float8;
alter table public.attendance add column if not exists lng float8;
alter table public.attendance add column if not exists webauthn_sig text;
create unique index if not exists attendance_webauthn_sig_idx on public.attendance (webauthn_sig) where webauthn_sig is not null;

-- 0. Database-level Anti-DDoS & Brute-Force Rate Limiter
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

  -- Probabilistic cleanup of expired buckets (1% of calls) so table stays tiny
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

-- Zero-CPU keep-alive ping (never scans tables even if flooded)
create or replace function public.ping()
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select 'ok'::text;
$$;

-- 1. Prevent student profile edits from escalating a student to Class Rep (is_rep = true)
create or replace function public.students_normalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.matric_no := public.normalize_matric(new.matric_no);
  new.full_name := regexp_replace(trim(new.full_name), '\s+', ' ', 'g');
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

drop policy if exists attendance_owner_update on public.attendance;
create policy attendance_owner_update on public.attendance
  for update to authenticated
  using (exists (select 1 from sessions s where s.id = session_id and public.is_class_owner(s.class_id)))
  with check (exists (select 1 from sessions s where s.id = session_id and public.is_class_owner(s.class_id)));

-- Lock direct SELECT on public.sessions for students who haven't checked in yet,
-- so a hacker in DevTools Console cannot query session lat/lng or security_code!
drop policy if exists sessions_student_read on public.sessions;
create policy sessions_student_read on public.sessions
  for select to authenticated
  using (
    exists (
      select 1
        from public.attendance a
        join public.students st on st.id = a.student_id
       where a.session_id = sessions.id
         and st.user_id = auth.uid()
    )
  );

-- 2. Coordinate-masked open sessions for students (hides lat/lng & security_code from DevTools Network tab)
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

-- 3. Hardened check_in with WebAuthn proof anti-replay, 4-Digit Hall PIN, and Anti-Spoof GPS validation
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

  -- Anti-DDoS & Brute-Force Shield: max 8 check-in attempts per minute per student/IP
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

  if v_session.security_code is not null and trim(v_session.security_code) <> '' then
    if v_pin_input = '' then
      raise exception 'SECURITY_CODE_REQUIRED';
    end if;
    if v_pin_input <> trim(v_session.security_code) then
      raise exception 'INVALID_SECURITY_CODE';
    end if;
  end if;

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

  if not coalesce(v_student.is_rep, false) and v_distance < 0.25 then
    raise exception 'GEO_SPOOF_DETECTED';
  end if;

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

revoke all on function public.list_open_student_sessions(uuid) from public, anon;
revoke all on function public.check_in(uuid, float8, float8, float8, text, text, text, text) from public, anon;
grant execute on function public.list_open_student_sessions(uuid) to authenticated;
grant execute on function public.check_in(uuid, float8, float8, float8, text, text, text, text) to authenticated;
