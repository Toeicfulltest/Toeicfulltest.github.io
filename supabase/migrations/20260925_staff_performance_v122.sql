-- V1.22 staff performance hardening.
-- This migration does not change student exam workflow or stored attempt data.

create index if not exists authoring_drafts_test_id_idx on public.authoring_drafts(test_id);
create index if not exists profiles_class_id_idx on public.profiles(class_id);

-- Cache auth/current-role lookups once per statement in RLS policies.
drop policy if exists profile_self_or_staff_read on public.profiles;
create policy profile_self_or_staff_read on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or (select public.current_role()) = any(array['teacher'::public.app_role,'system_admin'::public.app_role])
);

drop policy if exists student_read_own_memberships on public.class_members;
create policy student_read_own_memberships on public.class_members
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists staff_manage_class_members on public.class_members;
create policy staff_manage_class_members on public.class_members
for all to authenticated
using ((select public.current_role()) = any(array['teacher'::public.app_role,'system_admin'::public.app_role]))
with check ((select public.current_role()) = any(array['teacher'::public.app_role,'system_admin'::public.app_role]));

drop policy if exists student_read_own_attempts on public.attempts;
create policy student_read_own_attempts on public.attempts
for select to authenticated
using (student_id = (select auth.uid()));

drop policy if exists staff_read_attempts on public.attempts;
create policy staff_read_attempts on public.attempts
for select to authenticated
using ((select public.current_role()) = any(array['teacher'::public.app_role,'system_admin'::public.app_role]));

drop policy if exists student_read_own_attempt_questions on public.attempt_questions;
create policy student_read_own_attempt_questions on public.attempt_questions
for select to authenticated
using (exists (
  select 1 from public.attempts a
  where a.id=attempt_questions.attempt_id and a.student_id=(select auth.uid())
));

drop policy if exists staff_read_attempt_questions on public.attempt_questions;
create policy staff_read_attempt_questions on public.attempt_questions
for select to authenticated
using ((select public.current_role()) = any(array['teacher'::public.app_role,'system_admin'::public.app_role]));

drop policy if exists student_read_own_answers on public.answers;
create policy student_read_own_answers on public.answers
for select to authenticated
using (exists (
  select 1 from public.attempts a
  where a.id=answers.attempt_id and a.student_id=(select auth.uid())
));

drop policy if exists staff_read_answers on public.answers;
create policy staff_read_answers on public.answers
for select to authenticated
using ((select public.current_role()) = any(array['teacher'::public.app_role,'system_admin'::public.app_role]));

drop policy if exists student_read_own_anti_cheat on public.anti_cheat_events;
create policy student_read_own_anti_cheat on public.anti_cheat_events
for select to authenticated
using (exists (
  select 1 from public.attempts a
  where a.id=anti_cheat_events.attempt_id and a.student_id=(select auth.uid())
));

drop policy if exists staff_read_anti_cheat on public.anti_cheat_events;
create policy staff_read_anti_cheat on public.anti_cheat_events
for select to authenticated
using ((select public.current_role()) = any(array['teacher'::public.app_role,'system_admin'::public.app_role]));

drop policy if exists authoring_drafts_own on public.authoring_drafts;
create policy authoring_drafts_own on public.authoring_drafts
for all to authenticated
using (
  user_id=(select auth.uid())
  and (select public.current_role()) = any(array['teacher'::public.app_role,'system_admin'::public.app_role])
)
with check (
  user_id=(select auth.uid())
  and (select public.current_role()) = any(array['teacher'::public.app_role,'system_admin'::public.app_role])
);

create or replace function public.staff_get_test_workspace_v122(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test public.tests%rowtype;
  v_test_json jsonb;
  v_question_count int;
  v_static_count int;
begin
  if (select public.current_role()) not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;

  select * into v_test from public.tests where id=p_test_id;
  if not found then raise exception 'Test not found'; end if;

  select count(*)::int into v_question_count
  from public.questions q
  join public.test_parts tp on tp.id=q.test_part_id
  where tp.test_id=p_test_id;

  select count(*)::int into v_static_count
  from (
    select s.storage_path
    from public.stimuli s
    join public.stimulus_groups sg on sg.id=s.stimulus_group_id
    join public.test_parts tp on tp.id=sg.test_part_id
    where tp.test_id=p_test_id
    union all
    select q.storage_path
    from public.questions q
    join public.test_parts tp on tp.id=q.test_part_id
    where tp.test_id=p_test_id
    union all
    select qc.storage_path
    from public.question_choices qc
    join public.questions q on q.id=qc.question_id
    join public.test_parts tp on tp.id=q.test_part_id
    where tp.test_id=p_test_id
  ) m
  where coalesce(m.storage_path,'') like 'static:%';

  v_test_json:=to_jsonb(v_test) || jsonb_build_object(
    'class_ids',coalesce((
      select jsonb_agg(tc.class_id order by c.name,c.id)
      from public.test_classes tc join public.classes c on c.id=tc.class_id
      where tc.test_id=p_test_id
    ),'[]'::jsonb),
    'class_names',coalesce((
      select jsonb_agg(c.name order by c.name,c.id)
      from public.test_classes tc join public.classes c on c.id=tc.class_id
      where tc.test_id=p_test_id
    ),'[]'::jsonb)
  );

  return jsonb_build_object(
    'test',v_test_json,
    'question_count',v_question_count,
    'static_media_count',v_static_count,
    'parts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',tp.id,'test_id',tp.test_id,'part_no',tp.part_no,'title',tp.title,
        'shuffle_mode',tp.shuffle_mode,'sort_order',tp.sort_order,'shuffle_choices',tp.shuffle_choices,
        'directions',tp.directions,'question_count',coalesce(qc.question_count,0)
      ) order by tp.sort_order,tp.part_no)
      from public.test_parts tp
      left join (
        select q.test_part_id,count(*)::int question_count
        from public.questions q group by q.test_part_id
      ) qc on qc.test_part_id=tp.id
      where tp.test_id=p_test_id
    ),'[]'::jsonb),
    'all_classes',coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name,c.id)
      from public.classes c
    ),'[]'::jsonb)
  );
