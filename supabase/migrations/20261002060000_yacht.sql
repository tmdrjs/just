-- =====================================================================
-- 채팅 야추(Yacht): 아무 안건 채팅에서 "!야추" 를 보내면 그 메시지에 야추 판이 생긴다.
--
-- 규칙 (51 Worldwide Games 방식)
--   - 주사위 5개, 한 차례에 최대 3번 굴리기 (굴리는 사이 원하는 주사위 고정), 12라운드
--   - 족보: 1~6(그 눈의 합), 초이스(합), 포카드(같은 눈 4개 이상 → 합), 풀하우스(3+2 → 합),
--           S.스트레이트 15, L.스트레이트 30, 야추(5개 같음) 50
--   - 1~6 칸 합이 63 이상이면 보너스 +35 (표시·합계는 클라이언트가 계산)
--   - "!야추" 를 보낸 사람이 방장(1번 자리). 다른 멤버는 대기실에서 참가 (최대 3명), 방장이 시작
--   - 주사위는 서버가 굴린다. 모든 진행은 아래 함수로만 바뀐다 (클라이언트는 읽기만)
-- =====================================================================

create table if not exists public.yacht_games (
  message_id uuid primary key references public.messages (id) on delete cascade,
  agenda_id uuid not null references public.agendas (id) on delete cascade,
  -- 자리 1~3 (1번 = 방장). 멤버가 나가면 null, 다시 연결하면 따라간다
  player1_id uuid references public.members (user_id) on update cascade on delete set null,
  player2_id uuid references public.members (user_id) on update cascade on delete set null,
  player3_id uuid references public.members (user_id) on update cascade on delete set null,
  player1_name text not null,
  player2_name text,
  player3_name text,
  player_count smallint not null default 1 check (player_count between 1 and 3),
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  end_reason text check (end_reason in ('complete', 'cancelled')),
  -- 지금 차례인 자리 (0부터)
  turn smallint not null default 0,
  round smallint not null default 1 check (round between 1 and 13),
  -- 0 = 아직 안 굴림
  dice smallint[] not null default '{0,0,0,0,0}',
  held boolean[] not null default '{f,f,f,f,f}',
  rolls_left smallint not null default 3 check (rolls_left between 0 and 3),
  -- 자리별 점수: [{"ones": 3, ...}, {...}, {...}]
  scores jsonb not null default '[{}, {}, {}]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint yacht_dice_format check (cardinality(dice) = 5 and 0 <= all (dice) and 6 >= all (dice)),
  constraint yacht_held_format check (cardinality(held) = 5)
);
create index if not exists yacht_games_agenda on public.yacht_games (agenda_id);

alter table public.yacht_games enable row level security;
revoke all on table public.yacht_games from public, anon, authenticated;
grant select on public.yacht_games to authenticated;

drop policy if exists yacht_games_select on public.yacht_games;
create policy yacht_games_select on public.yacht_games
  for select to authenticated
  using ((select public.is_member()));

-- "!야추" 메시지가 들어오면 대기실 생성
create or replace function private.messages_start_yacht()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if btrim(new.content) = '!야추' and new.sender_id is not null then
    insert into public.yacht_games (message_id, agenda_id, player1_id, player1_name)
    values (new.id, new.agenda_id, new.sender_id, new.sender_nickname)
    on conflict (message_id) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists messages_start_yacht on public.messages;
create trigger messages_start_yacht
after insert on public.messages
for each row execute function private.messages_start_yacht();

