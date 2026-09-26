create unique index if not exists bank_items_test_copy_source_unique
on public.bank_items(source_test_id,source_entity_id)
where source_type='test_copy' and source_test_id is not null and source_entity_id is not null;

create index if not exists bank_items_content_hash_idx
on public.bank_items(content_hash)
where content_hash is not null;

create or replace function public.staff_copy_test_item_to_bank(p_data jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_test_id uuid := nullif(p_data->>'source_test_id','')::uuid;
  v_entity_id uuid := nullif(p_data->>'source_entity_id','')::uuid;
  v_hash text := nullif(p_data->>'content_hash','');
  v_saved jsonb;
  v_id uuid;
begin
  if (select public.current_role())::text not in ('teacher','system_admin') then
    raise exception 'staff only';
  end if;
  if v_test_id is null or v_entity_id is null then
    raise exception 'source test and entity are required';
  end if;
  if not exists(select 1 from public.tests t where t.id=v_test_id) then
    raise exception 'source test not found';
  end if;

  v_saved := public.staff_save_bank_item(
    p_data || jsonb_build_object('source_type','test_copy')
  );
  v_id := nullif(v_saved->>'id','')::uuid;

  update public.bank_items
  set source_type='test_copy',
      source_test_id=v_test_id,
      source_entity_id=v_entity_id,
      content_hash=v_hash,
      updated_by=auth.uid()
  where id=v_id;

  return v_saved || jsonb_build_object(
    'source_test_id',v_test_id,
    'source_entity_id',v_entity_id,
    'content_hash',v_hash
  );
end
$$;

revoke all on function public.staff_copy_test_item_to_bank(jsonb) from public,anon;
grant execute on function public.staff_copy_test_item_to_bank(jsonb) to authenticated,service_role;
