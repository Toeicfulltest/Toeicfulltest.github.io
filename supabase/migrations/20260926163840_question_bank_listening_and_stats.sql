-- Step 7: Listening bank validation, safe materialization, and empirical statistics.

create or replace function public.staff_save_bank_item(p_data jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_data->>'id','')::uuid;
  v_part smallint := nullif(p_data->>'part_no','')::smallint;
  v_type text := upper(coalesce(nullif(p_data->>'item_type',''),''));
  v_status text := coalesce(nullif(p_data->>'status',''),'draft');
  v_question jsonb;
  v_choice jsonb;
  v_stimulus jsonb;
  v_question_id uuid;
  v_q_count integer;
  v_bad_count integer;
  v_audio_count integer;
  v_code text;
  v_revision integer;
begin
  if (select public.current_role())::text not in ('teacher','system_admin') then
    raise exception 'staff only';
  end if;
  if v_part not between 1 and 7 then raise exception 'invalid part'; end if;
  if v_type not in ('Q','G') then raise exception 'invalid item type'; end if;
  if (v_part in (1,2,5) and v_type<>'Q') or (v_part in (3,4,6,7) and v_type<>'G') then
    raise exception 'item type does not match TOEIC Part %',v_part;
  end if;
  if v_status not in ('draft','approved','inactive') then raise exception 'invalid status'; end if;
  if jsonb_typeof(coalesce(p_data->'questions','[]'::jsonb)) <> 'array' then raise exception 'questions must be an array'; end if;
  if jsonb_typeof(coalesce(p_data->'stimuli','[]'::jsonb)) <> 'array' then raise exception 'stimuli must be an array'; end if;

  if v_id is null then
    insert into public.bank_items(
      item_type,part_no,status,difficulty,title,primary_type,tags,topics,metadata,
      source_type,source_name,created_by,updated_by
    ) values (
      v_type,v_part,v_status,coalesce(nullif(p_data->>'difficulty',''),'unrated'),
      nullif(p_data->>'title',''),nullif(p_data->>'primary_type',''),
      coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_data->'tags','[]'::jsonb))), '{}'::text[]),
      coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_data->'topics','[]'::jsonb))), '{}'::text[]),
      coalesce(p_data->'metadata','{}'::jsonb),
      coalesce(nullif(p_data->>'source_type',''),'manual'),nullif(p_data->>'source_name',''),
      auth.uid(),auth.uid()
    ) returning id into v_id;
  else
    update public.bank_items
    set item_type=v_type,
        part_no=v_part,
        status=v_status,
        difficulty=coalesce(nullif(p_data->>'difficulty',''),'unrated'),
        title=nullif(p_data->>'title',''),
        primary_type=nullif(p_data->>'primary_type',''),
        tags=coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_data->'tags','[]'::jsonb))), '{}'::text[]),
        topics=coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_data->'topics','[]'::jsonb))), '{}'::text[]),
        metadata=coalesce(p_data->'metadata','{}'::jsonb),
        source_name=nullif(p_data->>'source_name',''),
        revision_no=revision_no+1,
        updated_by=auth.uid()
    where id=v_id;
    if not found then raise exception 'bank item not found'; end if;

    delete from public.bank_stimuli where bank_item_id=v_id;
    delete from public.bank_questions where bank_item_id=v_id;
  end if;

  for v_stimulus in select value from jsonb_array_elements(coalesce(p_data->'stimuli','[]'::jsonb)) loop
    insert into public.bank_stimuli(bank_item_id,media_type,content,storage_path,sort_order,metadata)
    values(
      v_id,
      coalesce(nullif(v_stimulus->>'media_type',''),'text'),
      nullif(v_stimulus->>'content',''),
      nullif(v_stimulus->>'storage_path',''),
      coalesce(nullif(v_stimulus->>'sort_order','')::integer,1),
      coalesce(v_stimulus->'metadata','{}'::jsonb)
    );
  end loop;

  for v_question in select value from jsonb_array_elements(coalesce(p_data->'questions','[]'::jsonb)) loop
    insert into public.bank_questions(
      bank_item_id,child_no,sort_order,content,correct_choice_key,score_weight,
      media_type,storage_path,tags,metadata
    ) values (
      v_id,
      coalesce(nullif(v_question->>'child_no','')::smallint,1),
      coalesce(nullif(v_question->>'sort_order','')::integer,1),
      coalesce(v_question->>'content',''),
      nullif(upper(v_question->>'correct_choice_key'),''),
      coalesce(nullif(v_question->>'score_weight','')::numeric,1),
      nullif(v_question->>'media_type',''),nullif(v_question->>'storage_path',''),
      coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(v_question->'tags','[]'::jsonb))), '{}'::text[]),
      coalesce(v_question->'metadata','{}'::jsonb)
    ) returning id into v_question_id;

    for v_choice in select value from jsonb_array_elements(coalesce(v_question->'choices','[]'::jsonb)) loop
      insert into public.bank_question_choices(question_id,choice_key,content,media_type,storage_path)
      values(
        v_question_id,
        upper(v_choice->>'choice_key'),
        coalesce(v_choice->>'content',''),
        nullif(v_choice->>'media_type',''),
        nullif(v_choice->>'storage_path','')
      );
    end loop;
  end loop;

  if v_status='approved' then
    select count(*) into v_q_count from public.bank_questions where bank_item_id=v_id;
    if v_q_count=0 then raise exception 'approved item must contain questions'; end if;
    if v_type='Q' and v_q_count<>1 then raise exception 'single item must contain exactly one question'; end if;
    if v_part in (3,4) and v_q_count<>3 then raise exception 'Part % group must contain exactly three questions',v_part; end if;
    if v_part=6 and v_q_count<>4 then raise exception 'Part 6 group must contain exactly four questions'; end if;
    if v_part=7 and (v_q_count<2 or v_q_count>5) then raise exception 'Part 7 group must contain two to five questions'; end if;

    select count(*) into v_bad_count
    from public.bank_questions q
    where q.bank_item_id=v_id
      and (q.correct_choice_key is null or (v_part>=3 and btrim(coalesce(q.content,''))=''));
    if v_bad_count>0 then raise exception 'approved questions require valid content and a correct answer'; end if;

    select count(*) into v_bad_count
    from public.bank_questions q
    where q.bank_item_id=v_id
      and (select count(*) from public.bank_question_choices c where c.question_id=q.id)<>(case when v_part=2 then 3 else 4 end);
    if v_bad_count>0 then raise exception 'invalid choice count for Part %',v_part; end if;

    select count(*) into v_bad_count
    from public.bank_questions q
    where q.bank_item_id=v_id
      and not exists(select 1 from public.bank_question_choices c where c.question_id=q.id and c.choice_key=q.correct_choice_key);
    if v_bad_count>0 then raise exception 'correct answer must match an existing choice'; end if;

    if v_part>=3 then
      select count(*) into v_bad_count
      from public.bank_question_choices c
      join public.bank_questions q on q.id=c.question_id
      where q.bank_item_id=v_id and btrim(coalesce(c.content,''))='' and c.storage_path is null;
      if v_bad_count>0 then raise exception 'Part 3-7 choices require content or media'; end if;
    end if;

    if v_part between 1 and 4 then
      select count(*) into v_audio_count
      from public.bank_stimuli s
      where s.bank_item_id=v_id and s.media_type='audio' and s.storage_path is not null and s.storage_path ~* '\.mp3$';
      if v_audio_count<>1 then raise exception 'Listening bank item requires exactly one MP3 clip'; end if;
    end if;

    if v_part=1 and not exists(
      select 1 from public.bank_questions q
      where q.bank_item_id=v_id and q.media_type='image' and q.storage_path is not null
    ) then raise exception 'Part 1 requires an image'; end if;

    if v_part in (6,7) and not exists(
      select 1 from public.bank_stimuli s
      where s.bank_item_id=v_id and s.media_type='text' and btrim(coalesce(s.content,''))<>''
    ) then raise exception 'Part 6-7 requires passage content'; end if;
  end if;

  select public_code,revision_no into v_code,v_revision from public.bank_items where id=v_id;
  return jsonb_build_object('id',v_id,'public_code',v_code,'status',v_status,'revision_no',v_revision);
