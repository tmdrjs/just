-- =====================================================================
-- 안건 분류 태그 + 담당자
--
-- tags: 태그 "키" 배열 (예: {map,monster_ai}). 라벨/색/목록은 코드 상수(src/lib/constants.ts)에서
--       관리하므로 태그를 추가·변경해도 DB 변경이 필요 없다. DB는 키 형식만 검사한다.
-- assignee_id: 담당자 (멤버 1명, 선택). 멤버가 방을 나가면 null, 다시 연결하면 따라간다.
-- =====================================================================

alter table public.agendas add column if not exists tags text[] not null default '{}';
alter table public.agendas add column if not exists assignee_id uuid
  references public.members (user_id) on update cascade on delete set null;

alter table public.agendas drop constraint if exists agendas_tags_format;
alter table public.agendas add constraint agendas_tags_format
  check (
    cardinality(tags) <= 20
    and array_position(tags, null) is null
    and array_to_string(tags, ',') ~ '^([a-z0-9_]{1,30}(,|$))*$'
  );

create index if not exists agendas_assignee on public.agendas (assignee_id) where deleted_at is null;

-- 쓰기 권한: 기존 컬럼 권한에 tags, assignee_id 추가
grant insert (tags, assignee_id) on public.agendas to authenticated;
grant update (tags, assignee_id) on public.agendas to authenticated;

-- 정규화 트리거 갱신: 태그 중복 제거·정렬, 태그/담당자 변경도 "활동"으로 본다
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
    -- pg_trigger_depth() = 1: 사용자가 직접 수정한 경우만. (멤버 퇴장 등 FK 연쇄 변경은 활동으로 치지 않음)
    if pg_trigger_depth() = 1
       and (new.title, new.description, new.status, new.conclusion, new.deleted_at, new.tags, new.assignee_id)
       is distinct from
       (old.title, old.description, old.status, old.conclusion, old.deleted_at, old.tags, old.assignee_id) then
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
