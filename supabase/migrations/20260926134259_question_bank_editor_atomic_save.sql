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
  v_code text;
  v_revision integer;
begin
  if (select public.current_role())::text not in ('teacher','system_admin') then
    raise exception 'staff only';
  end if;
  if v_part not between 1 and 7 then raise exception 'invalid part'; end if;
  if v_type not in ('Q','G') then raise exception 'invalid item type'; end if;
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
    if v_part=6 and v_type='G' and v_q_count<>4 then raise exception 'Part 6 group must contain exactly four questions'; end if;
    if v_part=7 and v_type='G' and (v_q_count<2 or v_q_count>5) then raise exception 'Part 7 group must contain two to five questions'; end if;

    select count(*) into v_bad_count
    from public.bank_questions q
    where q.bank_item_id=v_id
      and (btrim(coalesce(q.content,''))='' or q.correct_choice_key is null);
    if v_bad_count>0 then raise exception 'approved questions require content and a correct answer'; end if;

    if v_part between 5 and 7 then
      select count(*) into v_bad_count
      from public.bank_questions q
      where q.bank_item_id=v_id
        and (select count(*) from public.bank_question_choices c where c.question_id=q.id)<>4;
      if v_bad_count>0 then raise exception 'Part 5-7 questions require four choices'; end if;
    end if;
  end if;

  select public_code,revision_no into v_code,v_revision from public.bank_items where id=v_id;
  return jsonb_build_object('id',v_id,'public_code',v_code,'status',v_status,'revision_no',v_revision);
end
$$;

revoke all on function public.staff_save_bank_item(jsonb) from public,anon;
grant execute on function public.staff_save_bank_item(jsonb) to authenticated,service_role;