end
$$;

revoke all on function public.staff_save_bank_item(jsonb) from public,anon;
grant execute on function public.staff_save_bank_item(jsonb) to authenticated,service_role;

create or replace function public.staff_materialize_bank_selection(p_data jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_test_id uuid := nullif(p_data->>'test_id','')::uuid;
  v_locked_at timestamptz;
  v_bank_id uuid;
  v_item record;
  v_part_id uuid;
  v_group_id uuid;
  v_question_id uuid;
  v_target_id uuid;
  v_question record;
  v_choice record;
  v_stimulus record;
  v_q_count integer;
  v_next_number integer;
  v_part_start integer;
  v_part_end integer;
  v_group_order integer;
  v_content text;
  v_storage_path text;
  v_old_path text;
  v_new_path text;
  v_created_items integer := 0;
  v_created_questions integer := 0;
  v_created_groups integer := 0;
begin
  if (select public.current_role())::text not in ('teacher','system_admin') then raise exception 'staff only'; end if;
  if v_test_id is null then raise exception 'test_id is required'; end if;
  if jsonb_typeof(coalesce(p_data->'item_ids','[]'::jsonb)) <> 'array' then raise exception 'item_ids must be an array'; end if;
  if jsonb_array_length(coalesce(p_data->'item_ids','[]'::jsonb)) = 0 then raise exception 'at least one bank item is required'; end if;
  if jsonb_typeof(coalesce(p_data->'media_map','{}'::jsonb)) <> 'object' then raise exception 'media_map must be an object'; end if;

  select t.content_locked_at into v_locked_at from public.tests t where t.id=v_test_id;
  if not found then raise exception 'test not found'; end if;
  if v_locked_at is not null then raise exception 'test content is locked'; end if;

  if (select count(*) <> count(distinct value) from jsonb_array_elements_text(coalesce(p_data->'item_ids','[]'::jsonb))) then
    raise exception 'duplicate bank item in selection';
  end if;

  for v_bank_id in
    select value::uuid from jsonb_array_elements_text(coalesce(p_data->'item_ids','[]'::jsonb)) with ordinality as x(value,ord) order by ord
  loop
    select bi.id,bi.public_code,bi.item_type,bi.part_no,bi.title into v_item
    from public.bank_items bi where bi.id=v_bank_id and bi.status='approved';
    if not found then raise exception 'bank item % is not approved or does not exist',v_bank_id; end if;

    if exists(select 1 from public.bank_item_usage u where u.bank_item_id=v_bank_id and u.test_id=v_test_id) then
      raise exception 'bank item % is already used in this test',coalesce(v_item.public_code,v_bank_id::text);
    end if;

    select tp.id into v_part_id from public.test_parts tp where tp.test_id=v_test_id and tp.part_no=v_item.part_no;
    if not found then raise exception 'Part % is not available in this test',v_item.part_no; end if;

    select count(*) into v_q_count from public.bank_questions bq where bq.bank_item_id=v_bank_id;
    if v_q_count=0 then raise exception 'bank item % has no questions',coalesce(v_item.public_code,v_bank_id::text); end if;

    v_part_start := case v_item.part_no when 1 then 1 when 2 then 7 when 3 then 32 when 4 then 71 when 5 then 101 when 6 then 131 when 7 then 147 end;
    v_part_end := case v_item.part_no when 1 then 6 when 2 then 31 when 3 then 70 when 4 then 100 when 5 then 130 when 6 then 146 when 7 then 200 end;

    select coalesce(max(q.source_number)+1,v_part_start) into v_next_number from public.questions q where q.test_part_id=v_part_id;
    if v_next_number < v_part_start then v_next_number := v_part_start; end if;
    if v_next_number+v_q_count-1 > v_part_end then raise exception 'Part % would exceed the standard TOEIC range %-%',v_item.part_no,v_part_start,v_part_end; end if;

    v_group_id := null;
    if v_item.item_type='G' then
      select coalesce(max(sg.source_order)+1,1) into v_group_order from public.stimulus_groups sg where sg.test_part_id=v_part_id;
      insert into public.stimulus_groups(test_part_id,source_order,title,play_mode,allow_replay,allow_seek,max_plays)
      values(v_part_id,v_group_order,coalesce(v_item.title,v_item.public_code,'Nhóm ngân hàng'),'normal',true,true,null)
      returning id into v_group_id;
      v_created_groups := v_created_groups+1;

      for v_stimulus in
        select bs.media_type,bs.content,bs.storage_path,bs.sort_order
        from public.bank_stimuli bs
        where bs.bank_item_id=v_bank_id
          and not (v_item.part_no between 1 and 4 and bs.media_type='audio')
        order by bs.sort_order,bs.id
      loop
        v_content := v_stimulus.content;
        if v_content is not null then
          for v_old_path,v_new_path in select key,value from jsonb_each_text(coalesce(p_data->'media_map','{}'::jsonb)) loop
            v_content := replace(v_content,v_old_path,v_new_path);
          end loop;
        end if;
        v_storage_path := case when v_stimulus.storage_path is null then null else coalesce(p_data->'media_map'->>v_stimulus.storage_path,v_stimulus.storage_path) end;
        insert into public.stimuli(stimulus_group_id,media_type,content,storage_path,sort_order)
        values(v_group_id,v_stimulus.media_type::public.media_type,v_content,v_storage_path,v_stimulus.sort_order);
      end loop;
    end if;

    v_target_id := null;
    for v_question in
      select bq.id,bq.content,bq.correct_choice_key,bq.score_weight,bq.media_type,bq.storage_path,bq.sort_order
      from public.bank_questions bq where bq.bank_item_id=v_bank_id order by bq.sort_order,bq.child_no,bq.id
    loop
      v_content := v_question.content;
      if v_content is not null then
        for v_old_path,v_new_path in select key,value from jsonb_each_text(coalesce(p_data->'media_map','{}'::jsonb)) loop
          v_content := replace(v_content,v_old_path,v_new_path);
        end loop;
      end if;
      v_storage_path := case when v_question.storage_path is null then null else coalesce(p_data->'media_map'->>v_question.storage_path,v_question.storage_path) end;

      insert into public.questions(test_part_id,stimulus_group_id,source_number,source_order,content,score_weight,correct_choice_key,media_type,storage_path)
      values(v_part_id,v_group_id,v_next_number,v_next_number,coalesce(v_content,''),v_question.score_weight,v_question.correct_choice_key,
        case when v_question.media_type is null then null else v_question.media_type::public.media_type end,v_storage_path)
      returning id into v_question_id;
      if v_target_id is null then v_target_id := v_question_id; end if;

      for v_choice in
        select bc.choice_key,bc.content,bc.media_type,bc.storage_path from public.bank_question_choices bc where bc.question_id=v_question.id order by bc.choice_key
      loop
        v_content := v_choice.content;
        if v_content is not null then
          for v_old_path,v_new_path in select key,value from jsonb_each_text(coalesce(p_data->'media_map','{}'::jsonb)) loop
            v_content := replace(v_content,v_old_path,v_new_path);
          end loop;
        end if;
        v_storage_path := case when v_choice.storage_path is null then null else coalesce(p_data->'media_map'->>v_choice.storage_path,v_choice.storage_path) end;
        insert into public.question_choices(question_id,choice_key,content,media_type,storage_path)
        values(v_question_id,v_choice.choice_key,coalesce(v_content,''),case when v_choice.media_type is null then null else v_choice.media_type::public.media_type end,v_storage_path);
      end loop;

      v_next_number := v_next_number+1;
      v_created_questions := v_created_questions+1;
    end loop;

    if v_item.item_type='G' then v_target_id := v_group_id; end if;
    insert into public.bank_item_usage(bank_item_id,test_id,target_type,target_id,created_by)
    values(v_bank_id,v_test_id,case when v_item.item_type='G' then 'group' else 'question' end,v_target_id,auth.uid());
    v_created_items := v_created_items+1;
  end loop;

  return jsonb_build_object('test_id',v_test_id,'items_created',v_created_items,'questions_created',v_created_questions,'groups_created',v_created_groups);
end
$$;

revoke all on function public.staff_materialize_bank_selection(jsonb) from public,anon;
grant execute on function public.staff_materialize_bank_selection(jsonb) to authenticated,service_role;

create or replace function private.bank_refresh_stats_for_test(p_test_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bank_id uuid;
  v_attempts bigint;
  v_correct bigint;
begin
  for v_bank_id in select distinct u.bank_item_id from public.bank_item_usage u where u.test_id=p_test_id loop
    with item_questions as (
      select u.test_id,q.id as question_id,q.correct_choice_key
      from public.bank_item_usage u
      join public.questions q on (
        (u.target_type='question' and q.id=u.target_id)
        or (u.target_type='group' and q.stimulus_group_id=u.target_id)
      )
      where u.bank_item_id=v_bank_id
    ), scored as (
      select iq.question_id,iq.correct_choice_key,a.id as attempt_id,ans.selected_choice_key
      from item_questions iq
      join public.attempts a on a.test_id=iq.test_id and a.status in ('submitted','auto_submitted')
      left join public.answers ans on ans.attempt_id=a.id and ans.question_id=iq.question_id
    )
    select count(*),count(*) filter(where selected_choice_key=correct_choice_key)
      into v_attempts,v_correct
    from scored;

    update public.bank_item_stats
    set attempt_count=coalesce(v_attempts,0),
        correct_count=coalesce(v_correct,0),
        correct_rate=case when coalesce(v_attempts,0)>0 then v_correct::numeric/v_attempts else null end,
        updated_at=now()
    where bank_item_id=v_bank_id;
  end loop;
end
$$;

create or replace function private.bank_attempt_stats_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op='DELETE' then
    perform private.bank_refresh_stats_for_test(old.test_id);
    return old;
  end if;
  if tg_op='UPDATE' and old.status is distinct from new.status then
    perform private.bank_refresh_stats_for_test(new.test_id);
  end if;
  return new;
end
$$;

drop trigger if exists bank_attempt_stats_refresh on public.attempts;
create trigger bank_attempt_stats_refresh
after update of status or delete on public.attempts
for each row execute function private.bank_attempt_stats_trigger();
