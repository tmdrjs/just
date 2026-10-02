"use client";

import { useEffect, useState } from "react";
import { fetchYacht, yachtEnd, yachtHold, yachtJoin, yachtRoll, yachtScore, yachtStart } from "@/lib/actions";
import { memberColor } from "@/lib/constants";
import { useRoom } from "@/lib/store";
import {
  CATEGORY_HINT,
  CATEGORY_LABEL,
  isMyTurn,
  LOWER,
  players,
  seatOf,
  totals,
  UPPER,
  UPPER_BONUS,
  UPPER_BONUS_AT,
  YACHT_ROUNDS,
  yachtPoints,
  type YachtCategory,
  type YachtGame,
} from "@/lib/yacht";

/** "!야추" 메시지 자리에 그려지는 야추 판 */
export function YachtBoard({ messageId, pending }: { messageId: string; pending: boolean }) {
  const game = useRoom((s) => s.yachts[messageId]);

  // Realtime 이 늦거나 놓쳤을 때 대비해 한 번 직접 불러온다
  useEffect(() => {
    if (!game && !pending) void fetchYacht(messageId);
  }, [game, pending, messageId]);

  if (!game) {
    return (
      <div className="mt-1 rounded-xl border border-line bg-elev px-4 py-6 text-center text-sm text-muted">
        🎲 야추 판을 준비하고 있어요…
      </div>
    );
  }
  return <Board game={game} />;
}

