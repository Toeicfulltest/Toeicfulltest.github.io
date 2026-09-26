-- Question bank foundation: independent reusable items, staff-only media and usage metadata.
-- Additive migration: existing tests/questions/exam runtime are unchanged.

create schema if not exists private;

create table if not exists private.bank_code_counters (
  part_no smallint not null check (part_no between 1 and 7),
  item_type text not null check (item_type in ('Q','G')),
  last_value integer not null check (last_value >= 0),
  primary key (part_no,item_type)
);

create table if not exists public.bank_items (
  id uuid primary key default gen_random_uuid(),
  public_code text unique,
  item_type text not null check (item_type in ('Q','G')),
  part_no smallint not null check (part_no between 1 and 7),
  status text not null default 'draft' check (status in ('draft','approved','inactive')),
  difficulty text not null default 'unrated' check (difficulty in ('unrated','easy','medium','hard')),
  title text,
  primary_type text,
  tags text[] not null default '{}'::text[],
  topics text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  source_type text not null default 'manual',
  source_name text,
  source_test_id uuid references public.tests(id) on delete set null,
  source_entity_id uuid,
  content_hash text,
  revision_no integer not null default 1 check (revision_no >= 1),
  approved_at timestamptz,
  approved_by uuid,
  inactive_at timestamptz,
  created_by uuid default auth.uid(),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_items_public_code_format check (
    public_code is null or public_code ~ '^(Q[1-7]_[0-9]{6}|G[1-7]_[0-9]{5})$'
  )
);

create table if not exists public.bank_stimuli (
  id uuid primary key default gen_random_uuid(),
  bank_item_id uuid not null references public.bank_items(id) on delete cascade,
  media_type text not null default 'text' check (media_type in ('text','image','audio')),
  content text,
  storage_path text,
  sort_order integer not null default 1 check (sort_order >= 1),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_item_id,sort_order)
);

create table if not exists public.bank_questions (
  id uuid primary key default gen_random_uuid(),
  bank_item_id uuid not null references public.bank_items(id) on delete cascade,
  child_no smallint not null default 1 check (child_no >= 1),
  sort_order integer not null default 1 check (sort_order >= 1),
  content text not null default '',
  correct_choice_key character(1),
  score_weight numeric not null default 1 check (score_weight > 0),
  media_type text check (media_type is null or media_type in ('image','audio')),
  storage_path text,
  tags text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_questions_correct_choice_chk check (correct_choice_key is null or correct_choice_key in ('A','B','C','D')),
  unique (bank_item_id,child_no),
  unique (bank_item_id,sort_order)
);

create table if not exists public.bank_question_choices (
  question_id uuid not null references public.bank_questions(id) on delete cascade,
  choice_key character(1) not null check (choice_key in ('A','B','C','D')),
  content text not null default '',
  media_type text check (media_type is null or media_type in ('image','audio')),
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (question_id,choice_key)
);

