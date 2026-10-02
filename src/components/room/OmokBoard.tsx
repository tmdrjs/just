"use client";

import { useEffect, useState } from "react";
import { fetchGame, playOmok, resignOmok } from "@/lib/actions";
import { memberColor } from "@/lib/constants";
import { canPlay, OMOK_SIZE, OMOK_STARS, turnOf, type OmokGame } from "@/lib/omok";
import { useRoom } from "@/lib/store";

const CELLS = Array.from({ length: OMOK_SIZE * OMOK_SIZE }, (_, i) => i);
const LINES = Array.from({ length: OMOK_SIZE }, (_, i) => i + 0.5);

/** "!오목" 메시지 자리에 그려지는 오목판 */
export function OmokBoard({ messageId, pending }: { messageId: string; pending: boolean }) {
  const game = useRoom((s) => s.games[messageId]);

  // Realtime 이 늦거나 놓쳤을 때 대비해 한 번 직접 불러온다
  useEffect(() => {
    if (!game && !pending) void fetchGame(messageId);
  }, [game, pending, messageId]);

  if (!game) {
    return (
      <div className="mt-1 rounded-xl border border-line bg-elev px-4 py-6 text-center text-sm text-muted">
        🎮 오목판을 준비하고 있어요…
      </div>
    );
  }
  return <Board game={game} />;
}

function Board({ game }: { game: OmokGame }) {
  const userId = useRoom((s) => s.userId);
  const members = useRoom((s) => s.members);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const turn = turnOf(game);
  const myTurn = canPlay(game, userId);
  const isPlayer = game.black_id === userId || game.white_id === userId;
  const last = game.moves[game.moves.length - 1];
  const winSet = new Set(game.win_line ?? []);
  const blackSlot = game.black_id ? members[game.black_id]?.slot : undefined;
  const whiteSlot = game.white_id ? members[game.white_id]?.slot : undefined;

  const place = async (cell: number) => {
    if (!myTurn || busy || game.board[cell] !== ".") return;
    setBusy(true);
    setHover(null);
    await playOmok(game.message_id, cell);
    setBusy(false);
  };

  const winnerName = game.winner === "b" ? game.black_nickname : game.white_nickname;
  let status: string;
  if (game.status === "finished") {
    status =
      game.end_reason === "five"
        ? `${game.winner === "b" ? "●" : "○"} ${winnerName} 승리! 🎉`
        : game.end_reason === "resign"
          ? `${game.winner === "b" ? game.white_nickname : game.black_nickname} 기권 · ${winnerName} 승리`
          : game.end_reason === "full"
            ? "판이 꽉 찼어요 · 무승부"
            : "대국이 취소됐어요";
  } else if (turn === "w" && !game.white_id) {
    status = myTurn ? "백으로 참가하려면 원하는 자리에 두세요" : "백을 기다리는 중 · 다른 멤버가 먼저 두면 백이 돼요";
  } else {
    status = `${turn === "b" ? "● 흑" : "○ 백"} 차례${myTurn ? " · 내 차례예요!" : ""}`;
  }

  return (
    <div className="mt-1 w-full max-w-[380px] rounded-xl border border-line bg-elev p-3">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className="font-semibold text-fg">🎮 오목</span>
        <span className="flex min-w-0 items-center gap-1">
          <Stone color="b" className="size-3" />
          <span className="truncate font-medium" style={{ color: memberColor(blackSlot) }}>
            {game.black_nickname}
          </span>
        </span>
        <span className="text-muted">vs</span>
        <span className="flex min-w-0 items-center gap-1">
          <Stone color="w" className="size-3" />
          {game.white_nickname ? (
            <span className="truncate font-medium" style={{ color: memberColor(whiteSlot) }}>
              {game.white_nickname}
            </span>
          ) : (
            <span className="text-muted">참가 대기</span>
          )}
        </span>
        <span className="ml-auto shrink-0 text-muted tabular-nums">{game.moves.length}수</span>
      </div>

      <div
        className="relative aspect-square w-full touch-manipulation rounded-md shadow-inner select-none"
        style={{ background: "linear-gradient(135deg, #e0b16a, #c99549)" }}
        onMouseLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${OMOK_SIZE} ${OMOK_SIZE}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {LINES.map((p) => (
            <g key={p} stroke="#5b3a14" strokeWidth={0.04} strokeOpacity={0.75}>
              <line x1={0.5} x2={OMOK_SIZE - 0.5} y1={p} y2={p} />
              <line y1={0.5} y2={OMOK_SIZE - 0.5} x1={p} x2={p} />
            </g>
          ))}
          {OMOK_STARS.map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x + 0.5} cy={y + 0.5} r={0.11} fill="#5b3a14" />
          ))}
        </svg>
        <div
          className="absolute inset-0 grid"
          style={{ gridTemplateColumns: `repeat(${OMOK_SIZE}, 1fr)`, gridTemplateRows: `repeat(${OMOK_SIZE}, 1fr)` }}
          role="grid"
          aria-label="오목판"
        >
          {CELLS.map((i) => {
            const v = game.board[i];
            const empty = v === ".";
            const showGhost = empty && myTurn && !busy && hover === i;
            return (
              <button
                key={i}
                type="button"
                aria-label={`${(i % OMOK_SIZE) + 1}열 ${Math.floor(i / OMOK_SIZE) + 1}행${empty ? "" : v === "b" ? " 흑" : " 백"}`}
                disabled={!empty || !myTurn || busy}
                onClick={() => void place(i)}
                onMouseEnter={() => setHover(i)}
                className={`relative flex items-center justify-center ${empty && myTurn ? "cursor-pointer" : "cursor-default"}`}
              >
                {!empty && (
                  <Stone
                    color={v as "b" | "w"}
                    className={`size-[86%] ${winSet.has(i) ? "ring-2 ring-red-500 ring-offset-1 ring-offset-transparent" : ""}`}
                  />
                )}
                {showGhost && <Stone color={turn} className="size-[86%] opacity-45" />}
                {i === last && !winSet.has(i) && (
                  <span className="absolute size-[22%] rounded-full bg-red-500" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className={`min-w-0 flex-1 ${myTurn ? "font-semibold text-accent-hover" : "text-sub"}`}>{status}</span>
        {game.status === "playing" && isPlayer && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await resignOmok(game.message_id);
              setBusy(false);
            }}
            className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] text-muted hover:bg-hover hover:text-fg"
          >
            {game.white_id ? "기권" : "취소"}
          </button>
        )}
      </div>
      {game.status === "playing" && (
        <p className="mt-1 text-[10px] text-muted">다섯 개 이상 이으면 승리 · 흑은 쌍삼 금지</p>
      )}
      {game.status === "finished" && (
        <p className="mt-1 text-[10px] text-muted">한 판 더? 채팅에 !오목 을 보내세요</p>
      )}
    </div>
  );
}

function Stone({ color, className = "" }: { color: "b" | "w"; className?: string }) {
  return (
    <span
      aria-hidden
      className={`block shrink-0 rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.5)] ${className}`}
      style={{
        background:
          color === "b"
            ? "radial-gradient(circle at 35% 30%, #6b6b6b, #141414 62%)"
            : "radial-gradient(circle at 35% 30%, #ffffff, #d4d4d4 70%)",
      }}
    />
  );
}