function Board({ game }: { game: YachtGame }) {
  const userId = useRoom((s) => s.userId);
  const members = useRoom((s) => s.members);
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const list = players(game);
  const mySeat = seatOf(game, userId);
  const myTurn = isMyTurn(game, userId);
  const isHost = mySeat === 0 || (game.player1_id === null && mySeat !== null);
  const rolled = game.rolls_left < 3;
  const current = list[game.turn];
  const colorOf = (id: string | null) => memberColor(id ? members[id]?.slot : undefined);
  // 굴릴 때마다 바뀌는 값: 새로 굴린 주사위만 애니메이션
  const rollStamp = `${game.round}-${game.turn}-${game.rolls_left}`;

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    await fn();
    setBusy(false);
  };

  const ranking = list
    .map((p) => ({ ...p, total: totals(p.scores).total }))
    .sort((a, b) => b.total - a.total);
  const top = ranking[0]?.total ?? 0;
  const winners = ranking.filter((p) => p.total === top);

  return (
    <div className="mt-1 w-full max-w-[380px] rounded-xl border border-line bg-elev p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className="font-semibold text-fg">🎲 야추</span>
        <span className="text-muted">
          {game.status === "lobby"
            ? "대기실"
            : game.status === "playing"
              ? `라운드 ${game.round}/${YACHT_ROUNDS}`
              : game.end_reason === "complete"
                ? "게임 끝"
                : "중단됨"}
        </span>
        {isHost && game.status !== "finished" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => (confirmEnd ? void run(() => yachtEnd(game.message_id)) : setConfirmEnd(true))}
            onBlur={() => setConfirmEnd(false)}
            className={`ml-auto rounded-md px-2 py-0.5 text-[11px] ${
              confirmEnd ? "bg-accent text-white" : "text-muted hover:bg-hover hover:text-fg"
            }`}
          >
            {confirmEnd ? "정말 그만둘까요?" : "그만두기"}
          </button>
        )}
      </div>

      {game.status === "lobby" ? (
        <Lobby game={game} mySeat={mySeat} isHost={isHost} busy={busy} run={run} colorOf={colorOf} />
      ) : (
        <>
          {game.status === "playing" && (
            <>
              <div className="flex items-center justify-center gap-1.5 py-1">
                {game.dice.map((v, i) => (
                  <Die
                    key={i}
                    value={v}
                    held={game.held[i]}
                    rollStamp={rollStamp}
                    canToggle={myTurn && rolled && game.rolls_left > 0 && !busy}
                    onToggle={() => void run(() => yachtHold(game.message_id, i))}
                  />
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <p className={`min-w-0 flex-1 text-xs ${myTurn ? "font-semibold text-accent-hover" : "text-sub"}`}>
                  {myTurn
                    ? !rolled
                      ? "내 차례! 주사위를 굴리세요"
                      : game.rolls_left > 0
                        ? "고정할 주사위를 누르거나 다시 굴리세요"
                        : "점수 칸을 골라 주세요"
                    : (
                        <>
                          <span style={{ color: colorOf(current?.id ?? null) }}>{current?.name}</span> 님 차례
                          {rolled ? ` · ${3 - game.rolls_left}번 굴림` : ""}
                        </>
                      )}
                </p>
                {myTurn && (
                  <button
                    type="button"
                    disabled={busy || game.rolls_left === 0}
                    onClick={() => void run(() => yachtRoll(game.message_id))}
                    className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover disabled:bg-hover disabled:text-muted"
                  >
                    🎲 굴리기 ({game.rolls_left})
                  </button>
                )}
              </div>
            </>
          )}

          {game.status === "finished" && game.end_reason === "complete" && (
            <p className="mb-1 text-center text-sm font-semibold text-warn">
              🏆 {winners.map((w) => w.name).join(", ")} {winners.length > 1 ? "공동 우승" : "우승"}! ({top}점)
            </p>
          )}

          <ScoreTable
            game={game}
            mySeat={mySeat}
            canScore={myTurn && rolled && !busy}
            onScore={(c) => void run(() => yachtScore(game.message_id, c))}
            colorOf={colorOf}
          />
          {game.status === "finished" && (
            <p className="mt-1.5 text-[10px] text-muted">한 판 더? 채팅에 !야추 를 보내세요</p>
          )}
        </>
      )}
    </div>
  );
}

function Lobby({
  game,
  mySeat,
  isHost,
  busy,
  run,
  colorOf,
}: {
  game: YachtGame;
  mySeat: number | null;
  isHost: boolean;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  colorOf: (id: string | null) => string;
}) {
  const list = players(game);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-1.5">
        {list.map((p) => (
          <li key={p.seat} className="flex items-center gap-1 rounded-full border border-line bg-bg px-2.5 py-1 text-xs">
            <span className="size-2 rounded-full" style={{ background: colorOf(p.id) }} />
            <span style={{ color: colorOf(p.id) }}>{p.name}</span>
            {p.seat === 0 && <span className="text-[10px] text-muted">방장</span>}
          </li>
        ))}
        {Array.from({ length: 3 - list.length }, (_, i) => (
          <li key={`empty-${i}`} className="rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-muted">
            빈자리
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        {mySeat === null && game.player_count < 3 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => yachtJoin(game.message_id))}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
          >
            참가하기
          </button>
        )}
        {isHost && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => yachtStart(game.message_id))}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-hover"
          >
            {game.player_count === 1 ? "혼자 시작하기" : `${game.player_count}명으로 시작하기`}
          </button>
        )}
        <p className="text-[11px] text-muted">
          {isHost ? "다른 멤버가 참가하면 함께 해요" : mySeat !== null ? "방장이 시작하길 기다리는 중" : "최대 3명"}
        </p>
      </div>
      <p className="text-[10px] text-muted">
        주사위 5개 · 한 차례 최대 3번 굴리기 · 12라운드 · 1~6 합 {UPPER_BONUS_AT} 이상이면 +{UPPER_BONUS}
      </p>
    </div>
  );
}

