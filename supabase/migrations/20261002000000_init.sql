-- =====================================================================
-- 게임 기획 토의 사이트 — 초기 스키마
--
-- Supabase 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 한 번 실행한다.
-- (테이블, RLS, RPC 함수, 트리거, Realtime 설정이 모두 들어 있다.)
-- 초대 코드는 이 파일에 넣지 않는다. 실행 후 supabase/set-invite-code.sql 참고.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- 클라이언트(API)에 노출되지 않는 내부 함수용 스키마
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------
-- 테이블
-- ---------------------------------------------------------------------

-- 멤버 (익명 auth 사용자와 1:1, 최대 3행)
-- slot(1~3)은 색상 팔레트 순서이자 "최대 3명"을 DB 제약으로도 보장하는 장치다.
create table if not exists public.members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nickname text not null,
  slot smallint not null,
  joined_at timestamptz not null default now(),
  constraint members_nickname_format
    check (char_length(nickname) between 1 and 12 and nickname = btrim(nickname)),
  constraint members_slot_range check (slot between 1 and 3),
  constraint members_slot_unique unique (slot)
);
create unique index if not exists members_nickname_unique on public.members (lower(nickname));

-- 방 설정 (클라이언트 접근 불가, 함수에서만 사용)
create table if not exists public.room_settings (
  id int primary key default 1 check (id = 1),
  invite_code_hash text not null,
  max_members int not null default 3 check (max_members between 1 and 3)
);

-- 초대 코드 시도 기록 (무차별 대입 방지)
create table if not exists public.join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists join_attempts_user_time on public.join_attempts (user_id, created_at desc);
create index if not exists join_attempts_failed_time on public.join_attempts (created_at desc) where not succeeded;

-- 안건
create table if not exists public.agendas (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'discussing'
    check (status in ('discussing', 'decided', 'on_hold')),
  conclusion text,
  created_by uuid default auth.uid()
    references public.members (user_id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 목록 정렬용: 안건 수정 또는 새 메시지가 생길 때 갱신
  last_activity_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint agendas_title_format check (title ~ '\S' and char_length(title) <= 100),
  constraint agendas_description_length check (description is null or char_length(description) <= 2000),
  constraint agendas_conclusion_length check (conclusion is null or char_length(conclusion) <= 200),
  constraint agendas_decided_needs_conclusion
    check (status <> 'decided' or coalesce(conclusion, '') ~ '\S')
);
create index if not exists agendas_activity on public.agendas (last_activity_at desc) where deleted_at is null;

-- 메시지
-- 방을 나간 멤버의 메시지는 sender_id가 null이 되고, sender_nickname 스냅샷으로 작성자를 표시한다.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  agenda_id uuid not null references public.agendas (id) on delete cascade,
  sender_id uuid default auth.uid()
    references public.members (user_id) on update cascade on delete set null,
  sender_nickname text not null,
  content text not null,
  is_pinned boolean not null default false,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint messages_content_length check (char_length(content) <= 4000),
  constraint messages_content_not_blank check (deleted_at is not null or content ~ '\S')
);
create index if not exists messages_agenda_created on public.messages (agenda_id, created_at);
create index if not exists messages_agenda_pinned on public.messages (agenda_id) where is_pinned and deleted_at is null;

-- 읽음 상태
create table if not exists public.agenda_reads (
  agenda_id uuid not null references public.agendas (id) on delete cascade,
  user_id uuid not null references public.members (user_id) on update cascade on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (agenda_id, user_id)
);

-- ---------------------------------------------------------------------
-- 공통 헬퍼
-- ---------------------------------------------------------------------

-- 현재 사용자가 멤버인지 (RLS 정책과 Realtime 정책에서 사용)
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.members where user_id = (select auth.uid()));
$$;

