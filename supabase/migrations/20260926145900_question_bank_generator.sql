-- Step 6: materialize an ordered selection of approved question-bank items into an editable test draft.
-- The function is SECURITY INVOKER so the existing staff RLS policies remain authoritative.

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
  if (select public.current_role())::text not in ('teacher','system_admin') then
    raise exception 'staff only';
  end if;
  if v_test_id is null then raise exception 'test_id is required'; end if;
  if jsonb_typeof(coalesce(p_data->'item_ids','[]'::jsonb)) <> 'array' then
    raise exception 'item_ids must be an array';
  end if;
  if jsonb_array_length(coalesce(p_data->'item_ids','[]'::jsonb)) = 0 then
    raise exception 'at least one bank item is required';
  end if;
  if jsonb_typeof(coalesce(p_data->'media_map','{}'::jsonb)) <> 'object' then
    raise exception 'media_map must be an object';
  end if;

  select t.content_locked_at into v_locked_at
  from public.tests t
  where t.id=v_test_id;
  if not found then raise exception 'test not found'; end if;
  if v_locked_at is not null then raise exception 'test content is locked'; end if;

  if (
    select count(*) <> count(distinct value)
    from jsonb_array_elements_text(coalesce(p_data->'item_ids','[]'::jsonb))
  ) then
    raise exception 'duplicate bank item in selection';
  end if;

  for v_bank_id in
    select value::uuid
    from jsonb_array_elements_text(coalesce(p_data->'item_ids','[]'::jsonb)) with ordinality as x(value,ord)
    order by ord
  loop
    select bi.id,bi.public_code,bi.item_type,bi.part_no,bi.title
      into v_item
    from public.bank_items bi
    where bi.id=v_bank_id and bi.status='approved';
    if not found then raise exception 'bank item % is not approved or does not exist',v_bank_id; end if;

    if exists(
      select 1 from public.bank_item_usage u
      where u.bank_item_id=v_bank_id and u.test_id=v_test_id
    ) then
      raise exception 'bank item % is already used in this test',coalesce(v_item.public_code,v_bank_id::text);
    end if;

    select tp.id into v_part_id
    from public.test_parts tp
    where tp.test_id=v_test_id and tp.part_no=v_item.part_no;
    if not found then raise exception 'Part % is not available in this test',v_item.part_no; end if;

    select count(*) into v_q_count
    from public.bank_questions bq
    where bq.bank_item_id=v_bank_id;
    if v_q_count=0 then raise exception 'bank item % has no questions',coalesce(v_item.public_code,v_bank_id::text); end if;

    v_part_start := case v_item.part_no
      when 1 then 1 when 2 then 7 when 3 then 32 when 4 then 71
      when 5 then 101 when 6 then 131 when 7 then 147 end;
    v_part_end := case v_item.part_no
      when 1 then 6 when 2 then 31 when 3 then 70 when 4 then 100
      when 5 then 130 when 6 then 146 when 7 then 200 end;

    select coalesce(max(q.source_number)+1,v_part_start) into v_next_number
    from public.questions q
    where q.test_part_id=v_part_id;
    if v_next_number < v_part_start then v_next_number := v_part_start; end if;
    if v_next_number+v_q_count-1 > v_part_end then
      raise exception 'Part % would exceed the standard TOEIC range %-%',v_item.part_no,v_part_start,v_part_end;
    end if;

    v_group_id := null;
    if v_item.item_type='G' then
      select coalesce(max(sg.source_order)+1,1) into v_group_order
      from public.stimulus_groups sg
      where sg.test_part_id=v_part_id;

      insert into public.stimulus_groups(
        test_part_id,source_order,title,play_mode,allow_replay,allow_seek,max_plays
      ) values (
        v_part_id,v_group_order,coalesce(v_item.title,v_item.public_code,'Nhóm ngân hàng'),
        'normal',true,true,null
      ) returning id into v_group_id;
      v_created_groups := v_created_groups+1;

      for v_stimulus in
        select bs.media_type,bs.content,bs.storage_path,bs.sort_order
        from public.bank_stimuli bs
        where bs.bank_item_id=v_bank_id
        order by bs.sort_order,bs.id
      loop
        v_content := v_stimulus.content;
        if v_content is not null then
          for v_old_path,v_new_path in
            select key,value from jsonb_each_text(coalesce(p_data->'media_map','{}'::jsonb))
          loop
            v_content := replace(v_content,v_old_path,v_new_path);
          end loop;
        end if;
        v_storage_path := case
          when v_stimulus.storage_path is null then null
          else coalesce(p_data->'media_map'->>v_stimulus.storage_path,v_stimulus.storage_path)
        end;
        insert into public.stimuli(stimulus_group_id,media_type,content,storage_path,sort_order)
        values(v_group_id,v_stimulus.media_type::public.media_type,v_content,v_storage_path,v_stimulus.sort_order);
      end loop;
    end if;

    v_target_id := null;
    for v_question in
      select bq.id,bq.content,bq.correct_choice_key,bq.score_weight,bq.media_type,bq.storage_path,bq.sort_order
      from public.bank_questions bq
      where bq.bank_item_id=v_bank_id
      order by bq.sort_order,bq.child_no,bq.id
    loop
      v_content := v_question.content;
      if v_content is not null then
        for v_old_path,v_new_path in
          select key,value from jsonb_each_text(coalesce(p_data->'media_map','{}'::jsonb))
        loop
          v_content := replace(v_content,v_old_path,v_new_path);
        end loop;
      end if;
      v_storage_path := case
        when v_question.storage_path is null then null
        else coalesce(p_data->'media_map'->>v_question.storage_path,v_question.storage_path)
      end;

      insert into public.questions(
        test_part_id,stimulus_group_id,source_number,source_order,content,score_weight,
        correct_choice_key,media_type,storage_path
      ) values (
        v_part_id,v_group_id,v_next_number,v_next_number,coalesce(v_content,''),v_question.score_weight,
        v_question.correct_choice_key,
        case when v_question.media_type is null then null else v_question.media_type::public.media_type end,
        v_storage_path
      ) returning id into v_question_id;
      if v_target_id is null then v_target_id := v_question_id; end if;

      for v_choice in
        select bc.choice_key,bc.content,bc.media_type,bc.storage_path
        from public.bank_question_choices bc
        where bc.question_id=v_question.id
        order by bc.choice_key
      loop
        v_content := v_choice.content;
        if v_content is not null then
          for v_old_path,v_new_path in
            select key,value from jsonb_each_text(coalesce(p_data->'media_map','{}'::jsonb))
          loop
            v_content := replace(v_content,v_old_path,v_new_path);
          end loop;
        end if;
        v_storage_path := case
          when v_choice.storage_path is null then null
          else coalesce(p_data->'media_map'->>v_choice.storage_path,v_choice.storage_path)
        end;
        insert into public.question_choices(question_id,choice_key,content,media_type,storage_path)
        values(
          v_question_id,v_choice.choice_key,coalesce(v_content,''),
          case when v_choice.media_type is null then null else v_choice.media_type::public.media_type end,
          v_storage_path
        );
      end loop;

      v_next_number := v_next_number+1;
      v_created_questions := v_created_questions+1;
    end loop;

    if v_item.item_type='G' then v_target_id := v_group_id; end if;
    insert into public.bank_item_usage(bank_item_id,test_id,target_type,target_id,created_by)
    values(v_bank_id,v_test_id,case when v_item.item_type='G' then 'group' else 'question' end,v_target_id,auth.uid());
    v_created_items := v_created_items+1;
  end loop;

  return jsonb_build_object(
    'test_id',v_test_id,
    'items_created',v_created_items,
    'questions_created',v_created_questions,
    'groups_created',v_created_groups
  );
end
$$;

revoke all on function public.staff_materialize_bank_selection(jsonb) from public,anon;
grant execute on function public.staff_materialize_bank_selection(jsonb) to authenticated,service_role;
