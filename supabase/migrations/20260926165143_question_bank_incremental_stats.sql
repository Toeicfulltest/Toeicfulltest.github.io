-- Step 7 performance follow-up: maintain empirical bank statistics incrementally per finalized attempt.

create or replace function private.bank_apply_attempt_stats(p_test_id uuid,p_attempt_id uuid,p_delta integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage record;
  v_total bigint;
  v_correct bigint;
begin
  if p_delta not in (-1,1) then raise exception 'invalid stats delta'; end if;
  for v_usage in
    select u.bank_item_id,u.target_type,u.target_id
    from public.bank_item_usage u
    where u.test_id=p_test_id
  loop
    select count(*),count(*) filter(where ans.selected_choice_key=q.correct_choice_key)
      into v_total,v_correct
    from public.questions q
    left join public.answers ans on ans.attempt_id=p_attempt_id and ans.question_id=q.id
    where (v_usage.target_type='question' and q.id=v_usage.target_id)
       or (v_usage.target_type='group' and q.stimulus_group_id=v_usage.target_id);

    if coalesce(v_total,0)>0 then
      update public.bank_item_stats s
      set attempt_count=greatest(0,s.attempt_count+p_delta*v_total),
          correct_count=greatest(0,s.correct_count+p_delta*coalesce(v_correct,0)),
          correct_rate=case
            when greatest(0,s.attempt_count+p_delta*v_total)>0
              then greatest(0,s.correct_count+p_delta*coalesce(v_correct,0))::numeric
                   / greatest(0,s.attempt_count+p_delta*v_total)
            else null end,
          updated_at=now()
      where s.bank_item_id=v_usage.bank_item_id;
    end if;
  end loop;
end
$$;

create or replace function private.bank_attempt_stats_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_final boolean;
  v_new_final boolean;
begin
  if tg_op='DELETE' then
    if old.status in ('submitted','auto_submitted') then
      perform private.bank_apply_attempt_stats(old.test_id,old.id,-1);
    end if;
    return old;
  end if;

  v_old_final:=old.status in ('submitted','auto_submitted');
  v_new_final:=new.status in ('submitted','auto_submitted');
  if not v_old_final and v_new_final then
    perform private.bank_apply_attempt_stats(new.test_id,new.id,1);
  elsif v_old_final and not v_new_final then
    perform private.bank_apply_attempt_stats(old.test_id,old.id,-1);
  end if;
  return new;
end
$$;

drop trigger if exists bank_attempt_stats_refresh on public.attempts;
drop trigger if exists bank_attempt_stats_update on public.attempts;
drop trigger if exists bank_attempt_stats_delete on public.attempts;
create trigger bank_attempt_stats_update
after update of status on public.attempts
for each row execute function private.bank_attempt_stats_trigger();
create trigger bank_attempt_stats_delete
before delete on public.attempts
for each row execute function private.bank_attempt_stats_trigger();
