-- =====================================================================
-- 안건 부모-자식 관계 (마인드맵용)
--
-- parent_id: 상위 안건 (null = 최상위). 기존 안건은 모두 null(최상위)로 유지된다.
-- 깊이 제한 없음. 다음은 DB에서 막는다:
--   - 자기 자신을 부모로 지정
--   - 삭제된(없는) 안건을 부모로 지정
--   - 순환 구조 (자신의 하위 안건을 부모로 지정)
-- 부모를 소프트 삭제하면 자식은 최상위로 올라간다.
-- =====================================================================

alter table public.agendas add column if not exists parent_id uuid
  references public.agendas (id) on delete set null;

create index if not exists agendas_parent on public.agendas (parent_id) where deleted_at is null;

grant insert (parent_id) on public.agendas to authenticated;
grant update (parent_id) on public.agendas to authenticated;

-- 부모 검사 (자기 참조 / 없는 부모 / 순환)
create or replace function private.agendas_check_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'AGENDA_PARENT_SELF' using errcode = '23514';
  end if;

  -- 트리 변경을 직렬화: 동시에 A→B, B→A 로 바꿔 순환이 생기는 것을 막는다
  perform pg_advisory_xact_lock(hashtext('public.agendas.parent_id'));

  if not exists (select 1 from public.agendas where id = new.parent_id and deleted_at is null) then
    raise exception 'AGENDA_PARENT_INVALID' using errcode = '23514';
  end if;

  -- 새 부모에서 위로 올라가다 내가 나오면 순환
  if exists (
    with recursive up as (
      select a.id, a.parent_id from public.agendas a where a.id = new.parent_id
      union
      select a.id, a.parent_id from public.agendas a join up on a.id = up.parent_id
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'AGENDA_PARENT_CYCLE' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists agendas_check_parent on public.agendas;
create trigger agendas_check_parent
before insert or update of parent_id on public.agendas
for each row execute function private.agendas_check_parent();

-- 부모가 소프트 삭제되면 자식을 최상위로
create or replace function private.agendas_release_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.agendas set parent_id = null where parent_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists agendas_release_children on public.agendas;
create trigger agendas_release_children
after update of deleted_at on public.agendas
for each row execute function private.agendas_release_children();

-- 정규화 트리거 갱신: 상위 안건 변경도 "활동"으로 본다 (사용자가 직접 바꾼 경우만)
create or replace function private.agendas_normalize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.title := btrim(new.title);
  new.description := nullif(btrim(new.description), '');
  new.conclusion := nullif(btrim(new.conclusion), '');
  new.tags := coalesce((select array_agg(distinct t order by t) from unnest(new.tags) as t), '{}');

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.last_activity_at := now();
    new.deleted_at := null;
  else
    new.created_at := old.created_at;
    -- pg_trigger_depth() = 1: 사용자가 직접 수정한 경우만. (멤버 퇴장·부모 삭제 등 연쇄 변경은 활동으로 치지 않음)
    if pg_trigger_depth() = 1
       and (new.title, new.description, new.status, new.conclusion, new.deleted_at, new.tags, new.assignee_id, new.parent_id)
       is distinct from
       (old.title, old.description, old.status, old.conclusion, old.deleted_at, old.tags, old.assignee_id, old.parent_id) then
      new.updated_at := now();
      new.last_activity_at := now();
    end if;
    if new.deleted_at is not null and old.deleted_at is null then
      new.deleted_at := now();
    end if;
  end if;
  return new;
end;
$$;
