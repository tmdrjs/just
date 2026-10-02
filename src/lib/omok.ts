/** 채팅 오목. 판정은 모두 서버(omok_play RPC)가 한다 */

export const OMOK_COMMAND = "!오목";
export const OMOK_SIZE = 15;
/** 화점 (판 위 점) */
export const OMOK_STARS = [
  [3, 3],
  [11, 3],
  [7, 7],
  [3, 11],
  [11, 11],
] as const;

export type OmokColor = "b" | "w";

export interface OmokGame {
  message_id: string;
  agenda_id: string;
  black_id: string | null;
  white_id: string | null;
  black_nickname: string;
  white_nickname: string | null;
  /** 225칸 문자열: '.' 빈칸 / 'b' 흑 / 'w' 백. 칸 번호 = y * 15 + x */
  board: string;
  moves: number[];
  status: "playing" | "finished";
  winner: OmokColor | null;
  end_reason: "five" | "resign" | "full" | "cancelled" | null;
  win_line: number[] | null;
  created_at: string;
  updated_at: string;
}

export function isOmokMessage(content: string) {
  return content.trim() === OMOK_COMMAND;
}

export function turnOf(game: OmokGame): OmokColor {
  return game.moves.length % 2 === 0 ? "b" : "w";
}

/** 지금 이 사용자가 둘 수 있는가 (백 자리가 비어 있으면 흑이 아닌 멤버는 누구나 백으로 참가) */
export function canPlay(game: OmokGame, userId: string) {
  if (game.status !== "playing") return false;
  const turn = turnOf(game);
  if (turn === "b") return game.black_id === userId;
  return game.white_id ? game.white_id === userId : game.black_id !== userId;
}

export const OMOK_ERRORS: Record<string, string> = {
  NOT_YOUR_TURN: "아직 내 차례가 아니에요.",
  WAITING_OPPONENT: "상대를 기다리는 중이에요. 다른 멤버가 백으로 먼저 두면 시작돼요.",
  NOT_PLAYER: "이미 두 사람이 대국 중이에요. 구경만 할 수 있어요.",
  OCCUPIED: "이미 돌이 있는 자리예요.",
  FORBIDDEN_33: "쌍삼(3·3)이라 흑은 둘 수 없는 자리예요.",
  GAME_OVER: "이미 끝난 대국이에요.",
  GAME_CLOSED: "삭제된 대국이에요.",
};