-- 지금 차례인 사람이 방을 나가 자리가 비면(멤버 삭제 → player*_id null) 다음 사람에게 넘긴다.
-- 남은 참가자가 없으면 게임을 끝낸다.
create or replace function private.yacht_skip_absent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if new.status <> 'playing' then
    return new;
  end if;
  v_ids := array[new.player1_id, new.player2_id, new.player3_id];
  if v_ids[new.turn + 1] is not null then
    return new;
  end if;
  if not exists (select 1 from unnest(v_ids[1:new.player_count]) as x where x is not null) then
    new.status := 'finished';
    new.end_reason := 'cancelled';
    return new;
  end if;
  loop
    new.turn := new.turn + 1;
    if new.turn >= new.player_count then
      new.turn := 0;
      new.round := new.round + 1;
    end if;
    exit when v_ids[new.turn + 1] is not null;
  end loop;
  if new.round > 12 then
    new.round := 13;
    new.status := 'finished';
    new.end_reason := 'complete';
  end if;
  new.dice := '{0,0,0,0,0}';
  new.held := '{f,f,f,f,f}';
  new.rolls_left := 3;
  return new;
end;
$$;

drop trigger if exists yacht_skip_absent on public.yacht_games;
create trigger yacht_skip_absent
before update on public.yacht_games
for each row execute function private.yacht_skip_absent();

-- ---------------------------------------------------------------------
-- 점수 계산 (클라이언트 src/lib/yacht.ts 의 yachtPoints 와 같은 규칙)
-- ---------------------------------------------------------------------
create or replace function private.yacht_points(p_dice smallint[], p_category text)
returns int
language plpgsql
immutable
set search_path = ''
as $$
declare
  c int[] := array[0, 0, 0, 0, 0, 0];
  v_sum int := 0;
  d smallint;
  v_max int;
begin
  foreach d in array p_dice loop
    c[d] := c[d] + 1;
    v_sum := v_sum + d;
  end loop;
  v_max := greatest(c[1], c[2], c[3], c[4], c[5], c[6]);

  return case p_category
    when 'ones' then c[1] * 1
    when 'twos' then c[2] * 2
    when 'threes' then c[3] * 3
    when 'fours' then c[4] * 4
    when 'fives' then c[5] * 5
    when 'sixes' then c[6] * 6
    when 'choice' then v_sum
    when 'four_kind' then case when v_max >= 4 then v_sum else 0 end
    when 'full_house' then
      case when (select array_agg(x order by x) from unnest(c) as x where x > 0) = array[2, 3]
        then v_sum else 0 end
    when 'small_straight' then
      case when (c[1] > 0 and c[2] > 0 and c[3] > 0 and c[4] > 0)
             or (c[2] > 0 and c[3] > 0 and c[4] > 0 and c[5] > 0)
             or (c[3] > 0 and c[4] > 0 and c[5] > 0 and c[6] > 0)
        then 15 else 0 end
    when 'large_straight' then
      case when (c[1] > 0 and c[2] > 0 and c[3] > 0 and c[4] > 0 and c[5] > 0)
             or (c[2] > 0 and c[3] > 0 and c[4] > 0 and c[5] > 0 and c[6] > 0)
        then 30 else 0 end
    when 'yacht' then case when v_max = 5 then 50 else 0 end
  end;
end;
$$;

-- 게임을 잠그고 공통 검사. 현재 사용자 자리(0~2, 아니면 null)를 함께 돌려준다
create or replace function private.yacht_lock(p_message_id uuid, out g public.yacht_games, out err text, out seat int)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_member() then
    err := 'NOT_MEMBER';
    return;
  end if;
  select * into g from public.yacht_games where message_id = p_message_id for update;
  if not found then
    err := 'NOT_FOUND';
    return;
  end if;
  if exists (select 1 from public.messages where id = p_message_id and deleted_at is not null) then
    err := 'GAME_CLOSED';
    return;
  end if;
  seat := case
    when v_uid = g.player1_id then 0
    when v_uid = g.player2_id then 1
    when v_uid = g.player3_id then 2
  end;
end;
$$;

-- 진행 중 공통 검사: 지금 내 차례인가
create or replace function private.yacht_turn_check(g public.yacht_games, p_seat int)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when g.status = 'lobby' then 'NOT_STARTED'
    when g.status = 'finished' then 'GAME_OVER'
    when p_seat is null then 'NOT_PLAYER'
    when p_seat <> g.turn then 'NOT_YOUR_TURN'
  end;
$$;

-- ---------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------

