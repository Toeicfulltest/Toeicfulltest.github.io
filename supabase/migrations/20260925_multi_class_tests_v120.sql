-- TOEIC Full Test V1.20: one test can be assigned to many classes.
-- tests.class_id stays as a legacy primary class for backwards compatibility.

create table if not exists public.test_classes (
  test_id uuid not null references public.tests(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (test_id,class_id)
);
create index if not exists test_classes_class_test_idx on public.test_classes(class_id,test_id);
alter table public.test_classes enable row level security;
revoke all on public.test_classes from anon;
grant select on public.test_classes to authenticated;
drop policy if exists test_classes_read on public.test_classes;
create policy test_classes_read on public.test_classes for select to authenticated using (
  public.current_role() in ('teacher','system_admin')
  or exists (
    select 1 from public.class_members cm
    where cm.class_id=test_classes.class_id and cm.user_id=(select auth.uid())
  )
);

insert into public.test_classes(test_id,class_id)
select id,class_id from public.tests where class_id is not null
on conflict do nothing;

alter table public.attempts
  add column if not exists class_id uuid references public.classes(id) on delete set null;
create index if not exists attempts_test_class_idx on public.attempts(test_id,class_id);
create index if not exists attempts_class_id_idx on public.attempts(class_id);
update public.attempts a set class_id=t.class_id
from public.tests t
where a.test_id=t.id and a.class_id is null and t.class_id is not null;

create or replace function public.sync_test_primary_class_v120()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare v_count int;
begin
  if tg_op='INSERT' then
    if new.class_id is not null then
      insert into public.test_classes(test_id,class_id) values(new.id,new.class_id)
      on conflict do nothing;
    end if;
    return new;
  end if;
  if old.class_id is distinct from new.class_id then
    select count(*)::int into v_count from public.test_classes tc where tc.test_id=new.id;
    if v_count<=1 then delete from public.test_classes where test_id=new.id; end if;
    if new.class_id is not null then
      insert into public.test_classes(test_id,class_id) values(new.id,new.class_id)
      on conflict do nothing;
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.sync_test_primary_class_v120() from public,anon,authenticated;
drop trigger if exists sync_test_primary_class_v120 on public.tests;
create trigger sync_test_primary_class_v120
after insert or update of class_id on public.tests
for each row execute function public.sync_test_primary_class_v120();

drop policy if exists students_read_assigned_published_tests on public.tests;
create policy students_read_assigned_published_tests
on public.tests for select to authenticated using (
  status='published'
  and exists (
    select 1
    from public.test_classes tc
    join public.class_members cm on cm.class_id=tc.class_id
    join public.profiles p on p.id=cm.user_id
    where tc.test_id=tests.id
      and cm.user_id=(select auth.uid())
      and p.role='student'
      and coalesce(p.is_active,true)=true
  )
);

create or replace function public.staff_upsert_test_v120(p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_id uuid:=nullif(p_data->>'id','')::uuid;
  v_old public.tests%rowtype;
  v_call jsonb:=coalesce(p_data,'{}'::jsonb)-'class_ids';
  v_class_ids uuid[]:='{}'::uuid[];
  v_old_class_ids uuid[]:='{}'::uuid[];
  v_first_class uuid;
  v_multi boolean:=coalesce(p_data?'class_ids',false);
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  if v_multi then
    select coalesce(array_agg(z.class_id order by z.ord),'{}'::uuid[])
    into v_class_ids
    from (
      select value::uuid class_id,min(ord)::bigint ord
      from jsonb_array_elements_text(coalesce(p_data->'class_ids','[]'::jsonb)) with ordinality e(value,ord)
      where nullif(value,'') is not null
      group by value
    ) z;
    v_first_class:=v_class_ids[1];
    if exists (
      select 1 from unnest(v_class_ids) x(class_id)
      left join public.classes c on c.id=x.class_id
      where c.id is null
    ) then raise exception 'Invalid class'; end if;
  end if;

  if v_id is null then
    if v_multi then v_call:=jsonb_set(v_call,'{class_id}',to_jsonb(coalesce(v_first_class::text,'')),true); end if;
    v_id:=public.staff_upsert_test(v_call);
    if v_multi then
      delete from public.test_classes where test_id=v_id;
      insert into public.test_classes(test_id,class_id)
      select v_id,x from unnest(v_class_ids) x on conflict do nothing;
      update public.tests set class_id=v_first_class where id=v_id;
    end if;
    return v_id;
  end if;

  select * into v_old from public.tests where id=v_id for update;
  if not found then raise exception 'Test not found'; end if;
  select coalesce(array_agg(tc.class_id order by tc.class_id),'{}'::uuid[])
  into v_old_class_ids from public.test_classes tc where tc.test_id=v_id;
  if cardinality(v_old_class_ids)=0 and v_old.class_id is not null then v_old_class_ids:=array[v_old.class_id]; end if;

  if v_multi then
    if v_old.content_locked_at is not null and exists (
      select 1 from unnest(v_old_class_ids) oldc(class_id)
      where not (oldc.class_id=any(v_class_ids))
        and exists (
          select 1 from public.attempts a
          where a.test_id=v_id and a.class_id=oldc.class_id and a.status<>'reset'
        )
    ) then raise exception 'Cannot remove a class that already has student attempts'; end if;

    if v_old.content_locked_at is null then
      if v_old.class_id is not null and v_old.class_id=any(v_class_ids) then v_first_class:=v_old.class_id;
      else v_first_class:=v_class_ids[1]; end if;
      v_call:=jsonb_set(v_call,'{class_id}',to_jsonb(coalesce(v_first_class::text,'')),true);
    else
      v_call:=v_call-'class_id';
    end if;
  end if;

  v_id:=public.staff_upsert_test(v_call);
  if v_multi then
    delete from public.test_classes tc
    where tc.test_id=v_id and not (tc.class_id=any(v_class_ids));
    insert into public.test_classes(test_id,class_id)
    select v_id,x from unnest(v_class_ids) x on conflict do nothing;
  end if;
  return v_id;
end
$$;

create or replace function public.staff_clone_test_v120(
  p_source_test_id uuid,
  p_overrides jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_new uuid;
  v_call jsonb:=coalesce(p_overrides,'{}'::jsonb)-'class_ids';
  v_class_ids uuid[]:='{}'::uuid[];
  v_first uuid;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  if p_overrides?'class_ids' then
    select coalesce(array_agg(z.class_id order by z.ord),'{}'::uuid[])
    into v_class_ids
    from (
      select value::uuid class_id,min(ord)::bigint ord
      from jsonb_array_elements_text(coalesce(p_overrides->'class_ids','[]'::jsonb)) with ordinality e(value,ord)
      where nullif(value,'') is not null
      group by value
    ) z;
    v_first:=v_class_ids[1];
    v_call:=jsonb_set(v_call,'{class_id}',to_jsonb(coalesce(v_first::text,'')),true);
  end if;
  v_new:=public.staff_clone_test_v118b(p_source_test_id,v_call);
  delete from public.test_classes where test_id=v_new;
  if p_overrides?'class_ids' then
    insert into public.test_classes(test_id,class_id)
    select v_new,x from unnest(v_class_ids) x on conflict do nothing;
    update public.tests set class_id=v_first where id=v_new;
  elsif p_overrides?'class_id' then
    insert into public.test_classes(test_id,class_id)
    select v_new,class_id from public.tests where id=v_new and class_id is not null
    on conflict do nothing;
  else
    insert into public.test_classes(test_id,class_id)
    select v_new,tc.class_id from public.test_classes tc where tc.test_id=p_source_test_id
    on conflict do nothing;
    update public.tests t set class_id=coalesce(
      (select s.class_id from public.tests s where s.id=p_source_test_id),
      (select tc.class_id from public.test_classes tc where tc.test_id=v_new order by tc.class_id limit 1)
    ) where t.id=v_new;
  end if;
  return v_new;
end
$$;

create or replace function public.get_test_authoring_v120(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_base jsonb; v_test jsonb;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  v_base:=public.get_test_authoring(p_test_id);
  v_test:=coalesce(v_base->'test','{}'::jsonb) || jsonb_build_object(
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
  return jsonb_set(v_base,'{test}',v_test,true);
end
$$;

create or replace function public.staff_preflight_test_v120(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_base jsonb; v_classes int; v_students int; v_ok boolean;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  v_base:=public.staff_preflight_test(p_test_id);
  select count(*)::int into v_classes from public.test_classes where test_id=p_test_id;
  select count(distinct p.id)::int into v_students
  from public.test_classes tc
  join public.class_members cm on cm.class_id=tc.class_id
  join public.profiles p on p.id=cm.user_id
  where tc.test_id=p_test_id and p.role='student' and coalesce(p.is_active,true)=true;
  v_ok:=v_classes>0
    and v_students>0
    and coalesce((v_base->>'question_count')::int,0)>0
    and coalesce((v_base->>'structure_complete')::boolean,false)
    and (coalesce(v_base->>'test_kind','reading')='reading' or coalesce((v_base->>'listening_audio_duration_ok')::boolean,true))
    and coalesce((v_base->>'missing_or_extra_choices')::int,0)=0
    and coalesce((v_base->>'invalid_correct_choice')::int,0)=0
    and not coalesce((v_base->>'schedule_invalid')::boolean,false);
  return v_base || jsonb_build_object(
    'ok',v_ok,'class_count',v_classes,'class_missing',(v_classes=0),
    'active_student_count',v_students,'class_empty',(v_students=0)
  );
end
$$;

create or replace function public.staff_get_test_live_v120(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare v_test public.tests%rowtype;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  select * into v_test from public.tests where id=p_test_id;
  if not found then raise exception 'Test not found'; end if;
  return jsonb_build_object(
    'test',jsonb_build_object('id',v_test.id,'title',v_test.title,'status',v_test.status,'duration_minutes',v_test.duration_minutes,'max_attempts',v_test.max_attempts),
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
      with roster as (
        select p.id,p.full_name,p.student_code,
          array_agg(distinct tc.class_id order by tc.class_id) class_ids,
          array_agg(distinct c.name order by c.name) class_names
        from public.test_classes tc
        join public.classes c on c.id=tc.class_id
        join public.class_members cm on cm.class_id=tc.class_id
        join public.profiles p on p.id=cm.user_id
        where tc.test_id=p_test_id and p.role='student' and coalesce(p.is_active,true)=true
        group by p.id,p.full_name,p.student_code
      )
      select jsonb_agg(jsonb_build_object(
        'student_id',r.id,'full_name',r.full_name,'student_code',r.student_code,
        'class_ids',r.class_ids,'class_names',r.class_names,
        'attempt_id',a.id,'attempt_no',a.attempt_no,'attempt_class_id',a.class_id,
        'status',a.status,'started_at',a.started_at,'expires_at',a.expires_at,
        'submitted_at',a.submitted_at,'score',a.score,'correct_count',a.correct_count,
        'violation_count',coalesce(a.violation_count,0),
        'answered_count',coalesce((select count(*) from public.answers an where an.attempt_id=a.id),0),
        'attempts_used',coalesce((select count(*) from public.attempts ax where ax.test_id=p_test_id and ax.student_id=r.id and ax.status<>'reset'),0)
      ) order by r.full_name,r.student_code)
      from roster r
      left join lateral (
        select ax.* from public.attempts ax
        where ax.test_id=p_test_id and ax.student_id=r.id and ax.status<>'reset'
        order by (ax.status='in_progress') desc,ax.attempt_no desc limit 1
      ) a on true
    ),'[]'::jsonb)
  );
end
$$;

create or replace function public.staff_get_test_export_v120(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_base jsonb; v_students jsonb; v_reset jsonb; v_roster jsonb; v_classes jsonb; v_test jsonb;
begin
  if public.current_role() not in ('teacher','system_admin') then raise exception 'Forbidden'; end if;
  v_base:=public.staff_get_test_export(p_test_id);
  select coalesce(jsonb_agg(s.elem || jsonb_build_object('class_id',a.class_id,'class_name',c.name) order by s.ord),'[]'::jsonb)
  into v_students
  from jsonb_array_elements(coalesce(v_base->'students','[]'::jsonb)) with ordinality s(elem,ord)
  left join public.attempts a on a.id=nullif(s.elem->>'attempt_id','')::uuid
  left join public.classes c on c.id=a.class_id;
  select coalesce(jsonb_agg(s.elem || jsonb_build_object('class_id',a.class_id,'class_name',c.name) order by s.ord),'[]'::jsonb)
  into v_reset
  from jsonb_array_elements(coalesce(v_base->'reset_history','[]'::jsonb)) with ordinality s(elem,ord)
  left join public.attempts a on a.id=nullif(s.elem->>'attempt_id','')::uuid
  left join public.classes c on c.id=a.class_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'student_id',x.id,'full_name',x.full_name,'student_code',x.student_code,
    'email',x.email,'is_active',x.is_active,'class_ids',x.class_ids,'class_names',x.class_names
  ) order by x.full_name,x.student_code),'[]'::jsonb)
  into v_roster
  from (
    select p.id,p.full_name,p.student_code,p.email,p.is_active,
      array_agg(distinct tc.class_id order by tc.class_id) class_ids,
      array_agg(distinct c.name order by c.name) class_names
    from public.test_classes tc
    join public.classes c on c.id=tc.class_id
    join public.class_members cm on cm.class_id=tc.class_id
    join public.profiles p on p.id=cm.user_id
    where tc.test_id=p_test_id and p.role='student'
    group by p.id,p.full_name,p.student_code,p.email,p.is_active
  ) x;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.name,c.id),'[]'::jsonb)
  into v_classes
  from public.test_classes tc join public.classes c on c.id=tc.class_id
  where tc.test_id=p_test_id;
  v_test:=coalesce(v_base->'test','{}'::jsonb) || jsonb_build_object(
    'class_ids',coalesce((select jsonb_agg(tc.class_id order by tc.class_id) from public.test_classes tc where tc.test_id=p_test_id),'[]'::jsonb)
  );
  return v_base || jsonb_build_object(
    'test',v_test,'classes',v_classes,'students',v_students,'reset_history',v_reset,'roster',v_roster
  );
end
$$;

create or replace function public.start_attempt(p_test_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_test public.tests%rowtype;
  v_class_id uuid;
  v_attempt_id uuid;
  v_exp timestamptz;
  v_existing public.attempts%rowtype;
  v_used int:=0;
  v_next_no int:=1;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from public.profiles p where p.id=v_uid and p.role='student' and coalesce(p.is_active,true)=true) then
    raise exception 'Tài khoản sinh viên đang bị khóa hoặc không hợp lệ';
  end if;
  select * into v_test
  from public.tests t
  where t.id=p_test_id and t.archived_at is null and t.status='published'
    and (t.opens_at is null or now()>=t.opens_at)
    and (t.closes_at is null or now()<=t.closes_at);
  if not found then raise exception 'Test is not available'; end if;
  select tc.class_id into v_class_id
  from public.test_classes tc
  join public.class_members cm on cm.class_id=tc.class_id
  where tc.test_id=p_test_id and cm.user_id=v_uid
  order by case when tc.class_id=v_test.class_id then 0 else 1 end,tc.class_id
  limit 1;
  if v_class_id is null then raise exception 'Test is not available'; end if;
  select * into v_existing from public.attempts
  where test_id=p_test_id and student_id=v_uid and status='in_progress'
  order by attempt_no desc limit 1;
  if found then return jsonb_build_object('attempt_id',v_existing.id,'existing',true,'attempt_no',v_existing.attempt_no,'expires_at',v_existing.expires_at); end if;
  select count(*)::int into v_used from public.attempts where test_id=p_test_id and student_id=v_uid and status<>'reset';
  select coalesce(max(attempt_no),0)+1 into v_next_no from public.attempts where test_id=p_test_id and student_id=v_uid;
  if v_used>=v_test.max_attempts then raise exception 'No attempts remaining'; end if;
  v_exp:=least(now()+make_interval(mins=>v_test.duration_minutes),coalesce(v_test.closes_at,'infinity'::timestamptz));
  insert into public.attempts(test_id,student_id,class_id,expires_at,attempt_no)
  values(p_test_id,v_uid,v_class_id,v_exp,v_next_no) returning id into v_attempt_id;
  update public.tests set content_locked_at=coalesce(content_locked_at,now()) where id=p_test_id;
  with base as (
    select q.id question_id,tp.part_no,tp.sort_order part_sort,q.source_order,tp.shuffle_mode,q.stimulus_group_id,
      case when tp.shuffle_mode='shuffle_questions' then md5(v_attempt_id::text||q.id::text)
           when tp.shuffle_mode='shuffle_stimulus_groups' then md5(v_attempt_id::text||coalesce(q.stimulus_group_id::text,q.id::text))
           else lpad(q.source_order::text,8,'0') end primary_key
    from public.questions q join public.test_parts tp on tp.id=q.test_part_id where tp.test_id=p_test_id
  ), ordered as (
    select question_id,part_no,stimulus_group_id,
      row_number() over(order by part_sort,primary_key,source_order)::int global_rn,
      row_number() over(partition by part_no order by primary_key,source_order)::int part_rn,
      dense_rank() over(partition by part_no order by primary_key)::int grp_rn from base
  )
  insert into public.attempt_questions(attempt_id,question_id,display_number,display_order,stimulus_group_display_order)
  select v_attempt_id,question_id,
    case part_no when 5 then 100+part_rn when 6 then 130+part_rn when 7 then 146+part_rn else global_rn end,
    global_rn,case when stimulus_group_id is null then null else grp_rn end from ordered;
  insert into public.audit_logs(actor_id,action,target_type,target_id,metadata)
  values(v_uid,'attempt_started','attempt',v_attempt_id::text,jsonb_build_object('test_id',p_test_id,'attempt_no',v_next_no,'class_id',v_class_id));
  return jsonb_build_object('attempt_id',v_attempt_id,'existing',false,'attempt_no',v_next_no,'expires_at',v_exp,'remaining_after_start',v_test.max_attempts-v_used-1);
end
$$;

revoke execute on function public.staff_upsert_test_v120(jsonb) from public,anon;
revoke execute on function public.staff_clone_test_v120(uuid,jsonb) from public,anon;
revoke execute on function public.get_test_authoring_v120(uuid) from public,anon;
revoke execute on function public.staff_preflight_test_v120(uuid) from public,anon;
revoke execute on function public.staff_get_test_live_v120(uuid) from public,anon;
revoke execute on function public.staff_get_test_export_v120(uuid) from public,anon;
grant execute on function public.staff_upsert_test_v120(jsonb) to authenticated;
grant execute on function public.staff_clone_test_v120(uuid,jsonb) to authenticated;
grant execute on function public.get_test_authoring_v120(uuid) to authenticated;
grant execute on function public.staff_preflight_test_v120(uuid) to authenticated;
grant execute on function public.staff_get_test_live_v120(uuid) to authenticated;
grant execute on function public.staff_get_test_export_v120(uuid) to authenticated;
grant execute on function public.start_attempt(uuid) to authenticated;