create table if not exists public.bank_item_usage (
  id uuid primary key default gen_random_uuid(),
  bank_item_id uuid not null references public.bank_items(id) on delete cascade,
  test_id uuid references public.tests(id) on delete set null,
  target_type text not null check (target_type in ('question','group')),
  target_id uuid not null,
  used_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table if not exists public.bank_item_stats (
  bank_item_id uuid primary key references public.bank_items(id) on delete cascade,
  usage_count bigint not null default 0 check (usage_count >= 0),
  last_used_at timestamptz,
  attempt_count bigint not null default 0 check (attempt_count >= 0),
  correct_count bigint not null default 0 check (correct_count >= 0 and correct_count <= attempt_count),
  correct_rate numeric,
  discrimination numeric,
  updated_at timestamptz not null default now(),
  constraint bank_item_stats_correct_rate_chk check (correct_rate is null or (correct_rate >= 0 and correct_rate <= 1))
);

create index if not exists bank_items_part_status_type_idx on public.bank_items(part_no,status,item_type);
create index if not exists bank_items_part_difficulty_idx on public.bank_items(part_no,difficulty);
create index if not exists bank_items_primary_type_idx on public.bank_items(primary_type) where primary_type is not null;
create index if not exists bank_items_created_at_idx on public.bank_items(created_at desc);
create index if not exists bank_items_source_test_idx on public.bank_items(source_test_id) where source_test_id is not null;
create index if not exists bank_items_tags_gin_idx on public.bank_items using gin(tags);
create index if not exists bank_items_topics_gin_idx on public.bank_items using gin(topics);
create index if not exists bank_items_metadata_gin_idx on public.bank_items using gin(metadata jsonb_path_ops);
create index if not exists bank_stimuli_item_order_idx on public.bank_stimuli(bank_item_id,sort_order);
create index if not exists bank_questions_item_order_idx on public.bank_questions(bank_item_id,sort_order);
create index if not exists bank_usage_item_time_idx on public.bank_item_usage(bank_item_id,used_at desc);
create index if not exists bank_usage_test_idx on public.bank_item_usage(test_id) where test_id is not null;
create unique index if not exists bank_usage_target_unique on public.bank_item_usage(bank_item_id,target_type,target_id);

create or replace function private.bank_prepare_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq integer;
  v_width integer;
  v_actor uuid := auth.uid();
begin
  if tg_op='INSERT' and new.public_code is not null then
    raise exception 'public_code is generated by the system';
  end if;

  if tg_op='UPDATE' then
    if new.public_code is distinct from old.public_code then
      raise exception 'public_code cannot be edited';
    end if;
    if old.public_code is not null and (new.item_type is distinct from old.item_type or new.part_no is distinct from old.part_no) then
      raise exception 'item_type and part_no cannot change after code allocation';
    end if;
    if old.public_code is not null and new.status='draft' then
      raise exception 'coded bank items cannot return to draft';
    end if;
  end if;

  if new.status='approved' and new.public_code is null then
    insert into private.bank_code_counters(part_no,item_type,last_value)
    values(new.part_no,new.item_type,1)
    on conflict(part_no,item_type)
    do update set last_value=private.bank_code_counters.last_value+1
    returning last_value into v_seq;

    v_width:=case when new.item_type='Q' then 6 else 5 end;
    if (new.item_type='Q' and v_seq>999999) or (new.item_type='G' and v_seq>99999) then
      raise exception 'Bank code range exhausted for Part % type %',new.part_no,new.item_type;
    end if;
    new.public_code:=new.item_type || new.part_no::text || '_' || lpad(v_seq::text,v_width,'0');
    new.approved_at:=coalesce(new.approved_at,now());
    new.approved_by:=coalesce(new.approved_by,v_actor);
    new.inactive_at:=null;
  elsif new.status='inactive' then
    new.inactive_at:=coalesce(new.inactive_at,now());
  elsif new.status='approved' then
    new.approved_at:=coalesce(new.approved_at,now());
    new.approved_by:=coalesce(new.approved_by,v_actor);
    new.inactive_at:=null;
  end if;

  new.updated_at:=now();
  new.updated_by:=coalesce(v_actor,new.updated_by);
  return new;
end
$$;

create or replace function private.bank_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at:=now();
  return new;
end
$$;

create or replace function private.bank_init_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.bank_item_stats(bank_item_id) values(new.id) on conflict(bank_item_id) do nothing;
  return new;
end
$$;

create or replace function private.bank_record_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.bank_item_stats(bank_item_id,usage_count,last_used_at,updated_at)
  values(new.bank_item_id,1,new.used_at,now())
  on conflict(bank_item_id) do update set
    usage_count=public.bank_item_stats.usage_count+1,
    last_used_at=greatest(coalesce(public.bank_item_stats.last_used_at,new.used_at),new.used_at),
    updated_at=now();
  return new;
end
$$;

drop trigger if exists bank_items_prepare on public.bank_items;
create trigger bank_items_prepare before insert or update on public.bank_items
for each row execute function private.bank_prepare_item();

drop trigger if exists bank_items_init_stats on public.bank_items;
create trigger bank_items_init_stats after insert on public.bank_items
for each row execute function private.bank_init_stats();

drop trigger if exists bank_stimuli_touch on public.bank_stimuli;
create trigger bank_stimuli_touch before update on public.bank_stimuli
for each row execute function private.bank_touch_updated_at();

drop trigger if exists bank_questions_touch on public.bank_questions;
create trigger bank_questions_touch before update on public.bank_questions
for each row execute function private.bank_touch_updated_at();

drop trigger if exists bank_choices_touch on public.bank_question_choices;
create trigger bank_choices_touch before update on public.bank_question_choices
for each row execute function private.bank_touch_updated_at();

drop trigger if exists bank_usage_record on public.bank_item_usage;
create trigger bank_usage_record after insert on public.bank_item_usage
for each row execute function private.bank_record_usage();

alter table public.bank_items enable row level security;
alter table public.bank_stimuli enable row level security;
alter table public.bank_questions enable row level security;
alter table public.bank_question_choices enable row level security;
alter table public.bank_item_usage enable row level security;
alter table public.bank_item_stats enable row level security;

revoke all on table public.bank_items,public.bank_stimuli,public.bank_questions,public.bank_question_choices,public.bank_item_usage,public.bank_item_stats from anon,public;
revoke all on table public.bank_items,public.bank_stimuli,public.bank_questions,public.bank_question_choices,public.bank_item_usage,public.bank_item_stats from authenticated;
grant select,insert,update,delete on table public.bank_items,public.bank_stimuli,public.bank_questions,public.bank_question_choices to authenticated;
grant select,insert on table public.bank_item_usage to authenticated;
grant select on table public.bank_item_stats to authenticated;
grant all on table public.bank_items,public.bank_stimuli,public.bank_questions,public.bank_question_choices,public.bank_item_usage,public.bank_item_stats to service_role;

create policy bank_items_staff_select on public.bank_items for select to authenticated
using ((select public.current_role())::text in ('teacher','system_admin'));
create policy bank_items_staff_insert on public.bank_items for insert to authenticated
with check ((select public.current_role())::text in ('teacher','system_admin'));
create policy bank_items_staff_update on public.bank_items for update to authenticated
using ((select public.current_role())::text in ('teacher','system_admin'))
with check ((select public.current_role())::text in ('teacher','system_admin'));
create policy bank_items_staff_delete_draft on public.bank_items for delete to authenticated
using (
  (select public.current_role())::text in ('teacher','system_admin')
  and status='draft'
  and not exists(select 1 from public.bank_item_usage u where u.bank_item_id=bank_items.id)
);

create policy bank_stimuli_staff_manage on public.bank_stimuli for all to authenticated
using ((select public.current_role())::text in ('teacher','system_admin'))
with check ((select public.current_role())::text in ('teacher','system_admin'));
create policy bank_questions_staff_manage on public.bank_questions for all to authenticated
using ((select public.current_role())::text in ('teacher','system_admin'))
with check ((select public.current_role())::text in ('teacher','system_admin'));
create policy bank_choices_staff_manage on public.bank_question_choices for all to authenticated
using ((select public.current_role())::text in ('teacher','system_admin'))
with check ((select public.current_role())::text in ('teacher','system_admin'));
create policy bank_usage_staff_select on public.bank_item_usage for select to authenticated
using ((select public.current_role())::text in ('teacher','system_admin'));
create policy bank_usage_staff_insert on public.bank_item_usage for insert to authenticated
with check ((select public.current_role())::text in ('teacher','system_admin'));
create policy bank_stats_staff_select on public.bank_item_stats for select to authenticated
using ((select public.current_role())::text in ('teacher','system_admin'));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'bank-media','bank-media',false,52428800,
  array['image/png','image/jpeg','image/webp','audio/mpeg','audio/mp4','audio/wav','audio/x-m4a','audio/aac','audio/ogg']::text[]
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists staff_manage_bank_media on storage.objects;
create policy staff_manage_bank_media on storage.objects for all to authenticated
using (
  bucket_id='bank-media'
  and (select public.current_role())::text in ('teacher','system_admin')
)
with check (
  bucket_id='bank-media'
  and (select public.current_role())::text in ('teacher','system_admin')
);