function ScoreTable({
  game,
  mySeat,
  canScore,
  onScore,
  colorOf,
}: {
  game: YachtGame;
  mySeat: number | null;
  canScore: boolean;
  onScore: (c: YachtCategory) => void;
  colorOf: (id: string | null) => string;
}) {
  const list = players(game);
  const sums = list.map((p) => totals(p.scores));
  const playing = game.status === "playing";

  const row = (c: YachtCategory) => (
    <tr key={c} className="border-t border-line/60">
      <th scope="row" className="py-1 pr-2 text-left font-normal text-sub" title={CATEGORY_HINT[c]}>
        {CATEGORY_LABEL[c]}
      </th>
      {list.map((p) => {
        const done = p.scores[c];
        const selectable = canScore && p.seat === mySeat && done === undefined;
        const turnCol = playing && p.seat === game.turn;
        return (
          <td key={p.seat} className={`px-0.5 py-0.5 text-center tabular-nums ${turnCol ? "bg-hover/50" : ""}`}>
            {done !== undefined ? (
              <span className={done === 0 ? "text-muted" : "text-fg"}>{done}</span>
            ) : selectable ? (
              <button
                type="button"
                onClick={() => onScore(c)}
                title={`${CATEGORY_LABEL[c]}에 ${yachtPoints(game.dice, c)}점 적기`}
                className="w-full rounded-md border border-sky-400/40 bg-sky-400/10 py-0.5 font-semibold text-sky-300 hover:bg-sky-400/25"
              >
                {yachtPoints(game.dice, c)}
              </button>
            ) : null}
          </td>
        );
      })}
    </tr>
  );

  return (
    <table className="mt-2 w-full border-collapse text-xs">
      <thead>
        <tr>
          <th className="pb-1 text-left text-[10px] font-normal text-muted">족보</th>
          {list.map((p) => (
            <th
              key={p.seat}
              className={`max-w-[5rem] truncate px-1 pb-1 text-center font-semibold ${
                playing && p.seat === game.turn ? "underline decoration-2 underline-offset-4" : ""
              }`}
              style={{ color: colorOf(p.id) }}
              title={p.id ? p.name : `${p.name} (나감)`}
            >
              {p.name}
              {!p.id && <span className="text-[9px] font-normal text-muted"> (나감)</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {UPPER.map(row)}
        <tr className="border-t border-line text-[11px] text-muted">
          <th scope="row" className="py-1 text-left font-normal">
            보너스 <span className="text-[10px]">({UPPER_BONUS_AT}↑ +{UPPER_BONUS})</span>
          </th>
          {sums.map((s, i) => (
            <td key={i} className="text-center tabular-nums">
              {s.bonus ? <span className="font-semibold text-ok">+{s.bonus}</span> : `${s.upper}/${UPPER_BONUS_AT}`}
            </td>
          ))}
        </tr>
        {LOWER.map(row)}
        <tr className="border-t-2 border-line">
          <th scope="row" className="py-1.5 text-left font-semibold">
            합계
          </th>
          {sums.map((s, i) => (
            <td key={i} className="text-center text-sm font-bold tabular-nums">
              {s.total}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Die({
  value,
  held,
  rollStamp,
  canToggle,
  onToggle,
}: {
  value: number;
  held: boolean;
  rollStamp: string;
  canToggle: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!canToggle}
      onClick={onToggle}
      aria-pressed={held}
      aria-label={value ? `주사위 ${value}${held ? " (고정)" : ""}` : "아직 안 굴린 주사위"}
      className={`relative flex flex-col items-center transition-transform ${held ? "-translate-y-1" : ""} ${
        canToggle ? "cursor-pointer" : "cursor-default"
      }`}
    >
      {/* rollStamp 이 바뀔 때(새로 굴렸을 때)만 다시 그려져 굴러가는 애니메이션이 나온다 */}
      <span
        key={rollStamp}
        className={`grid size-11 grid-cols-3 grid-rows-3 gap-0.5 rounded-lg p-1.5 shadow-md ${
          value ? "bg-[#f4efe6]" : "bg-hover"
        } ${held ? "ring-2 ring-accent ring-offset-2 ring-offset-elev" : ""} ${value && !held ? "animate-dice" : ""}`}
      >
        {value ? (
          Array.from({ length: 9 }, (_, i) => (
            <span
              key={i}
              className={`m-auto size-[7px] rounded-full ${PIPS[value].includes(i) ? (value === 1 ? "bg-accent" : "bg-[#1a1a1a]") : ""}`}
            />
          ))
        ) : (
          <span className="col-span-3 row-span-3 m-auto text-sm text-muted">?</span>
        )}
      </span>
      <span className={`mt-1 h-3 text-[9px] font-semibold ${held ? "text-accent-hover" : "text-transparent"}`}>고정</span>
    </button>
  );
}
