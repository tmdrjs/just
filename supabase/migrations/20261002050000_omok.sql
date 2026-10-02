-- =====================================================================
-- 채팅 오목: 아무 안건 채팅에서 "!오목" 을 보내면 그 메시지에 15×15 오목판이 생긴다.
--
-- - "!오목" 을 보낸 사람이 흑(선), 다른 멤버 중 백 차례에 먼저 두는 사람이 백
-- - 다섯 개 이상 이으면 승리. 흑은 쌍삼(열린 3을 동시에 두 개) 금지 (단, 그 수로 오목이 되면 승리)
-- - 착수·판정은 모두 이 함수들이 서버에서 처리한다 (클라이언트는 omok_games 를 읽기만 함)
-- =====================================================================

create table if not exists public.omok_games (
  message_id uuid primary key references public.messages (id) on delete cascade,
  agenda_id uuid not null references public.agendas (id) on delete cascade,
  black_id uuid references public.members (user_id) on update cascade on delete set null,
  white_id uuid references public.members (user_id) on update cascade on delete set null,
  black_nickname text not null,
  white_nickname text,
  -- 225칸: '.' 빈칸 / 'b' 흑 / 'w' 백. 칸 번호 = y * 15 + x
  board text not null default repeat('.', 225),
  -- 둔 순서대로 칸 번호
  moves smallint[] not null default '{}',
  status text not null default 'playing' check (status in ('playing', 'finished')),
  winner text check (winner in ('b', 'w')),
  end_reason text check (end_reason in ('five', 'resign', 'full', 'cancelled')),
  win_line smallint[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint omok_board_format check (char_length(board) = 225 and board ~ '^[.bw]+$')
);
create index if not exists omok_games_agenda on public.omok_games (agenda_id);

alter table public.omok_games enable row level security;
revoke all on table public.omok_games from public, anon, authenticated;
grant select on public.omok_games to authenticated;

drop policy if exists omok_games_select on public.omok_games;
create policy omok_games_select on public.omok_games
  for select to authenticated
  using ((select public.is_member()));

-- "!오목" 메시지가 들어오면 대국 생성
create or replace function private.messages_start_omok()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if btrim(new.content) = '!오목' and new.sender_id is not null then
    insert into public.omok_games (message_id, agenda_id, black_id, black_nickname)
    values (new.id, new.agenda_id, new.sender_id, new.sender_nickname)
    on conflict (message_id) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists messages_start_omok on public.messages;
create trigger messages_start_omok
after insert on public.messages
for each row execute function private.messages_start_omok();

-- ---------------------------------------------------------------------
-- 판정 헬퍼
-- ---------------------------------------------------------------------

-- (x, y) 를 중심으로 한 방향의 11칸 (중심 = 6번째). 판 밖은 'x'
create or replace function private.omok_line(p_board text, p_x int, p_y int, p_dx int, p_dy int)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_line text := '';
  v_cx int;
  v_cy int;
begin
  for k in -5..5 loop
    v_cx := p_x + k * p_dx;
    v_cy := p_y + k * p_dy;
    if v_cx < 0 or v_cx > 14 or v_cy < 0 or v_cy > 14 then
      v_line := v_line || 'x';
    else
      v_line := v_line || substr(p_board, v_cy * 15 + v_cx + 1, 1);
    end if;
  end loop;
  return v_line;
end;
$$;

-- 중심(6번째) 흑돌을 포함한 "열린 3" 이 있는가:
-- 빈칸 하나에 흑을 더 놓아 중심과 새 돌을 모두 포함하는 열린 4(.bbbb.)를 만들 수 있으면 열린 3
create or replace function private.omok_open_three(p_line text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_try text;
begin
  for e in 1..11 loop
    continue when substr(p_line, e, 1) <> '.';
    v_try := overlay(p_line placing 'b' from e for 1);
    for s in 1..6 loop
      if substr(v_try, s, 6) = '.bbbb.'
         and s + 1 <= 6 and 6 <= s + 4
         and s + 1 <= e and e <= s + 4 then
        return true;
      end if;
    end loop;
  end loop;
  return false;
end;
$$;

-- (x, y) 에 놓인 p_color 돌이 다섯 이상을 이루면 그 줄의 칸 번호들, 아니면 null
create or replace function private.omok_five(p_board text, p_x int, p_y int, p_color text)
returns smallint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_dirs int[] := array[[1, 0], [0, 1], [1, 1], [1, -1]];
  v_line smallint[];
  v_sign int;
  v_cx int;
  v_cy int;
begin
  for d in 1..4 loop
    v_line := array[(p_y * 15 + p_x)::smallint];
    -- 한 방향과 그 반대 방향으로 같은 색이 이어지는 만큼 센다
    foreach v_sign in array array[1, -1] loop
      for k in 1..14 loop
        v_cx := p_x + k * v_sign * v_dirs[d][1];
        v_cy := p_y + k * v_sign * v_dirs[d][2];
        exit when v_cx not between 0 and 14 or v_cy not between 0 and 14;
        exit when substr(p_board, v_cy * 15 + v_cx + 1, 1) <> p_color;
        v_line := v_line || (v_cy * 15 + v_cx)::smallint;
      end loop;
    end loop;
    if cardinality(v_line) >= 5 then
      return v_line;
    end if;
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------

create or replace function public.omok_play(p_message_id uuid, p_cell int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  g public.omok_games;
  v_color text;
  v_x int;
  v_y int;
  v_board text;
  v_win smallint[];
  v_threes int := 0;
  v_dirs int[] := array[[1, 0], [0, 1], [1, 1], [1, -1]];
begin
  if not public.is_member() then
    return private.result('NOT_MEMBER');
  end if;

  select * into g from public.omok_games where message_id = p_message_id for update;
  if not found then
    return private.result('NOT_FOUND');
  end if;
  if exists (select 1 from public.messages where id = p_message_id and deleted_at is not null) then
    return private.result('GAME_CLOSED');
  end if;
  if g.status <> 'playing' then
    return private.result('GAME_OVER');
  end if;
  if p_cell is null or p_cell not between 0 and 224 then
    return private.result('INVALID_CELL');
  end if;
  if substr(g.board, p_cell + 1, 1) <> '.' then
    return private.result('OCCUPIED');
  end if;

  v_color := case when cardinality(g.moves) % 2 = 0 then 'b' else 'w' end;
  if v_color = 'b' then
    if g.black_id is distinct from v_uid then
      return private.result(case when v_uid = g.white_id then 'NOT_YOUR_TURN' else 'NOT_PLAYER' end);
    end if;
  else
    if g.white_id is null then
      if v_uid = g.black_id then
        return private.result('WAITING_OPPONENT');
      end if;
      -- 백 차례에 먼저 둔 멤버가 백이 된다
      g.white_id := v_uid;
      g.white_nickname := (select nickname from public.members where user_id = v_uid);
    elsif g.white_id <> v_uid then
      return private.result(case when v_uid = g.black_id then 'NOT_YOUR_TURN' else 'NOT_PLAYER' end);
    end if;
  end if;

  v_x := p_cell % 15;
  v_y := p_cell / 15;
  v_board := overlay(g.board placing v_color from p_cell + 1 for 1);
  v_win := private.omok_five(v_board, v_x, v_y, v_color);

  -- 흑 쌍삼 금지 (오목이 되는 수는 예외)
  if v_color = 'b' and v_win is null then
    for d in 1..4 loop
      if private.omok_open_three(private.omok_line(v_board, v_x, v_y, v_dirs[d][1], v_dirs[d][2])) then
        v_threes := v_threes + 1;
      end if;
    end loop;
    if v_threes >= 2 then
      return private.result('FORBIDDEN_33');
    end if;
  end if;

  update public.omok_games set
    board = v_board,
    moves = g.moves || p_cell::smallint,
    white_id = g.white_id,
    white_nickname = g.white_nickname,
    status = case when v_win is not null or cardinality(g.moves) + 1 >= 225 then 'finished' else 'playing' end,
    winner = case when v_win is not null then v_color end,
    end_reason = case when v_win is not null then 'five' when cardinality(g.moves) + 1 >= 225 then 'full' end,
    win_line = v_win,
    updated_at = now()
  where message_id = p_message_id
  returning * into g;

  return jsonb_build_object('ok', true, 'game', to_jsonb(g));
end;
$$;

-- 기권 (상대가 아직 없으면 대국 취소)
create or replace function public.omok_resign(p_message_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  g public.omok_games;
begin
  if not public.is_member() then
    return private.result('NOT_MEMBER');
  end if;
  select * into g from public.omok_games where message_id = p_message_id for update;
  if not found then
    return private.result('NOT_FOUND');
  end if;
  if g.status <> 'playing' then
    return private.result('GAME_OVER');
  end if;
  if v_uid is distinct from g.black_id and v_uid is distinct from g.white_id then
    return private.result('NOT_PLAYER');
  end if;

  update public.omok_games set
    status = 'finished',
    winner = case
      when g.white_id is null then null
      when v_uid = g.black_id then 'w'
      else 'b'
    end,
    end_reason = case when g.white_id is null then 'cancelled' else 'resign' end,
    updated_at = now()
  where message_id = p_message_id
  returning * into g;

  return jsonb_build_object('ok', true, 'game', to_jsonb(g));
end;
$$;

revoke all on function public.omok_play(uuid, int), public.omok_resign(uuid) from public, anon;
grant execute on function public.omok_play(uuid, int), public.omok_resign(uuid) to authenticated;
revoke all on all functions in schema private from public;

-- Realtime: 기존 room:db 채널이 이 테이블 변경도 받는다
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'omok_games'
  ) then
    alter publication supabase_realtime add table public.omok_games;
  end if;
end;
$$;
