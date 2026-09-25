-- V1.21 staff performance: lightweight submissions list for Admin/Teacher UI.
-- Intentionally does not change student exam, answer saving, timing, or anti-cheat RPCs.

create or replace function public.staff_get_test_submissions_v121(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test public.tests%rowtype;
  v_total_questions integer;
begin
  if public.current_role() not in ('teacher','system_admin') then
    raise exception 'Forbidden';
  end if;

  select * into v_test from public.tests where id=p_test_id;
  if not found then raise exception 'Test not found'; end if;

  select count(*)::integer into v_total_questions
  from public.questions q
  join public.test_parts tp on tp.id=q.test_part_id
  where tp.test_id=p_test_id;

  return jsonb_build_object(
    'test',jsonb_build_object('id',v_test.id,'title',v_test.title),
    'total_questions',coalesce(v_total_questions,0),
    'classes',coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name,c.id)
      from public.test_classes tc
      join public.classes c on c.id=tc.class_id
      where tc.test_id=p_test_id
    ),'[]'::jsonb),
    'students',coalesce((
      select jsonb_agg(x.obj order by x.full_name,x.student_code,x.attempt_no)
      from (
        select
          coalesce(p.full_name,'(Tài khoản không còn)') as full_name,
          p.student_code,
          a.attempt_no,
          jsonb_build_object(
            'student_id',a.student_id,
            'full_name',coalesce(p.full_name,'(Tài khoản không còn)'),
            'student_code',p.student_code,
            'attempt_id',a.id,
            'attempt_no',a.attempt_no,
            'class_id',a.class_id,
            'class_name',c.name,
            'status',a.status,
            'started_at',a.started_at,
            'expires_at',a.expires_at,
            'submitted_at',a.submitted_at,
            'score',a.score,
            'correct_count',a.correct_count,
            'violation_count',coalesce(a.violation_count,0),
            'submission_reason',a.submission_reason
          ) as obj
        from public.attempts a
        left join public.profiles p on p.id=a.student_id
        left join public.classes c on c.id=a.class_id
        where a.test_id=p_test_id and a.status<>'reset'
      ) x
    ),'[]'::jsonb)
  );
end
$$;

revoke execute on function public.staff_get_test_submissions_v121(uuid) from public;
revoke execute on function public.staff_get_test_submissions_v121(uuid) from anon;
grant execute on function public.staff_get_test_submissions_v121(uuid) to authenticated;
