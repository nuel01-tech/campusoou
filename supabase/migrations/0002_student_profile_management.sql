-- Student self-service profile editing with a server-enforced matric change cooldown
-- and direct server-side permanent student credential setup/update (zero SMTP / confirmation lockouts).

alter table public.students
  add column if not exists matric_changed_at timestamptz;

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

-- Upgrades an anonymous claimed student account to a permanent email/password
-- login (or updates email/password on an existing student login) directly inside
-- auth.users & auth.identities while preserving the exact auth.uid() user ID.
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

revoke all on function public.update_my_student_profile(text, text) from public, anon;
grant execute on function public.update_my_student_profile(text, text) to authenticated;

revoke all on function public.save_student_credentials(text, text) from public, anon;
grant execute on function public.save_student_credentials(text, text) to authenticated;
