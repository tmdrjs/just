/** 채팅 야추. 주사위·진행은 모두 서버(yacht_* RPC)가 처리하고, 여기서는 표시와 점수 미리보기만 한다 */

export const YACHT_COMMAND = "!야추";
export const YACHT_ROUNDS = 12;
export const UPPER_BONUS_AT = 63;
export const UPPER_BONUS = 35;

export const UPPER = ["ones", "twos", "threes", "fours", "fives", "sixes"] as const;
export const LOWER = ["choice", "four_kind", "full_house", "small_straight", "large_straight", "yacht"] as const;
export type YachtCategory = (typeof UPPER)[number] | (typeof LOWER)[number];

export const CATEGORY_LABEL: Record<YachtCategory, string> = {
  ones: "1",
  twos: "2",
  threes: "3",
  fours: "4",
  fives: "5",
  sixes: "6",
  choice: "초이스",
  four_kind: "포카드",
  full_house: "풀하우스",
  small_straight: "S. 스트레이트",
  large_straight: "L. 스트레이트",
  yacht: "야추",
};

export const CATEGORY_HINT: Record<YachtCategory, string> = {
  ones: "1의 합",
  twos: "2의 합",
  threes: "3의 합",
  fours: "4의 합",
  fives: "5의 합",
  sixes: "6의 합",
  choice: "주사위 합",
  four_kind: "같은 눈 4개 이상 → 합",
  full_house: "3개 + 2개 → 합",
  small_straight: "4개 연속 → 15",
  large_straight: "5개 연속 → 30",
  yacht: "5개 모두 같음 → 50",
};

export type YachtScores = Partial<Record<YachtCategory, number>>;

export interface YachtGame {
  message_id: string;
  agenda_id: string;
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player1_name: string;
  player2_name: string | null;
  player3_name: string | null;
  player_count: number;
  status: "lobby" | "playing" | "finished";
  end_reason: "complete" | "cancelled" | null;
  turn: number;
  round: number;
  /** 0 = 아직 안 굴림 */
  dice: number[];
  held: boolean[];
  rolls_left: number;
  scores: YachtScores[];
  created_at: string;
  updated_at: string;
}

export function isYachtMessage(content: string) {
  return content.trim() === YACHT_COMMAND;
}

/** 서버 private.yacht_points 와 같은 규칙 */
export function yachtPoints(dice: number[], category: YachtCategory): number {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  const sum = dice.reduce((a, b) => a + b, 0);
  const max = Math.max(...c.slice(1));
  const has = (...faces: number[]) => faces.every((f) => c[f] > 0);
  switch (category) {
    case "ones":
      return c[1];
    case "twos":
      return c[2] * 2;
    case "threes":
      return c[3] * 3;
    case "fours":
      return c[4] * 4;
    case "fives":
      return c[5] * 5;
    case "sixes":
      return c[6] * 6;
    case "choice":
      return sum;
    case "four_kind":
      return max >= 4 ? sum : 0;
    case "full_house": {
      const counts = c.slice(1).filter((n) => n > 0).sort((a, b) => a - b);
      return counts.length === 2 && counts[0] === 2 && counts[1] === 3 ? sum : 0;
    }
    case "small_straight":
      return has(1, 2, 3, 4) || has(2, 3, 4, 5) || has(3, 4, 5, 6) ? 15 : 0;
    case "large_straight":
      return has(1, 2, 3, 4, 5) || has(2, 3, 4, 5, 6) ? 30 : 0;
    case "yacht":
      return max === 5 ? 50 : 0;
  }
}

export function totals(scores: YachtScores) {
  const upper = UPPER.reduce((sum, k) => sum + (scores[k] ?? 0), 0);
  const lower = LOWER.reduce((sum, k) => sum + (scores[k] ?? 0), 0);
  const bonus = upper >= UPPER_BONUS_AT ? UPPER_BONUS : 0;
  return { upper, bonus, total: upper + bonus + lower };
}

export function players(game: YachtGame) {
  const ids = [game.player1_id, game.player2_id, game.player3_id];
  const names = [game.player1_name, game.player2_name, game.player3_name];
  return Array.from({ length: game.player_count }, (_, seat) => ({
    seat,
    id: ids[seat],
    name: names[seat] ?? "",
    scores: game.scores[seat] ?? {},
  }));
}

export function seatOf(game: YachtGame, userId: string) {
  const i = [game.player1_id, game.player2_id, game.player3_id].indexOf(userId);
  return i >= 0 && i < game.player_count ? i : null;
}

export function isMyTurn(game: YachtGame, userId: string) {
  return game.status === "playing" && seatOf(game, userId) === game.turn;
}

export const YACHT_ERRORS: Record<string, string> = {
  GAME_STARTED: "이미 시작한 게임이에요.",
  FULL: "자리가 꽉 찼어요 (최대 3명).",
  NOT_HOST: "방장만 할 수 있어요.",
  NOT_STARTED: "아직 시작 전이에요.",
  GAME_OVER: "이미 끝난 게임이에요.",
  GAME_CLOSED: "삭제된 게임이에요.",
  NOT_PLAYER: "참가한 사람만 할 수 있어요.",
  NOT_YOUR_TURN: "아직 내 차례가 아니에요.",
  NO_ROLLS_LEFT: "이번 차례에 굴릴 수 있는 횟수를 다 썼어요. 점수 칸을 골라 주세요.",
  ROLL_FIRST: "먼저 주사위를 굴려 주세요.",
  CATEGORY_USED: "이미 점수를 적은 칸이에요.",
  INVALID_CATEGORY: "알 수 없는 점수 칸이에요.",
};