-- 초대 코드 검증 + 시도 횟수 제한 + 시도 기록.
-- 실패해도 기록이 남도록 예외를 던지지 않고 에러 코드를 반환한다 (null = 통과).
create or replace function private.check_invite_code(p_code text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_ok boolean;
begin
  if v_uid is null then
    return 'NOT_AUTHENTICATED';
  end if;

  delete from public.join_attempts where created_at < now() - interval '1 day';

  -- 익명 ID당: 10분 동안 5번 실패하면 차단
  if (select count(*) from public.join_attempts
      where user_id = v_uid and not succeeded
        and created_at > now() - interval '10 minutes') >= 5 then
    return 'TOO_MANY_ATTEMPTS';
  end if;

  -- 전체: 익명 ID를 계속 새로 만드는 공격 대비, 10분 동안 30번 실패하면 모두 차단
  if (select count(*) from public.join_attempts
      where not succeeded and created_at > now() - interval '10 minutes') >= 30 then
    return 'TOO_MANY_ATTEMPTS';
  end if;

  select invite_code_hash into v_hash from public.room_settings where id = 1;
  if v_hash is null then
    return 'ROOM_NOT_CONFIGURED';
  end if;

  v_ok := extensions.crypt(btrim(coalesce(p_code, '')), v_hash) = v_hash;
  insert into public.join_attempts (user_id, succeeded) values (v_uid, v_ok);

  if not v_ok then
    return 'INVALID_CODE';
  end if;
  return null;
end;
$$;

create or replace function private.result(p_error text default null)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_error is null
    then jsonb_build_object('ok', true)
    else jsonb_build_object('ok', false, 'error', p_error)
  end;
$$;

-- ---------------------------------------------------------------------
-- 입장 / 멤버 관리 RPC
-- ---------------------------------------------------------------------

create or replace function public.join_room(p_code text, p_nickname text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_nickname text := btrim(coalesce(p_nickname, ''));
  v_err text;
  v_max int;
  v_slot int;
begin
  if v_uid is null then
    return private.result('NOT_AUTHENTICATED');
  end if;
  if exists (select 1 from public.members where user_id = v_uid) then
    return private.result();
  end if;

  v_err := private.check_invite_code(p_code);
  if v_err is not null then
    return private.result(v_err);
  end if;

  if char_length(v_nickname) not between 1 and 12 or v_nickname ~ '[[:cntrl:]]' then
    return private.result('INVALID_NICKNAME');
  end if;

  -- 동시에 여러 명이 입장해도 검사와 삽입이 한 번에 하나씩만 일어나도록 직렬화
  perform pg_advisory_xact_lock(hashtext('public.members'));

  if exists (select 1 from public.members where user_id = v_uid) then
    return private.result();
  end if;

  select least(max_members, 3) into v_max from public.room_settings where id = 1;
  if (select count(*) from public.members) >= v_max then
    return private.result('ROOM_FULL');
  end if;

  if exists (select 1 from public.members where lower(nickname) = lower(v_nickname)) then
    return private.result('NICKNAME_TAKEN');
  end if;

  select s into v_slot
  from generate_series(1, 3) as s
  where not exists (select 1 from public.members m where m.slot = s)
  order by s
  limit 1;
  if v_slot is null then
    return private.result('ROOM_FULL');
  end if;

  insert into public.members (user_id, nickname, slot) values (v_uid, v_nickname, v_slot);
  return private.result();
end;
$$;

-- 자리 가득 참 / 다시 연결 화면에서 닉네임 목록 제공 (코드 검증 후에만)
create or replace function public.get_member_list(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_err text;
begin
  v_err := private.check_invite_code(p_code);
  if v_err is not null then
    return private.result(v_err);
  end if;

  return jsonb_build_object(
    'ok', true,
    'members', coalesce(
      (select jsonb_agg(jsonb_build_object('nickname', nickname, 'slot', slot) order by slot)
       from public.members),
      '[]'::jsonb
    )
  );
end;
$$;

-- 기존 닉네임으로 다시 연결: 그 멤버의 user_id를 현재 익명 ID로 교체한다.
-- (한계: 초대 코드를 아는 사람은 누구의 닉네임이든 가져갈 수 있다. 친구끼리 쓰는 서비스라 허용.)
create or replace function public.reclaim_member(p_code text, p_nickname text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_nickname text := btrim(coalesce(p_nickname, ''));
  v_err text;
  v_target uuid;
begin
  v_err := private.check_invite_code(p_code);
  if v_err is not null then
    return private.result(v_err);
  end if;

  perform pg_advisory_xact_lock(hashtext('public.members'));

  select user_id into v_target from public.members where lower(nickname) = lower(v_nickname);
  if v_target is null then
    return private.result('MEMBER_NOT_FOUND');
  end if;
  if v_target = v_uid then
    return private.result();
  end if;
  if exists (select 1 from public.members where user_id = v_uid) then
    return private.result('ALREADY_MEMBER');
  end if;

  -- messages.sender_id, agendas.created_by, agenda_reads.user_id 는 on update cascade 로 따라온다
  update public.members set user_id = v_uid where user_id = v_target;
  return private.result();
end;
$$;

-- 방 나가기: 내 자리를 비운다. 내 메시지는 sender_nickname 으로 남는다.
create or replace function public.leave_room()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.members'));
  delete from public.members where user_id = auth.uid();
  return private.result();
end;
$$;

-- ---------------------------------------------------------------------
-- 채팅 / 읽음 RPC
-- ---------------------------------------------------------------------

-- 핀은 작성자와 상관없이 멤버 누구나 토글할 수 있다 (수정/삭제와 달리)
create or replace function public.set_message_pinned(p_message_id uuid, p_pinned boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_member() then
    return private.result('NOT_MEMBER');
  end if;
  update public.messages
  set is_pinned = coalesce(p_pinned, false)
  where id = p_message_id and deleted_at is null;
  if not found then
    return private.result('NOT_FOUND');
  end if;
  return private.result();
end;
$$;

create or replace function public.mark_agenda_read(p_agenda_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_member() then
    return;
  end if;
  insert into public.agenda_reads (agenda_id, user_id, last_read_at)
  values (p_agenda_id, auth.uid(), now())
  on conflict (agenda_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

create or replace function public.get_unread_counts()
returns table (agenda_id uuid, unread_count int)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.agenda_id, count(*)::int
  from public.messages m
  join public.agendas a on a.id = m.agenda_id and a.deleted_at is null
  left join public.agenda_reads r
    on r.agenda_id = m.agenda_id and r.user_id = (select auth.uid())
  where m.deleted_at is null
    and m.sender_id is distinct from (select auth.uid())
    and (r.last_read_at is null or m.created_at > r.last_read_at)
  group by m.agenda_id;
$$;

-- ---------------------------------------------------------------------
-- 트리거
-- ---------------------------------------------------------------------

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

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    new.last_activity_at := now();
    new.deleted_at := null;
  else
    new.created_at := old.created_at;
    if (new.title, new.description, new.status, new.conclusion, new.deleted_at)
       is distinct from (old.title, old.description, old.status, old.conclusion, old.deleted_at) then
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

drop trigger if exists agendas_normalize on public.agendas;
create trigger agendas_normalize
before insert or update on public.agendas
for each row execute function private.agendas_normalize();

create or replace function private.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select nickname into new.sender_nickname from public.members where user_id = new.sender_id;
  if new.sender_nickname is null then
    raise exception 'NOT_MEMBER' using errcode = '42501';
  end if;
  new.is_pinned := false;
  new.edited_at := null;
  new.deleted_at := null;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert
before insert on public.messages
for each row execute function private.messages_before_insert();

create or replace function private.messages_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := old.created_at;
  new.sender_nickname := old.sender_nickname;

  -- 이미 삭제된 메시지는 되살리거나 고칠 수 없다
  if old.deleted_at is not null then
    new.content := old.content;
    new.deleted_at := old.deleted_at;
    new.is_pinned := false;
    return new;
  end if;

  -- 삭제(소프트): 내용을 지우고 핀도 해제
  if new.deleted_at is not null then
    new.deleted_at := now();
    new.content := '';
    new.is_pinned := false;
    return new;
  end if;

  if new.content is distinct from old.content then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists messages_before_update on public.messages;
create trigger messages_before_update
before update on public.messages
for each row execute function private.messages_before_update();

-- 새 메시지가 오면 안건의 최근 활동 시각 갱신 (목록 정렬용)
create or replace function private.messages_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.agendas set last_activity_at = new.created_at where id = new.agenda_id;
  return null;
end;
$$;

drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert
after insert on public.messages
for each row execute function private.messages_after_insert();

-- ---------------------------------------------------------------------
-- 권한 (컬럼 단위) + RLS
-- ---------------------------------------------------------------------

alter table public.members enable row level security;
alter table public.room_settings enable row level security;
alter table public.join_attempts enable row level security;
alter table public.agendas enable row level security;
alter table public.messages enable row level security;
alter table public.agenda_reads enable row level security;

revoke all on table
  public.members, public.room_settings, public.join_attempts,
  public.agendas, public.messages, public.agenda_reads
from public, anon, authenticated;

-- room_settings, join_attempts: 아무 권한도 주지 않는다 (함수에서만 접근)
-- members: 조회만. 입장/퇴장/다시 연결은 반드시 RPC 경유
grant select on public.members to authenticated;
-- agendas: 수정 가능한 컬럼만 허용 (작성자, 시각 등은 DB가 채운다)
grant select on public.agendas to authenticated;
grant insert (title, description, status, conclusion) on public.agendas to authenticated;
grant update (title, description, status, conclusion, deleted_at) on public.agendas to authenticated;
-- messages: id는 낙관적 UI(클라이언트 생성 id)용. 핀은 RPC로만
grant select on public.messages to authenticated;
grant insert (id, agenda_id, content) on public.messages to authenticated;
grant update (content, deleted_at) on public.messages to authenticated;
-- agenda_reads: 조회만. 갱신은 mark_agenda_read RPC
grant select on public.agenda_reads to authenticated;

drop policy if exists members_select on public.members;
create policy members_select on public.members
  for select to authenticated
  using ((select public.is_member()));

drop policy if exists agendas_select on public.agendas;
create policy agendas_select on public.agendas
  for select to authenticated
  using ((select public.is_member()));

drop policy if exists agendas_insert on public.agendas;
create policy agendas_insert on public.agendas
  for insert to authenticated
  with check ((select public.is_member()) and created_by = (select auth.uid()));

drop policy if exists agendas_update on public.agendas;
create policy agendas_update on public.agendas
  for update to authenticated
  using ((select public.is_member()))
  with check ((select public.is_member()));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using ((select public.is_member()));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    (select public.is_member())
    and sender_id = (select auth.uid())
    and exists (select 1 from public.agendas a where a.id = agenda_id and a.deleted_at is null)
  );

drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
  for update to authenticated
  using ((select public.is_member()) and sender_id = (select auth.uid()))
  with check ((select public.is_member()) and sender_id = (select auth.uid()));

drop policy if exists agenda_reads_select_own on public.agenda_reads;
create policy agenda_reads_select_own on public.agenda_reads
  for select to authenticated
  using ((select public.is_member()) and user_id = (select auth.uid()));

-- 함수 실행 권한: 익명 세션(authenticated 역할)만 RPC 호출 가능
revoke all on all functions in schema private from public;
revoke all on function
  public.is_member(),
  public.join_room(text, text),
  public.get_member_list(text),
  public.reclaim_member(text, text),
  public.leave_room(),
  public.set_message_pinned(uuid, boolean),
  public.mark_agenda_read(uuid),
  public.get_unread_counts()
from public, anon;
grant execute on function
  public.is_member(),
  public.join_room(text, text),
  public.get_member_list(text),
  public.reclaim_member(text, text),
  public.leave_room(),
  public.set_message_pinned(uuid, boolean),
  public.mark_agenda_read(uuid),
  public.get_unread_counts()
to authenticated;

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------

-- Postgres Changes: agendas, messages, members (RLS가 적용되어 멤버에게만 전달된다)
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['agendas', 'messages', 'members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- Presence / Broadcast (private 채널 'room:*'): 멤버만 구독·전송 가능
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "room members can receive" on realtime.messages';
    execute 'drop policy if exists "room members can send" on realtime.messages';
    execute $p$
      create policy "room members can receive" on realtime.messages
        for select to authenticated
        using ((select public.is_member()) and (select realtime.topic()) like 'room:%')
    $p$;
    execute $p$
      create policy "room members can send" on realtime.messages
        for insert to authenticated
        with check ((select public.is_member()) and (select realtime.topic()) like 'room:%')
    $p$;
  end if;
end;
$$;
