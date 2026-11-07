-- Student self-service profile editing with a server-enforced matric change cooldown.
alter table public.students
  add column if not exists matric_changed_at timestamptz;

create or replace function public.update_my_student_profile(
  p_full_name text,
  p_matric_no text
)
returns public.students
language plpgsql
security definer
set search_path = public, auth
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

revoke all on function public.update_my_student_profile(text, text) from public, anon;
grant execute on function public.update_my_student_profile(text, text) to authenticated;
