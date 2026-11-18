-- Fix false-positive GPS spoof detection.
-- Coordinate proximity is not proof of spoofing: genuine phones may return
-- the same rounded location. Passkey/device checks, accuracy validation,
-- rate limiting and the server-side attendance geofence remain enforced.
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

  if p_accuracy is null or p_accuracy <= 0 or p_accuracy > 250 then
    raise exception 'LOW_ACCURACY';
  end if;

  v_distance := distance_m(v_session.lat, v_session.lng, p_lat, p_lng);

  -- Coordinate proximity is not proof of spoofing. Genuine devices can
  -- report identical or near-identical GPS fixes, especially indoors.
  -- Keep validation based on valid coordinates, reported accuracy, the
  -- server-side geofence, registered-device binding and one-time passkey proof.

  if v_distance - least(p_accuracy, 25) > v_session.radius_m then
    raise exception 'OUT_OF_RANGE' using detail = round(v_distance)::text;
  end if;

  insert into attendance (session_id, student_id, distance_m, accuracy_m, lat, lng, webauthn_sig)
  values (v_session.id, v_student.id, v_distance, p_accuracy, p_lat, p_lng, v_sig)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.check_in(uuid, float8, float8, float8, text, text, text, text) from public, anon;
grant execute on function public.check_in(uuid, float8, float8, float8, text, text, text, text) to authenticated;
