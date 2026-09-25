-- V1.20 hotfix: keep the student test list from hanging on a recursive/expensive RLS path.
-- Production Course 3 Plus was hotfixed first; this file keeps the fork migration history aligned.

create or replace function public.student_list_tests_v120()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_uid;

  if not found
     or v_profile.role <> 'student'
     or coalesce(v_profile.is_active, true) = false then
    raise exception 'Student unavailable';
  end if;

  return coalesce((
    select jsonb_agg(x.obj order by x.created_at desc)
    from (
      select
        t.created_at,
        jsonb_build_object(
          'id', t.id,
          'title', t.title,
          'description', t.description,
          'duration_minutes', t.duration_minutes,
          'max_attempts', t.max_attempts,
          'status', t.status,
          'opens_at', t.opens_at,
          'closes_at', t.closes_at,
          'test_kind', t.test_kind,
          'class_names', coalesce((
            select jsonb_agg(c.name order by c.name)
            from public.test_classes tc2
            join public.classes c on c.id = tc2.class_id
            join public.class_members cm2 on cm2.class_id = tc2.class_id
            where tc2.test_id = t.id
              and cm2.user_id = v_uid
          ), '[]'::jsonb)
        ) as obj
      from public.tests t
      where t.status = 'published'
        and t.archived_at is null
        and exists (
          select 1
          from public.test_classes tc
          join public.class_members cm on cm.class_id = tc.class_id
          where tc.test_id = t.id
            and cm.user_id = v_uid
        )
    ) x
  ), '[]'::jsonb);
end
$$;

revoke all on function public.student_list_tests_v120() from public, anon;
grant execute on function public.student_list_tests_v120() to authenticated;

-- The browser currently reads public.tests directly on the student dashboard.
-- Keep this policy simple: membership only. Active/role checks remain enforced
-- by the app route guard and start_attempt; the RPC above also checks both.
drop policy if exists students_read_assigned_published_tests on public.tests;

create policy students_read_assigned_published_tests
on public.tests
for select
to authenticated
using (
  status = 'published'
  and exists (
    select 1
    from public.test_classes tc
    join public.class_members cm on cm.class_id = tc.class_id
    where tc.test_id = tests.id
      and cm.user_id = (select auth.uid())
  )
);