create or replace function public.yacht_join(p_message_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l record;
  v_game public.yacht_games;
  v_name text;
begin
  select * into l from private.yacht_lock(p_message_id);
  if l.err is not null then
    return private.result(l.err);
  end if;
  if l.seat is not null then
    return jsonb_build_object('ok', true, 'game', to_jsonb(l.g));
  end if;
  if (l.g).status <> 'lobby' then
    return private.result('GAME_STARTED');
  end if;
  if (l.g).player_count >= 3 then
    return private.result('FULL');
  end if;
  v_name := (select nickname from public.members where user_id = auth.uid());

  update public.yacht_games set
    player2_id = case when player_count = 1 then auth.uid() else player2_id end,
    player2_name = case when player_count = 1 then v_name else player2_name end,
    player3_id = case when player_count = 2 then auth.uid() else player3_id end,
    player3_name = case when player_count = 2 then v_name else player3_name end,
    player_count = player_count + 1,
    updated_at = now()
  where message_id = p_message_id
  returning * into v_game;
  return jsonb_build_object('ok', true, 'game', to_jsonb(v_game));
end;
$$;

-- 방장이 시작 (방장이 방을 나갔으면 남은 참가자 누구나)
create or replace function public.yacht_start(p_message_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l record;
  v_game public.yacht_games;
begin
  select * into l from private.yacht_lock(p_message_id);
  if l.err is not null then
    return private.result(l.err);
  end if;
  if (l.g).status <> 'lobby' then
    return private.result('GAME_STARTED');
  end if;
  if l.seat is distinct from 0 and not ((l.g).player1_id is null and l.seat is not null) then
    return private.result('NOT_HOST');
  end if;

  update public.yacht_games set
    status = 'playing',
    turn = 0,
    round = 1,
    dice = '{0,0,0,0,0}',
    held = '{f,f,f,f,f}',
    rolls_left = 3,
    updated_at = now()
  where message_id = p_message_id
  returning * into v_game;
  return jsonb_build_object('ok', true, 'game', to_jsonb(v_game));
end;
$$;

-- 굴리기: 첫 굴림은 5개 모두, 이후는 고정 안 한 주사위만
create or replace function public.yacht_roll(p_message_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l record;
  v_game public.yacht_games;
  v_err text;
  v_dice smallint[];
  v_first boolean;
begin
  select * into l from private.yacht_lock(p_message_id);
  if l.err is not null then
    return private.result(l.err);
  end if;
  v_err := private.yacht_turn_check(l.g, l.seat);
  if v_err is not null then
    return private.result(v_err);
  end if;
  if (l.g).rolls_left <= 0 then
    return private.result('NO_ROLLS_LEFT');
  end if;

  v_first := (l.g).rolls_left = 3;
  v_dice := (l.g).dice;
  for i in 1..5 loop
    if v_first or not (l.g).held[i] then
      v_dice[i] := floor(random() * 6)::smallint + 1;
    end if;
  end loop;

  update public.yacht_games set
    dice = v_dice,
    held = case when v_first then '{f,f,f,f,f}'::boolean[] else held end,
    rolls_left = rolls_left - 1,
    updated_at = now()
  where message_id = p_message_id
  returning * into v_game;
  return jsonb_build_object('ok', true, 'game', to_jsonb(v_game));
end;
$$;

-- 주사위 고정/해제 (굴린 뒤, 남은 굴림이 있을 때만)
create or replace function public.yacht_hold(p_message_id uuid, p_index int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l record;
  v_game public.yacht_games;
  v_err text;
begin
  select * into l from private.yacht_lock(p_message_id);
  if l.err is not null then
    return private.result(l.err);
  end if;
  v_err := private.yacht_turn_check(l.g, l.seat);
  if v_err is not null then
    return private.result(v_err);
  end if;
  if (l.g).rolls_left = 3 then
    return private.result('ROLL_FIRST');
  end if;
  if (l.g).rolls_left = 0 then
    return private.result('NO_ROLLS_LEFT');
  end if;
  if p_index is null or p_index not between 0 and 4 then
    return private.result('INVALID_DIE');
  end if;

  update public.yacht_games set
    held[p_index + 1] = not held[p_index + 1],
    updated_at = now()
  where message_id = p_message_id
  returning * into v_game;
  return jsonb_build_object('ok', true, 'game', to_jsonb(v_game));
end;
$$;

-- 점수 칸 고르기 → 다음 사람 차례 (나간 사람 자리는 건너뜀), 12라운드 끝나면 종료
create or replace function public.yacht_score(p_message_id uuid, p_category text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l record;
  v_game public.yacht_games;
  v_err text;
  v_points int;
  v_turn int;
  v_round int;
  v_ids uuid[];
begin
  select * into l from private.yacht_lock(p_message_id);
  if l.err is not null then
    return private.result(l.err);
  end if;
  v_err := private.yacht_turn_check(l.g, l.seat);
  if v_err is not null then
    return private.result(v_err);
  end if;
  if (l.g).rolls_left = 3 then
    return private.result('ROLL_FIRST');
  end if;
  v_points := private.yacht_points((l.g).dice, p_category);
  if v_points is null then
    return private.result('INVALID_CATEGORY');
  end if;
  if (l.g).scores -> l.seat ? p_category then
    return private.result('CATEGORY_USED');
  end if;

  -- 다음 차례: 자리를 돌면서 아직 방에 있는 사람을 찾는다. 한 바퀴 돌면 다음 라운드
  v_ids := array[(l.g).player1_id, (l.g).player2_id, (l.g).player3_id];
  v_turn := (l.g).turn;
  v_round := (l.g).round;
  for k in 1..3 loop
    v_turn := v_turn + 1;
    if v_turn >= (l.g).player_count then
      v_turn := 0;
      v_round := v_round + 1;
    end if;
    exit when v_ids[v_turn + 1] is not null;
  end loop;

  update public.yacht_games set
    scores = jsonb_set(scores, array[l.seat::text, p_category], to_jsonb(v_points)),
    turn = v_turn,
    round = least(v_round, 13),
    status = case when v_round > 12 then 'finished' else 'playing' end,
    end_reason = case when v_round > 12 then 'complete' end,
    dice = '{0,0,0,0,0}',
    held = '{f,f,f,f,f}',
    rolls_left = 3,
    updated_at = now()
  where message_id = p_message_id
  returning * into v_game;
  return jsonb_build_object('ok', true, 'game', to_jsonb(v_game), 'points', v_points);
end;
$$;

-- 그만두기: 방장(방장이 나갔으면 남은 참가자)이 대기실/게임을 끝낸다
create or replace function public.yacht_end(p_message_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l record;
  v_game public.yacht_games;
begin
  select * into l from private.yacht_lock(p_message_id);
  if l.err is not null then
    return private.result(l.err);
  end if;
  if (l.g).status = 'finished' then
    return private.result('GAME_OVER');
  end if;
  if l.seat is distinct from 0 and not ((l.g).player1_id is null and l.seat is not null) then
    return private.result('NOT_HOST');
  end if;

  update public.yacht_games set
    status = 'finished',
    end_reason = 'cancelled',
    updated_at = now()
  where message_id = p_message_id
  returning * into v_game;
  return jsonb_build_object('ok', true, 'game', to_jsonb(v_game));
end;
$$;

revoke all on function
  public.yacht_join(uuid), public.yacht_start(uuid), public.yacht_roll(uuid),
  public.yacht_hold(uuid, int), public.yacht_score(uuid, text), public.yacht_end(uuid)
from public, anon;
grant execute on function
  public.yacht_join(uuid), public.yacht_start(uuid), public.yacht_roll(uuid),
  public.yacht_hold(uuid, int), public.yacht_score(uuid, text), public.yacht_end(uuid)
to authenticated;
revoke all on all functions in schema private from public;

-- Realtime: 기존 room:db 채널이 이 테이블 변경도 받는다
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'yacht_games'
  ) then
    alter publication supabase_realtime add table public.yacht_games;
  end if;
end;
$$;