end;
$$;

revoke execute on function public.staff_get_test_workspace_v122(uuid) from public, anon;
grant execute on function public.staff_get_test_workspace_v122(uuid) to authenticated;

create or replace function public.staff_get_test_live_v122(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test public.tests%rowtype;
  v_question_count int;
begin
  if (select public.current_role()) not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  select * into v_test from public.tests where id=p_test_id;
  if not found then raise exception 'Test not found'; end if;

  select count(*)::int into v_question_count
  from public.questions q join public.test_parts tp on tp.id=q.test_part_id
  where tp.test_id=p_test_id;

  return jsonb_build_object(
    'test',jsonb_build_object('id',v_test.id,'title',v_test.title,'status',v_test.status,'duration_minutes',v_test.duration_minutes,'max_attempts',v_test.max_attempts),
    'total_questions',v_question_count,
    'classes',coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name,c.id)
      from public.test_classes tc join public.classes c on c.id=tc.class_id
      where tc.test_id=p_test_id
    ),'[]'::jsonb),
    'roster_count',(
      select count(distinct cm.user_id)
      from public.test_classes tc
      join public.class_members cm on cm.class_id=tc.class_id
      join public.profiles p on p.id=cm.user_id
      where tc.test_id=p_test_id and p.role='student' and coalesce(p.is_active,true)=true
    ),
    'attempt_count',(select count(*) from public.attempts a where a.test_id=p_test_id and a.status<>'reset'),
    'rows',coalesce((
      with roster as materialized (
        select p.id,p.full_name,p.student_code,
          array_agg(distinct tc.class_id order by tc.class_id) class_ids,
          array_agg(distinct c.name order by c.name) class_names
        from public.test_classes tc
        join public.classes c on c.id=tc.class_id
        join public.class_members cm on cm.class_id=tc.class_id
        join public.profiles p on p.id=cm.user_id
        where tc.test_id=p_test_id and p.role='student' and coalesce(p.is_active,true)=true
        group by p.id,p.full_name,p.student_code
      ),
      attempts_for_test as materialized (
        select a.*,
          count(*) over(partition by a.student_id) attempts_used,
          row_number() over(partition by a.student_id order by (a.status='in_progress') desc,a.attempt_no desc) rn
        from public.attempts a
        where a.test_id=p_test_id and a.status<>'reset'
      ),
      answer_counts as materialized (
        select an.attempt_id,count(*)::int answered_count
        from public.answers an
        join attempts_for_test af on af.id=an.attempt_id
        group by an.attempt_id
      )
      select jsonb_agg(jsonb_build_object(
        'student_id',r.id,'full_name',r.full_name,'student_code',r.student_code,
        'class_ids',r.class_ids,'class_names',r.class_names,
        'attempt_id',a.id,'attempt_no',a.attempt_no,'attempt_class_id',a.class_id,
        'status',a.status,'started_at',a.started_at,'expires_at',a.expires_at,
        'submitted_at',a.submitted_at,'score',a.score,'correct_count',a.correct_count,
        'violation_count',coalesce(a.violation_count,0),
        'answered_count',coalesce(ac.answered_count,0),
        'attempts_used',coalesce(a.attempts_used,0)
      ) order by r.full_name,r.student_code)
      from roster r
      left join attempts_for_test a on a.student_id=r.id and a.rn=1
      left join answer_counts ac on ac.attempt_id=a.id
    ),'[]'::jsonb)
  );
end;
$$;

revoke execute on function public.staff_get_test_live_v122(uuid) from public, anon;
grant execute on function public.staff_get_test_live_v122(uuid) to authenticated;
